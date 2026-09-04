import { NextResponse } from 'next/server';
import { requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One click. The other half of telling people their lines become training data. */
export async function POST() {
  const { data, userId } = await requestContext();
  const deleted = await data.deleteMyData(userId);
  return NextResponse.json({ ok: true, deleted });
}
