import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Temperature, useTheme } from '../../src/theme/ThemeContext';
import { Screen } from '../../src/components/Screen';
import { CoinHeader } from '../../src/components/CoinHeader';
import { space, radius, MIN_TAP } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { formatSteps, formatRankLine, formatRank } from '../../src/lib/format';
import { daysUntilWeekReset } from '../../src/lib/dates';
import { useI18n } from '../../src/i18n';
import { useAppState } from '../../src/data/AppState';
import { track } from '../../src/lib/analytics';
import * as api from '../../src/data/api';
import type { BoardRow, BoardScope } from '../../src/data/types';

const SCOPES: BoardScope[] = ['city', 'team', 'friends', 'pakistan'];

/** §7.3 — four scopes, weekly, with the user's own rank always pinned. */
export default function BoardScreen() {
  return (
    <Temperature mode="earning">
      <BoardBody />
    </Temperature>
  );
}

function BoardBody() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { balance, userId } = useAppState();
  const [scope, setScope] = useState<BoardScope>('city');
  const [rows, setRows] = useState<BoardRow[]>([]);

  useEffect(() => {
    let alive = true;
    api.getBoard(userId, scope).then((r) => {
      if (!alive) return;
      setRows(r);
      const me = r.find((row) => row.isMe);
      track('leaderboard_viewed', {
        scope: scope === 'pakistan' ? 'national' : scope,
        own_rank: me?.rank ?? null,
        own_percentile: me?.percentile ?? null,
      });
    }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [userId, scope]);

  const me = rows.find((r) => r.isMe);

  return (
    <>
      <CoinHeader balance={balance} title={t.board.title} />
      <Screen>
        <View style={styles.scopes}>
          {SCOPES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              accessibilityRole="tab"
              accessibilityState={{ selected: scope === s }}
              accessibilityLabel={t.board.scope[s]}
              style={[
                styles.scope,
                {
                  borderBottomColor: scope === s ? theme.coin : 'transparent',
                  minHeight: MIN_TAP,
                },
              ]}
            >
              <Text
                style={[
                  text.label,
                  { color: scope === s ? theme.text : theme.textMuted },
                ]}
                numberOfLines={1}
              >
                {t.board.scope[s]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: space.md }]}>
          {t.board.weekly} · {fill(t.board.resetsIn, { days: daysUntilWeekReset() })}
        </Text>

        {/* §7.3: percentile framing keeps a mid-table user engaged where a bare
            rank number does not. */}
        {me ? (
          <View style={[styles.mine, { borderColor: theme.coin, backgroundColor: theme.raised }]}>
            <Text style={[text.coin, { color: theme.coin }]}>
              {formatRankLine(me.rank, me.percentile)}
            </Text>
            <Text style={[text.dataSmall, { color: theme.textMuted, marginTop: 2 }]}>
              {formatSteps(me.steps)} {t.common.steps}
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: space.xl }}>
          {rows.length === 0 ? (
            <>
              {/* §9.6: an empty state is an invitation, not an apology. */}
              <Text style={[text.body, { color: theme.textMuted }]}>
                {scope === 'team'
                  ? t.board.emptyTeam
                  : scope === 'friends'
                    ? t.board.emptyFriends
                    : fill(t.board.emptyCity, { city: 'your city' })}
              </Text>
              {scope === 'team' ? (
                <Pressable
                  onPress={() => router.push('/team')}
                  accessibilityRole="button"
                  accessibilityLabel={t.board.joinTeam}
                  style={({ pressed }) => [
                    styles.teamCta,
                    { backgroundColor: theme.text, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[text.body, { color: theme.bg }]}>{t.board.joinTeam}</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            rows
              .filter((r) => !r.pinned)
              .map((r) => <Row key={r.userId} row={r} />)
          )}
        </View>
      </Screen>
    </>
  );
}

function Row({ row }: { row: BoardRow }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.line }]}>
      <Text style={[text.data, styles.rank, { color: theme.textMuted }]}>
        {formatRank(row.rank)}
      </Text>
      <Text
        style={[text.body, { color: row.isMe ? theme.coin : theme.text, flex: 1 }]}
        numberOfLines={1}
      >
        {row.name ?? '—'}
      </Text>
      <Text style={[text.data, { color: theme.text }]}>{formatSteps(row.steps)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scopes: { flexDirection: 'row', marginTop: space.lg },
  scope: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderBottomWidth: 2,
  },
  mine: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Tabular figures make a fixed-width rank column line up without a monospace hack.
  rank: { width: 56 },
  teamCta: {
    marginTop: space.lg,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
});
