import fs from 'fs';
import { NextResponse } from 'next/server';
import { getPvpRewardImage } from '../../../../lib/data';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const image = getPvpRewardImage();
  if (!image) {
    return NextResponse.json({ error: 'Reward trend image not found' }, { status: 404 });
  }

  return new NextResponse(fs.readFileSync(image.filePath), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(image.size),
      'Cache-Control': 'no-store'
    }
  });
}
