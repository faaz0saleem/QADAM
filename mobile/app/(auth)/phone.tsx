import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Text } from '@/components/ui';
import { earning, space } from '@/theme';
import { useI18n } from '@/i18n';
import { normalisePhone } from '@/lib/phone';
import { sendOtp } from '@/hooks/useSession';

/**
 * §2 — phone is the identity in this market. There is no email option and no
 * social login, because neither is how anyone here signs into anything.
 */
export default function PhoneScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const e164 = normalisePhone(raw);
    if (!e164) {
      setError(t.auth.errorPhone);
      return;
    }
    setError(null);
    setSending(true);
    const ok = await sendOtp(e164);
    setSending(false);

    if (!ok) {
      setError(t.auth.errorSend);
      return;
    }
    router.push({ pathname: '/verify', params: { phone: e164 } });
  };

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
          <Text variant="screenTitle">{t.auth.welcomeTitle}</Text>
          <Text variant="body" dim>
            {t.auth.welcomeBody}
          </Text>
        </View>

        <Field
          label={t.auth.phoneLabel}
          hint={t.auth.phoneHint}
          error={error}
          value={raw}
          onChangeText={(next) => {
            setRaw(next);
            if (error) setError(null);
          }}
          onSubmitEditing={() => void submit()}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          maxLength={17}
          placeholder="0300 1234567"
          mono
          // The number is a column of digits; proportional numerals make it jump
          // as it is typed (§9.3).
        />

        <Button
          label={t.auth.continueCta}
          onPress={() => void submit()}
          loading={sending}
          disabled={raw.length < 10}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: earning.bg },
  body: { paddingHorizontal: space.lg, gap: space.xl },
  intro: { gap: space.md },
});
