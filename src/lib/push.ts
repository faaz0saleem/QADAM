import { Platform } from 'react-native';
import { supabase, isConfigured } from './supabase';

/**
 * §4, §7.2 — registering for the reminders that bring people back.
 *
 * Asks for permission at a moment when the value is obvious rather than on
 * first launch: the expiry warning is the single best reactivation lever we
 * have, and a permission prompt shown before anyone has minted a coin gets
 * denied and cannot be asked for again on iOS.
 */
export async function registerForPush(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!isConfigured) return 'unavailable';

  try {
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Coins and streaks',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return 'denied';

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    const { data: auth } = await supabase!.auth.getUser();
    if (!auth?.user) return 'unavailable';

    await supabase!.from('push_tokens').upsert(
      {
        user_id: auth.user.id,
        token,
        platform: Platform.OS === 'android' ? 'android' : 'ios',
        last_seen: new Date().toISOString(),
      },
      { onConflict: 'user_id,token' },
    );

    return 'granted';
  } catch {
    // No native module, or a simulator without push support. Not an error worth
    // showing anyone.
    return 'unavailable';
  }
}
