import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  motion,
  space,
  surfaceFor,
  takeTemperatureChange,
  text as type,
  SurfaceProvider,
  useSurface,
  type SurfaceMode,
} from '@/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';
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
  surface = 'earning',
}: {
  title: string;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /**
   * §9.1 — which temperature this screen is. The store is the light half, and
   * the change is meant to feel like stepping indoors.
   */
  surface?: SurfaceMode;
}) {
  return (
    <SurfaceProvider mode={surface}>
      <ScreenBody mode={surface} title={title} onRefresh={onRefresh} refreshing={refreshing}>
        {children}
      </ScreenBody>
    </SurfaceProvider>
  );
}

/**
 * §9.1 — "The transition between them is the most important moment in the app:
 * it should feel like stepping indoors."
 *
 * Stepping indoors is two things happening at once and not quite together: the
 * light changes, and then you see the room. So the background travels from the
 * temperature you were just standing in to this one over 240ms, while the
 * content arrives on a shorter, later curve — the room brightens, then the
 * shelves resolve.
 *
 * The from-colour comes from a module-level record rather than from the tree,
 * because the screen you are leaving has already unmounted by the time this one
 * renders. See src/theme/temperature.ts.
 *
 * Within a temperature this costs nothing: takeTemperatureChange returns null,
 * no Animated.Value is driven, and the background is a plain string. §9.5 —
 * everything that is not the mint or this stays quiet.
 */
function useEnteringTemperature(mode: SurfaceMode, to: string) {
  const reduceMotion = useReduceMotion();
  // Read once per mount. Calling it is what records the new mode, so a second
  // call in the same render would report "no change" and lose the transition.
  const from = useRef<SurfaceMode | null | undefined>(undefined);
  if (from.current === undefined) from.current = takeTemperatureChange(mode);

  const changing = from.current !== null && !reduceMotion;
  const light = useRef(new Animated.Value(changing ? 0 : 1)).current;
  const settle = useRef(new Animated.Value(changing ? 0 : 1)).current;

  useEffect(() => {
    if (!changing) return;
    Animated.parallel([
      Animated.timing(light, {
        toValue: 1,
        duration: motion.temperature,
        easing: Easing.inOut(Easing.cubic),
        // A background colour cannot be interpolated on the native thread.
        useNativeDriver: false,
      }),
      Animated.timing(settle, {
        toValue: 1,
        duration: motion.quiet,
        delay: motion.temperature - motion.quiet,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [changing, light, settle]);

  return {
    background: changing
      ? light.interpolate({
          inputRange: [0, 1],
          outputRange: [surfaceFor(from.current as SurfaceMode).bg, to],
        })
      : to,
    // Never all the way to zero: a screen that blinks out is a screen that
    // looks like it failed to load, which is the opposite of the feeling.
    contentOpacity: changing
      ? settle.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] })
      : 1,
  };
}

function ScreenBody({
  mode,
  title,
  children,
  onRefresh,
  refreshing = false,
}: {
  mode: SurfaceMode;
  title: string;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { balance } = useWallet();
  const surface = useSurface();
  const { background, contentOpacity } = useEnteringTemperature(mode, surface.bg);

  return (
    <Animated.View style={[styles.root, { paddingTop: insets.top, backgroundColor: background }]}>
      <Animated.View style={{ flex: 1, opacity: contentOpacity }}>
      <View style={styles.header}>
        {/* §9.7 — works at 320px. A long Urdu title beside a six-digit balance
            is the case that overflows, so the title yields and the balance,
            which is the hook, never wraps. */}
        <Text variant="screenTitle" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
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
            ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={surface.textDim} />
            : undefined
        }
      >
        {children}
      </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  title: { flexShrink: 1, marginEnd: space.md },
  balance: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, flexShrink: 0 },
  balanceLabel: { ...type.label },
  body: { paddingHorizontal: space.lg, gap: space.lg },
});
