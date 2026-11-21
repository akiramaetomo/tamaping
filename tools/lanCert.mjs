// A self-signed certificate for serving the app over https on the LAN
// (`npm run dev:lan`, `npm run preview:lan`). iPad WebKit runs a plain-http
// page about 15 times slower (troubleshooting: `On iPad, the app is many
// times slower over plain http on the LAN`), so device checks use https.
//
// The key and certificate live in `apps/web/.cert/` (ignored by Git) and are
// made with OpenSSL (Git for Windows ships one). They are made again when
// the machine's LAN addresses change or the certificate is close to expiry.
// Each device shows a certificate warning once.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const VALID_DAYS = 365;
const RENEW_BEFORE_DAYS = 14;

export function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses.sort();
}

function opensslCandidates() {
  const candidates = ['openssl'];
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (root) {
      candidates.push(path.join(root, 'Git', 'usr', 'bin', 'openssl.exe'), path.join(root, 'Git', 'mingw64', 'bin', 'openssl.exe'));
    }
  }
  return candidates;
}

function runOpenssl(args) {
  for (const command of opensslCandidates()) {
    try {
      execFileSync(command, args, { stdio: 'ignore' });
      return true;
    } catch {
      // Try the next location.
    }
  }
  return false;
}

// Returns { key, cert, addresses } for Vite's `https` option, or null when no
// certificate could be made (the caller then serves plain http and warns).
export function ensureLanCert(dir) {
  const keyPath = path.join(dir, 'lan-key.pem');
  const certPath = path.join(dir, 'lan-cert.pem');
  const infoPath = path.join(dir, 'lan-cert.json');
  const addresses = lanAddresses();
  const wanted = JSON.stringify(addresses);
  let info = null;
  try {
    info = JSON.parse(readFileSync(infoPath, 'utf8'));
  } catch {
    info = null;
  }
  const fresh = info
    && JSON.stringify(info.addresses) === wanted
    && Date.now() < info.expiresAt - RENEW_BEFORE_DAYS * 86_400_000
    && existsSync(keyPath)
    && existsSync(certPath);
  if (!fresh) {
    mkdirSync(dir, { recursive: true });
    const names = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((address) => `IP:${address}`)];
    const made = runOpenssl([
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', String(VALID_DAYS),
      '-keyout', keyPath, '-out', certPath,
      '-subj', '/CN=dotping LAN dev',
      '-addext', `subjectAltName=${names.join(',')}`,
    ]);
    if (!made) {
      return null;
    }
    writeFileSync(infoPath, JSON.stringify({ addresses, expiresAt: Date.now() + VALID_DAYS * 86_400_000 }, null, 2));
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath), addresses };
}
