import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Card, Divider, Row, Text } from '@/components/ui';
import { Loading, Notice } from '@/components/Notice';
import { earning, space } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/format';

interface Team {
  team_id: string;
  name: string;
  city: string | null;
  invite_code: string;
  is_captain: boolean;
  member_count: number;
  member_max: number;
}

interface RosterRow {
  user_id: string;
  name: string | null;
  joined_at: string;
  is_captain: boolean;
  is_me: boolean;
}

/**
 * §7.6 — "This is our growth engine, so treat it as a product, not a feature:
 * one captain recruits twenty people for us. Make creating and sharing a team
 * take under 30 seconds."
 *
 * So: no team means one screen with both doors on it, name field focused, and a
 * share sheet the moment the team exists. No wizard, no confirmation step.
 */
export default function TeamScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { code: incomingCode } = useLocalSearchParams<{ code?: string }>();

  const [team, setTeam] = useState<Team | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [teamRes, rosterRes] = await Promise.all([
        supabase.rpc('my_team'),
        supabase.rpc('team_roster'),
      ]);
      if (teamRes.error || rosterRes.error) {
        setFailed(true);
        return;
      }
      setTeam(((teamRes.data ?? []) as Team[])[0] ?? null);
      setRoster((rosterRes.data ?? []) as RosterRow[]);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !team) {
    return (
      <Screen title={t.team.title}>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen title={t.team.title} onRefresh={load} refreshing={loading}>
      {failed ? (
        <Notice message={t.errors.generic} actionLabel={t.errors.retry} onAction={load} />
      ) : null}

      {team ? (
        <TeamRoster team={team} roster={roster} onChange={load} onLeft={() => router.back()} />
      ) : (
        <NoTeam initialCode={incomingCode ?? ''} onJoined={load} />
      )}
    </Screen>
  );
}

function NoTeam({ initialCode, onJoined }: { initialCode: string; onJoined: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError(t.team.errorName);
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('create_team', { p_name: name.trim() });
    setBusy(false);
    if (rpcError) {
      setError(t.errors.generic);
      return;
    }
    onJoined();
  };

  const join = async () => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('join_team', { p_invite_code: code.trim() });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message.includes('full') ? t.team.errorFull : t.team.errorCode);
      return;
    }
    onJoined();
  };

  return (
    <View style={styles.stack}>
      <Card>
        <Text variant="sectionTitle">{t.team.createTitle}</Text>
        <Text variant="bodySmall" dim>
          {t.team.createBody}
        </Text>
        <Field
          value={name}
          onChangeText={(next) => {
            setName(next);
            if (error) setError(null);
          }}
          placeholder={t.team.namePlaceholder}
          maxLength={40}
          autoFocus={!initialCode}
        />
        <Button label={t.team.createCta} onPress={() => void create()} loading={busy} />
      </Card>

      <Card>
        <Text variant="sectionTitle">{t.team.joinTitle}</Text>
        <Text variant="bodySmall" dim>
          {t.team.joinBody}
        </Text>
        <Field
          value={code}
          onChangeText={(next) => {
            setCode(next.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
            if (error) setError(null);
          }}
          error={error}
          placeholder={t.team.codePlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          autoFocus={Boolean(initialCode)}
          style={styles.code}
          mono
        />
        <Button
          label={t.team.joinCta}
          onPress={() => void join()}
          loading={busy}
          disabled={code.length < 6}
        />
      </Card>
    </View>
  );
}

function TeamRoster({
  team,
  roster,
  onChange,
  onLeft,
}: {
  team: Team;
  roster: RosterRow[];
  onChange: () => void;
  onLeft: () => void;
}) {
  const { t } = useI18n();

  const share = () =>
    void Share.share({
      message: fill(t.team.shareMessage, { code: team.invite_code }),
    });

  const leave = async () => {
    const { error } = await supabase.rpc('leave_team');
    if (error) {
      Alert.alert(t.team.leave, t.team.errorLeaveCaptain);
      return;
    }
    onLeft();
  };

  const handOver = async (userId: string) => {
    await supabase.rpc('hand_over_captaincy', { p_to_user: userId });
    onChange();
  };

  return (
    <View style={styles.stack}>
      <Card>
        <Row justify="space-between">
          <Text variant="sectionTitle">{team.name}</Text>
          <Text variant="dataSmall" dim>
            {fill(t.team.memberCount, {
              count: formatNumber(team.member_count),
              max: formatNumber(team.member_max),
            })}
          </Text>
        </Row>
        {/* The code is a thing people read out loud, so it is set large and
            monospaced rather than buried in body text. */}
        <Text variant="dataLarge">{team.invite_code}</Text>
        <Button label={t.team.share} onPress={share} />
      </Card>

      <Card>
        <Text variant="sectionTitle" dim>
          {t.team.roster}
        </Text>
        <Divider />
        {roster.map((member) => (
          <Row key={member.user_id} justify="space-between" style={styles.member}>
            <Text variant="body" dim={!member.is_me}>
              {member.name ?? '—'}
              {member.is_me ? ` · ${t.team.youLabel}` : ''}
            </Text>
            {member.is_captain ? (
              <Text variant="label" faint>
                {t.team.captain}
              </Text>
            ) : team.is_captain ? (
              <Pressable
                onPress={() => void handOver(member.user_id)}
                accessibilityRole="button"
                // "Make captain" on its own is four identical buttons in a list.
                accessibilityLabel={`${t.team.handOver}: ${member.name ?? ''}`}
              >
                <Text variant="label" dim>
                  {t.team.handOver}
                </Text>
              </Pressable>
            ) : null}
          </Row>
        ))}
      </Card>

      <Button variant="quiet" label={t.team.leave} onPress={() => void leave()} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  code: { textAlign: 'center', letterSpacing: 8, fontSize: 24 },
  member: { paddingVertical: space.sm, borderBottomWidth: 0, borderBottomColor: earning.rule },
});
