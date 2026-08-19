import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';

import { earning, space, text as type, MIN_TAP_TARGET } from '@/theme';
import { Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useForegroundSync } from '@/hooks/useSteps';

/**
 * §9.4 — five bottom tabs: Steps · Board · Shop · Wallet · You.
 *
 * Shop sits between Board and Wallet, which is also the seam between the two
 * temperatures of §9.1: everything left of it is the dark earning half,
 * everything from it rightward touches the light spending one.
 *
 * Built on expo-router's headless tabs rather than the stock tab bar, because
 * the stock one is an icon row and §9.1 asks for something else: the visual
 * language is currency and roadside milestones — stamped numerals and ruled
 * lines — not fitness-app iconography. Each tab is a rule that fills when active.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  useForegroundSync();

  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <View style={[styles.bar, { paddingBottom: insets.bottom || space.md }]}>
          <TabTrigger name="steps" href="/" asChild>
            <TabButton label={t.tabs.steps} />
          </TabTrigger>
          <TabTrigger name="board" href="/board" asChild>
            <TabButton label={t.tabs.board} />
          </TabTrigger>
          <TabTrigger name="shop" href="/shop" asChild>
            <TabButton label={t.tabs.shop} />
          </TabTrigger>
          <TabTrigger name="wallet" href="/wallet" asChild>
            <TabButton label={t.tabs.wallet} />
          </TabTrigger>
          <TabTrigger name="you" href="/you" asChild>
            <TabButton label={t.tabs.you} />
          </TabTrigger>
        </View>
      </TabList>
    </Tabs>
  );
}

function TabButton({
  label,
  isFocused,
  ...props
}: TabTriggerSlotProps & { label: string }) {
  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}
      style={styles.tab}
    >
      <View style={[styles.mark, isFocused && styles.markActive]} />
      <Text variant="label" dim={!isFocused} style={isFocused ? styles.labelActive : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: earning.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: earning.rule,
    paddingTop: space.sm,
  },
  tab: {
    flex: 1,
    minHeight: MIN_TAP_TARGET,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: space.sm,
  },
  // The ruled mark above the label: an empty rule when inactive, filled when active.
  mark: { width: 24, height: 2, backgroundColor: earning.rule },
  markActive: { backgroundColor: earning.ruleFilled },
  labelActive: { ...type.label, color: earning.text },
});
