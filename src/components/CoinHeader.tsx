import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { space } from '../theme/tokens';
import { text } from '../theme/type';
import { MintCounter } from './MintCounter';
import { useI18n } from '../i18n';

/**
 * §9.4 — "The coin balance is pinned in the header on every single screen, in
 * brass, in tabular figures. It is the hook, and it should never be more than
 * one glance away."
 *
 * Rendered by the tab layout, so no screen can forget it.
 */
export function CoinHeader({ balance, title }: { balance: number; title?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + space.sm,
          backgroundColor: theme.bg,
          borderBottomColor: theme.line,
        },
      ]}
    >
      <Text style={[text.heading, { color: theme.text }]} numberOfLines={1}>
        {title ?? ''}
      </Text>
      <View style={styles.coin}>
        <MintCounter value={balance} />
        <Text style={[text.label, { color: theme.textMuted, marginLeft: space.sm }]}>
          {t.wallet.balance}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  coin: { flexDirection: 'row', alignItems: 'baseline' },
});
