import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Card, Row, Text } from '@/components/ui';
import { Loading, Notice } from '@/components/Notice';
import { radius, space, useSurface } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { addToCart, loadCart } from '@/lib/cart';
import { formatNumber, formatPkr } from '@/lib/format';

interface Product {
  id: string;
  title: string;
  brand_name: string | null;
  price_pkr: number;
  stock: number;
  images: string[];
  my_discount_pkr: number;
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
      const { data } = await supabase.rpc('store_feed', { p_limit: 60 });
      const found = ((data ?? []) as Product[]).find((p) => p.id === id) ?? null;
      setProduct(found);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <Screen title="" surface="spending">
        <Loading />
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

      {/*
        §7.4 — "'Save PKR 180 with your coins' beats 'up to 10% off' every time."
        And §7.4 again: low-margin goods stay in the catalogue with a ~1% cap and
        NO apologetic copy. If the saving is small, it is shown small and plainly,
        with nothing explaining why.
      */}
      {product.my_discount_pkr > 0 ? (
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

      {soldOut ? (
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
  photo: { aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
});
