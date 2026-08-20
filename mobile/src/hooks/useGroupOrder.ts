import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * A basket a team buys together.
 *
 * Read the header of supabase/migrations/..._group_orders.sql before changing
 * anything here. The short version: nobody's coins move. Every member approves,
 * and every member who has coins spends THEIR OWN on the shared basket.
 *
 * Which is why respondToGroupOrder sends two booleans and an id. There is no
 * amount in this file, no pledge, no share, and there must never be one —
 * §13.2 calls a coin figure crossing this boundary a P0 bug, and the server
 * would have no way to tell an honest one from an invented one.
 */
export interface GroupOrderMember {
  user_id: string;
  name: string | null;
  is_me: boolean;
  decision: 'approved' | 'declined' | 'waiting';
  spending: boolean;
  /** Only ever populated for you. Other people's contributions are not yours to see. */
  coins_spent: number | null;
}

export interface GroupOrderItem {
  product_id: string;
  title: string;
  qty: number;
  price_pkr: number;
  line_pkr: number;
  in_stock: boolean;
  images: string[];
}

export interface GroupOrder {
  id: string;
  status: 'open' | 'placed' | 'declined' | 'cancelled' | 'expired';
  opened_by: string;
  opened_by_name: string | null;
  i_opened_it: boolean;
  expires_at: string;
  order_id: string | null;
  /** Null unless you are the person it is being delivered to. */
  address: string | null;
  subtotal_pkr: number;
  /** The §0 ceiling on this basket. A property of the products, not of anyone's wallet. */
  max_discount_pkr: number;
  /** What the approvals collected so far can actually fund. */
  discount_pkr: number;
  total_pkr: number;
  my_coins_spent: number;
  items: GroupOrderItem[];
  members: GroupOrderMember[];
  waiting_on: number;
}

export function useGroupOrders() {
  const [orders, setOrders] = useState<GroupOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc('my_group_orders');
      setOrders((data ?? []) as GroupOrder[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { orders, loading, reload: load };
}

export function useGroupOrder(id: string | undefined) {
  const [order, setOrder] = useState<GroupOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setFailed(false);
    const { data, error } = await supabase.rpc('group_order', { p_gid: id });
    if (error || !data) setFailed(true);
    else setOrder(data as GroupOrder);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { order, loading, failed, reload: load, setOrder };
}

export async function openGroupOrder(
  items: { product_id: string; qty: number }[],
  address: string,
  phone: string,
): Promise<{ order?: GroupOrder; error?: string }> {
  const { data, error } = await supabase.rpc('open_group_order', {
    p_items: items,
    p_address: address,
    p_phone: phone,
    p_payment_method: 'cod',
  });
  if (error) return { error: error.message };
  return { order: data as GroupOrder };
}

/**
 * `useCoins` is "am I willing to put my own coins toward this", exactly as
 * place_order's p_use_coins is. It is not an amount and it never becomes one:
 * the server decides how much each approver contributes, from balances the
 * client cannot read at a rate the client cannot read (§4, §13.2).
 */
export async function respondToGroupOrder(
  id: string,
  approve: boolean,
  useCoins = true,
): Promise<{ order?: GroupOrder; error?: string }> {
  const { data, error } = await supabase.rpc('respond_to_group_order', {
    p_gid: id,
    p_approve: approve,
    p_use_coins: useCoins,
  });
  if (error) return { error: error.message };
  return { order: data as GroupOrder };
}

export async function cancelGroupOrder(id: string): Promise<{ order?: GroupOrder; error?: string }> {
  const { data, error } = await supabase.rpc('cancel_group_order', { p_gid: id });
  if (error) return { error: error.message };
  return { order: data as GroupOrder };
}
