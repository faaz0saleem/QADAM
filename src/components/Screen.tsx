import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { space } from '../theme/tokens';

/**
 * Every screen sits on its temperature's base colour and leaves room for the
 * pinned coin header above it.
 */
export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = {
    paddingHorizontal: space.lg,
    paddingBottom: insets.bottom + space.xxl,
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      {scroll ? (
        <ScrollView
          contentContainerStyle={[pad, style]}
          showsVerticalScrollIndicator={false}
          // §9.7: works offline and on a slow device — no fancy scroll effects.
          overScrollMode="never"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, pad, style]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
