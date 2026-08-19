import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Temperature, useTheme } from '../../src/theme/ThemeContext';
import { Screen } from '../../src/components/Screen';
import { CoinHeader } from '../../src/components/CoinHeader';
import { LedgerRule } from '../../src/components/LedgerRule';
import { MintCounter } from '../../src/components/MintCounter';
import { space, radius, MIN_TAP } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { formatSteps, formatCoins, relativeTime } from '../../src/lib/format';
import { useI18n } from '../../src/i18n';
import { useAppState } from '../../src/data/AppState';

/**
 * §9.4 — the home screen, in the order the brief sets out:
 *   1. today's step count, very large, monospace, ticking
 *   2. a horizontal progress rule toward the daily cap (not a ring)
 *   3. today's coins, in brass, counting up
 *   4. the streak, with pressure if it is at risk
 *   5. ONE contextual card. Never more than one.
 */
export default function StepsScreen() {
  return (
    <Temperature mode="earning">
      <StepsBody />
    </Temperature>
  );
}

function StepsBody() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { balance, today, batches, permission, syncing, requestPermission } = useAppState();

  const capped = today.creditedSteps >= today.dailyCap;
  const progress = today.dailyCap > 0 ? today.creditedSteps / today.dailyCap : 0;

  return (
    <>
      <CoinHeader balance={balance} title={t.steps.title} />
      <Screen>
        {permission === 'denied' || permission === 'unavailable' ? (
          <PermissionCard onPress={requestPermission} />
        ) : null}

        {/* 1 — the number */}
        <View style={{ marginTop: space.xxl }}>
          <Text
            style={[text.counter, { color: theme.text }]}
            accessibilityLabel={`${formatSteps(today.rawSteps)} steps today`}
          >
            {formatSteps(today.rawSteps)}
          </Text>
          <Text style={[text.label, { color: theme.textMuted, marginTop: space.xs }]}>
            {t.common.steps}
          </Text>
        </View>

        {/* 2 — the ruled line, not a ring */}
        <View style={{ marginTop: space.xl }}>
          <LedgerRule
            progress={progress}
            label={fill(t.steps.towardCap, {
              current: formatSteps(today.creditedSteps),
              cap: formatSteps(today.dailyCap),
            })}
          />
          <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.sm }]}>
            {capped
              ? t.steps.capReached
              : fill(t.steps.towardCap, {
                  current: formatSteps(today.creditedSteps),
                  cap: formatSteps(today.dailyCap),
                })}
          </Text>
        </View>

        {/* 3 — today's coins, in brass, counting up */}
        <View style={[styles.row, { marginTop: space.xxl }]}>
          <MintCounter value={today.coinsToday} large />
          <Text style={[text.label, { color: theme.textMuted, marginLeft: space.md }]}>
            {t.steps.todayCoins}
          </Text>
        </View>

        {/* 4 — the streak */}
        <StreakLine />

        {/* 5 — exactly one contextual card, whichever is most urgent */}
        <ContextualCard />

        <SyncLine syncing={syncing} lastSyncedAt={today.lastSyncedAt} />
      </Screen>
    </>
  );
}

function StreakLine() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { today } = useAppState();
  const qualifying = 5000;
  const atRisk = today.streak > 0 && today.creditedSteps < qualifying;

  return (
    <View style={{ marginTop: space.xl }}>
      <Text
        style={[
          text.body,
          { color: atRisk ? theme.warn : theme.textMuted },
        ]}
      >
        {today.streak === 0
          ? fill(t.steps.streakNone, { steps: formatSteps(qualifying) })
          : atRisk
            ? fill(t.steps.streakAtRisk, {
                steps: formatSteps(qualifying - today.creditedSteps),
                days: today.streak,
              })
            : fill(t.steps.streak, { days: today.streak })}
      </Text>
    </View>
  );
}

/**
 * §9.4: "One contextual card: expiring coins, team rank, or an unclaimed
 * reward — whichever is most urgent. Never more than one."
 */
function ContextualCard() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { batches } = useAppState();

  const soonest = [...batches]
    .filter((b) => b.remaining > 0 && b.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];

  if (!soonest) return null;

  const copy =
    soonest.daysLeft === 0
      ? fill(t.wallet.expiringToday, { coins: formatCoins(soonest.remaining) })
      : soonest.daysLeft === 1
        ? fill(t.wallet.expiringOne, { coins: formatCoins(soonest.remaining) })
        : fill(t.wallet.expiring, {
            coins: formatCoins(soonest.remaining),
            days: soonest.daysLeft,
          });

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.raised, borderColor: theme.warn },
      ]}
    >
      <Text style={[text.body, { color: theme.text }]}>{copy}</Text>
    </View>
  );
}

function PermissionCard({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t.permission.denied} ${t.permission.deniedCta}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.raised,
          borderColor: theme.warn,
          marginTop: space.lg,
          opacity: pressed ? 0.85 : 1,
          minHeight: MIN_TAP,
        },
      ]}
    >
      {/* §9.6: say what happened and what to do. Not "an error occurred". */}
      <Text style={[text.body, { color: theme.text }]}>{t.permission.denied}</Text>
      <Text style={[text.body, { color: theme.coin, marginTop: space.xs }]}>
        {t.permission.deniedCta} →
      </Text>
    </Pressable>
  );
}

function SyncLine({ syncing, lastSyncedAt }: { syncing: boolean; lastSyncedAt: string | null }) {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const rel = relativeTime(lastSyncedAt);

  const when =
    rel === 'never'
      ? '—'
      : rel.unit === 'now'
        ? t.common.justNow
        : rel.unit === 'min'
          ? fill(t.common.minutesAgo, { n: rel.n })
          : rel.unit === 'hr'
            ? fill(t.common.hoursAgo, { n: rel.n })
            : t.common.yesterday;

  // §7.1: never a sync button, but always a visible last-synced time so a
  // failure is not silent.
  return (
    <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.xxxl }]}>
      {syncing ? t.steps.syncing : fill(t.steps.lastSynced, { when })}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline' },
  card: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
});
