// The streak-break reminder, at 20:00 PKT — late enough to mean something, early
// enough that there is still an evening to walk in.
//
// §9.6: errors and nudges say what happened and what to do. "Walk 1,400 more
// steps to keep it" beats "Don't lose your streak!".
import { serviceClient, json } from '../_shared/supabase.ts';
import { sendPush, formatCount, type PushMessage } from '../_shared/push.ts';

interface Row {
  user_id: string;
  streak_days: number;
  token: string;
  platform: string;
  locale: string;
}

Deno.serve(async () => {
  const db = serviceClient();

  const { data, error } = await db.rpc('streaks_at_risk');
  if (error) {
    console.error('streaks_at_risk failed', error);
    return json({ error: 'unavailable' }, 503);
  }

  const rows: Row[] = data ?? [];
  if (rows.length === 0) return json({ sent: 0, considered: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const messages: PushMessage[] = rows.map((r) => ({
    to: r.token,
    ...(r.locale === 'ur' ? urdu(r.streak_days) : english(r.streak_days)),
    data: { screen: 'steps' },
  }));

  const outcome = await sendPush(messages);

  await db.from('notifications_sent').upsert(
    rows.map((r) => ({ user_id: r.user_id, kind: 'streak_at_risk', key: today })),
    { onConflict: 'user_id,kind,key', ignoreDuplicates: true },
  );

  if (outcome.invalidTokens.length > 0) {
    await db.from('push_tokens').delete().in('token', outcome.invalidTokens);
  }

  return json({ considered: rows.length, ...outcome });
});

function english(days: number) {
  return {
    title: `Your ${formatCount(days)}-day streak ends tonight`,
    body: 'Walk 5,000 steps today to keep it going.',
  };
}

function urdu(days: number) {
  return {
    title: `آپ کا ${formatCount(days)} دن کا سلسلہ آج رات ختم ہو رہا ہے`,
    body: 'اسے جاری رکھنے کے لیے آج 5,000 قدم چلیں۔',
  };
}
