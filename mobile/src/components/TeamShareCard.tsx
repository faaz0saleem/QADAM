import { useRef, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Text } from './ui';
import { Button } from './Button';
import { earning, space, text as type } from '@/theme';
import { useI18n, fill } from '@/i18n';
import { formatNumber } from '@/lib/format';

/**
 * §7.6 — "generate a shareable image card of the team's weekly rank".
 *
 * An image rather than a link because that is what gets forwarded in a WhatsApp
 * group, which is where recruitment for a Lahore office team actually happens.
 * The invite code is on the card for the same reason: someone who sees it two
 * forwards later can join without asking anybody for anything.
 *
 * The card is rendered off-screen at a fixed size so it looks the same whatever
 * device captured it — a share card that reflows to the sender's screen width
 * arrives cropped.
 */
export function TeamShareCard({
  teamName,
  rank,
  ofTotal,
  steps,
  inviteCode,
}: {
  teamName: string;
  rank: number;
  ofTotal: number;
  steps: number;
  inviteCode: string;
}) {
  const { t } = useI18n();
  const shotRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1 });
      await Share.share({
        url: uri,
        message: fill(t.team.shareMessage, { code: inviteCode }),
      });
    } catch {
      // A device that cannot capture still gets to share. Falling back to text
      // beats a button that does nothing.
      await Share.share({ message: fill(t.team.shareMessage, { code: inviteCode }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/*
        Off-screen, not hidden: a display:none view has no layout and captures
        blank. Parked to the left of the viewport instead.
      */}
      <View style={styles.offscreen} pointerEvents="none">
        <View ref={shotRef} collapsable={false} style={styles.card}>
            <Text variant="label" style={styles.tagline}>
              {t.team.cardTagline}
            </Text>

            <Text variant="screenTitle" style={styles.name} numberOfLines={2}>
              {teamName}
            </Text>

            {/* The rank is the point of the card, so it is the size of the point. */}
            <Text variant="counter" style={styles.rank}>
              {formatNumber(rank)}
            </Text>
            <Text variant="dataSmall" style={styles.of}>
              {fill(t.team.standingRank, { rank: formatNumber(rank), total: formatNumber(ofTotal) })}
            </Text>

            <Text variant="dataSmall" style={styles.steps}>
              {fill(t.team.cardSteps, { steps: formatNumber(steps) })}
            </Text>

            <View style={styles.codeRow}>
              <Text variant="label" style={styles.codeLabel}>
                {t.you.inviteCode}
              </Text>
              {/* NOT brass. An invite code is not a coin value, and §9.2 means
                  what it says even on a card nobody will see in context. */}
              <Text variant="dataLarge" style={styles.code}>
                {inviteCode}
              </Text>
            </View>
        </View>
      </View>

      <Button label={t.team.shareCard} onPress={() => void share()} loading={busy} />
    </>
  );
}

const styles = StyleSheet.create({
  offscreen: { position: 'absolute', left: -2000, top: 0 },
  // A fixed 1080×1080, the shape every messaging app previews without cropping.
  card: {
    width: 1080,
    height: 1080,
    backgroundColor: earning.bg,
    padding: 96,
    justifyContent: 'center',
    gap: space.lg,
  },
  tagline: { ...type.label, color: earning.textDim, fontSize: 32, letterSpacing: 2 },
  name: { ...type.screenTitle, color: earning.text, fontSize: 84 },
  rank: { ...type.counter, color: earning.text, fontSize: 320, letterSpacing: -12 },
  of: { ...type.dataSmall, color: earning.textDim, fontSize: 36 },
  steps: { ...type.dataSmall, color: earning.textDim, fontSize: 36 },
  codeRow: { marginTop: space.xxl, gap: space.sm },
  codeLabel: { ...type.label, color: earning.textFaint, fontSize: 28 },
  code: { ...type.dataLarge, color: earning.text, fontSize: 72, letterSpacing: 12 },
});
