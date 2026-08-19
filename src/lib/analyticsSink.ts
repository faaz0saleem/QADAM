import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isConfigured } from './supabase';
import { configureAnalytics, setAnalyticsUser, track, startSession, Sink } from './analytics';

const FIRST_OPEN_KEY = 'qadam.firstOpenAt.v1';

/**
 * Writes events to the analytics_events table. The client holds INSERT and no
 * SELECT (see the lockdown migration), so it can record its own behaviour and
 * read nobody's.
 */
const supabaseSink: Sink = {
  async send(events, context) {
    if (!isConfigured || !context.user_id) return;
    const { error } = await supabase!.from('analytics_events').insert(
      events.map((e) => ({
        user_id: context.user_id,
        session_id: e.session_id,
        name: e.name,
        props: e.props,
        platform: context.platform,
        app_version: context.app_version,
        city: context.city,
        occurred_at: e.occurred_at,
      })),
    );
    if (error) throw new Error(error.message);
  },
};

export function initAnalytics(appVersion: string): void {
  configureAnalytics(supabaseSink, {
    platform: Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web',
    app_version: appVersion,
  });
}

export { setAnalyticsUser };

/**
 * §1.2 — "Open retention, not install retention."
 *
 * Called on every foreground and nowhere else. Background sync deliberately
 * does not go through here: a step app keeps syncing whether or not anyone
 * looks at it, and counting that as engagement would make the one number this
 * project turns on meaningless.
 */
export async function trackForeground(): Promise<void> {
  startSession();

  let firstOpenAt = await AsyncStorage.getItem(FIRST_OPEN_KEY);
  if (!firstOpenAt) {
    firstOpenAt = new Date().toISOString();
    await AsyncStorage.setItem(FIRST_OPEN_KEY, firstOpenAt);
    track('first_open');
  }

  const daysSinceInstall = Math.floor(
    (Date.now() - new Date(firstOpenAt).getTime()) / 86400000,
  );
  track('app_open', { days_since_install: daysSinceInstall });
}
