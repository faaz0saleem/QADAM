import { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Card, Row, Text } from '@/components/ui';
import { MintingCoinValue, CoinValue } from '@/components/Coin';
import { LedgerRule } from '@/components/LedgerRule';
import { earning, space, MIN_TAP_TARGET, radius } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { useSteps } from '@/hooks/useSteps';
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
  const wallet = useWallet();

  const contextual = usePickOneCard();

  if (steps.permission === 'denied' || steps.permission === 'unavailable') {
    return <PermissionScreen />;
  }

  return (
    <Screen title={t.steps.title} onRefresh={steps.sync} refreshing={steps.syncing}>
      {/* 1 — the count */}
      <View style={styles.counterBlock}>
        <Text variant="counter" style={styles.counter}>
          {formatNumber(steps.today)}
        </Text>
        <Text variant="label" dim>
          {t.steps.stepsLabel}
        </Text>
      </View>

      {/* 2 — the ruled line, filling */}
      <View style={styles.ruleBlock}>
        <LedgerRule progress={steps.today / DAILY_CAP} />
        <Text variant="dataSmall" faint>
          {steps.capped
            ? t.steps.capReached
            : fill(t.steps.towardCap, {
                current: formatNumber(steps.today),
                cap: formatNumber(DAILY_CAP),
              })}
        </Text>
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

      <Text variant="dataSmall" faint style={styles.synced}>
        {steps.syncing
          ? t.steps.syncing
          : steps.queued
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
          {t.permission.bodyAndroid}
        </Text>
        <Pressable style={styles.cta} onPress={grantPermission} accessibilityRole="button">
          <Text variant="sectionTitle">{t.permission.cta}</Text>
        </Pressable>
        <Pressable
          style={styles.ctaQuiet}
          onPress={() => void Linking.openSettings()}
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
