// Screenshots of the PoC motion effects while the ball is dragged around a
// loop, for checking a look by eye (see docs/testing-guide.md, `Effect
// Screenshots`). Serves `dist/` with `vite preview` and drives an installed
// Edge or Chrome headless over the DevTools protocol.
//
//   npm run build
//   node tools/fx-shots.mjs --out <dir> [--query "fx=afterglow"]
//        [--phone] [--loops 2] [--still 3] [--resize]
//
// Writes, per run: `moving.png` (mid-drag), `released.png` (just after the
// drag), `still.png` (after `--still` seconds without input), and with
// `--resize`, `resized.png` (after switching between desktop and phone
// size). Prints the debug overlay's `fps=` line and any page errors (the
// `afterglow=` buffer line is in the `?dbg=perf` profile).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { connectPage, findBrowser, launchBrowser, sleep, waitFor } from './cdpBrowser.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 360, height: 800, deviceScaleFactor: 2, mobile: true };

const options = parseArgs(process.argv.slice(2));

function parseArgs(args) {
  const result = { out: null, query: 'fx=afterglow', phone: false, loops: 2, still: 3, resize: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--phone') {
      result.phone = true;
    } else if (arg === '--resize') {
      result.resize = true;
    } else if (arg === '--out') {
      result.out = args[++index];
    } else if (arg === '--query') {
      result.query = args[++index];
    } else if (arg === '--loops') {
      result.loops = Number(args[++index]);
    } else if (arg === '--still') {
      result.still = Number(args[++index]);
    }
  }
  if (!result.out) {
    console.error('Usage: node tools/fx-shots.mjs --out <dir> [--query "fx=afterglow"] [--phone]');
    process.exit(2);
  }
  return result;
}

async function shoot(page, file) {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(shot.data, 'base64'));
}

async function main() {
  const executable = findBrowser();
  if (!executable) {
    console.error('No Edge or Chrome found. Set SMOKE_BROWSER to a Chromium-based browser executable.');
    process.exit(2);
  }
  await mkdir(options.out, { recursive: true });
  const server = await preview({
    root: workspaceRoot,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: 4181, strictPort: false, open: false },
  });
  const url = `${server.resolvedUrls?.local?.[0]}?debug=1&${options.query}`;
  const browser = await launchBrowser(executable);
  const errors = [];
  let page = null;
  try {
    page = await connectPage(browser.port);
    page.on('Runtime.exceptionThrown', (params) => {
      errors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text);
    });
    page.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error' || params.type === 'warning') {
        errors.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
      }
    });
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    const viewport = options.phone ? PHONE : DESKTOP;
    await page.send('Emulation.setDeviceMetricsOverride', viewport);
    await page.send('Page.navigate', { url });
    await waitFor('app canvas', () => page.evaluate(`Boolean(document.querySelector('canvas'))`));
    await sleep(1500);

    // A loop around the screen centre, about one turn per second.
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const r = Math.min(viewport.width, viewport.height) * 0.3;
    const steps = Math.round(options.loops * 60);
    const at = (step) => {
      const angle = (step / 60) * Math.PI * 2;
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    };
    const mouse = (type, point, buttons) => page.send('Input.dispatchMouseEvent', {
      type, x: point.x, y: point.y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
    });
    await mouse('mousePressed', at(0), 1);
    for (let step = 1; step <= steps; step += 1) {
      await mouse('mouseMoved', at(step), 1);
      await sleep(16);
      if (step === steps - 15) {
        await shoot(page, path.join(options.out, 'moving.png'));
      }
    }
    await mouse('mouseReleased', at(steps), 0);
    await sleep(100);
    await shoot(page, path.join(options.out, 'released.png'));
    await sleep(options.still * 1000);
    await shoot(page, path.join(options.out, 'still.png'));
    if (options.resize) {
      await mouse('mousePressed', at(0), 1);
      for (let step = 1; step <= 30; step += 1) {
        await mouse('mouseMoved', at(step), 1);
        await sleep(16);
      }
      await mouse('mouseReleased', at(30), 0);
      await page.send('Emulation.setDeviceMetricsOverride', options.phone ? DESKTOP : PHONE);
      await sleep(500);
      await shoot(page, path.join(options.out, 'resized.png'));
    }

    const debug = await page.evaluate(`document.querySelector('.debug')?.textContent ?? ''`);
    console.log(debug.split('\n').filter((line) => /^(afterglow|fps)=/.test(line)).join('\n'));
  } finally {
    page?.close();
    await browser.close();
    await server.close();
  }
  console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
}

await main();
