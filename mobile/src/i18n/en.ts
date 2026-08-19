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
    towardCap: '{{current}} of {{cap}} counted today',
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

  wallet: {
    title: 'Wallet',
    balance: 'coins',
    empty: 'Walk 1,000 steps to mint your first coins.',
    expiringSoon: '{{coins}} coins expire in {{days}} days',
    expiringToday: '{{coins}} coins expire today',
    batchMinted: 'Minted {{when}}',
    expiresOn: 'Expires {{date}}',
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
    noTeamCta: 'Start a team',
    joinTeamCta: 'Join with a code',
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
    signOut: 'Sign out',
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

  errors: {
    healthOff: "Health permission is off, so today's steps aren't counting.",
    healthOffCta: 'Turn it on',
    offline: 'You are offline. Steps are saved and will sync.',
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
