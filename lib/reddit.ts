import Snoowrap from 'snoowrap';
import { isElectronicDeviceProtection, isLikewizeRelevant, detectCompany, mentionsAsurion, hasBoostLikewizeClaimSignal } from './utils';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper for proper rate limit handling using snoowrap's exposed ratelimit info (populated from Reddit's x-ratelimit-* headers)
async function waitForRateLimitIfNeeded(client: any, minDelayMs = 1500) {
  await delay(minDelayMs); // Enforce at least 1-2s between requests as requested

  try {
    const remaining = client.ratelimitRemaining;
    const reset = client.ratelimitReset; // seconds until reset
    const used = client.ratelimitUsed;

    if (remaining !== undefined) {
      console.log(`[Reddit] Rate limit status: remaining=${remaining}, used=${used}, resetIn=${reset}s`);
      if (remaining < 5) {
        const waitMs = ((reset || 60) * 1000) + 3000; // extra buffer
        console.warn(`[Reddit] Rate limit low (remaining ${remaining}). Waiting ${Math.ceil(waitMs / 1000)}s until reset to avoid 429...`);
        await delay(waitMs);
      }
    }
  } catch (e) {
    // snoowrap may not have populated yet; fall back to minDelay
  }
}

export interface RawMention {
  id: string;
  text: string;
  source: string;
  url: string;
  created_at: string;
  subreddit?: string;
  client?: string;           // e.g. "Newegg", "Samsung", "Best Buy" — the retailer/partner the protection was sold through
  full_thread?: string;      // concatenated title + selftext + top comments for better sentiment context
  author?: string;
  comments?: Array<{ author: string; body: string; created_utc?: number }>;  // structured for support metrics
  /** Set when we intentionally keep unrestricted Asurion (or other company) posts */
  company?: 'Likewize' | 'Asurion' | 'Allstate' | 'SquareTrade' | 'Other';
  title?: string;
}

let reddit: any = null;

async function getRedditClient() {
  if (reddit) return reddit;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  const userAgent = process.env.REDDIT_USER_AGENT || `script:market-vantage:v1.0 (by /u/${username || 'unknown'})`;

  // For script apps we need all of: clientId, clientSecret, username, password
  if (!clientId || !clientSecret || !username || !password) {
    console.log('[Reddit] Missing one or more Reddit creds (clientId/secret/username/password) in .env.local → no real fetch');
    return null;
  }

  console.log(`[Reddit] Attempting to create Snoowrap with userAgent: ${userAgent}`);
  console.log(`[Reddit] Using clientId: ${clientId ? clientId.substring(0,8) + '...' : 'MISSING'}`);

  try {
    reddit = new Snoowrap({
      userAgent,
      clientId,
      clientSecret,
      username,
      password,
    });

    // IMPORTANT: Force authentication immediately.
    // The Snoowrap constructor is lazy - the password grant (which produces "Invalid grant") 
    // only happens on the FIRST real API call. Calling getMe() here makes the error happen 
    // at "client creation" time for clearer debugging.
    console.log('[Reddit] Created instance, now forcing auth test with getMe()...');
    const me = await reddit.getMe();
    console.log(`[Reddit] Snoowrap client AUTHENTICATED successfully as u/${me.name} with script credentials`);
    console.log(`[Reddit] Initial rate limit after auth: remaining=${reddit.ratelimitRemaining}, reset=${reddit.ratelimitReset}s`);

    return reddit;
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[Reddit] Failed to authenticate Snoowrap client:', msg);
    console.error('[Reddit] Full error details:', e);

    if (msg.toLowerCase().includes('grant') || msg.toLowerCase().includes('invalid_grant')) {
      console.error('================================================================================');
      console.error('[Reddit] *** INVALID GRANT ERROR DIAGNOSIS ***');
      console.error('Most likely causes (in order of probability for script apps):');
      console.error('1. 2FA is ENABLED on the Reddit account (u/' + (username || '???') + ').');
      console.error('   Password grant (used when you supply username+password) DOES NOT WORK with 2FA.');
      console.error('   FIX: Log into Reddit -> Preferences -> Privacy & Security -> turn OFF two-factor authentication.');
      console.error('   (You can turn it back on after testing, or use a dedicated throwaway account without 2FA.)');
      console.error('');
      console.error('2. The app is NOT registered as type "script".');
      console.error('   Go to https://www.reddit.com/prefs/apps');
      console.error('   Find the app with client_id starting ' + (clientId ? clientId.substring(0,8) : '???'));
      console.error('   It MUST say "script" (not "web app" or "installed app").');
      console.error('   If wrong, delete and re-create as "script" type. No redirect URI needed for script.');
      console.error('');
      console.error('3. Username or password is incorrect / has changed.');
      console.error('   Double-check REDDIT_USERNAME and REDDIT_PASSWORD in .env.local exactly match the account.');
      console.error('   Note: current password in your .env ends with @1900 or similar - verify it is current.');
      console.error('');
      console.error('4. client_id / client_secret mismatch with the app.');
      console.error('   Make sure the values in .env.local exactly match the ones shown on the app page.');
      console.error('================================================================================');
    }

    reddit = null; // don't cache a broken client
    return null;
  }
}

// Prioritized list of subreddits for quality over quantity.
// We will only search a limited number per run to avoid rate limits.
// We heavily prioritize actual client/retailer communities (Rogers, Bell, Telus, Newegg, Best Buy etc.)
// because that's where real customers discuss the Likewize protection plans they bought through those retailers.
const PARTNER_SUBS = [
  'Newegg', 'bestbuy', 'samsung', 'pcmasterrace', 'buildapc', 'techsupport',
  'personalfinance', 'CreditCards', 'legaladvice', 'Insurance',
  'phones', 'Smartphones', 'Android', 'iPhone', 'Apple',
  'target', 'walmart', 'verizon', 'tmobile', 'oneplus',
  'monitors', 'OLED', 'laptops', 'headphones', 'gadgets',
  'rogers', 'bell', 'telus', 'shaw', 'fido', 'koodo', 'freedommobile',
  'att', 'cricketwireless', 'boostmobile', 'straighttalk', 'costco', 'samsclub'
];

// These are the subs we actively search in every run. Put high-value client communities first.
const SEARCH_SUBS = [
  'rogers', 'bell', 'telus', 'fido', 'koodo', 'freedommobile', 'shaw',
  'Newegg', 'bestbuy', 'samsung', 'target', 'verizon', 'att', 'tmobile',
  'pcmasterrace', 'techsupport', 'personalfinance', 'buildapc', 'laptops'
];

const MAX_SUB_SEARCHES = 15;

function detectClientFromSubreddit(sub: string): string | undefined {
  const lower = sub.toLowerCase();
  if (lower.includes('newegg')) return 'Newegg';
  if (lower.includes('samsung') || lower.includes('galaxy')) return 'Samsung';
  if (lower.includes('apple') || lower.includes('iphone')) return 'Apple';
  if (lower.includes('bestbuy') || lower.includes('best buy')) return 'Best Buy';
  if (lower.includes('target')) return 'Target';
  if (lower.includes('walmart')) return 'Walmart';
  if (lower.includes('verizon')) return 'Verizon';
  if (lower.includes('tmobile') || lower.includes('t-mobile')) return 'T-Mobile';
  if (lower.includes('oneplus')) return 'OnePlus';
  if (lower.includes('rogers')) return 'Rogers';
  if (lower.includes('bell')) return 'Bell';
  if (lower.includes('telus')) return 'Telus';
  if (lower.includes('shaw')) return 'Shaw';
  if (lower.includes('fido')) return 'Fido';
  if (lower.includes('koodo')) return 'Koodo';
  if (lower.includes('freedom')) return 'Freedom Mobile';
  if (lower.includes('costco')) return 'Costco';
  if (lower.includes('samsclub') || lower.includes('sam\'s club')) return 'Sam\'s Club';
  if (lower.includes('att') || lower.includes('at&t')) return 'AT&T';
  if (lower.includes('cricket')) return 'Cricket Wireless';
  if (lower.includes('boost')) return 'Boost Mobile';
  if (lower.includes('straighttalk') || lower.includes('straight talk')) return 'Straight Talk';
  return undefined;
}

function haystackFromPost(post: any): string {
  return `${post?.title || ''} ${post?.selftext || ''}`;
}

/** Keep gate: Asurion = everything; others still require device-protection or Likewize relevance. */
function shouldKeepRedditMention(text: string): boolean {
  if (mentionsAsurion(text)) return true;
  if (isLikewizeRelevant({ text })) return true;
  return isElectronicDeviceProtection(text);
}

/** True Boost Mobile / Boost Protect context — not "boost" as in AMD/politics. */
function isBoostMobileContext(text: string, subreddit?: string): boolean {
  if (/boostmobile/i.test(subreddit || '')) return true;
  return /\bboost\s*mobile\b|boostmobile|\bboost\s*infinite\b|\bboost\s*protect\b/i.test(text || '');
}

/** Samsung GTP / Care+ / Galaxy trade-in — Likewize operates the portal. */
function isSamsungGtpContext(text: string, subreddit?: string): boolean {
  if (/samsung|galaxy/i.test(subreddit || '')) return true;
  return /\bsamsung\b|\bgalaxy\b|\bgtp\b|\bs2[2-9]\b/i.test(text || '');
}

export type RedditTimeFilter = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

/** Boost Mobile is a major Likewize DP client (Boost Protect). Search r/BoostMobile + global. */
async function collectBoostMobileMentions(
  client: any,
  results: RawMention[],
  timeFilter: RedditTimeFilter,
  isRecentOnly: boolean,
) {
  const subQueries = [
    'likewize',
    'claim OR claims OR "file a claim" OR "insurance claim"',
  ];
  const globalQueries = [
    'likewize ("boost mobile" OR boostmobile OR "boost infinite" OR "boost protect")',
    '("boost mobile" OR boostmobile OR "boost infinite") (likewize OR claim OR claims)',
  ];

  console.log('[Reddit] [BOOST] Collecting Boost Mobile / Boost Protect / Likewize mentions...');

  for (const q of subQueries) {
    await waitForRateLimitIfNeeded(client, 1000);
    try {
      console.log(`[Reddit] [BOOST] r/boostmobile: ${q}`);
      let listing = await client.getSubreddit('boostmobile').search({
        query: q,
        sort: 'new',
        time: timeFilter,
        limit: isRecentOnly ? 40 : 75,
      });
      let combined: any[] = [...listing];
      await waitForRateLimitIfNeeded(client, 500);
      if (!isRecentOnly) {
        try {
          listing = await listing.fetchMore({ amount: 50 });
          if (listing?.length) combined = combined.concat(listing);
        } catch {}
      }
      const unique = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(
        0,
        isRecentOnly ? 40 : 100,
      );
      let fullCount = 0;
      for (const post of unique) {
        const textForCheck = haystackFromPost(post);
        const sub = post.subreddit?.display_name || 'boostmobile';
        if (!isBoostMobileContext(textForCheck, sub)) continue;
        if (!hasBoostLikewizeClaimSignal(textForCheck)) continue;
        const doFull = fullCount < (isRecentOnly ? 15 : 40);
        await processSubmission(client, post, results, 'Boost Mobile', doFull);
        if (doFull) {
          fullCount++;
          await waitForRateLimitIfNeeded(client, 400);
        }
      }
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('ratelimit')) {
        console.warn('[Reddit] [BOOST] Rate limit on r/boostmobile');
        break;
      }
      console.log(`[Reddit] [BOOST] non-fatal r/boostmobile: ${e?.message || e}`);
    }
  }

  for (const q of globalQueries) {
    await waitForRateLimitIfNeeded(client, 1100);
    try {
      console.log(`[Reddit] [BOOST] global: ${q}`);
      let listing = await client.search({
        query: q,
        sort: 'new',
        time: timeFilter,
        limit: isRecentOnly ? 40 : 70,
      });
      let combined: any[] = [...listing];
      await waitForRateLimitIfNeeded(client, 600);
      if (!isRecentOnly) {
        try {
          listing = await listing.fetchMore({ amount: 40 });
          if (listing?.length) combined = combined.concat(listing);
        } catch {}
      }
      const unique = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(
        0,
        isRecentOnly ? 40 : 80,
      );
      let fullCount = 0;
      for (const post of unique) {
        const textForCheck = haystackFromPost(post);
        const sub = post.subreddit?.display_name || '';
        if (!isBoostMobileContext(textForCheck, sub)) continue;
        if (!hasBoostLikewizeClaimSignal(textForCheck)) continue;
        const doFull = fullCount < (isRecentOnly ? 12 : 30);
        await processSubmission(client, post, results, 'Boost Mobile', doFull);
        if (doFull) {
          fullCount++;
          await waitForRateLimitIfNeeded(client, 400);
        }
      }
    } catch (e: any) {
      if ((e?.message || '').toLowerCase().includes('ratelimit')) {
        console.warn('[Reddit] [BOOST] Rate limit on global Boost query');
      } else {
        console.log(`[Reddit] [BOOST] non-fatal global: ${e?.message || e}`);
      }
    }
  }

  const boostKept = results.filter((m) => (m.client || '').toLowerCase().includes('boost')).length;
  console.log(`[Reddit] [BOOST] Tagged ${boostKept} Boost Mobile mentions so far`);
}

const SAMSUNG_GTP_SUBS = [
  'samsung',
  'samsunggalaxy',
  'SamsungHelp',
  'GalaxyS23',
  'GalaxyS24',
  'GalaxyS25',
  'GalaxyS25Ultra',
  'GalaxyFold',
  'GalaxyWatch',
];

/** Samsung GTP portal / Care+ / trade-in — keep only posts that say Likewize. */
async function collectSamsungGtpMentions(
  client: any,
  results: RawMention[],
  timeFilter: RedditTimeFilter,
  isRecentOnly: boolean,
) {
  console.log('[Reddit] [SAMSUNG-GTP] Collecting Likewize Samsung / GTP / trade-in mentions...');

  for (const sub of SAMSUNG_GTP_SUBS) {
    await waitForRateLimitIfNeeded(client, 900);
    try {
      console.log(`[Reddit] [SAMSUNG-GTP] r/${sub}: likewize`);
      const listing = await client.getSubreddit(sub).search({
        query: 'likewize',
        sort: 'new',
        time: timeFilter,
        limit: isRecentOnly ? 25 : 50,
      });
      const unique = Array.from(new Map([...listing].map((p: any) => [p.id, p])).values()).slice(
        0,
        isRecentOnly ? 25 : 50,
      );
      let fullCount = 0;
      for (const post of unique) {
        const textForCheck = haystackFromPost(post);
        const subName = post.subreddit?.display_name || sub;
        if (!isSamsungGtpContext(textForCheck, subName)) continue;
        if (!isLikewizeRelevant({ text: textForCheck })) continue;
        const doFull = fullCount < (isRecentOnly ? 8 : 20);
        await processSubmission(client, post, results, 'Samsung', doFull);
        if (doFull) {
          fullCount++;
          await waitForRateLimitIfNeeded(client, 400);
        }
      }
    } catch (e: any) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('ratelimit')) {
        console.warn('[Reddit] [SAMSUNG-GTP] Rate limit');
        break;
      }
      console.log(`[Reddit] [SAMSUNG-GTP] non-fatal r/${sub}: ${e?.message || e}`);
    }
  }

  const globalQueries = [
    'likewize (samsung OR galaxy OR GTP)',
    'likewize (samsung OR galaxy) ("trade-in" OR tradein OR "trade in" OR repair OR battery OR claim)',
  ];
  for (const q of globalQueries) {
    await waitForRateLimitIfNeeded(client, 1100);
    try {
      console.log(`[Reddit] [SAMSUNG-GTP] global: ${q}`);
      let listing = await client.search({
        query: q,
        sort: 'new',
        time: timeFilter,
        limit: isRecentOnly ? 30 : 60,
      });
      let combined: any[] = [...listing];
      if (!isRecentOnly) {
        try {
          await waitForRateLimitIfNeeded(client, 500);
          listing = await listing.fetchMore({ amount: 30 });
          if (listing?.length) combined = combined.concat(listing);
        } catch {}
      }
      const unique = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(
        0,
        isRecentOnly ? 30 : 70,
      );
      let fullCount = 0;
      for (const post of unique) {
        const textForCheck = haystackFromPost(post);
        const subName = post.subreddit?.display_name || '';
        if (/boostmobile|fido|freedommobile|rogers|legaladvice/i.test(subName)) continue;
        if (!isSamsungGtpContext(textForCheck, subName)) continue;
        if (!isLikewizeRelevant({ text: textForCheck })) continue;
        const samsungSub = /samsung|galaxy/i.test(subName);
        if (
          !samsungSub &&
          !/\bgtp\b|\btrade[\s-]?in\b/i.test(textForCheck)
        ) {
          continue;
        }
        const doFull = fullCount < (isRecentOnly ? 10 : 25);
        await processSubmission(client, post, results, 'Samsung', doFull);
        if (doFull) {
          fullCount++;
          await waitForRateLimitIfNeeded(client, 400);
        }
      }
    } catch (e: any) {
      if ((e?.message || '').toLowerCase().includes('ratelimit')) {
        console.warn('[Reddit] [SAMSUNG-GTP] Rate limit on global');
      } else {
        console.log(`[Reddit] [SAMSUNG-GTP] non-fatal global: ${e?.message || e}`);
      }
    }
  }

  const n = results.filter((m) => (m.client || '').toLowerCase() === 'samsung').length;
  console.log(`[Reddit] [SAMSUNG-GTP] Tagged ${n} Samsung / GTP mentions so far`);
}

export async function fetchDeviceProtectionMentions(
  limit = 250,
  opts?: { time?: RedditTimeFilter },
): Promise<RawMention[]> {
  const client = await getRedditClient();
  if (!client) {
    console.log('[Reddit] No client (missing creds) — returning 0. Put full Reddit script creds in .env.local');
    return [];
  }

  const timeFilter: RedditTimeFilter = opts?.time || 'all';
  const isRecentOnly = timeFilter === 'day' || timeFilter === 'hour';

  const results: RawMention[] = [];
  try {
    console.log(
      `[Reddit] Starting collection (time=${timeFilter}): Likewize/Allstate/SquareTrade = electronic device protection; Asurion = ALL Reddit mentions (no device filter).`,
    );

    // ---------------------------------------------------------------
    // 0a. BOOST MOBILE — large DP client (Boost Protect / Likewize).
    //     Run before the heavy Asurion sweep so rate limits don't drop this account.
    // ---------------------------------------------------------------
    await collectBoostMobileMentions(client, results, timeFilter, isRecentOnly);
    await collectSamsungGtpMentions(client, results, timeFilter, isRecentOnly);

    // ---------------------------------------------------------------
    // 0. ASURION — unrestricted. Pull all Reddit posts mentioning Asurion
    //    (home, auto, phone, claims, jobs, etc.). Competitor tab needs the full picture.
    // ---------------------------------------------------------------
    const asurionQueries = [
      'asurion',
      'title:asurion',
      'asurion (claim OR claims OR denied OR replacement OR repair OR insurance OR warranty OR protection)',
      'asurion (verizon OR att OR "at&t" OR tmobile OR "t-mobile" OR "best buy" OR bestbuy OR home OR auto OR phone)',
      '"asurion_sam" OR "Asurion_Sam"',
    ];

    console.log(`[Reddit] [ASURION-ALL] Collecting unrestricted Asurion Reddit data (${asurionQueries.length} queries)...`);
    for (const q of asurionQueries) {
      await waitForRateLimitIfNeeded(client, 1100);
      try {
        console.log(`[Reddit] [ASURION-ALL] query: ${q}`);
        let listing = await client.search({ query: q, sort: 'new', time: timeFilter, limit: isRecentOnly ? 50 : 100 });
        let combined: any[] = [...listing];
        await waitForRateLimitIfNeeded(client, 700);
        if (!isRecentOnly) {
          try {
            listing = await listing.fetchMore({ amount: 100 });
            if (listing?.length) combined = combined.concat(listing);
          } catch {}
          // Also pull top posts for breadth (not only newest)
          try {
            await waitForRateLimitIfNeeded(client, 700);
            const topListing = await client.search({ query: q, sort: 'relevance', time: timeFilter, limit: 50 });
            if (topListing?.length) combined = combined.concat(topListing);
          } catch {}
        }

        const uniqueCombined = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(0, isRecentOnly ? 60 : 180);
        console.log(`[Reddit] [ASURION-ALL] ${q.substring(0, 50)}... : ${uniqueCombined.length} raw posts`);

        let fullCount = 0;
        const MAX_FULL = isRecentOnly ? 25 : 80;
        for (const post of uniqueCombined) {
          const textForCheck = haystackFromPost(post);
          // Must actually mention Asurion (skip noise from relevance search)
          if (!mentionsAsurion(textForCheck)) continue;

          const doFull = fullCount < MAX_FULL;
          await processSubmission(client, post, results, undefined, doFull);
          if (doFull) {
            fullCount++;
            await waitForRateLimitIfNeeded(client, 450);
          }
        }
      } catch (e: any) {
        if ((e?.message || '').toLowerCase().includes('ratelimit')) {
          console.warn('[Reddit] Rate limit on Asurion-all query');
        } else {
          console.log(`[Reddit] [ASURION-ALL] non-fatal: ${(e as any)?.message}`);
        }
      }
    }

    // Asurion in high-volume carrier / retail subs (still unrestricted content)
    const asurionSubs = [
      'verizon', 'tmobile', 'att', 'bestbuy', 'personalfinance',
      'Insurance', 'legaladvice', 'iphone', 'Android', 'homeowners', 'HomeImprovement',
    ];
    for (const sub of asurionSubs) {
      await waitForRateLimitIfNeeded(client, 1000);
      try {
        console.log(`[Reddit] [ASURION-ALL] sub r/${sub} search: asurion`);
        let listing = await client.getSubreddit(sub).search({
          query: 'asurion',
          sort: 'new',
          time: timeFilter,
          limit: isRecentOnly ? 40 : 75,
        });
        let combined: any[] = [...listing];
        await waitForRateLimitIfNeeded(client, 500);
        if (!isRecentOnly) {
          try {
            listing = await listing.fetchMore({ amount: 50 });
            if (listing?.length) combined = combined.concat(listing);
          } catch {}
        }
        const uniqueCombined = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(0, isRecentOnly ? 40 : 100);
        const clientName = detectClientFromSubreddit(sub);
        let fullCount = 0;
        for (const post of uniqueCombined) {
          const textForCheck = haystackFromPost(post);
          if (!mentionsAsurion(textForCheck)) continue;
          const doFull = fullCount < (isRecentOnly ? 10 : 25);
          await processSubmission(client, post, results, clientName, doFull);
          if (doFull) {
            fullCount++;
            await waitForRateLimitIfNeeded(client, 400);
          }
        }
      } catch (e: any) {
        const msg = (e?.message || '').toLowerCase();
        if (msg.includes('ratelimit')) {
          console.warn(`[Reddit] Rate on Asurion sub r/${sub}`);
          break;
        }
      }
    }

    // ---------------------------------------------------------------
    // 1. Global searches — Likewize + other competitors (device-protection focused)
    //    Asurion still included in some queries but is already covered above.
    // ---------------------------------------------------------------
    const globalQueries = [
      'likewize (phone OR device OR "protection plan" OR warranty OR insurance) -health -auto -car -home -pet -travel',
      'likewize ("boost mobile" OR boostmobile OR "boost infinite" OR "boost protect")',
      'likewize (samsung OR galaxy OR GTP OR "trade-in" OR tradein)',
      'squaretrade (phone OR device OR gadget OR electronics) ("protection plan" OR warranty OR insurance) -health -auto -car -home -pet -travel',
      'allstate (phone OR device OR "protection plan" OR "device protection") (warranty OR insurance OR claim OR replacement) -health -auto -car -home -pet -travel',
      '"protection plan" (phone OR smartphone OR gadget OR "electronics" OR tablet OR laptop) (squaretrade OR likewize OR allstate) -health -auto -car -home -pet',
      '("phone insurance" OR "device protection" OR "gadget warranty" OR "screen protector plan" OR "electronics warranty" OR "device replacement plan") (likewize OR squaretrade OR allstate) -health -auto -car -home -pet -travel',
    ];

    for (const q of globalQueries) {
      await waitForRateLimitIfNeeded(client, 1100);
      try {
        console.log(`[Reddit] [GLOBAL] query: ${q}`);
        let listing = await client.search({ query: q, sort: 'new', time: timeFilter, limit: isRecentOnly ? 40 : 70 });
        let combined: any[] = [...listing];
        await waitForRateLimitIfNeeded(client, 700);
        if (!isRecentOnly) {
          try {
            listing = await listing.fetchMore({ amount: 45 });
            if (listing?.length) combined = combined.concat(listing);
          } catch {}
        }
        const uniqueCombined = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(0, isRecentOnly ? 45 : 90);
        console.log(`[Reddit] [GLOBAL] ${q.substring(0,40)}... : ${uniqueCombined.length} raw`);

        let fullCount = 0;
        const MAX_FULL = isRecentOnly ? 20 : 50;
        for (const post of uniqueCombined) {
          const textForCheck = haystackFromPost(post);
          // Asurion always kept; others need device-protection relevance
          if (!shouldKeepRedditMention(textForCheck)) continue;

          const hasStrong = /likewize|asurion|squaretrade|boost protect|protection plan|phone insurance/i.test(textForCheck);
          const isTargetCompany = /asurion|likewize/i.test(textForCheck);
          const doFull = !!( (hasStrong || isTargetCompany) && fullCount < MAX_FULL );
          await processSubmission(client, post, results, undefined, doFull);
          if (doFull) { fullCount++; await waitForRateLimitIfNeeded(client, 500); }
        }
      } catch (e: any) {
        if ((e?.message || '').toLowerCase().includes('ratelimit')) console.warn('[Reddit] Rate limit global query');
      }
    }

    // 2. Search prioritized client/retailer subs for device protection + Asurion
    const subsToSearch = SEARCH_SUBS.slice(0, MAX_SUB_SEARCHES);
    console.log(`[Reddit] Searching ${subsToSearch.length} client/retailer subs for Likewize/device protection + Asurion...`);

    const broadSubQuery = '(likewize OR asurion OR "boost protect" OR "protection plan" OR "phone insurance" OR "device protection" OR allstate) (phone OR device OR claim OR replacement OR warranty OR insurance OR home OR auto)';
    const protectionSubQuery = '"protection plan" OR "phone insurance" OR "device protection" OR "boost protect" OR "accidental damage" OR asurion';

    for (const sub of subsToSearch) {
      await waitForRateLimitIfNeeded(client, 1000);
      try {
        for (const sq of [broadSubQuery, protectionSubQuery]) {
          console.log(`[Reddit] [SUB r/${sub}] broad: ${sq.substring(0, 70)}...`);
          let listing = await client.getSubreddit(sub).search({
            query: sq,
            sort: 'new',
            time: timeFilter,
            limit: isRecentOnly ? 30 : 60,
          });
          let combined: any[] = [...listing];
          await waitForRateLimitIfNeeded(client, 600);
          if (!isRecentOnly) {
            try {
              listing = await listing.fetchMore({ amount: 40 });
              if (listing?.length) combined = combined.concat(listing);
            } catch {}
          }
          const uniqueCombined = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(0, isRecentOnly ? 40 : 80);

          const clientName = detectClientFromSubreddit(sub);
          let fullCount = 0;
          const MAX_FULL_PER = isRecentOnly ? 12 : 30;

          for (const post of uniqueCombined) {
            const textForCheck = haystackFromPost(post);
            if (!shouldKeepRedditMention(textForCheck)) continue;

            const textLower = textForCheck.toLowerCase();
            const hasKeyword = /likewize|asurion|squaretrade|allstate|boost protect|protection plan|phone insurance|device protection/i.test(textLower);
            const hasPlanLang = /protection|warranty|insurance|claim|replacement/i.test(textLower);
            const isTargetCompany = /asurion|likewize/i.test(textLower);
            const doFull = !!((hasKeyword || (clientName && hasPlanLang) || isTargetCompany) && fullCount < MAX_FULL_PER);

            await processSubmission(client, post, results, clientName, doFull);
            if (doFull) { fullCount++; await waitForRateLimitIfNeeded(client, 400); }
          }
          await waitForRateLimitIfNeeded(client, 400);
        }
      } catch (e: any) {
        const msg = (e?.message || '').toLowerCase();
        if (msg.includes('ratelimit')) { console.warn(`[Reddit] Rate on r/${sub}`); break; }
        else console.log(`[Reddit] Non-fatal on r/${sub}: ${e?.message}`);
      }
    }

    const unique = Array.from(new Map(results.map(m => [m.id, m])).values());
    // Keep: all Asurion + electronic device protection / Likewize for everyone else
    const kept = unique.filter((m) => {
      const hay = `${(m as any).text || ''} ${(m as any).title || ''} ${(m as any).full_thread || ''}`;
      return shouldKeepRedditMention(hay);
    });

    const asurionCount = kept.filter((m) =>
      mentionsAsurion(`${(m as any).text || ''} ${(m as any).title || ''} ${(m as any).full_thread || ''}`),
    ).length;
    console.log(`[Reddit] Complete. Kept ${kept.length} / ${unique.length} (Asurion unrestricted: ${asurionCount}; others = device protection / Likewize).`);
    console.log(`[Reddit] Final rate limit: remaining=${client.ratelimitRemaining}, reset=${client.ratelimitReset}s`);

    if (kept.length === 0) console.log('[Reddit] 0 relevant results.');
    // Prefer not to hard-slice away Asurion volume — raise effective cap when Asurion-heavy
    const effectiveLimit = Math.max(limit, Math.min(kept.length, Math.max(limit, asurionCount + Math.floor(limit * 0.5))));
    return kept.slice(0, effectiveLimit);
  } catch (err) {
    console.error('Reddit fetch error (partial):', err);
    const partial = Array.from(new Map(results.map(m => [m.id, m])).values()).filter((m) => {
      const hay = `${(m as any).text || ''} ${(m as any).title || ''}`;
      return shouldKeepRedditMention(hay);
    });
    return partial.slice(0, Math.max(limit, partial.length));
  }
}

// Back-compat alias (some code may still call the old name)
export const fetchLikewizeMentions = fetchDeviceProtectionMentions;

/** Boost-only Reddit pull (Boost Protect / Likewize DP). Used by dedicated ingest. */
export async function fetchBoostMobileMentions(
  opts?: { time?: RedditTimeFilter },
): Promise<RawMention[]> {
  const client = await getRedditClient();
  if (!client) {
    console.log('[Reddit] [BOOST] No client — cannot fetch Boost Mobile mentions');
    return [];
  }
  const timeFilter: RedditTimeFilter = opts?.time || 'all';
  const isRecentOnly = timeFilter === 'day' || timeFilter === 'hour';
  const results: RawMention[] = [];
  await collectBoostMobileMentions(client, results, timeFilter, isRecentOnly);
  const unique = Array.from(new Map(results.map((m) => [m.id, m])).values());
  const kept = unique.filter((m) => {
    const hay = `${m.text || ''} ${m.title || ''}`;
    return hasBoostLikewizeClaimSignal(hay);
  });
  console.log(`[Reddit] [BOOST] fetchBoostMobileMentions kept ${kept.length} / ${unique.length}`);
  return kept;
}

/** Samsung GTP / Galaxy Care+ Reddit pull — Likewize in the post is required. */
export async function fetchSamsungGtpMentions(
  opts?: { time?: RedditTimeFilter },
): Promise<RawMention[]> {
  const client = await getRedditClient();
  if (!client) {
    console.log('[Reddit] [SAMSUNG-GTP] No client — cannot fetch');
    return [];
  }
  const timeFilter: RedditTimeFilter = opts?.time || 'all';
  const isRecentOnly = timeFilter === 'day' || timeFilter === 'hour';
  const results: RawMention[] = [];
  await collectSamsungGtpMentions(client, results, timeFilter, isRecentOnly);
  const unique = Array.from(new Map(results.map((m) => [m.id, m])).values());
  const kept = unique.filter((m) => {
    const hay = `${m.text || ''} ${m.title || ''}`;
    const sub = m.subreddit || '';
    return isSamsungGtpContext(hay, sub) && isLikewizeRelevant({ text: hay });
  });
  console.log(`[Reddit] [SAMSUNG-GTP] fetchSamsungGtpMentions kept ${kept.length} / ${unique.length}`);
  return kept;
}

// Note: limit is the final cap returned to ingestion. We now fetch wider in client subs to surface more Rogers-style mentions.


// Helper to fetch full thread context + enrich with client
// doFullThread: fetch full (post + top comments) for high-signal posts (title has company/protection keyword
// or from client/retailer sub + plan language). This gives rich context for sentiment + pillar classification
// for BOTH Likewize AND competitors (Asurion, Allstate, SquareTrade).
function toCommentArray(comments: any): any[] {
  if (!comments) return [];
  if (Array.isArray(comments)) return comments;
  if (typeof comments[Symbol.iterator] === 'function') return [...comments];
  if (typeof comments.length === 'number') return Array.from(comments);
  return [];
}

async function resolveCommentAuthor(comment: any): Promise<string> {
  try {
    // Fast path — snoowrap usually has author.name after expandReplies without extra fetch
    if (typeof comment.author === 'string' && comment.author) return comment.author;
    if (comment.author?.name) return comment.author.name;
    const fetched = comment.fetch ? await comment.fetch() : comment;
    if (typeof fetched.author === 'string') return fetched.author;
    if (fetched.author?.name) return fetched.author.name;
    return 'unknown';
  } catch {
    return comment.author?.name || (typeof comment.author === 'string' ? comment.author : 'unknown');
  }
}

/** Flatten top-level + nested replies so official accounts like Asurion_Sam are not missed. */
async function collectCommentTree(commentsListing: any, maxComments = 100): Promise<Array<{ author: string; body: string; created_utc?: number }>> {
  const out: Array<{ author: string; body: string; created_utc?: number }> = [];
  const comments = await commentsListing;

  async function walk(nodes: any) {
    if (out.length >= maxComments) return;
    for (const item of toCommentArray(nodes)) {
      if (out.length >= maxComments) break;
      try {
        const c = item.fetch ? await item.fetch() : item;
        const body = (c.body || '').trim();
        if (body.length > 2) {
          const author = await resolveCommentAuthor(c);
          out.push({ author, body, created_utc: c.created_utc });
        }
        if (c.replies?.length) await walk(c.replies);
      } catch {
        // skip broken comment nodes
      }
    }
  }

  await walk(comments);
  return out;
}

// We keep a post if it passes the strict electronic device protection filter (phones/gadgets/electronics plans).
// This ensures competitor data (Asurion claims in r/verizon etc., Allstate device protection) is collected
// symmetrically to Likewize data. The old Likewize-only gate has been removed.
async function processSubmission(redditClient: any, post: any, results: RawMention[], clientFromSub?: string, doFullThread = true) {
  try {
    const submission = await redditClient.getSubmission(post.id);
    await submission.fetch();

    let fullText = `${submission.title}\n${submission.selftext || ''}`;
    const isAsurionPost = mentionsAsurion(fullText);
    const isTargetCompany = isAsurionPost || /likewize/i.test(fullText);
    // Always expand Asurion threads so Asurion_Sam replies are captured when present
    const shouldExpand = doFullThread || isTargetCompany || isAsurionPost;

    const client = clientFromSub || detectClientFromText(fullText + ' ' + (submission.subreddit?.display_name || ''));

    const candidate: any = {
      id: `reddit-${submission.id}`,
      text: fullText.slice(0, shouldExpand ? 1800 : 900),
      source: 'Reddit',
      url: `https://reddit.com${submission.permalink}`,
      created_at: new Date(submission.created_utc * 1000).toISOString(),
      subreddit: submission.subreddit?.display_name,
      client: client,
      title: submission.title,
      full_thread: shouldExpand ? fullText : undefined,
      author: submission.author?.name || (post as any).author?.name,
    };

    if (shouldExpand) {
      // Always expand Asurion/Likewize threads deeply to capture official support accounts (e.g. Asurion_Sam).
      await submission.expandReplies({ limit: isTargetCompany ? 120 : 40, depth: isTargetCompany ? 8 : 4 });

      const commentMeta = await collectCommentTree(submission.comments, isTargetCompany ? 100 : 40);
      const topComments = commentMeta
        .filter((c) => c.body.length > 10)
        .map((c) => `u/${c.author}: ${c.body}`);

      if (topComments.length > 0) {
        fullText += '\n\nComments:\n' + topComments.join('\n---\n');
      }
      candidate.full_thread = fullText;
      candidate.comments = commentMeta;
    }

    const hayForFilter = `${candidate.text || ''} ${(candidate as any).title || ''} ${candidate.full_thread || ''}`;
    // Asurion: keep everything. Others: device protection or Likewize only.
    if (shouldKeepRedditMention(hayForFilter)) {
      if (mentionsAsurion(hayForFilter)) {
        candidate.company = 'Asurion';
      }
      results.push(candidate as any);
    }

  } catch (e) {
    // Fallback to basic post data
    const client = clientFromSub || detectClientFromText(post.title + ' ' + (post.selftext || ''));
    const candidate: any = {
      id: `reddit-${post.id}`,
      text: `${post.title}\n${post.selftext || ''}`.slice(0, 800),
      source: 'Reddit',
      url: `https://reddit.com${post.permalink}`,
      created_at: new Date(post.created_utc * 1000).toISOString(),
      subreddit: post.subreddit?.display_name,
      client: client,
      title: post.title,
      author: (post as any).author?.name,
      comments: [],
    };
    const hayForFilter = `${candidate.text || ''} ${(candidate as any).title || ''}`;
    if (shouldKeepRedditMention(hayForFilter)) {
      if (mentionsAsurion(hayForFilter)) {
        candidate.company = 'Asurion';
      }
      results.push(candidate as any);
    }
  }
}

function detectClientFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\bboost\s*mobile\b|boostmobile|\bboost\s*infinite\b|\bboost\s*protect\b/.test(lower)) {
    return 'Boost Mobile';
  }
  if (lower.includes('newegg')) return 'Newegg';
  if (lower.includes('best buy') || lower.includes('bestbuy')) return 'Best Buy';
  if (/\bsamsung\b|\bgalaxy\b|\bgtp\b/.test(lower)) return 'Samsung';
  if (lower.includes('apple') || lower.includes('iphone')) return 'Apple';
  if (lower.includes('dell') || lower.includes('hp') || lower.includes('asus') || lower.includes('lenovo')) return 'PC Manufacturer';
  return undefined;
}

/**
 * Pull Asurion_Sam's own Reddit comment history and index by parent post id.
 * This is the reliable way to attribute official replies — we don't depend on
 * having expanded every Asurion thread's comment tree during scrape.
 *
 * Returns Map keyed by `reddit-<submissionId>` → list of Sam comments on that post.
 */
export async function fetchAsurionSamReplyIndex(maxComments = 900): Promise<
  Map<string, Array<{ author: string; body: string; created_utc?: number }>>
> {
  const index = new Map<string, Array<{ author: string; body: string; created_utc?: number }>>();
  const client = await getRedditClient();
  if (!client) {
    console.log('[Reddit][Asurion_Sam] No Reddit client — cannot fetch Sam comment history');
    return index;
  }

  try {
    console.log(`[Reddit][Asurion_Sam] Fetching comment history for u/Asurion_Sam (up to ${maxComments})...`);
    await waitForRateLimitIfNeeded(client, 1000);
    const user = client.getUser('Asurion_Sam');

    // Collect pages via after/cursor style until cap
    const byId = new Map<string, any>();
    let listing: any = await user.getComments({ limit: 100 });
    for (const c of listing || []) {
      if (c?.id) byId.set(c.id, c);
    }

    for (let page = 0; page < 20 && byId.size < maxComments; page++) {
      const before = byId.size;
      await waitForRateLimitIfNeeded(client, 900);
      try {
        listing = await listing.fetchMore({ amount: 100, skipReplies: true, append: true });
        for (const c of listing || []) {
          if (c?.id) byId.set(c.id, c);
        }
      } catch (e: any) {
        console.log(`[Reddit][Asurion_Sam] fetchMore stopped: ${(e?.message || '').slice(0, 80)}`);
        break;
      }
      if (byId.size <= before) break; // no new comments
      console.log(`[Reddit][Asurion_Sam] page ${page + 1}: ${byId.size} comments so far`);
    }

    // Also try search as a second source (finds more historical hits sometimes)
    try {
      await waitForRateLimitIfNeeded(client, 1000);
      const searchHits = await client.search({
        query: 'author:Asurion_Sam',
        sort: 'new',
        time: 'all',
        limit: 100,
      });
      // search returns posts, not comments — skip; use comment listing only
      void searchHits;
    } catch {
      // ignore
    }

    const comments = Array.from(byId.values()).slice(0, maxComments);
    console.log(`[Reddit][Asurion_Sam] Got ${comments.length} unique comments from u/Asurion_Sam`);

    for (const c of comments) {
      try {
        // link_id is like t3_abc123 (the submission)
        const linkId = String(c.link_id || c.linkId || c.link_url || '')
          .replace(/^t3_/, '')
          .replace(/.*\/comments\/([a-z0-9]+).*/i, '$1');
        // Prefer link_id
        let postId = String(c.link_id || '').replace(/^t3_/, '');
        if (!postId && c.link_url) {
          const m = String(c.link_url).match(/\/comments\/([a-z0-9]+)/i);
          if (m) postId = m[1];
        }
        if (!postId) continue;
        const key = `reddit-${postId}`;
        const author =
          (typeof c.author === 'string' ? c.author : c.author?.name) || 'Asurion_Sam';
        const entry = {
          author,
          body: String(c.body || '').slice(0, 1500),
          created_utc: typeof c.created_utc === 'number' ? c.created_utc : undefined,
        };
        if (!index.has(key)) index.set(key, []);
        index.get(key)!.push(entry);
      } catch {
        // skip bad comment
      }
    }

    console.log(`[Reddit][Asurion_Sam] Indexed official replies on ${index.size} unique threads`);
  } catch (e: any) {
    console.error('[Reddit][Asurion_Sam] Failed to fetch comment history:', e?.message || e);
  }

  return index;
}

/**
 * Ensure every post that Asurion_Sam replied to exists as an Asurion mention in results
 * (so official-support metrics include those threads even if our scrape missed them).
 */
export async function hydrateAsurionSamParentThreads(
  samIndex: Map<string, Array<{ author: string; body: string; created_utc?: number }>>,
  existingIds: Set<string>,
  maxNew = 80,
): Promise<RawMention[]> {
  const client = await getRedditClient();
  if (!client || !samIndex.size) return [];

  const out: RawMention[] = [];
  const missing = Array.from(samIndex.keys()).filter((id) => !existingIds.has(id)).slice(0, maxNew);
  console.log(`[Reddit][Asurion_Sam] Hydrating ${missing.length} parent threads Sam replied to (not already in scrape)...`);

  for (const redditId of missing) {
    const postId = redditId.replace(/^reddit-/, '');
    try {
      await waitForRateLimitIfNeeded(client, 1000);
      const submission = await client.getSubmission(postId).fetch();
      const title = submission.title || '';
      const selftext = submission.selftext || '';
      const fullText = `${title}\n${selftext}`;
      const samComments = samIndex.get(redditId) || [];
      const commentLines = samComments.map((c) => `u/${c.author}: ${c.body}`);
      const full_thread =
        fullText + (commentLines.length ? `\n\nComments:\n${commentLines.join('\n---\n')}` : '');

      out.push({
        id: redditId,
        text: fullText.slice(0, 1800),
        source: 'Reddit',
        url: `https://reddit.com${submission.permalink}`,
        created_at: new Date(submission.created_utc * 1000).toISOString(),
        subreddit: submission.subreddit?.display_name,
        client: detectClientFromSubreddit(submission.subreddit?.display_name || '') ||
          detectClientFromText(fullText),
        full_thread,
        author: submission.author?.name,
        comments: samComments,
        company: 'Asurion',
        title,
      });
    } catch (e: any) {
      console.log(`[Reddit][Asurion_Sam] skip ${redditId}: ${(e?.message || '').slice(0, 60)}`);
    }
  }

  console.log(`[Reddit][Asurion_Sam] Hydrated ${out.length} parent threads into Asurion corpus`);
  return out;
}

/** Re-fetch comment tree for an existing Reddit post (used to backfill Asurion_Sam detection). */
export async function refreshRedditThreadComments(redditPostId: string): Promise<{
  comments: Array<{ author: string; body: string; created_utc?: number }>;
  full_thread: string;
} | null> {
  const client = await getRedditClient();
  if (!client) return null;

  const id = redditPostId.replace(/^reddit-/, '');
  try {
    await waitForRateLimitIfNeeded(client, 1100);
    const submission = await client.getSubmission(id).fetch();
    let fullText = `${submission.title}\n${submission.selftext || ''}`;
    const isTargetCompany = /asurion|likewize/i.test(fullText);

    await submission.expandReplies({ limit: isTargetCompany ? 120 : 60, depth: 8 });
    const commentMeta = await collectCommentTree(submission.comments, 100);
    const topComments = commentMeta
      .filter((c) => c.body.length > 10)
      .map((c) => `u/${c.author}: ${c.body}`);

    if (topComments.length > 0) {
      fullText += '\n\nComments:\n' + topComments.join('\n---\n');
    }

    return { comments: commentMeta, full_thread: fullText };
  } catch (e: any) {
    console.log(`[Reddit] refresh comments failed for ${id}: ${e?.message || e}`);
    return null;
  }
}

// No demo/synthetic data. Only real Reddit results (or empty).
// All data comes from real snoowrap searches + getNew scans with full thread expansion for client context (e.g. Newegg).

/**
 * Extract a Reddit submission id (e.g. "1abcxyz") from a mention id or URL.
 */
export function extractRedditSubmissionId(opts: {
  id?: string | null;
  url?: string | null;
}): string | null {
  const tryId = (raw?: string | null): string | null => {
    if (!raw) return null;
    let s = String(raw).trim();
    // skip UUIDs (Supabase row ids)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return null;
    s = s.replace(/^t3_/, '').replace(/^reddit-/, '');
    // bare base36 reddit ids
    if (/^[a-z0-9]{5,10}$/i.test(s)) return s.toLowerCase();
    return null;
  };

  const fromId = tryId(opts.id);
  if (fromId) return fromId;

  const url = String(opts.url || '').trim();
  if (!url) return null;

  const patterns = [
    /reddit\.com\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)/i,
    /reddit\.com\/comments\/([a-z0-9]+)/i,
    /redd\.it\/([a-z0-9]+)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}

export type PostRedditReplyResult =
  | {
      ok: true;
      submissionId: string;
      commentId: string;
      permalink: string;
      username: string;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Post a top-level comment on a Reddit submission as the configured script user.
 */
export async function postRedditReply(opts: {
  submissionId: string;
  body: string;
}): Promise<PostRedditReplyResult> {
  const body = String(opts.body || '').trim();
  if (!body) return { ok: false, error: 'Reply text is empty' };
  if (body.length > 10000) return { ok: false, error: 'Reply is too long for Reddit (max ~10k chars)' };

  const submissionId = String(opts.submissionId || '')
    .replace(/^t3_/, '')
    .replace(/^reddit-/, '')
    .trim();
  if (!submissionId) return { ok: false, error: 'Missing Reddit post id' };

  const client = await getRedditClient();
  if (!client) {
    return {
      ok: false,
      error:
        'Reddit credentials not configured (REDDIT_CLIENT_ID / SECRET / USERNAME / PASSWORD). Cannot post.',
    };
  }

  try {
    await waitForRateLimitIfNeeded(client, 800);
    let meName = process.env.REDDIT_USERNAME || 'unknown';
    try {
      const me = await client.getMe();
      if (me?.name) meName = me.name;
    } catch {
      /* use env username */
    }

    const submission = client.getSubmission(submissionId);
    // Snoowrap reply returns a Comment thenable
    const comment: any = await (submission as any).reply(body);
    let commentId = String(comment?.id || comment?.name || '').replace(/^t1_/, '');
    let permalinkPath = comment?.permalink ? String(comment.permalink) : '';

    try {
      if (comment?.fetch) {
        const full = await comment.fetch();
        if (full?.id) commentId = String(full.id).replace(/^t1_/, '');
        if (full?.permalink) permalinkPath = String(full.permalink);
      }
    } catch {
      /* optional enrich */
    }

    if (!commentId) {
      return { ok: false, error: 'Reddit accepted the request but no comment id was returned' };
    }

    const permalink = permalinkPath
      ? permalinkPath.startsWith('http')
        ? permalinkPath
        : `https://www.reddit.com${permalinkPath}`
      : `https://www.reddit.com/comments/${submissionId}/_/${commentId}/`;

    console.log(`[Reddit] Posted comment ${commentId} as u/${meName} on ${submissionId}`);
    return {
      ok: true,
      submissionId,
      commentId,
      permalink,
      username: meName,
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[Reddit] post reply failed:', msg);
    // Common Reddit errors
    if (/THREAD_LOCKED|locked/i.test(msg)) {
      return { ok: false, error: 'This thread is locked — Reddit will not accept new comments.' };
    }
    if (/ARCHIVED|archived/i.test(msg)) {
      return { ok: false, error: 'This post is archived — comments are closed.' };
    }
    if (/RATELIMIT|rate limit/i.test(msg)) {
      return { ok: false, error: 'Reddit rate limit — wait a few minutes and try again.' };
    }
    if (/403|USER_REQUIRED|401|Invalid grant/i.test(msg)) {
      return {
        ok: false,
        error: 'Reddit auth failed. Check REDDIT_USERNAME/PASSWORD and that the app is type "script".',
      };
    }
    return { ok: false, error: msg.slice(0, 240) };
  }
}
