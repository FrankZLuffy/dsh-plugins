/**
 * Minimal reader/writer for the Electron `app.asar` container.
 *
 * Container layout (little-endian), as used by @electron/asar:
 *
 *   [0  ..3 ] uint32  = 4                      (payload size of the size pickle)
 *   [4  ..7 ] uint32  = headerBufSize          (8 + padded JSON length)
 *   [8  ..11] uint32  = headerBufSize - 4      (payload size of the header pickle)
 *   [12 ..15] uint32  = jsonLen                (JSON length, unpadded)
 *   [16 ..   ] JSON, NUL-padded to 4-byte alignment
 *   [16 + paddedJsonLen .. ] entry data, in header-offset order
 *
 * Everything here is size-agnostic: offsets are recomputed on write, so a patch
 * may change an entry's byte length. Nothing is written unless the caller asks
 * for it, and every write is followed by a read-back self-test.
 */
import { closeSync, openSync, readSync, writeSync, fsyncSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const align4 = (n) => (n + 3) & ~3;

/** Read and parse the archive header. */
export function readHeader(asarPath) {
  const fd = openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    if (readSync(fd, sizeBuf, 0, 8, 0) !== 8) throw new Error(`cannot read asar header of ${asarPath}`);
    const headerBufSize = sizeBuf.readUInt32LE(4);
    const headerBuf = Buffer.alloc(headerBufSize);
    if (readSync(fd, headerBuf, 0, headerBufSize, 8) !== headerBufSize) throw new Error('truncated asar header');
    const jsonLen = headerBuf.readUInt32LE(4);
    const jsonText = headerBuf.toString('utf8', 8, 8 + jsonLen);
    const header = JSON.parse(jsonText.replace(/\0+$/, ''));
    const paddedJsonLen = align4(jsonLen);
    return {
      header,
      jsonLen,
      paddedJsonLen,
      headerBufSize,
      dataBase: 8 + headerBufSize,
      archiveSize: statSync(asarPath).size,
      /** Bytes 0..16 may be rebuilt only if these two fields are what we expect. */
      layoutOk: headerBufSize === 8 + paddedJsonLen && sizeBuf.readUInt32LE(0) === 4,
    };
  } finally {
    closeSync(fd);
  }
}

/** Flatten the header tree into leaf entries that carry data. */
export function listEntries(header) {
  const out = [];
  const walk = (node, prefix) => {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const entryPath = prefix ? `${prefix}/${name}` : name;
      if (value.files) walk(value, entryPath);
      else if (value.link !== undefined || value.unpacked === true) continue;
      else if (typeof value.size === 'number') out.push({ path: entryPath, size: value.size, offset: Number(value.offset) });
    }
  };
  walk(header, '');
  return out;
}

/** Locate a single entry's node in the header tree. */
function findNode(header, entryPath) {
  const parts = entryPath.split('/');
  let node = header;
  for (const part of parts) {
    node = node.files?.[part];
    if (!node) return undefined;
  }
  return node;
}

/** Read one entry as a Buffer. Throws when the entry does not exist. */
export function readEntry(asarPath, entryPath, header = readHeader(asarPath)) {
  const node = findNode(header.header, entryPath);
  if (!node) throw new Error(`entry not found in asar: ${entryPath}`);
  if (node.unpacked === true) throw new Error(`entry is unpacked, read it from app.asar.unpacked: ${entryPath}`);
  if (typeof node.size !== 'number') throw new Error(`entry has no data size (directory or link): ${entryPath}`);
  const buf = Buffer.alloc(node.size);
  const fd = openSync(asarPath, 'r');
  try {
    readSync(fd, buf, 0, node.size, header.dataBase + Number(node.offset));
  } finally {
    closeSync(fd);
  }
  return buf;
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Rebuild the archive with the given entries replaced.
 *
 * `replacements` maps entry path -> Buffer. Offsets for every subsequent entry
 * are recomputed, so replacements may change length. Returns the path written.
 */
export function repackAsar({ asarPath, replacements, outputPath }) {
  const header = readHeader(asarPath);
  if (!header.layoutOk) throw new Error(`unexpected asar header layout in ${asarPath}`);

  const entries = listEntries(header.header);
  const missing = [...replacements.keys()].filter((p) => !findNode(header.header, p));
  if (missing.length) throw new Error(`replacement targets not in archive: ${missing.join(', ')}`);

  const json = structuredClone(header.header);
  const byPath = new Map();
  const collect = (node, prefix) => {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const entryPath = prefix ? `${prefix}/${name}` : name;
      if (value.files) collect(value, entryPath);
      else byPath.set(entryPath, value);
    }
  };
  collect(json, '');

  let cursor = 0;
  const plan = [];
  for (const entry of entries) {
    const replacement = replacements.get(entry.path);
    const size = replacement ? replacement.length : entry.size;
    const node = byPath.get(entry.path);
    node.size = size;
    node.offset = String(cursor);
    plan.push({ ...entry, newSize: size, newOffset: cursor, replacement });
    cursor += size;
  }

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const paddedJsonLen = align4(jsonBuf.length);
  const headerBufSize = 8 + paddedJsonLen;
  const newHeaderSize = 8 + headerBufSize;
  const total = newHeaderSize + cursor;

  const out = Buffer.alloc(total); // archives here are ~200 MB; acceptable and simpler than streaming
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(headerBufSize, 4);
  out.writeUInt32LE(headerBufSize - 4, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  jsonBuf.copy(out, 16);
  // NUL padding after the JSON is already zero-filled by Buffer.alloc.

  const src = openSync(asarPath, 'r');
  try {
    for (const item of plan) {
      const target = newHeaderSize + item.newOffset;
      if (item.replacement) {
        item.replacement.copy(out, target);
        continue;
      }
      let read = 0;
      while (read < item.newSize) {
        const n = readSync(src, out, target + read, item.newSize - read, header.dataBase + item.offset + read);
        if (n <= 0) throw new Error(`short read for ${item.path}`);
        read += n;
      }
    }
  } finally {
    closeSync(src);
  }

  const fd = openSync(outputPath, 'w');
  try {
    let written = 0;
    while (written < out.length) written += writeSync(fd, out, written, out.length - written);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Read-back self-test: header parses, replacements round-trip, sample untouched entries match.
  const check = readHeader(outputPath);
  if (!check.layoutOk) throw new Error('self-test failed: written archive header does not parse');
  for (const [entryPath, buf] of replacements) {
    if (!readEntry(outputPath, entryPath, check).equals(buf)) throw new Error(`self-test failed: ${entryPath} did not round-trip`);
  }
  const untouched = plan.filter((p) => !p.replacement);
  for (const item of untouched.filter((_, i) => i % Math.max(1, Math.floor(untouched.length / 8)) === 0)) {
    const got = readEntry(outputPath, item.path, check);
    const want = readEntry(asarPath, item.path, header);
    if (!got.equals(want)) throw new Error(`self-test failed: untouched entry ${item.path} changed`);
  }
  return { outputPath, bytes: total, entries: plan.length, replaced: replacements.size };
}
