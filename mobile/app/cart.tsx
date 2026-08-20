import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Card, Divider, EmptyState, Row, Text } from '@/components/ui';
import { Notice } from '@/components/Notice';
import { space, useSurface } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { clearCart, loadCart, setQty, useCart } from '@/lib/cart';
import { refreshWallet } from '@/hooks/useWallet';
import { openGroupOrder } from '@/hooks/useGroupOrder';
import { useTeam } from '@/hooks/useTeam';
import { formatNumber, formatPkr } from '@/lib/format';

/**
 * Basket and checkout in one screen. §7.5's warning has to be visible at the
 * moment of committing, not on a page before it.
 *
 * The client sends product ids, quantities, an address and a phone number. The
 * subtotal shown here is for the shopper's benefit; every figure that matters is
 * recomputed server-side at place_order, from the products table.
 */
export default function CartScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const surface = useSurface();
  const cart = useCart();

  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [useCoins, setUseCoins] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = useTeam();

  useEffect(() => {
    void loadCart();
  }, []);

  const place = async () => {
    setPlacing(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('place_order', {
      p_items: cart.lines.map((l) => ({ product_id: l.productId, qty: l.qty })),
      p_address: address.trim(),
      p_phone: phone.trim(),
      p_payment_method: 'cod',
      p_use_coins: useCoins,
    });
    setPlacing(false);

    if (rpcError) {
      // The basket is deliberately left alone. Someone whose order failed
      // should not also have to rebuild it.
      setError(rpcError.message || t.shop.errorPlace);
      return;
    }

    await clearCart();
    await refreshWallet();

    const discount = (data as { discount_pkr?: number })?.discount_pkr ?? 0;
    Alert.alert(
      t.shop.placed,
      discount > 0 ? `${t.shop.placedBody}\n\n${t.shop.burnWarning}` : t.shop.placedBody,
    );
    router.replace('/orders');
  };

  /**
   * §7.6, and the co-payment shape §13.3 requires: the same basket, but every
   * other member of your team has to agree to it, and everyone who agrees pays
   * for it out of their own coins.
   *
   * The basket is NOT cleared here. Nothing has been ordered yet — the team has
   * to say yes first — and emptying someone's basket on the strength of a
   * question they have not had answered is how you lose the sale twice.
   */
  const askTheTeam = async () => {
    setPlacing(true);
    setError(null);
    const { order, error: rpcError } = await openGroupOrder(
      cart.lines.map((l) => ({ product_id: l.productId, qty: l.qty })),
      address.trim(),
      phone.trim(),
    );
    setPlacing(false);

    if (rpcError || !order) {
      setError(rpcError ?? t.errors.generic);
      return;
    }
    router.push(`/group/${order.id}`);
  };

  if (cart.ready && cart.lines.length === 0) {
    return (
      <Screen title={t.shop.cartTitle} surface="spending">
        <EmptyState>{t.shop.cartEmpty}</EmptyState>
      </Screen>
    );
  }

  return (
    <Screen title={t.shop.cartTitle} surface="spending">
      <Card>
        {cart.lines.map((line) => (
          <View key={line.productId}>
            <Row justify="space-between">
              <View style={styles.lineText}>
                <Text variant="bodySmall" numberOfLines={2}>
                  {line.title}
                </Text>
                <Text variant="dataSmall" dim>
                  {formatPkr(line.pricePkr, locale)} × {formatNumber(line.qty)}
                </Text>
              </View>
              <Row gap={space.md}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.shop.remove}: ${line.title}`}
                  onPress={() => void setQty(line.productId, line.qty - 1)}
                >
                  <Text variant="dataLarge" dim>
                    −
                  </Text>
                </Pressable>
                <Text variant="data">{formatNumber(line.qty)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${line.title} +1`}
                  onPress={() => void setQty(line.productId, line.qty + 1)}
                >
                  <Text variant="dataLarge" dim>
                    +
                  </Text>
                </Pressable>
              </Row>
            </Row>
            <Divider />
          </View>
        ))}

        <Row justify="space-between">
          <Text variant="bodySmall" dim>
            {t.shop.subtotal}
          </Text>
          <Text variant="data">{formatPkr(cart.subtotalPkr, locale)}</Text>
        </Row>
      </Card>

      <Card>
        <Field
          label={t.shop.address}
          value={address}
          onChangeText={setAddress}
          multiline
          numberOfLines={3}
        />
        <Field
          label={t.shop.phone}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="0300 1234567"
          mono
        />
      </Card>

      <Card>
        <Row justify="space-between">
          <Text variant="sectionTitle">{t.shop.useCoins}</Text>
          {/*
            Not brass. §9.2 reserves it for coin VALUES, and a switch is a
            control, not a value — colouring it brass because the switch is
            "about coins" is precisely the decorative use that stops the coin
            reading as currency.
          */}
          <Switch
            value={useCoins}
            onValueChange={setUseCoins}
            accessibilityLabel={t.shop.useCoins}
            trackColor={{ true: surface.ruleFilled, false: surface.rule }}
          />
        </Row>
        <Text variant="bodySmall" dim>
          {t.shop.cashOnDelivery}
        </Text>
      </Card>

      {/*
        §7.5 — "Build this rule and make it unmissable at checkout: spend coins on
        an order and refuse the delivery, and the coins are gone."
        Directly above the button, in the clay that means loss everywhere else in
        the app. This is the whole mechanism for getting the return rate down, and
        it only works if people read it before they commit rather than after.
      */}
      {useCoins ? <Notice tone="bad" message={t.shop.burnWarning} /> : null}

      {error ? <Notice message={error} /> : null}

      <Button
        label={t.shop.checkout}
        onPress={() => void place()}
        loading={placing}
        disabled={address.trim().length < 8 || phone.trim().length < 10}
      />

      {/*
        Only offered to someone who has a team with somebody else in it. A
        button that always fails with "you are not in a team" is worse than no
        button — §9.6, errors say what happened and what to do, and the best
        version of that is not asking a question with only one answer.
      */}
      {team.team && team.roster.length > 1 ? (
        <View style={styles.together}>
          <Button
            variant="quiet"
            label={t.group.start}
            onPress={() => void askTheTeam()}
            loading={placing}
            disabled={address.trim().length < 10 || phone.trim().length < 10}
          />
          <Text variant="label" faint>
            {t.group.startHint}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lineText: { flexShrink: 1, gap: 2, paddingEnd: space.md },
  together: { gap: space.xs },
});
