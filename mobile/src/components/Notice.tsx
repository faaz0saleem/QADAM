import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { radius, space, useSurface } from '@/theme';
import { Text } from './ui';
import { Button } from './Button';

/**
 * §9.6 — "Errors say what happened and what to do."
 *
 * Not a toast: a toast that appears while the user is looking elsewhere is a
 * message that was never delivered. This sits in the flow, stays until the
 * situation changes, and carries the action that fixes it.
 */
export function Notice({
  tone = 'bad',
  message,
  actionLabel,
  onAction,
}: {
  tone?: 'bad' | 'good' | 'quiet';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const surface = useSurface();
  const accent =
    tone === 'bad' ? surface.bad : tone === 'good' ? surface.good : surface.rule;

  return (
    <View style={[styles.notice, { borderLeftColor: accent, backgroundColor: surface.raised }]}>
      <Text variant="bodySmall">{message}</Text>
      {actionLabel && onAction ? (
        <Button variant="quiet" label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

/**
 * A screen that has asked for its data and not got it yet.
 *
 * Deliberately quiet and deliberately not a skeleton: skeletons imply a shape
 * the data may not have, and on a slow connection in this market they flicker
 * for long enough to read as a broken layout.
 */
export function Loading() {
  const surface = useSurface();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={surface.textFaint} />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    borderRadius: radius.md,
    borderLeftWidth: 2,
    padding: space.lg,
    gap: space.sm,
  },
  action: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  loading: { paddingVertical: space.xxxl, alignItems: 'center' },
});
