import WebSocket from 'ws';

export async function withCompanionApi(baseUrl, run) {
  const url = new URL('/trpc', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }
  ws.on('error', rejectPending);
  ws.on('close', () => rejectPending(new Error('Companion connection closed')));
  ws.on('message', raw => {
    const messages = JSON.parse(raw);
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      const request = pending.get(message.id);
      if (!request || (!message.error && message.result?.type !== 'data')) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (request.subscription) ws.send(JSON.stringify({ id: message.id, method: 'subscription.stop' }));
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result.data);
    }
  });
  function rpc(method, rpcPath, input = null) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Companion API timeout: ${rpcPath}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer, subscription: method === 'subscription' });
      ws.send(JSON.stringify({ id, method, params: { path: rpcPath, input } }));
    });
  }
  async function mutation(rpcPath, input) {
    const result = await rpc('mutation', rpcPath, input);
    if (result === false) throw new Error(`Companion rejected ${rpcPath}`);
    return result;
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Companion WebSocket connection timeout')), 10000);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', error => { clearTimeout(timer); reject(error); });
    });
    return await run({ rpc, mutation });
  } finally {
    rejectPending(new Error('Companion session finished'));
    ws.close();
  }
}
