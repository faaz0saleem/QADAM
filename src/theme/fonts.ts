import {
  FamiljenGrotesk_700Bold,
} from '@expo-google-fonts/familjen-grotesk';
import {
  Inter_400Regular,
  Inter_500Medium,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  NotoNastaliqUrdu_400Regular,
} from '@expo-google-fonts/noto-nastaliq-urdu';

/**
 * §9.3 — the three families, plus Urdu.
 *
 * Deliberately six files and no more. Every weight bundled is download size on
 * a connection that charges by the megabyte, and §9.3 gives each family exactly
 * one job: the display face is used for titles and the step count only, the
 * body face is Inter at 13–15px, and the data face is a monospace with tabular
 * figures. None of those needs a range of weights.
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
