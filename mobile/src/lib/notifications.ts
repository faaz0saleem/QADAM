import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { COIN_BRASS_FOR_NOTIFICATION_CHANNEL } from './notification-colour';

/**
 * §2, §4 — "Coin expiry and streak-break reminders are our retention engine."
 *
 * WHEN we ask matters as much as that we ask. Asking on first launch, before the
 * app has done anything, is how an app gets permanently denied: the person has no
 * reason yet to want to hear from us. So the prompt waits until the first coins
 * are actually minted, at which point there is something real to be reminded
 * about. Denied once is denied forever on both platforms.
 */
const ASKED_KEY = 'qadam.pushAsked';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function hasBeenAsked(): Promise<boolean> {
  return (await AsyncStorage.getItem(ASKED_KEY)) === '1';
}

/**
 * Called once, after the first coins are minted. Returns true if we now hold a
 * token; false covers "declined", "simulator", and "no project id", all of which
 * are simply the absence of push rather than an error worth surfacing.
 */
export async function registerForPush(): Promise<boolean> {
  await AsyncStorage.setItem(ASKED_KEY, '1');

  // A simulator cannot receive a push token, and asking makes the log noisy.
  if (!Device.isDevice) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Qadam',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: COIN_BRASS_FOR_NOTIFICATION_CHANNEL,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const status =
    existing.status === 'granted'
      ? existing
      : await Notifications.requestPermissionsAsync();
  if (status.status !== 'granted') return false;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('no EAS project id — push token unavailable. See HUMAN_TASKS.md');
    return false;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token.data,
      p_platform: Platform.OS === 'android' ? 'android' : 'ios',
    });
    if (error) {
      console.warn('push token registration failed', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('push token request failed', e);
    return false;
  }
}
