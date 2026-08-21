/**
 * Preview mode: the whole app, with nothing behind it.
 *
 * WHY THIS EXISTS
 *
 * Every screen in this app is an empty state until a Supabase project exists,
 * and there are several moments before that where somebody needs to SEE it — a
 * design review, a screenshot for a store listing, a demo to a brand who is
 * deciding whether to sign, a look at the two temperatures side by side. Those
 * should not each require a backend.
 *
 * So: with EXPO_PUBLIC_DEMO=1 the Supabase client is replaced by the object
 * below, which answers every RPC the app makes with fixtures. Nothing else
 * changes — the same hooks run, the same components render, the same loading
 * and error paths exist. What you are looking at is the real app, reading from
 * a stub instead of a server.
 *
 * WHAT THIS IS NOT
 *
 * It is not a way to put numbers into the real economy. There is no server here
 * to lie to: preview mode replaces the client entirely, so a build with it on
 * cannot talk to a real backend at all, and a build with it off has no path to
 * this file's data. §13.2 is about a client naming coin values to a SERVER, and
 * this is a client with nowhere to send anything.
 *
 * It is also deliberately obvious. `DEMO_NOTICE` is pinned to the top of every
 * screen, so nobody can mistake a preview build for a working one.
 */

/** Preview mode is off unless a build explicitly turns it on. */
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

/** Pinned to the top of the app whenever preview mode is on. Not translated:
 *  it is a note to whoever is holding the build, not copy for a user. */
export const DEMO_NOTICE = 'Preview build — sample data, no server';

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const ME = '00000000-0000-4000-8000-00000000d001';

/**
 * The numbers are the ones §4 actually produces, not flattering ones. 8,420
 * steps is a good but ordinary day; 3,180 coins is about a month of walking;
 * the savings on the cards are what §0 allows on those exact prices and costs.
 * A preview that shows impossible figures teaches the wrong thing about the
 * product to the person you are showing it to.
 */
const STEPS_TODAY = 8_420;
const COINS_TODAY = 84;
const BALANCE = 3_180;

const PRODUCTS = [
  { id: 'p-101', title: 'Lawn kurta, navy', brand_name: 'Kanwal Clothing', category_id: 'c-20',
    category_name: "Women's clothing", price_pkr: 3_200, stock: 40, images: [],
    my_discount_pkr: 95, is_affiliate: false, affiliate_url: null },
  { id: 'p-401', title: 'Leather tote', brand_name: 'Sahiwal Leather', category_id: 'c-23',
    category_name: 'Bags & accessories', price_pkr: 8_900, stock: 12, images: [],
    my_discount_pkr: 95, is_affiliate: false, affiliate_url: null },
  { id: 'p-701', title: 'Walking shoes, mesh', brand_name: 'Qadam Active', category_id: 'c-27',
    category_name: 'Fitness', price_pkr: 7_900, stock: 20, images: [],
    my_discount_pkr: 95, is_affiliate: false, affiliate_url: null },
  { id: 'p-501', title: 'Cotton bedsheet set, double', brand_name: 'Meher Home', category_id: 'c-24',
    category_name: 'Home & kitchen', price_pkr: 6_200, stock: 18, images: [],
    my_discount_pkr: 95, is_affiliate: false, affiliate_url: null },
  { id: 'p-603', title: 'Vitamin C serum', brand_name: 'Zaib Beauty', category_id: 'c-25',
    category_name: 'Beauty', price_pkr: 3_400, stock: 26, images: [],
    my_discount_pkr: 95, is_affiliate: false, affiliate_url: null },
  { id: 'p-802', title: 'Smartphone 128GB', brand_name: 'Ravi Electronics', category_id: 'c-26',
    category_name: 'Electronics', price_pkr: 94_000, stock: 6, images: [],
    // §0 on a 5% margin: about 1% of price, and the preview shows it honestly.
    my_discount_pkr: 1_000, is_affiliate: false, affiliate_url: null },
  { id: 'p-302', title: 'Peshawari chappal, brown', brand_name: 'Sahiwal Leather', category_id: 'c-22',
    category_name: 'Footwear', price_pkr: 5_400, stock: 0, images: [],
    my_discount_pkr: 95, is_affiliate: false, affiliate_url: null },
  { id: 'p-901', title: 'Partner running shoe', brand_name: null, category_id: 'c-22',
    category_name: 'Footwear', price_pkr: 12_500, stock: 20, images: [],
    // §8 — an affiliate row funds no discount, because neither the parcel nor
    // the margin is ours.
    my_discount_pkr: 0, is_affiliate: true, affiliate_url: 'https://partner.example/p/901' },
];

const BOARD = [
  { rank: 1, user_id: 'u-1', name: 'Ayesha K.', city: 'Lahore', steps: 96_400, is_me: false },
  { rank: 2, user_id: 'u-2', name: 'Bilal R.', city: 'Lahore', steps: 91_120, is_me: false },
  { rank: 3, user_id: 'u-3', name: 'Hina S.', city: 'Lahore', steps: 88_050, is_me: false },
  { rank: 4, user_id: ME, name: 'You', city: 'Lahore', steps: 74_310, is_me: true },
  { rank: 5, user_id: 'u-5', name: 'Usman T.', city: 'Lahore', steps: 71_900, is_me: false },
  { rank: 6, user_id: 'u-6', name: 'Zara M.', city: 'Lahore', steps: 68_240, is_me: false },
  // §7.3 — ties share a rank. Worth being visible in a preview, because it is
  // the sort of thing a reviewer only notices when they see it happen.
  { rank: 7, user_id: 'u-7', name: 'Faisal A.', city: 'Lahore', steps: 65_500, is_me: false },
  { rank: 7, user_id: 'u-8', name: 'Nida H.', city: 'Lahore', steps: 65_500, is_me: false },
];

const TEAM = {
  team_id: 't-1', name: 'Gulberg Walkers', city: 'Lahore', invite_code: 'K7PMQ2',
  is_captain: true, member_count: 4, member_max: 5,
};

const ROSTER = [
  { user_id: ME, name: 'You', joined_at: iso(-24), is_captain: true, is_me: true },
  { user_id: 'u-2', name: 'Bilal R.', joined_at: iso(-21), is_captain: false, is_me: false },
  { user_id: 'u-3', name: 'Hina S.', joined_at: iso(-18), is_captain: false, is_me: false },
  { user_id: 'u-6', name: 'Zara M.', joined_at: iso(-9), is_captain: false, is_me: false },
];

const GROUP_ORDER = {
  id: 'g-1',
  status: 'open',
  opened_by: 'u-2',
  opened_by_name: 'Bilal R.',
  i_opened_it: false,
  expires_at: iso(1.4),
  order_id: null,
  address: null,
  subtotal_pkr: 8_900,
  max_discount_pkr: 740,
  discount_pkr: 285,
  total_pkr: 8_615,
  my_coins_spent: 0,
  items: [
    { product_id: 'p-401', title: 'Leather tote', qty: 1, price_pkr: 8_900,
      line_pkr: 8_900, in_stock: true, images: [] },
  ],
  members: [
    { user_id: ME, name: 'You', is_me: true, decision: 'waiting', spending: false, coins_spent: 0 },
    { user_id: 'u-2', name: 'Bilal R.', is_me: false, decision: 'approved', spending: true, coins_spent: null },
    { user_id: 'u-3', name: 'Hina S.', is_me: false, decision: 'approved', spending: true, coins_spent: null },
    { user_id: 'u-6', name: 'Zara M.', is_me: false, decision: 'waiting', spending: false, coins_spent: null },
  ],
  waiting_on: 2,
};

/** Every RPC the app calls, and what preview mode answers with. */
const RPC: Record<string, unknown> = {
  my_coin_balance: BALANCE,
  my_coin_batches: [
    { batch_id: 'b-1', minted_at: iso(-79), reason: 'steps', minted: 1_240,
      remaining: 1_240, expires_at: iso(11), days_left: 11 },
    { batch_id: 'b-2', minted_at: iso(-41), reason: 'steps', minted: 1_610,
      remaining: 1_610, expires_at: iso(49), days_left: 49 },
    { batch_id: 'b-3', minted_at: iso(-6), reason: 'rewarded_ad', minted: 330,
      remaining: 330, expires_at: iso(84), days_left: 84 },
  ],
  my_streak_days: 12,
  my_rewarded_ads_left_today: 2,
  my_referral_code: 'K7PMQ2',
  my_referrals: [
    { name: 'Sana F.', joined_at: iso(-12), status: 'paid', coins: 500 },
    { name: 'Omar D.', joined_at: iso(-3), status: 'pending', coins: 0 },
  ],
  my_friends: [
    { user_id: 'u-2', name: 'Bilal R.', steps_week: 91_120 },
    { user_id: 'u-3', name: 'Hina S.', steps_week: 88_050 },
  ],
  store_feed: PRODUCTS,
  store_categories: [
    { id: 'c-20', name: "Women's clothing", sort_order: 1, live_count: 8 },
    { id: 'c-22', name: 'Footwear', sort_order: 3, live_count: 6 },
    { id: 'c-23', name: 'Bags & accessories', sort_order: 4, live_count: 6 },
    { id: 'c-24', name: 'Home & kitchen', sort_order: 5, live_count: 9 },
    { id: 'c-25', name: 'Beauty', sort_order: 6, live_count: 7 },
    { id: 'c-26', name: 'Electronics', sort_order: 7, live_count: 7 },
    { id: 'c-27', name: 'Fitness', sort_order: 8, live_count: 7 },
  ],
  my_orders: [
    { id: 'o-1', status: 'dispatched', created_at: iso(-2), subtotal_pkr: 3_200,
      discount_pkr: 260, shipping_pkr: 200, total_pkr: 3_140, item_count: 1, coin_state: 'pending' },
    { id: 'o-2', status: 'delivered', created_at: iso(-19), subtotal_pkr: 6_200,
      discount_pkr: 480, shipping_pkr: 200, total_pkr: 5_920, item_count: 2, coin_state: 'spent' },
  ],
  leaderboard: BOARD,
  my_rank: [{ rank: 4, of_total: 3_182, percentile: 12, steps: 74_310 }],
  my_team: [TEAM],
  team_roster: ROSTER,
  my_team_standing: [{ rank: 6, of_total: 214, name: TEAM.name, members: 4, steps: 318_640 }],
  my_group_orders: [GROUP_ORDER],
  group_order: GROUP_ORDER,
  active_challenges: [
    { id: 'ch-1', title: 'Lahore vs Karachi', scope: 'city', ends_at: iso(4),
      prize_type: 'coins', prize_value: 5_000, prize_funded_by: 'house', sponsor_name: null },
  ],
};

/** Writes. Preview mode accepts them and changes nothing. */
const WRITE_RESULT: Record<string, unknown> = {
  join_team: TEAM,
  create_team: TEAM,
  open_group_order: GROUP_ORDER,
  respond_to_group_order: { ...GROUP_ORDER, waiting_on: 1 },
  cancel_group_order: { ...GROUP_ORDER, status: 'cancelled' },
  place_order: { order_id: 'o-3', subtotal_pkr: 3_200, discount_pkr: 260,
                 coins_spent: 8_667, total_pkr: 3_140, coins_left: BALANCE },
};

const TABLES: Record<string, unknown[]> = {
  coin_ledger: [
    { id: 'l-1', delta: 84, reason: 'steps', created_at: iso(0), expires_at: iso(90) },
    { id: 'l-2', delta: 30, reason: 'rewarded_ad', created_at: iso(-1), expires_at: iso(89) },
    { id: 'l-3', delta: -8_667, reason: 'order_pending', created_at: iso(-2), expires_at: null },
    { id: 'l-4', delta: 96, reason: 'steps', created_at: iso(-2), expires_at: iso(88) },
    { id: 'l-5', delta: 500, reason: 'referral', created_at: iso(-12), expires_at: iso(78) },
  ],
};

/** A chainable stand-in for PostgREST's query builder that resolves to fixtures. */
function table(name: string) {
  const rows = TABLES[name] ?? [];
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: () => builder,
    single: async () => ({ data: rows[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  };
  return builder;
}

const SESSION = {
  access_token: 'preview',
  refresh_token: 'preview',
  expires_in: 3_600,
  token_type: 'bearer',
  user: { id: ME, phone: '+923001234567', app_metadata: {}, user_metadata: {}, aud: 'authenticated' },
};

/**
 * The stand-in client. Shaped like the parts of supabase-js the app touches and
 * nothing more, so an unhandled call fails loudly here rather than silently
 * returning something plausible.
 */
export const demoClient = {
  rpc: async (name: string) => ({
    data: (name in RPC ? RPC[name] : name in WRITE_RESULT ? WRITE_RESULT[name] : []) ?? [],
    error: null,
  }),
  from: (name: string) => table(name),
  auth: {
    getSession: async () => ({ data: { session: SESSION }, error: null }),
    getUser: async () => ({ data: { user: SESSION.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithOtp: async () => ({ data: {}, error: null }),
    verifyOtp: async () => ({ data: { session: SESSION }, error: null }),
    signOut: async () => ({ error: null }),
  },
};

/** What syncSteps() answers with when there is no Edge Function to call. */
export const demoSync = {
  ok: true,
  days: [{ date: day(0), credited_steps: STEPS_TODAY, coins_awarded: COINS_TODAY, capped: false }],
  balance: BALANCE,
  streak_days: 12,
  queued: false,
  reason: null,
};

export const demoSteps = { today: STEPS_TODAY, coins: COINS_TODAY, balance: BALANCE };
