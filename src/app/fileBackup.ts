import type { PresetExportFile } from '../sim/presets';

// Optional silent overwrite of one chosen file through the File System Access
// API. Technique and limits: docs/tech/browser-file-autosave.md.

export const FILE_BACKUP_FILENAME = 'dotping-autosave.json';
export const FILE_BACKUP_INTERVAL_MS = 120000;

const HANDLE_DB_NAME = 'dotping.fileBackup.v1';
const HANDLE_STORE_NAME = 'handles';
const HANDLE_KEY = 'backup';

export type FileBackupStatus = 'unsupported' | 'off' | 'paused' | 'on' | 'error';
export type FileBackupAction = 'choose' | 'resume' | 'stop';

type PermissionMode = { mode: 'readwrite' };

export type BackupWritable = {
  write(data: string): Promise<void>;
  close(): Promise<void>;
};

// `queryPermission` and `requestPermission` are not in the TypeScript DOM types.
export type BackupFileHandle = {
  createWritable(): Promise<BackupWritable>;
  queryPermission?(descriptor: PermissionMode): Promise<PermissionState>;
  requestPermission?(descriptor: PermissionMode): Promise<PermissionState>;
};

export type FileBackupEnvironment = {
  pickFile: (() => Promise<BackupFileHandle>) | null;
  loadHandle(): Promise<BackupFileHandle | null>;
  saveHandle(handle: BackupFileHandle): Promise<void>;
  clearHandle(): Promise<void>;
};

export type FileBackupRowView = {
  text: string;
  action: FileBackupAction | null;
  actionLabel: string;
};

export function fileBackupRowView(status: FileBackupStatus, savedAt: Date | null): FileBackupRowView {
  switch (status) {
    case 'unsupported':
      return { text: 'Auto Backup: not available here', action: null, actionLabel: '' };
    case 'paused':
      return { text: 'Auto Backup: paused', action: 'resume', actionLabel: 'Tap to resume' };
    case 'on':
      return {
        text: savedAt ? `Auto Backup: saved ${formatClock(savedAt)}` : 'Auto Backup: on',
        action: 'stop',
        actionLabel: 'Stop',
      };
    case 'error':
      return { text: 'Auto Backup: write failed', action: 'choose', actionLabel: 'Save as...' };
    case 'off':
    default:
      return { text: 'Auto Backup: off', action: 'choose', actionLabel: 'Save as...' };
  }
}

function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// What decides whether a write is needed; the export time changes every call.
export function backupFingerprint(file: PresetExportFile) {
  const { exportedAt: _exportedAt, ...content } = file;
  return JSON.stringify(content);
}

export class FileBackup {
  private handle: BackupFileHandle | null = null;
  private status: FileBackupStatus = 'off';
  private savedAt: Date | null = null;
  private lastFingerprint: string | null = null;
  private writing = false;

  constructor(
    private readonly env: FileBackupEnvironment,
    private readonly readFile: () => PresetExportFile,
    private readonly onChange: (status: FileBackupStatus, savedAt: Date | null) => void,
  ) {}

  get currentStatus() {
    return this.status;
  }

  // Never prompts: a stored file that needs permission again waits for a tap.
  async start() {
    if (!this.env.pickFile) {
      this.setStatus('unsupported');
      return;
    }

    this.handle = await this.env.loadHandle().catch(() => null);
    if (!this.handle) {
      this.setStatus('off');
      return;
    }

    const permission = await this.handle.queryPermission?.({ mode: 'readwrite' }).catch(() => 'prompt');
    this.setStatus(permission === 'granted' ? 'on' : 'paused');
  }

  // The three actions below need the user activation of the row's button.
  async choose() {
    if (!this.env.pickFile) {
      return;
    }

    try {
      this.handle = await this.env.pickFile();
    } catch {
      // Cancelling the picker keeps the current state.
      return;
    }
    // Without storage the choice still lasts for this session.
    await this.env.saveHandle(this.handle).catch(() => {});
    this.lastFingerprint = null;
    this.setStatus('on');
    await this.tick();
  }

  async resume() {
    if (!this.handle) {
      return;
    }

    const permission = await this.handle.requestPermission?.({ mode: 'readwrite' }).catch(() => 'denied');
    if (permission === 'granted') {
      this.setStatus('on');
      await this.tick();
    }
  }

  async stop() {
    this.handle = null;
    this.savedAt = null;
    this.lastFingerprint = null;
    await this.env.clearHandle().catch(() => {});
    this.setStatus('off');
  }

  // Runs on the interval and when the page is hidden. Returns true if it wrote.
  async tick() {
    if (!this.handle || this.writing || (this.status !== 'on' && this.status !== 'error')) {
      return false;
    }

    const file = this.readFile();
    const fingerprint = backupFingerprint(file);
    if (fingerprint === this.lastFingerprint) {
      return false;
    }

    this.writing = true;
    try {
      const writable = await this.handle.createWritable();
      await writable.write(`${JSON.stringify(file, null, 2)}\n`);
      await writable.close();
      this.lastFingerprint = fingerprint;
      this.savedAt = new Date();
      this.setStatus('on');
      return true;
    } catch (error) {
      this.setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'paused' : 'error');
      return false;
    } finally {
      this.writing = false;
    }
  }

  private setStatus(status: FileBackupStatus) {
    this.status = status;
    this.onChange(status, this.savedAt);
  }
}

type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<BackupFileHandle>;

export function browserFileBackupEnvironment(): FileBackupEnvironment {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return {
    pickFile: window.isSecureContext && typeof picker === 'function'
      ? () => picker.call(window, {
        suggestedName: FILE_BACKUP_FILENAME,
        types: [{ description: 'dotping presets', accept: { 'application/json': ['.json'] } }],
      })
      : null,
    loadHandle: () => withHandleStore('readonly', (store) => store.get(HANDLE_KEY))
      .then((handle) => (handle as BackupFileHandle | undefined) ?? null),
    saveHandle: (handle) => withHandleStore('readwrite', (store) => store.put(handle, HANDLE_KEY))
      .then(() => {}),
    clearHandle: () => withHandleStore('readwrite', (store) => store.delete(HANDLE_KEY))
      .then(() => {}),
  };
}

function withHandleStore(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open(HANDLE_DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(HANDLE_STORE_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = run(db.transaction(HANDLE_STORE_NAME, mode).objectStore(HANDLE_STORE_NAME));
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
    };
  });
}
