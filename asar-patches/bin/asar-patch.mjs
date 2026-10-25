#!/usr/bin/env node
/**
 * asar-patch — re-apply the local DeepSeek Harness bundle patches after an app update.
 *
 *   node bin/asar-patch.mjs status   [--asar <path>]          report applied / pending / blocked
 *   node bin/asar-patch.mjs apply    [--asar <path>] [--dry-run]
 *   node bin/asar-patch.mjs preview  [--asar <path>] --out <dir>
 *
 * The archive is never edited in place: a new one is built next to it, verified by
 * reading it back, and only then swapped in with the old file kept as
 * app.asar.bak-<timestamp>. Nothing takes effect until DeepSeek Harness restarts.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEntry, readHeader, repackAsar, sha256 } from '../lib/asar.mjs';
import { APPLIED, applyPatch, BLOCKED, classifyPatch, formatStatus, loadPatches } from '../lib/patcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATCH_DIR = path.resolve(here, '..', 'patches');

const DEFAULT_ASAR = path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local'),
  'Programs',
  'DeepSeek Harness',
  'resources',
  'app.asar',
);

const usage = `asar-patch — local patches for the DeepSeek Harness app.asar

  node bin/asar-patch.mjs status  [--asar <path>]     report applied / pending / blocked
  node bin/asar-patch.mjs apply   [--asar <path>] [--dry-run]
  node bin/asar-patch.mjs preview [--asar <path>] --out <dir>

Default archive: ${DEFAULT_ASAR}
Override with --asar or the DSH_ASAR environment variable.
`;

function parseArgs(argv) {
  const args = {
    command: argv[0] ?? 'status',
    asar: process.env.DSH_ASAR ?? DEFAULT_ASAR,
    dryRun: false,
    out: null,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--asar') args.asar = requireValue(argv, ++i, '--asar');
    else if (arg === '--out') args.out = requireValue(argv, ++i, '--out');
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function requireValue(argv, i, flag) {
  const value = argv[i];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}

/** Read every entry the patch set touches, as UTF-8 text with a round-trip guard. */
function readTargets(patches, asarPath) {
  const header = readHeader(asarPath);
  const texts = new Map();
  const buffers = new Map();
  for (const patch of patches) {
    for (const entryPath of Object.values(patch.entries)) {
      if (texts.has(entryPath)) continue;
      const buf = readEntry(asarPath, entryPath, header);
      const text = buf.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(buf)) {
        throw new Error(`entry is not clean UTF-8, refusing to patch: ${entryPath}`);
      }
      texts.set(entryPath, text);
      buffers.set(entryPath, buf);
    }
  }
  return { header, texts, buffers };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function statusCommand(args, classified, texts) {
  console.log(`archive: ${args.asar}`);
  console.log(`entries: ${texts.size}`);
  for (const line of formatStatus(classified)) console.log(line);
  const bad = classified.filter((item) => item.state !== APPLIED);
  if (bad.length === 0) {
    console.log('\nall patches applied');
    return 0;
  }
  const blocked = bad.filter((item) => item.state === BLOCKED);
  console.log(
    blocked.length
      ? '\nblocked: the anchors moved (new app version?). Update the patch modules against the new bundle.'
      : '\npending: run `node bin/asar-patch.mjs apply`',
  );
  return 1;
}

function previewCommand(args, patches, texts, buffers) {
  if (!args.out) {
    console.error('preview needs --out <dir>');
    return 2;
  }
  mkdirSync(path.join(args.out, 'before'), { recursive: true });
  mkdirSync(path.join(args.out, 'after'), { recursive: true });
  for (const patch of patches) {
    const after = applyPatch(patch, texts).texts;
    for (const [key, entryPath] of Object.entries(patch.entries)) {
      const base = `${patch.id}--${key}.js`;
      writeFileSync(path.join(args.out, 'before', base), buffers.get(entryPath));
      writeFileSync(path.join(args.out, 'after', base), after.get(entryPath));
      console.log(`wrote ${base}  -> ${entryPath}`);
    }
  }
  console.log('\nreview with: git diff --no-index -- <out>/before/<file> <out>/after/<file>');
  return 0;
}

function applyCommand(args, patches, texts) {
  const replacements = new Map();
  for (const patch of patches) {
    const result = applyPatch(patch, texts);
    for (const item of result.log) console.log(`  ${item.action.padEnd(7)} ${patch.id}/${item.edit.id}`);
    for (const [entryPath, after] of result.texts) {
      if (after !== texts.get(entryPath)) replacements.set(entryPath, Buffer.from(after, 'utf8'));
      texts.set(entryPath, after);
    }
  }

  const dir = path.dirname(args.asar);
  const token = stamp();
  const staged = path.join(dir, `app.asar.new-${token}`);
  const result = repackAsar({ asarPath: args.asar, replacements, outputPath: staged });
  console.log(
    `\nrebuilt ${result.bytes} B (${result.entries} entries, ${result.replaced} replaced) -> ${path.basename(staged)}`,
  );

  // Confirm the semantic result of the staged archive before touching the install.
  for (const [entryPath, buf] of replacements) {
    if (sha256(buf) !== sha256(readEntry(staged, entryPath))) {
      throw new Error(`staged archive mismatch: ${entryPath}`);
    }
  }
  const stagedTexts = new Map();
  for (const patch of patches) {
    for (const [key, entryPath] of Object.entries(patch.entries)) {
      if (!stagedTexts.has(entryPath)) stagedTexts.set(entryPath, readEntry(staged, entryPath).toString('utf8'));
      void key;
    }
  }
  const stagedClassification = patches.map((patch) => classifyPatch(patch, stagedTexts));
  const stillBad = stagedClassification.filter((item) => item.state !== APPLIED);
  if (stillBad.length) {
    rmSync(staged);
    throw new Error(`staged archive did not reach "applied": ${stillBad.map((i) => i.patch.id).join(', ')}`);
  }

  if (args.dryRun) {
    rmSync(staged);
    console.log('dry run: staged archive verified and removed; the install was not touched');
    return 0;
  }

  const backup = `${args.asar}.bak-${token}`;
  renameSync(args.asar, backup);
  try {
    renameSync(staged, args.asar);
  } catch (error) {
    renameSync(backup, args.asar);
    throw new Error(`swap failed, original restored: ${error.message}`);
  }
  console.log(`\nbackup: ${backup}`);
  console.log('quit and relaunch DeepSeek Harness — the patched bundle is read at startup.');
  return 0;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${usage}`);
    return 2;
  }
  if (args.help) {
    console.log(usage);
    return 0;
  }
  if (!existsSync(args.asar)) {
    console.error(`archive not found: ${args.asar}\n(pass --asar or set DSH_ASAR)`);
    return 2;
  }

  const patches = await loadPatches(PATCH_DIR);
  const { texts, buffers } = readTargets(patches, args.asar);
  const classified = patches.map((patch) => classifyPatch(patch, texts));

  switch (args.command) {
    case 'status':
      return statusCommand(args, classified, texts);
    case 'preview':
      return previewCommand(args, patches, texts, buffers);
    case 'apply':
      if (classified.every((item) => item.state === APPLIED)) {
        console.log('nothing to do: every patch is already applied');
        return 0;
      }
      return applyCommand(args, patches, texts);
    default:
      console.error(`unknown command: ${args.command}\n\n${usage}`);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\nasar-patch: ${error.message}`);
    process.exitCode = 1;
  });
