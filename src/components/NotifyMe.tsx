import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { space, radius, MIN_TAP } from '../theme/tokens';
import { text } from '../theme/type';
import { useI18n } from '../i18n';
import { track } from '../lib/analytics';
import * as api from '../data/api';
import { normalisePhone } from '../lib/phone';

/**
 * docs/METRICS.md §1.5 — the notify-me capture.
 *
 * The tap alone is a weak signal; a number is a strong one, so the number is
 * offered but never required. Requiring it would cut the response rate and lose
 * the weaker signal too, and §1.5 wants both counts.
 */
export function NotifyMe({ productId, category }: { productId: string; category?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  const [contact, setContact] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const normalised = contact ? normalisePhone(contact) : null;
      await api.registerInterest(productId, normalised ?? undefined);
      track('notify_me_submitted', {
        product_id: productId,
        category: category ?? null,
        gave_contact: Boolean(normalised),
      });
      setDone(true);
    } catch {
      // A failed capture is not worth an error screen over. The tap was already
      // counted by the event above's absence being visible in the funnel.
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Text style={[text.body, { color: theme.good, marginTop: space.lg }]}>
        {t.shop.notifyMeDone}
      </Text>
    );
  }

  return (
    <View style={{ marginTop: space.lg }}>
      <TextInput
        value={contact}
        onChangeText={setContact}
        placeholder={t.shop.notifyMeNumber}
        placeholderTextColor={theme.textMuted}
        keyboardType="phone-pad"
        accessibilityLabel={t.shop.notifyMeNumber}
        style={[
          styles.input, text.data,
          { color: theme.text, borderColor: theme.line, backgroundColor: theme.raised },
        ]}
      />
      <Pressable
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t.shop.notifyMe}
        style={({ pressed }) => [
          styles.cta,
          // Never brass: this is a button, not a coin value (§9.2).
          { backgroundColor: theme.text, opacity: pressed || busy ? 0.6 : 1 },
        ]}
      >
        <Text style={[text.body, { color: theme.bg }]}>{t.shop.notifyMe}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: MIN_TAP,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  cta: {
    marginTop: space.sm,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
