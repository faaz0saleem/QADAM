import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';

import { createStore, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

type Status = 'loading' | 'signed_in' | 'signed_out';

interface SessionState {
  status: Status;
  session: Session | null;
}

export const sessionStore = createStore<SessionState>({ status: 'loading', session: null });

/**
 * Mounted once, at the root. Supabase persists the session in AsyncStorage and
 * refreshes it in the background, so the app's job is to watch rather than ask.
 */
export function useSessionWatcher(): void {
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      sessionStore.set({
        session: data.session,
        status: data.session ? 'signed_in' : 'signed_out',
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      sessionStore.set({ session, status: session ? 'signed_in' : 'signed_out' });
    });

    return () => sub.subscription.unsubscribe();
  }, []);
}

export function useSession() {
  return useStore(sessionStore);
}

export async function sendOtp(phoneE164: string): Promise<boolean> {
  const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 });
  if (error) console.warn('otp send failed', error.message);
  return !error;
}

export async function verifyOtp(phoneE164: string, code: string): Promise<boolean> {
  const { error } = await supabase.auth.verifyOtp({ phone: phoneE164, token: code, type: 'sms' });
  if (error) console.warn('otp verify failed', error.message);
  return !error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
