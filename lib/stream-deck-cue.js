// A fixed deck action must refer to an assigned cue in its configured bank.
export function findStreamDeckCue(cueBanks, button) {
  if (!Number.isFinite(button.cueNumber) || button.cueNumber <= 0) return null;
  return cueBanks?.[button.bankKey]?.cues?.find(entry =>
    !entry.placeholder && entry.cue === button.cueNumber) ?? null;
}
