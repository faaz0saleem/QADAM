import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export interface StoreProduct {
  id: string;
  title: string;
  brand_name: string | null;
  category_id: string | null;
  category_name: string | null;
  price_pkr: number;
  stock: number;
  images: string[];
  /** What THIS user saves today — capped by §0 and by their own balance. */
  my_discount_pkr: number;
  /**
   * README §8.3 — a licensed listing we link out to rather than stock. It is
   * never added to a basket: order_items has a trigger that refuses one, and
   * the product page offers the partner's link instead of an Add button.
   */
  is_affiliate: boolean;
  affiliate_url: string | null;
}

export interface StoreCategory {
  id: string;
  name: string;
  sort_order: number;
  live_count: number;
}

export type StoreSort = 'new' | 'price_asc' | 'price_desc' | 'saving';

/** One screenful. store_feed caps at 60 server-side whatever this says. */
const PAGE = 24;

export function useStoreFeed(
  search?: string,
  categoryId?: string | null,
  sort: StoreSort = 'new',
) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchPage = useCallback(
    async (offset: number) => {
      const { data, error } = await supabase.rpc('store_feed', {
        p_search: search && search.length > 1 ? search : null,
        p_category: categoryId ?? null,
        p_limit: PAGE,
        p_offset: offset,
        p_sort: sort,
      });
      if (error) throw error;
      return (data ?? []) as StoreProduct[];
    },
    [search, categoryId, sort],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchPage(0);
      setProducts(page);
      setExhausted(page.length < PAGE);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  /**
   * Paged rather than infinite-scrolled, on purpose. §9.7's device is a
   * three-year-old Android on mobile data; an infinite scroll on that hardware
   * is a list that grows until it stutters, and a shopper who has scrolled past
   * forty items has told you the first forty were wrong. A button is honest
   * about the cost of asking for more.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(products.length);
      // The offset walks a live table, so a product could arrive twice if stock
      // changed between pages. Dedupe rather than render a duplicate key.
      setProducts((current) => {
        const seen = new Set(current.map((p) => p.id));
        return [...current, ...page.filter((p) => !seen.has(p.id))];
      });
      setExhausted(page.length < PAGE);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, products.length, loadingMore, exhausted]);

  useEffect(() => {
    void load();
  }, [load]);

  return { products, loading, loadingMore, exhausted, failed, reload: load, loadMore };
}

/**
 * The category rail. store_categories() returns only categories with live
 * products in them, so an empty shelf is never offered — tapping a filter and
 * finding nothing is worse than not seeing the filter.
 */
export function useStoreCategories() {
  const [categories, setCategories] = useState<StoreCategory[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc('store_categories');
      setCategories((data ?? []) as StoreCategory[]);
    })();
  }, []);

  return categories;
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
