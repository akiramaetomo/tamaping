import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(workspaceRoot, '.test-build');

if (process.argv.includes('--clean')) {
  await rm(buildDir, { force: true, recursive: true });
  process.exit(0);
}

await rewriteJavaScriptImports(buildDir);

async function rewriteJavaScriptImports(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteJavaScriptImports(fullPath);
      return;
    }

    if (!entry.isFile() || !entry.name.endsWith('.js')) {
      return;
    }

    const source = await readFile(fullPath, 'utf8');
    const rewritten = source
      .replace(/(from\s+['"])(\.[^'"]+?)(['"])/g, addJsExtension)
      .replace(/(import\s*\(\s*['"])(\.[^'"]+?)(['"]\s*\))/g, addJsExtension);

    if (rewritten !== source) {
      await writeFile(fullPath, rewritten, 'utf8');
    }
  }));
}

function addJsExtension(match, prefix, specifier, suffix) {
  if (path.extname(specifier) || specifier.endsWith('/')) {
    return match;
  }

  return `${prefix}${specifier}.js${suffix}`;
}
