import { Platform } from 'react-native';
import mobileAds, {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

import { supabase } from './supabase';

/**
 * README §7.8 — rewarded video, and ONLY rewarded video.
 *
 * "Zero ads in browse, cart, or checkout. One abandoned PKR 2,500 order wipes
 *  out months of ad revenue from that user. An interstitial in a shopping flow
 *  is a net loss dressed up as revenue."
 *
 * There is no banner unit, no interstitial unit, and no app-open unit in this
 * file — not disabled, absent. The schema agrees: ad_impressions.placement has
 * no value that could name a point in the shopping flow.
 *
 * The coins are NOT credited here. The client watching a video proves nothing;
 * AdMob's server-side verification calls our admob-ssv function, which checks
 * Google's signature and credits from config. All this does is show the ad and
 * then ask the server what the balance is now (§13.2).
 */
let initialised = false;

async function ensureInitialised(): Promise<void> {
  if (initialised) return;
  await mobileAds().initialize();
  initialised = true;
}

function rewardedUnitId(): string {
  if (__DEV__) return TestIds.REWARDED;
  const id =
    Platform.OS === 'android'
      ? process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ANDROID
      : process.env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_IOS;
  return id ?? TestIds.REWARDED;
}

export type RewardOutcome = 'earned' | 'dismissed' | 'unavailable';

/**
 * Show one rewarded video. Resolves when the ad closes.
 *
 * `earned` means the user watched it through and Google will call our SSV
 * endpoint — not that coins have arrived. The caller refreshes the balance from
 * the server rather than adding thirty to a local number.
 */
export function showRewardedAd(userId: string): Promise<RewardOutcome> {
  return new Promise((resolve) => {
    void (async () => {
      try {
        await ensureInitialised();
      } catch {
        resolve('unavailable');
        return;
      }

      const ad = RewardedAd.createForAdRequest(rewardedUnitId(), {
        // Ties the impression to the account, so AdMob's callback names who to
        // credit. It is a user id, not an amount — the amount is ours.
        serverSideVerificationOptions: { userId },
        requestNonPersonalizedAdsOnly: false,
      });

      let earned = false;
      let settled = false;
      const finish = (outcome: RewardOutcome) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(outcome);
      };

      const offLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show());
      const offEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      });
      const offClosed = ad.addAdEventListener(AdEventType.CLOSED, () =>
        finish(earned ? 'earned' : 'dismissed'),
      );
      const offError = ad.addAdEventListener(AdEventType.ERROR, () => finish('unavailable'));

      const unsubscribe = () => {
        offLoaded();
        offEarned();
        offClosed();
        offError();
      };

      // Fill in this market is not guaranteed. A spinner that never resolves is
      // worse than an honest "not right now".
      setTimeout(() => finish('unavailable'), 20_000);

      ad.load();
    })();
  });
}

/** How many are left today. Server-counted; the client only displays it. */
export async function rewardedAdsLeftToday(): Promise<number> {
  const { data } = await supabase.rpc('my_rewarded_ads_left_today');
  return typeof data === 'number' ? data : 0;
}
