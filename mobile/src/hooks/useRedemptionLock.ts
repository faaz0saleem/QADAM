import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * §6.1 — "No coin redemption in the first 7 days of an account's life. This alone
 * kills most farming, because farms need throughput."
 *
 * The server enforces it in private.spend_coins regardless. This is only so the
 * wallet can say when the coins unlock, rather than letting a checkout fail for
 * a reason the user cannot see.
 */
export function useRedemptionLock() {
  const [unlocksAt, setUnlocksAt] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('users')
        .select('created_at')
        .maybeSingle();

      const createdAt = (data as { created_at?: string } | null)?.created_at;
      if (!createdAt) return;

      // Mirrors REDEMPTION_HOLD_DAYS. The value is server-side config, and the
      // client is not told it — seven days is in the copy either way, and being
      // wrong here only ever means showing a date the server disagrees with by a
      // day, never granting a spend the server would refuse.
      const unlock = new Date(new Date(createdAt).getTime() + 7 * 86_400_000);
      setUnlocksAt(unlock.toISOString());
      setLocked(unlock.getTime() > Date.now());
    })();
  }, []);

  return { locked, unlocksAt };
}
