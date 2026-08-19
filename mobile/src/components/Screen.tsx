import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { earning, space, text as type } from '@/theme';
import { CoinValue } from './Coin';
import { Text } from './ui';
import { useI18n } from '@/i18n';
import { useWallet } from '@/hooks/useWallet';

/**
 * Every screen in the earning half.
 *
 * §9.4: "The coin balance is pinned in the header on every single screen, in
 * brass, in tabular figures. It is the hook, and it should never be more than one
 * glance away." That is why it lives here and not in each screen — a screen
 * cannot forget to show it.
 */
export function Screen({
  title,
  children,
  onRefresh,
  refreshing = false,
}: {
  title: string;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { balance } = useWallet();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text variant="screenTitle">{title}</Text>
        <View style={styles.balance}>
          <CoinValue coins={balance} size="medium" />
          <Text variant="label" faint style={styles.balanceLabel}>
            {t.wallet.balance}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xxxl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh
            ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={earning.textDim} />
            : undefined
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: earning.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  balance: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  balanceLabel: { ...type.label },
  body: { paddingHorizontal: space.lg, gap: space.lg },
});
