/**
 * docs/METRICS.md §2 — the event spec, typed.
 *
 * Two rules from that document shape this file:
 *
 *   * "Open retention, not install retention." `app_open` is fired only when the
 *     app comes to the FOREGROUND. Background sync fires `steps_synced` and
 *     nothing else, because background sync is not engagement and cannot be
 *     sold against.
 *   * The event vocabulary is closed. `EventName` below matches the CHECK
 *     constraint on analytics_events exactly, so a typo is a type error rather
 *     than a chart that never moves.
 *
 * Events are buffered and flushed in batches. Analytics must never be able to
 * slow down or fail the thing the user is doing, so every failure here is
 * swallowed.
 *
 * This module deliberately imports nothing from react-native. Keeping it pure
 * means the buffering and session rules — the parts that decide what §1.2
 * measures — are testable in plain node, without a renderer.
 */

export type EventName =
  // onboarding
  | 'first_open' | 'onboarding_step_viewed' | 'health_permission_prompted'
  | 'health_permission_granted' | 'health_permission_denied' | 'onboarding_completed'
  | 'account_deleted'
  // core loop
  | 'app_open' | 'steps_synced' | 'coins_minted' | 'streak_continued' | 'streak_broken'
  | 'daily_goal_hit'
  // social
  | 'leaderboard_viewed' | 'team_created' | 'team_joined' | 'team_invite_shared'
  | 'referral_shared' | 'referral_converted'
  // commerce
  | 'store_opened' | 'product_viewed' | 'add_to_cart' | 'checkout_started' | 'coins_applied'
  | 'coins_insufficient_shown' | 'order_placed' | 'whatsapp_confirm_sent'
  | 'whatsapp_confirm_received' | 'order_delivered' | 'order_refused'
  // the locked-shop test (§1.5)
  | 'shop_locked_viewed' | 'notify_me_submitted'
  // monetisation
  | 'rewarded_ad_offered' | 'rewarded_ad_completed' | 'coins_expired'
  | 'expiry_notification_sent' | 'expiry_notification_tapped';

export interface QueuedEvent {
  name: EventName;
  props: Record<string, unknown>;
  session_id: string;
  occurred_at: string;
}

/** Where events go. Swapped in tests, and later for PostHog or Amplitude. */
export interface Sink {
  send(events: QueuedEvent[], context: Context): Promise<void>;
}

export interface Context {
  user_id: string | null;
  platform: 'android' | 'ios' | 'web';
  app_version: string;
  city: string | null;
}

const MAX_BUFFER = 40;
const FLUSH_AFTER_MS = 15_000;

let sink: Sink | null = null;
let context: Context = {
  user_id: null,
  platform: 'web',   // the app overrides this at startup
  app_version: '0.1.0',
  city: null,
};

let buffer: QueuedEvent[] = [];
let sessionId = newSessionId();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function newSessionId(): string {
  // A plain uuid v4. crypto.randomUUID is not on every RN runtime.
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

export function configureAnalytics(next: Sink | null, ctx: Partial<Context> = {}): void {
  sink = next;
  context = { ...context, ...ctx };
}

export function setAnalyticsUser(userId: string | null, city: string | null = null): void {
  context = { ...context, user_id: userId, city: city ?? context.city };
}

/**
 * A new session on every foreground. §1.2 measures sessions, so what counts as
 * one has to be decided in exactly one place — here.
 */
export function startSession(): string {
  sessionId = newSessionId();
  return sessionId;
}

export const currentSession = (): string => sessionId;

export function track(name: EventName, props: Record<string, unknown> = {}): void {
  buffer.push({ name, props, session_id: sessionId, occurred_at: new Date().toISOString() });

  if (buffer.length >= MAX_BUFFER) {
    void flush();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => { void flush(); }, FLUSH_AFTER_MS);
  }
}

export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0 || !sink) {
    // No sink configured yet: drop rather than grow without limit. Analytics is
    // not worth an unbounded array on a three-year-old handset.
    if (!sink) buffer = [];
    return;
  }

  const batch = buffer;
  buffer = [];
  try {
    await sink.send(batch, context);
  } catch {
    // Put it back, but only up to the cap, so a long outage cannot grow the
    // buffer without bound. Losing analytics beats losing the app.
    buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
  }
}

/** Test seam. */
export function __resetAnalytics(): void {
  buffer = [];
  sink = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  sessionId = newSessionId();
}

export const __bufferSize = (): number => buffer.length;
