import type { Range } from '@/database/schemas/types';

/** Merges [s, e) into sorted, non-overlapping ranges (touching ranges within `gapMs` join). */
export function addRange(ranges: Range[], r: Range, gapMs = 1500): Range[] {
  if (r[1] <= r[0]) return ranges;
  const all = [...ranges, r].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const cur of all) {
    const last = out[out.length - 1];
    if (last && cur[0] <= last[1] + gapMs) last[1] = Math.max(last[1], cur[1]);
    else out.push([cur[0], cur[1]]);
  }
  return out;
}

export function rangeAt(ranges: Range[], ms: number): Range | null {
  return ranges.find((r) => ms >= r[0] && ms < r[1]) ?? null;
}

/** Where dubbing should (re)start for playback at `ms`: the end of the covered range containing it, else `ms`. */
export function resumePoint(ranges: Range[], ms: number): number {
  return rangeAt(ranges, ms)?.[1] ?? ms;
}

export function coveredMs(ranges: Range[]): number {
  return ranges.reduce((sum, r) => sum + (r[1] - r[0]), 0);
}

/** How many ms of dubbed audio exist ahead of `ms` without a gap. */
export function leadAt(ranges: Range[], ms: number): number {
  const r = rangeAt(ranges, ms);
  return r ? r[1] - ms : 0;
}
