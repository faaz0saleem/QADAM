/**
 * §9.6 — sentence case, plain verbs, active voice.
 *
 * An action keeps its name through a whole flow: `useCoins` produces
 * `coinsUsed`, never "Redeem" then "Redeemed".
 *
 * Empty states are invitations, not apologies. Errors say what happened and what
 * to do next.
 *
 * Banned words, checked by `npm run lint:copy`: points, rewards, cashback,
 * earn money. We say coins, mint, discount.
 *
 * The Urdu is a working draft and needs a native reader before launch — see
 * HUMAN_TASKS.md. Machine-register Urdu in a consumer app reads as foreign
 * immediately.
 */

export const en = {
  tabs: {
    steps: 'Steps',
    board: 'Board',
    shop: 'Shop',
    wallet: 'Wallet',
    you: 'You',
  },

  steps: {
    title: 'Today',
    todayCoins: 'Minted today',
    towardCap: '{{current}} of {{cap}} steps counted today',
    capReached: "You've hit today's ceiling. Tomorrow starts fresh.",
    streak: '{{days}}-day streak',
    streakAtRisk: 'Walk {{steps}} more today to keep your {{days}}-day streak',
    streakNone: 'Walk {{steps}} steps today to start a streak',
    lastSynced: 'Synced {{when}}',
    syncing: 'Syncing',
    syncFailed: "Steps haven't synced since {{when}}. They'll catch up.",
    offline: "You're offline. Today's steps are saved and will sync later.",
  },

  permission: {
    title: 'Turn on step access',
    // §7.1: show what they're missing and a one-tap route to settings.
    bodyAndroid:
      "Qadam reads your step count from Health Connect. Without it, your steps don't count and no coins are minted.",
    bodyIos:
      "Qadam reads your step count from Apple Health. Without it, your steps don't count and no coins are minted.",
    cta: 'Open settings',
    denied: "Health permission is off, so today's steps aren't counting.",
    deniedCta: 'Turn it on',
  },

  wallet: {
    title: 'Wallet',
    balance: 'Coins',
    empty: 'Walk 1,000 steps to mint your first coins.',
    expiring: '{{coins}} coins expiring in {{days}} days',
    expiringOne: '{{coins}} coins expiring tomorrow',
    expiringToday: '{{coins}} coins expiring today',
    history: 'History',
    reason: {
      steps: 'Steps',
      streak_bonus: 'Streak bonus',
      rewarded_ad: 'Video watched',
      referral_referrer: 'Referral',
      referral_referee: 'Welcome coins',
      challenge_prize: 'Challenge prize',
      order_refund: 'Order cancelled',
      admin_credit: 'Adjustment',
      order_hold: 'Used on an order',
      admin_debit: 'Adjustment',
    },
    expiresOn: 'Expires {{date}}',
  },

  board: {
    title: 'Board',
    scope: { city: 'City', team: 'Team', friends: 'Friends', pakistan: 'All Pakistan' },
    weekly: 'This week',
    allTime: 'All time',
    resetsIn: 'Resets in {{days}} days',
    yourRank: '{{rank}} — top {{percentile}}%',
    emptyCity: 'Nobody in {{city}} has walked yet this week. Be first.',
    emptyTeam: 'Join a team to see how your side is doing.',
    emptyFriends: 'Add a friend and see who walks more.',
    joinTeam: 'Join a team',
    createTeam: 'Create a team',
    inviteCode: 'Invite code',
  },

  shop: {
    title: 'Shop',
    // §7.4: what THIS user saves right now, not a hypothetical maximum.
    saveWithCoins: 'Save PKR {{amount}} with your coins',
    noCoinsYet: 'Walk to unlock a discount here',
    outOfStock: 'Out of stock',
    empty: 'The shop opens soon. Keep walking — your coins will be waiting.',
    addToCart: 'Add to cart',
    useCoins: 'Use coins',
    coinsUsed: 'Coins used',
  },

  checkout: {
    title: 'Checkout',
    payOnDelivery: 'Pay on delivery',
    // §7.5: unmissable. This is the whole COD strategy in one sentence.
    coinWarning:
      'You are using {{coins}} coins on this order. Refuse the delivery and those coins are gone.',
    confirm: 'Place order',
    placed: 'Order placed',
    weWillConfirm: "We'll message you on WhatsApp before it ships.",
  },

  you: {
    title: 'You',
    language: 'Language',
    english: 'English',
    urdu: 'اردو',
    howItWorks: 'How coins work',
    // §4: the earning rate is a promise. The rupee rate is never published.
    theRate: '1,000 steps = 10 coins',
    theRule: 'Coins come off the price at checkout. They never turn into cash.',
    referral: 'Invite a friend',
    referralPending: '{{name}} joined — you get {{coins}} coins when they order',
    watchVideo: 'Watch a video for {{coins}} coins',
    videoLimit: "You've watched all {{limit}} videos today",
  },

  common: {
    retry: 'Try again',
    close: 'Close',
    coins: 'coins',
    steps: 'steps',
    pkr: 'PKR',
    justNow: 'just now',
    minutesAgo: '{{n}} min ago',
    hoursAgo: '{{n}} hr ago',
    yesterday: 'yesterday',
  },
} as const;

/**
 * `en` is declared `as const` so that a typo in a key is caught at the call
 * site. That also makes every value a literal type, which no translation could
 * ever satisfy — so widen the leaves back to `string` for the shape other
 * languages are checked against. A missing or extra key in `ur` is still an
 * error; only the literal text is free.
 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Strings = Widen<typeof en>;

/** Draft. Needs a native reader before launch. */
export const ur: Strings = {
  tabs: {
    steps: 'قدم',
    board: 'درجہ بندی',
    shop: 'دکان',
    wallet: 'بٹوہ',
    you: 'آپ',
  },

  steps: {
    title: 'آج',
    todayCoins: 'آج بنے سکے',
    towardCap: 'آج {{cap}} میں سے {{current}} قدم شمار ہوئے',
    capReached: 'آج کی حد پوری ہو گئی۔ کل نئے سرے سے شروع۔',
    streak: '{{days}} دن کا سلسلہ',
    streakAtRisk: '{{days}} دن کا سلسلہ برقرار رکھنے کے لیے آج مزید {{steps}} قدم چلیں',
    streakNone: 'سلسلہ شروع کرنے کے لیے آج {{steps}} قدم چلیں',
    lastSynced: '{{when}} ہم آہنگ ہوا',
    syncing: 'ہم آہنگ ہو رہا ہے',
    syncFailed: '{{when}} سے قدم ہم آہنگ نہیں ہوئے۔ جلد ہو جائیں گے۔',
    offline: 'آپ آف لائن ہیں۔ آج کے قدم محفوظ ہیں اور بعد میں ہم آہنگ ہوں گے۔',
  },

  permission: {
    title: 'قدموں تک رسائی کھولیں',
    bodyAndroid:
      'قدم آپ کے قدموں کی تعداد Health Connect سے پڑھتا ہے۔ اس کے بغیر آپ کے قدم شمار نہیں ہوں گے اور کوئی سکہ نہیں بنے گا۔',
    bodyIos:
      'قدم آپ کے قدموں کی تعداد Apple Health سے پڑھتا ہے۔ اس کے بغیر آپ کے قدم شمار نہیں ہوں گے اور کوئی سکہ نہیں بنے گا۔',
    cta: 'ترتیبات کھولیں',
    denied: 'صحت کی اجازت بند ہے، اس لیے آج کے قدم شمار نہیں ہو رہے۔',
    deniedCta: 'اسے کھولیں',
  },

  wallet: {
    title: 'بٹوہ',
    balance: 'سکے',
    empty: 'اپنے پہلے سکے بنانے کے لیے 1,000 قدم چلیں۔',
    expiring: '{{coins}} سکے {{days}} دن میں ختم ہو رہے ہیں',
    expiringOne: '{{coins}} سکے کل ختم ہو رہے ہیں',
    expiringToday: '{{coins}} سکے آج ختم ہو رہے ہیں',
    history: 'تاریخ',
    reason: {
      steps: 'قدم',
      streak_bonus: 'سلسلے کا انعام',
      rewarded_ad: 'ویڈیو دیکھی',
      referral_referrer: 'حوالہ',
      referral_referee: 'خوش آمدید سکے',
      challenge_prize: 'مقابلے کا انعام',
      order_refund: 'آرڈر منسوخ',
      admin_credit: 'تبدیلی',
      order_hold: 'آرڈر پر استعمال',
      admin_debit: 'تبدیلی',
    },
    expiresOn: '{{date}} کو ختم',
  },

  board: {
    title: 'درجہ بندی',
    scope: { city: 'شہر', team: 'ٹیم', friends: 'دوست', pakistan: 'پورا پاکستان' },
    weekly: 'اس ہفتے',
    allTime: 'ہر وقت',
    resetsIn: '{{days}} دن میں دوبارہ شروع',
    yourRank: '{{rank}} — اوپر کے {{percentile}}%',
    emptyCity: '{{city}} میں اس ہفتے ابھی کوئی نہیں چلا۔ پہلے آپ ہوں۔',
    emptyTeam: 'اپنی ٹیم کی کارکردگی دیکھنے کے لیے کسی ٹیم میں شامل ہوں۔',
    emptyFriends: 'ایک دوست شامل کریں اور دیکھیں کون زیادہ چلتا ہے۔',
    joinTeam: 'ٹیم میں شامل ہوں',
    createTeam: 'ٹیم بنائیں',
    inviteCode: 'دعوتی کوڈ',
  },

  shop: {
    title: 'دکان',
    saveWithCoins: 'اپنے سکوں سے {{amount}} روپے بچائیں',
    noCoinsYet: 'یہاں رعایت کھولنے کے لیے چلیں',
    outOfStock: 'دستیاب نہیں',
    empty: 'دکان جلد کھلے گی۔ چلتے رہیں — آپ کے سکے منتظر رہیں گے۔',
    addToCart: 'ٹوکری میں ڈالیں',
    useCoins: 'سکے استعمال کریں',
    coinsUsed: 'سکے استعمال ہوئے',
  },

  checkout: {
    title: 'ادائیگی',
    payOnDelivery: 'ڈیلیوری پر ادائیگی',
    coinWarning:
      'آپ اس آرڈر پر {{coins}} سکے استعمال کر رہے ہیں۔ ڈیلیوری لینے سے انکار کیا تو یہ سکے ختم ہو جائیں گے۔',
    confirm: 'آرڈر دیں',
    placed: 'آرڈر دے دیا گیا',
    weWillConfirm: 'بھیجنے سے پہلے ہم آپ کو واٹس ایپ پر پیغام دیں گے۔',
  },

  you: {
    title: 'آپ',
    language: 'زبان',
    english: 'English',
    urdu: 'اردو',
    howItWorks: 'سکے کیسے کام کرتے ہیں',
    theRate: '1,000 قدم = 10 سکے',
    theRule: 'سکے ادائیگی کے وقت قیمت سے کم ہوتے ہیں۔ یہ کبھی نقدی نہیں بنتے۔',
    referral: 'دوست کو مدعو کریں',
    referralPending: '{{name}} شامل ہو گئے — ان کے آرڈر پر آپ کو {{coins}} سکے ملیں گے',
    watchVideo: '{{coins}} سکوں کے لیے ویڈیو دیکھیں',
    videoLimit: 'آپ آج کی تمام {{limit}} ویڈیوز دیکھ چکے ہیں',
  },

  common: {
    retry: 'دوبارہ کوشش کریں',
    close: 'بند کریں',
    coins: 'سکے',
    steps: 'قدم',
    pkr: 'روپے',
    justNow: 'ابھی',
    minutesAgo: '{{n}} منٹ پہلے',
    hoursAgo: '{{n}} گھنٹے پہلے',
    yesterday: 'کل',
  },
};
