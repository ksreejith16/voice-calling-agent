// Resolve direct dependencies to the already installed, tested lockfile versions.
const fs = require('node:fs');
const path = require('node:path');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
for (const workspace of ['', 'apps/api', 'apps/web', 'packages/database']) {
  const file = path.join(workspace, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (name.startsWith('@india-voice/')) continue;
      const entry = lock.packages[`${workspace ? workspace + '/' : ''}node_modules/${name}`]
        ?? lock.packages[`node_modules/${name}`];
      if (!entry?.version) throw new Error(`Missing resolved version: ${name}`);
      manifest[section][name] = entry.version;
    }
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}
