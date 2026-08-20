import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface MyTeam {
  team_id: string;
  name: string;
  city: string | null;
  invite_code: string;
  is_captain: boolean;
  member_count: number;
  member_max: number;
}

export interface TeamMate {
  user_id: string;
  name: string | null;
  joined_at: string;
  is_captain: boolean;
  is_me: boolean;
}

/**
 * Your team, for the screens that only need to know whether you have one.
 *
 * The Team screen itself does its own fetch, because it also wants the standing
 * and it wants all three in one round trip. This is for everywhere else — the
 * basket, which offers "buy this with your team" only to somebody who has a team
 * with another person in it.
 */
export function useTeam() {
  const [team, setTeam] = useState<MyTeam | null>(null);
  const [roster, setRoster] = useState<TeamMate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, rosterRes] = await Promise.all([
        supabase.rpc('my_team'),
        supabase.rpc('team_roster'),
      ]);
      setTeam(((teamRes.data ?? []) as MyTeam[])[0] ?? null);
      setRoster((rosterRes.data ?? []) as TeamMate[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { team, roster, loading, reload: load };
}
