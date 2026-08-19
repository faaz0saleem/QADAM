import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
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

  useEffect(() => {
    if (fontsLoaded && locale) void SplashScreen.hideAsync();
  }, [fontsLoaded, locale]);

  // Holding the splash rather than rendering in a fallback face: the step
  // counter is the first thing on screen and it reflowing from a system font to
  // JetBrains Mono is exactly the jitter §9.3 exists to prevent.
  if (!fontsLoaded || !locale) return <View style={styles.holding} />;

  return (
    <SafeAreaProvider>
      <I18nProvider initial={locale}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: earning.bg } }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  holding: { flex: 1, backgroundColor: earning.bg },
});
