import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Temperature, useTheme } from '../../src/theme/ThemeContext';
import { Screen } from '../../src/components/Screen';
import { CoinHeader } from '../../src/components/CoinHeader';
import { space, radius, MIN_TAP } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { useI18n } from '../../src/i18n';
import { useAppState } from '../../src/data/AppState';
import { usingDemoData } from '../../src/data/api';

export default function YouScreen() {
  return (
    <Temperature mode="earning">
      <YouBody />
    </Temperature>
  );
}

function YouBody() {
  const theme = useTheme();
  const { t, lang, setLang } = useI18n();
  const { balance } = useAppState();

  return (
    <>
      <CoinHeader balance={balance} title={t.you.title} />
      <Screen>
        <Text style={[text.label, { color: theme.textMuted, marginTop: space.xl }]}>
          {t.you.howItWorks}
        </Text>

        {/* §4: the earning rate is a promise we keep forever, so it is stated
            plainly. The coin-to-rupee rate is NOT here and never will be — it is
            ours to tune weekly, and publishing it would make every tuning feel
            like a cut. */}
        <View style={[styles.card, { backgroundColor: theme.raised, borderColor: theme.coin }]}>
          <Text style={[text.coinLarge, { color: theme.coin }]}>{t.you.theRate}</Text>
          <Text style={[text.body, { color: theme.textMuted, marginTop: space.sm }]}>
            {t.you.theRule}
          </Text>
        </View>

        <Text style={[text.label, { color: theme.textMuted, marginTop: space.xxl }]}>
          {t.you.language}
        </Text>
        <View style={styles.langs}>
          {(['en', 'ur'] as const).map((l) => (
            <Pressable
              key={l}
              onPress={() => setLang(l)}
              accessibilityRole="radio"
              accessibilityState={{ selected: lang === l }}
              style={({ pressed }) => [
                styles.lang,
                {
                  borderColor: lang === l ? theme.coin : theme.line,
                  backgroundColor: theme.raised,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={[text.body, { color: lang === l ? theme.text : theme.textMuted }]}>
                {l === 'en' ? t.you.english : t.you.urdu}
              </Text>
            </Pressable>
          ))}
        </View>

        {usingDemoData ? (
          <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.xxxl }]}>
            Running on demo data — no Supabase project is configured yet.
            See HUMAN_TASKS.md.
          </Text>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  langs: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  lang: {
    flex: 1,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
