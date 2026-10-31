// Runs the `?dbg=perf` bench scenes in a real browser and records the
// overlay text (`npm run bench`, see docs/testing-guide.md).
//
//   node tools/bench-browser.mjs [--target pc|android] [--benches A,B,C,D]
//                                [--settle 14] [--query cl=single] [--out file]
//
// pc:      opens a headed Edge or Chrome window, so the real GPU and frame
//          pacing are measured (set SMOKE_BROWSER to choose the browser).
// android: drives Chrome on a USB-debugging phone through adb. The phone must
//          be authorized (`adb devices` shows `device`), with the screen on
//          and Chrome in the foreground. Set ADB to choose the adb executable.
//
// Serves the existing `dist/` with `vite preview`; `npm run bench` builds
// first. Nobody needs to touch the screen during a run.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { connectPage, findBrowser, launchBrowser, sleep, waitFor } from './cdpBrowser.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_PORT = 4188;
const ANDROID_CDP_PORT = 9333;
const PC_WINDOW_ARGS = [
  '--window-size=1280,860',
  '--window-position=0,0',
  // Keep rAF running at full rate even when the window is not focused.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

function parseArgs(argv) {
  const options = { target: 'pc', benches: ['A', 'B', 'C', 'D'], settle: 14, query: '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    switch (argv[index]) {
      case '--target':
        options.target = value;
        index += 1;
        break;
      case '--benches':
        options.benches = value.split(',').map((id) => id.trim().toUpperCase()).filter(Boolean);
        index += 1;
        break;
      case '--settle':
        options.settle = Number(value);
        index += 1;
        break;
      case '--query':
        options.query = value.replace(/^[?&]/, '');
        index += 1;
        break;
      case '--out':
        options.out = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option ${argv[index]}`);
    }
  }
  if (options.target !== 'pc' && options.target !== 'android') {
    throw new Error('--target must be pc or android');
  }
  return options;
}

function findAdb() {
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? 'adb';
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

function benchUrl(baseUrl, id, query) {
  return `${baseUrl}?${query ? `${query}&` : ''}dbg=perf&bench=${id}`;
}

const GPU_PROBE = `(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'n/a';
})()`;

// Resolves once a perf window that ends after the settle time is shown.
function settledProbe(settleSeconds) {
  return `(() => {
    const text = document.querySelector('.debug')?.textContent ?? '';
    const elapsed = text.match(/bench_elapsed_s=([0-9.]+)/);
    return elapsed && Number(elapsed[1]) >= ${settleSeconds} && text.includes('perf_frames=') ? text : null;
  })()`;
}

async function runBenches(page, baseUrl, options, navigate) {
  const sections = [];
  for (const id of options.benches) {
    await navigate(benchUrl(baseUrl, id, options.query));
    const text = await waitFor(`bench ${id}`, () => page.evaluate(settledProbe(options.settle)),
      (options.settle + 40) * 1000);
    console.log(`----- bench ${id}\n${text}`);
    sections.push(`----- bench ${id}\n${text}`);
    await sleep(500);
  }
  return sections;
}

async function runPc(baseUrl, options) {
  const executable = findBrowser();
  if (!executable) {
    throw new Error('No Edge or Chrome found. Set SMOKE_BROWSER to a Chromium-based browser executable.');
  }
  const browser = await launchBrowser(executable, { headless: false, args: PC_WINDOW_ARGS });
  const page = await connectPage(browser.port);
  try {
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: baseUrl });
    await sleep(1500);
    const gpu = await page.evaluate(GPU_PROBE);
    const sections = await runBenches(page, baseUrl, options, (url) => page.send('Page.navigate', { url }));
    return { device: `pc ${path.basename(executable)}`, gpu, sections };
  } finally {
    page.close();
    await browser.close();
  }
}

async function runAndroid(baseUrl, options) {
  const adb = findAdb();
  const run = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
  const devices = run('devices');
  if (!/\tdevice\b/.test(devices)) {
    throw new Error(`No authorized Android device.\n${devices}\nAllow USB debugging on the phone.`);
  }

  const model = run('shell', 'getprop', 'ro.product.model');
  run('reverse', `tcp:${PREVIEW_PORT}`, `tcp:${PREVIEW_PORT}`);
  run('forward', `tcp:${ANDROID_CDP_PORT}`, 'localabstract:chrome_devtools_remote');
  let page = null;
  try {
    // Android Chrome refuses /json/new, so open the tab with an intent and
    // attach to it. The user's other tabs are never touched.
    // A tab left from an earlier run sits in the background with rAF paused,
    // so attach only to the tab this intent opens.
    const before = new Set((await listTargets(ANDROID_CDP_PORT)).map((target) => target.id));
    const startUrl = `${baseUrl}?dbg=perf`;
    run('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', startUrl, 'com.android.chrome');
    await waitFor('new Chrome tab', async () => (await listTargets(ANDROID_CDP_PORT))
      .some((target) => target.type === 'page' && !before.has(target.id)));
    page = await connectPage(ANDROID_CDP_PORT, (target) => !before.has(target.id));
    await page.send('Page.enable');
    await page.send('Page.bringToFront');
    await sleep(1500);
    const gpu = await page.evaluate(GPU_PROBE);
    const sections = await runBenches(page, baseUrl, options, (url) => page.send('Page.navigate', { url }));
    return { device: `android ${model}`, gpu, sections };
  } finally {
    // Close the measurement tab so runs do not pile up tabs on the phone.
    await Promise.race([page?.send('Page.close'), sleep(2000)]).catch(() => {});
    page?.close();
    run('reverse', '--remove', `tcp:${PREVIEW_PORT}`);
    run('forward', '--remove', `tcp:${ANDROID_CDP_PORT}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(workspaceRoot, 'dist', 'index.html'))) {
    console.error('dist/ is missing. Run `npm run build` first (or use `npm run bench`).');
    process.exit(2);
  }

  const server = await preview({
    root: workspaceRoot,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: PREVIEW_PORT, strictPort: true, open: false },
  });
  const baseUrl = `http://127.0.0.1:${PREVIEW_PORT}/`;
  try {
    const result = options.target === 'android'
      ? await runAndroid(baseUrl, options)
      : await runPc(baseUrl, options);
    const header = [
      `date=${new Date().toISOString()}`,
      `device=${result.device}`,
      `gpu=${result.gpu}`,
      `query=${options.query || 'none'}`,
      `settle_s=${options.settle}`,
    ];
    console.log(header.join('\n'));
    if (options.out) {
      const outPath = path.resolve(options.out);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, `${[...header, ...result.sections].join('\n')}\n`, 'utf8');
      console.log(`Saved ${outPath}`);
    }
  } finally {
    await server.close();
  }
  process.exit(0);
}

await main();
