import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import { en, ur, Strings } from './strings';

export type Lang = 'en' | 'ur';

interface I18n {
  lang: Lang;
  isRTL: boolean;
  t: Strings;
  setLang: (l: Lang) => void;
  /** Fills {{placeholders}}. Missing keys are left visible rather than blanked. */
  fill: (template: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    // §9.3 / §12: full RTL, not a mirrored-text approximation. React Native needs
    // a reload to flip the layout direction, which is why the language switch
    // lives in settings behind a confirmation rather than in a header.
    I18nManager.allowRTL(l === 'ur');
    I18nManager.forceRTL(l === 'ur');
  }, []);

  const fill = useCallback(
    (template: string, vars: Record<string, string | number> = {}) =>
      template.replace(/\{\{(\w+)\}\}/g, (whole, key) =>
        key in vars ? String(vars[key]) : whole,
      ),
    [],
  );

  const value = useMemo<I18n>(
    () => ({ lang, isRTL: lang === 'ur', t: lang === 'ur' ? ur : en, setLang, fill }),
    [lang, setLang, fill],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
