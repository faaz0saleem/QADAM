import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Temperature, useTheme } from '../src/theme/ThemeContext';
import { Screen } from '../src/components/Screen';
import { space, radius, MIN_TAP } from '../src/theme/tokens';
import { text } from '../src/theme/type';
import { formatPkr, formatCoins } from '../src/lib/format';
import { useI18n } from '../src/i18n';
import { useAppState } from '../src/data/AppState';
import { useCart } from '../src/data/Cart';
import * as api from '../src/data/api';
import { track } from '../src/lib/analytics';

/**
 * §7.5 — checkout, and the rule the business rests on.
 *
 * "Spend coins on an order and refuse the delivery, and the coins are gone."
 *
 * That warning is the whole COD strategy: it is what gives the customer skin in
 * the game before the parcel arrives, at zero rupee cost to them. So it is not
 * a footnote or a checkbox — it sits directly above the button, in clay, and it
 * appears the moment any coins are being spent.
 */
export default function CheckoutScreen() {
  return (
    <Temperature mode="spending">
      <CheckoutBody />
    </Temperature>
  );
}

function CheckoutBody() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { userId, refresh } = useAppState();
  const { lines, subtotalPkr, clear } = useCart();

  const [useCoins, setUseCoins] = useState(true);
  const [quote, setQuote] = useState({ coins: 0, discountPkr: 0 });
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = lines.map((l) => ({ product_id: l.product.id, qty: l.qty }));

  useEffect(() => {
    let alive = true;
    if (items.length === 0) return;
    api.quoteCoins(userId, items)
      .then((q) => { if (alive) setQuote(q); })
      .catch(() => { if (alive) setQuote({ coins: 0, discountPkr: 0 }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, JSON.stringify(items)]);

  const discount = useCoins ? quote.discountPkr : 0;
  const total = Math.max(0, subtotalPkr - discount);

  async function submit() {
    setPlacing(true);
    setError(null);
    try {
      track('checkout_started', { subtotal: subtotalPkr });
      if (useCoins && discount > 0) {
        track('coins_applied', {
          coins: quote.coins,
          discount_pkr: discount,
          pct_of_subtotal: subtotalPkr > 0 ? Math.round((100 * discount) / subtotalPkr) : 0,
        });
      }
      await api.placeOrder({
        items,
        address: { line1: '—', city: '—' },
        phone: '—',
        paymentMethod: 'cod',
        // A coin COUNT, which is a choice. Never a discount amount (§13.2).
        coins: useCoins ? quote.coins : 0,
      });
      track('order_placed', {
        total, payment_method: 'cod', discount_pkr: discount,
      });
      clear();
      await refresh();
      router.replace('/(tabs)/shop');
    } catch (e) {
      // §9.6: say what happened and what to do, not "an error occurred".
      setError(e instanceof Error ? e.message : t.common.retry);
    } finally {
      setPlacing(false);
    }
  }

  return (
    <Screen>
      <Text style={[text.title, { color: theme.text, marginTop: space.xl }]}>
        {t.checkout.title}
      </Text>

      {lines.map((l) => (
        <View key={l.product.id} style={[styles.line, { borderBottomColor: theme.line }]}>
          <Text style={[text.body, { color: theme.text, flex: 1 }]} numberOfLines={1}>
            {l.product.title}
          </Text>
          <Text style={[text.dataSmall, { color: theme.textMuted, marginHorizontal: space.md }]}>
            ×{l.qty}
          </Text>
          <Text style={[text.data, { color: theme.text }]}>
            {formatPkr(l.product.pricePkr * l.qty)}
          </Text>
        </View>
      ))}

      <View style={{ marginTop: space.xl }}>
        <Row label={t.common.pkr} value={formatPkr(subtotalPkr)} />
        {discount > 0 ? (
          <Row label={t.shop.coinsUsed} value={`−${formatPkr(discount)}`} coin />
        ) : null}
        <Row label={t.checkout.payOnDelivery} value={formatPkr(total)} strong />
      </View>

      {quote.discountPkr > 0 ? (
        <Pressable
          onPress={() => setUseCoins((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: useCoins }}
          accessibilityLabel={t.shop.useCoins}
          style={[styles.toggle, { borderColor: useCoins ? theme.coin : theme.line, minHeight: MIN_TAP }]}
        >
          <Text style={[text.body, { color: theme.text, flex: 1 }]}>{t.shop.useCoins}</Text>
          <Text style={[text.coin, { color: useCoins ? theme.coin : theme.textMuted }]}>
            {useCoins ? `−${formatPkr(quote.discountPkr)}` : formatCoins(quote.coins)}
          </Text>
        </Pressable>
      ) : null}

      {/* §7.5: unmissable. Directly above the button, in clay, whenever coins
          are in play. This sentence is what changes doorstep behaviour. */}
      {useCoins && discount > 0 ? (
        <View style={[styles.warning, { borderColor: theme.warn, backgroundColor: theme.raised }]}>
          <Text style={[text.body, { color: theme.text }]}>
            {fill(t.checkout.coinWarning, { coins: formatCoins(quote.coins) })}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={[text.body, { color: theme.warn, marginTop: space.lg }]}>{error}</Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={placing || lines.length === 0}
        accessibilityRole="button"
        accessibilityLabel={t.checkout.confirm}
        style={({ pressed }) => [
          styles.cta,
          {
            // Never brass: this is a button, not a coin value (§9.2).
            backgroundColor: theme.text,
            opacity: pressed || placing || lines.length === 0 ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[text.body, { color: theme.bg }]}>{t.checkout.confirm}</Text>
      </Pressable>

      <Text style={[text.bodySmall, { color: theme.textMuted, marginTop: space.md }]}>
        {t.checkout.weWillConfirm}
      </Text>
    </Screen>
  );
}

function Row({
  label, value, strong, coin,
}: { label: string; value: string; strong?: boolean; coin?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.totalRow}>
      <Text style={[strong ? text.body : text.bodySmall, { color: theme.textMuted, flex: 1 }]}>
        {label}
      </Text>
      <Text
        style={[
          strong ? text.coinLarge : text.data,
          { color: coin ? theme.coin : theme.text },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: space.sm,
  },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: space.xs },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  warning: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  cta: {
    marginTop: space.xl,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
