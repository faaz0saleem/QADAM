import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json is the static half of the config. This file is the half that has to
 * read the environment, and it exists because two of the three things below are
 * launch-blocking bugs rather than niceties — the sort that only show up the
 * first time someone installs the APK on a real phone.
 *
 * 1. THE ADMOB APP ID. react-native-google-mobile-ads writes
 *    com.google.android.gms.ads.APPLICATION_ID into the manifest from a plugin
 *    prop. Without it the Google Mobile Ads SDK throws on startup — not when an
 *    ad is requested, on startup — and the app dies at the splash screen. The
 *    fallbacks below are Google's own published test IDs, which are safe to ship
 *    to a device and useless in production; HUMAN_TASKS.md carries the real ones
 *    as a P1.
 *
 * 2. THE HEALTH CONNECT RATIONALE. Android 14 will not grant a health permission
 *    to an app that cannot show a rationale screen, and Play's health data
 *    declaration requires it. react-native-health-connect ships the config
 *    plugin that adds the intent-filter and the activity-alias — it just has to
 *    be listed. It was not, so every generated manifest until now was missing
 *    both, which is the earning half of the product not working on a modern
 *    phone.
 *
 * 3. SYSTEM_ALERT_WINDOW. React Native's own manifest contributes it for the dev
 *    overlay. "Draw over other apps" on a walking app that reads health data is
 *    exactly the permission a Play reviewer stops at, and we never use it.
 */

const ADMOB_TEST_APP_ID_ANDROID = 'ca-app-pub-3940256099942544~3347511713';
const ADMOB_TEST_APP_ID_IOS = 'ca-app-pub-3940256099942544~1458002511';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),

  android: {
    ...config.android,
    blockedPermissions: [
      ...(config.android?.blockedPermissions ?? []),
      // §2: no GPS, ever. The three location permissions are already blocked in
      // app.json; this one is here for the reason in the header.
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },

  plugins: [
    ...((config.plugins ?? []) as NonNullable<ExpoConfig['plugins']>),

    // Dark by default (§9.1, the earning half). userInterfaceStyle in app.json
    // does nothing on Android without this module installed — prebuild says so
    // in a warning that is easy to scroll past.
    'expo-system-ui',

    // Adds androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE to MainActivity and
    // the ViewPermissionUsageActivity alias Android 14 looks for.
    'react-native-health-connect',

    // HealthKit entitlements and the two usage strings, on iOS.
    [
      'react-native-health',
      { isClinicalDataEnabled: false, healthSharePermission: 'Qadam reads your step count so it can mint coins for the walking you already do.' },
    ],

    [
      'react-native-google-mobile-ads',
      {
        androidAppId: process.env.ADMOB_ANDROID_APP_ID ?? ADMOB_TEST_APP_ID_ANDROID,
        iosAppId: process.env.ADMOB_IOS_APP_ID ?? ADMOB_TEST_APP_ID_IOS,
        // §7.8 — rewarded video only, in the earning half. Delaying measurement
        // init keeps the ads SDK off the startup path of a shopping session it
        // has no business being in.
        delayAppMeasurementInit: true,
        userTrackingUsageDescription:
          'Qadam does not track you across other apps. This permission only affects the rewarded videos you choose to watch.',
      },
    ],
  ],
});
