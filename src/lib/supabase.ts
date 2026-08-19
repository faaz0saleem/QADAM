import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * The anon key is safe to ship: every table it can reach is behind RLS, and the
 * things that must never reach a client — `app_config` (which holds the coin
 * rate, §4) and `cost_pkr` — have no policy and no grant.
 *
 * There is deliberately no service-role path in this file. If a feature seems to
 * need one, it belongs in an Edge Function.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
