import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Product } from './types';

export interface CartLine {
  product: Product;
  qty: number;
}

interface CartValue {
  lines: CartLine[];
  subtotalPkr: number;
  /** The most this basket could ever be discounted, per §0. Server-derived. */
  maxDiscountPkr: number;
  count: number;
  add: (product: Product, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
}

const Ctx = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  const add = useCallback((product: Product, qty = 1) => {
    setLines((current) => {
      const existing = current.find((l) => l.product.id === product.id);
      if (existing) {
        return current.map((l) =>
          l.product.id === product.id
            ? { ...l, qty: Math.min(l.qty + qty, product.stock) }
            : l,
        );
      }
      return [...current, { product, qty: Math.min(qty, product.stock) }];
    });
  }, []);

  const setQty = useCallback((productId: string, qty: number) => {
    setLines((current) =>
      qty <= 0
        ? current.filter((l) => l.product.id !== productId)
        : current.map((l) =>
            l.product.id === productId ? { ...l, qty: Math.min(qty, l.product.stock) } : l,
          ),
    );
  }, []);

  const remove = useCallback(
    (productId: string) => setLines((c) => c.filter((l) => l.product.id !== productId)),
    [],
  );

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartValue>(() => {
    const subtotalPkr = lines.reduce((sum, l) => sum + l.product.pricePkr * l.qty, 0);
    // maxDiscountPkr comes from product_discount_ceiling, which the server
    // derives from cost_pkr without ever exposing it. Summed here only to
    // decide what to SHOW; place_order recomputes it and is the authority.
    const maxDiscountPkr = lines.reduce((sum, l) => sum + l.product.maxDiscountPkr * l.qty, 0);
    return {
      lines,
      subtotalPkr,
      maxDiscountPkr,
      count: lines.reduce((sum, l) => sum + l.qty, 0),
      add,
      setQty,
      remove,
      clear,
    };
  }, [lines, add, setQty, remove, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
