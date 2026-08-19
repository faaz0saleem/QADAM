// In-app account deletion, which both stores require of any app with accounts.
//
// Two steps in a fixed order. The rows go first, through a function that refuses
// unless the account has already asked to leave; the auth user goes second.
// Reversing them would cascade the auth deletion back into a schema whose ledger
// is append-only, and the whole thing would fail with the account half gone.
import { serviceClient, callerId, json } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // From the caller's own JWT. A user id in a request body is the field an
  // attacker edits first, and this is the one endpoint where getting that wrong
  // means deleting somebody else.
  const userId = await callerId(req);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const db = serviceClient();

  const { data, error } = await db.rpc('delete_account', { p_user_id: userId });
  if (error) {
    console.error('delete_account failed', error);
    return json({ error: 'unavailable' }, 503);
  }

  // Only now: this cascades back into public.users, which by this point has no
  // rows left to cascade into.
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError) {
    // The rows are gone and the sign-in is not. Loud, because the account is now
    // in a state that needs a human: the person can still authenticate but has
    // no profile, and the next sign-in would silently create a fresh one.
    console.error('auth user not deleted after row deletion', { userId, authError });
    return json({ deleted: true, warning: 'sign_in_not_removed' });
  }

  return json(data);
});
