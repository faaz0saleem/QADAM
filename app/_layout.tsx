import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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

export default function RootLayout() {
  return (
    <SafeAreaProvider>
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
