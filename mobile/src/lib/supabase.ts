import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

import { DEMO, demoClient } from './demo';

/**
 * The client holds the ANON key only.
 *
 * Everything that matters is behind RLS and behind functions the anon and
 * authenticated roles cannot execute. A service role key must never appear in
 * this bundle: Expo inlines every EXPO_PUBLIC_ variable into the shipped
 * JavaScript, so anything reachable from here is public.
 */
const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants.expoConfig?.extra?.supabaseUrl as string | undefined);
const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined);

/**
 * Whether this build is pointed at a real backend.
 *
 * It matters because an APK built before the Supabase project exists is a
 * perfectly valid APK — it installs and launches — and then every request goes
 * to http://localhost and fails with a network error at the sign-in screen.
 * That looks like a broken app rather than an unconfigured one, and the two
 * need very different responses from whoever is holding the phone.
 *
 * app/_layout.tsx reads this and says so, once, instead.
 */
export const isConfigured = DEMO || Boolean(url && anonKey);

if (!isConfigured) {
  // Loud at startup rather than a confusing 401 on the first request.
  console.error(
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env.local — see HUMAN_TASKS.md.',
  );
}

/**
 * In preview mode this is the stand-in from ./demo — the same surface, answering
 * from fixtures. A preview build therefore has no route to a real backend at
 * all, which is the property that makes it safe to ship one for a screenshot.
 */
export const supabase = (
  DEMO
    ? (demoClient as unknown as SupabaseClient)
    : createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          // React Native has no URL bar to parse a session out of.
          detectSessionInUrl: false,
        },
      })
) as SupabaseClient;

export const functionsBase = url ? `${url}/functions/v1` : '';
