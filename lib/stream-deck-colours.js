const FIXTURES = ['beams', 'strobes'];

export function getStreamDeckColourChoices(colourControls, choices = []) {
  return choices.flatMap(choice => {
    const source = choice.palette
      ? colourControls.palettes?.find(palette => palette.id === choice.palette && !palette.placeholder)?.colours
      : Object.fromEntries(FIXTURES.map(id => [id, choice.colour]));
    const colours = Object.fromEntries(FIXTURES.map(id => [id, source?.[id]]));
    const valid = FIXTURES.every(id =>
      colourControls.colours?.some(colour => colour.id === colours[id]) &&
      Number.isFinite(colourControls.fixtures?.find(fixture => fixture.id === id)?.cues?.[colours[id]]));
    return valid ? [{ id: choice.id, colours }] : [];
  });
}

export function pickStreamDeckColour(choices, currentColours, random = Math.random) {
  const candidates = choices.length > 1
    ? choices.filter(choice => !FIXTURES.every(id => choice.colours[id] === currentColours?.[id]))
    : choices;
  if (!candidates.length) return null;
  return candidates[Math.floor(random() * candidates.length)];
}
