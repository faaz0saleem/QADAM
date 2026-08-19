import { supabase, isConfigured } from '../lib/supabase';
import { pktDateString } from '../lib/dates';
import * as demo from './demo';
import { getIntegrityToken, integrityNonce } from '../lib/attest';
import type { BoardRow, BoardScope, CoinBatch, LedgerEntry, Product, TodaySteps } from './types';

/**
 * The client's whole view of the server.
 *
 * Two rules hold everywhere in this file (§6.1, §13.2):
 *   1. It sends raw step counts and nothing else. No coin amount, no balance, no
 *      discount, no multiplier ever travels from here to the server.
 *   2. It never computes a coin value. Every number it shows was decided server
 *      side; the demo fallback below mirrors the server's rules rather than
 *      inventing friendlier ones.
 */

export const usingDemoData = !isConfigured;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export async function getToday(userId: string | null): Promise<TodaySteps> {
  if (usingDemoData || !userId) return demo.demoToday;

  const [{ data: row }, streak] = await Promise.all([
    supabase!
      .from('daily_steps')
      .select('date, raw_steps, credited_steps, coins_awarded, updated_at')
      .eq('date', pktDateString())
      .maybeSingle(),
    rpc<number>('current_streak', { p_user: userId }),
  ]);

  return {
    date: pktDateString(),
    rawSteps: row?.raw_steps ?? 0,
    creditedSteps: row?.credited_steps ?? 0,
    coinsToday: row?.coins_awarded ?? 0,
    // The cap is a server dial (§4). It is shown, never used to compute a coin
    // figure on the client.
    dailyCap: 15000,
    streak: streak ?? 0,
    lastSyncedAt: row?.updated_at ?? null,
  };
}

export async function getBalance(userId: string | null): Promise<number> {
  if (usingDemoData || !userId) return demo.demoBalance;
  return rpc<number>('coin_balance', { p_user: userId });
}

export async function getBatches(userId: string | null): Promise<CoinBatch[]> {
  if (usingDemoData || !userId) return demo.demoBatches;
  const { data, error } = await supabase!
    .from('coin_batches')
    .select('expires_at, remaining, days_left')
    .order('expires_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    expiresAt: b.expires_at,
    remaining: b.remaining,
    daysLeft: b.days_left,
  }));
}

export async function getLedger(userId: string | null, limit = 50): Promise<LedgerEntry[]> {
  if (usingDemoData || !userId) return demo.demoLedger;
  const { data, error } = await supabase!
    .from('coin_ledger')
    .select('id, delta, reason, expires_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id,
    delta: e.delta,
    reason: e.reason,
    expiresAt: e.expires_at,
    createdAt: e.created_at,
  }));
}

export async function getBoard(userId: string | null, scope: BoardScope): Promise<BoardRow[]> {
  if (usingDemoData || !userId) return demo.demoBoard;

  const raw =
    scope === 'friends'
      ? await rpc<Array<Record<string, unknown>>>('leaderboard_friends', { p_user: userId })
      : await rpc<Array<Record<string, unknown>>>('leaderboard_page', {
          p_user: userId,
          p_scope: scope,
        });

  return raw.map((r) => ({
    userId: String(r.user_id),
    name: (r.name as string) ?? null,
    steps: Number(r.steps ?? 0),
    rank: Number(r.rank ?? 0),
    percentile: Number(r.percentile ?? 100),
    isMe: Boolean(r.is_me),
    pinned: Boolean(r.pinned),
  }));
}

export async function getProducts(userId: string | null): Promise<Product[]> {
  if (usingDemoData || !userId) return demo.demoProducts;

  const { data, error } = await supabase!
    .from('products')
    .select('id, title, price_pkr, stock, images')
    .gt('stock', 0)
    .limit(60);
  if (error) throw new Error(error.message);

  // The discount ceiling comes from a view that derives it from cost_pkr without
  // ever exposing cost_pkr (§0, and the RLS migration).
  const { data: ceilings } = await supabase!
    .from('product_discount_ceiling')
    .select('product_id, max_discount_pkr, coin_eligible');
  const byId = new Map((ceilings ?? []).map((c) => [c.product_id, c]));

  const results = await Promise.all(
    (data ?? []).map(async (p) => {
      const ceiling = byId.get(p.id);
      const yours = ceiling?.coin_eligible
        ? await rpc<number>('affordable_discount_pkr', {
            p_user: userId,
            p_product: p.id,
            p_qty: 1,
          })
        : 0;
      return {
        id: p.id,
        title: p.title,
        pricePkr: p.price_pkr,
        stock: p.stock,
        images: (p.images as string[]) ?? [],
        maxDiscountPkr: ceiling?.max_discount_pkr ?? 0,
        yourDiscountPkr: yours ?? 0,
      };
    }),
  );
  return results;
}

/**
 * §6.1 — raw counts only, through the attestation function.
 *
 * This deliberately does NOT call `submit_steps` directly. That RPC exists and
 * is granted to authenticated users, but it can only ever pass `attested =
 * false`, because a client cannot vouch for itself. The Edge Function verifies
 * a Play Integrity or DeviceCheck token first and then calls `award_steps` as
 * service_role.
 *
 * Nothing in this request is a coin value, a balance or a discount (§13.2), and
 * the response carries only how many coins the SERVER decided to mint.
 */
export async function submitSteps(
  date: string,
  rawSteps: number,
  source: 'health_connect' | 'healthkit',
): Promise<number> {
  if (usingDemoData) return 0;

  const platform = source === 'health_connect' ? 'android' : 'ios';
  const nonce = await integrityNonce(date, rawSteps);
  const integrityToken = await getIntegrityToken(nonce);

  const { data, error } = await supabase!.functions.invoke<{ coins: number }>('ingest-steps', {
    body: {
      date,
      raw_steps: Math.max(0, Math.round(rawSteps)),
      platform,
      integrity_token: integrityToken,
      nonce,
    },
  });

  if (error) throw new Error(`ingest-steps: ${error.message}`);
  return data?.coins ?? 0;
}

/**
 * §7.5 — placing an order.
 *
 * Sends what to buy and how many COINS to spend. It does not send a price, a
 * cost, a discount or a total: the server prices the basket from the catalogue,
 * caps the discount per line by §0, debits the coins, and writes the header
 * (§13.2).
 */
export async function placeOrder(input: {
  items: Array<{ product_id: string; qty: number }>;
  address: Record<string, string>;
  phone: string;
  paymentMethod: 'cod' | 'card' | 'wallet';
  coins: number;
}): Promise<string> {
  if (usingDemoData) throw new Error('No Supabase project is configured yet.');
  return rpc<string>('place_order', {
    p_items: input.items,
    p_address: input.address,
    p_phone: input.phone,
    p_payment_method: input.paymentMethod,
    p_coins: Math.max(0, Math.round(input.coins)),
  });
}

/**
 * How many coins this basket can actually absorb, and what that is worth.
 *
 * Deliberately a server call rather than arithmetic here: the rate is in
 * app_config and §4 forbids publishing it, so the client can know the rupees
 * and the coins without ever knowing the ratio.
 */
export async function quoteCoins(
  userId: string | null,
  items: Array<{ product_id: string; qty: number }>,
): Promise<{ coins: number; discountPkr: number }> {
  if (usingDemoData || !userId) {
    const discountPkr = 85;
    return { coins: 2840, discountPkr };
  }
  const perItem = await Promise.all(
    items.map((i) =>
      rpc<number>('affordable_discount_pkr', {
        p_user: userId,
        p_product: i.product_id,
        p_qty: i.qty,
      }),
    ),
  );
  const discountPkr = perItem.reduce((sum, d) => sum + (d ?? 0), 0);
  const balance = await getBalance(userId);
  return { coins: balance, discountPkr };
}
