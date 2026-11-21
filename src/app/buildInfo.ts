// Identity of the running code, for the debug overlay (see vite.config.ts).

export type BuildInfo = {
  branch: string;
  commit: string;
  dirty: boolean;
  startedAt: string;
  kind: 'dev' | 'build';
};

declare const __DOTPING_BUILD__: BuildInfo | undefined;

export function currentBuildInfo(): BuildInfo | null {
  return typeof __DOTPING_BUILD__ === 'undefined' ? null : __DOTPING_BUILD__;
}

// Short lines (they must fit a phone-width overlay): what is running, with
// which engine build and URL switches. Git values are from when the server
// or build started (`+dirty` = uncommitted changes at that time).
// `secure=no` (a plain-http page) runs JavaScript about 15 times slower on
// iPad WebKit; see troubleshooting.
export function buildInfoLines(info: BuildInfo | null, rapierVersion: string, search: string, secure?: boolean) {
  const lines = info
    ? [
        `build=${info.branch}@${info.commit}${info.dirty ? '+dirty' : ''}`,
        `${info.kind}_started=${info.startedAt.replace(' ', '_')}`,
      ]
    : ['build=unknown'];
  const context = secure === undefined ? '' : ` secure=${secure ? 'yes' : 'no'}`;
  lines.push(`rapier=${rapierVersion || 'unknown'}${context}`);
  lines.push(`url=${search && search !== '?' ? search : 'none'}`);
  return lines;
}
