import { NextResponse } from 'next/server';
import { fetchDeviceProtectionMentions } from '@/lib/reddit';
import { classifyWithGrok, ClassifiedMention } from '@/lib/classify';
import { supabaseAdmin } from '@/lib/supabase';
import { isElectronicDeviceProtection, detectCompany } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const rawMentions = await fetchDeviceProtectionMentions(120);

    const filtered = rawMentions.filter((raw: any) => {
      const ok = isElectronicDeviceProtection(`${raw.text || ''} ${raw.title || ''}`);
      if (!ok) console.log(`[Ingest/reddit] EXCLUDED non-device: ${raw.id}`);
      return ok;
    });

    const classified: ClassifiedMention[] = [];

    for (const raw of filtered) {
      const classification = await classifyWithGrok(raw.text, (raw as any).client);
      if (classification.is_relevant === false) continue;

      const item: ClassifiedMention = {
        id: raw.id,
        text: raw.text,
        source: raw.source,
        url: raw.url,
        created_at: raw.created_at,
        sentiment: classification.sentiment,
        pillar: classification.pillar,
        confidence: classification.confidence,
        key_issue: classification.key_issue,
        client: (raw as any).client,
        company: (classification.company as any) || detectCompany(`${raw.text} ${(raw as any).title || ''}`),
        product_type: 'electronic_device_protection',
        is_relevant: true,
        rating: (raw as any).rating,
      };

      classified.push(item);

      if (supabaseAdmin) {
        await supabaseAdmin.from('mentions').upsert(item, { onConflict: 'id' });
      }
    }

    return NextResponse.json({
      success: true,
      count: classified.length,
      mentions: classified,
      message: supabaseAdmin 
        ? 'Data classified and saved to Supabase.' 
        : 'Data classified (Supabase not configured — using in-memory for this session).',
    });
  } catch (error: any) {
    console.error('Ingest error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
