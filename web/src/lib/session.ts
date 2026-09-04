import 'server-only';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Session identity, carried in a signed httpOnly cookie.
 *
 * This replaces an earlier design that called `supabase.auth.signInAnonymously()`
 * on the shared service-role client. That was wrong in three compounding ways, and
 * all three are worth naming because they are easy to reintroduce:
 *
 *   1. supabase-js prefers a live session token over the API key, so the first
 *      sign-in silently downgraded the service-role client to an anonymous user
 *      for the life of the process - RLS then applied exactly where the code
 *      assumed it did not.
 *   2. The client is a cached singleton, so two concurrent requests raced: request
 *      B's sign-in replaced A's identity between A establishing a session and A
 *      writing its rows.
 *   3. Nothing ever *read* an existing session, so every request minted a new user.
 *      The rate limiter counted rows for a user id created microseconds earlier and
 *      therefore never fired.
 *
 * A cookie is the boring, correct answer: the identity is stable across requests,
 * belongs to one browser, and is never entangled with the database client.
 */

const COOKIE = 'sr_sid';
const MAX_AGE = 60 * 60 * 24 * 365;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET is not set. Without it session cookies cannot be signed and ' +
      'anyone could forge another visitor\'s identity. Set it in the Vercel ' +
      'environment (MORNING.md step 5).',
    );
  }
  // Development only, and deliberately per-process: a hardcoded fallback that
  // shipped would be worse than no signature at all.
  return DEV_SECRET;
}
const DEV_SECRET = randomUUID();

const sign = (id: string) => createHmac('sha256', secret()).update(id).digest('base64url');

function verify(value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = sign(id);
  // Constant-time: a length-sensitive comparison leaks how much of a forged MAC
  // was right, one byte at a time.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export type SessionInfo = { userId: string; isNew: boolean };

/**
 * Read the caller's session, minting one if this is their first request.
 *
 * Returns `isNew` so the caller can decide whether a fresh auth user row is
 * needed - creating one per request is what made the rate limiter useless.
 */
export async function readOrCreateSession(): Promise<SessionInfo> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const id = verify(raw);
    if (id) return { userId: id, isNew: false };
    // Present but unverifiable: treat as absent rather than trusting it.
  }

  const id = randomUUID();
  jar.set(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
  return { userId: id, isNew: true };
}

/** True when the caller holds the admin token. See the note in app/admin/page.tsx. */
export async function isAdmin(): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  // No token configured means no admin access, in every environment. Failing
  // closed is the only safe default for a route that renders other people's text.
  if (!expected) return false;

  const jar = await cookies();
  const given = jar.get('sr_admin')?.value;
  if (!given) return false;

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
