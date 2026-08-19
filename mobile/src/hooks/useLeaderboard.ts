import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type Scope = 'city' | 'team' | 'friends' | 'national';
export type Period = 'week' | 'all_time';

export interface BoardRow {
  rank: number;
  user_id: string;
  name: string | null;
  city: string | null;
  steps: number;
  is_me: boolean;
}

export interface MyRank {
  rank: number;
  of_total: number;
  percentile: number;
  steps: number;
}

/**
 * §7.3 — four scopes, and the user's own rank always pinned.
 *
 * The scope key is resolved server-side from the caller's identity: the client
 * asks for "my city", it cannot ask for someone else's.
 */
export function useLeaderboard(scope: Scope, period: Period) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [mine, setMine] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const periodArg = period === 'all_time' ? 'all_time' : null;
      const [board, rank] = await Promise.all([
        supabase.rpc('leaderboard', { p_scope: scope, p_period: periodArg, p_limit: 50 }),
        supabase.rpc('my_rank', { p_scope: scope, p_period: periodArg }),
      ]);

      // An empty board and a board that failed to load look identical on screen
      // unless the difference is carried through to it.
      if (board.error || rank.error) {
        setFailed(true);
        return;
      }
      setRows((board.data ?? []) as BoardRow[]);
      const mineRow = (rank.data ?? [])[0] as MyRank | undefined;
      setMine(mineRow ?? null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [scope, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, mine, loading, failed, reload: load };
}
