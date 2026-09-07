import React, { useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import Lighting from './tabs/Lighting.jsx';
import Control from './tabs/Control.jsx';
import Status from './tabs/Status.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';

export default function App() {
  const [tab, setTab] = useState('lighting');
  const { state, tick, wsConnected, send } = useWebSocket();

  if (!state) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-bg text-muted">
        <div className="text-[18px] ellipsis tracking-wider">CONNECTING TO PANEL SERVER</div>
      </div>
    );
  }

  const panelReconnecting = !wsConnected && !!state;
  const visibleTab = tab === 'control' ? 'lighting' : tab;

  return (
    <div className="w-screen h-screen flex bg-bg overflow-hidden">
      <Sidebar active={visibleTab} onChange={setTab} state={state} send={send} />
      <main className="flex-1 h-full flex flex-col min-h-0 overflow-hidden">
        {panelReconnecting && (
          <OfflineBanner visible title="PANEL SERVER OFFLINE" subtitle="Reconnecting" />
        )}

        <div className="flex-1 min-h-0 overflow-hidden p-[var(--page-pad)]">
          {visibleTab === 'lighting' && <Lighting state={state} send={send} />}
          {visibleTab === 'control'  && <Control  state={state} send={send} />}
          {visibleTab === 'status'   && <Status   state={state} tick={tick} wsConnected={wsConnected} send={send} />}
        </div>
      </main>
    </div>
  );
}
