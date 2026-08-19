import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useSession } from '@/hooks/useSession';
import { setPendingInvite } from '@/lib/pendingInvite';

/**
 * §7.6 — "make joining work from a deep link without an account (create the
 * account after they're in)."
 *
 * If they are signed in, this is one hop to the team screen with the code
 * filled in. If they are not, the code is parked and the session gate takes
 * them to sign-in; the auth flow claims it on the way out, so the invite
 * survives the detour instead of being the thing they lost by following a link.
 */
export default function JoinDeepLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const clean = (code ?? '').toUpperCase();

    if (status === 'signed_out') {
      void setPendingInvite(clean);
      return; // the session gate redirects to sign-in
    }
    router.replace({ pathname: '/team', params: { code: clean } });
  }, [code, status, router]);

  return null;
}
