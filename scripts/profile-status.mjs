#!/usr/bin/env node
/**
 * profile-status — compare the tracked copy of the DSH profile config in
 * ./profile against the live profile directory under $DSH_HOME (default ~/.dsh).
 *
 *   node scripts/profile-status.mjs                  report drift only (exit 1 if drifted)
 *   node scripts/profile-status.mjs --push           repo -> live profile (old file kept as .bak)
 *   node scripts/profile-status.mjs --pull           live profile -> repo (then review with git diff)
 *   node scripts/profile-status.mjs --profile web    inspect another profile
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files mirrored between this repo and the live profile. */
const TRACKED = ['package.json', 'cordis.patch.yml'];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.join(repoRoot, 'profile');

const argv = process.argv.slice(2);
const mode = argv.includes('--push') ? 'push' : argv.includes('--pull') ? 'pull' : 'status';
const profileIndex = argv.indexOf('--profile');
const profileName = profileIndex === -1 ? 'desktop' : argv[profileIndex + 1];

if (!profileName) {
  console.error('profile-status: --profile needs a name');
  process.exit(2);
}

const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const liveDir = path.join(home, 'profiles', profileName);

const readIfExists = async (file) => (existsSync(file) ? readFile(file) : null);
const label = (buf) => (buf === null ? '(absent)' : `${buf.length} B`);

const rows = [];
for (const name of TRACKED) {
  const repoFile = path.join(repoDir, name);
  const liveFile = path.join(liveDir, name);
  const [repoBuf, liveBuf] = [await readIfExists(repoFile), await readIfExists(liveFile)];
  const state =
    repoBuf !== null && liveBuf !== null && repoBuf.equals(liveBuf)
      ? 'same'
      : repoBuf === null
        ? 'missing in repo'
        : liveBuf === null
          ? 'missing in live profile'
          : 'differs';
  rows.push({ name, repoFile, liveFile, repoBuf, liveBuf, state });
}

console.log(`repo:  ${repoDir}`);
console.log(`live:  ${liveDir}`);
for (const row of rows) {
  console.log(`  ${row.state.padEnd(22)} ${row.name}  repo ${label(row.repoBuf)} / live ${label(row.liveBuf)}`);
}

const drifted = rows.filter((row) => row.state !== 'same');

if (mode === 'status') {
  if (drifted.length === 0) {
    console.log('profile-status: in sync');
    process.exit(0);
  }
  console.log('profile-status: DRIFT — use --push (repo -> live) or --pull (live -> repo)');
  process.exit(1);
}

const fromRepo = mode === 'push';
const [fromDir, toDir] = fromRepo ? [repoDir, liveDir] : [liveDir, repoDir];

if (drifted.length === 0) {
  console.log(`profile-status: nothing to ${mode}`);
  process.exit(0);
}

await mkdir(toDir, { recursive: true });
for (const row of drifted) {
  const source = path.join(fromDir, row.name);
  const target = path.join(toDir, row.name);
  if (!existsSync(source)) {
    console.log(`  skip ${row.name}: source ${source} does not exist`);
    continue;
  }
  if (existsSync(target)) await copyFile(target, `${target}.bak`);
  await copyFile(source, target);
  console.log(`  ${fromDir === repoDir ? 'pushed' : 'pulled'} ${row.name} -> ${target}`);
}
console.log(`profile-status: ${mode} done${fromRepo ? '' : ' — review with git diff, then commit'}`);
