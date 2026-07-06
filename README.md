This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Daily Data Ingestion (Cron Job)

The app includes a dedicated cron endpoint that runs the data ingestion every day:

- Endpoint: `GET /api/cron/ingest` (also accepts POST)
- It runs **incremental updates** (mode='update') and always pushes results to Supabase first.
- The dashboard (Overview + Competitor Analysis) loads **exclusively from Supabase** — never directly from live scrapes.

### Recommended: Vercel Cron Jobs (daily at 8:00 UTC)

1. Make sure `vercel.json` exists at the project root (it does in this repo).
2. It already contains a daily cron configuration:
   ```json
   {
     "crons": [
       { "path": "/api/cron/ingest", "schedule": "0 8 * * *" }
     ]
   }
   ```
3. Deploy to Vercel.
4. (Recommended) Add a `CRON_SECRET` environment variable in the Vercel dashboard.
   - Then update the path in `vercel.json` to include the secret so the cron can authenticate:
     ```json
     { "path": "/api/cron/ingest?secret=YOUR_LONG_RANDOM_SECRET", "schedule": "0 8 * * *" }
     ```
   - Or simply leave `CRON_SECRET` unset — Vercel Cron calls are trusted automatically.

You can change the schedule (cron syntax, UTC time). Example times:
- `"0 6 * * *"`  → every day at 06:00 UTC
- `"0 20 * * *"` → every day at 20:00 UTC

### Other ways to run daily

- **GitHub Actions** — create `.github/workflows/daily-ingest.yml` with a `schedule` trigger that curls your deployed URL + `?secret=...`.
- **External cron services** — cron-job.org, EasyCron, etc. (free tiers available).
- **Your own server** — add a line to crontab:
  ```
  0 8 * * * curl -s "https://your-domain.com/api/cron/ingest?secret=xxx" > /dev/null
  ```

### Local testing of the cron endpoint

```bash
# With no CRON_SECRET set in .env.local
curl http://localhost:3000/api/cron/ingest

# With CRON_SECRET set
curl "http://localhost:3000/api/cron/ingest?secret=your-secret-value"
```

Check the terminal logs for `[Ingest]`, company breakdown, and Supabase upsert activity.

The manual "Update Market Data" button in the UI is still useful for on-demand or full refreshes.
