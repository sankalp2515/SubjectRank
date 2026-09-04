import { NextResponse } from 'next/server';

import { requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Attach an address to the visitor's existing identity, after they have a
 * comparison on screen and never before.
 *
 * This is an upgrade, not a sign-up: the anonymous uid stays the same, so the
 * comparisons the visitor already ran follow them. It does NOT sign anyone in
 * and it does not send mail, so the interface must not say that it does.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  // Deliberately permissive. The purpose is to catch a typo the person can fix,
  // not to adjudicate RFC 5322 - rejecting a valid address with a regex is worse
  // than accepting one that later bounces.
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'That does not look like an email address. Check it and try again.' },
      { status: 400 },
    );
  }

  const { data, userId } = await requestContext();

  try {
    await data.attachEmail(userId, email);
  } catch (e) {
    console.error('[account]', e);
    return NextResponse.json(
      { error: 'That address could not be saved. It may already be in use here.' },
      { status: 409 },
    );
  }

  await data.recordEvent(userId, 'account_created');
  return NextResponse.json({ ok: true });
}
