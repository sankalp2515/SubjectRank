/**
 * ONNX inference + ranking. Runs inside the serverless function.
 *
 * The feature vector is built by ./features.ts, the TypeScript twin of the Python
 * extractor that produced the training data. The parity suite is what makes that
 * sentence safe to say; see docs/FEATURES.md.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Type-only, so it is erased at build time and does NOT pull the native addon
// into any module that merely wants the types. The runtime import stays dynamic
// and happens once, in doLoad().
import type * as Ort from 'onnxruntime-node';

import { extract, normalise, FEATURE_NAMES, FEATURE_SPEC_VERSION } from './features';
import { TOO_CLOSE_THRESHOLD } from './placings';

/**
 * The artifact contract: every field `champion.meta.json` may carry and anything
 * downstream may read.
 *
 * All of it is declared here on purpose. Three consumers used to reach past this
 * type with `meta as unknown as { some_field?: T }` casts - /api/health for the
 * artifact hash, /api/rank for the length gauge's datum, and the drift cron for
 * the training distribution. A cast is a claim about the file made at the point
 * of use, so the file's shape was defined in four places and none of them could
 * be checked against the others. Optional fields say "the exporter may not have
 * written this", which is the truth; a cast said "trust me", which is not.
 */
export type ModelMeta = {
  version: string;
  algorithm: string;
  feature_spec_version: number;
  /** Features the model actually consumes, in graph order. */
  feature_names: string[];
  /** Dropped for insufficient training support (D-012). The UI must stay silent on these. */
  excluded_features: string[];
  /** Present for linear models only: exact per-feature attribution. */
  coefficients?: number[];
  scale?: number[];
  trained_on?: { subsets: string[]; pairs: number; tests: number };
  /** Median character count in the training corpus. The length gauge's datum. */
  training_char_median?: number;
  /** sha256 of champion.onnx, stamped at promotion. The deploy verifies against it. */
  artifact_sha256?: string;
  /**
   * Per-feature training samples, for PSI in the drift cron.
   *
   * Optional because nothing in this repository writes it today:
   * ml/scripts/export_artifacts.py does not emit it, so /api/cron/drift always
   * takes its "no baseline" branch. Declaring it is what makes that a visible
   * contract with a missing producer rather than an inline cast for a field that
   * never arrives.
   */
  training_feature_samples?: Record<string, number[]>;
};

type LoadedModel = { session: Ort.InferenceSession; meta: ModelMeta; index: number[] };

export class ModelNotTrainedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ModelNotTrainedError';
  }
}

let cached: LoadedModel | null = null;
// Concurrent cold-start requests would each build a full ONNX session and only the
// last assignment would survive, leaking the rest against the function's memory
// limit. One in-flight load, shared.
let loading: Promise<LoadedModel> | null = null;
// The ORT module handle, captured at load. `predict` used to `await import(...)`
// on every call: the module registry caches it, so it was cheap, but it put a
// microtask and a resolver on the hot path for a value that cannot change after
// the session exists.
let ort: typeof Ort | null = null;

// Inside the app root on purpose: Vercel deploys `web/` as the project root and
// file tracing refuses to include anything above it. ml/scripts/promote_model.py
// copies the champion here, so what ships is always an explicit promotion rather
// than whatever happens to be in the training output directory.
const ARTIFACT_DIR = process.env.MODEL_DIR ?? path.join(process.cwd(), 'model');

/**
 * When set, the ONNX forward pass happens on the inference API instead of in
 * this process. Everything else -- normalisation, feature extraction,
 * aggregation, attribution -- still runs HERE, on the same code as before.
 *
 * That split is the whole design. Vercel cannot carry onnxruntime-node
 * comfortably, but it can carry a pure-TypeScript extractor and a few KB of
 * model metadata. So the only thing delegated is the one thing that needs a
 * native runtime.
 *
 * The alternative -- calling the API's /v1/compare and rendering ITS reasoning
 * -- was rejected. It would have meant two implementations of attribution
 * feeding one interface, and the first time they disagreed the product would
 * have shown a claim no local test could reproduce. This project already shipped
 * one attribution bug that said the opposite of the number beside it; it does
 * not need a second source of them.
 */
const REMOTE_API = (process.env.SUBJECTRANK_API_URL ?? '').replace(/\/+$/, '');

export async function loadModel() {
  if (cached) return cached;
  if (loading) return loading;
  loading = doLoad().finally(() => { loading = null; });
  return loading;
}

async function doLoad() {

  let metaRaw: string;
  try {
    metaRaw = await readFile(path.join(ARTIFACT_DIR, 'champion.meta.json'), 'utf-8');
  } catch {
    throw new ModelNotTrainedError(
      'No champion model in web/model/. Train one (python -m subjectrank.train) then ' +
      'promote it (python ml/scripts/promote_model.py). The archive download is a ' +
      'manual step - see docs/GET_THE_DATA.md.',
    );
  }
  const meta: ModelMeta = JSON.parse(metaRaw);

  // Validate at load, where the error can name the field, rather than letting a
  // missing key surface later as a generic 500 on every single request.
  for (const field of ['version', 'feature_spec_version', 'feature_names'] as const) {
    if (meta[field] === undefined) {
      throw new Error(`champion.meta.json is missing "${field}". Re-promote the model.`);
    }
  }
  if (!Array.isArray(meta.excluded_features)) meta.excluded_features = [];

  // A model trained under one feature spec must never be served by an extractor
  // at another. Refusing to start beats serving silently-wrong numbers.
  if (meta.feature_spec_version !== FEATURE_SPEC_VERSION) {
    throw new Error(
      `Feature spec mismatch: model is v${meta.feature_spec_version}, extractor is ` +
      `v${FEATURE_SPEC_VERSION}. Refusing to serve. Retrain or roll back - see RUNBOOK.md.`,
    );
  }

  // The ONNX graph is positional. Map the model's feature list onto the
  // extractor's full vector once, here, rather than trusting the orders match.
  const index = meta.feature_names.map((name) => {
    const i = FEATURE_NAMES.indexOf(name);
    if (i < 0) throw new Error(`model wants unknown feature "${name}"`);
    return i;
  });

  // In remote mode there is no local graph to load, and requiring one would
  // defeat the point: the deployment that delegates inference is exactly the one
  // that cannot install the native runtime.
  if (REMOTE_API) {
    cached = { session: null as unknown as Ort.InferenceSession, meta, index };
    return cached;
  }

  ort = await import('onnxruntime-node');
  let session: Ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(path.join(ARTIFACT_DIR, 'champion.onnx'));
  } catch (e) {
    // Metadata present but no graph: a half-finished promotion. That is still
    // "no model deployed", so it must produce the honest 503 rather than a
    // generic 500 blaming the server for something a deploy step left undone.
    throw new ModelNotTrainedError(
      `champion.meta.json is present but champion.onnx could not be loaded ` +
      `(${(e as Error).message}). Re-run ml/scripts/promote_model.py.`,
    );
  }
  cached = { session, meta, index };
  return cached;
}

/**
 * P(A beats B) for every ordered pair, from the inference API.
 *
 * Returns the matrix rather than a flat list because that is what the API
 * exposes: `internals.pairwise[i][j]` is P(i beats j) for the lines submitted.
 * The caller maps it back onto its own pair ordering, so a change to either
 * side's pair enumeration cannot silently transpose the result.
 */
async function predictRemote(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${REMOTE_API}/v1/compare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: texts, includeInternals: true }),
    /*
     * The inference service scales to zero, so the first request after an idle
     * period pays a full container start. That was measured at 28,776 ms
     * (EXPERIMENTS.md, D-031 benchmark) — which this timeout used to sit just
     * 1.2 seconds above.
     *
     * It showed up in production immediately: the first comparison against the
     * live deployment returned 500, and the same request 20 seconds later
     * returned in 373 ms. A limit set a hair above the measured worst case is
     * not a limit, it is a coin flip.
     *
     * 45s gives real headroom and stays under the 60s Vercel function ceiling
     * declared in vercel.json, so the fetch aborts with a message we control
     * rather than the platform killing the function first.
     */
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    throw new Error(`inference API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json() as {
    modelVersion: string;
    lines: Array<{ index: number; internals?: { pairwise?: Record<string, number> } }>;
  };

  const n = texts.length;
  const P: number[][] = Array.from({ length: n }, () => Array(n).fill(0.5));
  for (const line of body.lines) {
    const pw = line.internals?.pairwise;
    if (!pw) {
      throw new Error(
        'inference API returned no internals. It is running a build that predates ' +
        'includeInternals, so the frontend cannot rank or store anything.',
      );
    }
    for (const [j, p] of Object.entries(pw)) P[line.index][Number(j)] = p;
  }
  return P;
}

/** P(A beats B) for a batch of difference vectors. */
async function predict(
  session: Ort.InferenceSession,
  diffs: number[][],
): Promise<number[]> {
  // Set by doLoad(), which every caller has already awaited via loadModel().
  if (!ort) throw new Error('predict() called before the model was loaded');

  const n = diffs.length;
  const d = diffs[0].length;

  // Filled in place. `diffs.flat()` built a second n*d array of boxed numbers
  // purely to hand it to Float32Array.from, which then copied it again.
  const flat = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    const row = diffs[i];
    const base = i * d;
    for (let k = 0; k < d; k++) flat[base + k] = row[k];
  }

  const tensor = new ort.Tensor('float32', flat, [n, d]);
  const out = await session.run({ [session.inputNames[0]]: tensor });

  for (const key of Object.keys(out)) {
    const t = out[key];
    if (t.dims?.length === 2 && t.dims[1] === 2) {
      const data = t.data as Float32Array;
      return Array.from({ length: n }, (_, i) => data[i * 2 + 1]);
    }
  }
  throw new Error('ONNX graph produced no probability output');
}

export type RankedLine = {
  index: number;
  text: string;
  rank: number;
  score: number;
  /** Distance from a coin flip, averaged over this line's comparisons. */
  confidence: number;
  features: Record<string, number>;
  pairwise: Record<number, number>;
  /** The string the features were computed on, and the one the card must render. */
  normalisedText: string;
  /** Attribution, computed server-side. See the note on Comparison below. */
  notes: import('./attribution').Note[];
  marks: import('./attribution').Mark[];
};

/**
 * Attribution is computed on the SERVER and shipped with the comparison.
 *
 * The alternative - send coefficients to the browser and compute there - was
 * tried and rejected for two reasons: the model's weights would ship in every
 * page load, and the attribution logic would have to run in two places to serve
 * both the build-time worked example and live comparisons. One code path, one
 * copy of the weights.
 */
export type Comparison = {
  modelVersion: string;
  featureSpecVersion: number;
  lines: RankedLine[];
  /** Pairs the model cannot separate. Shown, not hidden. */
  tooCloseToCall: Array<[number, number]>;
  inferenceMs: number;
};

/**
 * Re-exported so existing server-side callers keep one import path. The constant
 * itself is defined in ./placings, which the browser can import - reaching the
 * other way round pulled the ONNX runtime into the client bundle.
 */
export { TOO_CLOSE_THRESHOLD };

export async function rank(texts: string[]): Promise<Comparison> {
  // Model load is deliberately OUTSIDE the timer. Including it made the first
  // request after a cold start report ~500ms in a field labelled as inference
  // time, next to a second request reporting 3ms for identical work.
  const { session, meta, index } = await loadModel();
  const t0 = performance.now();

  if (texts.length < 2) {
    throw new Error('rank() needs at least two lines - there is nothing to compare.');
  }

  // Normalise once, and rank the normalised form. What the card renders, what the
  // features were computed on, and what the character count reports are then all
  // the same string (H4). They differ only by collapsed whitespace and NFC.
  const normalised = texts.map(normalise);
  const full = normalised.map(extract);
  const reduced = full.map((v) => index.map((i) => v[i]));
  const n = texts.length;

  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) if (i !== j) pairs.push([i, j]);
  }
  let P: number[][];
  if (REMOTE_API) {
    // Send the ORIGINAL text, not the normalised form. The API normalises with
    // the Python extractor, and the parity suite is what guarantees the two
    // agree; normalising here first would hide a disagreement instead of
    // exposing it.
    P = await predictRemote(texts);
  } else {
    const diffs = pairs.map(([i, j]) => reduced[i].map((v, k) => v - reduced[j][k]));
    const probs = await predict(session, diffs);
    P = Array.from({ length: n }, () => Array(n).fill(0.5));
    pairs.forEach(([i, j], k) => { P[i][j] = probs[k]; });
  }

  const scores = P.map((row, i) =>
    row.filter((_, j) => j !== i).reduce((a, b) => a + b, 0) / (n - 1));
  const confidence = P.map((row, i) =>
    row.filter((_, j) => j !== i).reduce((a, p) => a + Math.abs(p - 0.5), 0) / (n - 1) * 2);

  const order = scores.map((s, i) => [s, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);

  const featureMaps = full.map((v) =>
    Object.fromEntries(FEATURE_NAMES.map((nm, k) => [nm, v[k]])));

  const { marksFor, notesFor } = await import('./attribution');

  const lines: RankedLine[] = order.map(([score, i], r) => {
    const others = featureMaps.filter((_, j) => j !== i);
    const notes = notesFor(meta, featureMaps[i], others);
    return {
      index: i,
      text: texts[i],
      normalisedText: normalised[i],
      rank: r + 1,
      score,
      confidence: confidence[i],
      features: featureMaps[i],
      pairwise: Object.fromEntries(P[i].map((p, j) => [j, p]).filter(([j]) => j !== i)),
      notes,
      marks: marksFor(normalised[i], notes, meta, featureMaps[i]),
    };
  });

  const tooClose: Array<[number, number]> = [];
  for (let a = 0; a < lines.length - 1; a++) {
    if (Math.abs(lines[a].score - lines[a + 1].score) < TOO_CLOSE_THRESHOLD) {
      tooClose.push([lines[a].index, lines[a + 1].index]);
    }
  }

  return {
    modelVersion: meta.version,
    featureSpecVersion: meta.feature_spec_version,
    lines,
    tooCloseToCall: tooClose,
    inferenceMs: Math.round((performance.now() - t0) * 100) / 100,
  };
}
