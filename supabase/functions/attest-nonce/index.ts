// Issues a single-use, five-minute nonce for the caller to attest over.
//
// The nonce is what stops a captured attestation token being replayed forever.
// It is bound to the signed-in user and burned on use.
import { serviceClient, callerId, json } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const userId = await callerId(req);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const db = serviceClient();
  const { data, error } = await db.rpc('issue_attestation_nonce', {
    p_user_id: userId,
  });
  if (error) {
    console.error('nonce issue failed', error);
    return json({ error: 'unavailable' }, 503);
  }

  return json({ nonce: data, expires_in: 300 });
});
