import { NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = (body.mode === 'full' ? 'full' : 'update') as 'full' | 'update';

    // Fire-and-forget the heavy work (Reddit searches + HF+rule classification + Supabase upserts can take 30s–several minutes).
    // We return immediately so the client fetch doesn't time out or get "Failed to fetch".
    // The work continues in the background on the server process.
    // EVERY item is upserted to Supabase inside runIngestion (using supabaseAdmin).
    // Progress, HF classification logs, and final company breakdown are printed to the terminal.
    // IMPORTANT: The dashboard will only see the new data after an explicit "Refresh from Database".
    // This is the strict "push to Supabase first, then dashboard loads from Supabase" contract.
    runIngestion({ mode })
      .then((result) => {
        console.log('[Ingest API] Background ingestion completed:', result.message || `count=${result.count}`);
      })
      .catch((err) => {
        console.error('[Ingest API] Background ingestion failed:', err?.message || err);
      });

    return NextResponse.json({
      success: true,
      started: true,
      mode,
      sources: { reddit: 0, pissedconsumer: 0 },
      message: 'Data sync started in background. Monitor server console for progress. New records are saved to the database. Click "Refresh from Database" to load the latest results.'
    });
  } catch (error: any) {
    console.error('Reddit ingest error (startup):', error);
    return NextResponse.json({ success: false, error: error.message || 'Failed to start ingestion' }, { status: 500 });
  }
}
