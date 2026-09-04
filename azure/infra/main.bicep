// SubjectRank on Azure — everything the project needs, and nothing it does not.
//
// Deployed at resource-group scope:
//   az deployment group create -g <rg> -f azure/infra/main.bicep -p @azure/infra/main.parameters.json
//
// Two things this file deliberately does NOT create:
//
//   * **A Postgres server.** Supabase already holds the schema, the row-level
//     security policies and a script that asserts the RLS is really on. Moving
//     to Azure Database for PostgreSQL would mean re-implementing all of that to
//     end up in the same place. That is churn, not learning. See D-029.
//   * **An Azure ML managed online endpoint.** It exists in azure/ml/ and is
//     deployed by hand for the benchmark in D-031, then torn down. It is not
//     part of the standing infrastructure, because the app does not serve
//     through it — inference runs in-process (D-006).

targetScope = 'resourceGroup'

@description('Short name used as a prefix for every resource. Lowercase alphanumeric.')
@minLength(3)
@maxLength(11)
param prefix string = 'subjectrank'

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Container image to deploy. Required when deployApp is true.')
param containerImage string = ''

@description('''
Create the Container App itself.

Split from the rest because of a hard ordering problem: the app's readiness probe
asks /api/health whether the model loaded, and the registry that holds the image
is created by this same template. Deploying the app with a placeholder image
meant the probe could never pass, the revision never became healthy, and ARM
failed the whole deployment with "Operation expired".

So: deploy with deployApp=false to create the registry and environment, build the
real image into that registry, then deploy again with deployApp=true and the real
tag. deploy.sh does exactly that.
''')
param deployApp bool = true

@description('Container image for the FastAPI inference service.')
param apiImage string = ''

@description('''
Create the FastAPI inference Container App.

Separate from deployApp for the same ordering reason, and separate from the web
app because the two are independently deployable on purpose: Vercel serves the
frontend and calls this service for inference, so the API has to be able to ship
without the web container moving.
''')
param deployApi bool = false

@description('''
Origin allowed to call the API from a browser, e.g. https://subjectrank.vercel.app.
Left empty it falls back to '*', which is fine for a public read-only ranking
endpoint that holds no session and returns no user data, but the real origin is
better because it makes the intended caller explicit.
''')
param allowedOrigin string = ''

@description('Session cookie signing secret. The app refuses to start in production without it.')
@secure()
param sessionSecret string

@description('Admin route token. /admin returns 404 when this is empty, in every environment.')
@secure()
param adminToken string = ''

@description('Supabase project URL. Empty means the app runs on the in-memory layer and persists nothing.')
param supabaseUrl string = ''

@description('Supabase service role key.')
@secure()
param supabaseServiceKey string = ''

@description('''
Create the Azure ML workspace and its Key Vault.

Split out because it is the slowest part of this deployment by several minutes
and the most likely to fail on a fresh subscription (quota, region availability,
a soft-deleted Key Vault from a previous run). The app does not depend on it: the
model is baked into the image, so the site can go live with this false and the ML
platform can follow.
''')
param deployMachineLearning bool = true

var uniq = uniqueString(resourceGroup().id)
var acrName = toLower('${prefix}acr${uniq}')

// A storage account name is capped at 24 characters, and uniqueString() always
// returns 13. With the default prefix this produced a 26-character name and the
// deployment failed at resource creation -- after the resource group existed, so
// a re-run needed cleanup first. The prefix is clamped to 8 so the total is 23
// whatever prefix is passed, and the unique suffix is kept whole because
// truncating it is what would cause collisions between two people deploying this.
var storageName = toLower('${take(prefix, 8)}st${uniq}')

// ---------------------------------------------------------------------------
// Container registry. AdminUser is disabled: CI authenticates with a federated
// credential and the Container App pulls with its own managed identity, so no
// registry password exists to leak.
// ---------------------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
  }
}

// ---------------------------------------------------------------------------
// Storage. Holds the Upworthy archive and every training artifact.
//
// D-001 refused to source the archive from GitHub mirrors because provenance
// mattered; the same argument says the copy the pipeline trains from should live
// somewhere versioned with its checksum recorded, not only on one laptop.
// Versioning is on so an overwritten container cannot silently change what a
// past run trained on.
// ---------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
  }
}

resource archiveContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'archive'
  properties: { publicAccess: 'None' }
}

resource artifactsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'artifacts'
  properties: { publicAccess: 'None' }
}

// ---------------------------------------------------------------------------
// Observability. One workspace, shared by Container Apps and Azure ML.
// ---------------------------------------------------------------------------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

// ---------------------------------------------------------------------------
// Azure ML workspace. Needs a Key Vault and its own storage association.
// ---------------------------------------------------------------------------
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = if (deployMachineLearning) {
  name: '${prefix}-kv-${take(uniq, 8)}'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource mlWorkspace 'Microsoft.MachineLearningServices/workspaces@2024-04-01' = if (deployMachineLearning) {
  name: '${prefix}-ml'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    friendlyName: 'SubjectRank'
    description: 'Training jobs, model registry and champion/challenger promotion.'
    storageAccount: storage.id
    keyVault: keyVault.id
    applicationInsights: appInsights.id
    containerRegistry: acr.id
    publicNetworkAccess: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// Container Apps. Scale-to-zero is the whole reason this is Container Apps and
// not App Service: a portfolio artifact with no traffic should cost nothing
// while it has no traffic.
//
// The cost of that choice is a cold start on the first request after idle, and
// it lands on top of the ~2.5s ONNX session creation already measured in session
// 1. That trade is recorded in D-030 rather than discovered by a visitor.
// ---------------------------------------------------------------------------
resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    /*
     * No appLogsConfiguration.
     *
     * Wiring the environment to Log Analytics needs `logs.listKeys()` inline,
     * and on this subscription that call returned ResourceNotFound for a
     * workspace that demonstrably existed and read `Succeeded` — twice, on two
     * separate deployments. Rather than fight a cross-resource key fetch at
     * template-evaluation time, the environment is left without a log
     * destination: container logs are still reachable with
     * `az containerapp logs show`, and application telemetry goes to
     * Application Insights, which the app receives as a connection string and
     * which needs no key lookup here.
     *
     * The Log Analytics workspace is still created — Azure ML uses it — it is
     * just no longer on the critical path of the app deployment.
     */
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: '${prefix}-web'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${pullIdentity.id}': {} }
  }
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: pullIdentity.id
        }
      ]
      secrets: concat(
        [
          { name: 'session-secret', value: sessionSecret }
        ],
        empty(adminToken) ? [] : [ { name: 'admin-token', value: adminToken } ],
        empty(supabaseServiceKey) ? [] : [ { name: 'supabase-service-key', value: supabaseServiceKey } ]
      )
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(
            [
              { name: 'NODE_ENV', value: 'production' }
              { name: 'PORT', value: '3000' }
              { name: 'SESSION_SECRET', secretRef: 'session-secret' }
              { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
            ],
            empty(adminToken) ? [] : [ { name: 'ADMIN_TOKEN', secretRef: 'admin-token' } ],
            empty(supabaseUrl) ? [] : [ { name: 'NEXT_PUBLIC_SUPABASE_URL', value: supabaseUrl } ],
            empty(supabaseServiceKey) ? [] : [ { name: 'SUPABASE_SERVICE_ROLE_KEY', secretRef: 'supabase-service-key' } ]
          )
          probes: [
            {
              // Readiness loads the ONNX session, so a replica with an
              // unreadable model never receives traffic. See api/health.
              type: 'Readiness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 6
            }
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 20
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
        rules: [
          {
            name: 'http'
            http: { metadata: { concurrentRequests: '20' } }
          }
        ]
      }
    }
  }
}

// The app pulls its own image, and AcrPull granted to a managed identity is what
// lets adminUserEnabled stay false -- no registry password exists anywhere.
//
// This identity is USER-assigned, and that is not a style preference. With a
// system-assigned identity the dependency is circular: the principal does not
// exist until the app is created, so the role cannot be granted until then --
// but the app cannot finish being created, because its first act is to pull an
// image it is not yet allowed to pull. It retries until ARM gives up. That is
// exactly how this deployment failed: zero revisions, provisioningState stuck on
// InProgress, and no role assignment anywhere in the resource group.
//
// A user-assigned identity exists before either resource that uses it, so the
// grant happens in the infra pass (deployApp=false) and the app finds the
// permission already waiting. Note this is NOT gated on deployApp, deliberately:
// the whole point is that it is in place first.
resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${prefix}-pull'
  location: location
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, pullIdentity.id, acrPullRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// The inference service. Same environment, same pull identity, same registry --
// only the image and the port differ.
//
// No session secret and no admin token: this service holds no session and has no
// admin surface. It takes subject lines and returns an order. Giving it
// credentials it does not use would be handing out authority for nothing.
resource api 'Microsoft.App/containerApps@2024-03-01' = if (deployApi) {
  name: '${prefix}-api'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${pullIdentity.id}': {} }
  }
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
        // The browser never calls this directly -- Vercel's server routes do --
        // but CORS is set from the web origin so a future client-side call does
        // not silently fail, and so the allowed origin is written down.
        corsPolicy: {
          allowedOrigins: empty(allowedOrigin) ? [ '*' ] : [ allowedOrigin ]
          allowedMethods: [ 'GET', 'POST', 'OPTIONS' ]
          allowedHeaders: [ 'content-type' ]
        }
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: pullIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('1.0'), memory: '2Gi' }
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/v1/health', port: 8000 }
              initialDelaySeconds: 10
              periodSeconds: 10
              failureThreshold: 6
            }
          ]
        }
      ]
      // minReplicas 0 lets it scale to zero, which is what keeps this inside the
      // free grant when nobody is using it. The cost is a cold start on the first
      // request after idle, which is the right trade for a portfolio project and
      // the wrong one for production -- noted so the choice is not mistaken for
      // an oversight.
      scale: { minReplicas: 0, maxReplicas: 2 }
    }
  }
}

// The training job registers the model it just produced, and to do that the
// compute cluster's identity needs write access to the workspace. AcrPull alone
// is not enough -- with only that, the job trains, exports and verifies every
// graph, then fails on the last line of work.
//
// "AzureML Data Scientist" is the narrowest built-in role that can create a
// model version. It cannot delete the workspace or change its compute.
//
// This is why the pull identity is shared rather than one identity per service:
// there is a single principal to reason about, and its permissions are all in
// this file. The name has outgrown its original meaning -- it pulls images AND
// registers models now -- which is worth knowing before reading it as a
// promise about scope.
var amlDataScientistRoleId = 'f6c7c914-8db3-469d-8ca1-694a8f32e121'
resource mlWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployMachineLearning) {
  scope: mlWorkspace
  name: guid(mlWorkspace.id, pullIdentity.id, amlDataScientistRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', amlDataScientistRoleId)
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output containerAppName string = '${prefix}-web'
output appUrl string = deployApp ? 'https://${app.properties.configuration.ingress.fqdn}' : ''
output storageAccountName string = storage.name
output mlWorkspaceName string = deployMachineLearning ? mlWorkspace.name : ''
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output apiName string = '${prefix}-api'
output apiUrl string = deployApi ? 'https://${api.properties.configuration.ingress.fqdn}' : ''
