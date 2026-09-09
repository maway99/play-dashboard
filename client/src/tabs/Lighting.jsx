import React, { useState, useEffect, useRef, useCallback } from 'react';

const AUTO_INTERVAL_MS = 15000;
const VISIBLE_CUES_PER_BANK = 15;
const AUTO_CUE_BANKS = ['slowCues', 'mainCues', 'strobeCues'];
const CUE_BANK_ROWS = [
  [
    { key: 'slowCues', buttonColumns: 2 },
    { key: 'buildups', buttonColumns: 3 },
    { key: 'strobeCues', buttonColumns: 2 }
  ],
  [
    { key: 'mainCues', buttonColumns: 4 },
    { key: 'laserCues', buttonColumns: 5 }
  ]
];
const MAIN_COLOUR_FIXTURE_IDS = ['beams', 'strobes'];

// Display labels are Title Case regardless of how they're typed in config.
const titleCase = (text) => String(text ?? '').replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());

function isAssignedCue(cue) {
  return Number.isFinite(cue?.cue);
}

function pickRandom(cues, exclude) {
  const assigned = cues.filter(isAssignedCue);
  const pool = exclude != null ? assigned.filter(c => c.cue !== exclude) : assigned;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getAutoPalettes(config) {
  const nonWhiteColourIds = new Set(
    (config?.colours ?? [])
      .filter((colour) => colour.id !== 'open' && !/white|filter/i.test(colour.label ?? ''))
      .map((colour) => colour.id)
  );

  return (config?.palettes ?? []).filter((palette) =>
    !palette.placeholder &&
    MAIN_COLOUR_FIXTURE_IDS.every((fixtureId) => nonWhiteColourIds.has(palette.colours?.[fixtureId]))
  );
}

function pickRandomPalette(palettes, excludeId) {
  const pool = palettes.length > 1 && excludeId
    ? palettes.filter((palette) => palette.id !== excludeId)
    : palettes;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function fixtureColoursForPalette(palette) {
  return Object.fromEntries(
    MAIN_COLOUR_FIXTURE_IDS
      .filter((fixtureId) => typeof palette?.colours?.[fixtureId] === 'string')
      .map((fixtureId) => [fixtureId, palette.colours[fixtureId]])
  );
}

function matchingPaletteId(palettes, fixtureColours) {
  return palettes.find((palette) =>
    MAIN_COLOUR_FIXTURE_IDS.every((fixtureId) => palette.colours?.[fixtureId] === fixtureColours?.[fixtureId])
  )?.id ?? null;
}

export default function Lighting({ state, send }) {
  const [autoBank, setAutoBank] = useState(null);
  const [autoNextCue, setAutoNextCue] = useState(null);
  const [autoNextAt, setAutoNextAt] = useState(null);
  const autoTimerRef = useRef(null);
  const autoRef = useRef({ nextCue: null, cues: [], bankKey: null, lastPaletteId: null });
  const autoPalettesRef = useRef([]);
  const mainColoursRef = useRef({});

  mainColoursRef.current = Object.fromEntries(MAIN_COLOUR_FIXTURE_IDS.map((fixtureId) => [
    fixtureId,
    state.fixtureColours?.[fixtureId]
      ?? state.config.defaults?.fixtureColours?.[fixtureId]
      ?? 'blue'
  ]));
  autoPalettesRef.current = getAutoPalettes(state.config.colourControls);

  const sendCue = useCallback((cueNumber, bankKey, colours) => {
    send({
      type: 'cue',
      cueNumber,
      ...(bankKey === 'mainCues' ? { colours: colours ?? mainColoursRef.current } : {})
    });
  }, [send]);

  const stopAuto = useCallback(() => {
    clearTimeout(autoTimerRef.current);
    setAutoBank(null);
    setAutoNextCue(null);
    setAutoNextAt(null);
  }, []);

  const sendAutoCue = useCallback((cueNumber, bankKey, previousPaletteId) => {
    const palette = pickRandomPalette(autoPalettesRef.current, previousPaletteId);
    const colours = fixtureColoursForPalette(palette);

    // Main cues accept an explicit colour layer. Other cue banks receive the
    // same palette immediately after the cue so their programmed colour cannot
    // overwrite the newly selected automatic look.
    sendCue(cueNumber, bankKey, colours);
    if (palette && bankKey !== 'mainCues') {
      send({ type: 'fixturePalette', palette: palette.id, fixtures: MAIN_COLOUR_FIXTURE_IDS });
    }
    return palette?.id ?? null;
  }, [send, sendCue]);

  const tick = useCallback(() => {
    const { nextCue, cues, bankKey, lastPaletteId } = autoRef.current;
    if (!Number.isFinite(nextCue)) {
      stopAuto();
      return;
    }
    const nextPaletteId = sendAutoCue(nextCue, bankKey, lastPaletteId);
    const newNext = pickRandom(cues, nextCue);
    if (!newNext) {
      stopAuto();
      return;
    }
    autoRef.current.nextCue = newNext.cue;
    autoRef.current.lastPaletteId = nextPaletteId;
    setAutoNextCue(newNext.cue);
    setAutoNextAt(Date.now() + AUTO_INTERVAL_MS);
    autoTimerRef.current = setTimeout(tick, AUTO_INTERVAL_MS);
  }, [sendAutoCue, stopAuto]);

  const toggleAuto = useCallback((bankKey, cues) => {
    if (autoBank === bankKey) { stopAuto(); return; }
    const assignedCues = cues.filter(isAssignedCue);
    if (assignedCues.length === 0) return;
    clearTimeout(autoTimerRef.current);
    const first = pickRandom(assignedCues, null);
    const currentPaletteId = matchingPaletteId(autoPalettesRef.current, mainColoursRef.current);
    const firstPaletteId = sendAutoCue(first.cue, bankKey, currentPaletteId);
    const next = pickRandom(assignedCues, first.cue);
    autoRef.current = {
      nextCue: next?.cue ?? null,
      cues: assignedCues,
      bankKey,
      lastPaletteId: firstPaletteId
    };
    setAutoBank(bankKey);
    setAutoNextCue(next?.cue ?? null);
    setAutoNextAt(Date.now() + AUTO_INTERVAL_MS);
    autoTimerRef.current = setTimeout(tick, AUTO_INTERVAL_MS);
  }, [autoBank, sendAutoCue, stopAuto, tick]);

  const handleSelectCue = useCallback((cue, bankKey) => {
    if (!isAssignedCue(cue)) return;
    if (autoBank) stopAuto();
    sendCue(cue.cue, bankKey, cue.colours);
  }, [autoBank, sendCue, stopAuto]);

  const handleClear = useCallback(() => {
    if (autoBank) stopAuto();
    send({ type: 'clear' });
  }, [autoBank, send, stopAuto]);

  useEffect(() => () => clearTimeout(autoTimerRef.current), []);

  return (
    <div className="h-full flex flex-col gap-4 min-h-0 min-w-0">
      <ControlBar
        state={state}
        autoBank={autoBank}
        autoNextAt={autoNextAt}
        toggleAuto={toggleAuto}
        onClear={handleClear}
        send={send}
      />

      <section className="flex-1 min-h-0 min-w-0 overflow-hidden" aria-label="Cue banks">
        <CueBanks
          banks={state.config.cueBanks}
          activeCue={state.activeCue}
          onSelect={handleSelectCue}
          autoBank={autoBank}
          autoNextCue={autoNextCue}
          colourConfig={state.config.colourControls}
          fixtureColours={mainColoursRef.current}
        />
      </section>

      <div
        className="flex-none grid grid-cols-[minmax(0,1fr)_420px] gap-4 min-h-0 min-w-0"
        style={{ height: 'var(--colour-grid-h)' }}
      >
        <ColourControls
          config={state.config.colourControls}
          fixtureColours={mainColoursRef.current}
          onFixtureColour={(fixture, colour) => send({ type: 'fixtureColour', fixture, colour })}
          onAllColour={(colour) => send({
            type: 'fixtureColours',
            colours: Object.fromEntries(MAIN_COLOUR_FIXTURE_IDS.map((fixture) => [fixture, colour]))
          })}
        />
        <PalettePanel
          config={state.config.colourControls}
          fixtureColours={mainColoursRef.current}
          onPalette={(palette) => send({
            type: 'fixturePalette',
            palette,
            fixtures: MAIN_COLOUR_FIXTURE_IDS
          })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Top bar: haze, fade, auto, clear, end of night                      */
/* ------------------------------------------------------------------ */

function ControlBar({ state, autoBank, autoNextAt, toggleAuto, onClear, send }) {
  const secondsToNext = useCountdown(autoNextAt);
  const autoBanks = AUTO_CUE_BANKS.filter((key) =>
    state.config.cueBanks[key]?.cues?.some(isAssignedCue)
  );
  return (
    <section className="panel px-4 py-[var(--panel-pad-y)] flex-none w-full" aria-label="Control">
      <div className="flex items-end min-w-0 divide-x divide-border/60">
        <div className="flex-[2.3] min-w-0 pr-6">
          <div className="flex items-center justify-between mb-1.5">
            <div className="section-header">Haze</div>
            <div className="text-[14px] tabular-nums text-white leading-none">{state.haze}%</div>
          </div>
          <HazeControls value={state.haze} onChange={(v) => send({ type: 'haze', value: v })} />
        </div>

        <div className="flex-[1.7] min-w-0 px-6">
          <div className="section-header mb-1.5">Fade Time</div>
          <FadeTimePresets
            value={state.fadeTime}
            onChange={(v) => send({ type: 'fadeTime', value: v })}
          />
        </div>

        <div className="flex-[1.4] min-w-0 px-6">
          <div className="section-header mb-1.5">Auto Cycle</div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, autoBanks.length)}, minmax(0, 1fr))` }}
          >
            {autoBanks.map((key) => {
              const bank = state.config.cueBanks[key];
              if (!bank) return null;
              const assigned = bank.cues.filter(isAssignedCue).slice(0, VISIBLE_CUES_PER_BANK);
              const isActive = autoBank === key;
              const canRunAuto = assigned.length > 0;
              const name = titleCase(bank.label.replace(/ cues$/i, ''));
              return (
                <button
                  key={key}
                  onClick={() => toggleAuto(key, assigned)}
                  aria-disabled={!canRunAuto}
                  aria-pressed={isActive ? 'true' : 'false'}
                  title={canRunAuto ? `Auto-cycle ${bank.label} every ${AUTO_INTERVAL_MS / 1000}s` : `${bank.label} has no assigned cues`}
                  className={`btn h-[var(--ctl-h)] text-[14px] tabular-nums ${
                    isActive ? 'btn-warn' : canRunAuto ? 'btn-default' : 'btn-default border-dashed text-white/45'
                  }`}
                  style={{ minHeight: 0 }}
                >
                  {isActive && secondsToNext != null ? `${name} · ${secondsToNext}s` : name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-[1.2] min-w-0 px-6">
          <TempoBlock link={state.link} onToggle={(enabled) => send({ type: 'linkEnable', enabled })} />
        </div>

        <div className="flex-[0.9] min-w-0 px-6">
          <button
            onClick={onClear}
            title="Release the running cue (and stop auto)"
            className="btn h-[var(--ctl-h)] w-full text-[14px] btn-default"
            style={{ minHeight: 0 }}
          >
            Clear
          </button>
        </div>

        <div className="flex-[1.1] min-w-0 pl-6">
          <button
            onClick={() => send({ type: 'endOfNight', active: !state.endOfNightActive })}
            aria-pressed={state.endOfNightActive ? 'true' : 'false'}
            title={state.endOfNightActive ? 'End of night is on - tap to switch off' : 'Switch on end of night'}
            className={`btn h-[var(--ctl-h)] w-full text-[14px] ${
              state.endOfNightActive ? 'btn-warn' : 'bg-btn text-white border border-amber/60 hover:border-amber'
            }`}
            style={{ minHeight: 0 }}
          >
            End Of Night
          </button>
        </div>
      </div>
    </section>
  );
}

// Tempo from Ableton Link (via Carabiner) or the configured default. Tapping toggles following Link.
function TempoBlock({ link, onToggle }) {
  if (!link) return null;
  const following = link.source === 'link';
  const carabinerUp = link.carabiner === 'connected';
  const status = !link.enabled
    ? 'Link off'
    : !carabinerUp
    ? 'No Link bridge'
    : link.peers > 0
    ? `Link · ${link.peers} peer${link.peers === 1 ? '' : 's'}`
    : 'Link · no peers';
  const bpmText = Number.isFinite(link.bpm) ? (Number.isInteger(link.bpm) ? String(link.bpm) : link.bpm.toFixed(1)) : '—';
  return (
    <>
      <div className="flex items-center justify-between mb-1.5 min-w-0">
        <div className="section-header">Tempo</div>
        <div className={`text-[12px] leading-none truncate ${following ? 'text-ok' : 'text-muted'}`}>{status}</div>
      </div>
      <button
        onClick={() => onToggle(!link.enabled)}
        aria-pressed={link.enabled ? 'true' : 'false'}
        title={link.enabled ? 'Following Ableton Link - tap to hold the default tempo' : 'Tap to follow Ableton Link'}
        className={`btn h-[var(--ctl-h)] w-full px-3 flex items-center justify-center gap-1.5 tabular-nums ${
          link.enabled ? 'btn-default' : 'btn-default border-dashed text-white/60'
        }`}
        style={{ minHeight: 0 }}
      >
        <span className="text-[20px] leading-none">{bpmText}</span>
        <span className="text-[12px] text-muted leading-none">BPM</span>
      </button>
    </>
  );
}

// Re-renders once a second while a deadline is set; returns whole seconds remaining.
function useCountdown(deadline) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline == null) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline == null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

const HAZE_PRESETS = [0, 25, 50, 75, 100];

function HazeControls({ value, onChange }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {HAZE_PRESETS.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-pressed={active ? 'true' : 'false'}
            className={`btn h-[var(--ctl-h)] text-[15px] tabular-nums ${active ? 'btn-active' : 'btn-default'}`}
            style={{ minHeight: 0 }}
          >
            {p === 0 ? 'Off' : p}
          </button>
        );
      })}
    </div>
  );
}

function FadeTimePresets({ value, onChange }) {
  const presets = [0, 0.5, 2];
  return (
    <div className="grid grid-cols-3 gap-2">
      {presets.map((p) => {
        const active = Math.abs(value - p) < 0.001;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-pressed={active ? 'true' : 'false'}
            className={`btn h-[var(--ctl-h)] ${active ? 'btn-active' : 'btn-default'} text-[15px]`}
            style={{ minHeight: 0 }}
          >
            {p === 0 ? '0s' : `${p}s`}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom colour controls                                              */
/* ------------------------------------------------------------------ */

function PalettePanel({ config, fixtureColours = {}, onPalette }) {
  const fixtures = MAIN_COLOUR_FIXTURE_IDS
    .map((fixtureId) => config?.fixtures?.find((fixture) => fixture.id === fixtureId))
    .filter(Boolean);
  const palettes = (config?.palettes ?? []).filter((palette) => !palette.placeholder);
  if (!palettes.length || !fixtures.length) return null;

  const coloursById = new Map(config.colours.map((colour) => [colour.id, colour]));
  const activePalette = palettes.find((palette) =>
    fixtures.every((fixture) => fixtureColours?.[fixture.id] === palette.colours?.[fixture.id])
  );

  return (
    <section className="panel px-4 py-[var(--panel-pad-y)] min-h-0 min-w-0 h-full flex flex-col" aria-label="Colour palettes">
      <div className="section-header mb-2">Palettes</div>
      <div
        className="grid grid-cols-2 gap-2 flex-1 min-h-0"
        style={{ gridTemplateRows: `repeat(${Math.ceil(palettes.length / 2)}, minmax(0, 1fr))` }}
      >
        {palettes.map((palette) => {
          const selected = activePalette?.id === palette.id;
          return (
            <button
              key={palette.id}
              type="button"
              aria-pressed={selected ? 'true' : 'false'}
              aria-label={`Apply palette ${palette.label}`}
              title={paletteTitle(palette, fixtures, coloursById)}
              onClick={() => onPalette(palette.id)}
              className={`btn h-full min-h-0 w-full overflow-hidden flex flex-col items-center justify-center gap-1.5 px-2 text-[13px] ${
                selected ? 'btn-active' : 'btn-default'
              }`}
              style={{ minHeight: 0 }}
            >
              <span className="truncate max-w-full leading-none">{titleCase(palette.label)}</span>
              <span className="flex gap-1" aria-hidden="true">
                {fixtures.map((fixture) => (
                  <span
                    key={fixture.id}
                    className={`h-[11px] w-[24px] rounded-[3px] border ${selected ? 'border-black/35' : 'border-white/15'}`}
                    style={{ backgroundColor: coloursById.get(palette.colours?.[fixture.id])?.hex ?? '#222' }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function paletteTitle(palette, fixtures, coloursById) {
  return fixtures
    .map((fixture) => `${fixture.label}: ${coloursById.get(palette.colours?.[fixture.id])?.label ?? '—'}`)
    .join(' · ');
}

function ColourControls({ config, fixtureColours = {}, onFixtureColour, onAllColour }) {
  const fixtures = MAIN_COLOUR_FIXTURE_IDS
    .map((fixtureId) => config?.fixtures?.find((fixture) => fixture.id === fixtureId))
    .filter(Boolean);
  if (!config?.colours?.length || !fixtures.length) return null;

  const colours = config.colours;
  const allSelectedColour = colours.find((colour) =>
    fixtures.every((fixture) => fixtureColours?.[fixture.id] === colour.id)
  );
  const rows = [
    { id: 'all', label: 'Both', all: true, selected: allSelectedColour?.id, onSelect: (colour) => onAllColour(colour.id) },
    ...fixtures.map((fixture) => ({
      id: fixture.id,
      label: fixture.label,
      all: false,
      selected: fixtureColours?.[fixture.id],
      onSelect: (colour) => onFixtureColour(fixture.id, colour.id)
    }))
  ];

  return (
    <section className="panel px-4 py-[var(--panel-pad-y)] min-h-0 min-w-0 h-full flex flex-col" aria-label="Fixture colours">
      <div className="section-header mb-2">Colours</div>
      <div
        className="grid flex-1 min-h-0 gap-2"
        style={{
          gridTemplateColumns: `82px repeat(${colours.length}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))`
        }}
      >
        {rows.map((row) => (
          <React.Fragment key={row.id}>
            <div className={`flex items-center pr-2 text-[13px] ${row.all ? 'text-white font-medium' : 'text-white/70'}`}>
              {titleCase(row.label)}
            </div>
            {colours.map((colour) => (
              <ColourCell
                key={`${row.id}-${colour.id}`}
                colour={colour}
                scope={row.label}
                filled={row.all}
                selected={row.selected === colour.id}
                onSelect={() => row.onSelect(colour)}
              />
            ))}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

function ColourCell({ colour, scope, filled, selected, onSelect }) {
  const lit = filled || selected;
  return (
    <button
      type="button"
      aria-pressed={selected ? 'true' : 'false'}
      aria-label={`${scope}: set ${colour.label}`}
      title={`${scope} · ${colour.label} · ${colour.slot} · DMX ${colour.dmx}`}
      onClick={onSelect}
      className="relative h-full w-full min-h-0 rounded-ui border-2 transition-[background-color] duration-100 active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      style={{
        borderColor: filled && selected ? '#ffffff' : colour.hex,
        backgroundColor: lit ? colour.hex : '#161616'
      }}
    >
      {selected && <span className="absolute inset-[5px] rounded-[2px] border-2 border-black/55" aria-hidden="true" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Cue banks                                                           */
/* ------------------------------------------------------------------ */

function CueBanks({
  banks,
  activeCue,
  onSelect,
  autoBank,
  autoNextCue
}) {
  return (
    <div
      className="h-full grid grid-rows-2 gap-4 min-h-0 min-w-0"
    >
      {CUE_BANK_ROWS.map((row, rowIndex) => (
        <div
          key={`cue-bank-row-${rowIndex}`}
          className="grid gap-4 min-h-0 min-w-0"
          style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
        >
          {row.map(({ key, buttonColumns }) => (
            <BankBlock
              key={key}
              bankKey={key}
              bank={banks[key]}
              activeCue={activeCue}
              onSelect={(cue) => onSelect(cue, key)}
              isAutoRunning={autoBank === key}
              autoNextCue={autoBank === key ? autoNextCue : null}
              buttonColumns={buttonColumns}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function BankBlock({ bankKey, bank, activeCue, onSelect, isAutoRunning, autoNextCue, buttonColumns }) {
  const isStrobe = bankKey === 'strobeCues';
  const visible = (bank?.cues ?? []).filter(isAssignedCue).slice(0, VISIBLE_CUES_PER_BANK);
  const rows = Math.max(1, Math.ceil(visible.length / buttonColumns));
  const isLive = visible.some((cue) => cue.cue === activeCue);

  return (
    <div
      className="rounded-ui border p-3 h-full flex flex-col overflow-hidden min-w-0"
      style={{
        backgroundColor: '#111111',
        borderColor: isLive ? 'rgba(255, 255, 255, 0.45)' : 'rgba(51, 51, 51, 0.6)',
        borderTopWidth: 2,
        borderTopColor: isLive ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.28)'
      }}
    >
      <div className="flex flex-none items-baseline gap-2 mb-2 min-w-0">
        <span className={`text-[14px] truncate ${isLive ? 'text-white font-medium' : 'text-white/70'}`}>
          {titleCase(bank?.label ?? bankKey)}
        </span>
        {isAutoRunning && <span className="text-[12px] text-amber flex-none">Auto</span>}
      </div>

      {visible.length === 0 ? (
        <div className="flex-1 min-h-0 rounded-ui border border-dashed border-border/45 bg-black/15 flex items-center justify-center text-[12px] text-white/25">
          No cues assigned
        </div>
      ) : (
        <div
          className="grid gap-2 flex-1 min-h-0"
          style={{
            gridTemplateColumns: `repeat(${buttonColumns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
          }}
        >
          {visible.map((cue, index) => {
            const isActive = activeCue === cue.cue;
            const isNext = autoNextCue === cue.cue;
            return (
              <button
                key={cue.id ?? `${bankKey}-${index}`}
                onClick={() => onSelect(cue)}
                aria-pressed={isActive ? 'true' : 'false'}
                aria-label={`${cue.label}, cue ${cue.cue}`}
                title={`${cue.label} - cue ${cue.cue}`}
                className={`btn relative h-full w-full min-h-0 text-[14px] overflow-hidden flex items-center justify-center px-2 pt-3 ${
                  isActive
                    ? `btn-active ${isStrobe ? 'border-2 border-amber' : ''}`
                    : isNext
                    ? 'btn-default border-2 border-amber/70'
                    : 'btn-default'
                }`}
                style={{ minHeight: 0 }}
              >
                <span className={`absolute top-1.5 right-2 text-[10px] leading-none tabular-nums ${isActive ? 'opacity-60' : 'opacity-45'}`}>
                  {cue.cue}
                </span>
                <span className="line-clamp-2 leading-tight text-center">{titleCase(cue.label)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
