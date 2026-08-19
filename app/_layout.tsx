import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider } from '../src/i18n';
import { AppStateProvider } from '../src/data/AppState';
import { CartProvider } from '../src/data/Cart';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppStateProvider>
          <CartProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </CartProvider>
        </AppStateProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
