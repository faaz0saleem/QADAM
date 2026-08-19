// Imported per weight, NOT from the package root.
//
// `@expo-google-fonts/inter` has no `exports` map, so importing from the barrel
// pulls every weight it ships — eighteen files at ~345 kB each, about 6 MB of
// Inter alone, in an app for a market that pays by the megabyte. The per-weight
// subpaths pull exactly one file. Verified with `npx expo export`: 69 bundled
// font assets before, 6 after.
import { FamiljenGrotesk_700Bold } from '@expo-google-fonts/familjen-grotesk/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { NotoNastaliqUrdu_400Regular } from '@expo-google-fonts/noto-nastaliq-urdu/400Regular';

/**
 * §9.3 — the three families, plus Urdu.
 *
 * Deliberately six files and no more. §9.3 gives each family exactly one job:
 * the display face is used for titles and the step count only, the body face is
 * Inter at 13–15px, and the data face is a monospace with tabular figures. None
 * of those needs a range of weights.
 *
 * The keys here are the strings in `type.ts`. A mismatch between the two is
 * silent — React Native falls back rather than erroring — so a test asserts
 * every family named in `text` is present in this map.
 */
export const fontAssets = {
  FamiljenGrotesk_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  NotoNastaliqUrdu_400Regular,
} as const;
