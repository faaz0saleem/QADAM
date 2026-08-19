import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View, type TextStyle, type ViewStyle } from 'react-native';

import { earning, radius, space, text as type, urduAdjust } from '@/theme';
import { useI18n } from '@/i18n';

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
  const isData = variant.startsWith('data') || variant === 'counter';
  return (
    <RNText
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={[
        type[variant],
        { color: faint ? earning.textFaint : dim ? earning.textDim : earning.text },
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
  return <View style={[styles.card, style]}>{children}</View>;
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
  return <View style={styles.divider} />;
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: earning.raised,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: earning.rule,
    marginVertical: space.md,
  },
  empty: { paddingVertical: space.xxl, paddingHorizontal: space.lg, alignItems: 'center' },
  emptyText: { textAlign: 'center' },
});
