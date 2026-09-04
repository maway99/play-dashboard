import React, { useEffect, useMemo, useRef, useState } from 'react';

const GLOBAL_ACTIONS = [
  { id: 'lampOn', label: 'All lamps on', tone: 'default', confirm: false },
  { id: 'lampOff', label: 'All lamps off', tone: 'warn', confirm: true },
  { id: 'reset', label: 'Reset all fixtures', tone: 'warn', confirm: true }
];

const BEAM_ACTIONS = [
  { id: 'lampOn', label: 'Lamp on', confirm: false },
  { id: 'lampOff', label: 'Lamp off', confirm: true },
  { id: 'reset', label: 'Reset', confirm: true }
];

function polarPoint(index, total, radius) {
  const angle = Math.PI / 2 + (index / total) * Math.PI * 2;
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius
  };
}

export default function Control({ state, send }) {
  const maintenance = state.config.fixtureMaintenance;
  const configured = !!maintenance?.configured;
  const disabledBeams = state.disabledBeamFixtures ?? {};
  const beams = maintenance?.beamFixtures ?? [];
  const strobes = maintenance?.strobeFixtures ?? [];
  const [selectedBeamId, setSelectedBeamId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const inspectorRef = useRef(null);

  const selectedBeam = beams.find((beam) => beam.id === selectedBeamId) ?? null;
  const selectedBeamDisabled = selectedBeam ? !!disabledBeams[selectedBeam.id] : false;
  const selectedBeamDisableAction = selectedBeamDisabled ? 'enable' : 'disable';

  const beamPoints = useMemo(() => beams.map((beam, index) => ({
    ...beam,
    ...polarPoint(index, beams.length, 26)
  })), [beams]);

  const strobePoints = useMemo(() => strobes.map((strobe, index) => ({
    ...strobe,
    ...polarPoint(index, strobes.length, 41)
  })), [strobes]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedBeamId(null);
        setPendingAction(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setPendingAction(null);
  }, [selectedBeamId]);

  useEffect(() => {
    if (!pendingAction) return undefined;
    const timeout = setTimeout(() => setPendingAction(null), 3500);
    return () => clearTimeout(timeout);
  }, [pendingAction]);

  const dispatchGlobal = (action) => {
    send({ type: 'maintenance', scope: 'global', action });
  };

  const dispatchBeam = (action) => {
    if (!selectedBeam) return;
    send({ type: 'maintenance', scope: 'beam', fixtureId: selectedBeam.id, action });
  };

  const cueStackConfigured =
    configured &&
    Number.isFinite(maintenance?.cueStack?.page) &&
    Number.isFinite(maintenance?.cueStack?.exec);

  const hasGlobalCue = (action) =>
    cueStackConfigured && Number.isFinite(maintenance?.globalActions?.[action]?.cue);

  const hasBeamCue = (fixture, action) =>
    cueStackConfigured && Number.isFinite(fixture?.actions?.[action]?.cue);

  return (
    <div className="h-full grid grid-cols-[1fr_360px] gap-5 min-h-0" aria-label="Maintenance">
      <section className="panel relative overflow-hidden min-w-0 min-h-0 flex" aria-label="Maintenance rig diagram">
        <div className="absolute left-5 top-5 z-10">
          <div className="section-header mb-1">Maintenance Rig</div>
          <div className="text-[12px] text-muted">Tap a beam on the ring or in the list. Outer strobes are references.</div>
        </div>

        <div className="relative flex-1 min-w-0 flex items-center justify-center">
          <div className="relative aspect-square h-[min(84vh,calc(100vw-960px))] max-h-[880px] min-h-[560px]">
            <TrussRing radius="82%" />
            <TrussRing radius="52%" />
            <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-white/10" />

            {strobePoints.map((strobe) => (
              <FixtureMarker
                key={strobe.id}
                fixture={strobe}
                kind="strobe"
                interactive={false}
              />
            ))}

            {beamPoints.map((beam) => (
              <FixtureMarker
                key={beam.id}
                fixture={beam}
                kind="beam"
                interactive
                selected={beam.id === selectedBeamId}
                disabled={!!disabledBeams[beam.id]}
                onSelect={() => setSelectedBeamId(beam.id)}
              />
            ))}
          </div>
        </div>

        <BeamList
          beams={beams}
          disabledBeams={disabledBeams}
          selectedBeamId={selectedBeamId}
          onSelect={setSelectedBeamId}
        />
      </section>

      <aside className="panel p-4 flex flex-col gap-4 overflow-hidden" aria-label="Maintenance actions">
        <section className="flex-none">
          <div className="section-header mb-3">Global</div>
          <div className="grid gap-2">
            {GLOBAL_ACTIONS.map((action) => (
              <SafeActionButton
                key={action.id}
                label={action.label}
                actionId={action.id}
                tone={action.tone}
                requiresConfirm={action.confirm}
                disabled={!hasGlobalCue(action.id)}
                disabledLabel="Unconfigured"
                pendingAction={pendingAction}
                setPendingAction={setPendingAction}
                onRun={() => dispatchGlobal(action.id)}
              />
            ))}
          </div>
        </section>

        {!configured && (
          <section className="flex-none border border-amber/45 bg-amber/10 rounded-ui p-3">
            <div className="text-[12px] text-white font-semibold mb-1">Maintenance cues unconfigured</div>
            <div className="text-[11px] leading-relaxed text-muted">
              Add exact MA2 cue assignments in config before lamp, reset, or disable actions are enabled.
            </div>
          </section>
        )}

        <section className="flex-1 min-h-0 flex flex-col" ref={inspectorRef}>
          <div className="section-header mb-3">Selected beam</div>
          {selectedBeam ? (
            <div className="flex flex-col gap-3 min-h-0">
              <div className="flex items-center justify-between border border-border/60 rounded-ui px-3 py-2">
                <div>
                  <div className="text-white text-[18px] font-semibold">{selectedBeam.label}</div>
                  <div className="text-muted text-[11px]">
                    Inner truss position {selectedBeam.number}{selectedBeamDisabled ? ' - disabled' : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBeamId(null)}
                  className="btn btn-default h-[var(--ctl-sm)] px-4 text-[11px] tracking-wider"
                  style={{ minHeight: 0 }}
                  aria-label="Close selected beam controls"
                >
                  CLOSE
                </button>
              </div>

              <div className="grid gap-2">
                {BEAM_ACTIONS.map((action) => (
                  <SafeActionButton
                    key={action.id}
                    label={action.label}
                    actionId={`${selectedBeam.id}:${action.id}`}
                    tone={action.confirm ? 'warn' : 'default'}
                    requiresConfirm={action.confirm}
                    disabled={!hasBeamCue(selectedBeam, action.id)}
                    disabledLabel="Unconfigured"
                    pendingAction={pendingAction}
                    setPendingAction={setPendingAction}
                    onRun={() => dispatchBeam(action.id)}
                  />
                ))}
                <SafeActionButton
                  label={selectedBeamDisabled ? 'Enable fixture' : 'Disable fixture'}
                  actionId={`${selectedBeam.id}:${selectedBeamDisableAction}`}
                  tone={selectedBeamDisabled ? 'default' : 'warn'}
                  requiresConfirm={!selectedBeamDisabled}
                  disabled={!hasBeamCue(selectedBeam, selectedBeamDisableAction)}
                  disabledLabel="Unconfigured"
                  pendingAction={pendingAction}
                  setPendingAction={setPendingAction}
                  onRun={() => dispatchBeam(selectedBeamDisableAction)}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-[180px] border border-border/50 rounded-ui flex items-center justify-center text-center px-6">
              <div>
                <div className="text-white text-[15px] font-semibold mb-1">Select a beam</div>
                <div className="text-muted text-[12px] leading-relaxed">
                  Tap one of the 12 inner fixtures to view lamp, reset, and disable actions.
                </div>
              </div>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function BeamList({ beams, disabledBeams, selectedBeamId, onSelect }) {
  if (!beams.length) return null;
  return (
    <div className="w-[250px] flex-none flex flex-col border-l border-border/50 pl-4 pr-4 py-4 min-h-0" aria-label="Beam list">
      <div className="section-header mb-2 flex-none">Beams</div>
      <div className="flex-1 min-h-0 grid gap-1.5" style={{ gridTemplateRows: `repeat(${beams.length}, minmax(0, 1fr))` }}>
        {beams.map((beam) => {
          const selected = beam.id === selectedBeamId;
          const disabled = !!disabledBeams[beam.id];
          return (
            <button
              key={beam.id}
              type="button"
              onClick={() => onSelect(selected ? null : beam.id)}
              aria-pressed={selected ? 'true' : 'false'}
              className={`btn h-full min-h-0 w-full px-3 flex items-center justify-between text-[14px] ${
                selected ? 'btn-active' : disabled ? 'btn-disabled-active' : 'btn-default'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="tabular-nums w-6 text-left opacity-70">{beam.number}</span>
                <span className="truncate">{beam.label}</span>
              </span>
              <span className={`text-[12px] flex-none ${selected ? 'text-black/60' : disabled ? 'text-amber' : 'text-muted'}`}>
                {disabled ? 'Disabled' : 'Active'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TrussRing({ radius }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/80"
      style={{ width: radius }}
      aria-hidden="true"
    >
      <div className="absolute inset-[7px] rounded-full border border-white/10" />
      <div className="absolute inset-[15px] rounded-full border border-white/5" />
    </div>
  );
}

function FixtureMarker({ fixture, kind, interactive, selected, disabled, onSelect }) {
  const left = `${fixture.x}%`;
  const top = `${fixture.y}%`;
  const base = kind === 'beam'
    ? 'h-14 w-14 border-white/30 bg-white/10 text-white'
    : 'h-11 w-11 border-amber/45 bg-amber/10 text-amber';
  const selectedClass = selected ? 'border-white bg-white text-black ring-2 ring-white/80 opacity-100' : '';
  const disabledClass = disabled ? 'border-dashed opacity-65' : '';
  const slashClass = selected ? 'bg-black/65' : 'bg-white/70';
  const label = `${fixture.label}, ${kind === 'beam' ? 'inner beam fixture' : 'outer strobe reference'}${disabled ? ', disabled' : ''}`;

  if (!interactive) {
    return (
      <div
        className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-[6px] border ${base} flex items-center justify-center text-[12px] font-semibold tabular-nums select-none`}
        style={{ left, top }}
        title={label}
        aria-label={label}
      >
        {fixture.number}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-[6px] border ${base} ${selectedClass} ${disabledClass} flex items-center justify-center overflow-hidden text-[14px] font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`}
      style={{ left, top, minHeight: 0 }}
      title={label}
      aria-label={`Select ${label}`}
      aria-pressed={selected ? 'true' : 'false'}
    >
      {disabled && (
        <>
          <span className={`absolute left-1/2 top-1/2 h-[2px] w-[78px] -translate-x-1/2 -translate-y-1/2 rotate-45 ${slashClass}`} aria-hidden="true" />
          <span className={`absolute left-1/2 top-1/2 h-[2px] w-[78px] -translate-x-1/2 -translate-y-1/2 -rotate-45 ${slashClass}`} aria-hidden="true" />
        </>
      )}
      <span className="relative z-10">{fixture.number}</span>
    </button>
  );
}

function SafeActionButton({
  label,
  actionId,
  tone = 'default',
  requiresConfirm,
  disabled,
  disabledLabel,
  pendingAction,
  setPendingAction,
  onRun
}) {
  const confirming = pendingAction === actionId;
  // Unconfigured actions render neutral + dashed (same convention as the Lighting page)
  // so an amber button always means "this will do something".
  const className = disabled
    ? 'bg-btn text-white/40 border border-dashed border-border/80 cursor-not-allowed'
    : tone === 'warn'
    ? 'btn-warn'
    : 'btn-default';

  const handleClick = () => {
    if (disabled) return;
    if (requiresConfirm && !confirming) {
      setPendingAction(actionId);
      return;
    }
    setPendingAction(null);
    onRun();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`btn h-[var(--ctl-h)] w-full px-4 text-[12px] font-semibold tracking-wider leading-tight ${className} ${
        confirming ? 'ring-2 ring-white/90' : ''
      }`}
      style={{ minHeight: 0 }}
      aria-label={disabled ? `${label} unavailable: ${disabledLabel}` : confirming ? `Confirm ${label}` : label}
      title={disabled ? `${label}: ${disabledLabel}` : requiresConfirm ? `${label}: tap once, then tap again to confirm` : label}
    >
      {disabled ? (
        <span className="flex flex-col items-center leading-tight">
          <span>{label.toUpperCase()}</span>
          <span className="mt-1 text-[9px] text-muted tracking-[0.12em]">{disabledLabel.toUpperCase()}</span>
        </span>
      ) : confirming ? 'TAP AGAIN' : label.toUpperCase()}
    </button>
  );
}
