import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Card, Divider, Row, Text } from '@/components/ui';
import { Button } from '@/components/Button';
import { earning, radius, space, MIN_TAP_TARGET } from '@/theme';
import { useI18n, fill, type Locale } from '@/i18n';
import { supabase } from '@/lib/supabase';

interface Referral {
  referee_name: string | null;
  joined_at: string;
  paid: boolean;
  coins: number | null;
}

export default function YouScreen() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [team, setTeam] = useState<{ name: string; invite_code: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const [codeRes, refRes, teamRes] = await Promise.all([
        supabase.rpc('my_referral_code'),
        supabase.rpc('my_referrals'),
        supabase.from('team_members').select('teams(name, invite_code)').maybeSingle(),
      ]);
      setCode(typeof codeRes.data === 'string' ? codeRes.data : null);
      setReferrals((refRes.data ?? []) as Referral[]);
      const joined = teamRes.data as { teams?: { name: string; invite_code: string } } | null;
      setTeam(joined?.teams ?? null);
    })();
  }, []);

  const chooseLanguage = async (next: Locale) => {
    if (next === locale) return;
    await setLocale(next);
    // §9.6 — say what happened and what happens next. RTL direction is fixed at
    // native startup, so the restart is real and worth naming rather than
    // letting the layout half-flip.
    Alert.alert(t.you.language, t.you.restartForRtl);
  };

  return (
    <Screen title={t.you.title}>
      <Card>
        <Text variant="sectionTitle" dim>
          {t.you.language}
        </Text>
        <Row gap={space.sm}>
          <Choice label={t.you.english} active={locale === 'en'} onPress={() => void chooseLanguage('en')} />
          <Choice label={t.you.urdu} active={locale === 'ur'} onPress={() => void chooseLanguage('ur')} />
        </Row>
      </Card>

      <Card>
        <Text variant="sectionTitle" dim>
          {t.you.team}
        </Text>
        {team ? (
          <Row justify="space-between">
            <Text variant="body">{team.name}</Text>
            <Text variant="data" dim>
              {team.invite_code}
            </Text>
          </Row>
        ) : (
          <Text variant="bodySmall" dim>
            {t.you.noTeam}
          </Text>
        )}
        <Button
          variant="quiet"
          label={team ? t.team.title : t.board.noTeamCta}
          onPress={() => router.push('/team')}
        />
      </Card>

      <Card>
        <Text variant="sectionTitle" dim>
          {t.friends.title}
        </Text>
        <Button variant="quiet" label={t.friends.addTitle} onPress={() => router.push('/friends')} />
      </Card>

      {/*
        §7.7 — show pending referrals, so the referrer keeps nudging. The copy
        says exactly what has to happen and who has to do it.
      */}
      <Card>
        <Text variant="sectionTitle" dim>
          {t.you.referral}
        </Text>
        <Row justify="space-between">
          <Text variant="bodySmall" dim>
            {t.you.referralCode}
          </Text>
          <Text variant="dataLarge">{code ?? '——————'}</Text>
        </Row>
        <Text variant="bodySmall" dim>
          {t.you.referralExplainer}
        </Text>

        {referrals.length > 0 ? (
          <View style={styles.referrals}>
            <Divider />
            {referrals.map((r) => (
              <Text key={r.joined_at} variant="bodySmall" dim={!r.paid}>
                {r.paid
                  ? fill(t.you.referralPaid, { name: r.referee_name ?? '—' })
                  : fill(t.you.referralPending, { name: r.referee_name ?? '—' })}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

      <Pressable
        style={styles.signOut}
        accessibilityRole="button"
        onPress={() => void supabase.auth.signOut()}
      >
        <Text variant="bodySmall" dim>
          {t.you.signOut}
        </Text>
      </Pressable>
    </Screen>
  );
}

function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[styles.choice, active && styles.choiceActive]}
      onPress={onPress}
    >
      <Text variant="label" dim={!active}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    minHeight: MIN_TAP_TARGET,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: earning.sunken,
  },
  choiceActive: { backgroundColor: earning.bg, borderWidth: 1, borderColor: earning.ruleFilled },
  referrals: { gap: space.sm },
  signOut: { minHeight: MIN_TAP_TARGET, justifyContent: 'center', alignItems: 'center' },
});
