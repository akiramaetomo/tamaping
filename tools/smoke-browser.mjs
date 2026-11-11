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

const PANEL_MAX_HEIGHT = `parseFloat(getComputedStyle(document.getElementById('settings-panel')).maxHeight)`;

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
  const desktopLimit = await page.evaluate(PANEL_MAX_HEIGHT);
  check('desktop: Settings may use 40% of the screen height', desktopLimit === DESKTOP.height * 0.4, `${desktopLimit}px`);
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
  const phoneLimit = await page.evaluate(PANEL_MAX_HEIGHT);
  check('phone 360px: Settings may use half the screen height', phoneLimit === PHONE.height / 2, `${phoneLimit}px`);
}

// Evaluates to the state of the Ball card's main rows and Details groups.
const BALL_CARD_PROBE = `(() => {
  const card = document.querySelector('.hud__group--ball');
  const section = card.querySelector('[data-section="ball.details"]');
  const visible = (element) => element.getClientRects().length > 0;
  const groups = [...section.querySelectorAll('.hud__subgroup')];
  const rows = (group) => [...group.querySelector('.hud__subgroup-body').children]
    .filter(visible).map((row) => row.querySelector('label, span')?.textContent ?? row.textContent);
  const effectRow = card.querySelector(':scope > .hud__effect-toggles');
  const tops = [...effectRow.children].map((toggle) => Math.round(toggle.getBoundingClientRect().top));
  return {
    open: section.open,
    mainLabels: [...card.children].filter((child) => child.classList.contains('hud__control'))
      .map((child) => child.querySelector('label, span')?.textContent),
    effectLabels: [...effectRow.children].map((toggle) => toggle.textContent),
    effectRowOneLine: new Set(tops).size === 1,
    headings: groups.map((group) => group.querySelector('.hud__subgroup-title').textContent),
    shapeRows: rows(groups[2]),
    raysRows: rows(groups[3]),
    mainRaysChecked: effectRow.children[0].querySelector('input').checked,
    headingRaysChecked: groups[3].querySelector('.hud__subgroup-title input').checked,
  };
})()`;

const BALL_FX_TOGGLE = {
  main: `document.querySelector('.hud__group--ball > .hud__effect-toggles input')`,
  heading: `document.querySelectorAll('[data-section="ball.details"] .hud__subgroup')[3].querySelector('.hud__subgroup-title input')`,
};

async function runSettingsCards(page, url) {
  await loadApp(page, url, DESKTOP);
  await click(page, '.settings-button');

  const tabs = await page.evaluate(`(() => {
    const panel = document.getElementById('settings-panel');
    return {
      ids: [...panel.querySelectorAll('.hud__tab')].map((tab) => tab.dataset.tab),
      selected: panel.querySelector('.hud__tab[aria-selected="true"]')?.dataset.tab,
      visibleCards: [...panel.querySelectorAll(':scope > .hud__group, :scope > .hud__preset')]
        .filter((element) => element.getClientRects().length > 0).length,
      sideScroll: panel.scrollWidth > panel.clientWidth,
    };
  })()`);
  check('Settings tabs: no All tab', !tabs.ids.includes('all') && tabs.ids.length === 8, tabs.ids.join());
  check('Settings tabs: a new browser opens My, one card, no sideways scroll',
    tabs.selected === 'my' && tabs.visibleCards === 1 && !tabs.sideScroll, JSON.stringify(tabs));

  await click(page, '.hud__tab[data-tab="ball"]');
  let card = await page.evaluate(BALL_CARD_PROBE);
  check('Ball card: Details starts closed', card.open === false);
  check('Ball card: main rows are Size, Color, Shape',
    card.mainLabels.join() === 'Size,Color,Shape', card.mainLabels.join());
  check('Ball card: effect toggles share one row',
    card.effectLabels.join() === 'Rays,Trail,Afterglow' && card.effectRowOneLine, card.effectLabels.join());

  await page.evaluate(`document.querySelector('[data-section="ball.details"]').open = true`);
  await sleep(100);
  card = await page.evaluate(BALL_CARD_PROBE);
  check('Ball card: Details headings follow the main order',
    card.headings.join() === 'Motion,Color,Shape,Rays,Trail,Afterglow', card.headings.join());
  const weaveProbe = `(() => {
    const rows = [...document.querySelectorAll('[data-section="ball.details"] .hud__subgroup')[0]
      .querySelector('.hud__subgroup-body').children];
    const row = (name) => rows.find((item) => item.textContent.trim().startsWith(name));
    const input = (name) => row(name).querySelector('input');
    return {
      weave: input('Weave').checked,
      agilityDisabled: input('Agility').disabled,
      sightDisabled: input('Sight').disabled,
      wallsDisabled: input('Walls').disabled,
      walls: input('Walls').checked,
      agility: input('Agility').value,
      sight: input('Sight').value,
      order: rows.map((item) => item.textContent.trim().match(/^[A-Za-z]+/)?.[0]).join(),
    };
  })()`;
  let weave = await page.evaluate(weaveProbe);
  check('Ball card: Agility, Sight and Walls follow Weave, greyed out while Weave is off',
    weave.order.endsWith('Weave,Agility,Sight,Walls') && !weave.weave && weave.agilityDisabled
      && weave.sightDisabled && weave.wallsDisabled && weave.walls
      && weave.agility === '50' && weave.sight === '50', JSON.stringify(weave));
  const weaveToggle = `[...document.querySelectorAll('[data-section="ball.details"] .hud__subgroup')[0]
    .querySelector('.hud__subgroup-body').children]
    .find((item) => item.textContent.trim().startsWith('Weave')).querySelector('input').click()`;
  await page.evaluate(weaveToggle);
  weave = await page.evaluate(weaveProbe);
  check('Ball card: turning Weave on enables Agility, Sight and Walls',
    weave.weave && !weave.agilityDisabled && !weave.sightDisabled && !weave.wallsDisabled, JSON.stringify(weave));
  await page.evaluate(weaveToggle);
  check('Ball card: Circle shows Turn and Opacity', card.shapeRows.join() === 'Turn,Opacity', card.shapeRows.join());
  const shapeTurn = await page.evaluate(`(() => {
    const row = document.querySelectorAll('[data-section="ball.details"] .hud__subgroup')[2]
      .querySelector('.hud__subgroup-body .hud__toggle');
    return { checked: row.querySelector('input').checked, disabled: row.querySelector('input').disabled };
  })()`);
  check('Ball card: Circle Turn is on by default and greyed out',
    shapeTurn.checked && shapeTurn.disabled, JSON.stringify(shapeTurn));
  check('Ball card: an effect that is off hides its rows', card.raysRows.length === 0, card.raysRows.join());

  await page.evaluate(`${BALL_FX_TOGGLE.main}.click()`);
  card = await page.evaluate(BALL_CARD_PROBE);
  check('Ball card: main toggle updates the Details heading and shows its rows',
    card.headingRaysChecked === true && card.raysRows.join() === 'Turn,Curve', card.raysRows.join());

  await page.evaluate(`${BALL_FX_TOGGLE.heading}.click()`);
  card = await page.evaluate(BALL_CARD_PROBE);
  check('Ball card: Details heading updates the main toggle and hides its rows',
    card.mainRaysChecked === false && card.raysRows.length === 0);

  await page.evaluate(`(() => {
    const select = [...document.querySelectorAll('.hud__group--ball > .hud__control--select')]
      .find((row) => row.textContent.startsWith('Shape')).querySelector('select');
    select.value = 'sparkle';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  card = await page.evaluate(BALL_CARD_PROBE);
  check('Ball card: Sparkle shows Turn, Curve and Opacity',
    card.shapeRows.join() === 'Turn,Curve,Opacity', card.shapeRows.join());

  // A picked row stays in My Panel, disabled, while its effect is off.
  await page.evaluate(`${BALL_FX_TOGGLE.main}.click()`);
  await page.evaluate(`document.querySelector('.hud__pick[aria-label="Add Ball rays turn to My Panel"]').click()`);
  await page.evaluate(`${BALL_FX_TOGGLE.main}.click()`);
  await click(page, '.hud__tab[data-tab="my"]');
  const picked = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('.hud__my-items .hud__toggle')]
      .find((item) => item.textContent.includes('Ball rays turn'));
    return row ? { visible: row.getClientRects().length > 0, disabled: row.querySelector('input').disabled } : null;
  })()`);
  check('My Panel: a picked detail stays visible and disabled while its effect is off',
    Boolean(picked?.visible && picked.disabled), JSON.stringify(picked));
  await click(page, '.hud__tab[data-tab="ball"]');

  await loadApp(page, url, DESKTOP);
  await click(page, '.settings-button');
  card = await page.evaluate(BALL_CARD_PROBE);
  check('Ball card: Details open state survives a reload', card.open === true);

  // A browser that last used the removed All tab opens My.
  await page.evaluate(`localStorage.setItem('dotping.settingsTab.v1', 'all')`);
  await loadApp(page, url, DESKTOP);
  const reopened = await page.evaluate(`document.querySelector('.hud__tab[aria-selected="true"]')?.dataset.tab`);
  check('Settings tabs: a saved All tab opens My', reopened === 'my', `${reopened}`);

  await page.evaluate(`[
    'dotping.settingsSections.v1',
    'dotping.settingsTab.v1',
    'dotping.myPanel.v1',
  ].forEach((key) => localStorage.removeItem(key))`);
}

// Every value in a card's Details, as the rows show them. Effects are switched
// on first, because a row is hidden while its effect is off.
const DETAILS_READ = `(() => {
  const values = {};
  for (const card of ['ball', 'particles']) {
    const inputs = document.querySelectorAll(
      '.hud__group--' + card + ' > .hud__control select, .hud__group--' + card + ' > .hud__effect-toggles input, '
        + '[data-section="' + card + '.details"] input, [data-section="' + card + '.details"] select',
    );
    inputs.forEach((input, index) => {
      values[card + index] = input.type === 'checkbox' ? input.checked : input.value;
    });
  }
  return values;
})()`;

// Sets every Details value away from its default: on/off rows flip, sliders move
// to a quarter of their range, and selects take their last option.
const DETAILS_CHANGE = `(() => {
  const fire = (input) => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  for (const card of ['ball', 'particles']) {
    const shape = [...document.querySelectorAll('.hud__group--' + card + ' > .hud__control--select')]
      .find((row) => row.textContent.startsWith('Shape')).querySelector('select');
    shape.value = 'sparkle';
    fire(shape);
    document.querySelectorAll('.hud__group--' + card + ' > .hud__effect-toggles input').forEach((input) => {
      if (!input.checked) input.click();
    });
    document.querySelectorAll('[data-section="' + card + '.details"] .hud__subgroup-body input, '
      + '[data-section="' + card + '.details"] .hud__subgroup-body select').forEach((input) => {
      if (input.type === 'checkbox') {
        input.click();
      } else if (input.tagName === 'SELECT') {
        input.selectedIndex = input.options.length - 1;
        fire(input);
      } else {
        const min = Number(input.min);
        input.value = String(min + (Number(input.max) - min) * 0.25);
        fire(input);
      }
    });
  }
})()`;

const selectPreset = (value) => `(() => {
  const select = document.querySelector('.hud__preset-select');
  select.value = ${JSON.stringify(value)};
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()`;

const PRESET_STATUS = `document.querySelector('.hud__preset-status').textContent`;

function sameValues(a, b) {
  return Object.keys(a).length > 0 && JSON.stringify(a) === JSON.stringify(b);
}

async function runWorkProtection(page, url) {
  await page.evaluate(`localStorage.clear()`);
  await loadApp(page, url, DESKTOP);
  await click(page, '.settings-button');

  const defaults = await page.evaluate(DETAILS_READ);
  await page.evaluate(DETAILS_CHANGE);
  const tuned = await page.evaluate(DETAILS_READ);
  check('Details: every card value can be set away from the start', !sameValues(defaults, tuned),
    `${Object.keys(tuned).length} values`);

  // Unsaved tuning survives a reload.
  await sleep(800);
  await loadApp(page, url, DESKTOP);
  check('working state: unsaved Details survive a reload', sameValues(tuned, await page.evaluate(DETAILS_READ)));
  check('working state: a restored custom tuning says Restored',
    (await page.evaluate(PRESET_STATUS)) === 'Restored', await page.evaluate(PRESET_STATUS));

  // Save, then apply another preset and come back.
  await page.evaluate(`(() => {
    const slot = document.querySelector('.hud__preset-save-select');
    slot.value = '0';
    slot.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.hud__preset-save').click();
  })()`);
  await page.evaluate(selectPreset('factory:factory-1'));
  await sleep(100);
  check('Details: applying a factory preset leaves the saved values',
    !sameValues(tuned, await page.evaluate(DETAILS_READ)));
  await page.evaluate(selectPreset('user:0'));
  await sleep(100);
  check('Details: Save and apply restore every value', sameValues(tuned, await page.evaluate(DETAILS_READ)));

  // Export file read back through Import, into a browser with no presets.
  const exported = await page.evaluate(`localStorage.getItem('dotping.userPresets.v2')`);
  await sleep(800);
  await page.evaluate(`localStorage.clear()`);
  await loadApp(page, url, DESKTOP);
  const importFile = JSON.stringify({ kind: 'dotping-presets', presets: JSON.parse(exported).filter(Boolean) });
  await importThroughInput(page, importFile);
  await page.evaluate(`document.querySelector('.import-review__confirm').click()`);
  await sleep(100);
  const imported = await page.evaluate(PRESET_STATUS);
  check('Details: the exported file imports', imported === 'Added 1 · Overwrote 0 · Skipped 0', imported);
  await page.evaluate(selectPreset('user:0'));
  await sleep(100);
  check('Details: Export and Import restore every value', sameValues(tuned, await page.evaluate(DETAILS_READ)));

  // A restored preset keeps its Applied or Modified state.
  await sleep(800);
  await loadApp(page, url, DESKTOP);
  check('working state: an unchanged preset comes back Applied',
    (await page.evaluate(PRESET_STATUS)) === 'Applied'
      && (await page.evaluate(`document.querySelector('.hud__preset-select').value`)) === 'user:0',
    await page.evaluate(PRESET_STATUS));

  // A start that died during restore: the next one skips it and keeps the state.
  // The marker goes in on the new page, because closing a page normally clears it.
  const stored = await page.evaluate(`localStorage.getItem('dotping.workingState.v1')`);
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('dotping.workingState.booting.v1', '1');`,
  });
  await loadApp(page, url, DESKTOP);
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  const afterSkip = await page.evaluate(`({
    value: document.querySelector('.hud__preset-select').value,
    stored: localStorage.getItem('dotping.workingState.v1'),
  })`);
  check('working state: a marker left by a dead start skips the restore once',
    afterSkip.value === 'custom' && afterSkip.stored === stored, afterSkip.value);

  // Diagnostic URLs ignore and keep the stored state.
  await loadApp(page, `${url}?fx=star`, DESKTOP);
  const diagnostic = await page.evaluate(`({
    value: document.querySelector('.hud__preset-select').value,
    backup: document.querySelector('.hud__preset-backup-text').textContent,
    stored: localStorage.getItem('dotping.workingState.v1'),
  })`);
  check('working state: ?fx= neither restores nor saves',
    diagnostic.value === 'custom' && diagnostic.stored === stored, diagnostic.value);
  check('Auto Backup: inactive on a diagnostic URL',
    diagnostic.backup === 'Auto Backup: not available here', diagnostic.backup);

  await page.evaluate(`localStorage.clear()`);
}

const MY_PANEL_ROWS = `[...document.querySelectorAll('.hud__my-items .hud__pick')]
  .map((pick) => pick.dataset.label)`;
const OWN_MY_PANEL = `localStorage.getItem('dotping.myPanel.v1')`;
const SAVED_PRESET_ROWS = `JSON.parse(localStorage.getItem('dotping.userPresets.v2'))[0].settings.myPanelItems`;

// A preset's rows against the browser's own list, driven through the real UI.
async function runPresetMyPanel(page, url) {
  for (const [label, viewport] of [['1280px', DESKTOP], ['360px', PHONE]]) {
    const own = JSON.stringify({ items: ['mode.random'] });
    await page.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem('dotping.myPanel.v1', ${JSON.stringify(own)});
      localStorage.setItem('dotping.userPresets.v1', ${JSON.stringify(JSON.stringify([{
        name: 'Rows',
        settings: { pinnedGroup: 'my', myPanelItems: ['mode.flash', 'removed.control', 'audio.sound'] },
      }]))});
    })()`);
    await loadApp(page, url, viewport);
    const rows = () => page.evaluate(MY_PANEL_ROWS);
    const removeRow = (name) => page.evaluate(
      `document.querySelector('.hud__my-items .hud__pick[data-label=${JSON.stringify(name)}]').click()`,
    );
    const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
    const showRows = async (name, expected) => {
      const actual = await rows();
      check(`preset My Panel ${label}: ${name}`, same(actual, expected), actual.join());
    };

    await showRows('the browser list shows before any preset', ['Random']);

    await page.evaluate(selectPreset('user:0'));
    await sleep(100);
    await showRows('applying shows the preset rows without a removed control', ['Flash', 'Sound']);
    const front = await page.evaluate(`(() => {
      const host = document.querySelector('.pinned-settings');
      return {
        rows: [...host.querySelectorAll('.hud__my-items .hud__pick')].map((pick) => pick.dataset.label),
        hidden: host.hidden,
        pageScroll: document.documentElement.scrollWidth,
      };
    })()`);
    check(`preset My Panel ${label}: a preset pinning My Panel shows its rows in front`,
      !front.hidden && same(front.rows, ['Flash', 'Sound']) && front.pageScroll <= viewport.width,
      JSON.stringify(front));
    check(`preset My Panel ${label}: applying leaves the browser list`,
      (await page.evaluate(OWN_MY_PANEL)) === own);

    await removeRow('Sound');
    await sleep(100);
    await showRows('removing changes the shown rows', ['Flash']);
    check(`preset My Panel ${label}: a row change shows Modified and leaves the browser list`,
      (await page.evaluate(PRESET_STATUS)) === 'Modified' && (await page.evaluate(OWN_MY_PANEL)) === own,
      await page.evaluate(PRESET_STATUS));

    await sleep(800);
    await loadApp(page, url, viewport);
    await showRows('a reload keeps the changed rows', ['Flash']);
    check(`preset My Panel ${label}: a reload keeps Modified`,
      (await page.evaluate(PRESET_STATUS)) === 'Modified', await page.evaluate(PRESET_STATUS));

    await page.evaluate(selectPreset('user:0'));
    await sleep(100);
    await showRows('applying again discards the change', ['Flash', 'Sound']);
    check(`preset My Panel ${label}: applying again shows Applied`,
      (await page.evaluate(PRESET_STATUS)) === 'Applied', await page.evaluate(PRESET_STATUS));

    await removeRow('Flash');
    await page.evaluate(`(() => {
      const slot = document.querySelector('.hud__preset-save-select');
      slot.value = '0';
      slot.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('.hud__preset-save').click();
    })()`);
    await sleep(100);
    const saved = await page.evaluate(SAVED_PRESET_ROWS);
    check(`preset My Panel ${label}: saving stores the shown rows`, same(saved, ['audio.sound']), `${saved}`);

    await page.evaluate(selectPreset('factory:factory-1'));
    await sleep(100);
    await showRows('a preset without rows shows the browser list', ['Random']);
    await page.evaluate(selectPreset('user:0'));
    await sleep(100);
    await showRows('applying the saved preset shows the saved rows', ['Sound']);

    await page.evaluate(selectPreset('factory:factory-1'));
    await sleep(100);
    await removeRow('Random');
    await sleep(100);
    check(`preset My Panel ${label}: without preset rows, a pick changes the browser list and stays Applied`,
      (await page.evaluate(OWN_MY_PANEL)) === JSON.stringify({ items: [] })
        && (await page.evaluate(PRESET_STATUS)) === 'Applied',
      await page.evaluate(PRESET_STATUS));

    // Choosing a preset from the Preset row in My Panel, which that choice may rebuild.
    await sleep(800);
    await page.evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem('dotping.myPanel.v1', ${JSON.stringify(JSON.stringify({ items: ['preset.select'] }))});
      localStorage.setItem('dotping.userPresets.v1', ${JSON.stringify(JSON.stringify([
        { name: 'Same rows', settings: { myPanelItems: ['preset.select'] } },
        { name: 'More rows', settings: { myPanelItems: ['preset.select', 'mode.flash'] } },
      ]))});
    })()`);
    await loadApp(page, url, viewport);
    const chooseInMyPanel = (value) => page.evaluate(`(() => {
      window.__myPanelSelect = document.querySelector('.hud__my-items select');
      window.__myPanelSelect.value = ${JSON.stringify(value)};
      window.__myPanelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const select = document.querySelector('.hud__my-items select');
      return { kept: select === window.__myPanelSelect, value: select.value };
    })()`);
    const kept = await chooseInMyPanel('user:0');
    check(`preset My Panel ${label}: the same rows keep the Preset row in My Panel`,
      kept.kept && kept.value === 'user:0', JSON.stringify(kept));
    const rebuilt = await chooseInMyPanel('user:1');
    await showRows('other rows rebuild My Panel from its Preset row', ['Preset', 'Flash']);
    check(`preset My Panel ${label}: the rebuilt Preset row shows the chosen preset`,
      !rebuilt.kept && rebuilt.value === 'user:1', JSON.stringify(rebuilt));
    await sleep(800);
  }
  await page.evaluate(`localStorage.clear()`);
}

// The browser's file picker cannot run headless, so it hands out a real file
// handle from the origin's private file system instead.
const FAKE_PICKER = `window.showSaveFilePicker = async () => {
  const root = await navigator.storage.getDirectory();
  return root.getFileHandle('picked-backup.json', { create: true });
};`;

const READ_BACKUP_FILE = `(async () => {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle('picked-backup.json');
  return (await handle.getFile()).text();
})()`;

// The file exists only once the app has called the picker and written to it,
// which can take longer than a fixed wait on a busy machine. Reading too early
// throws NotFoundError (see docs/troubleshooting.md).
async function readBackupFileWhenWritten(page, timeoutMs = 3000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      const text = await page.evaluate(READ_BACKUP_FILE);
      if (text) {
        return text;
      }
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return '';
    }
    await sleep(100);
  }
}

// The Start block in the Preset card and the front bar's Restart button.
// Hands a file to the Preset card's Import input, as the file picker would.
async function importThroughInput(page, fileText, fileName = 'import.json') {
  await page.evaluate(`(async () => {
    const input = document.querySelector('.hud__preset input[type="file"]');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(fileText)}], ${JSON.stringify(fileName)}, { type: 'application/json' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
  })()`);
}

const SAVED_NAMES = `(JSON.parse(localStorage.getItem('dotping.userPresets.v2')) ?? []).map((preset) => preset?.name ?? null)`;

function smokePreset(name, particleCount) {
  return { name, settings: { particleCount } };
}

async function seedPresets(page, url, viewport, presets, key = 'dotping.userPresets.v2') {
  await page.evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(presets))});
  })()`);
  await loadApp(page, url, viewport);
}

// Round 16: Import skips what is saved, asks about same names, and the
// preset lists hold 60 slots.
async function runImportMerge(page, url) {
  // The 30-slot key of 0.2.7 fills the new key once and stays as it was.
  const legacy = JSON.stringify([smokePreset('Old work', 120)]);
  await seedPresets(page, url, DESKTOP, [smokePreset('Old work', 120)], 'dotping.userPresets.v1');
  const migrated = await page.evaluate(`({
    names: ${SAVED_NAMES},
    legacy: localStorage.getItem('dotping.userPresets.v1'),
  })`);
  check('import merge: the old 30-slot key fills the 60-slot key and is left as it was',
    migrated.names.length === 60 && migrated.names[0] === 'Old work' && migrated.legacy === legacy,
    `${migrated.names.length} slots`);

  for (const [label, viewport] of [['1280px', DESKTOP], ['360px', PHONE]]) {
    const saved = [smokePreset('Wave', 100), smokePreset('Rain', 200)];
    await seedPresets(page, url, viewport, saved);
    const savedFile = JSON.stringify({ kind: 'dotping-presets', presets: saved });

    await importThroughInput(page, savedFile);
    const again = await page.evaluate(`({
      status: document.querySelector('.hud__preset-status').textContent,
      panel: Boolean(document.querySelector('.import-review')),
    })`);
    check(`import merge ${label}: reading saved presets again adds nothing and opens no panel`,
      again.status === 'Nothing new (2 already saved)' && !again.panel, again.status);

    const backup = JSON.stringify({
      kind: 'dotping-presets',
      source: 'autosave',
      presets: [smokePreset('Wave', 999), smokePreset('Rain', 200), smokePreset('Snow', 300)],
      working: smokePreset('Autosave working', 400),
    });
    await importThroughInput(page, backup, 'dotping-autosave.json');
    const panel = await page.evaluate(`(() => {
      const dialog = document.querySelector('.import-review');
      if (!dialog) return null;
      const r = dialog.getBoundingClientRect();
      const rows = [...dialog.querySelectorAll('.import-review__row')].map((row) => ({
        kind: row.dataset.kind,
        choice: row.querySelector('select')?.value ?? null,
        outcome: row.querySelector('.import-review__outcome').textContent,
      }));
      return {
        open: dialog.open,
        summary: dialog.querySelector('.import-review__summary').textContent,
        rows,
        left: r.left,
        right: r.right,
        sideScroll: dialog.scrollWidth > dialog.clientWidth,
        pageScroll: document.documentElement.scrollWidth,
      };
    })()`);
    check(`import merge ${label}: the review panel opens with the file's summary`,
      Boolean(panel?.open) && panel.summary === '1 new · 1 already saved · 1 same name, different · work in progress',
      panel?.summary);
    check(`import merge ${label}: same name defaults to a new name, work in progress to Skip`,
      JSON.stringify(panel?.rows.map((row) => [row.kind, row.choice])) === JSON.stringify([
        ['conflict', 'add'], ['new', null], ['working', 'skip'],
      ]) && panel.rows[0].outcome === '→ U03: Wave (2)',
      JSON.stringify(panel?.rows));
    check(`import merge ${label}: the review panel fits the screen`,
      Boolean(panel) && panel.left >= 0 && panel.right <= viewport.width + 1
        && !panel.sideScroll && panel.pageScroll <= viewport.width,
      panel ? `${Math.round(panel.left)}-${Math.round(panel.right)}` : 'none');

    await click(page, '.import-review__confirm');
    await sleep(100);
    const after = await page.evaluate(`({
      status: document.querySelector('.hud__preset-status').textContent,
      names: ${SAVED_NAMES}.slice(0, 5),
      panel: Boolean(document.querySelector('.import-review')),
    })`);
    check(`import merge ${label}: Import adds the new and renamed presets only`,
      after.status === 'Added 2 · Overwrote 0 · Skipped 2' && !after.panel
        && JSON.stringify(after.names) === JSON.stringify(['Wave', 'Rain', 'Wave (2)', 'Snow', null]),
      `${after.status} ${JSON.stringify(after.names)}`);

    const lists = await page.evaluate(`(() => {
      const users = (select) => [...select.querySelectorAll('option')].filter((option) => option.value.startsWith('user:'));
      return {
        front: users(document.querySelector('.front-preset-bar__select')).map((option) => option.textContent),
        settings: users(document.querySelector('.hud__preset-select')).length,
        saveTo: document.querySelectorAll('.hud__preset-save-select option').length,
      };
    })()`);
    check(`import merge ${label}: the front bar lists saved slots only, with their numbers`,
      JSON.stringify(lists.front) === JSON.stringify(['U01: Wave', 'U02: Rain', 'U03: Wave (2)', 'U04: Snow']),
      JSON.stringify(lists.front));
    check(`import merge ${label}: Settings and Save to list all 60 slots`,
      lists.settings === 60 && lists.saveTo === 61, `${lists.settings} / ${lists.saveTo}`);
  }

  // A full list refuses to add, and Cancel writes nothing.
  const full = Array.from({ length: 60 }, (_, index) => smokePreset(`P${index + 1}`, index + 1));
  await seedPresets(page, url, PHONE, full);
  await importThroughInput(page, JSON.stringify([smokePreset('One more', 5000)]));
  const blocked = await page.evaluate(`({
    message: document.querySelector('.import-review__message')?.textContent ?? '',
    disabled: document.querySelector('.import-review__confirm')?.disabled ?? null,
  })`);
  check('import merge: a full list disables Import and says how many slots are missing',
    blocked.message === 'Needs 1 more slot' && blocked.disabled === true, blocked.message);
  await click(page, '.import-review__cancel');
  await sleep(100);
  const cancelled = await page.evaluate(`({
    status: document.querySelector('.hud__preset-status').textContent,
    names: ${SAVED_NAMES},
  })`);
  check('import merge: Cancel writes nothing',
    cancelled.status === 'Import cancelled' && cancelled.names[59] === 'P60' && !cancelled.names.includes('One more'),
    cancelled.status);
  await page.evaluate(`localStorage.clear()`);
}

async function runPresetStart(page, url) {
  for (const [label, viewport] of [['1280px', DESKTOP], ['360px', PHONE]]) {
    await loadApp(page, url, viewport);
    const bar = await page.evaluate(`(() => {
      const r = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const restart = r('.front-preset-bar__restart');
      return {
        restart: restart && { left: restart.left, right: restart.right },
        bar: r('.front-preset-bar')?.right ?? null,
        name: r('.front-preset-bar__name')?.width ?? 0,
      };
    })()`);
    check(`preset start ${label}: Restart sits in the front bar`,
      Boolean(bar.restart && bar.restart.right <= bar.bar + 1), JSON.stringify(bar));
    check(`preset start ${label}: the preset name keeps room`, bar.name >= 100, `${Math.round(bar.name)}px`);

    await click(page, '.settings-button');
    await page.evaluate(`document.querySelector('.hud__tab[data-tab="preset"]').click()`);
    await sleep(100);
    const block = await page.evaluate(`(() => {
      const block = document.querySelector('.hud__preset-start');
      const panel = document.getElementById('settings-panel');
      if (!block) return null;
      return {
        right: block.getBoundingClientRect().right,
        rows: [...block.querySelectorAll('.hud__control > span:first-child')].map((span) => span.textContent),
        sideScroll: panel.scrollWidth > panel.clientWidth,
      };
    })()`);
    check(`preset start ${label}: the Start block fits the panel`,
      Boolean(block && block.right <= viewport.width + 1 && !block.sideScroll), JSON.stringify(block));
    check(`preset start ${label}: the Start block has its five rows`,
      JSON.stringify(block?.rows) === JSON.stringify(['Formation', 'Ball X', 'Ball Y', 'Ball speed', 'Particle speed']),
      JSON.stringify(block?.rows));
  }

  await page.evaluate(`(() => {
    const select = document.querySelector('.hud__preset-start select');
    select.value = 'spiral';
    select.dispatchEvent(new Event('change'));
  })()`);
  check('preset start: changing a Start value replays the start',
    (await page.evaluate(PRESET_STATUS)) === 'Start replayed', await page.evaluate(PRESET_STATUS));
  await click(page, '.hud__close');
  await click(page, '.front-preset-bar__restart');
  check('preset start: Restart replays the start', (await page.evaluate(PRESET_STATUS)) === 'Restarted',
    await page.evaluate(PRESET_STATUS));
  await click(page, '.front-preset-bar__step[aria-label="Next preset"]');
  const applied = await page.evaluate(`({
    status: document.querySelector('.hud__preset-status')?.textContent ?? '',
    formation: document.querySelector('.hud__preset-start select')?.value ?? '',
  })`);
  check('preset start: applying a factory preset fills the Start block',
    applied.status === 'Applied' && applied.formation === 'name', JSON.stringify(applied));
  await page.evaluate(`localStorage.clear()`);
}

async function runAutoBackup(page, url) {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_PICKER });
  try {
    for (const [label, viewport, panelWidth] of [['1280px', DESKTOP, DESKTOP.width], ['360px', PHONE, PHONE.width]]) {
      await loadApp(page, url, viewport);
      await click(page, '.settings-button');
      await page.evaluate(`document.querySelector('.hud__tab[data-tab="preset"]').click()`);
      await sleep(100);
      const row = await page.evaluate(`(() => {
        const r = document.querySelector('.hud__preset-backup').getBoundingClientRect();
        const panel = document.getElementById('settings-panel');
        return {
          text: document.querySelector('.hud__preset-backup-text').textContent,
          right: r.right,
          sideScroll: panel.scrollWidth > panel.clientWidth,
          pageScroll: document.documentElement.scrollWidth,
        };
      })()`);
      check(`Auto Backup ${label}: starts off and fits the panel`,
        row.text === 'Auto Backup: off' && row.right <= panelWidth + 1
          && !row.sideScroll && row.pageScroll <= panelWidth,
        JSON.stringify(row));
    }

    await loadApp(page, url, DESKTOP);
    await click(page, '.settings-button');
    await page.evaluate(`document.querySelector('.hud__tab[data-tab="preset"]').click()`);
    await sleep(100);
    await page.evaluate(`document.querySelector('.hud__preset-backup-action').scrollIntoView({ block: 'center' })`);
    await click(page, '.hud__preset-backup-action');
    const first = JSON.parse(await readBackupFileWhenWritten(page));
    check('Auto Backup: choosing a file writes it at once',
      first.source === 'autosave' && Boolean(first.working?.settings), first.source);
    check('Auto Backup: the row shows the write and offers Stop',
      (await page.evaluate(`document.querySelector('.hud__preset-backup-text').textContent`)).startsWith('Auto Backup: saved')
        && (await page.evaluate(`document.querySelector('.hud__preset-backup-action').textContent`)) === 'Stop');

    await page.evaluate(`(() => {
      const select = document.querySelector('.hud__preset-select');
      select.value = 'factory:factory-2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await sleep(300);
    const second = JSON.parse(await page.evaluate(READ_BACKUP_FILE));
    check('Auto Backup: hiding the page writes the changed tuning',
      JSON.stringify(second.working.settings) !== JSON.stringify(first.working.settings));

    await loadApp(page, url, DESKTOP);
    await sleep(200);
    check('Auto Backup: the chosen file is remembered after a reload',
      (await page.evaluate(`document.querySelector('.hud__preset-backup-action').textContent`)) === 'Stop');

    await click(page, '.settings-button');
    await page.evaluate(`document.querySelector('.hud__tab[data-tab="preset"]').click()`);
    await sleep(100);
    await page.evaluate(`document.querySelector('.hud__preset-backup-action').scrollIntoView({ block: 'center' })`);
    await click(page, '.hud__preset-backup-action');
    await sleep(200);
    check('Auto Backup: Stop turns it off',
      (await page.evaluate(`document.querySelector('.hud__preset-backup-text').textContent`)) === 'Auto Backup: off');
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await page.evaluate(`localStorage.clear()`).catch(() => {});
  }
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
    await runSettingsCards(page, url);
    await runWorkProtection(page, url);
    await runPresetMyPanel(page, url);
    await runImportMerge(page, url);
    await runPresetStart(page, url);
    await runAutoBackup(page, url);

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
