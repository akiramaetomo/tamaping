// Shared Chromium DevTools-protocol helpers for the browser tools
// (`smoke-browser.mjs`, `bench-browser.mjs`). No dependencies beyond Node.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TIMEOUT_MS = 20000;

export function findBrowser() {
  const candidates = [
    process.env.SMOKE_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(label, probe, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await sleep(100);
  }
}

// `headless: false` opens a real window, so the GPU and frame pacing match
// what a person sees (used by the bench tool).
export async function launchBrowser(executable, { headless = true, args = [] } = {}) {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'dotping-smoke-'));
  const child = spawn(executable, [
    ...(headless ? ['--headless=new'] : []),
    ...args,
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    'about:blank',
  ], { stdio: 'ignore' });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const port = await waitFor('DevToolsActivePort', async () => {
    if (!existsSync(portFile)) {
      return null;
    }
    const [firstLine] = (await readFile(portFile, 'utf8')).split('\n');
    return Number(firstLine) || null;
  });

  const close = async () => {
    child.kill();
    await sleep(300);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  };
  return { port, close };
}

// Attaches to the first page target, or to the first one `match` accepts.
export async function connectPage(port, match = () => true) {
  const targets = await waitFor('page target', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
    const list = response ? await response.json() : [];
    return list.find((target) => target.type === 'page' && match(target)) ?? null;
  });

  const socket = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        resolve(message.result);
      }
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) {
      listener(message.params);
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, listener) => {
    listeners.set(method, [...(listeners.get(method) ?? []), listener]);
  };
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  };

  return { send, on, evaluate, close: () => socket.close() };
}
