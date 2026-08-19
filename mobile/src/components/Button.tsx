import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { earning, radius, space, MIN_TAP_TARGET } from '@/theme';
import { Text } from './ui';

/**
 * The only button in the app.
 *
 * Deliberately not brass. §9.2: brass is for coin values, and "the moment it
 * appears on a button that isn't about coins, the coin stops feeling like
 * currency." A primary action reads as a filled ruled block instead.
 */
export function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'quiet';
  style?: ViewStyle;
}) {
  const inert = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityLabel={label}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.quiet,
        inert && styles.inert,
        pressed && !inert && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? earning.bg : earning.text} />
      ) : (
        <Text variant="sectionTitle" style={variant === 'primary' ? styles.primaryLabel : undefined}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: earning.ruleFilled },
  primaryLabel: { color: earning.bg },
  quiet: { backgroundColor: 'transparent' },
  inert: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
