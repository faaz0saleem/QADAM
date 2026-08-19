import AsyncStorage from '@react-native-async-storage/async-storage';

import { createStore, useStore } from './store';

/**
 * The cart lives on the device, and only the device.
 *
 * There is no cart table and no cart RPC. An order is created in one call at
 * checkout, from product ids and quantities — which means there is no
 * server-side object a client could edit the price of between adding an item and
 * paying for it. §13.2 in a different shape: the smallest surface that can carry
 * a number the client chose is the safest one.
 */
export interface CartLine {
  productId: string;
  title: string;
  pricePkr: number;
  qty: number;
  image: string | null;
}

const KEY = 'qadam.cart.v1';
const MAX_PER_ITEM = 10;

export const cartStore = createStore<{ lines: CartLine[]; ready: boolean }>({
  lines: [],
  ready: false,
});

export async function loadCart(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cartStore.set({ lines: raw ? (JSON.parse(raw) as CartLine[]) : [], ready: true });
  } catch {
    cartStore.set({ lines: [], ready: true });
  }
}

async function persist(lines: CartLine[]): Promise<void> {
  cartStore.set({ lines });
  await AsyncStorage.setItem(KEY, JSON.stringify(lines));
}

export async function addToCart(line: Omit<CartLine, 'qty'>, qty = 1): Promise<void> {
  const lines = [...cartStore.get().lines];
  const existing = lines.find((l) => l.productId === line.productId);

  if (existing) {
    // The server refuses more than ten of one item, so the cart refuses it too
    // rather than letting someone reach checkout and be told no.
    existing.qty = Math.min(MAX_PER_ITEM, existing.qty + qty);
  } else {
    lines.push({ ...line, qty: Math.min(MAX_PER_ITEM, qty) });
  }
  await persist(lines);
}

export async function setQty(productId: string, qty: number): Promise<void> {
  const lines = cartStore
    .get()
    .lines.map((l) => (l.productId === productId ? { ...l, qty: Math.min(MAX_PER_ITEM, qty) } : l))
    .filter((l) => l.qty > 0);
  await persist(lines);
}

export async function clearCart(): Promise<void> {
  await persist([]);
}

export function useCart() {
  const { lines, ready } = useStore(cartStore);
  return {
    lines,
    ready,
    count: lines.reduce((n, l) => n + l.qty, 0),
    // Display only. The real subtotal is computed at checkout from the products
    // table, because a price on a device is a price that can be edited.
    subtotalPkr: lines.reduce((n, l) => n + l.qty * l.pricePkr, 0),
  };
}
