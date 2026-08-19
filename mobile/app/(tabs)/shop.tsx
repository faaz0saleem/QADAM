import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Field } from '@/components/Field';
import { Button } from '@/components/Button';
import { Card, EmptyState, Text } from '@/components/ui';
import { Loading, Notice } from '@/components/Notice';
import { radius, space, useSurface } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { useStoreFeed, type StoreProduct } from '@/hooks/useStore';
import { loadCart, useCart } from '@/lib/cart';
import { formatNumber, formatPkr } from '@/lib/format';

/**
 * §9.1 — the spending half. Light, airy, product-forward, and the change from
 * the dark earning half is meant to feel like stepping indoors.
 *
 * §7.4 — "The store must feel like a shop, not a rewards catalogue. This is the
 * single biggest visual differentiator from everything else in this category —
 * the 'points catalogue' aesthetic is why incumbents feel cheap."
 *
 * So: real photography at the top of every card, the price in plain rupees, and
 * the coin saving as a line beneath it rather than a badge shouting a percentage.
 */
export default function ShopScreen() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const { products, loading, failed, reload } = useStoreFeed(search);
  const cart = useCart();
  const router = useRouter();

  useEffect(() => {
    void loadCart();
  }, []);

  return (
    <Screen title={t.shop.title} surface="spending" onRefresh={reload} refreshing={loading}>
      <Field
        value={search}
        onChangeText={setSearch}
        placeholder={t.shop.title}
        autoCorrect={false}
      />

      <Button variant="quiet" label={t.shop.ordersTitle} onPress={() => router.push('/orders')} />

      {cart.count > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.shop.viewCart}, ${cart.count}`}
          onPress={() => router.push('/cart')}
        >
          <Notice
            tone="quiet"
            message={`${t.shop.viewCart} · ${formatNumber(cart.count)} · ${formatPkr(cart.subtotalPkr)}`}
          />
        </Pressable>
      ) : null}

      {failed ? (
        <Notice message={t.errors.generic} actionLabel={t.errors.retry} onAction={reload} />
      ) : loading && products.length === 0 ? (
        <Loading />
      ) : products.length === 0 ? (
        <EmptyState>{t.shop.empty}</EmptyState>
      ) : (
        <View style={styles.grid}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function ProductCard({ product }: { product: StoreProduct }) {
  const { t } = useI18n();
  const router = useRouter();
  const surface = useSurface();
  const image = product.images?.[0];
  const soldOut = product.stock <= 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.title}, ${formatPkr(product.price_pkr)}`}
      onPress={() => router.push(`/product/${product.id}`)}
      style={styles.cardWrap}
    >
      <Card style={styles.card}>
        <View style={[styles.photo, { backgroundColor: surface.sunken }]}>
          {image ? <Image source={{ uri: image }} style={styles.image} resizeMode="cover" /> : null}
        </View>

        <Text variant="bodySmall" numberOfLines={2}>
          {product.title}
        </Text>
        {product.brand_name ? (
          <Text variant="label" faint numberOfLines={1}>
            {product.brand_name}
          </Text>
        ) : null}

        <Text variant="data">{formatPkr(product.price_pkr)}</Text>

        {/*
          §7.4 — the saving this person can make today, not a hypothetical
          maximum. Deliberately NOT brass: this is a rupee figure, and §9.2
          reserves brass for coin values. Spending it here would be the exact
          decorative use that stops the coin feeling like currency.
        */}
        {product.my_discount_pkr > 0 ? (
          <Text variant="dataSmall" style={{ color: surface.good }} numberOfLines={1}>
            {fill(t.shop.saveWithCoins, { amount: formatNumber(product.my_discount_pkr) })}
          </Text>
        ) : (
          <Text variant="label" faint numberOfLines={1}>
            {t.shop.noDiscountYet}
          </Text>
        )}

        {soldOut ? (
          <Text variant="label" style={{ color: surface.bad }}>
            {t.shop.outOfStock}
          </Text>
        ) : product.stock <= 3 ? (
          <Text variant="label" faint>
            {fill(t.shop.lastFew, { count: formatNumber(product.stock) })}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  // Two to a row at 320px and up, which is the width §9.7 names as the floor.
  cardWrap: { flexGrow: 1, flexBasis: '46%' },
  card: { gap: space.xs, padding: space.md },
  photo: { aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
