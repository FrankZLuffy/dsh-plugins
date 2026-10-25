#!/usr/bin/env node
/**
 * gen-review — regenerate the human-readable diff for each patch.
 *
 * The patch modules hold exact strings, which is right for applying and wrong for
 * reviewing. This script runs the rules against pristine entry files and records
 * the unified diff, so `review/*.diff` is what a reviewer reads and `git log` can
 * show how a patch changed over time.
 *
 *   node bin/gen-review.mjs 01 --baseline host=/path/to/index.js.orig
 *   node bin/gen-review.mjs 02 --baseline host=/path/to/index.js.before \
 *                               --baseline client=/path/to/client.js.before
 *
 * On this machine the pristine baselines live in ~/.dsh/fixes:
 *   01 → ~/.dsh/fixes/open-in-app/index.js.orig
 *   02 → ~/.dsh/fixes/open-in-app-typora/index.js.before
 *        ~/.dsh/fixes/open-in-app-typora/client.js.before
 * Capture new baselines before upgrading the app if you want review diffs for
 * the new bundle version.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPatches } from '../lib/patcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATCH_DIR = path.resolve(here, '..', 'patches');
const REVIEW_DIR = path.resolve(here, '..', 'review');

const argv = process.argv.slice(2);
const patchId = argv[0];
if (!patchId) {
  console.error('usage: node bin/gen-review.mjs <patch-id> --baseline <entryKey>=<file> [...]');
  process.exit(2);
}

const baselines = new Map();
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i] !== '--baseline') {
    console.error(`unknown argument: ${argv[i]}`);
    process.exit(2);
  }
  const pair = argv[i + 1] ?? '';
  const eq = pair.indexOf('=');
  if (eq < 1) {
    console.error(`--baseline needs <entryKey>=<file>, got: ${pair}`);
    process.exit(2);
  }
  baselines.set(pair.slice(0, eq), pair.slice(eq + 1));
  i += 1;
}

const patches = await loadPatches(PATCH_DIR);
const patch = patches.find((item) => item.id === patchId || item.id.startsWith(patchId));
if (!patch) {
  console.error(`no patch matches "${patchId}" in ${PATCH_DIR}`);
  process.exit(2);
}

const work = mkdtempSync(path.join(tmpdir(), 'asar-review-'));
let diff = `# ${patch.id} — ${patch.title}\n#\n# Unified diff of the rules in patches/${patch.file}.\n# Regenerate with: node bin/gen-review.mjs ${patch.id} --baseline ...\n`;

try {
  for (const [key, entryPath] of Object.entries(patch.entries)) {
    const baselineFile = baselines.get(key);
    if (!baselineFile) {
      console.error(`missing --baseline ${key}=<pristine ${entryPath}>`);
      process.exit(2);
    }
    const before = readFileSync(baselineFile, 'utf8');
    let after = before;
    for (const edit of patch.edits.filter((item) => item.entry === key)) {
      if (!after.includes(edit.find)) {
        console.error(`${patch.id}/${edit.id}: anchor not found in ${baselineFile}`);
        process.exit(1);
      }
      after = after.replace(edit.find, edit.replace);
    }

    const beforeFile = path.join(work, `${key}-before.js`);
    const afterFile = path.join(work, `${key}-after.js`);
    writeFileSync(beforeFile, before);
    writeFileSync(afterFile, after);

    let text = '';
    try {
      text = execFileSync(
        'git',
        ['diff', '--no-index', '--no-color', '--no-ext-diff', '--unified=4', '--', beforeFile, afterFile],
        { encoding: 'utf8' },
      );
    } catch (error) {
      if (error.status !== 1) throw error; // git diff exits 1 when there are differences
      text = error.stdout;
    }

    // Drop git's own header block (diff --git / index / --- / +++) and label the
    // hunks with the entry path inside the archive instead of a temp file.
    const lines = text.split('\n');
    const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
    const body = (firstHunk === -1 ? lines : lines.slice(firstHunk)).join('\n').trimEnd();
    diff += `\n--- a/${entryPath}\n+++ b/${entryPath}\n${body}\n`;
  }

  mkdirSync(REVIEW_DIR, { recursive: true });
  const target = path.join(REVIEW_DIR, `${patch.id}.diff`);
  writeFileSync(target, diff);
  console.log(`wrote ${target} (${diff.split('\n').length} lines)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
