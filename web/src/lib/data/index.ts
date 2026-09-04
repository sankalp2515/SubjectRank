/**
 * The swap is this file.
 *
 * Tonight there are no Supabase credentials, so the app runs against an in-memory
 * layer. In the morning the environment variables appear and the same interface is
 * satisfied by Postgres - no component, route or page changes.
 *
 * Deliberately explicit rather than clever: if the Supabase env vars are present we
 * use Postgres, otherwise memory, and the choice is logged once at startup so
 * nobody is ever unsure which one is live.
 */
import type { DataLayer } from './types';
import { MockDataLayer } from './mock';

export * from './types';

let instance: DataLayer | null = null;

export async function getDataLayer(): Promise<DataLayer> {
  if (instance) return instance;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let made: DataLayer;
  if (url && serviceKey) {
    const { SupabaseDataLayer } = await import('./supabase');
    made = new SupabaseDataLayer(url, serviceKey);
  } else {
    made = new MockDataLayer();
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[data] No Supabase credentials - running on the in-memory layer. ' +
        'Nothing is persisted. This is expected before the morning checklist ' +
        '(MORNING.md step 4) and a misconfiguration afterwards.',
      );
    }
  }
  instance = made;
  return made;
}
