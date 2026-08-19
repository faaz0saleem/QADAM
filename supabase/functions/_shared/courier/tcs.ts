import { Courier, Parcel, Booking, StatusUpdate, mapStatus } from './index.ts';

/**
 * TCS.
 *
 * Header-authenticated, unlike Leopards. Same interface out.
 *
 * ⚠️ Verify endpoints and field names against the account's own documentation
 * before first use.
 */
const BASE = Deno.env.get('TCS_BASE_URL') ?? 'https://apis.tcscourier.com/production/v1';

const headers = () => ({
  'content-type': 'application/json',
  'X-IBM-Client-Id': Deno.env.get('TCS_CLIENT_ID') ?? '',
});

const STATUS_TABLE: Record<string, ReturnType<typeof mapStatus>> = {
  'shipment booked': 'booked',
  'in transit': 'in_transit',
  'arrived at destination': 'in_transit',
  'out for delivery': 'out_for_delivery',
  'delivered': 'delivered',
  'refused': 'refused',
  'consignee refused': 'refused',
  'returned to shipper': 'returned',
  'rto': 'returned',
};

const courier: Courier = {
  name: 'tcs',

  async book(parcel: Parcel): Promise<Booking> {
    const res = await fetch(`${BASE}/cod/create-order`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        userName: Deno.env.get('TCS_USERNAME'),
        password: Deno.env.get('TCS_PASSWORD'),
        costCenterCode: Deno.env.get('TCS_COST_CENTER'),
        consigneeName: parcel.consignee.name,
        consigneeAddress: parcel.consignee.address,
        consigneeMobNo: parcel.consignee.phone,
        destinationCityName: parcel.consignee.city,
        weight: parcel.weightGrams,
        pieces: parcel.pieces,
        codAmount: parcel.codAmountPkr,
        customerReferenceNo: parcel.orderId,
        services: 'overnight',
        productDetails: 'General goods',
      }),
    });
    if (!res.ok) throw new Error(`tcs create-order: HTTP ${res.status}`);
    const json = await res.json();

    const trackingNumber = String(json.consignmentNo ?? json.bookingReply?.consignmentNo ?? '');
    if (!trackingNumber) throw new Error('tcs booked a shipment without a consignment number');

    return {
      trackingNumber,
      trackingUrl: `https://www.tcsexpress.com/track/${trackingNumber}`,
      bookedChargePkr: null,
    };
  },

  async track(trackingNumber: string): Promise<StatusUpdate> {
    const res = await fetch(`${BASE}/track/cnno?consignmentNumber=${trackingNumber}`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error(`tcs track: HTTP ${res.status}`);
    const json = await res.json();
    const raw = String(json.trackDetail?.[0]?.status ?? json.status ?? '');
    return {
      trackingNumber,
      status: mapStatus(raw, STATUS_TABLE),
      rawStatus: raw,
      occurredAt: json.trackDetail?.[0]?.dateTime ?? new Date().toISOString(),
    };
  },

  async cancel(trackingNumber: string): Promise<void> {
    const res = await fetch(`${BASE}/cod/cancel-order`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ consignmentNo: trackingNumber }),
    });
    if (!res.ok) throw new Error(`tcs cancel: HTTP ${res.status}`);
  },
};

export default courier;
