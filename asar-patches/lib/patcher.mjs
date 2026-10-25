/**
 * Patch model shared by the CLI commands.
 *
 * A patch module (`patches/NN-*.mjs`) exports:
 *
 *   id       stable slug, also the review diff's name
 *   title    one line, human readable
 *   entries  { key: '<path inside app.asar>' }
 *   edits    [{ id, entry, note, find, replace, marker }]
 *
 * `find` is matched literally; `replace` is written verbatim. `marker` is a short
 * distinctive string that only exists once the edit landed, which makes the
 * applied/pending decision independent of whether `find` is still present (an
 * insert-style edit keeps its anchor line).
 *
 * Keeping these in `.mjs` rather than JSON is deliberate: the rules contain tabs
 * and long template literals, and escaping them into JSON would make review worse
 * than useless. `review/*.diff` carries the readable form.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPLIED = 'applied';
export const PENDING = 'pending';
export const BLOCKED = 'blocked';

/** Load and validate every patch module in a directory, ordered by filename. */
export async function loadPatches(dir) {
  const files = readdirSync(dir)
    .filter((name) => /^\d{2}-.+\.mjs$/.test(name))
    .sort();
  if (files.length === 0) throw new Error(`no patch modules in ${dir}`);

  const patches = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    for (const key of ['id', 'title', 'entries', 'edits']) {
      if (mod[key] === undefined) throw new Error(`${file}: missing export "${key}"`);
    }
    for (const edit of mod.edits) {
      if (!mod.entries[edit.entry]) throw new Error(`${file}: edit ${edit.id} targets unknown entry key ${edit.entry}`);
      for (const key of ['id', 'find', 'replace', 'marker']) {
        if (!edit[key]) throw new Error(`${file}: edit ${edit.id} is missing "${key}"`);
      }
    }
    patches.push({ file, ...mod });
  }
  return patches;
}

/**
 * Classify a patch against the current entry texts.
 * @param patch loaded patch module
 * @param texts Map entry path -> string (current archive content)
 */
export function classifyPatch(patch, texts) {
  const edits = patch.edits.map((edit) => {
    const text = texts.get(patch.entries[edit.entry]) ?? '';
    const state = text.includes(edit.marker) ? APPLIED : text.includes(edit.find) ? PENDING : BLOCKED;
    return { ...edit, state };
  });
  const state = edits.some((e) => e.state === BLOCKED)
    ? BLOCKED
    : edits.every((e) => e.state === APPLIED)
      ? APPLIED
      : PENDING;
  return { patch, edits, state };
}

/** Apply every pending edit, returning the new entry texts plus a per-edit log. */
export function applyPatch(patch, texts) {
  const next = new Map(texts);
  const log = [];
  for (const edit of patch.edits) {
    const entryPath = patch.entries[edit.entry];
    const text = next.get(entryPath);
    if (text === undefined) throw new Error(`${patch.id}/${edit.id}: entry ${entryPath} was not read`);
    if (text.includes(edit.marker)) {
      log.push({ edit, action: 'skip', reason: 'already applied' });
      continue;
    }
    if (!text.includes(edit.find)) {
      throw new Error(
        `${patch.id}/${edit.id}: anchor not found in ${entryPath} — the app version changed; ` +
          `update patches/${patch.file} against the new bundle`,
      );
    }
    next.set(entryPath, text.replace(edit.find, edit.replace));
    log.push({ edit, action: 'applied' });
  }
  return { texts: next, log };
}

/** Human summary lines for a classified patch set. */
export function formatStatus(classified) {
  const lines = [];
  for (const item of classified) {
    lines.push(`${item.state.padEnd(8)} ${item.patch.id}  — ${item.patch.title}`);
    for (const edit of item.edits) {
      const marker = edit.state === BLOCKED ? '  (!) anchor missing, check the bundle' : '';
      lines.push(`  ${edit.state.padEnd(8)} ${edit.id}${marker}`);
    }
  }
  return lines;
}
