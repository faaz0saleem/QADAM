import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Temperature, useTheme } from '../src/theme/ThemeContext';
import { Screen } from '../src/components/Screen';
import { space, radius, MIN_TAP } from '../src/theme/tokens';
import { text } from '../src/theme/type';
import { useI18n } from '../src/i18n';
import { normalisePhone, formatPhoneLocal } from '../src/lib/phone';
import { supabase, isConfigured } from '../src/lib/supabase';

/**
 * Phone OTP sign-in (§2, §7.5).
 *
 * Deliberately two steps and nothing else. Every extra field here is signups
 * lost, and the only thing we genuinely need before someone starts walking is a
 * number we can reach them on when a parcel is out for delivery.
 *
 * The invite code is optional and on the first step, because a referred user
 * arrives with one in hand (§7.7) and asking for it later means never getting it.
 */
export default function SignInScreen() {
  return (
    <Temperature mode="earning">
      <SignInBody />
    </Temperature>
  );
}

function SignInBody() {
  const theme = useTheme();
  const { t, fill } = useI18n();

  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [referral, setReferral] = useState('');
  const [code, setCode] = useState('');
  const [e164, setE164] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    const normalised = normalisePhone(phone);
    if (!normalised) {
      setError(t.signIn.invalidPhone);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (!isConfigured) throw new Error('No Supabase project is configured yet.');
      const { error: err } = await supabase!.auth.signInWithOtp({
        phone: normalised,
        options: {
          // Carried into handle_new_auth_user, which resolves the referrer.
          // Nothing is paid here: §7.7 pays on the referee's first purchase.
          data: referral ? { referral_code: referral.trim().toUpperCase() } : {},
        },
      });
      if (err) throw err;
      setE164(normalised);
      setStage('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : t.signIn.invalidPhone);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase!.auth.verifyOtp({
        phone: e164,
        token: code.trim(),
        type: 'sms',
      });
      if (err) throw err;
      router.replace('/(tabs)');
    } catch {
      setError(t.signIn.invalidCode);
    } finally {
      setBusy(false);
    }
  }

  const field = {
    color: theme.text,
    borderColor: theme.line,
    backgroundColor: theme.raised,
  };

  return (
    <Screen>
      <Text style={[text.title, { color: theme.text, marginTop: space.xxxl }]}>
        {stage === 'phone' ? t.signIn.title : t.signIn.codeTitle}
      </Text>
      <Text style={[text.body, { color: theme.textMuted, marginTop: space.md }]}>
        {stage === 'phone' ? t.signIn.body : fill(t.signIn.codeSent, { phone: formatPhoneLocal(e164) })}
      </Text>

      {stage === 'phone' ? (
        <>
          <Text style={[text.label, { color: theme.textMuted, marginTop: space.xxl }]}>
            {t.signIn.phoneLabel}
          </Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={t.signIn.phonePlaceholder}
            placeholderTextColor={theme.textMuted}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            accessibilityLabel={t.signIn.phoneLabel}
            style={[styles.input, text.data, field]}
          />

          <Text style={[text.label, { color: theme.textMuted, marginTop: space.xl }]}>
            {t.signIn.referralPrompt}
          </Text>
          <TextInput
            value={referral}
            onChangeText={setReferral}
            placeholder={t.signIn.referralPlaceholder}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            accessibilityLabel={t.signIn.referralPrompt}
            style={[styles.input, text.data, field]}
          />
        </>
      ) : (
        <>
          <Text style={[text.label, { color: theme.textMuted, marginTop: space.xxl }]}>
            {t.signIn.codeLabel}
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            accessibilityLabel={t.signIn.codeLabel}
            style={[styles.input, text.counter, field, styles.codeInput]}
          />
        </>
      )}

      {error ? (
        <Text style={[text.body, { color: theme.warn, marginTop: space.lg }]}>{error}</Text>
      ) : null}

      <Pressable
        onPress={stage === 'phone' ? sendCode : verify}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={stage === 'phone' ? t.signIn.send : t.signIn.verify}
        style={({ pressed }) => [
          styles.cta,
          // Never brass: this is a button, not a coin value (§9.2).
          { backgroundColor: theme.text, opacity: pressed || busy ? 0.6 : 1 },
        ]}
      >
        <Text style={[text.body, { color: theme.bg }]}>
          {stage === 'phone' ? t.signIn.send : t.signIn.verify}
        </Text>
      </Pressable>

      {stage === 'code' ? (
        <Pressable
          onPress={() => { setStage('phone'); setCode(''); setError(null); }}
          accessibilityRole="button"
          style={styles.secondary}
        >
          <Text style={[text.body, { color: theme.textMuted }]}>{t.signIn.changeNumber}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    marginTop: space.sm,
    minHeight: MIN_TAP,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  // The code is the one place outside the step counter where the display size
  // is right: it is a number being read off another screen.
  codeInput: { fontSize: 32, lineHeight: 40, letterSpacing: 8, textAlign: 'center' },
  cta: {
    marginTop: space.xxl,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  secondary: {
    marginTop: space.lg,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
