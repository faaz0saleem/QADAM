import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Card, Divider, Row, SkeletonRows, Text } from '@/components/ui';
import { Notice } from '@/components/Notice';
import { LedgerRule } from '@/components/LedgerRule';
import { CoinValue } from '@/components/Coin';
import { space, useSurface } from '@/theme';
import { fill, useI18n } from '@/i18n';
import {
  cancelGroupOrder,
  respondToGroupOrder,
  useGroupOrder,
  type GroupOrder,
  type GroupOrderMember,
} from '@/hooks/useGroupOrder';
import { refreshWallet } from '@/hooks/useWallet';
import { formatNumber, formatPkr, relativeTime } from '@/lib/format';

/**
 * One team basket.
 *
 * §7.6 makes teams the growth engine, and this is the screen where a team does
 * something together rather than just appearing on a board next to each other.
 *
 * The copy is doing real work. §9.6 forbids "points" and "rewards"; this screen
 * also refuses "pool" and "share your coins", because neither is true and both
 * describe a thing README §13.3 says will never exist. Everyone agrees, and
 * everyone who has coins spends their own. That sentence is on the screen, once,
 * where the decision is made.
 */
export default function GroupOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const { order, loading, failed, reload, setOrder } = useGroupOrder(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<{ order?: GroupOrder; error?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.order) setOrder(result.order);

    // Somebody's coins may have just left their ledger — possibly yours.
    await refreshWallet();

    if (result.order?.status === 'placed') {
      Alert.alert(t.group.everyoneAgreed, t.shop.placedBody);
      router.replace('/orders');
    }
  };

  if (loading && !order) {
    return (
      <Screen title={t.group.title} surface="spending">
        <SkeletonRows rows={4} />
      </Screen>
    );
  }

  if (failed || !order) {
    return (
      <Screen title={t.group.title} surface="spending">
        <Notice message={t.errors.generic} actionLabel={t.errors.retry} onAction={reload} />
      </Screen>
    );
  }

  const me = order.members.find((m) => m.is_me);
  const undecided = order.status === 'open' && me?.decision === 'waiting';
  const canCancel = order.status === 'open' && order.i_opened_it;

  return (
    <Screen title={t.group.title} surface="spending" onRefresh={reload} refreshing={loading}>
      <StatusLine order={order} />

      {/* What is in it. Titles and quantities, because everyone approving needs
          to know what they are agreeing to buy. */}
      <Card>
        {order.items.map((item, i) => (
          <View key={item.product_id}>
            {i > 0 ? <Divider /> : null}
            <Row justify="space-between">
              <Text variant="bodySmall" numberOfLines={2} style={styles.itemTitle}>
                {item.qty > 1 ? `${item.title} × ${formatNumber(item.qty)}` : item.title}
              </Text>
              <Text variant="data">{formatPkr(item.line_pkr)}</Text>
            </Row>
            {!item.in_stock ? (
              <Text variant="label" style={styles.warn}>
                {t.shop.outOfStock}
              </Text>
            ) : null}
          </View>
        ))}

        <Divider />
        <Money order={order} />
      </Card>

      {/* Who is in, and who has not said anything yet. */}
      <Card>
        <Text variant="sectionTitle">
          {order.waiting_on === 0
            ? t.group.everyoneAgreed
            : order.waiting_on === 1
              ? t.group.waitingOnOne
              : fill(t.group.waitingOn, { count: formatNumber(order.waiting_on) })}
        </Text>
        {order.members.map((member) => (
          <MemberRow key={member.user_id} member={member} />
        ))}
        <Text variant="label" faint>
          {t.group.coinsExplainer}
        </Text>
      </Card>

      {error ? <Notice message={error} /> : null}

      {undecided ? (
        <View style={styles.actions}>
          <Button
            label={t.group.approve}
            loading={busy}
            onPress={() => void act(() => respondToGroupOrder(order.id, true, true))}
          />
          {/*
            "Agree, but keep my coins" is a real choice and not a footnote.
            Approving is permission; funding is separate, and someone saving
            their coins for something of their own should not have to block
            their team to do it.
          */}
          <Button
            variant="quiet"
            label={t.group.approveWithoutCoins}
            disabled={busy}
            onPress={() => void act(() => respondToGroupOrder(order.id, true, false))}
          />
          <Button
            variant="quiet"
            label={t.group.decline}
            disabled={busy}
            onPress={() => void act(() => respondToGroupOrder(order.id, false))}
          />
        </View>
      ) : null}

      {canCancel ? (
        <Button
          variant="quiet"
          label={t.group.cancel}
          disabled={busy}
          onPress={() => void act(() => cancelGroupOrder(order.id))}
        />
      ) : null}
    </Screen>
  );
}

function StatusLine({ order }: { order: GroupOrder }) {
  const { t, locale } = useI18n();

  const line =
    order.status === 'open'
      ? fill(t.group.expires, { when: relativeTime(order.expires_at, locale) })
      : order.status === 'placed'
        ? t.group.placed
        : order.status === 'declined'
          ? fill(t.group.declined, {
              name:
                order.members.find((m) => m.decision === 'declined')?.name ??
                order.opened_by_name ??
                '',
            })
          : order.status === 'cancelled'
            ? t.group.cancelled
            : t.group.expired;

  return (
    <View style={styles.status}>
      <Text variant="sectionTitle">
        {order.i_opened_it
          ? t.group.youOpened
          : fill(t.group.openedBy, { name: order.opened_by_name ?? '' })}
      </Text>
      <Text variant="bodySmall" dim>
        {order.i_opened_it
          ? line
          : `${fill(t.group.deliverTo, { name: order.opened_by_name ?? '' })} · ${line}`}
      </Text>
    </View>
  );
}

/**
 * The money, and the one honest way to show it while the basket is open.
 *
 * `max_discount_pkr` is the §0 ceiling — a property of the products, the same
 * figure the store card already shows. `discount_pkr` is what the approvals so
 * far can actually fund, and it climbs as people say yes. The rule between them
 * is the progress of the decision, which is the thing worth watching.
 *
 * Neither number is brass. §9.2: brass is coin values, and both of these are
 * rupees.
 */
function Money({ order }: { order: GroupOrder }) {
  const { t } = useI18n();
  const surface = useSurface();
  const open = order.status === 'open';
  const covered = order.max_discount_pkr > 0 ? order.discount_pkr / order.max_discount_pkr : 0;

  return (
    <View style={styles.money}>
      <Row justify="space-between">
        <Text variant="bodySmall" dim>
          {t.shop.subtotal}
        </Text>
        <Text variant="data">{formatPkr(order.subtotal_pkr)}</Text>
      </Row>

      {order.max_discount_pkr > 0 ? (
        <>
          <Row justify="space-between">
            <Text variant="bodySmall" style={{ color: surface.good }}>
              {open
                ? fill(t.group.savingCapped, { amount: formatPkr(order.max_discount_pkr) })
                : t.shop.coinDiscount}
            </Text>
            <Text variant="data" style={{ color: surface.good }}>
              −{formatPkr(order.discount_pkr)}
            </Text>
          </Row>
          {open ? (
            <>
              <LedgerRule progress={covered} filledColor={surface.good} divisions={4} />
              <Text variant="label" faint>
                {fill(t.group.committed, { amount: formatPkr(order.discount_pkr) })}
              </Text>
            </>
          ) : null}
        </>
      ) : null}

      <Row justify="space-between">
        <Text variant="sectionTitle">{t.shop.toPay}</Text>
        <Text variant="dataLarge">{formatPkr(order.total_pkr)}</Text>
      </Row>

      {order.my_coins_spent > 0 ? (
        <Row justify="space-between">
          <Text variant="bodySmall" dim>
            {t.group.myCoins}
          </Text>
          <CoinValue coins={order.my_coins_spent} size="small" />
        </Row>
      ) : null}
    </View>
  );
}

function MemberRow({ member }: { member: GroupOrderMember }) {
  const { t } = useI18n();
  const surface = useSurface();

  const label =
    member.decision === 'waiting'
      ? t.group.statusWaiting
      : member.decision === 'declined'
        ? t.group.statusDeclined
        : member.spending
          ? t.group.statusApproved
          : t.group.statusApprovedNoCoins;

  const colour =
    member.decision === 'approved'
      ? surface.good
      : member.decision === 'declined'
        ? surface.bad
        : surface.textFaint;

  return (
    <Row justify="space-between" accessible accessibilityLabel={`${member.name ?? ''}, ${label}`}>
      <Text variant="bodySmall" numberOfLines={1} style={styles.itemTitle}>
        {member.name ?? '—'}
      </Text>
      <Text variant="label" style={{ color: colour }}>
        {label}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  status: { gap: space.xs },
  itemTitle: { flexShrink: 1, marginEnd: space.md },
  money: { gap: space.sm },
  actions: { gap: space.sm },
  warn: { color: '#C0563F' },
});
