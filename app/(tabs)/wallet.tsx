import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Temperature, useTheme } from '../../src/theme/ThemeContext';
import { Screen } from '../../src/components/Screen';
import { CoinHeader } from '../../src/components/CoinHeader';
import { space, radius } from '../../src/theme/tokens';
import { text } from '../../src/theme/type';
import { formatCoins, formatDelta } from '../../src/lib/format';
import { useI18n } from '../../src/i18n';
import { useAppState } from '../../src/data/AppState';
import * as api from '../../src/data/api';
import type { LedgerEntry } from '../../src/data/types';

/**
 * §7.2 — every credit and debit, with its reason and its expiry, grouped by
 * expiry batch so "2,400 coins expiring in 11 days" is a dated, visible thing
 * and never a surprise.
 */
export default function WalletScreen() {
  return (
    <Temperature mode="earning">
      <WalletBody />
    </Temperature>
  );
}

function WalletBody() {
  const theme = useTheme();
  const { t, fill } = useI18n();
  const { balance, batches, userId } = useAppState();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);

  useEffect(() => {
    let alive = true;
    api.getLedger(userId).then((e) => { if (alive) setEntries(e); }).catch(() => {});
    return () => { alive = false; };
  }, [userId]);

  return (
    <>
      <CoinHeader balance={balance} title={t.wallet.title} />
      <Screen>
        {balance === 0 && entries.length === 0 ? (
          // §9.6: an empty state is an invitation, not an apology.
          <Text style={[text.body, { color: theme.textMuted, marginTop: space.xxl }]}>
            {t.wallet.empty}
          </Text>
        ) : null}

        {batches.map((b) => (
          <View
            key={b.expiresAt}
            style={[
              styles.batch,
              {
                backgroundColor: theme.raised,
                borderColor: b.daysLeft <= 14 ? theme.warn : theme.line,
              },
            ]}
          >
            <Text style={[text.coinLarge, { color: theme.coin }]}>
              {formatCoins(b.remaining)}
            </Text>
            <Text style={[text.bodySmall, { color: theme.textMuted, marginTop: space.xs }]}>
              {b.daysLeft === 0
                ? fill(t.wallet.expiringToday, { coins: formatCoins(b.remaining) })
                : b.daysLeft === 1
                  ? fill(t.wallet.expiringOne, { coins: formatCoins(b.remaining) })
                  : fill(t.wallet.expiring, { coins: formatCoins(b.remaining), days: b.daysLeft })}
            </Text>
          </View>
        ))}

        {entries.length > 0 ? (
          <Text style={[text.label, { color: theme.textMuted, marginTop: space.xxl }]}>
            {t.wallet.history}
          </Text>
        ) : null}

        {entries.map((e) => (
          <View key={e.id} style={[styles.entry, { borderBottomColor: theme.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[text.body, { color: theme.text }]}>
                {t.wallet.reason[e.reason] ?? e.reason}
              </Text>
              <Text style={[text.dataSmall, { color: theme.textMuted }]}>
                {fill(t.wallet.expiresOn, { date: e.expiresAt.slice(0, 10) })}
              </Text>
            </View>
            <Text
              style={[
                text.data,
                { color: e.delta > 0 ? theme.coin : theme.textMuted },
              ]}
            >
              {formatDelta(e.delta)}
            </Text>
          </View>
        ))}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  batch: {
    marginTop: space.lg,
    padding: space.lg,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
