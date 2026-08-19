import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Text } from '@/components/ui';
import { earning, space } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { displayPhone } from '@/lib/phone';
import { sendOtp, verifyOtp } from '@/hooks/useSession';
import { takePendingInvite } from '@/lib/pendingInvite';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 45;

export const REFERRAL_PROMPTED_KEY = 'qadam.referralPrompted';

export default function VerifyScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const submitted = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (value: string) => {
    if (!phone || busy) return;
    setBusy(true);
    const ok = await verifyOtp(phone, value);
    setBusy(false);

    if (!ok) {
      setError(t.auth.errorOtp);
      setCode('');
      submitted.current = false;
      return;
    }

    // First sign-in only: ask about a referral code once, then never again.
    // §7.7 wants the code applied before the first order, not nagged for.
    const prompted = await AsyncStorage.getItem(REFERRAL_PROMPTED_KEY);
    if (!prompted) {
      router.replace('/referral');
      return;
    }

    // Someone who arrived from a team invite gets taken to it, not dropped on
    // the home screen wondering what happened to the link they followed.
    const invite = await takePendingInvite();
    router.replace(invite ? { pathname: '/team', params: { code: invite } } : '/');
  };

  // Auto-submit on the sixth digit. Making someone press a button after typing
  // the last digit of a code they were just read is friction for its own sake.
  useEffect(() => {
    if (code.length === CODE_LENGTH && !submitted.current) {
      submitted.current = true;
      void submit(code);
    }
  }, [code]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text variant="screenTitle">{t.auth.otpTitle}</Text>
          <Text variant="body" dim>
            {fill(t.auth.otpSentTo, { phone: phone ? displayPhone(phone) : '' })}
          </Text>
        </View>

        <Field
          error={error}
          value={code}
          onChangeText={(next) => {
            const digits = next.replace(/\D/g, '').slice(0, CODE_LENGTH);
            setCode(digits);
            if (error) setError(null);
            if (digits.length < CODE_LENGTH) submitted.current = false;
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          maxLength={CODE_LENGTH}
          style={styles.code}
          mono
        />

        <Button
          label={t.auth.verifyCta}
          onPress={() => void submit(code)}
          loading={busy}
          disabled={code.length < CODE_LENGTH}
        />

        <Button
          variant="quiet"
          label={cooldown > 0 ? fill(t.auth.otpResendIn, { seconds: String(cooldown) }) : t.auth.otpResend}
          disabled={cooldown > 0}
          onPress={() => {
            if (!phone) return;
            setCooldown(RESEND_SECONDS);
            void sendOtp(phone);
          }}
        />

        <Button variant="quiet" label={t.auth.changeNumber} onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: earning.bg },
  body: { paddingHorizontal: space.lg, gap: space.lg },
  intro: { gap: space.md, marginBottom: space.md },
  // A six-digit code, spaced out and centred: it is read off a screen and typed,
  // so it should look like the thing being copied.
  code: { textAlign: 'center', letterSpacing: 10, fontSize: 28 },
});
