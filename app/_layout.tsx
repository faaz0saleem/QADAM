import React, { useCallback, useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { fontAssets } from '../src/theme/fonts';
import { earning } from '../src/theme/tokens';
import { I18nProvider } from '../src/i18n';
import { AppStateProvider, useAppState } from '../src/data/AppState';
import { CartProvider } from '../src/data/Cart';
import { isConfigured } from '../src/lib/supabase';

/**
 * Sends a signed-out user to sign-in, and only once the session has actually
 * been read — redirecting before that flashes the sign-in screen at someone who
 * is already signed in, every cold start.
 *
 * With no Supabase project configured the app runs on demo data and never asks
 * anyone to sign in, so the §9 design work is reviewable before any account
 * exists (see HUMAN_TASKS.md).
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, userId } = useAppState();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !isConfigured) return;
    const onSignIn = segments[0] === 'sign-in';
    if (!userId && !onSignIn) router.replace('/sign-in');
    if (userId && onSignIn) router.replace('/(tabs)');
  }, [ready, userId, segments, router]);

  return <>{children}</>;
}

// Hold the splash until the fonts are in. §9.3 makes tabular figures
// non-negotiable, and a first frame in the fallback face reflows every number on
// the screen the moment the real one loads.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  const onReady = useCallback(() => {
    // Hide on an error too: shipping the app in a fallback face is bad, and
    // holding a splash screen forever is worse.
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: earning.bg }} />;
  }

  return (
    <SafeAreaProvider onLayout={onReady}>
      <I18nProvider>
        <AppStateProvider>
          <CartProvider>
            <AuthGate>
              <Stack screenOptions={{ headerShown: false }} />
            </AuthGate>
          </CartProvider>
        </AppStateProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
