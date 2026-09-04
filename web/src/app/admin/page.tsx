import { notFound } from 'next/navigation';

import { getDataLayer } from '@/lib/data';
import { isAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Sankalp's tool, not a user surface (§8). Deliberately plain: no design effort
 * spent here, because every hour spent on it is an hour not spent on the
 * comparison moment.
 *
 * ACCESS CONTROL. An earlier version had none, and its comment claimed the route
 * sat behind the `admins` table and `is_admin()`. That was wrong twice over: there
 * was no check in the code, and the named protection is an RLS policy - while this
 * page reads through the service-role client, which exists precisely to bypass RLS.
 * `curl /admin` returned 25 visitors' free-text comments to anyone.
 *
 * Now it fails closed: no ADMIN_TOKEN configured means no access, in every
 * environment, and a wrong token gets a 404 rather than a 403 so the route does not
 * confirm its own existence.
 */
export default async function Admin() {
  if (!(await isAdmin())) notFound();

  const data = await getDataLayer();
  const s = await data.adminSummary();

  const cell: React.CSSProperties = {
    padding: '6px 10px', borderBottom: '1px solid var(--rule-faint)',
    fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'left',
  };

  return (
    <main className="wrap" style={{ maxWidth: 940 }}>
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Admin</h1>
      <p className="mono" style={{ fontSize: 11, color: 'var(--rule)', marginTop: 0 }}>
        data layer: {data.kind}
        {data.kind === 'mock' && ' — nothing here is persisted'}
      </p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Funnel (24h)</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {s.funnel.length === 0 && <tr><td style={cell}>no events yet</td></tr>}
          {s.funnel.map((f) => (
            <tr key={f.name}><td style={cell}>{f.name}</td><td style={{ ...cell, textAlign: 'right' }}>{f.count}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Volume</h2>
      <p className="mono" style={{ fontSize: 12 }}>{s.rankings24h} rankings in the last 24 hours</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Drift</h2>
      {s.drift ? (
        <p className="mono" style={{ fontSize: 12 }}>
          last run {s.drift.lastRunAt} · max PSI {s.drift.maxPsi?.toFixed(3)} ·
          flagged: {s.drift.flagged.join(', ') || 'none'}
        </p>
      ) : (
        <p className="mono" style={{ fontSize: 12, color: 'var(--rule)' }}>
          no monitoring runs yet. Expect the first one to flag a lot — that is the finding.
        </p>
      )}

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Feedback queue</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {s.feedback.length === 0 && <tr><td style={cell}>no disagreements recorded</td></tr>}
          {s.feedback.map((f) => (
            <tr key={f.id}>
              <td style={cell}>{f.createdAt}</td>
              <td style={cell}>{f.modelVersion}</td>
              <td style={cell}>{f.comment ?? '(no comment)'}</td>
              <td style={cell}>{f.lines.join(' | ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Models</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {s.models.length === 0 && <tr><td style={cell}>no model registry rows</td></tr>}
          {s.models.map((m) => (
            <tr key={m.version}>
              <td style={cell}>{m.version}</td>
              <td style={cell}>{m.status}</td>
              <td style={cell}>{m.pairs ?? '—'} pairs</td>
              <td style={cell}>{m.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>Live feature means</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {Object.entries(s.liveFeatureMeans).slice(0, 20).map(([k, v]) => (
            <tr key={k}><td style={cell}>{k}</td><td style={{ ...cell, textAlign: 'right' }}>{v.toFixed(3)}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
