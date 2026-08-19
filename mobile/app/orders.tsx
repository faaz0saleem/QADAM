import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Card, Divider, EmptyState, Row, Text } from '@/components/ui';
import { Loading } from '@/components/Notice';
import { useSurface } from '@/theme';
import { useI18n, fill, type Copy } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { useOrders, type Order } from '@/hooks/useStore';
import { refreshWallet } from '@/hooks/useWallet';
import { formatDate, formatNumber, formatPkr } from '@/lib/format';

export default function OrdersScreen() {
  const { t } = useI18n();
  const { orders, loading, reload } = useOrders();

  return (
    <Screen title={t.shop.ordersTitle} surface="spending" onRefresh={reload} refreshing={loading}>
      {loading && orders.length === 0 ? (
        <Loading />
      ) : orders.length === 0 ? (
        <EmptyState>{t.shop.ordersEmpty}</EmptyState>
      ) : (
        orders.map((order) => <OrderCard key={order.id} order={order} onChange={reload} />)
      )}
    </Screen>
  );
}

function OrderCard({ order, onChange }: { order: Order; onChange: () => void }) {
  const { t, locale } = useI18n();
  const surface = useSurface();

  const cancellable = order.status === 'pending_confirmation' || order.status === 'confirmed';

  const cancel = async () => {
    await supabase.rpc('cancel_my_order', { p_order_id: order.id });
    await refreshWallet();
    onChange();
  };

  return (
    <Card>
      <Row justify="space-between">
        <Text variant="sectionTitle">{statusLabel(order.status, t)}</Text>
        <Text variant="dataSmall" faint>
          {formatDate(order.created_at, locale)}
        </Text>
      </Row>

      <Text variant="bodySmall" dim>
        {fill(t.shop.orderItems, { count: formatNumber(order.item_count) })}
      </Text>

      <Divider />

      <Row justify="space-between">
        <Text variant="bodySmall" dim>
          {t.shop.subtotal}
        </Text>
        <Text variant="dataSmall">{formatPkr(order.subtotal_pkr, locale)}</Text>
      </Row>
      {order.discount_pkr > 0 ? (
        <Row justify="space-between">
          <Text variant="bodySmall" dim>
            {t.shop.coinDiscount}
          </Text>
          <Text variant="dataSmall" style={{ color: surface.good }}>
            −{formatPkr(order.discount_pkr, locale)}
          </Text>
        </Row>
      ) : null}
      <Row justify="space-between">
        <Text variant="sectionTitle">{t.shop.toPay}</Text>
        <Text variant="data">{formatPkr(order.total_pkr, locale)}</Text>
      </Row>

      {/*
        §7.5 made visible after the fact. "Coins lost — the delivery was refused"
        is a hard sentence to read, and it is the one that makes the next person
        answer their door.
      */}
      {order.coin_state && order.coin_state !== 'none' ? (
        <Text
          variant="bodySmall"
          style={order.coin_state === 'burned' ? { color: surface.bad } : undefined}
          dim={order.coin_state !== 'burned'}
        >
          {coinStateLabel(order.coin_state, t)}
        </Text>
      ) : null}

      {cancellable ? (
        <Button variant="quiet" label={t.shop.cancelOrder} onPress={() => void cancel()} />
      ) : null}
    </Card>
  );
}

function statusLabel(status: string, t: Copy): string {
  switch (status) {
    case 'pending_confirmation':
      return t.shop.statusPendingConfirmation;
    case 'confirmed':
      return t.shop.statusConfirmed;
    case 'dispatched':
      return t.shop.statusDispatched;
    case 'delivered':
      return t.shop.statusDelivered;
    case 'refused':
      return t.shop.statusRefused;
    case 'returned':
      return t.shop.statusReturned;
    default:
      return t.shop.statusCancelled;
  }
}

function coinStateLabel(state: NonNullable<Order['coin_state']>, t: Copy): string {
  switch (state) {
    case 'pending':
      return t.shop.coinsPending;
    case 'spent':
      return t.shop.coinsSpent;
    case 'burned':
      return t.shop.coinsBurned;
    case 'returned':
      return t.shop.coinsReturned;
    default:
      return '';
  }
}
