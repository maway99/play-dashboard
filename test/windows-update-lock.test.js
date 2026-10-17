import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../scripts/disable-windows-update.ps1', import.meta.url), 'utf8');
const setup = fs.readFileSync(new URL('../setup.bat', import.meta.url), 'utf8');
const verifier = fs.readFileSync(new URL('../scripts/verify-install.ps1', import.meta.url), 'utf8');

test('venue install applies a durable but auditable Windows Update lock', () => {
  for (const policy of [
    'DisableWindowsUpdateAccess', 'DoNotConnectToWindowsUpdateInternetLocations',
    'SetDisableUXWUAccess', 'NoAutoUpdate'
  ]) assert.match(script, new RegExp(policy));
  assert.match(script, /Stop-Service\s+\$name\s+-Force/i);
  assert.match(script, /sc\.exe\s+config\s+\$name\s+start=\s+disabled/i);
  assert.match(script, /New-ScheduledTaskTrigger\s+-AtStartup/i);
  assert.match(script, /New-ScheduledTaskTrigger\s+-Daily/i);
  assert.match(script, /windows-update-before-lock\.json/i);
  assert.doesNotMatch(script, /serviceNames\s*=.*BITS/i,
    'BITS is shared infrastructure and must not be disabled by the venue update lock');
  assert.match(setup, /disable-windows-update\.ps1"\s+-Install/i);
  assert.match(verifier, /disable-windows-update\.ps1'\)\s+-VerifyOnly/i);
});
