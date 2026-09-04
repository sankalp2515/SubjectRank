import { NextResponse } from 'next/server';
import { isEventName } from '@/lib/data';
import { requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const name = new URL(req.url).searchParams.get('name');
  // Closed enum: an unknown event name is dropped rather than recorded, so the
  // funnel cannot be polluted by anything but a deliberate code change. The list
  // lives in lib/data/types beside the EventName union it now defines, so the
  // runtime guard and the type cannot drift apart.
  // 204 must not carry a body - `new Response(body, {status: 204})` throws, which
  // turned the documented silent drop into a 500 plus a logged stack.
  if (!isEventName(name)) return new NextResponse(null, { status: 204 });

  const { data, userId } = await requestContext();
  await data.recordEvent(userId, name);
  return NextResponse.json({ ok: true });
}
