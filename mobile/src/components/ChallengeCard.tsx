import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Card, Row, Text } from './ui';
import { CoinValue } from './Coin';
import { earning, space } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { formatNumber, formatPkr } from '@/lib/format';

interface Challenge {
  id: string;
  title: string;
  scope: string;
  ends_at: string;
  days_left: number;
  prize_type: 'coins' | 'voucher';
  prize_value: number;
  prize_funded_by: 'house' | 'sponsor';
  sponsor_name: string | null;
  applies_to_me: boolean;
}

/**
 * §7.6 — a live challenge, shown on the board where competition already lives.
 *
 * There is no join button, because there is nothing to join: entry is free, a
 * user is in their city's challenge by being in that city, and §13.4 means there
 * is nothing at stake to opt into. The card says so plainly rather than leaving
 * people wondering what it will cost them.
 *
 * Only the soonest-ending challenge that applies to this user is shown. A list
 * of contests is a list; one contest with a countdown is a reason to walk today.
 */
export function ChallengeCard() {
  const { t, locale } = useI18n();
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc('active_challenges');
      const mine = ((data ?? []) as Challenge[]).find((c) => c.applies_to_me);
      setChallenge(mine ?? null);
    })();
  }, []);

  if (!challenge) return null;

  return (
    <Card style={styles.card}>
      <Row justify="space-between">
        <Text variant="sectionTitle">{challenge.title}</Text>
        {/* The prize in coins is a coin value, so it is brass. A rupee voucher
            is not, so it is not (§9.2). */}
        {challenge.prize_type === 'coins' ? (
          <CoinValue coins={challenge.prize_value} size="medium" />
        ) : (
          <Text variant="data">{formatPkr(challenge.prize_value, locale)}</Text>
        )}
      </Row>

      <Text variant="dataSmall" dim>
        {challenge.days_left <= 1
          ? t.challenge.endsToday
          : fill(t.challenge.endsIn, { days: formatNumber(challenge.days_left) })}
      </Text>

      <Text variant="bodySmall" faint>
        {challenge.prize_funded_by === 'sponsor' && challenge.sponsor_name
          ? `${fill(t.challenge.sponsoredBy, { name: challenge.sponsor_name })} · ${t.challenge.noEntry}`
          : t.challenge.noEntry}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderLeftWidth: 2, borderLeftColor: earning.good, gap: space.sm },
});
