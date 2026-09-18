import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Windows setup permits Link discovery and dynamic UDP only for Carabiner on the lighting LAN', () => {
  const setup = fs.readFileSync(new URL('../setup.bat', import.meta.url), 'utf8');
  const rule = setup.split(/\r?\n/).find(line => line.startsWith('netsh advfirewall firewall add rule name="Play Gloucester Ableton Link"'));
  assert.ok(rule);
  for (const fragment of ['dir=in', 'action=allow', 'program="%ROOT%\\tools\\Carabiner.exe"',
    'protocol=UDP', 'localport=any', 'remoteip=2.0.0.0/8', 'interfacetype=lan', 'profile=any', 'enable=yes']) {
    assert.ok(rule.includes(fragment), `Missing firewall restriction: ${fragment}`);
  }
  assert.doesNotMatch(setup, /advfirewall\s+set\s+\S+\s+state\s+off/i);
});

test('Carabiner control stays on localhost while Link uses the external network', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
  assert.equal(config.link.carabiner.host, '127.0.0.1');
  assert.equal(config.link.carabiner.port, 17000);
  assert.equal(config.link.enabled, true);
});
