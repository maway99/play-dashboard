import React, { useState, useEffect } from 'react';

/**
 * Confetti / CO2 arm-and-fire panel plus global lamp power.
 * Stream Deck endpoints can trigger the same mapped effects separately.
 */
export default function SpecialEffectsControls({ config, maintenance, state = {}, send }) {
  const [pendingLampOff, setPendingLampOff] = useState(false);

  useEffect(() => {
    if (!pendingLampOff) return undefined;
    const timeout = setTimeout(() => setPendingLampOff(false), 2500);
    return () => clearTimeout(timeout);
  }, [pendingLampOff]);

  if (!config?.groups?.length) return null;

  const cueStackConfigured =
    !!config.configured &&
    Number.isFinite(config.cueStack?.page) &&
    Number.isFinite(config.cueStack?.exec);

  const hasCue = (group, action) =>
    cueStackConfigured && Number.isFinite(group.actions?.find((item) => item.id === action.id)?.cue);

  const maintenanceConfigured =
    !!maintenance?.configured &&
    Number.isFinite(maintenance.cueStack?.page) &&
    Number.isFinite(maintenance.cueStack?.exec);
  const hasMaintenanceCue = (actionId) =>
    maintenanceConfigured && Number.isFinite(maintenance.globalActions?.[actionId]?.cue);
  const lampOnMapped = hasMaintenanceCue('lampOn');
  const lampOffMapped = hasMaintenanceCue('lampOff');
  const triggerGlobalLamp = (action) => {
    if (action === 'lampOn' && lampOnMapped) {
      send({ type: 'maintenance', scope: 'global', action: 'lampOn' });
      return;
    }
    if (action !== 'lampOff' || !lampOffMapped) return;
    if (!pendingLampOff) {
      setPendingLampOff(true);
      return;
    }
    setPendingLampOff(false);
    send({ type: 'maintenance', scope: 'global', action: 'lampOff' });
  };

  return (
    <section className="panel px-4 py-[var(--panel-pad-y)] flex-1 min-h-0 w-full flex flex-col" aria-label="Special effects">
      <div className="flex flex-none items-center justify-between mb-3">
        <div className="text-[14px] text-white font-semibold tracking-[0.06em]">Special effects</div>
        <div className="text-[10px] text-muted tracking-[0.16em]">ARM BEFORE FIRE</div>
      </div>

      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        {config.groups.map((group) => {
          const groupState = state[group.id] ?? {};
          const armed = !!groupState.armed;
          return (
            <div
              key={group.id}
              className={`rounded-ui border p-2.5 flex flex-col min-h-0 overflow-hidden transition-colors ${
                armed
                  ? 'border-amber/70 bg-amber/10'
                  : 'border-border/55 bg-black/20'
              }`}
            >
              <div className="mb-2 flex flex-none items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-3 w-3 rounded-full ${
                      armed ? 'bg-amber shadow-[0_0_0_4px_rgba(224,90,0,0.18)]' : 'bg-white/20'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-[14px] text-white font-semibold">{group.label}</span>
                </div>
                <span className={`text-[10px] font-semibold tracking-[0.16em] ${armed ? 'text-amber' : 'text-muted'}`}>
                  {armed ? 'ARMED' : 'SAFE'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => send({ type: 'specialEffectArm', group: group.id, armed: !armed })}
                aria-pressed={armed ? 'true' : 'false'}
                aria-label={`${armed ? 'Disarm' : 'Arm'} ${group.label}`}
                title={`${armed ? 'Disarm' : 'Arm'} ${group.label}`}
                className={`btn h-[var(--ctl-sm)] flex-none w-full px-3 text-[12px] font-semibold tracking-[0.12em] border-2 ${
                  armed
                    ? 'bg-white text-black border-white'
                    : 'bg-btn text-white border-white/30 hover:border-white/70'
                }`}
                style={{ minHeight: 0 }}
              >
                {armed ? 'DISARM' : group.armLabel.toUpperCase()}
              </button>

              <div
                className="grid grid-cols-1 gap-2 flex-1 mt-2"
                style={{ minHeight: 'var(--fire-min)' }}
              >
                {group.actions.map((action) => {
                  const mapped = hasCue(group, action);
                  const disabled = !armed || !mapped;
                  const disabledLabel = mapped ? 'Arm first' : 'Unconfigured';
                  const fired = !!groupState.fired?.[action.id];
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => send({ type: 'specialEffectFire', group: group.id, action: action.id })}
                      disabled={disabled}
                      aria-label={disabled ? `${group.label} ${action.label} unavailable: ${disabledLabel}` : `${group.label} ${action.label}`}
                      title={disabled ? `${group.label} ${action.label}: ${disabledLabel}` : `${group.label} ${action.label}`}
                      className={`btn h-full min-h-0 px-2 text-[13px] font-semibold tracking-[0.1em] border ${
                        !mapped
                          ? 'bg-btn text-white/40 border-dashed border-border/80 cursor-not-allowed'
                          : disabled
                          ? 'bg-amber/10 text-amber/60 border-amber/25 cursor-not-allowed'
                          : 'bg-amber text-white border-amber hover:brightness-110 shadow-[0_0_18px_rgba(224,90,0,0.35)]'
                      } ${fired ? 'ring-2 ring-white/80' : ''}`}
                    >
                      <span className="flex flex-col items-center justify-center leading-tight">
                        <span>{action.label.toUpperCase()}</span>
                        {disabled && (
                          <span className={`mt-1 text-[9px] font-medium tracking-[0.1em] ${mapped ? 'text-amber/60' : 'text-muted'}`}>
                            {disabledLabel.toUpperCase()}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {group.id === 'confetti' && (
                <button
                  type="button"
                  onClick={() => send({ type: 'specialEffectClear', group: group.id })}
                  aria-label={`Clear ${group.label} arm and fired indicators`}
                  title={`Clear ${group.label} arm and fired indicators`}
                  className="btn h-[var(--ctl-xs)] flex-none mt-2 w-full px-3 text-[11px] font-semibold tracking-[0.14em] bg-transparent text-muted border border-white/15 hover:border-white/35 hover:text-white"
                  style={{ minHeight: 0 }}
                >
                  CLEAR
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex-none border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="section-header">Lamp power</span>
          {!maintenanceConfigured && (
            <span className="text-[9px] text-muted tracking-[0.14em]">UNCONFIGURED</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => triggerGlobalLamp('lampOn')}
            disabled={!lampOnMapped}
            aria-label={lampOnMapped ? 'All lamps on' : 'All lamps on unavailable: unconfigured'}
            title={lampOnMapped ? 'All lamps on' : 'All lamps on: unconfigured'}
            className={`btn h-[var(--ctl-sm)] px-3 text-[12px] font-semibold tracking-[0.1em] border ${
              lampOnMapped
                ? 'btn-default'
                : 'bg-btn text-white/40 border-dashed border-border/80 cursor-not-allowed'
            }`}
            style={{ minHeight: 0 }}
          >
            ALL LAMPS ON
          </button>
          <button
            type="button"
            onClick={() => triggerGlobalLamp('lampOff')}
            disabled={!lampOffMapped}
            aria-label={lampOffMapped ? 'All lamps off' : 'All lamps off unavailable: unconfigured'}
            title={lampOffMapped ? 'All lamps off' : 'All lamps off: unconfigured'}
            className={`btn h-[var(--ctl-sm)] px-3 text-[12px] font-semibold tracking-[0.1em] border ${
              lampOffMapped
                ? pendingLampOff
                  ? 'bg-bad text-white border-bad'
                  : 'bg-transparent text-bad border-bad/50 hover:border-bad'
                : 'bg-btn text-white/40 border-dashed border-border/80 cursor-not-allowed'
            }`}
            style={{ minHeight: 0 }}
          >
            {pendingLampOff ? 'TAP AGAIN' : 'ALL LAMPS OFF'}
          </button>
        </div>
      </div>
    </section>
  );
}
