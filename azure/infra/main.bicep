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

@description('Container image to deploy. Overridden by CI on every deploy.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

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
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-web'
  location: location
  identity: { type: 'SystemAssigned' }
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
          identity: 'system'
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

// The app pulls its own image. AcrPull on the registry, granted to the app's
// managed identity, is what lets adminUserEnabled stay false.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, app.id, acrPullRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output containerAppName string = app.name
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output storageAccountName string = storage.name
output mlWorkspaceName string = deployMachineLearning ? mlWorkspace.name : ''
output appInsightsConnectionString string = appInsights.properties.ConnectionString
