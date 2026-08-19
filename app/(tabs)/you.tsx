import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Temperature, useTheme } from '../../src/theme/ThemeContext';
import { Screen } from '../../src/components/Screen';
import { CoinHeader } from '../../src/components/CoinHeader';
import { space, radius, MIN_TAP } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { useI18n } from '../../src/i18n';
import { useAppState } from '../../src/data/AppState';
import * as api from '../../src/data/api';
import { usingDemoData } from '../../src/data/api';
import { formatCoins } from '../../src/lib/format';

export default function YouScreen() {
  return (
    <Temperature mode="earning">
      <YouBody />
    </Temperature>
  );
}

function YouBody() {
  const theme = useTheme();
  const { t, lang, setLang } = useI18n();
  const { balance } = useAppState();

  return (
    <>
      <CoinHeader balance={balance} title={t.you.title} />
      <Screen>
        <Text style={[text.label, { color: theme.textMuted, marginTop: space.xl }]}>
          {t.you.howItWorks}
        </Text>

        {/* §4: the earning rate is a promise we keep forever, so it is stated
            plainly. The coin-to-rupee rate is NOT here and never will be — it is
            ours to tune weekly, and publishing it would make every tuning feel
            like a cut. */}
        <View style={[styles.card, { backgroundColor: theme.raised, borderColor: theme.coin }]}>
          <Text style={[text.coinLarge, { color: theme.coin }]}>{t.you.theRate}</Text>
          <Text style={[text.body, { color: theme.textMuted, marginTop: space.sm }]}>
            {t.you.theRule}
          </Text>
        </View>

        <RewardedVideo />
        <Referrals />

        <Text style={[text.label, { color: theme.textMuted, marginTop: space.xxl }]}>
          {t.you.language}
        </Text>
        <View style={styles.langs}>
          {(['en', 'ur'] as const).map((l) => (
            <Pressable
              key={l}
              onPress={() => setLang(l)}
              accessibilityRole="radio"
              accessibilityState={{ selected: lang === l }}
              style={({ pressed }) => [
                styles.lang,
                {
                  borderColor: lang === l ? theme.coin : theme.line,
                  backgroundColor: theme.raised,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[text.body, { color: lang === l ? theme.text : theme.textMuted }]}>
                {l === 'en' ? t.you.english : t.you.urdu}
              </Text>
            </Pressable>
          ))}
        </View>

        {usingDemoData ? (
          <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.xxxl }]}>
            Running on demo data — no Supabase project is configured yet.
            See HUMAN_TASKS.md.
          </Text>
        ) : null}
      </Screen>
    </>
  );
}

/**
 * §7.8 — the ONLY ad surface in the app.
 *
 * It lives here, in the earning half, and nowhere near browse, cart or
 * checkout: one abandoned PKR 2,500 order wipes out months of ad revenue from
 * that user, so an interstitial in a shopping flow is a net loss dressed up as
 * revenue (§13.5).
 *
 * The coin figure comes back from the server. The app never names its own
 * reward (§13.2) — claim_rewarded_ad takes no arguments at all.
 */
function RewardedVideo() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { refresh } = useAppState();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function watch() {
    setBusy(true);
    setMessage(null);
    try {
      // The AdMob rewarded unit goes here; the reward is only claimed once the
      // SDK reports the video actually completed.
      const coins = await api.claimRewardedAd();
      setMessage(fill(t.you.watchVideo, { coins: formatCoins(coins) }));
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t.common.retry);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Pressable
        onPress={watch}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={fill(t.you.watchVideo, { coins: 30 })}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.raised,
            borderColor: theme.line,
            marginTop: space.xxl,
            opacity: pressed || busy ? 0.7 : 1,
            minHeight: MIN_TAP,
          },
        ]}
      >
        <Text style={[text.body, { color: theme.text }]}>
          {fill(t.you.watchVideo, { coins: 30 })}
        </Text>
      </Pressable>
      {message ? (
        <Text style={[text.bodySmall, { color: theme.textMuted, marginTop: space.sm }]}>
          {message}
        </Text>
      ) : null}
    </>
  );
}

/** §7.7 — pending referrals, so the referrer keeps nudging. */
function Referrals() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.myReferrals>>>([]);

  useEffect(() => {
    let alive = true;
    api.myReferrals().then((r) => { if (alive) setRows(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (rows.length === 0) return null;

  return (
    <>
      <Text style={[text.label, { color: theme.textMuted, marginTop: space.xxl }]}>
        {t.you.referral}
      </Text>
      {rows.map((r) => (
        <Text
          key={`${r.name}-${r.joinedAt}`}
          style={[
            text.body,
            { color: r.hasOrdered ? theme.textMuted : theme.text, marginTop: space.sm },
          ]}
        >
          {fill(t.you.referralPending, {
            name: r.name ?? '—',
            coins: formatCoins(r.coins),
          })}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  langs: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  lang: {
    flex: 1,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
