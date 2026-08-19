import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Card, Divider, EmptyState, Row, Text } from '@/components/ui';
import { CoinValue } from '@/components/Coin';
import { Loading, Notice } from '@/components/Notice';
import { earning, space } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { useWalletOnMount, type CoinBatch, type LedgerRow } from '@/hooks/useWallet';
import { useRedemptionLock } from '@/hooks/useRedemptionLock';
import { formatDate, formatNumber, relativeTime } from '@/lib/format';

/**
 * §7.2 — "A ledger view: every credit and debit, with reason and expiry date.
 * Group by expiry batch so '2,400 coins expiring in 11 days' is a visible, dated
 * thing and not a surprise."
 */
export default function WalletScreen() {
  const { t, locale } = useI18n();
  const { balance, batches, ledger, loading, failed, refresh } = useWalletOnMount();
  const lock = useRedemptionLock();

  return (
    <Screen title={t.wallet.title} onRefresh={refresh} refreshing={loading}>
      {/*
        §6.1 — no redemption in an account's first seven days. Saying so up
        front, with the date, beats a checkout that fails for reasons the user
        cannot see. The server enforces it either way.
      */}
      {lock.locked && lock.unlocksAt ? (
        <Card>
          <Text variant="sectionTitle">
            {fill(t.wallet.lockedUntil, { date: formatDate(lock.unlocksAt, locale) })}
          </Text>
          <Text variant="bodySmall" dim>
            {t.wallet.lockedWhy}
          </Text>
        </Card>
      ) : null}

      {failed ? (
        <Notice message={t.errors.generic} actionLabel={t.errors.retry} onAction={refresh} />
      ) : null}

      {loading && batches.length === 0 && ledger.length === 0 ? (
        <Loading />
      ) : batches.length === 0 && ledger.length === 0 ? (
        // §9.6 — empty states are invitations, not apologies.
        <EmptyState>{t.wallet.empty}</EmptyState>
      ) : null}

      {batches.map((batch) => (
        <BatchCard key={batch.batch_id} batch={batch} />
      ))}

      {ledger.length > 0 ? (
        <View style={styles.history}>
          <Text variant="sectionTitle" dim>
            {t.wallet.history}
          </Text>
          <Divider />
          {ledger.map((row) => (
            <LedgerLine key={row.id} row={row} />
          ))}
        </View>
      ) : null}

      <Text variant="dataSmall" faint>
        {fill(t.steps.lastSynced, { when: relativeTime(new Date().toISOString(), locale) })} ·{' '}
        {formatNumber(balance)} {t.wallet.balance}
      </Text>
    </Screen>
  );
}

function BatchCard({ batch }: { batch: CoinBatch }) {
  const { t, locale } = useI18n();
  const lapsingSoon = batch.days_left <= 14;

  return (
    <Card style={lapsingSoon ? styles.lapsing : undefined}>
      <Row
        justify="space-between"
        accessible
        accessibilityLabel={fill(t.wallet.batchAnnouncement, {
          coins: formatNumber(batch.remaining),
          days: String(batch.days_left),
        })}
      >
        <CoinValue coins={batch.remaining} size="large" />
        <Text variant="label" dim>
          {reasonLabel(batch.reason, t)}
        </Text>
      </Row>
      <Text variant="dataSmall" style={lapsingSoon ? styles.lapsingText : undefined}>
        {batch.days_left <= 1
          ? fill(t.wallet.expiringToday, { coins: formatNumber(batch.remaining) })
          : fill(t.wallet.expiringSoon, {
              coins: formatNumber(batch.remaining),
              days: String(batch.days_left),
            })}
      </Text>
      <Text variant="dataSmall" faint>
        {fill(t.wallet.expiresOn, { date: formatDate(batch.expires_at, locale) })}
      </Text>
    </Card>
  );
}

function LedgerLine({ row }: { row: LedgerRow }) {
  const { t, locale } = useI18n();
  const credit = row.delta > 0;

  return (
    <Row justify="space-between" style={styles.line}>
      <View style={styles.lineText}>
        <Text variant="bodySmall">{reasonLabel(row.reason, t)}</Text>
        <Text variant="dataSmall" faint>
          {formatDate(row.created_at, locale)}
        </Text>
      </View>
      {/* A debit is not brass: brass is for coins you have, and these are gone. */}
      {credit ? (
        <CoinValue coins={row.delta} size="small" />
      ) : (
        <Text variant="dataSmall" dim>
          −{formatNumber(Math.abs(row.delta))}
        </Text>
      )}
    </Row>
  );
}

function reasonLabel(reason: string, t: ReturnType<typeof useI18n>['t']): string {
  switch (reason) {
    case 'steps':
      return t.wallet.reasonSteps;
    case 'rewarded_ad':
      return t.wallet.reasonRewardedAd;
    case 'referral_referrer':
      return t.wallet.reasonReferralReferrer;
    case 'referral_referee':
      return t.wallet.reasonReferralReferee;
    case 'challenge_prize':
      return t.wallet.reasonChallengePrize;
    case 'order_pending':
      return t.wallet.reasonOrderPending;
    default:
      return t.wallet.reasonAdjustment;
  }
}

const styles = StyleSheet.create({
  lapsing: { borderLeftWidth: 2, borderLeftColor: earning.bad },
  lapsingText: { color: earning.bad },
  history: { gap: space.sm },
  line: { paddingVertical: space.sm },
  lineText: { gap: 2 },
});
