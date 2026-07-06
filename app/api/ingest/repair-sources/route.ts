import { NextResponse } from 'next/server';
import { repairMislabeledSources } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const fast = url.searchParams.get('fast') === '1';
    await repairMislabeledSources({ skipBackfill: fast });
    return NextResponse.json({ success: true, fast });
  } catch (error: any) {
    console.error('[repair-sources] error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}