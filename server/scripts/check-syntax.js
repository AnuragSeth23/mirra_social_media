// Fast safety net without a compiler: asks Node to parse every server source file and script.
// A typo, a missing bracket or a bad import path (as far as syntax goes) is reported before anything runs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'uploads') walk(p); }
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
walk(path.join(root, 'src'));
walk(path.join(root, 'scripts'));

let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { bad++; console.error(`✗ ${path.relative(root, f)}\n${e.stderr?.toString().split('\n').slice(0, 4).join('\n')}`); }
}
if (bad) { console.error(`${bad} file(s) have syntax errors.`); process.exit(1); }
console.log(`✓ ${files.length} server files parse cleanly`);
