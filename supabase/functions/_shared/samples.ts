/**
 * The shape the client is allowed to send, and the only thing trusted about it:
 * that it is bounded.
 *
 * README §13.2 — the client reports raw step counts and nothing else. The
 * database enforces the real rules (cap, rate ceiling, backfill window); this
 * exists so an absurd payload never reaches it.
 */
export interface Sample {
  /** YYYY-MM-DD, the device's local (PKT) day. */
  date: string;
  raw_steps: number;
}

/** §6.1 accepts 48 hours of backfill; fourteen days is generous headroom. */
const MAX_DAYS = 14;

/** Beyond any human total for one day by three orders of magnitude. */
const ABSURD_STEPS = 10_000_000;

export function sanitiseSamples(input: unknown): Sample[] {
  if (!Array.isArray(input)) return [];

  const out: Sample[] = [];
  const seen = new Set<string>();

  for (const raw of input.slice(0, MAX_DAYS)) {
    if (typeof raw !== 'object' || raw === null) continue;

    const candidate = raw as Partial<Sample>;
    const date = candidate.date;
    const steps = Number(candidate.raw_steps);

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(steps) || steps < 0) continue;

    // A payload naming the same day twice would have the database process it
    // twice in one call, where the second pass sees the first as a regression.
    // Keep the highest, the same rule the offline queue uses.
    const value = Math.min(Math.floor(steps), ABSURD_STEPS);
    const existing = out.find((s) => s.date === date);
    if (existing) {
      existing.raw_steps = Math.max(existing.raw_steps, value);
      continue;
    }

    seen.add(date);
    out.push({ date, raw_steps: value });
  }

  return out;
}
