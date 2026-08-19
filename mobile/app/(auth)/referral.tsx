import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Text } from '@/components/ui';
import { earning, space } from '@/theme';
import { useI18n } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { REFERRAL_PROMPTED_KEY } from './verify';

/**
 * §7.7 — the referral code goes in once, right after sign-up, and pays nothing
 * until the referee's first order arrives.
 *
 * Asked once and never again: a prompt that reappears is a prompt people learn
 * to dismiss without reading. Skipping is a first-class answer with its own
 * plainly-worded button, not a greyed-out "maybe later".
 */
export default function ReferralScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    await AsyncStorage.setItem(REFERRAL_PROMPTED_KEY, '1');
    router.replace('/');
  };

  const apply = async () => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('apply_referral_code', {
      p_code: code.trim().toUpperCase(),
    });
    setBusy(false);

    if (rpcError) {
      setError(t.auth.errorReferral);
      return;
    }
    await finish();
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
          <Text variant="screenTitle">{t.auth.referralTitle}</Text>
          <Text variant="body" dim>
            {t.auth.referralBody}
          </Text>
        </View>

        <Field
          error={error}
          value={code}
          onChangeText={(next) => {
            setCode(next.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7));
            if (error) setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          placeholder={t.auth.referralPlaceholder}
          style={styles.code}
          mono
        />

        <Button
          label={t.auth.referralApply}
          onPress={() => void apply()}
          loading={busy}
          disabled={code.length < 7}
        />
        <Button variant="quiet" label={t.auth.referralSkip} onPress={() => void finish()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: earning.bg },
  body: { paddingHorizontal: space.lg, gap: space.lg },
  intro: { gap: space.md, marginBottom: space.md },
  code: { textAlign: 'center', letterSpacing: 6, fontSize: 24 },
});
