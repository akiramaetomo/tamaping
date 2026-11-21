import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { ensureLanCert } from "./tools/lanCert.mjs";

// What this server or build was started from, shown on the debug overlay's
// `build=` line, so a stale server or the wrong branch is visible on screen.
// Read once when Vite starts: source edits reload, but these values do not.
function git(command: string) {
  try {
    return execSync(`git ${command}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function startedAt() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// `--mode lan` (`npm run dev:lan`, `npm run preview:lan`) serves https with a
// local self-signed certificate: iPad WebKit runs plain-http pages about 15
// times slower. Without OpenSSL it falls back to http, with a warning.
function lanHttps(mode: string) {
  if (mode !== "lan") {
    return undefined;
  }
  const cert = ensureLanCert(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".cert"));
  if (!cert) {
    console.warn("[dotping] OpenSSL not found: serving plain http. iPad pages will run slowly (see docs/troubleshooting.md).");
    return undefined;
  }
  return { key: cert.key, cert: cert.cert };
}

export default defineConfig(({ command, mode }) => ({
  base: "/",
  server: { https: lanHttps(mode) },
  preview: { https: lanHttps(mode) },
  define: {
    __DOTPING_BUILD__: JSON.stringify({
      branch: git("rev-parse --abbrev-ref HEAD") || "unknown",
      commit: git("rev-parse --short HEAD") || "unknown",
      dirty: git("status --porcelain") !== "",
      startedAt: startedAt(),
      kind: command === "serve" ? "dev" : "build",
    }),
  },
}));
