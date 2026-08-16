// Syntax check: node --check every .js/.mjs/.cjs under the project.
// Usage: npm run check
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', '.lsp', 'docs']);
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p);
    } else if (/\.(js|mjs|cjs)$/.test(name)) {
      files.push(p);
    }
  }
}
walk('.');

let failed = 0;
for (const f of files) {
  const r = spawnSync('node', ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`FAIL ${f}`);
    console.error(r.stderr || r.stdout);
    failed++;
  } else {
    console.log(`ok   ${f}`);
  }
}

console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);