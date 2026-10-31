// On-demand browser smoke check for the built app (`npm run smoke`).
//
// Serves `dist/` with `vite preview`, drives an installed Edge or Chrome in
// headless mode over the DevTools protocol, and checks that the app loads,
// draws, opens Settings, browses presets, and keeps its layout at desktop and
// phone widths. No extra dependencies or browser downloads: set
// SMOKE_BROWSER to a Chromium-based browser executable to override the search.
//
// Not covered: sound, touch feel, sensors, and anything that needs a human ear
// or eye. Keep the hands-on checks in docs/testing-guide.md for those.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { preview } from 'vite';
import { connectPage, findBrowser, launchBrowser, sleep, waitFor } from './cdpBrowser.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 360, height: 800, deviceScaleFactor: 2, mobile: true };

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// Minimal PNG reader for 8-bit RGB/RGBA screenshots.
function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
        throw new Error(`Unsupported PNG format (depth ${bitDepth}, color ${colorType})`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += up;
      } else if (filter === 3) {
        value += (left + up) >> 1;
      } else if (filter === 4) {
        const estimate = left + up - upLeft;
        const distLeft = Math.abs(estimate - left);
        const distUp = Math.abs(estimate - up);
        const distUpLeft = Math.abs(estimate - upLeft);
        value += distLeft <= distUp && distLeft <= distUpLeft ? left : distUp <= distUpLeft ? up : upLeft;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

// Counts pixels that clearly differ from the most common (background) colour.
function countForegroundPixels({ width, height, channels, pixels }) {
  const pixelCount = width * height;
  const histogram = new Map();
  for (let index = 0; index < pixelCount; index += 1) {
    const base = index * channels;
    const key = (pixels[base] << 16) | (pixels[base + 1] << 8) | pixels[base + 2];
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const [backgroundKey] = [...histogram.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const background = [(backgroundKey >> 16) & 0xff, (backgroundKey >> 8) & 0xff, backgroundKey & 0xff];

  let count = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const base = index * channels;
    const diff = Math.abs(pixels[base] - background[0])
      + Math.abs(pixels[base + 1] - background[1])
      + Math.abs(pixels[base + 2] - background[2]);
    if (diff > 48) {
      count += 1;
    }
  }
  return { count, total: pixelCount };
}

const LAYOUT_PROBE = `(() => {
  const rect = (selector) => {
    const element = document.querySelector(selector);
    if (!element || element.hidden) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const canvas = document.querySelector('canvas');
  return {
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    canvas: canvas ? { width: canvas.width, height: canvas.height, css: rect('canvas') } : null,
    bar: rect('.front-preset-bar'),
    gear: rect('.settings-button'),
    scale: rect('.view-scale-button'),
    scaleText: document.querySelector('.view-scale-button')?.textContent ?? '',
  };
})()`;

function overlaps(a, b) {
  return Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
}

// Clicks the element's centre with real mouse events once the element is what
// a user would hit there: inside the viewport, settled after any transition,
// and not covered by another layer.
async function click(page, selector) {
  const probe = () => page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { error: 'missing' };
    const r = element.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) {
      return { error: 'covered by ' + (hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'), x, y };
    }
    return { x, y };
  })()`);
  let target = await probe();
  const deadline = Date.now() + 3000;
  for (;;) {
    await sleep(100);
    const next = await probe();
    const settled = !next.error && !target.error && next.x === target.x && next.y === target.y;
    target = next;
    if (settled || Date.now() > deadline) {
      break;
    }
  }
  if (target.error) {
    throw new Error(`Cannot click ${selector}: ${target.error}`);
  }
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left', clickCount: 1 });
  }
}

async function loadApp(page, url, viewport) {
  await page.send('Emulation.setDeviceMetricsOverride', viewport);
  await page.send('Page.navigate', { url });
  await waitFor('app canvas and front bar', () => page.evaluate(
    `Boolean(document.querySelector('canvas') && document.querySelector('.front-preset-bar') && document.querySelector('.settings-button'))`,
  ));
  // Let a few frames render before measuring.
  await sleep(800);
}

function checkLayout(label, layout) {
  check(`${label}: no horizontal page scroll`, layout.scrollWidth <= layout.innerWidth,
    `scrollWidth ${layout.scrollWidth}, innerWidth ${layout.innerWidth}`);
  check(`${label}: canvas fills the viewport width`,
    Boolean(layout.canvas?.css && Math.abs(layout.canvas.css.width - layout.innerWidth) <= 1),
    layout.canvas?.css ? `css width ${Math.round(layout.canvas.css.width)}` : 'no canvas');
  check(`${label}: front bar, scale button and gear do not overlap`,
    Boolean(layout.bar && layout.gear && layout.scale)
      && !overlaps(layout.bar, layout.gear)
      && !overlaps(layout.bar, layout.scale)
      && !overlaps(layout.scale, layout.gear));
}

async function runDesktop(page, url) {
  await loadApp(page, url, DESKTOP);

  check('desktop: page title', (await page.evaluate('document.title')).length > 0);
  const layout = await page.evaluate(LAYOUT_PROBE);
  check('desktop: canvas present', Boolean(layout.canvas && layout.canvas.width > 0 && layout.canvas.height > 0),
    layout.canvas ? `${layout.canvas.width}x${layout.canvas.height}` : 'missing');
  checkLayout('desktop', layout);

  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  const foreground = countForegroundPixels(decodePng(Buffer.from(shot.data, 'base64')));
  check('desktop: canvas is not blank', foreground.count > 200,
    `${foreground.count} of ${foreground.total} pixels differ from the background`);

  const openState = `document.getElementById('settings-panel')?.classList.contains('hud--open') ?? null`;
  check('desktop: Settings starts closed', (await page.evaluate(openState)) === false);
  await click(page, '.settings-button');
  check('desktop: gear opens Settings', (await page.evaluate(openState)) === true);
  await click(page, '.hud__close');
  check('desktop: close button closes Settings', (await page.evaluate(openState)) === false);

  const presetState = `({
    bar: document.querySelector('.front-preset-bar__select')?.value ?? null,
    settings: document.querySelector('.hud__preset-select')?.value ?? null,
  })`;
  const before = await page.evaluate(presetState);
  await click(page, '.front-preset-bar__step[aria-label="Next preset"]');
  const after = await page.evaluate(presetState);
  check('desktop: next preset applies a factory preset',
    after.bar !== before.bar && String(after.bar).startsWith('factory:'), `${before.bar} -> ${after.bar}`);
  check('desktop: Settings preset select follows the bar', after.settings === after.bar, `${after.settings}`);

  // Functional check of the name formation path; the button sits in a card
  // that may be hidden by the active tab, so it is clicked from script.
  const nameStatus = await page.evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Arrange particles into the current preset name"]');
    if (!button) return 'missing';
    button.click();
    return document.querySelector('.hud__preset-status')?.textContent ?? '';
  })()`);
  check('desktop: Name forms the preset name', nameStatus === 'Name formed', nameStatus);

  await page.send('Emulation.setDeviceMetricsOverride', PHONE);
  await sleep(600);
  const resized = await page.evaluate(LAYOUT_PROBE);
  check('resize to phone width: canvas follows', Boolean(resized.canvas?.css && Math.abs(resized.canvas.css.width - PHONE.width) <= 1),
    resized.canvas?.css ? `css width ${Math.round(resized.canvas.css.width)}` : 'no canvas');
  check('resize to phone width: scale label updates', resized.scaleText !== layout.scaleText,
    `${layout.scaleText} -> ${resized.scaleText}`);
}

async function runPhone(page, url) {
  await loadApp(page, url, PHONE);
  const layout = await page.evaluate(LAYOUT_PROBE);
  checkLayout('phone 360px', layout);

  await click(page, '.settings-button');
  const panel = await page.evaluate(`(() => {
    const r = document.getElementById('settings-panel')?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, open: document.getElementById('settings-panel').classList.contains('hud--open') } : null;
  })()`);
  check('phone 360px: Settings opens inside the screen',
    Boolean(panel?.open && panel.left >= -1 && panel.right <= PHONE.width + 1),
    panel ? `left ${Math.round(panel.left)}, right ${Math.round(panel.right)}` : 'missing');
  const scroll = await page.evaluate('document.documentElement.scrollWidth');
  check('phone 360px: no horizontal scroll with Settings open', scroll <= PHONE.width, `scrollWidth ${scroll}`);
}

async function main() {
  const distIndex = path.join(workspaceRoot, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    console.error('dist/ is missing. Run `npm run build` first (or use `npm run smoke`).');
    process.exit(2);
  }
  const executable = findBrowser();
  if (!executable) {
    console.error('No Edge or Chrome found. Set SMOKE_BROWSER to a Chromium-based browser executable.');
    process.exit(2);
  }

  const server = await preview({
    root: workspaceRoot,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: 4179, strictPort: false, open: false },
  });
  const url = server.resolvedUrls?.local?.[0];
  console.log(`Serving ${url} with ${path.basename(executable)}`);

  const browser = await launchBrowser(executable);
  let page = null;
  const pageErrors = [];
  try {
    page = await connectPage(browser.port);
    page.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text);
    });
    page.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        pageErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
      }
    });
    await page.send('Runtime.enable');
    await page.send('Page.enable');

    await runDesktop(page, url);
    await runPhone(page, url);

    await loadApp(page, `${url}?debug=1`, DESKTOP);
    const debugText = await page.evaluate(`document.querySelector('.debug')?.textContent ?? ''`);
    check('?debug=1: debug overlay shows diagnostics', debugText.split('\n').length > 3,
      debugText.split('\n')[0]);

    const benchGroupProbe = `[...document.querySelectorAll('optgroup')].some((group) => group.label === 'Perf Bench')`;
    check('?debug=1: no Perf Bench presets outside the perf profile', (await page.evaluate(benchGroupProbe)) === false);

    await loadApp(page, `${url}?dbg=perf&bench=B`, DESKTOP);
    const perfText = await waitFor('perf profile window', () => page.evaluate(`(() => {
      const text = document.querySelector('.debug')?.textContent ?? '';
      return text.includes('perf_frames=') ? text : null;
    })()`), 8000).catch(() => '');
    check('?dbg=perf: perf profile reports phase timings',
      perfText.includes('world_step_ms=') && perfText.includes('pixi_render_ms='),
      perfText.split('\n').find((line) => line.startsWith('fps=')) ?? 'no window summary');
    check('?dbg=perf&bench=B: bench B starts at 1000 dots',
      perfText.includes('\nbench=B\n') && perfText.includes('\ndots=1000\n'),
      perfText.split('\n').find((line) => line.startsWith('bench=')) ?? 'no bench line');
    check('?dbg=perf: Perf Bench presets are offered', (await page.evaluate(benchGroupProbe)) === true);
    check('no page exceptions or console errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (error) {
    check('smoke run completed', false, error instanceof Error ? error.message : String(error));
  } finally {
    page?.close();
    await browser.close();
    await server.close();
  }

  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
