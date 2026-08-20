import { useMemo } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Card, Row, Text } from '@/components/ui';
import { MintingCoinValue, CoinValue } from '@/components/Coin';
import { LedgerRule } from '@/components/LedgerRule';
import { TickingNumber } from '@/components/TickingNumber';
import { WalkingPulse } from '@/components/WalkingPulse';
import { EarnCard } from '@/components/EarnCard';
import { earning, space, MIN_TAP_TARGET, radius } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { useSteps } from '@/hooks/useSteps';
import { useLiveSteps, useLiveStepTicker } from '@/hooks/useLiveSteps';
import { openStepPermissionSettings } from '@/lib/health';
import { useWallet } from '@/hooks/useWallet';
import { formatNumber, relativeTime } from '@/lib/format';

const DAILY_CAP = 15000; // display only; the server applies the real cap
const STREAK_MIN = 5000;

/**
 * §9.4 — the home screen hierarchy, in this order and no other:
 *
 *   1. Today's step count — very large, monospace, ticking
 *   2. A horizontal progress rule toward the daily cap (a ruled ledger line
 *      filling, NOT a circular ring — everyone ships a ring)
 *   3. Today's coins, in brass, counting up
 *   4. Streak, with days-remaining pressure if it's at risk
 *   5. One contextual card. NEVER more than one.
 */
export default function StepsScreen() {
  const { t, locale } = useI18n();
  const steps = useSteps();
  const live = useLiveSteps();

  // The phone's own count, read every few seconds. Display only — see
  // useLiveSteps for why this can never be allowed to become coins.
  useLiveStepTicker();

  const contextual = usePickOneCard();

  // Before the first live read lands, the server's figure is the best thing we
  // have. After it, the phone is ahead and that is the number to show.
  const shownSteps = live.steps ?? steps.today;
  const uncounted = Math.max(0, shownSteps - steps.today);

  if (steps.permission === 'denied' || steps.permission === 'unavailable') {
    return <PermissionScreen />;
  }

  return (
    <Screen title={t.steps.title} onRefresh={steps.sync} refreshing={steps.syncing}>
      {/* 1 — the count, ticking. §9.4 wants it very large, monospace, ticking,
             and this is the ticking part: it moves while you watch it rather
             than jumping when a sync happens. */}
      <View style={styles.counterBlock}>
        <TickingNumber
          value={shownSteps}
          style={styles.counter}
          accessibilityLabel={`${formatNumber(shownSteps)} ${t.steps.stepsLabel}`}
        />
        {/* The dot says the health read is alive. Without it, "you stopped
            walking" and "the read is failing" are the same still number. */}
        <Row gap={space.sm}>
          <WalkingPulse active={live.walking} />
          <Text variant="label" dim>
            {live.walking ? `${t.steps.stepsLabel} · ${t.steps.walking}` : t.steps.stepsLabel}
          </Text>
        </Row>
      </View>

      {/* 2 — the ruled line, filling toward the daily cap */}
      <View style={styles.ruleBlock}>
        <LedgerRule progress={shownSteps / DAILY_CAP} />
        <Text variant="dataSmall" faint>
          {steps.capped
            ? t.steps.capReached
            : fill(t.steps.towardCap, {
                current: formatNumber(steps.today),
                cap: formatNumber(DAILY_CAP),
              })}
        </Text>
        {/*
          The gap between what the phone has seen and what the server has
          counted is real, and it closes on the next sync. Saying so is better
          than letting someone wonder why the big number and the counted number
          disagree — §9.6, say what happened.
        */}
        {uncounted > 0 && !steps.capped ? (
          <Text variant="dataSmall" faint>
            {fill(t.steps.notCountedYet, { steps: formatNumber(uncounted) })}
          </Text>
        ) : null}
      </View>

      {/* 3 — today's coins, in brass, counting up */}
      <Row gap={space.sm} style={styles.coinsBlock}>
        <MintingCoinValue coins={steps.coinsToday} size="large" />
        <Text variant="label" dim>
          {t.steps.coinsToday}
        </Text>
      </Row>

      {/* 4 — the streak, with pressure only when it is actually at risk */}
      <Card>
        <Row justify="space-between">
          <Text variant="sectionTitle">
            {steps.streakDays > 0
              ? fill(t.steps.streak, { days: formatNumber(steps.streakDays) })
              : t.steps.streakNone}
          </Text>
          <Text variant="data" dim>
            {formatNumber(steps.streakDays)}
          </Text>
        </Row>
        {steps.streakDays > 0 && steps.today < STREAK_MIN ? (
          <Text variant="bodySmall" style={styles.atRisk}>
            {fill(t.steps.streakAtRisk, { steps: formatNumber(STREAK_MIN - steps.today) })}
          </Text>
        ) : null}
      </Card>

      {/* 5 — exactly one contextual card, whichever is most urgent */}
      {contextual}

      {/*
        §7.8 — the only advertisement in the app, in the earning half, below the
        fold. Never in browse, cart or checkout.
      */}
      <EarnCard />

      {/* §7.1 — "show last-synced time so failures are visible", and §9.6 —
          say what happened. An unreachable server is not a lost connection, and
          telling someone on a perfect connection that they have no signal sends
          them to fix the wrong thing. */}
      <Text variant="dataSmall" faint style={styles.synced}>
        {steps.syncing
          ? t.steps.syncing
          : steps.syncProblem === 'server'
            ? t.errors.serverUnreachable
            : steps.syncProblem === 'offline'
              ? t.errors.offline
              : fill(t.steps.lastSynced, { when: relativeTime(steps.lastSynced, locale) })}
      </Text>
    </Screen>
  );
}

/**
 * §9.4 — "One contextual card: expiring coins, team rank, or an unclaimed reward
 * — whichever is most urgent. Never more than one."
 *
 * Urgency order is the order of the losses: coins about to lapse first, because
 * that is the only one where doing nothing costs the user something.
 */
function usePickOneCard() {
  const { t } = useI18n();
  const { batches } = useWallet();

  return useMemo(() => {
    const lapsing = batches.find((b) => b.days_left <= 14 && b.remaining > 0);
    if (lapsing) {
      return (
        <Card style={styles.urgent}>
          <Row justify="space-between">
            <Text variant="sectionTitle">
              {lapsing.days_left <= 1
                ? fill(t.wallet.expiringToday, { coins: formatNumber(lapsing.remaining) })
                : fill(t.wallet.expiringSoon, {
                    coins: formatNumber(lapsing.remaining),
                    days: String(lapsing.days_left),
                  })}
            </Text>
            <CoinValue coins={lapsing.remaining} size="small" />
          </Row>
        </Card>
      );
    }
    return null;
  }, [batches, t]);
}

/**
 * §7.1 — "Handle the permission denial path properly. An app that shows a blank
 * screen when health permission is refused loses the user permanently. Show what
 * they're missing and a one-tap route to settings."
 */
function PermissionScreen() {
  const { t } = useI18n();
  const { grantPermission } = useSteps();

  return (
    <Screen title={t.steps.title}>
      <Card>
        <Text variant="sectionTitle">{t.permission.title}</Text>
        <Text variant="body" dim>
          {Platform.OS === 'android' ? t.permission.bodyAndroid : t.permission.bodyIos}
        </Text>
        <Pressable style={styles.cta} onPress={grantPermission} accessibilityRole="button">
          <Text variant="sectionTitle">{t.permission.cta}</Text>
        </Pressable>
        <Pressable
          style={styles.ctaQuiet}
          onPress={() =>
            void (Platform.OS === 'android'
              ? openStepPermissionSettings()
              : Linking.openSettings())
          }
          accessibilityRole="button"
        >
          <Text variant="bodySmall" dim>
            {t.permission.settings}
          </Text>
        </Pressable>
        {/* §2 — no GPS anywhere, and saying so is worth more than not asking. */}
        <Text variant="bodySmall" faint>
          {t.permission.noLocation}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  counterBlock: { paddingTop: space.lg, gap: space.xs },
  counter: { color: earning.text },
  ruleBlock: { gap: space.sm },
  coinsBlock: { alignItems: 'baseline' },
  atRisk: { color: earning.bad },
  urgent: { borderLeftWidth: 2, borderLeftColor: earning.bad },
  synced: { paddingTop: space.md },
  cta: {
    minHeight: MIN_TAP_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: earning.sunken,
    borderRadius: radius.md,
    marginTop: space.sm,
  },
  ctaQuiet: { minHeight: MIN_TAP_TARGET, justifyContent: 'center', alignItems: 'center' },
});
