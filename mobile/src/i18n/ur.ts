import type { Copy } from './en';

/**
 * Urdu, shipped from day one — §9.3: an English-only launch cuts the addressable
 * market in half.
 *
 * Typed against the English copy, so a missing or renamed key is a compile error
 * rather than an English string appearing mid-sentence in an Urdu screen.
 *
 * HUMAN_TASKS.md carries a P2 for a native speaker to review every line of this.
 * Machine-shaped Urdu in a financial context reads as untrustworthy.
 */
export const ur: Copy = {
  tabs: {
    steps: 'قدم',
    board: 'درجہ بندی',
    wallet: 'بٹوہ',
    you: 'آپ',
  },

  auth: {
    welcomeTitle: 'چلیں۔ سکے بنائیں۔ خرچ کریں۔',
    welcomeBody: 'قدم آپ کے روزمرہ چلنے کو ان چیزوں پر رعایت میں بدل دیتا ہے جو آپ نے ویسے بھی خریدنی تھیں۔',
    phoneLabel: 'آپ کا فون نمبر',
    phoneHint: 'تصدیق کے لیے ہم ایک کوڈ بھیجیں گے۔',
    continueCta: 'آگے بڑھیں',
    otpTitle: 'کوڈ درج کریں',
    otpSentTo: '{{phone}} پر بھیجا گیا',
    otpResend: 'دوبارہ بھیجیں',
    otpResendIn: '{{seconds}} سیکنڈ میں دوبارہ بھیجیں',
    verifyCta: 'تصدیق کریں',
    changeNumber: 'دوسرا نمبر استعمال کریں',
    referralTitle: 'کیا آپ کو کسی نے بلایا؟',
    referralBody: 'اپنے دوست کا کوڈ درج کریں۔ آپ کا پہلا آرڈر پہنچنے پر آپ دونوں کو 500 سکے ملیں گے۔',
    referralPlaceholder: 'کوڈ',
    referralApply: 'کوڈ لگائیں',
    referralSkip: 'مجھے کسی نے نہیں بلایا',
    referralApplied: 'کوڈ لگ گیا۔',
    errorPhone: 'یہ پاکستانی موبائل نمبر نہیں لگتا۔ یہ 03 یا ‎+923 سے شروع ہونا چاہیے۔',
    errorOtp: 'کوڈ درست نہیں تھا۔ دیکھ کر دوبارہ کوشش کریں۔',
    errorSend: 'کوڈ نہیں بھیجا جا سکا۔ سگنل دیکھ کر دوبارہ کوشش کریں۔',
    errorReferral: 'یہ کوڈ موجود نہیں۔ دیکھ لیں، یا ابھی چھوڑ دیں۔',
  },

  steps: {
    title: 'آج',
    stepsLabel: 'قدم آج',
    towardCap: 'آج {{cap}} میں سے {{current}} شمار ہوئے',
    capReached: 'آج کے تمام قدم شمار ہو چکے ہیں',
    coinsToday: 'آج بنے',
    streak: '{{days}} دن کا سلسلہ',
    streakNone: 'ابھی کوئی سلسلہ نہیں',
    streakAtRisk: 'سلسلہ برقرار رکھنے کے لیے {{steps}} قدم اور چلیں',
    lastSynced: '{{when}} مطابقت ہوئی',
    syncing: 'مطابقت جاری ہے',
    syncQueued: 'محفوظ ہو گیا۔ آن لائن آتے ہی بھیج دیا جائے گا۔',
  },

  permission: {
    title: 'قدم کو آپ کے قدموں کی تعداد چاہیے',
    bodyAndroid:
      'قدم آپ کے قدم Health Connect سے پڑھتا ہے۔ اس کے بغیر سکے بنانے کے لیے کچھ نہیں ہوتا۔',
    bodyIos: 'قدم آپ کے قدم Apple Health سے پڑھتا ہے۔ اس کے بغیر سکے بنانے کے لیے کچھ نہیں ہوتا۔',
    cta: 'قدموں تک رسائی دیں',
    settings: 'ترتیبات کھولیں',
    noLocation: 'قدم کبھی آپ کے مقام کی اجازت نہیں مانگتا۔',
  },

  wallet: {
    title: 'بٹوہ',
    balance: 'سکے',
    empty: 'اپنے پہلے سکے بنانے کے لیے 1,000 قدم چلیں۔',
    expiringSoon: '{{coins}} سکے {{days}} دن میں ختم ہو جائیں گے',
    expiringToday: '{{coins}} سکے آج ختم ہو رہے ہیں',
    batchMinted: '{{when}} بنے',
    expiresOn: '{{date}} کو ختم',
    batchAnnouncement: '{{coins}} سکے، {{days}} دن میں ختم',
    history: 'تاریخ',
    reasonSteps: 'چلنا',
    reasonRewardedAd: 'ویڈیو',
    reasonReferralReferrer: 'حوالہ',
    reasonReferralReferee: 'خوش آمدید سکے',
    reasonChallengePrize: 'مقابلے کا انعام',
    reasonOrderPending: 'آرڈر پر استعمال ہوئے',
    reasonAdjustment: 'ترمیم',
    lockedUntil: 'سکے {{date}} کو کھلیں گے',
    lockedWhy: 'نئے اکاؤنٹ سات دن بعد سکے خرچ کر سکتے ہیں۔',
  },

  board: {
    title: 'درجہ بندی',
    scopeCity: 'شہر',
    scopeTeam: 'ٹیم',
    scopeFriends: 'دوست',
    scopeNational: 'پورا پاکستان',
    weekly: 'اس ہفتے',
    allTime: 'ہمیشہ سے',
    resetsMonday: 'پیر کو دوبارہ شروع',
    youRank: '{{rank}} — اوپر کے {{percentile}}%',
    youUnranked: 'اس ہفتے شامل ہونے کے لیے آج چلیں',
    emptyTeam: 'ٹیم بنائیں اور یہ بھر جائے گی۔',
    emptyFriends: 'دوست شامل کریں اور مقابلہ کریں۔',
    rankAnnouncement: 'درجہ {{rank}}، {{name}}، {{steps}} قدم',
    noTeamCta: 'ٹیم بنائیں',
    joinTeamCta: 'کوڈ سے شامل ہوں',
  },

  challenge: {
    title: 'مقابلہ',
    endsIn: '{{days}} دن میں ختم',
    endsToday: 'آج ختم',
    prizeVoucher: '{{value}} روپے کا واؤچر',
    sponsoredBy: '{{name}} کی جانب سے',
    noEntry: 'نہ کچھ داخل کرنا ہے، نہ کچھ داؤ پر ہے۔',
    otherScope: 'اس ہفتے آپ کے لیے نہیں',
  },

  you: {
    title: 'آپ',
    language: 'زبان',
    english: 'English',
    urdu: 'اردو',
    restartForRtl: 'سمت بدلنے کے لیے قدم دوبارہ کھلے گا۔',
    team: 'ٹیم',
    noTeam: 'آپ ابھی کسی ٹیم میں نہیں ہیں۔',
    inviteCode: 'دعوتی کوڈ',
    referral: 'دوست کو بلائیں',
    referralCode: 'آپ کا کوڈ',
    referralExplainer:
      'جب وہ اپنا پہلا آرڈر دیں اور وہ پہنچ جائے تو آپ دونوں کو 500 سکے ملیں گے۔',
    referralPending: '{{name}} شامل ہو گئے — ان کے پہلے آرڈر پر آپ کو 500 سکے ملیں گے',
    referralPaid: '{{name}} — 500 سکے بن گئے',
    city: 'شہر',
    signOut: 'سائن آؤٹ',
  },

  team: {
    title: 'ٹیم',
    createTitle: 'ٹیم بنائیں',
    createBody: 'دفتر بمقابلہ دفتر، یونیورسٹی بمقابلہ یونیورسٹی۔ شامل ہونا مفت ہے، پانچ سے تیس افراد۔',
    namePlaceholder: 'ٹیم کا نام',
    createCta: 'ٹیم بنائیں',
    joinTitle: 'ٹیم میں شامل ہوں',
    joinBody: 'وہ کوڈ درج کریں جو آپ کے کپتان نے بھیجا ہے۔',
    codePlaceholder: 'کوڈ',
    joinCta: 'شامل ہوں',
    roster: 'ارکان',
    captain: 'کپتان',
    youLabel: 'آپ',
    memberCount: '{{max}} میں سے {{count}}',
    share: 'دعوت بھیجیں',
    shareMessage: 'قدم پر میری ٹیم میں شامل ہوں۔ کوڈ: {{code}}\nqadam://join/{{code}}',
    leave: 'ٹیم چھوڑ دیں',
    handOver: 'کپتان بنائیں',
    errorName: 'پہلے ٹیم کا نام لکھیں۔',
    errorCode: 'اس کوڈ کی کوئی ٹیم نہیں۔ کپتان سے تصدیق کریں۔',
    errorFull: 'یہ ٹیم بھر چکی ہے۔',
    errorLeaveCaptain: 'ٹیم چھوڑنے سے پہلے کسی اور کو کپتان بنائیں۔',
  },

  friends: {
    title: 'دوست',
    empty: 'دوست شامل کریں اور اس ہفتے مقابلہ کریں۔',
    addTitle: 'دوست شامل کریں',
    addBody: 'ان کا کوڈ درج کریں۔ یہ وہی کوڈ ہے جو وہ دعوت کے لیے استعمال کرتے ہیں۔',
    codePlaceholder: 'کوڈ',
    addCta: 'شامل کریں',
    yourCode: 'آپ کا کوڈ',
    shareCode: 'اپنا کوڈ بھیجیں',
    shareMessage: 'قدم پر مجھے شامل کریں۔ میرا کوڈ {{code}} ہے۔',
    remove: 'ہٹا دیں',
    errorCode: 'اس کوڈ کا کوئی صارف نہیں۔ دیکھ کر دوبارہ کوشش کریں۔',
  },

  errors: {
    healthOff: 'صحت کی اجازت بند ہے، اس لیے آج کے قدم شمار نہیں ہو رہے۔',
    healthOffCta: 'اسے آن کریں',
    offline: 'آپ آف لائن ہیں۔ قدم محفوظ ہیں اور بعد میں بھیج دیے جائیں گے۔',
    generic: 'کچھ غلط ہو گیا۔ دوبارہ کوشش کے لیے نیچے کھینچیں۔',
  },
};
