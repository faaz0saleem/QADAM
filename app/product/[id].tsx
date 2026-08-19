import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Temperature, useTheme } from '../../src/theme/ThemeContext';
import { Screen } from '../../src/components/Screen';
import { space, radius, MIN_TAP } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { formatPkr } from '../../src/lib/format';
import { useI18n } from '../../src/i18n';
import { useAppState } from '../../src/data/AppState';
import { useCart } from '../../src/data/Cart';
import * as api from '../../src/data/api';
import { track } from '../../src/lib/analytics';
import { NotifyMe } from '../../src/components/NotifyMe';
import type { Product } from '../../src/data/types';

/**
 * §7.4 — a product page that reads like a shop, not a rewards catalogue.
 *
 * The saving is stated in rupees, for this user, right now. There is
 * deliberately no copy explaining why the discount on a low-margin item is
 * small: §0 produces roughly 1% on a phone, the formula handles it, and a UI
 * that apologises for the number only draws attention to it.
 */
export default function ProductScreen() {
  return (
    <Temperature mode="spending">
      <ProductBody />
    </Temperature>
  );
}

function ProductBody() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { userId } = useAppState();
  const { add } = useCart();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    api.shopIsOpen().then((o) => { if (alive) setOpen(o); }).catch(() => setOpen(false));
    api.getProducts(userId)
      .then((all) => {
        if (!alive) return;
        const found = all.find((p) => p.id === id) ?? null;
        setProduct(found);
        if (found) {
          track('product_viewed', {
            product_id: found.id,
            coin_discount_available: found.yourDiscountPkr,
          });
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [userId, id]);

  if (!product) {
    return (
      <Screen>
        <Text style={[text.body, { color: theme.textMuted, marginTop: space.xxl }]}>
          {t.shop.outOfStock}
        </Text>
      </Screen>
    );
  }

  const saving = product.yourDiscountPkr * qty;
  const maxQty = Math.max(1, Math.min(product.stock, 10));

  return (
    <Screen>
      <View style={[styles.photo, { backgroundColor: theme.bg, borderColor: theme.line }]} />

      <Text style={[text.title, { color: theme.text, marginTop: space.lg }]}>
        {product.title}
      </Text>

      <Text style={[text.coinLarge, { color: theme.text, marginTop: space.sm }]}>
        {t.common.pkr} {formatPkr(product.pricePkr)}
      </Text>

      {saving > 0 ? (
        // Brass, because it is a coin figure. Nothing else on this page is.
        <Text style={[text.data, { color: theme.coin, marginTop: space.xs }]}>
          {fill(t.shop.saveWithCoins, { amount: formatPkr(saving) })}
        </Text>
      ) : (
        <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.xs }]}>
          {t.shop.noCoinsYet}
        </Text>
      )}

      <View style={styles.qtyRow}>
        {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
          <Pressable
            key={n}
            onPress={() => setQty(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: qty === n }}
            accessibilityLabel={`Quantity ${n}`}
            style={[
              styles.qty,
              { borderColor: qty === n ? theme.text : theme.line, backgroundColor: theme.raised },
            ]}
          >
            <Text style={[text.data, { color: qty === n ? theme.text : theme.textMuted }]}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>

      {open === false ? (
        // §1.5: the notify-me replaces the buy button entirely. Showing both
        // would make the capture look like a consolation prize.
        <>
          <Text style={[text.body, { color: theme.textMuted, marginTop: space.xl }]}>
            {t.shop.openingSoon}
          </Text>
          <NotifyMe productId={product.id} />
        </>
      ) : (
        <Pressable
          onPress={() => {
            add(product, qty);
            track('add_to_cart', { product_id: product.id });
            router.back();
          }}
          disabled={product.stock === 0 || open === null}
          accessibilityRole="button"
          accessibilityLabel={t.shop.addToCart}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: theme.text,
              opacity: pressed || product.stock === 0 || open === null ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[text.body, { color: theme.bg }]}>
            {product.stock === 0 ? t.shop.outOfStock : t.shop.addToCart}
          </Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: {
    marginTop: space.lg,
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  qtyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xl },
  qty: {
    minWidth: MIN_TAP,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  cta: {
    marginTop: space.xl,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
