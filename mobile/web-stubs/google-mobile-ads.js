// §7.8 — rewarded video, which does not exist on web. The caller's own
// 'unavailable' path handles this; see src/lib/ads.ts.
const noop = () => () => {};

class RewardedAd {
  static createForAdRequest() {
    return new RewardedAd();
  }
  addAdEventListener() {
    return noop();
  }
  load() {}
  show() {}
}

module.exports = {
  __esModule: true,
  default: () => ({ initialize: async () => [] }),
  RewardedAd,
  RewardedAdEventType: { LOADED: 'loaded', EARNED_REWARD: 'earned_reward' },
  AdEventType: { CLOSED: 'closed', ERROR: 'error' },
  TestIds: { REWARDED: 'web-no-ads' },
};
