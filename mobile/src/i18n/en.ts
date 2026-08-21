/**
 * README §9.6 — copy rules.
 *
 * Sentence case, plain verbs, active voice. An action keeps its name through the
 * whole flow. Empty states are invitations, not apologies. Errors say what
 * happened and what to do.
 *
 * Never the words points, rewards, cashback, or earn money. We say coins, mint,
 * discount. scripts/check-copy.sh fails the build on any of the four.
 */
export const en = {
  tabs: {
    steps: 'Steps',
    board: 'Board',
    shop: 'Shop',
    wallet: 'Wallet',
    you: 'You',
  },

  auth: {
    welcomeTitle: 'Walk. Mint coins. Spend them.',
    welcomeBody: 'Qadam turns the walking you already do into a discount on things you were going to buy anyway.',
    phoneLabel: 'Your phone number',
    phoneHint: 'We send a code to confirm it is you.',
    continueCta: 'Continue',
    otpTitle: 'Enter the code',
    otpSentTo: 'Sent to {{phone}}',
    otpResend: 'Send it again',
    otpResendIn: 'Send it again in {{seconds}}s',
    verifyCta: 'Verify',
    changeNumber: 'Use a different number',
    referralTitle: 'Were you invited?',
    referralBody: 'Enter your friend\u2019s code. You both get 500 coins when your first order arrives.',
    referralPlaceholder: 'Code',
    referralApply: 'Apply code',
    referralSkip: 'I was not invited',
    referralApplied: 'Code applied.',
    errorPhone: 'That does not look like a Pakistani mobile number. It should start 03 or +923.',
    errorOtp: 'That code did not match. Check it and try again.',
    errorSend: 'We could not send the code. Check your signal and try again.',
    errorReferral: 'That code does not exist. Check it, or skip for now.',
  },

  steps: {
    title: 'Today',
    stepsLabel: 'steps today',
    walking: 'counting now',
    towardCap: '{{current}} of {{cap}} counted today',
    notCountedYet: '{{steps}} still to be counted — they go up on the next sync',
    capReached: "Today's steps are all counted",
    coinsToday: 'minted today',
    streak: '{{days}}-day streak',
    streakNone: 'No streak yet',
    streakAtRisk: 'Walk {{steps}} more to keep your streak',
    lastSynced: 'Synced {{when}}',
    syncing: 'Syncing',
    syncQueued: 'Saved. It will sync when you are back online.',
  },

  permission: {
    title: 'Qadam needs your step count',
    bodyAndroid:
      'Qadam reads steps from Health Connect. Without it there is nothing to mint coins from.',
    bodyIos: 'Qadam reads steps from Apple Health. Without it there is nothing to mint coins from.',
    cta: 'Turn on step access',
    settings: 'Open settings',
    noLocation: 'Qadam never asks for your location.',
  },

  earn: {
    title: 'Watch a video',
    body: 'Watch a short video and get {{coins}} coins.',
    left: '{{count}} left today',
    none: 'That is all for today. More tomorrow.',
    watch: 'Watch',
    watching: 'Loading',
    unavailable: 'No video available right now. Try again shortly.',
    dismissed: 'You need to watch it through to get the coins.',
    earned: 'Coins are on their way.',
  },

  wallet: {
    title: 'Wallet',
    balance: 'coins',
    empty: 'Walk 1,000 steps to mint your first coins.',
    expiringSoon: '{{coins}} coins expire in {{days}} days',
    expiringToday: '{{coins}} coins expire today',
    batchMinted: 'Minted {{when}}',
    expiresOn: 'Expires {{date}}',
    batchAnnouncement: '{{coins}} coins, expiring in {{days}} days',
    history: 'History',
    reasonSteps: 'Walking',
    reasonRewardedAd: 'Video',
    reasonReferralReferrer: 'Referral',
    reasonReferralReferee: 'Welcome bonus',
    reasonChallengePrize: 'Challenge prize',
    reasonOrderPending: 'Used on an order',
    reasonAdjustment: 'Adjustment',
    lockedUntil: 'Coins unlock {{date}}',
    lockedWhy: 'New accounts can start spending coins after seven days.',
  },

  board: {
    title: 'Board',
    scopeCity: 'City',
    scopeTeam: 'Team',
    scopeFriends: 'Friends',
    scopeNational: 'All Pakistan',
    weekly: 'This week',
    allTime: 'All time',
    resetsMonday: 'Resets Monday',
    youRank: '{{rank}} — top {{percentile}}%',
    youUnranked: 'Walk today to join this week',
    emptyTeam: 'Start a team and this fills up.',
    emptyFriends: 'Add a friend and you can race them.',
    rankAnnouncement: 'Rank {{rank}}, {{name}}, {{steps}} steps',
    noTeamCta: 'Start a team',
    joinTeamCta: 'Join with a code',
  },

  challenge: {
    title: 'Challenge',
    endsIn: 'Ends in {{days}} days',
    endsToday: 'Ends today',
    prizeVoucher: 'PKR {{value}} voucher',
    sponsoredBy: 'Sponsored by {{name}}',
    noEntry: 'Nothing to enter and nothing at stake.',
    otherScope: 'Not yours this week',
  },

  you: {
    title: 'You',
    language: 'Language',
    english: 'English',
    urdu: 'اردو',
    restartForRtl: 'Qadam will restart to switch direction.',
    team: 'Team',
    noTeam: 'You are not in a team yet.',
    inviteCode: 'Invite code',
    referral: 'Invite a friend',
    referralCode: 'Your code',
    referralExplainer:
      'You both get 500 coins when they place their first order and it arrives.',
    referralPending: '{{name}} joined — you get 500 coins on their first order',
    referralPaid: '{{name}} — 500 coins minted',
    city: 'City',
    deleteAccount: 'Delete account',
    deleteTitle: 'Delete your account?',
    deleteBody: 'Everything goes: your steps, your streak, your team, and your coins. Coins cannot be moved anywhere else, so they are destroyed. This cannot be undone.',
    deleteConfirm: 'Delete everything',
    deleteCancel: 'Keep my account',
    deleteFailed: 'We could not delete your account just now. Try again in a moment.',
    signOut: 'Sign out',
  },

  shop: {
    title: 'Shop',
    empty: 'The shop opens as brands come on board. Keep walking — your coins are waiting.',
    saveWithCoins: 'Save PKR {{amount}} with your coins',
    /** The same thing on a card, where two fit across a 320px screen and
     *  the full sentence truncates mid-word. §7.4 — this line is the point
     *  of the card, so it has to survive the column width. */
    saveShort: 'Save PKR {{amount}}',
    noDiscountYet: 'Walk more to unlock a discount here',
    outOfStock: 'Out of stock',
    lastFew: 'Only {{count}} left',
    addToCart: 'Add to basket',
    added: 'Added',
    viewCart: 'Basket',
    cartTitle: 'Basket',
    cartEmpty: 'Nothing in your basket yet.',
    allCategories: 'Everything',
    sortNew: 'Newest',
    sortPriceLow: 'Price ↑',
    sortPriceHigh: 'Price ↓',
    sortSaving: 'Best saving',
    loadMore: 'Show more',
    viewAtPartner: 'View at partner',
    partnerNote: 'Sold by a partner. Coins are not spent here.',
    subtotal: 'Subtotal',
    coinDiscount: 'Coin discount',
    delivery: 'Delivery',
    toPay: 'To pay',
    checkout: 'Place order',
    remove: 'Remove',
    address: 'Delivery address',
    phone: 'Phone number',
    useCoins: 'Use my coins',
    burnWarning: 'Refuse the delivery and these coins are gone. They are not returned.',
    cashOnDelivery: 'Cash on delivery',
    placed: 'Order placed',
    placedBody: 'We will send a WhatsApp message to confirm before it ships.',
    ordersTitle: 'Orders',
    ordersEmpty: 'No orders yet.',
    orderItems: '{{count}} items',
    coinsPending: 'Coins held',
    coinsSpent: 'Coins spent',
    coinsBurned: 'Coins lost — the delivery was refused',
    coinsReturned: 'Coins returned',
    cancelOrder: 'Cancel order',
    statusPendingConfirmation: 'Awaiting confirmation',
    statusConfirmed: 'Confirmed',
    statusDispatched: 'On its way',
    statusDelivered: 'Delivered',
    statusRefused: 'Refused',
    statusCancelled: 'Cancelled',
    statusReturned: 'Returned',
    errorPlace: 'We could not place that order. Your basket is unchanged.',
  },

  /**
   * A basket a team buys together (§7.6, and the co-payment shape README §13.3
   * requires — see the group_orders migration).
   *
   * §9.6: never "pool", never "share your coins". Nobody's coins move. The word
   * that is true is "together": everyone approves, and everyone who has coins
   * puts their own in.
   */
  group: {
    title: 'Team basket',
    start: 'Buy this with your team',
    startHint: 'Everyone on your team has to agree before it is ordered',
    open: 'Waiting for your team',
    waitingOn: 'Waiting on {{count}}',
    waitingOnOne: 'Waiting on 1 person',
    everyoneAgreed: 'Everyone agreed. It is ordered.',
    approve: 'Agree',
    approveWithoutCoins: 'Agree, but keep my coins',
    decline: 'Say no',
    cancel: 'Call it off',
    declined: '{{name}} said no, so nothing was ordered',
    cancelled: 'Called off',
    expired: 'This basket expired',
    placed: 'Ordered',
    youOpened: 'You started this',
    openedBy: '{{name}} started this',
    deliverTo: 'Going to {{name}}',
    saving: 'Save {{amount}} with your team',
    savingCapped: 'Up to {{amount}} off this basket',
    committed: '{{amount}} covered so far',
    myCoins: 'You put in',
    statusWaiting: 'not decided yet',
    statusApproved: 'agreed',
    statusApprovedNoCoins: 'agreed, no coins',
    statusDeclined: 'said no',
    expires: 'Expires {{when}}',
    noTeam: 'Join a team first — a basket needs someone to agree to it.',
    alreadyOpen: 'Your team already has a basket waiting.',
    empty: 'No team baskets yet. Put something in your basket and ask your team.',
    coinsExplainer:
      'Everyone who agrees spends their own coins on this. Coins never move between people.',
  },
  team: {
    title: 'Team',
    createTitle: 'Start a team',
    createBody: 'Office against office, university against university. Free to join, five to thirty people.',
    namePlaceholder: 'Team name',
    createCta: 'Create team',
    joinTitle: 'Join a team',
    joinBody: 'Enter the code your captain sent you.',
    codePlaceholder: 'Code',
    joinCta: 'Join team',
    standing: 'This week',
    standingRank: '{{rank}} of {{total}} teams',
    shareCard: 'Share our rank',
    cardTagline: 'Walking together on Qadam',
    cardSteps: '{{steps}} steps this week',
    roster: 'Members',
    captain: 'Captain',
    youLabel: 'You',
    memberCount: '{{count}} of {{max}}',
    share: 'Share invite',
    shareMessage: 'Join my team on Qadam. Code: {{code}}\nqadam://join/{{code}}',
    leave: 'Leave team',
    handOver: 'Make captain',
    errorName: 'Give the team a name first.',
    errorCode: 'No team has that code. Check it with your captain.',
    errorFull: 'That team is full.',
    errorLeaveCaptain: 'Hand the team to someone else before you leave it.',
  },

  friends: {
    title: 'Friends',
    empty: 'Add a friend and you can race them this week.',
    addTitle: 'Add a friend',
    addBody: 'Enter their code. It is the same code they use to invite people.',
    codePlaceholder: 'Code',
    addCta: 'Add friend',
    yourCode: 'Your code',
    shareCode: 'Share your code',
    shareMessage: 'Add me on Qadam. My code is {{code}}.',
    remove: 'Remove',
    errorCode: 'Nobody has that code. Check it and try again.',
  },

  /**
   * The screen a build that has no backend shows instead of a sign-in form it
   * cannot submit. §9.6 — errors say what happened and what to do.
   */
  setup: {
    title: 'Almost there',
    body: 'This build is not pointed at a server yet, so there is nothing to sign in to.',
    what: 'It needs a Supabase project URL and anon key at build time.',
    how: 'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then build again. HUMAN_TASKS.md has the steps.',
    note: 'Everything else in the app is finished and waiting on this one thing.',
  },
  errors: {
    healthOff: "Health permission is off, so today's steps aren't counting.",
    healthOffCta: 'Turn it on',
    offline: 'You are offline. Steps are saved and will sync.',
    retry: 'Try again',
    serverUnreachable: 'We could not reach Qadam just now. Your steps are saved and will count.',
    generic: 'Something went wrong. Pull down to try again.',
  },
} as const;

/**
 * `as const` above makes every string a literal type, which is what stops a typo
 * in a key going unnoticed. Widening the VALUES back to `string` is what lets a
 * translation be a different string while still having to have every key.
 */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Copy = Widen<typeof en>;
