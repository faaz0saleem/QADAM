/**
 * §2 — "TCS / Leopards / M&P REST API. Whichever gives us an account first.
 * Abstract behind one interface."
 *
 * That last sentence is the whole design. We do not know today which courier we
 * will have an account with, we will probably end up with two, and switching
 * must not touch the order code. So: one interface, one factory, and everything
 * courier-specific behind it.
 *
 * The shapes below are the intersection of what all three actually offer. Where
 * they disagree — and they disagree about almost everything, including whether
 * a tracking number is a number — the adapter normalises rather than leaking
 * the difference upward.
 */

export interface Parcel {
  orderId: string;
  /** Integer PKR to collect at the door. Zero for a prepaid order. */
  codAmountPkr: number;
  weightGrams: number;
  pieces: number;
  consignee: {
    name: string;
    phone: string;
    address: string;
    city: string;
  };
}

export interface Booking {
  /** What the courier calls this parcel. Always a string, even where they use a number. */
  trackingNumber: string;
  /** A URL the customer can open, or null where the courier has no public page. */
  trackingUrl: string | null;
  /** What the courier charged us, where they say at booking time. */
  bookedChargePkr: number | null;
}

export type ParcelStatus =
  | 'booked'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'refused'
  | 'returned'
  | 'lost'
  | 'unknown';

export interface StatusUpdate {
  trackingNumber: string;
  status: ParcelStatus;
  /** The courier's own wording, kept for the cases our mapping gets wrong. */
  rawStatus: string;
  occurredAt: string;
}

export interface Courier {
  readonly name: 'tcs' | 'leopards' | 'mp';
  book(parcel: Parcel): Promise<Booking>;
  track(trackingNumber: string): Promise<StatusUpdate>;
  cancel(trackingNumber: string): Promise<void>;
}

/**
 * Maps a courier's vocabulary onto ours.
 *
 * `refused` and `returned` are kept apart deliberately: §7.5 burns coins on a
 * refusal, and a parcel returned because we sent the wrong thing is not the
 * customer's fault and must not cost them their coins. Where a courier cannot
 * tell the two apart, the adapter reports `returned` — the outcome that does
 * not penalise the customer — and a human decides.
 */
export function mapStatus(raw: string, table: Record<string, ParcelStatus>): ParcelStatus {
  const key = raw.trim().toLowerCase();
  return table[key] ?? 'unknown';
}

export async function getCourier(): Promise<Courier> {
  const chosen = Deno.env.get('COURIER') ?? '';
  switch (chosen) {
    case 'tcs':
      return (await import('./tcs.ts')).default;
    case 'leopards':
      return (await import('./leopards.ts')).default;
    default:
      throw new Error(
        `COURIER is "${chosen}". Set it to tcs or leopards once an account exists ` +
        '(see HUMAN_TASKS.md).',
      );
  }
}
