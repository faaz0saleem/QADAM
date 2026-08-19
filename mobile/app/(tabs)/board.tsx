import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/Screen';
import { Card, EmptyState, Row, Text } from '@/components/ui';
import { Button } from '@/components/Button';
import { earning, radius, space, MIN_TAP_TARGET } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { useLeaderboard, type Period, type Scope } from '@/hooks/useLeaderboard';
import { formatNumber } from '@/lib/format';

/**
 * §7.3 — four scopes on a segmented control, weekly resetting Monday plus an
 * all-time board.
 *
 * "A permanent all-time-only board is dead to anyone who joins in month three.
 *  Weekly resets mean everyone is always seven days from a win."
 */
const SCOPES: Scope[] = ['city', 'team', 'friends', 'national'];

export default function BoardScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>('city');
  const [period, setPeriod] = useState<Period>('week');
  const { rows, mine, loading, reload } = useLeaderboard(scope, period);

  const scopeLabel: Record<Scope, string> = {
    city: t.board.scopeCity,
    team: t.board.scopeTeam,
    friends: t.board.scopeFriends,
    national: t.board.scopeNational,
  };

  return (
    <Screen title={t.board.title} onRefresh={reload} refreshing={loading}>
      <Segmented
        options={SCOPES.map((s) => ({ value: s, label: scopeLabel[s] }))}
        value={scope}
        onChange={setScope}
      />

      <Row justify="space-between">
        <Segmented
          options={[
            { value: 'week', label: t.board.weekly },
            { value: 'all_time', label: t.board.allTime },
          ]}
          value={period}
          onChange={setPeriod}
          compact
        />
        {period === 'week' ? (
          <Text variant="label" faint>
            {t.board.resetsMonday}
          </Text>
        ) : null}
      </Row>

      {/*
        §7.3 — "Always show the user their own rank, pinned. If they're 4,382nd,
        show '4,382 — top 12%.' Percentile framing keeps mid-table users engaged;
        a bare rank number does not."
      */}
      <Card style={styles.pinned}>
        {mine ? (
          <Row justify="space-between">
            <Text variant="sectionTitle">
              {fill(t.board.youRank, {
                rank: formatNumber(mine.rank),
                percentile: String(mine.percentile),
              })}
            </Text>
            <Text variant="data">{formatNumber(mine.steps)}</Text>
          </Row>
        ) : (
          <Text variant="bodySmall" dim>
            {t.board.youUnranked}
          </Text>
        )}
      </Card>

      {rows.length === 0 && !loading ? (
        // §9.6 — empty states are invitations. An empty team board with no way
        // to start a team is an apology with extra steps.
        <View style={styles.emptyBlock}>
          <EmptyState>
            {scope === 'team' ? t.board.emptyTeam : scope === 'friends' ? t.board.emptyFriends : ''}
          </EmptyState>
          {scope === 'team' ? (
            <Button label={t.board.noTeamCta} onPress={() => router.push('/team')} />
          ) : scope === 'friends' ? (
            <Button label={t.friends.addCta} onPress={() => router.push('/friends')} />
          ) : null}
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((row) => (
            // Grouped: without this a screen reader reads "3", "Bilal Ahmed",
            // "27,633" as three unrelated things on a screen of fifty numbers.
            <Row
              key={row.user_id}
              justify="space-between"
              style={styles.row}
              accessible
              accessibilityLabel={fill(t.board.rankAnnouncement, {
                rank: formatNumber(row.rank),
                name: row.name ?? '',
                steps: formatNumber(row.steps),
              })}
            >
              <Row gap={space.md}>
                <Text variant="dataSmall" faint style={styles.rank}>
                  {formatNumber(row.rank)}
                </Text>
                <Text variant="body" dim={!row.is_me}>
                  {row.name ?? '—'}
                </Text>
              </Row>
              <Text variant="data" dim={!row.is_me}>
                {formatNumber(row.steps)}
              </Text>
            </Row>
          ))}
        </View>
      )}
    </Screen>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.segmented, compact && styles.segmentedCompact]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(option.value)}
          >
            <Text variant="label" dim={!active}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    backgroundColor: earning.sunken,
    borderRadius: radius.md,
    padding: 2,
  },
  segmentedCompact: { alignSelf: 'flex-start' },
  segment: {
    flex: 1,
    minHeight: MIN_TAP_TARGET - 8,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: earning.raised },
  pinned: { borderLeftWidth: 2, borderLeftColor: earning.ruleFilled },
  emptyBlock: { gap: space.md },
  list: { gap: space.md },
  row: { paddingVertical: space.xs },
  // Ranks are right-aligned in a fixed gutter so the column of numbers is a
  // column, which is the entire reason §9.3 insists on tabular figures.
  rank: { minWidth: 36, textAlign: 'right' },
});
