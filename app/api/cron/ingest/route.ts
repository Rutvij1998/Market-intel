import { NextResponse } from 'next/server';
import { runIngestion } from '@/lib/ingest';

export const dynamic = 'force-dynamic';

// Cron endpoint for daily background data collection (Reddit + Trustpilot + BBB).
// Always performs incremental 'update' ingestion and writes results to Supabase first.
// The UI (both Overview and Competitor tabs) loads exclusively from Supabase via loadFromSupabase().
//
// Authentication:
// - If CRON_SECRET is set in the environment, the request must include it via
//     Authorization: Bearer <value>
//   or
//     ?secret=<value>
// - If CRON_SECRET is not set, any call is allowed (simple for Vercel Cron + local testing).
//
// Setting up a daily cron job ("every day"):
//   Best option: Vercel Cron Jobs (recommended if you deploy to Vercel)
//     - Add a vercel.json with a "crons" array (one is already created in this project).
//     - Example schedule for every day at 08:00 UTC:
//         "crons": [ { "path": "/api/cron/ingest", "schedule": "0 8 * * *" } ]
//     - To use authentication, put the secret in the path:
//         "path": "/api/cron/ingest?secret=YOUR_CRON_SECRET_VALUE"
//     - Or simply omit CRON_SECRET from production env vars (Vercel trusts its own cron calls).
//
//   Other options (works with any host):
//     - GitHub Actions scheduled workflow that does a curl to your deployed URL + secret.
//     - Free services like https://cron-job.org
//     - Your own server / VPS crontab: 0 8 * * * curl -s "https://your-domain/api/cron/ingest?secret=xxx"
//
// Local testing:
//   curl http://localhost:3000/api/cron/ingest
//   (or with ?secret= if you set CRON_SECRET in .env.local)
//
// The endpoint always uses mode: 'update'. Use the dashboard button for occasional full refreshes.

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    const querySecret = new URL(request.url).searchParams.get('secret');
    const provided = authHeader?.replace('Bearer ', '') || querySecret;

    if (provided !== cronSecret) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  try {
    // For scheduled cron, use 'update' mode for incremental collection.
    const result = await runIngestion({ mode: 'update' });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Cron ingest error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Also support POST for flexibility
export async function POST(request: Request) {
  return GET(request);
}
