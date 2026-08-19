import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { Card, Row, Text } from './ui';
import { Button } from './Button';
import { CoinValue } from './Coin';
import { space } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { rewardedAdsLeftToday, showRewardedAd } from '@/lib/ads';
import { refreshWallet } from '@/hooks/useWallet';
import { useSession } from '@/hooks/useSession';
import { formatNumber } from '@/lib/format';

const REWARD_COINS = 30;

/**
 * §7.8 — the ONLY advertisement in this app, and it lives here, in the earning
 * half, next to the steps.
 *
 * "Zero ads in browse, cart, or checkout. One abandoned PKR 2,500 order wipes
 *  out months of ad revenue from that user."
 *
 * There is no version of this component for the store, and no prop that would
 * put it there.
 */
export function EarnCard() {
  const { t } = useI18n();
  const { session } = useSession();
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshLeft = useCallback(async () => {
    setLeft(await rewardedAdsLeftToday());
  }, []);

  useEffect(() => {
    void refreshLeft();
  }, [refreshLeft]);

  const watch = async () => {
    const userId = session?.user?.id;
    if (!userId) return;

    setBusy(true);
    const outcome = await showRewardedAd(userId);
    setBusy(false);

    if (outcome === 'unavailable') {
      Alert.alert(t.earn.title, t.earn.unavailable);
      return;
    }
    if (outcome === 'dismissed') {
      Alert.alert(t.earn.title, t.earn.dismissed);
      return;
    }

    // "earned" means Google will call our SSV endpoint, not that coins have
    // arrived. Ask the server rather than adding thirty to a local number —
    // that number would be a client deciding what it had earned (§13.2).
    Alert.alert(t.earn.title, t.earn.earned);
    await refreshWallet();
    await refreshLeft();
  };

  if (left === 0) {
    return (
      <Card>
        <Text variant="sectionTitle" dim>
          {t.earn.title}
        </Text>
        <Text variant="bodySmall" faint>
          {t.earn.none}
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <Row justify="space-between">
        <Text variant="sectionTitle">{t.earn.title}</Text>
        <CoinValue coins={REWARD_COINS} size="medium" />
      </Row>
      <Text variant="bodySmall" dim>
        {fill(t.earn.body, { coins: formatNumber(REWARD_COINS) })}
      </Text>
      {left !== null ? (
        <Text variant="label" faint>
          {fill(t.earn.left, { count: formatNumber(left) })}
        </Text>
      ) : null}
      <Button
        label={busy ? t.earn.watching : t.earn.watch}
        onPress={() => void watch()}
        loading={busy}
        style={{ marginTop: space.xs }}
      />
    </Card>
  );
}
