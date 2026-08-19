import React, { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Temperature, useTheme } from '../src/theme/ThemeContext';
import { Screen } from '../src/components/Screen';
import { space, radius, MIN_TAP } from '../src/theme/tokens';
import { text } from '../src/theme/type';
import { useI18n } from '../src/i18n';
import * as api from '../src/data/api';
import { track } from '../src/lib/analytics';

/**
 * §7.6 — "Make creating and sharing a team take under 30 seconds."
 *
 * So: one field, one button, and the share sheet opens with the code already in
 * it the moment the team exists. A captain who has to go and find the code
 * somewhere else is a captain who recruits nobody.
 */
export default function TeamScreen() {
  return (
    <Temperature mode="earning">
      <TeamBody />
    </Temperature>
  );
}

function TeamBody() {
  const theme = useTheme();
  const { t } = useI18n();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { inviteCode } = await api.createTeam(name.trim());
      setCreated(inviteCode);
      track('team_created');
      // Straight into the share sheet. This is the 30 seconds.
      await Share.share({
        message: `Join my team on Qadam. Invite code: ${inviteCode}`,
      });
      track('team_invite_shared', { channel: 'share_sheet' });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.retry);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.joinTeam(code);
      track('team_joined', { via: 'code' });
      router.replace('/(tabs)/board');
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.retry);
    } finally {
      setBusy(false);
    }
  }

  const field = { color: theme.text, borderColor: theme.line, backgroundColor: theme.raised };

  return (
    <Screen>
      <Text style={[text.title, { color: theme.text, marginTop: space.xl }]}>
        {t.board.createTeam}
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Gulberg Walkers"
        placeholderTextColor={theme.textMuted}
        maxLength={40}
        accessibilityLabel={t.board.createTeam}
        style={[styles.input, text.body, field]}
      />
      <Pressable
        onPress={create}
        disabled={busy || name.trim().length < 2}
        accessibilityRole="button"
        accessibilityLabel={t.board.createTeam}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: theme.text,
            opacity: pressed || busy || name.trim().length < 2 ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[text.body, { color: theme.bg }]}>{t.board.createTeam}</Text>
      </Pressable>

      {created ? (
        <View style={[styles.codeCard, { backgroundColor: theme.raised, borderColor: theme.line }]}>
          <Text style={[text.label, { color: theme.textMuted }]}>{t.board.inviteCode}</Text>
          {/* Monospace and wide-tracked: this gets read aloud and typed by hand. */}
          <Text style={[text.coinLarge, styles.code, { color: theme.text }]} selectable>
            {created}
          </Text>
        </View>
      ) : null}

      <View style={[styles.divider, { backgroundColor: theme.line }]} />

      <Text style={[text.title, { color: theme.text }]}>{t.board.joinTeam}</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder={t.board.inviteCode}
        placeholderTextColor={theme.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        accessibilityLabel={t.board.inviteCode}
        style={[styles.input, text.data, styles.code, field]}
      />
      <Pressable
        onPress={join}
        disabled={busy || code.trim().length !== 6}
        accessibilityRole="button"
        accessibilityLabel={t.board.joinTeam}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: theme.text,
            opacity: pressed || busy || code.trim().length !== 6 ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[text.body, { color: theme.bg }]}>{t.board.joinTeam}</Text>
      </Pressable>

      {error ? (
        <Text style={[text.body, { color: theme.warn, marginTop: space.lg }]}>{error}</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    marginTop: space.lg,
    minHeight: MIN_TAP,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  code: { letterSpacing: 4 },
  cta: {
    marginTop: space.md,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  codeCard: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.xxl },
});
