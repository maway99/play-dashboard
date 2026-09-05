import React, { useState, useEffect } from 'react';

const TABS = [
  { id: 'lighting', label: 'Lighting' },
];

export default function Sidebar({ active, onChange, state }) {
  const ma2Connected = state?.ma2 === 'connected';
  const link = state?.link;
  const linkTone = !link || !link.enabled ? 'idle' : link.carabiner !== 'connected' ? 'idle' : link.peers > 0 ? 'ok' : 'idle';
  const linkText = !link ? '' : !link.enabled ? 'Off' : link.carabiner !== 'connected' ? 'No bridge' : link.peers > 0 ? `${link.bpm} BPM` : 'No peers';

  return (
    <aside className="w-[150px] h-full flex flex-col bg-bg border-r border-border/40 px-4 py-5">
      <div className="mb-6 flex justify-center">
        <div className="w-[110px] h-[70px] flex items-center justify-center overflow-hidden select-none">
          <img
            src="/play-logo.png"
            alt="Play Gloucester Room One"
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        </div>
      </div>

      <nav className="flex flex-col gap-2 flex-1">
        {TABS.map(t => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`relative h-[var(--ctl-h)] px-3 rounded-ui text-left text-[15px] font-medium transition-colors ${
                isActive
                  ? 'bg-white text-black'
                  : 'bg-btn text-white border border-border/70 hover:border-white/20'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-6 space-y-2 text-[13px]">
        <StatusRow label="MA2" tone={ma2Connected ? 'ok' : 'bad'} text={ma2Connected ? 'Online' : 'Offline'} pulse={!ma2Connected} active={active === 'status'} onClick={() => onChange(active === 'status' ? 'lighting' : 'status')} />
        {link && (
          <StatusRow label="Link" tone={linkTone} text={linkText} active={active === 'status'} onClick={() => onChange(active === 'status' ? 'lighting' : 'status')} />
        )}
      </div>

      <Clock />
    </aside>
  );
}

function Clock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setTime(new Date());
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');
  const ss = String(time.getSeconds()).padStart(2, '0');

  return (
    <div className="mt-4 text-center tabular-nums text-white select-none">
      <span className="text-[26px] font-semibold">{hh}:{mm}</span>
      <span className="text-[15px] text-muted ml-1">{ss}</span>
    </div>
  );
}

function StatusRow({ label, tone = 'idle', text, pulse, active, onClick }) {
  const dot = tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : 'bg-white/25';
  const textColour = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-muted';
  return (
    <button
      onClick={onClick}
      title="Open connection status"
      className={`flex items-center gap-2.5 w-full h-[var(--ctl-h)] px-3 rounded-ui border text-left transition-colors ${
        active ? 'bg-white/10 border-white/30' : 'bg-btn border-border/60 hover:border-white/20'
      }`}
    >
      <span className={`status-dot flex-none ${dot} ${pulse ? 'pulse-red' : ''}`} />
      <span className="flex flex-col min-w-0 leading-tight">
        <span className="text-[13px] text-white/85 font-medium truncate">{label}</span>
        <span className={`text-[11px] tabular-nums truncate ${textColour}`}>{text}</span>
      </span>
    </button>
  );
}
