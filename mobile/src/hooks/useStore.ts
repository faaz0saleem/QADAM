import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface StoreProduct {
  id: string;
  title: string;
  brand_name: string | null;
  category_id: string | null;
  price_pkr: number;
  stock: number;
  images: string[];
  /** What THIS user saves today — capped by §0 and by their own balance. */
  my_discount_pkr: number;
}

export function useStoreFeed(search?: string) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const { data, error } = await supabase.rpc('store_feed', {
        p_search: search && search.length > 1 ? search : null,
      });
      if (error) {
        setFailed(true);
        return;
      }
      setProducts((data ?? []) as StoreProduct[]);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  return { products, loading, failed, reload: load };
}

export interface Order {
  id: string;
  status: string;
  created_at: string;
  subtotal_pkr: number;
  discount_pkr: number;
  shipping_pkr: number;
  total_pkr: number;
  item_count: number;
  coin_state: 'none' | 'pending' | 'spent' | 'burned' | 'returned' | null;
}

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc('my_orders');
      setOrders((data ?? []) as Order[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { orders, loading, reload: load };
}
