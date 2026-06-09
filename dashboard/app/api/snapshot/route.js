import { NextResponse } from 'next/server';
import { buildSnapshot } from '../../../lib/data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const snapshot = await buildSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}
