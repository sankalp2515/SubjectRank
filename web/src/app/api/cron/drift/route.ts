import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled drift check (Vercel Cron).
 *
 * Compares the distribution of features extracted from live submissions against
 * the training distribution baked into the model artifact.
 *
 * This is EXPECTED to fire immediately and dramatically: 2026 email subject lines
 * are shorter, carry more emoji and punctuation, and use less curiosity-gap
 * phrasing than 2013-2015 Upworthy headlines. That shift is the finding, not an
 * incident. What would actually be alarming is in RUNBOOK.md section 5.
 */
function psi(train: number[], live: number[], nBins = 10, eps = 1e-6): number {
  const t = train.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const l = live.filter(Number.isFinite);
  if (!t.length || !l.length) return NaN;

  // Bin edges come from TRAINING, applied to live. Binning on the combined data
  // would move as live data arrives and would understate the shift - the
  // direction of error that lets a problem hide.
  const q = (p: number) => t[Math.min(t.length - 1, Math.floor(p * (t.length - 1)))];
  const edges = [...new Set(Array.from({ length: nBins + 1 }, (_, i) => q(i / nBins)))];
  if (edges.length < 3) return NaN;
  edges[0] = -Infinity;
  edges[edges.length - 1] = Infinity;

  const bin = (xs: number[]) => {
    const c = new Array(edges.length - 1).fill(0);
    for (const x of xs) {
      for (let i = 0; i < c.length; i++) {
        if (x >= edges[i] && x < edges[i + 1]) { c[i]++; break; }
      }
    }
    const n = xs.length || 1;
    return c.map((v) => Math.max(v / n, eps));
  };

  const tp = bin(t);
  const lp = bin(l);
  return tp.reduce((acc, p, i) => acc + (lp[i] - p) * Math.log(lp[i] / p), 0);
}

export async function GET(req: Request) {
  // Vercel Cron sends the secret as a bearer token. Reject anything else so the
  // endpoint cannot be triggered by a stranger.
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const { getDataLayer } = await import('@/lib/data');
  const { loadModel } = await import('@/lib/model');
  const data = await getDataLayer();

  if (data.kind !== 'supabase') {
    return NextResponse.json(
      { skipped: 'Drift monitoring needs the Postgres data layer; the in-memory layer has no history.' },
      { status: 200 },
    );
  }

  const { meta } = await loadModel();
  const baseline = meta.training_feature_samples;
  if (!baseline) {
    return NextResponse.json(
      { skipped: 'Model artifact carries no training distribution samples; retrain to embed them.' },
      { status: 200 },
    );
  }

  // PSI compares two DISTRIBUTIONS. An earlier version passed the live *mean* as a
  // one-element array, which binned to one full bucket and nine epsilon buckets and
  // returned ~12.4 for every feature on every run, drifted or not - and since the
  // route's own framing says to expect a lot of flags on day one, the bug was
  // indistinguishable from the expected signal.
  const live = await data.liveFeatureSamples(2000);
  const sampleCount = Math.max(0, ...Object.values(live).map((a) => a.length));

  if (sampleCount < 50) {
    return NextResponse.json({
      skipped: `Only ${sampleCount} live observations. PSI on a handful of samples ` +
               `is noise; waiting for more rather than reporting a number.`,
      sampleCount,
    });
  }

  const stats: Record<string, { psi: number | null; live_mean: number; n: number }> = {};
  const flagged: string[] = [];
  let maxPsi = 0;
  let measured = 0;

  for (const name of meta.feature_names) {
    const t = baseline[name];
    const l = live[name];
    if (!t?.length || !l?.length) continue;
    const value = psi(t, l);
    const mean = l.reduce((a, b) => a + b, 0) / l.length;
    stats[name] = { psi: Number.isFinite(value) ? value : null, live_mean: mean, n: l.length };
    if (Number.isFinite(value)) {
      measured++;
      maxPsi = Math.max(maxPsi, value);
      if (value >= 0.25) flagged.push(name);
    }
  }

  const payload = {
    ok: true,
    modelVersion: meta.version,
    // Null, not 0, when nothing could be measured: reporting maxPsi 0 for a run
    // that measured nothing reads as "no drift".
    maxPsi: measured ? maxPsi : null,
    featuresMeasured: measured,
    sampleCount,
    flagged,
    stats,
    note: 'Input drift against 2013-2015 headlines is expected and is a finding, not an incident.',
  };

  // C6: previously this returned JSON and persisted nothing, so /admin's drift
  // panel said "no monitoring runs yet" forever no matter how often the cron ran.
  await data.saveMonitoringRun({
    model_version: meta.version,
    window_start: new Date(Date.now() - 86_400_000).toISOString(),
    window_end: new Date().toISOString(),
    n_rankings: 0,
    n_items: sampleCount,
    feature_stats: stats,
    prediction_stats: {},
    flagged_features: flagged,
    max_psi: measured ? maxPsi : null,
  });

  return NextResponse.json(payload);
}
