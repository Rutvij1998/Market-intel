import Snoowrap from 'snoowrap';
import { isElectronicDeviceProtection, isLikewizeRelevant, detectCompany } from './utils';

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
}

let reddit: any = null;

async function getRedditClient() {
  if (reddit) return reddit;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  const userAgent = process.env.REDDIT_USER_AGENT || `script:likewize-market-intel:v1.0 (by /u/${username || 'unknown'})`;

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
  'rogers', 'bell', 'telus', 'fido', 'koodo', 'freedommobile', 'shaw',   // Canadian telcos - user specifically wants more from Rogers etc.
  'Newegg', 'bestbuy', 'samsung', 'target', 'verizon', 'att', 'tmobile',
  'pcmasterrace', 'techsupport', 'personalfinance', 'buildapc', 'laptops'
];

const MAX_SUB_SEARCHES = 15; // Increased to get more volume from client subs like Rogers while still respecting rate limits.

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

export async function fetchDeviceProtectionMentions(limit = 250): Promise<RawMention[]> {
  const client = await getRedditClient();
  if (!client) {
    console.log('[Reddit] No client (missing creds) — returning 0. Put full Reddit script creds in .env.local');
    return [];
  }

  const results: RawMention[] = [];
  try {
    console.log(`[Reddit] Starting BROAD device protection collection (Likewize + Asurion + Allstate + SquareTrade focus). Electronic-only, strict negative keyword exclusion. Competitor data now collected symmetrically via isElectronicDeviceProtection.`);

    // 1. Global searches for device protection companies + terms (with Reddit exclusion operators)
    // Focused on electronic device protection (phones, gadgets, electronics).
    // Strong Asurion + Allstate (primary competitors) + Likewize targeting.
    // Asurion is frequently discussed in carrier contexts (Verizon, AT&T, T-Mobile protection programs).
    const globalQueries = [
      'likewize (phone OR device OR "protection plan" OR warranty OR insurance) -health -auto -car -home -pet -travel',
      'asurion (phone OR device OR gadget OR electronics) ("protection plan" OR warranty OR insurance OR "device care" OR "phone replacement" OR claim OR denied OR replacement) -health -auto -car -home -pet -travel',
      'asurion (verizon OR att OR "at&t" OR tmobile OR "t-mobile" OR carrier) (phone OR protection OR claim OR replacement) -health -auto -car -home -pet -travel',
      '"asurion" ("accidental damage" OR "screen protection" OR "extended warranty" OR "device replacement") (phone OR device) -health -auto -car -home -pet -travel',
      'squaretrade (phone OR device OR gadget OR electronics) ("protection plan" OR warranty OR insurance) -health -auto -car -home -pet -travel',
      'allstate (phone OR device OR "protection plan" OR "device protection" OR asurion) (warranty OR insurance OR claim OR replacement) -health -auto -car -home -pet -travel',
      '"protection plan" (phone OR smartphone OR gadget OR "electronics" OR tablet OR laptop) (asurion OR squaretrade OR likewize OR allstate) -health -auto -car -home -pet',
      '("phone insurance" OR "device protection" OR "gadget warranty" OR "screen protector plan" OR "electronics warranty" OR "device replacement plan" OR "phone replacement" asurion) -health -auto -car -home -pet -travel'
    ];

    for (const q of globalQueries) {
      await waitForRateLimitIfNeeded(client, 1100);
      try {
        console.log(`[Reddit] [GLOBAL] query: ${q}`);
        let listing = await client.search({ query: q, sort: 'new', time: 'all', limit: 70 });
        let combined: any[] = [...listing];
        await waitForRateLimitIfNeeded(client, 700);
        try {
          listing = await listing.fetchMore({ amount: 45 });
          if (listing?.length) combined = combined.concat(listing);
        } catch {}
        const uniqueCombined = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(0, 90);
        console.log(`[Reddit] [GLOBAL] ${q.substring(0,40)}... : ${uniqueCombined.length} raw`);

        let fullCount = 0;
        const MAX_FULL = 50;
        for (const post of uniqueCombined) {
          const textForCheck = `${post.title || ''} ${post.selftext || ''}`;
          if (!isElectronicDeviceProtection(textForCheck)) continue; // early skip

          const hasStrong = /likewize|asurion|squaretrade|protection plan|phone insurance/i.test(textForCheck);
          // Always fetch full comments for Asurion/Likewize threads to capture official replies like Asurion_Sam
          const isTargetCompany = /asurion|likewize/i.test(textForCheck);
          const doFull = !!( (hasStrong || isTargetCompany) && fullCount < MAX_FULL );
          await processSubmission(client, post, results, undefined, doFull);
          if (doFull) { fullCount++; await waitForRateLimitIfNeeded(client, 500); }
        }
      } catch (e: any) {
        if ((e?.message || '').toLowerCase().includes('ratelimit')) console.warn('[Reddit] Rate limit global query');
      }
    }

    // 2. Search prioritized client/retailer subs for device protection terms (Likewize + competitors)
    const subsToSearch = SEARCH_SUBS.slice(0, MAX_SUB_SEARCHES);
    console.log(`[Reddit] Searching ${subsToSearch.length} client/retailer subs (Rogers, Newegg, carriers like Verizon/ATT) for device protection + competitors (Asurion/Allstate will surface in carrier discussions)...`);

    // Optimized sub searches: use Reddit's OR syntax to avoid dozens of separate expensive search() calls per sub (previously ~14 queries × 15 subs = hundreds of calls, causing extremely long run times and "Failed to fetch" on the manual update button).
    // 1-2 broader searches per sub now capture Likewize + Asurion/Allstate mentions (Asurion often discussed with carriers like Verizon/ATT that are in the sub list).
    const broadSubQuery = '(likewize OR asurion OR "protection plan" OR "phone insurance" OR "device protection" OR allstate) (phone OR device OR claim OR replacement OR warranty)';
    const protectionSubQuery = '"protection plan" OR "phone insurance" OR "device protection" OR "accidental damage" (phone OR device)';

    for (const sub of subsToSearch) {
      await waitForRateLimitIfNeeded(client, 1000);
      try {
        for (const sq of [broadSubQuery, protectionSubQuery]) {
          console.log(`[Reddit] [SUB r/${sub}] broad: ${sq.substring(0, 70)}...`);
          let listing = await client.getSubreddit(sub).search({ query: sq, sort: 'new', time: 'all', limit: 60 });
          let combined: any[] = [...listing];
          await waitForRateLimitIfNeeded(client, 600);
          try {
            listing = await listing.fetchMore({ amount: 40 });
            if (listing?.length) combined = combined.concat(listing);
          } catch {}
          const uniqueCombined = Array.from(new Map(combined.map((p: any) => [p.id, p])).values()).slice(0, 80);

          const clientName = detectClientFromSubreddit(sub);
          let fullCount = 0;
          const MAX_FULL_PER = 30;

          for (const post of uniqueCombined) {
            const textForCheck = `${(post as any).title || ''} ${(post as any).selftext || ''}`;
            if (!isElectronicDeviceProtection(textForCheck)) continue;

            const titleLower = ((post as any).title || '').toLowerCase();
            const textLower = textForCheck.toLowerCase();
            const hasKeyword = /likewize|asurion|squaretrade|allstate|protection plan|phone insurance|device protection/i.test(titleLower + ' ' + textLower);
            const hasPlanLang = /protection|warranty|insurance|claim|replacement/i.test(textLower);
            const isTargetCompany = /asurion|likewize/i.test(textLower);
            // Prioritize full thread for Asurion/Likewize to capture official support accounts like Asurion_Sam
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
    // Strict electronic device protection filter (excludes health/auto/home/pet/travel etc.)
    const deviceOnly = unique.filter(m => isElectronicDeviceProtection(`${(m as any).text || ''} ${(m as any).title || ''}`));
    console.log(`[Reddit] Complete. Device-protection only (electronic): ${deviceOnly.length} / ${unique.length} (filtered non-relevant).`);
    console.log(`[Reddit] Final rate limit: remaining=${client.ratelimitRemaining}, reset=${client.ratelimitReset}s`);

    if (deviceOnly.length === 0) console.log('[Reddit] 0 relevant device protection results.');
    return deviceOnly.slice(0, limit);
  } catch (err) {
    console.error('Reddit fetch error (partial):', err);
    const partial = Array.from(new Map(results.map(m => [m.id, m])).values()).filter(m => isElectronicDeviceProtection((m as any).text || ''));
    return partial.slice(0, limit);
  }
}

// Back-compat alias (some code may still call the old name)
export const fetchLikewizeMentions = fetchDeviceProtectionMentions;

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
    const fetched = comment.fetch ? await comment.fetch() : comment;
    const auth = fetched.author?.fetch ? await fetched.author : fetched.author;
    return auth?.name || 'unknown';
  } catch {
    return comment.author?.name || 'unknown';
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
    const isTargetCompany = /asurion|likewize/i.test(fullText);
    const shouldExpand = doFullThread || isTargetCompany;

    const client = clientFromSub || detectClientFromText(fullText + ' ' + (submission.subreddit?.display_name || ''));

    const candidate: any = {
      id: `reddit-${submission.id}`,
      text: fullText.slice(0, shouldExpand ? 1800 : 900),
      source: 'Reddit',
      url: `https://reddit.com${submission.permalink}`,
      created_at: new Date(submission.created_utc * 1000).toISOString(),
      subreddit: submission.subreddit?.display_name,
      client: client,
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
    // Keep if it is a real electronic device protection mention (supports Likewize + Asurion + Allstate + SquareTrade)
    if (isElectronicDeviceProtection(hayForFilter) || isLikewizeRelevant(candidate)) {
      results.push(candidate as any);
    }
    // (Non-matching device protection posts from our broad queries are dropped here — logged at ingest level)

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
      author: (post as any).author?.name,
      comments: [],
    };
    const hayForFilter = `${candidate.text || ''} ${(candidate as any).title || ''}`;
    if (isElectronicDeviceProtection(hayForFilter) || isLikewizeRelevant(candidate)) {
      results.push(candidate as any);
    }
  }
}

function detectClientFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('newegg')) return 'Newegg';
  if (lower.includes('best buy') || lower.includes('bestbuy')) return 'Best Buy';
  if (lower.includes('samsung')) return 'Samsung';
  if (lower.includes('apple') || lower.includes('iphone')) return 'Apple';
  if (lower.includes('dell') || lower.includes('hp') || lower.includes('asus') || lower.includes('lenovo')) return 'PC Manufacturer';
  return undefined;
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
