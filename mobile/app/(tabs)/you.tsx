import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Card, Divider, Row, Text } from '@/components/ui';
import { Button } from '@/components/Button';
import { earning, radius, space, MIN_TAP_TARGET } from '@/theme';
import { useI18n, fill, type Locale } from '@/i18n';
import { supabase, functionsBase } from '@/lib/supabase';

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
        // Through the RPC rather than the table: team_members is scoped to your
        // own row, and reading a team's name through a join would have needed a
        // policy that let anyone enumerate every membership.
        supabase.rpc('my_team'),
      ]);
      setCode(typeof codeRes.data === 'string' ? codeRes.data : null);
      setReferrals((refRes.data ?? []) as Referral[]);
      const teams = (teamRes.data ?? []) as Array<{ name: string; invite_code: string }>;
      setTeam(teams[0] ?? null);
    })();
  }, []);

  const deleteAccount = async () => {
    const { data: session } = await supabase.auth.getSession();
    const accessToken = session.session?.access_token;
    if (!accessToken) return;

    // The RPC marks the account and clears it from every shared surface. The
    // Edge Function then removes the rows and the sign-in — in that order,
    // because the reverse cascades into an append-only ledger and fails halfway.
    const { error } = await supabase.rpc('request_account_deletion');
    if (error) {
      Alert.alert(t.you.deleteAccount, t.you.deleteFailed);
      return;
    }

    try {
      const res = await fetch(`${functionsBase}/delete-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // The account is already marked and off every board, so it earns nothing
      // from here. Saying it failed would be less true than saying nothing.
      console.warn('account deletion queued but not completed');
    }

    await supabase.auth.signOut();
  };

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

      <Card>
        <Text variant="sectionTitle" dim>
          {t.shop.ordersTitle}
        </Text>
        <Button variant="quiet" label={t.shop.ordersTitle} onPress={() => router.push('/orders')} />
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

      {/*
        Both stores require in-app account deletion. §9.6 says say what happens,
        and what happens here is unusual enough to spell out: coins cannot be
        moved anywhere (§13.3), so leaving destroys them. Better to say that
        before the tap than to be the app that quietly binned three months of
        walking.
      */}
      <Pressable
        style={styles.signOut}
        accessibilityRole="button"
        accessibilityLabel={t.you.deleteAccount}
        onPress={() =>
          Alert.alert(t.you.deleteTitle, t.you.deleteBody, [
            { text: t.you.deleteCancel, style: 'cancel' },
            { text: t.you.deleteConfirm, style: 'destructive', onPress: () => void deleteAccount() },
          ])
        }
      >
        <Text variant="bodySmall" style={styles.danger}>
          {t.you.deleteAccount}
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
  danger: { color: earning.bad },
});
