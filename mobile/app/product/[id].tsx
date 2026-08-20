import { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Card, Row, Skeleton, Text } from '@/components/ui';
import { Notice } from '@/components/Notice';
import { radius, space, useSurface } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { addToCart, loadCart } from '@/lib/cart';
import { formatNumber, formatPkr } from '@/lib/format';

interface Product {
  id: string;
  title: string;
  description: string | null;
  brand_name: string | null;
  category_name: string | null;
  price_pkr: number;
  stock: number;
  images: string[];
  attributes: Record<string, string>;
  my_discount_pkr: number;
  /** §8.3 — a licensed listing we link out to. Never sold here, never in a basket. */
  is_affiliate: boolean;
  affiliate_url: string | null;
}

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const surface = useSurface();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    void (async () => {
      await loadCart();
      // One product by id. This used to pull the first 60 rows of the feed and
      // search them, which quietly stopped finding anything at the 61st SKU.
      const { data } = await supabase.rpc('product_detail', { p_id: id });
      setProduct(((data ?? []) as Product[])[0] ?? null);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <Screen title="" surface="spending">
        <Skeleton height={0} style={styles.photo} />
        <Skeleton width="70%" height={26} />
        <Skeleton width="35%" height={20} />
      </Screen>
    );
  }

  if (!product) {
    return (
      <Screen title={t.shop.title} surface="spending">
        <Notice message={t.errors.generic} />
      </Screen>
    );
  }

  const image = product.images?.[0];
  const soldOut = product.stock <= 0;

  return (
    <Screen title={product.brand_name ?? t.shop.title} surface="spending">
      <View style={[styles.photo, { backgroundColor: surface.sunken }]}>
        {image ? <Image source={{ uri: image }} style={styles.image} resizeMode="cover" /> : null}
      </View>

      <Text variant="screenTitle">{product.title}</Text>
      <Text variant="dataLarge">{formatPkr(product.price_pkr)}</Text>

      {product.description ? (
        <Text variant="body" dim>
          {product.description}
        </Text>
      ) : null}

      {Object.entries(product.attributes ?? {}).length > 0 ? (
        <Card>
          {Object.entries(product.attributes).map(([key, value]) => (
            <Row key={key} justify="space-between">
              <Text variant="bodySmall" dim>
                {key}
              </Text>
              <Text variant="bodySmall">{String(value)}</Text>
            </Row>
          ))}
        </Card>
      ) : null}

      {/*
        §7.4 — "'Save PKR 180 with your coins' beats 'up to 10% off' every time."
        And §7.4 again: low-margin goods stay in the catalogue with a ~1% cap and
        NO apologetic copy. If the saving is small, it is shown small and plainly,
        with nothing explaining why.
      */}
      {/*
        §8 — an affiliate listing is somebody else's parcel. The database refuses
        to put one on an order line; this is the same refusal said before anyone
        gets as far as a basket, with the link they actually wanted.
      */}
      {product.is_affiliate ? (
        <>
          <Notice tone="quiet" message={t.shop.partnerNote} />
          <Button
            label={t.shop.viewAtPartner}
            onPress={() =>
              product.affiliate_url ? void Linking.openURL(product.affiliate_url) : undefined
            }
          />
        </>
      ) : product.my_discount_pkr > 0 ? (
        <Card>
          <Text variant="sectionTitle" style={{ color: surface.good }}>
            {fill(t.shop.saveWithCoins, { amount: formatNumber(product.my_discount_pkr) })}
          </Text>
          <Row justify="space-between">
            <Text variant="bodySmall" dim>
              {t.shop.toPay}
            </Text>
            <Text variant="data">{formatPkr(product.price_pkr - product.my_discount_pkr)}</Text>
          </Row>
        </Card>
      ) : (
        <Text variant="bodySmall" dim>
          {t.shop.noDiscountYet}
        </Text>
      )}

      {product.is_affiliate ? null : soldOut ? (
        <Notice message={t.shop.outOfStock} />
      ) : (
        <>
          {product.stock <= 3 ? (
            <Text variant="bodySmall" faint>
              {fill(t.shop.lastFew, { count: formatNumber(product.stock) })}
            </Text>
          ) : null}
          <Button
            label={added ? t.shop.added : t.shop.addToCart}
            onPress={() => {
              void addToCart({
                productId: product.id,
                title: product.title,
                pricePkr: product.price_pkr,
                image: image ?? null,
              });
              setAdded(true);
            }}
          />
          {added ? (
            <Button variant="quiet" label={t.shop.viewCart} onPress={() => router.push('/cart')} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { aspectRatio: 1, width: '100%', height: undefined, borderRadius: radius.lg, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
