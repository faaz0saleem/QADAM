import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { radius, space, MIN_TAP_TARGET, useSurface } from '@/theme';
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
  const surface = useSurface();
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
        variant === 'primary'
          ? { backgroundColor: surface.ruleFilled }
          // A hairline, so a quiet button still reads as something you press.
          // Without it, centred text on the light half of the app is
          // indistinguishable from a section heading.
          : [styles.quiet, { borderColor: surface.rule }],
        inert && styles.inert,
        pressed && !inert && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? surface.bg : surface.text} />
      ) : (
        <Text
          variant="sectionTitle"
          style={variant === 'primary' ? { color: surface.bg } : undefined}
        >
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
  quiet: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth },
  inert: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
