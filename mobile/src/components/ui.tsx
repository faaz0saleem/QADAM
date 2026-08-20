import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text as RNText,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { motion, radius, space, text as type, urduAdjust, useSurface, MIN_TAP_TARGET } from '@/theme';
import { useI18n } from '@/i18n';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * Locale-aware text. Urdu switches to Nastaliq and to an RTL writing direction
 * here, once, rather than at three hundred call sites.
 */
export function Text({
  children,
  style,
  dim,
  faint,
  variant = 'body',
  numberOfLines,
  adjustsFontSizeToFit,
  accessibilityLabel,
  accessibilityLiveRegion,
}: {
  children: ReactNode;
  style?: TextStyle | TextStyle[];
  dim?: boolean;
  faint?: boolean;
  variant?: keyof typeof type;
  numberOfLines?: number;
  /** Shrink to fit rather than wrap or clip. For the hero counter at 320px. */
  adjustsFontSizeToFit?: boolean;
  /** What a screen reader announces instead of the raw digits. */
  accessibilityLabel?: string;
  /** Announce changes as they happen — for a counter that ticks. */
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
}) {
  const { locale } = useI18n();
  const surface = useSurface();
  const isData = variant.startsWith('data') || variant === 'counter';
  return (
    <RNText
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={[
        type[variant],
        { color: faint ? surface.textFaint : dim ? surface.textDim : surface.text },
        // Numbers stay in the monospace face in every language. A tabular column
        // that changes face between locales stops being a column.
        locale === 'ur' && !isData ? urduAdjust : null,
        style as TextStyle,
      ]}
    >
      {children}
    </RNText>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const surface = useSurface();
  return (
    <View style={[styles.card, { backgroundColor: surface.raised }, style]}>{children}</View>
  );
}

/** Respects RTL: `row` flips to `row-reverse` in Urdu without a second style. */
export function Row({
  children,
  style,
  gap = space.md,
  align = 'center',
  justify = 'flex-start',
  accessible,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: ViewStyle;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  /** Announce the row as one thing rather than as its parts. */
  accessible?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap }, style]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  const surface = useSurface();
  return <View style={[styles.divider, { backgroundColor: surface.rule }]} />;
}

/** §9.6 — empty states are invitations, not apologies. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text dim style={styles.emptyText}>
        {children}
      </Text>
    </View>
  );
}

/**
 * Anything you can press, pressed.
 *
 * §9.7 puts tap targets at 44px and a screen-reader label on every interactive
 * element, and this is where both stop being things each call site has to
 * remember. The label is required by the type, not encouraged by a comment.
 *
 * The feedback is deliberately almost nothing: 4% down on opacity and 1.5% on
 * scale, applied instantly on press and released over §9.5's 180ms. A press
 * state you can describe is a press state that is too big — §9.5 asks for no
 * scattered micro-interactions, and the point of this one is that you feel the
 * surface answer rather than watch it perform.
 */
export function Tappable({
  children,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityHint,
  disabled = false,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'link' | 'checkbox' | 'radio';
  accessibilityHint?: string;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
}) {
  const reduceMotion = useReduceMotion();
  const press = useRef(new Animated.Value(0)).current;

  const to = (value: number) => {
    if (reduceMotion) return;
    Animated.timing(press, {
      toValue: value,
      duration: value === 1 ? 0 : motion.quiet,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      hitSlop={space.sm}
    >
      <Animated.View
        style={[
          { minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
          {
            opacity: disabled
              ? 0.45
              : press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }),
            transform: [
              { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }) },
            ],
          },
          style as ViewStyle,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * A block where a number is about to be.
 *
 * §9.7 says this app runs on a three-year-old Android on mobile data, which
 * means the gap between opening a screen and having something to show is real
 * and is measured in seconds. A spinner in that gap says "wait"; a skeleton in
 * the shape of the answer says "here, nearly" — and because these are laid out
 * at the same sizes as the rows they stand in for, the screen does not jump when
 * the data lands.
 *
 * It breathes rather than sweeps: a gradient shimmer needs a gradient library
 * and a masked layer, and it looks like every other app that ships one.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: ViewStyle;
}) {
  const surface = useSurface();
  const reduceMotion = useReduceMotion();
  const breath = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      breath.setValue(0.55);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 0.9,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0.55,
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius.sm, backgroundColor: surface.sunken, opacity: breath },
        style,
      ]}
    />
  );
}

/** A few skeleton rows, for a list that has not arrived. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.skeletonRows}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton width="55%" height={15} />
          <Skeleton width="22%" height={15} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRows: { gap: space.lg },
  skeletonRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  card: {
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: space.md,
  },
  empty: { paddingVertical: space.xxl, paddingHorizontal: space.lg, alignItems: 'center' },
  emptyText: { textAlign: 'center' },
});
