/**
 * Chat Annotations — Host half.
 *
 * Keeps the annotations the user highlighted in one session, and appends them to
 * a Markdown file on request. The browser half owns the highlighting UI and the
 * conversation cross-links; this half owns only durable state and the one file
 * write that a browser cannot perform (append to an existing file).
 *
 * Routes (same-origin, JSON only):
 *   GET  /chat-annotations/api/list?session=<id>  -> { ok, annotations }
 *   POST /chat-annotations/api/save               -> { ok, count }
 *   POST /chat-annotations/api/export             -> { ok, path, created, appended }
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'

const PREFIX = '/chat-annotations/api'
const MAX_BODY = 2 * 1024 * 1024
const MAX_ANNOTATIONS = 500
const MAX_QUOTE = 4000
const MAX_NOTE = 8000

/** A failure carrying the HTTP status and stable code the route answers with. */
class HttpError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} code - stable machine-readable reason.
   */
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

/** Directory holding this plugin's own state. */
function stateRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'chat-annotations')
}

/** One short random annotation id. */
function newId() {
  return randomBytes(6).toString('hex')
}

/**
 * Session ids are file names here, so accept exactly the characters the store
 * mints and nothing that could escape the state directory.
 * @param {unknown} id - candidate session id.
 * @returns {boolean} whether it is safe to use as a file name.
 */
function validSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

/**
 * Absolute path of one session's annotation store.
 * @param {string} sessionId - validated session id.
 * @returns {string} file path.
 */
function sessionFile(sessionId) {
  return path.join(stateRoot(), sessionId + '.json')
}

/**
 * Coerce a bounded string field.
 * @param {unknown} value - untrusted value.
 * @param {number} max - maximum length.
 * @param {string} fallback - value for a non-string.
 * @returns {string} bounded string.
 */
function boundedText(value, max, fallback) {
  if (typeof value !== 'string') return fallback
  return value.length > max ? value.slice(0, max) : value
}

/**
 * Keep only well-shaped annotations; the wire payload is untrusted.
 * @param {unknown} raw - candidate list from the UI.
 * @returns {Array<Record<string, unknown>>} normalized annotations.
 */
function normalizeAnnotations(raw) {
  if (!Array.isArray(raw)) return []
  const normalized = []
  for (const item of raw.slice(0, MAX_ANNOTATIONS)) {
    if (item === null || typeof item !== 'object') continue
    const quote = boundedText(item.quote, MAX_QUOTE, '').trim()
    if (quote === '') continue
    normalized.push({
      id: boundedText(item.id, 64, '') || newId(),
      sessionId: boundedText(item.sessionId, 128, ''),
      nodeKey: boundedText(item.nodeKey, 256, ''),
      nodeKind: boundedText(item.nodeKind, 64, ''),
      seq: Number.isFinite(item.seq) ? Math.max(0, Math.floor(item.seq)) : 0,
      quote,
      start: Number.isFinite(item.start) ? Math.max(0, Math.floor(item.start)) : 0,
      note: boundedText(item.note, MAX_NOTE, ''),
      color: boundedText(item.color, 24, 'yellow'),
      createdAt: boundedText(item.createdAt, 40, new Date().toISOString()),
    })
  }
  return normalized
}

/**
 * Serialize writes so two quick saves cannot interleave on one file.
 * @param {string} file - target file.
 * @param {string} body - serialized JSON.
 * @returns {Promise<void>} completion of this write.
 */
let writeQueue = Promise.resolve()
function writeQueued(file, body) {
  const run = async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = file + '.' + String(process.pid) + '.tmp'
    await fs.writeFile(temporary, body, 'utf8')
    await fs.rename(temporary, file)
  }
  const next = writeQueue.then(run, run)
  writeQueue = next.catch(() => {})
  return next
}

/**
 * Read the stored annotations of one session.
 * @param {string} sessionId - validated session id.
 * @returns {Promise<Array<Record<string, unknown>>>} annotations.
 */
async function loadAnnotations(sessionId) {
  try {
    const raw = await fs.readFile(sessionFile(sessionId), 'utf8')
    const parsed = JSON.parse(raw)
    return normalizeAnnotations(parsed && parsed.annotations)
  } catch {
    return []
  }
}

/**
 * Replace the stored annotations of one session.
 * @param {string} sessionId - validated session id.
 * @param {Array<Record<string, unknown>>} annotations - normalized list.
 * @returns {Promise<void>} completion of this write.
 */
function saveAnnotations(sessionId, annotations) {
  const body = JSON.stringify({ version: 1, sessionId, annotations }, null, 2)
  return writeQueued(sessionFile(sessionId), body)
}

/**
 * One Markdown section for one export run: quote, optional note, source link.
 * @param {Array<Record<string, unknown>>} annotations - normalized list.
 * @param {{ heading: string, quoteLabel: string, noteLabel: string, sourceLabel: string }} labels - localized labels.
 * @returns {string} Markdown block without a trailing newline.
 */
function composeMarkdown(annotations, labels) {
  const stamp = new Date().toLocaleString('sv-SE', { hour12: false })
  const lines = ['## ' + labels.heading + ' · ' + stamp, '']
  annotations.forEach((annotation, index) => {
    if (index > 0) {
      lines.push('', '---', '')
    }
    const quote = String(annotation.quote)
    const quoted = quote.split(/\r?\n/u).map(line => '> ' + line).join('\n')
    lines.push('### ' + String(index + 1), '')
    lines.push('> ' + labels.quoteLabel + quoted.replace(/^> /u, ''))
    if (annotation.note !== '') {
      lines.push('', labels.noteLabel + String(annotation.note))
    }
    const session = String(annotation.sessionId || '')
    const seq = Number.isFinite(annotation.seq) ? String(annotation.seq) : '0'
    lines.push('', '[' + labels.sourceLabel + '](dsh://session/' + session + '?seq=' + seq + ')')
  })
  return lines.join('\n') + '\n'
}

/**
 * Resolve the export target: explicit path, else `<session cwd>/annotations.md`.
 * @param {any} ctx - host context.
 * @param {string} sessionId - validated session id.
 * @param {unknown} requested - user-supplied path (may be empty).
 * @returns {string} absolute file path.
 */
function resolveTarget(ctx, sessionId, requested) {
  let cwd = os.homedir()
  const sessions = ctx.get('sessions')
  try {
    const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    if (typeof session?.header?.cwd === 'string' && session.header.cwd !== '') cwd = session.header.cwd
  } catch {
    /* a cold session keeps the home fallback */
  }
  let text = boundedText(requested, 4096, '').trim().replace(/^\uFEFF/u, '')
  if (text.length > 1 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim()
  }
  if (text === '') return path.join(cwd, 'annotations.md')
  if (text === '~') text = os.homedir()
  else if (text.startsWith('~/') || text.startsWith('~\\')) text = path.join(os.homedir(), text.slice(2))
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(cwd, text)
}

/**
 * Append one export block to its target file, creating the file when absent.
 * @param {any} ctx - host context.
 * @param {Record<string, unknown>} body - request body.
 * @returns {Promise<{ok: true, path: string, created: boolean, appended: number}>} export result.
 */
async function exportMarkdown(ctx, body) {
  const sessionId = body.sessionId
  if (!validSessionId(sessionId)) throw new HttpError(400, 'bad-request')
  const annotations = normalizeAnnotations(body.annotations)
  if (annotations.length === 0) throw new HttpError(400, 'nothing-to-export')
  const labels = {
    heading: boundedText(body.heading, 120, 'Chat annotations'),
    quoteLabel: boundedText(body.quoteLabel, 40, '原文：'),
    noteLabel: boundedText(body.noteLabel, 40, '批注：'),
    sourceLabel: boundedText(body.sourceLabel, 40, '原文来源'),
  }
  const target = resolveTarget(ctx, sessionId, body.path)
  let existing = ''
  let created = false
  try {
    const stat = await fs.stat(target)
    if (stat.isDirectory()) throw new HttpError(400, 'is-directory')
    existing = await fs.readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof HttpError) throw error
    created = true
  }
  const block = composeMarkdown(annotations, labels)
  // A Markdown file may already end with its own newline; never glue two
  // sections onto one line, never leave three blank ones either.
  const separator = existing === ''
    ? ''
    : existing.endsWith('\n\n')
      ? ''
      : existing.endsWith('\n')
        ? '\n'
        : '\n\n'
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.appendFile(target, separator + block, 'utf8')
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new HttpError(403, 'forbidden')
    if (code === 'EISDIR') throw new HttpError(400, 'is-directory')
    throw new HttpError(500, 'write-failed')
  }
  return { ok: true, path: target, created, appended: block.length }
}

/**
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - JSON body.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Read a small JSON body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<Record<string, unknown>>} parsed body.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'payload-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new HttpError(400, 'bad-request'))
      }
    })
    req.on('error', () => reject(new HttpError(400, 'bad-request')))
  })
}

/**
 * Reject bodies that a cross-site form could submit without a preflight.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {void}
 */
function requireJsonRequest(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') throw new HttpError(403, 'forbidden')
  const type = req.headers['content-type']
  if (typeof type !== 'string' || !type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'bad-request')
  }
}

/**
 * Handle one annotations API call.
 * @param {any} ctx - host context.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 * @returns {Promise<void>} completion.
 */
async function handle(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const route = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || '/' : url.pathname
  const verb = (req.method ?? 'GET').toUpperCase()
  try {
    if (verb === 'GET' && (route === '/list' || route === '/list/')) {
      const sessionId = url.searchParams.get('session') ?? ''
      if (!validSessionId(sessionId)) throw new HttpError(400, 'bad-request')
      return sendJson(res, 200, { ok: true, annotations: await loadAnnotations(sessionId) })
    }
    if (verb === 'POST' && route === '/save') {
      requireJsonRequest(req)
      const body = await readBody(req)
      const sessionId = body.sessionId
      if (!validSessionId(sessionId)) throw new HttpError(400, 'bad-request')
      const annotations = normalizeAnnotations(body.annotations)
      await saveAnnotations(sessionId, annotations)
      return sendJson(res, 200, { ok: true, count: annotations.length })
    }
    if (verb === 'POST' && route === '/export') {
      requireJsonRequest(req)
      return sendJson(res, 200, await exportMarkdown(ctx, await readBody(req)))
    }
    return sendJson(res, 404, { ok: false, code: 'bad-request', error: 'unknown route ' + route })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const code = error instanceof HttpError ? error.code : 'internal'
    sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
  }
}

/**
 * Host plugin body: serve the annotations API.
 * @param {any} ctx - host context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: (req, res) => handle(webCtx, req, res),
      }),
      'chat-annotations: api route',
    )
  })
}
