import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Temperature, useTheme } from '../../src/theme/ThemeContext';
import { Screen } from '../../src/components/Screen';
import { CoinHeader } from '../../src/components/CoinHeader';
import { space, radius, MIN_TAP } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { formatPkr } from '../../src/lib/format';
import { useI18n } from '../../src/i18n';
import { useAppState } from '../../src/data/AppState';
import * as api from '../../src/data/api';
import type { Product } from '../../src/data/types';

/**
 * §7.4 — the shop must feel like a shop, not a rewards catalogue. That is the
 * single biggest visual differentiator in this category.
 *
 * Crossing the tab bar into here is §9.1's most important moment: the ground
 * goes from ink to paper. Nothing else about the app changes.
 */
export default function ShopScreen() {
  return (
    <Temperature mode="spending">
      <ShopBody />
    </Temperature>
  );
}

function ShopBody() {
  const theme = useTheme();
  const { t } = useI18n();
  const { balance, userId } = useAppState();
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    let alive = true;
    api.getProducts(userId).then((p) => { if (alive) setProducts(p); }).catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  return (
    <>
      <CoinHeader balance={balance} title={t.shop.title} />
      <Screen>
        {products.length === 0 ? (
          <Text style={[text.body, { color: theme.textMuted, marginTop: space.xxl }]}>
            {t.shop.empty}
          </Text>
        ) : null}

        <View style={styles.grid}>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </View>
      </Screen>
    </>
  );
}

function ProductCard({ product }: { product: Product }) {
  const theme = useTheme();
  const { t, fill } = useI18n();

  // §7.4: show what THIS user saves right now, given their balance — not a
  // hypothetical maximum. "Save PKR 180 with your coins" beats "up to 10% off".
  //
  // Note there is deliberately no copy apologising for a small discount on a
  // low-margin product. §0 produces roughly 1% on a phone; the formula handles
  // it and the UI says nothing about it.
  const saving = product.yourDiscountPkr;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.title}, ${formatPkr(product.pricePkr)} rupees${
        saving > 0 ? `, save ${formatPkr(saving)} rupees with your coins` : ''
      }`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.raised,
          borderColor: theme.line,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.photo, { backgroundColor: theme.bg, borderColor: theme.line }]} />

      <Text style={[text.body, { color: theme.text, marginTop: space.md }]} numberOfLines={2}>
        {product.title}
      </Text>

      <Text style={[text.data, { color: theme.text, marginTop: space.xs }]}>
        {t.common.pkr} {formatPkr(product.pricePkr)}
      </Text>

      {product.stock === 0 ? (
        <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.xs }]}>
          {t.shop.outOfStock}
        </Text>
      ) : saving > 0 ? (
        // Brass, because this is a coin figure. Nothing else on this card is.
        <Text style={[text.dataSmall, { color: theme.coin, marginTop: space.xs }]}>
          {fill(t.shop.saveWithCoins, { amount: formatPkr(saving) })}
        </Text>
      ) : (
        <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.xs }]}>
          {t.shop.noCoinsYet}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: space.lg,
  },
  card: {
    width: '48%',
    marginBottom: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: MIN_TAP * 4,
  },
  // Real product photography goes here (§7.4). The placeholder keeps the card's
  // proportions honest so the layout does not change when photos land.
  photo: {
    aspectRatio: 1,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
