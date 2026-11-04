import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FileBackup,
  backupFingerprint,
  fileBackupRowView,
} from '../.test-build/app/fileBackup.js';
import {
  AUTOSAVE_WORKING_PRESET_NAME,
  createAutosaveExport,
  parsePresetExport,
  presetFromSettings,
} from '../.test-build/sim/presets.js';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';

function fakeHandle({ permission = 'granted', requested = permission, failWrite = null } = {}) {
  const handle = {
    written: [],
    requests: 0,
    queryPermission: async () => permission,
    requestPermission: async () => {
      handle.requests += 1;
      return requested;
    },
    createWritable: async () => {
      if (failWrite) {
        throw failWrite;
      }
      let data = '';
      return {
        write: async (chunk) => {
          data += chunk;
        },
        close: async () => {
          handle.written.push(data);
        },
      };
    },
  };
  return handle;
}

function fakeEnvironment(stored = null, picked = null) {
  const environment = {
    stored,
    pickFile: async () => {
      if (!picked) {
        throw new Error('cancelled');
      }
      return picked;
    },
    loadHandle: async () => environment.stored,
    saveHandle: async (handle) => {
      environment.stored = handle;
    },
    clearHandle: async () => {
      environment.stored = null;
    },
  };
  return environment;
}

function backupFor(environment, readSettings = () => DEFAULT_SETTINGS) {
  const statuses = [];
  const backup = new FileBackup(
    environment,
    () => createAutosaveExport([null], presetFromSettings(readSettings())),
    (status) => statuses.push(status),
  );
  return { backup, statuses };
}

test('without the file API the row says it is not available and nothing runs', async () => {
  const { backup } = backupFor({ ...fakeEnvironment(), pickFile: null });

  await backup.start();
  await backup.choose();

  assert.equal(backup.currentStatus, 'unsupported');
  assert.equal(await backup.tick(), false);
  assert.deepEqual(fileBackupRowView('unsupported', null).action, null);
});

test('it stays off until a file is chosen and writes at once after that', async () => {
  const handle = fakeHandle();
  const environment = fakeEnvironment(null, handle);
  const { backup } = backupFor(environment);

  await backup.start();
  assert.equal(backup.currentStatus, 'off');
  assert.equal(await backup.tick(), false);

  await backup.choose();
  assert.equal(backup.currentStatus, 'on');
  assert.equal(environment.stored, handle);
  assert.equal(handle.written.length, 1);
});

test('cancelling the file picker keeps the current state', async () => {
  const { backup } = backupFor(fakeEnvironment());

  await backup.start();
  await backup.choose();

  assert.equal(backup.currentStatus, 'off');
});

test('it writes only when the content changed, whatever the export time', async () => {
  const handle = fakeHandle();
  let settings = DEFAULT_SETTINGS;
  const { backup } = backupFor(fakeEnvironment(handle), () => settings);

  await backup.start();
  assert.equal(await backup.tick(), true);
  assert.equal(await backup.tick(), false);

  settings = { ...DEFAULT_SETTINGS, particleFxAfterglowLength: 1.5 };
  assert.equal(await backup.tick(), true);
  assert.equal(handle.written.length, 2);
  assert.equal(JSON.parse(handle.written[1]).working.settings.particleFxAfterglowLength, 1.5);
});

test('the fingerprint ignores only the export time', () => {
  const file = createAutosaveExport([null], presetFromSettings(DEFAULT_SETTINGS));

  assert.equal(backupFingerprint(file), backupFingerprint({ ...file, exportedAt: 'later' }));
  assert.notEqual(backupFingerprint(file), backupFingerprint({ ...file, presets: [{ name: 'x' }] }));
});

test('a stored file that needs permission waits for a tap and never prompts by itself', async () => {
  const handle = fakeHandle({ permission: 'prompt', requested: 'granted' });
  const { backup } = backupFor(fakeEnvironment(handle));

  await backup.start();
  assert.equal(backup.currentStatus, 'paused');
  assert.equal(handle.requests, 0);
  assert.equal(await backup.tick(), false);
  assert.equal(fileBackupRowView('paused', null).actionLabel, 'Tap to resume');

  await backup.resume();
  assert.equal(handle.requests, 1);
  assert.equal(backup.currentStatus, 'on');
  assert.equal(handle.written.length, 1);
});

test('refused permission stays paused', async () => {
  const handle = fakeHandle({ permission: 'prompt', requested: 'denied' });
  const { backup } = backupFor(fakeEnvironment(handle));

  await backup.start();
  await backup.resume();

  assert.equal(backup.currentStatus, 'paused');
  assert.equal(handle.written.length, 0);
});

test('a failed write only changes the status and is tried again', async () => {
  const handle = fakeHandle({ failWrite: new Error('disk full') });
  const { backup, statuses } = backupFor(fakeEnvironment(handle));

  await backup.start();
  assert.equal(await backup.tick(), false);
  assert.equal(backup.currentStatus, 'error');

  handle.createWritable = fakeHandle().createWritable;
  assert.equal(await backup.tick(), true);
  assert.equal(backup.currentStatus, 'on');
  assert.deepEqual(statuses, ['on', 'error', 'on']);
});

test('a write refused by the browser pauses the backup', async () => {
  const handle = fakeHandle({ failWrite: new DOMException('no', 'NotAllowedError') });
  const { backup } = backupFor(fakeEnvironment(handle));

  await backup.start();
  await backup.tick();

  assert.equal(backup.currentStatus, 'paused');
});

test('Stop forgets the file', async () => {
  const handle = fakeHandle();
  const environment = fakeEnvironment(handle);
  const { backup } = backupFor(environment);

  await backup.start();
  await backup.stop();

  assert.equal(backup.currentStatus, 'off');
  assert.equal(environment.stored, null);
  assert.equal(await backup.tick(), false);
});

test('the row shows the time of the last write', () => {
  const view = fileBackupRowView('on', new Date(2026, 10, 5, 9, 7));

  assert.equal(view.text, 'Auto Backup: saved 09:07');
  assert.equal(view.action, 'stop');
  assert.equal(fileBackupRowView('on', null).text, 'Auto Backup: on');
  assert.equal(fileBackupRowView('off', null).action, 'choose');
  assert.equal(fileBackupRowView('error', null).action, 'choose');
});

test('an autosave file imports its presets and the working tuning', () => {
  const tuned = { ...DEFAULT_SETTINGS, ballFxTrailLength: 2 };
  const saved = {
    name: 'Saved work',
    settings: presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 700 }),
  };
  const file = createAutosaveExport(
    [saved, null],
    presetFromSettings(tuned),
    'Label',
    { width: 402, height: 717 },
  );

  assert.equal(file.source, 'autosave');
  const imported = parsePresetExport(JSON.stringify(file));
  assert.deepEqual(imported.map((preset) => preset.name), ['Saved work', AUTOSAVE_WORKING_PRESET_NAME]);
  assert.equal(imported[0].settings.particleCount, 700);
  assert.equal(imported[1].settings.ballFxTrailLength, 2);
  assert.equal(imported[1].formationLabel, 'Label');
  assert.deepEqual(imported[1].designViewport, { width: 402, height: 717 });
});
