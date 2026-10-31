#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const bumpType = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node scripts/bump-version.mjs [patch|minor|major]');
  process.exit(1);
}

const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = String(pkg.version || '1.0.0')
  .split('.')
  .map((n) => Number.parseInt(n, 10) || 0);

const nextVersion =
  bumpType === 'major'
    ? `${major + 1}.0.0`
    : bumpType === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

const today = new Date().toISOString().slice(0, 10);

pkg.version = nextVersion;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const lockPath = path.join(rootDir, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = nextVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = nextVersion;
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

const versionTsPath = path.join(rootDir, 'src/shared/version.ts');
const versionTsContent = `export const APP_VERSION = '${nextVersion}';\nexport const APP_RELEASE_DATE = '${today}';\nexport const APP_CODENAME = 'Grand Cinéma';\n`;
fs.writeFileSync(versionTsPath, versionTsContent, 'utf8');

console.log(`Version incrémentée : v${nextVersion} (${today})`);
