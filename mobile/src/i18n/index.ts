import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { en, type Copy } from './en';
import { ur } from './ur';

export type Locale = 'en' | 'ur';

const DICTIONARIES: Record<Locale, Copy> = { en, ur };
const STORAGE_KEY = 'qadam.locale';

/** Urdu is RTL; English is not. Nothing else in the app decides direction. */
export const isRtl = (locale: Locale): boolean => locale === 'ur';

export function deviceLocale(): Locale {
  const tag = Localization.getLocales()[0]?.languageCode;
  return tag === 'ur' ? 'ur' : 'en';
}

export async function loadStoredLocale(): Promise<Locale> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored === 'ur' || stored === 'en' ? stored : deviceLocale();
}

/**
 * Interpolates {{name}} placeholders. Deliberately not a template-literal
 * helper: the copy lives in data files so it can be handed to a translator,
 * and a translator cannot be handed backticks.
 */
export function fill(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : String(value);
  });
}

interface I18n {
  locale: Locale;
  rtl: boolean;
  t: Copy;
  setLocale: (next: Locale) => Promise<void>;
  /** True when the stored direction and the running direction disagree. */
  needsRestart: boolean;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  const setLocale = useCallback(async (next: Locale) => {
    await AsyncStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
    // Direction is baked in at native startup. Ask for the new one; the screen
    // that called this is responsible for telling the user a restart is coming,
    // rather than the app blinking sideways underneath them.
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(isRtl(next));
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      rtl: isRtl(locale),
      t: DICTIONARIES[locale],
      setLocale,
      needsRestart: I18nManager.isRTL !== isRtl(locale),
    }),
    [locale, setLocale],
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export type { Copy };
