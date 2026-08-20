import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Field } from '@/components/Field';
import { Button } from '@/components/Button';
import { Card, EmptyState, Skeleton, Text } from '@/components/ui';
import { Notice } from '@/components/Notice';
import { radius, space, useSurface, MIN_TAP_TARGET } from '@/theme';
import { useI18n, fill } from '@/i18n';
import {
  useStoreCategories,
  useStoreFeed,
  type StoreProduct,
  type StoreSort,
} from '@/hooks/useStore';
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
 *
 * The rail and the sort exist because the catalogue is no longer four items.
 * §7.4 also says "curate hard, twenty good SKUs beat five thousand dropshipped
 * ones" — which is an instruction about what goes IN, not an excuse to make
 * fifty items unbrowsable. A shop with categories is still a curated shop.
 */
export default function ShopScreen() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<StoreSort>('new');

  const categories = useStoreCategories();
  const { products, loading, loadingMore, exhausted, failed, reload, loadMore } = useStoreFeed(
    search,
    category,
    sort,
  );
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

      {categories.length > 1 ? (
        <Rail
          options={[
            { key: null, label: t.shop.allCategories },
            ...categories.map((c) => ({ key: c.id, label: c.name })),
          ]}
          selected={category}
          onSelect={setCategory}
        />
      ) : null}

      <Rail
        options={[
          { key: 'new' as const, label: t.shop.sortNew },
          { key: 'saving' as const, label: t.shop.sortSaving },
          { key: 'price_asc' as const, label: t.shop.sortPriceLow },
          { key: 'price_desc' as const, label: t.shop.sortPriceHigh },
        ]}
        selected={sort}
        onSelect={setSort}
      />

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

      <Button variant="quiet" label={t.shop.ordersTitle} onPress={() => router.push('/orders')} />

      {failed ? (
        <Notice message={t.errors.generic} actionLabel={t.errors.retry} onAction={reload} />
      ) : loading && products.length === 0 ? (
        // §9.7 — the gap before the first page lands is measured in seconds on
        // the hardware this ships to. Cards the size of the cards that are
        // coming, so the grid does not jump when they arrive.
        <SkeletonGrid />
      ) : products.length === 0 ? (
        <EmptyState>{t.shop.empty}</EmptyState>
      ) : (
        <>
          <View style={styles.grid}>
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </View>
          {!exhausted ? (
            <Button
              variant="quiet"
              label={t.shop.loadMore}
              loading={loadingMore}
              onPress={() => void loadMore()}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

/**
 * A row of choices that scrolls sideways.
 *
 * Not a dropdown: a dropdown hides the options, and on a shop the options ARE
 * the navigation. §9.1's language is ruled lines, so a selected chip is a filled
 * rule under its label rather than a coloured pill — and never brass (§9.2).
 */
function Rail<T extends string | null>({
  options,
  selected,
  onSelect,
}: {
  options: { key: T; label: string }[];
  selected: T;
  onSelect: (key: T) => void;
}) {
  const surface = useSurface();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {options.map((option) => {
        const active = option.key === selected;
        return (
          <Pressable
            key={option.key ?? '__all'}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onSelect(option.key)}
            style={styles.railItem}
          >
            <Text variant="label" dim={!active}>
              {option.label}
            </Text>
            <View
              style={[
                styles.railMark,
                { backgroundColor: active ? surface.ruleFilled : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function SkeletonGrid() {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={styles.cardWrap}>
          <Card style={styles.card}>
            <Skeleton height={0} style={styles.skeletonPhoto} />
            <Skeleton width="80%" height={13} />
            <Skeleton width="45%" height={13} />
          </Card>
        </View>
      ))}
    </View>
  );
}

function ProductCard({ product }: { product: StoreProduct }) {
  const { t } = useI18n();
  const router = useRouter();
  const surface = useSurface();
  const image = product.images?.[0];
  const soldOut = product.stock <= 0 && !product.is_affiliate;

  /**
   * README §8.3 — an affiliate row is a licensed listing we LINK OUT to and
   * never fulfil ourselves. The database refuses to sell one; this is the same
   * refusal said in the interface, so nobody discovers it at checkout.
   */
  const open = () =>
    product.is_affiliate && product.affiliate_url
      ? void Linking.openURL(product.affiliate_url)
      : router.push(`/product/${product.id}`);

  return (
    <Pressable
      accessibilityRole={product.is_affiliate ? 'link' : 'button'}
      accessibilityLabel={`${product.title}, ${formatPkr(product.price_pkr)}`}
      onPress={open}
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
        {product.is_affiliate ? (
          <Text variant="label" faint numberOfLines={2}>
            {t.shop.partnerNote}
          </Text>
        ) : product.my_discount_pkr > 0 ? (
          <Text variant="dataSmall" style={{ color: surface.good }} numberOfLines={1}>
            {fill(t.shop.saveWithCoins, { amount: formatNumber(product.my_discount_pkr) })}
          </Text>
        ) : (
          <Text variant="label" faint numberOfLines={1}>
            {t.shop.noDiscountYet}
          </Text>
        )}

        {product.is_affiliate ? (
          <Text variant="label" numberOfLines={1} style={{ color: surface.textDim }}>
            {t.shop.viewAtPartner}
          </Text>
        ) : soldOut ? (
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
  rail: { gap: space.lg, paddingEnd: space.lg },
  railItem: { minHeight: MIN_TAP_TARGET, justifyContent: 'center', gap: space.sm },
  railMark: { height: 2, width: '100%', borderRadius: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  // Two to a row at 320px and up, which is the width §9.7 names as the floor.
  cardWrap: { flexGrow: 1, flexBasis: '46%' },
  card: { gap: space.xs, padding: space.md },
  photo: { aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden' },
  skeletonPhoto: { aspectRatio: 1, width: '100%', height: undefined },
  image: { width: '100%', height: '100%' },
});
