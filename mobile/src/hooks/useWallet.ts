import { useCallback, useEffect } from 'react';

import { createStore, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export interface CoinBatch {
  batch_id: string;
  minted_at: string;
  reason: string;
  minted: number;
  remaining: number;
  expires_at: string;
  days_left: number;
}

export interface LedgerRow {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
  expires_at: string | null;
}

interface WalletState {
  balance: number;
  batches: CoinBatch[];
  ledger: LedgerRow[];
  loading: boolean;
  /** True when the last refresh failed. The screen says so; §9.6. */
  failed: boolean;
}

/**
 * §5 — balance is never stored client-side either. It is read from
 * my_coin_balance(), which is SUM(delta) over unexpired batches, computed in the
 * database on every call. A cached number here would drift for exactly the same
 * reason a cached column would.
 */
export const walletStore = createStore<WalletState>({
  balance: 0,
  batches: [],
  ledger: [],
  loading: false,
  failed: false,
});

export async function refreshWallet(): Promise<void> {
  walletStore.set({ loading: true, failed: false });
  try {
    const [balance, batches, ledger] = await Promise.all([
      supabase.rpc('my_coin_balance'),
      supabase.rpc('my_coin_batches'),
      supabase
        .from('coin_ledger')
        .select('id, delta, reason, created_at, expires_at')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (balance.error || batches.error || ledger.error) {
      // Leave whatever was last known on screen. A balance that blanks to zero
      // on a failed refresh is worse than a stale one — it looks like the coins
      // are gone.
      walletStore.set({ failed: true });
      return;
    }

    walletStore.set({
      balance: typeof balance.data === 'number' ? balance.data : 0,
      batches: (batches.data ?? []) as CoinBatch[],
      ledger: (ledger.data ?? []) as LedgerRow[],
    });
  } catch {
    walletStore.set({ failed: true });
  } finally {
    walletStore.set({ loading: false });
  }
}

export function useWallet() {
  const state = useStore(walletStore);
  const refresh = useCallback(() => refreshWallet(), []);
  return { ...state, refresh };
}

/** Loads once when a screen that needs the full wallet mounts. */
export function useWalletOnMount() {
  useEffect(() => {
    void refreshWallet();
  }, []);
  return useWallet();
}
