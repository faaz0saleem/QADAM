import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { radius, space, text as type, MIN_TAP_TARGET, useSurface } from '@/theme';
import { Text } from './ui';
import { useI18n } from '@/i18n';

/**
 * A ruled input. §9.1's language is an account book, so the field is a line
 * being written on rather than a rounded pill.
 *
 * `mono` puts the value in tabular figures, which is not decoration: a phone
 * number and a one-time code are both columns of digits, and proportional
 * numerals make them jump as they are typed.
 */
export const Field = forwardRef<TextInput, TextInputProps & {
  label?: string;
  hint?: string;
  error?: string | null;
  mono?: boolean;
}>(function Field({ label, hint, error, mono = false, style, ...props }, ref) {
  const { rtl } = useI18n();
  const surface = useSurface();

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" dim>
          {label}
        </Text>
      ) : null}

      <TextInput
        ref={ref}
        placeholderTextColor={surface.textFaint}
        // The visible label is the screen-reader label; an input announcing only
        // "text field" is an input nobody can fill in without sight (§9.7).
        accessibilityLabel={label ?? props.placeholder}
        accessibilityHint={hint}
        {...props}
        style={[
          styles.input,
          mono ? type.dataLarge : type.body,
          {
            color: surface.text,
            backgroundColor: surface.sunken,
            borderBottomColor: error ? surface.bad : surface.rule,
            textAlign: rtl && !mono ? 'right' : 'left',
          },
          style,
        ]}
      />

      {/* §9.6 — errors say what happened and what to do. */}
      {error ? (
        <Text variant="bodySmall" style={{ color: surface.bad }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="bodySmall" faint>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  input: {
    minHeight: MIN_TAP_TARGET,
    borderRadius: radius.md,
    borderBottomWidth: 2,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
});
