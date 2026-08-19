import React from 'react';
import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { earning, MIN_TAP } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { useI18n } from '../../src/i18n';

/**
 * §9.4 — five tabs: Steps · Board · Shop · Wallet · You.
 *
 * The bar itself stays on the earning temperature even under the shop, so the
 * transition between the two halves reads as walking through a door rather than
 * the whole app changing identity.
 */
function TabGlyph({ name, focused }: { name: string; focused: boolean }) {
  // Deliberately typographic rather than iconographic: §9.1's language is
  // stamped numerals and ruled lines, not a fitness app's icon set.
  return (
    <View style={{ minHeight: MIN_TAP, justifyContent: 'center', alignItems: 'center' }}>
      <Text
        style={[
          text.label,
          { color: focused ? earning.text : earning.textMuted, letterSpacing: 0.8 },
        ]}
      >
        {name}
      </Text>
      <View
        style={{
          height: 2,
          width: 16,
          marginTop: 4,
          backgroundColor: focused ? earning.coin : 'transparent',
        }}
      />
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useI18n();
  const labels: Record<string, string> = {
    index: t.tabs.steps,
    board: t.tabs.board,
    shop: t.tabs.shop,
    wallet: t.tabs.wallet,
    you: t.tabs.you,
  };

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: earning.bg,
          borderTopColor: earning.line,
          borderTopWidth: 1,
          height: 62,
          paddingTop: 6,
        },
        tabBarAccessibilityLabel: labels[route.name] ?? route.name,
        tabBarIcon: ({ focused }) => (
          <TabGlyph name={labels[route.name] ?? route.name} focused={focused} />
        ),
      })}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="board" />
      <Tabs.Screen name="shop" />
      <Tabs.Screen name="wallet" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}
