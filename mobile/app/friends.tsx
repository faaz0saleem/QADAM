import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Card, Divider, EmptyState, Row, Text } from '@/components/ui';
import { space } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { supabase } from '@/lib/supabase';

interface Friend {
  user_id: string;
  name: string | null;
  city: string | null;
}

/**
 * §7.3 — the Friends leaderboard scope needs friends.
 *
 * A person's referral code doubles as their friend code: one code to share, one
 * thing to explain, and it exists on every account from signup. Adding someone
 * only ever exposes their name and step count, both of which are already on the
 * city and national boards.
 */
export default function FriendsScreen() {
  const { t } = useI18n();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, mine] = await Promise.all([
      supabase.rpc('my_friends'),
      supabase.rpc('my_referral_code'),
    ]);
    setFriends((list.data ?? []) as Friend[]);
    setMyCode(typeof mine.data === 'string' ? mine.data : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('add_friend', { p_code: code.trim() });
    setBusy(false);
    if (rpcError) {
      setError(t.friends.errorCode);
      return;
    }
    setCode('');
    await load();
  };

  const remove = async (userId: string) => {
    await supabase.rpc('remove_friend', { p_friend_id: userId });
    await load();
  };

  return (
    <Screen title={t.friends.title} onRefresh={load} refreshing={loading}>
      <Card>
        <Text variant="sectionTitle">{t.friends.addTitle}</Text>
        <Text variant="bodySmall" dim>
          {t.friends.addBody}
        </Text>
        <Field
          value={code}
          onChangeText={(next) => {
            setCode(next.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7));
            if (error) setError(null);
          }}
          error={error}
          placeholder={t.friends.codePlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          style={styles.code}
          mono
        />
        <Button
          label={t.friends.addCta}
          onPress={() => void add()}
          loading={busy}
          disabled={code.length < 7}
        />
      </Card>

      <Card>
        <Row justify="space-between">
          <Text variant="bodySmall" dim>
            {t.friends.yourCode}
          </Text>
          <Text variant="dataLarge">{myCode ?? '———————'}</Text>
        </Row>
        <Button
          variant="quiet"
          label={t.friends.shareCode}
          onPress={() =>
            void Share.share({ message: fill(t.friends.shareMessage, { code: myCode ?? '' }) })
          }
        />
      </Card>

      {friends.length === 0 && !loading ? (
        <EmptyState>{t.friends.empty}</EmptyState>
      ) : (
        <Card>
          <Text variant="sectionTitle" dim>
            {t.friends.title}
          </Text>
          <Divider />
          <View>
            {friends.map((friend) => (
              <Row key={friend.user_id} justify="space-between" style={styles.row}>
                <View>
                  <Text variant="body">{friend.name ?? '—'}</Text>
                  {friend.city ? (
                    <Text variant="bodySmall" faint>
                      {friend.city}
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={() => void remove(friend.user_id)} accessibilityRole="button">
                  <Text variant="label" faint>
                    {t.friends.remove}
                  </Text>
                </Pressable>
              </Row>
            ))}
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { textAlign: 'center', letterSpacing: 6, fontSize: 24 },
  row: { paddingVertical: space.sm },
});
