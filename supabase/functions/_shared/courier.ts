/**
 * README §2 — "TCS / Leopards / M&P REST API. Whichever gives us an account
 * first. Abstract behind one interface."
 *
 * So: one interface, and the provider is a config value. Which of the three we
 * end up with is a business outcome we do not control, and none of the calling
 * code should have to care — nor should switching later be a rewrite.
 */
export interface Shipment {
  orderId: string;
  name: string;
  phone: string;
  address: string;
  city: string | null;
  /** What the courier collects at the door. Zero for a prepaid order. */
  codAmountPkr: number;
  pieces: number;
}

export interface Booking {
  booked: boolean;
  trackingNumber?: string;
  reason: string;
}

export type CourierStatus =
  | 'booked'
  | 'in_transit'
  | 'delivered'
  | 'refused'
  | 'returned'
  | 'unknown';

export interface Courier {
  readonly name: string;
  book(shipment: Shipment): Promise<Booking>;
  /** Map a provider's own status vocabulary onto ours. */
  normaliseStatus(providerStatus: string): CourierStatus;
}

const FAILED = (reason: string): Booking => ({ booked: false, reason });

/**
 * TCS and Leopards differ in field names and in almost nothing else that matters
 * here, so they share a shape. M&P is close enough to follow when its account
 * arrives.
 */
function restCourier(name: string, envPrefix: string): Courier {
  return {
    name,

    async book(shipment: Shipment): Promise<Booking> {
      const base = Deno.env.get(`${envPrefix}_API_BASE`);
      const key = Deno.env.get(`${envPrefix}_API_KEY`);
      if (!base || !key) return FAILED(`${name} not configured`);

      try {
        const res = await fetch(`${base}/booking`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
          body: JSON.stringify({
            reference: shipment.orderId,
            consignee_name: shipment.name,
            consignee_phone: shipment.phone,
            consignee_address: shipment.address,
            destination_city: shipment.city,
            // The single most important field on the whole request. Wrong here
            // and the courier collects the wrong amount at the door, which is a
            // refused parcel and a support conversation.
            cod_amount: shipment.codAmountPkr,
            pieces: shipment.pieces,
          }),
        });

        if (!res.ok) return FAILED(`${name} http ${res.status}`);
        const body = await res.json();
        const tracking = body?.tracking_number ?? body?.cn_number ?? body?.consignment_no;
        if (!tracking) return FAILED(`${name} returned no tracking number`);

        return { booked: true, trackingNumber: String(tracking), reason: 'ok' };
      } catch (e) {
        return FAILED(`${name} unreachable: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    },

    normaliseStatus(providerStatus: string): CourierStatus {
      const s = providerStatus.toLowerCase();
      // Anything unrecognised is 'unknown' rather than a guess. Guessing here
      // means marking a parcel delivered that was not, which spends coins that
      // should have been burned — or burns coins that should have been spent.
      if (s.includes('deliver')) return 'delivered';
      if (s.includes('refus') || s.includes('reject')) return 'refused';
      if (s.includes('return') || s.includes('rto')) return 'returned';
      if (s.includes('transit') || s.includes('out for') || s.includes('dispatch')) return 'in_transit';
      if (s.includes('book') || s.includes('pick')) return 'booked';
      return 'unknown';
    },
  };
}

export function activeCourier(): Courier {
  switch ((Deno.env.get('COURIER_PROVIDER') ?? 'tcs').toLowerCase()) {
    case 'leopards':
      return restCourier('Leopards', 'COURIER');
    case 'mp':
      return restCourier('M&P', 'COURIER');
    default:
      return restCourier('TCS', 'COURIER');
  }
}
