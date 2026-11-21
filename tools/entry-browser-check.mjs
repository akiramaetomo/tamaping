// Measures the way into `Physical collision` in a real browser (spec `Safe
// Entry Into Physical Collision`): bench B (`Independent overlap`, Gravity
// toward the Ball) gathers a crowd, the model is switched, and frame times
// plus the overlay's `physical_entry` / `resting_dots` lines are recorded.
//
//   npm run build
//   node tools/entry-browser-check.mjs [--count 5000] [--gravity max|keep]
//                                      [--size 8] [--gather 10] [--watch 15]
//                                      [--query entry=held]
//
// Opens a headed Edge or Chrome window on the PC (set SMOKE_BROWSER to
// choose), serving `dist/` with `vite preview`. `--gravity max` sets Gravity
// strength to the top of the slider (100); `keep` keeps bench B's 3.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { connectPage, findBrowser, launchBrowser, sleep } from './cdpBrowser.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4189;

function parseArgs(argv) {
  const options = { count: 5000, gravity: 'keep', size: 0, gather: 10, watch: 15, query: '' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '');
    const value = argv[index + 1];
    options[key] = key === 'gravity' || key === 'query' ? value.replace(/^[?&]/, '') : Number(value);
  }
  return options;
}

// Sets the first control whose label text matches, the way a user would.
const setControl = (label, value, event) => `(() => {
  const wrap = [...document.querySelectorAll('label')]
    .find((node) => node.querySelector('span')?.textContent?.trim() === ${JSON.stringify(label)});
  const input = wrap?.querySelector('select, input');
  if (!input) return false;
  input.value = ${JSON.stringify(String(value))} === 'max' ? input.max : ${JSON.stringify(String(value))};
  input.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  return input.value;
})()`;

const START_RECORDER = `(() => {
  window.__entry = { frames: [], samples: [], start: performance.now() };
  let last = performance.now();
  const tick = (now) => {
    window.__entry.frames.push([now - window.__entry.start, now - last]);
    last = now;
    if (window.__entry) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__entryTimer = setInterval(() => {
    const text = document.querySelector('.debug')?.textContent ?? '';
    const pick = (name) => text.match(new RegExp(name + '=([^\\\\s]+)'))?.[1] ?? '-';
    window.__entry.samples.push([
      ((performance.now() - window.__entry.start) / 1000).toFixed(1),
      pick('physical_entry'), pick('resting_dots'), pick('dots'), pick('overlap_engine'),
      pick('physical_entry_mode'),
    ].join(' '));
  }, 500);
  return true;
})()`;

const READ_RECORDER = `(() => { clearInterval(window.__entryTimer); return window.__entry; })()`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(workspaceRoot, 'dist', 'index.html'))) {
    console.error('dist/ is missing. Run `npm run build` first.');
    process.exit(2);
  }
  const executable = findBrowser();
  const server = await preview({
    root: workspaceRoot,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: PORT, strictPort: true, open: false },
  });
  const browser = await launchBrowser(executable, {
    headless: false,
    args: [
      '--window-size=1280,860',
      '--window-position=0,0',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await connectPage(browser.port);
  try {
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?${options.query ? `${options.query}&` : ''}dbg=perf&bench=B` });
    await sleep(3000);
    console.log('count', await page.evaluate(setControl('Count', options.count, 'change')));
    if (options.size > 0) {
      console.log('size', await page.evaluate(setControl('Size', options.size, 'input')));
    }
    if (options.gravity === 'max') {
      console.log('gravity', await page.evaluate(setControl('Gravity strength', 'max', 'input')));
    }
    await sleep(options.gather * 1000);
    await page.evaluate(START_RECORDER);
    await sleep(300);
    console.log('model', await page.evaluate(setControl('Particle Model', 'collision-physical', 'change')));
    await sleep(options.watch * 1000);
    const result = await page.evaluate(READ_RECORDER);

    const frames = result.frames;
    const longest = frames.reduce((worst, frame) => Math.max(worst, frame[1]), 0);
    console.log(`frames=${frames.length} longest_ms=${longest.toFixed(0)}`
      + ` over_100ms=${frames.filter((frame) => frame[1] > 100).length}`
      + ` over_250ms=${frames.filter((frame) => frame[1] > 250).length}`);
    // Frames per second, per second of the watch.
    const perSecond = [];
    for (const [at] of frames) {
      const second = Math.floor(at / 1000);
      perSecond[second] = (perSecond[second] ?? 0) + 1;
    }
    console.log(`fps_by_second=${Array.from(perSecond, (value) => value ?? 0).join(',')}`);
    console.log('t_s entry resting dots engine mode');
    for (const sample of result.samples) {
      console.log(sample);
    }
  } finally {
    page.close();
    await browser.close();
    await server.close();
  }
  process.exit(0);
}

await main();
