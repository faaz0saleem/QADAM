import AsyncStorage from '@react-native-async-storage/async-storage';

import { setPendingInvite, takePendingInvite } from '../pendingInvite';

beforeEach(async () => {
  await AsyncStorage.clear();
});

/**
 * §7.6 — joining from a deep link has to work without an account. The invite
 * arrives, the person is sent through phone OTP, and the route they were
 * heading for is gone by the time they come back. The code has to survive that.
 */
describe('a team invite that arrives while signed out', () => {
  it('survives the trip through sign-in', async () => {
    await setPendingInvite('GULB27');
    expect(await takePendingInvite()).toBe('GULB27');
  });

  it('is claimed exactly once', async () => {
    await setPendingInvite('GULB27');
    await takePendingInvite();
    // Otherwise every launch reopens the team screen for a link followed weeks ago.
    expect(await takePendingInvite()).toBeNull();
  });

  it('normalises the case people actually type', async () => {
    await setPendingInvite('gulb27');
    expect(await takePendingInvite()).toBe('GULB27');
  });

  it('strips punctuation from a code pasted out of a message', async () => {
    await setPendingInvite('GUL-B27');
    expect(await takePendingInvite()).toBe('GULB27');
  });

  it('ignores anything that is not a six-character code', async () => {
    await setPendingInvite('nope');
    expect(await takePendingInvite()).toBeNull();
  });

  it('returns null when no invite was ever stored', async () => {
    expect(await takePendingInvite()).toBeNull();
  });
});
