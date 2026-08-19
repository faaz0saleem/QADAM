import { Courier, Parcel, Booking, StatusUpdate, mapStatus } from './index.ts';

/**
 * Leopards Courier.
 *
 * Their API is a flat JSON POST with the key in the body rather than a header,
 * which is why the credentials appear in the payload below rather than in an
 * Authorization header. That is their design, not ours.
 *
 * ⚠️ The endpoint paths and field names here follow their published integration
 * document. Verify against the account's own documentation before first use —
 * couriers in this market change field names without versioning anything.
 */
const BASE = 'https://merchantapi.leopardscourier.com/api';

const api_key = () => Deno.env.get('LEOPARDS_API_KEY') ?? '';
const api_password = () => Deno.env.get('LEOPARDS_API_PASSWORD') ?? '';

const STATUS_TABLE: Record<string, ReturnType<typeof mapStatus>> = {
  'booked': 'booked',
  'pickup request sent': 'booked',
  'shipment picked': 'in_transit',
  'in transit': 'in_transit',
  'arrived at station': 'in_transit',
  'out for delivery': 'out_for_delivery',
  'delivered': 'delivered',
  'refused by consignee': 'refused',
  'consignee refused to accept': 'refused',
  // Everything else that comes back is a return for a reason we cannot attribute
  // to the customer, so it maps to `returned` and never burns their coins.
  'returned to shipper': 'returned',
  'return to origin': 'returned',
  'lost': 'lost',
};

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: api_key(), api_password: api_password(), ...body }),
  });
  if (!res.ok) throw new Error(`leopards ${path}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 1 && json.status !== '1') {
    throw new Error(`leopards ${path}: ${json.error ?? 'rejected'}`);
  }
  return json;
}

const courier: Courier = {
  name: 'leopards',

  async book(parcel: Parcel): Promise<Booking> {
    const json = await post('bookPacket/format/json/', {
      booked_packet_weight: parcel.weightGrams,
      booked_packet_no_piece: parcel.pieces,
      booked_packet_collect_amount: parcel.codAmountPkr,
      origin_city: Deno.env.get('COURIER_ORIGIN_CITY') ?? 'Lahore',
      destination_city: parcel.consignee.city,
      consignment_name_eng: parcel.consignee.name,
      consignment_phone: parcel.consignee.phone,
      consignment_address: parcel.consignee.address,
      special_instructions: `Order ${parcel.orderId}`,
    });

    const trackingNumber = String(json.track_number ?? json.trackNumber ?? '');
    if (!trackingNumber) throw new Error('leopards booked a packet without a tracking number');

    return {
      trackingNumber,
      trackingUrl: `https://leopardscourier.com/tracking?tracking_number=${trackingNumber}`,
      bookedChargePkr: json.charges != null ? Math.round(Number(json.charges)) : null,
    };
  },

  async track(trackingNumber: string): Promise<StatusUpdate> {
    const json = await post('trackBookedPacket/format/json/', {
      track_numbers: trackingNumber,
    });
    const packet = json.packet_list?.[0] ?? {};
    const raw = String(packet.booked_packet_status ?? '');
    return {
      trackingNumber,
      status: mapStatus(raw, STATUS_TABLE),
      rawStatus: raw,
      occurredAt: packet.activity_date ?? new Date().toISOString(),
    };
  },

  async cancel(trackingNumber: string): Promise<void> {
    await post('cancelBookedPackets/format/json/', { cn_numbers: trackingNumber });
  },
};

export default courier;
