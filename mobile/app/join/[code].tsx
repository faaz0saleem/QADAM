import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

/**
 * §7.6 — "make joining work from a deep link without an account (create the
 * account after they're in)."
 *
 * The session gate in the root layout already sends an unauthenticated visitor
 * to sign-in, and expo-router restores this route afterwards, so the code
 * survives the detour through the OTP flow. All this route does is carry it to
 * the team screen.
 */
export default function JoinDeepLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace({ pathname: '/team', params: { code: (code ?? '').toUpperCase() } });
  }, [code, router]);

  return null;
}
