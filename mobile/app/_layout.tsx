import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

import { I18nProvider, loadStoredLocale, useI18n, type Locale } from '@/i18n';
import { earning, space, text as type } from '@/theme';
import { useSession, useSessionWatcher } from '@/hooks/useSession';
import { isConfigured } from '@/lib/supabase';
import { DEMO, DEMO_NOTICE } from '@/lib/demo';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [locale, setLocale] = useState<Locale | null>(null);
  const [fontsLoaded, fontError] = useFonts({
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
  //
  // But hold for a font that RESOLVES, not forever. If a face fails to load —
  // a corrupt asset, a device that rejects it, a preview build serving the
  // faces from CSS instead — this used to sit on a blank screen for the rest of
  // the session. A fallback face for one launch is a much smaller problem than
  // an app that never starts.
  if ((!fontsLoaded && !fontError) || !locale) return <View style={styles.holding} />;

  return (
    <SafeAreaProvider>
      <I18nProvider initial={locale}>
        <StatusBar style="light" />
        {/*
          A build with no backend is a valid APK that installs and launches and
          then fails at the first request. Say which of those it is, before
          anyone types a phone number into a form that cannot be submitted.
        */}
        {DEMO ? (
          <View style={styles.preview}>
            <Text style={styles.previewText}>{DEMO_NOTICE}</Text>
          </View>
        ) : null}
        {isConfigured ? <SessionGate /> : <NotConfigured />}
      </I18nProvider>
    </SafeAreaProvider>
  );
}

/**
 * §9.6 — "Errors say what happened and what to do."
 *
 * Deliberately not a Screen: Screen pins the coin balance to the header, and
 * there is no balance to pin when there is nothing to ask. Plain type on ink,
 * saying the one true thing.
 */
function NotConfigured() {
  const { t } = useI18n();
  return (
    <View style={styles.setup}>
      <Text style={styles.setupTitle}>{t.setup.title}</Text>
      <Text style={styles.setupBody}>{t.setup.body}</Text>
      <Text style={styles.setupBody}>{t.setup.what}</Text>
      <Text style={styles.setupMono}>{t.setup.how}</Text>
      <Text style={styles.setupNote}>{t.setup.note}</Text>
    </View>
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
  preview: {
    backgroundColor: earning.sunken,
    paddingTop: space.xxl,
    paddingBottom: space.xs,
    alignItems: 'center',
  },
  previewText: { ...type.label, color: earning.textFaint },
  setup: {
    flex: 1,
    backgroundColor: earning.bg,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.lg,
  },
  setupTitle: { ...type.screenTitle, color: earning.text },
  setupBody: { ...type.body, color: earning.textDim },
  setupMono: { ...type.dataSmall, color: earning.text, lineHeight: 20 },
  setupNote: { ...type.bodySmall, color: earning.textFaint },
  holding: { flex: 1, backgroundColor: earning.bg },
});
