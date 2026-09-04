import 'server-only';

import { NextResponse } from 'next/server';

import { getDataLayer } from './data';
import type { DataLayer, Session } from './data/types';
import { readOrCreateSession } from './session';

/**
 * The four lines every write route opened with.
 *
 * `/api/rank`, `/api/feedback`, `/api/outcome`, `/api/event`, `/api/account` and
 * `/api/delete` all began by resolving the data layer, reading the signed cookie
 * and registering the identity, in that order — six verbatim copies of a sequence
 * whose ORDER is load-bearing. The cookie must be read before `ensureSession`,
 * because `ensureSession(isNew)` decides whether to mint an auth user from what
 * the cookie said, and `ensureSession` must run before any write, because every
 * user-scoped row carries a foreign key to that user. A seventh route written
 * from memory is a route that can get that order wrong, and the failure would be
 * a foreign-key error in production rather than a type error at build time.
 *
 * This changes no behaviour. In particular it does NOT catch: `/api/rank` wraps
 * establishment in its own try/catch and answers 503 with a specific sentence,
 * and the other routes deliberately let a failure surface as a 500. Swallowing
 * the difference here would silently rewrite five routes' error contracts, so
 * the helper throws and each route keeps the handling it has.
 */
export type RequestContext = {
  data: DataLayer;
  session: Session;
  /** The caller's stable id. Sugar for `session.userId`, which every caller wants. */
  userId: string;
};

export async function requestContext(): Promise<RequestContext> {
  const data = await getDataLayer();
  const { userId, isNew } = await readOrCreateSession();
  const session = await data.ensureSession(userId, isNew);
  return { data, session, userId: session.userId };
}

/**
 * Ownership gate for routes that attach rows to an existing comparison.
 *
 * Returns a 403 response to hand straight back, or `null` when the caller owns
 * the ranking. `/api/feedback` and `/api/outcome` both need this and both had it
 * inline, with the same sentence written out twice — and the sentence is the
 * whole security boundary: the service-role client bypasses RLS, so a guessed
 * ranking UUID was otherwise enough to attach feedback, or a reported outcome, to
 * a stranger's comparison. Those are the ground-truth labels that drive
 * retraining, so poisoning them is the highest-value thing an attacker could do
 * to this product.
 */
export async function refuseUnlessOwned(
  ctx: RequestContext,
  rankingId: string,
): Promise<NextResponse | null> {
  if (await ctx.data.ownsRanking(ctx.userId, rankingId)) return null;
  return NextResponse.json({ error: 'That comparison is not yours.' }, { status: 403 });
}
