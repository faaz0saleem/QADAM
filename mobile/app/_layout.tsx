import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  FamiljenGrotesk_600SemiBold,
  FamiljenGrotesk_700Bold,
} from '@expo-google-fonts/familjen-grotesk';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { NotoNastaliqUrdu_400Regular } from '@expo-google-fonts/noto-nastaliq-urdu';

import { I18nProvider, loadStoredLocale, type Locale } from '@/i18n';
import { earning } from '@/theme';
import { useSession, useSessionWatcher } from '@/hooks/useSession';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [locale, setLocale] = useState<Locale | null>(null);
  const [fontsLoaded] = useFonts({
    FamiljenGrotesk_600SemiBold,
    FamiljenGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    NotoNastaliqUrdu_400Regular,
  });

  useEffect(() => {
    void loadStoredLocale().then(setLocale);
  }, []);

  // Holding the splash rather than rendering in a fallback face: the step
  // counter is the first thing on screen and it reflowing from a system font to
  // JetBrains Mono is exactly the jitter §9.3 exists to prevent.
  if (!fontsLoaded || !locale) return <View style={styles.holding} />;

  return (
    <SafeAreaProvider>
      <I18nProvider initial={locale}>
        <StatusBar style="light" />
        <SessionGate />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/**
 * The only place that decides whether someone is looking at the app or at the
 * sign-in flow. Keeping it in one component means no screen has to remember to
 * check, and a route added later is protected by default.
 */
function SessionGate() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useSessionWatcher();

  useEffect(() => {
    if (status === 'loading') return;
    void SplashScreen.hideAsync();

    const inAuthFlow = segments[0] === '(auth)';
    if (status === 'signed_out' && !inAuthFlow) {
      router.replace('/phone');
    } else if (status === 'signed_in' && inAuthFlow) {
      router.replace('/');
    }
  }, [status, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: earning.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  holding: { flex: 1, backgroundColor: earning.bg },
});
