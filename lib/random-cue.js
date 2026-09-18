export const RANDOM_CUE_BANKS = ['mainCues', 'slowCues', 'strobeCues', 'laserCues'];

// Pick only assigned, unique entries from the requested bank, not placeholders.
export function pickRandomCue(entries, activeCue, random = Math.random) {
  const assigned = [...new Map((entries ?? [])
    .filter(entry => !entry.placeholder && Number.isFinite(entry.cue) && entry.cue > 0)
    .map(entry => [entry.cue, entry])).values()];
  const candidates = assigned.length > 1
    ? assigned.filter(entry => entry.cue !== activeCue)
    : assigned;
  if (!candidates.length) return null;
  return candidates[Math.floor(random() * candidates.length)];
}
