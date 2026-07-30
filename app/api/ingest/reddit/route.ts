import { NextResponse } from 'next/server';
import { fetchDeviceProtectionMentions } from '@/lib/reddit';
import { classifyWithGrok, ClassifiedMention } from '@/lib/classify';
import { supabaseAdmin } from '@/lib/supabase';
import { isElectronicDeviceProtection, detectCompany, mentionsAsurion } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const rawMentions = await fetchDeviceProtectionMentions(400);

    // Asurion: keep all Reddit topics. Others: electronic device protection only.
    const filtered = rawMentions.filter((raw: any) => {
      const hay = `${raw.text || ''} ${raw.title || ''}`;
      if (mentionsAsurion(hay) || raw.company === 'Asurion') return true;
      const ok = isElectronicDeviceProtection(hay);
      if (!ok) console.log(`[Ingest/reddit] EXCLUDED non-device: ${raw.id}`);
      return ok;
    });

    const classified: ClassifiedMention[] = [];

    for (const raw of filtered) {
      const hay = `${raw.text || ''} ${(raw as any).title || ''}`;
      const isAsurion = mentionsAsurion(hay) || raw.company === 'Asurion';
      const classification = await classifyWithGrok(raw.text, (raw as any).client);
      if (!isAsurion && classification.is_relevant === false) continue;

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
        company: isAsurion
          ? 'Asurion'
          : ((classification.company as any) || detectCompany(hay)),
        product_type: isAsurion && !isElectronicDeviceProtection(hay)
          ? 'other'
          : 'electronic_device_protection',
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
