// Pick from the configured Main bank only; never include placeholders or effects.
export function pickRandomMainCue(entries, activeCue, random = Math.random) {
  const assigned = [...new Map((entries ?? [])
    .filter(entry => !entry.placeholder && Number.isFinite(entry.cue) && entry.cue > 0)
    .map(entry => [entry.cue, entry])).values()];
  const candidates = assigned.length > 1
    ? assigned.filter(entry => entry.cue !== activeCue)
    : assigned;
  if (!candidates.length) return null;
  return candidates[Math.floor(random() * candidates.length)];
}
