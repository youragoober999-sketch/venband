// A stable, anonymous id for this computer, used only for Voogle's alt
// detection and hardware bans. The operating system's machine id is hashed
// with a Venband-only label before it leaves this file, so the raw id never
// reaches the website (and the database hashes it again with a secret).
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const LABEL = 'venband-hw-v1|';

function hashMachineId(raw) {
  const id = String(raw || '').trim().toLowerCase();
  if (id.length < 8) return null;
  return crypto.createHash('sha256').update(LABEL + id).digest('hex');
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** The OS machine id: MachineGuid (Windows), IOPlatformUUID (macOS), /etc/machine-id (Linux). */
async function rawMachineId(platform = process.platform) {
  if (platform === 'win32') {
    const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
    return /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{20,})/.exec(out)?.[1] ?? null;
  }
  if (platform === 'darwin') {
    const out = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    return /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{20,})"/.exec(out)?.[1] ?? null;
  }
  for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      if (v) return v;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

let cached;
function hardwareId() {
  if (!cached) cached = rawMachineId().then(hashMachineId).catch(() => null);
  return cached;
}

module.exports = { hardwareId, hashMachineId, rawMachineId };
