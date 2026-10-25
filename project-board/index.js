/**
 * Project Board — Host half.
 *
 * Keeps the user's project roots (a folder or a single file each) in one small
 * JSON store, serves the board's API on the Web server, opens file entries with
 * their system default application, and exposes the same store to the agent as
 * the `project_board` tool.
 *
 * Folder entries are opened from the browser through the shipped
 * `open-in-app` routes, so the board shows exactly the same installed-editor,
 * Git-GUI, terminal, and file-manager choices as the Session header's split
 * button. This host half only owns the data and the file-entry gestures.
 */
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'

const PREFIX = '/project-board/api'
const MAX_BODY = 64 * 1024
const KIND_DIR = 'dir'
const KIND_FILE = 'file'

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
  return path.join(home, 'project-board')
}

/** Absolute path of the project store. */
function storeFile() {
  return path.join(stateRoot(), 'projects.json')
}

/** One short random entry id. */
function newId() {
  return randomBytes(6).toString('hex')
}

/**
 * Human-facing name for one absolute path; drive roots keep their full path.
 * @param {string} absolute - absolute path.
 * @returns {string} display name.
 */
function displayName(absolute) {
  return path.basename(absolute) || absolute
}

/**
 * Kind of one path from its stat result.
 * @param {import('node:fs').Stats} stat - stat result.
 * @returns {'dir' | 'file'} entry kind.
 */
function kindOf(stat) {
  return stat.isDirectory() ? KIND_DIR : KIND_FILE
}

/**
 * Project list in board order: pinned entries first, otherwise unchanged.
 * @param {unknown} raw - parsed store body.
 * @returns {{version: number, projects: Array<Record<string, unknown>>}} normalized store.
 */
function normalizeStore(raw) {
  const source = raw !== null && typeof raw === 'object' && Array.isArray(raw.projects) ? raw.projects : []
  const seen = new Set()
  const projects = []
  for (const item of source) {
    if (item === null || typeof item !== 'object' || typeof item.path !== 'string' || item.path === '') continue
    const absolute = path.resolve(item.path)
    const key = absolute.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    projects.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : newId(),
      path: absolute,
      name: typeof item.name === 'string' && item.name !== '' ? item.name : displayName(absolute),
      kind: item.kind === KIND_FILE ? KIND_FILE : KIND_DIR,
      pinned: item.pinned === true,
      addedAt: typeof item.addedAt === 'string' ? item.addedAt : new Date().toISOString(),
    })
  }
  const pinned = projects.filter((project) => project.pinned)
  return { version: 1, projects: [...pinned, ...projects.filter((project) => !project.pinned)] }
}

/**
 * Serialize writes so two quick gestures cannot interleave on one file.
 * @param {{version: number, projects: Array<Record<string, unknown>>}} store - store to persist.
 * @returns {Promise<void>} completion of this write.
 */
let writeQueue = Promise.resolve()
function saveStore(store) {
  const body = JSON.stringify(store, null, 2)
  const run = async () => {
    await fs.mkdir(stateRoot(), { recursive: true })
    const temporary = storeFile() + '.' + String(process.pid) + '.tmp'
    await fs.writeFile(temporary, body, 'utf8')
    await fs.rename(temporary, storeFile())
  }
  const next = writeQueue.then(run, run)
  writeQueue = next.catch(() => {})
  return next
}

/**
 * Seed a first-run board from the workspaces already registered in this profile.
 * @param {any} ctx - host context.
 * @returns {Promise<Array<Record<string, unknown>>>} seed entries.
 */
async function seedFromWorkspaces(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || registry === null) return []
  let rows = []
  try {
    rows = registry.list()
  } catch {
    return []
  }
  const seeded = []
  const seen = new Set()
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || typeof row.path !== 'string') continue
    const absolute = path.resolve(row.path)
    const key = absolute.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    let stat
    try {
      stat = await fs.stat(absolute)
    } catch {
      continue
    }
    seeded.push({
      id: newId(),
      path: absolute,
      name: displayName(absolute),
      kind: kindOf(stat),
      pinned: false,
      addedAt: new Date().toISOString(),
    })
  }
  return seeded
}

/**
 * Read the store, seeding it from registered workspaces on first use.
 * @param {any} ctx - host context.
 * @returns {Promise<{version: number, projects: Array<Record<string, unknown>>}>} store.
 */
async function loadStore(ctx) {
  try {
    const raw = await fs.readFile(storeFile(), 'utf8')
    return normalizeStore(JSON.parse(raw))
  } catch {
    const seeded = await seedFromWorkspaces(ctx)
    const store = { version: 1, projects: seeded }
    if (seeded.length > 0) {
      try {
        await saveStore(store)
      } catch {
        /* a read-only home still serves an in-memory board */
      }
    }
    return store
  }
}

/**
 * Store entries plus their current on-disk state.
 * @param {any} ctx - host context.
 * @returns {Promise<Array<Record<string, unknown>>>} board rows.
 */
async function projectRows(ctx) {
  const store = await loadStore(ctx)
  const rows = []
  for (const project of store.projects) {
    let stat
    try {
      stat = await fs.stat(project.path)
    } catch {
      stat = undefined
    }
    rows.push({
      ...project,
      kind: stat === undefined ? project.kind : kindOf(stat),
      exists: stat !== undefined,
    })
  }
  return rows
}

/**
 * Normalize one user-supplied path: trim, drop wrapping quotes, expand `~`,
 * require absolute, and resolve separators.
 * @param {unknown} value - raw path from the UI or tool.
 * @returns {string} absolute path.
 */
function parsePathInput(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'bad-request')
  let text = value.trim().replace(/^\uFEFF/, '')
  if (text.length > 1 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim()
  }
  if (text === '') throw new HttpError(400, 'bad-request')
  if (text === '~') text = os.homedir()
  else if (text.startsWith('~/') || text.startsWith('~\\')) text = path.join(os.homedir(), text.slice(2))
  if (!path.isAbsolute(text)) throw new HttpError(400, 'not-absolute')
  return path.resolve(text)
}

/**
 * Validate and insert one project.
 * @param {any} ctx - host context.
 * @param {unknown} rawPath - user-supplied path.
 * @returns {Promise<{projects: Array<Record<string, unknown>>, added: Record<string, unknown>}>} result.
 */
async function addProject(ctx, rawPath) {
  const absolute = parsePathInput(rawPath)
  let stat
  try {
    stat = await fs.stat(absolute)
  } catch {
    throw new HttpError(404, 'not-found')
  }
  const store = await loadStore(ctx)
  const key = absolute.toLowerCase()
  if (store.projects.some((project) => project.path.toLowerCase() === key)) {
    throw new HttpError(409, 'duplicate')
  }
  const added = {
    id: newId(),
    path: absolute,
    name: displayName(absolute),
    kind: kindOf(stat),
    pinned: false,
    addedAt: new Date().toISOString(),
  }
  store.projects.unshift(added)
  await saveStore(store)
  return { projects: await projectRows(ctx), added }
}

/**
 * Remove one project by id.
 * @param {any} ctx - host context.
 * @param {unknown} id - entry id.
 * @returns {Promise<{projects: Array<Record<string, unknown>>}>} remaining rows.
 */
async function removeProject(ctx, id) {
  if (typeof id !== 'string' || id === '') throw new HttpError(400, 'bad-request')
  const store = await loadStore(ctx)
  const before = store.projects.length
  store.projects = store.projects.filter((project) => project.id !== id)
  if (store.projects.length === before) throw new HttpError(404, 'not-registered')
  await saveStore(store)
  return { projects: await projectRows(ctx) }
}

/**
 * Pin or unpin one project. Pinning moves it to the head of the pinned group;
 * unpinning moves it to the head of the unpinned group.
 * @param {any} ctx - host context.
 * @param {unknown} id - entry id.
 * @param {unknown} pinned - requested flag.
 * @returns {Promise<{projects: Array<Record<string, unknown>>}>} updated rows.
 */
async function setPinned(ctx, id, pinned) {
  if (typeof id !== 'string' || id === '') throw new HttpError(400, 'bad-request')
  const store = await loadStore(ctx)
  const target = store.projects.find((project) => project.id === id)
  if (target === undefined) throw new HttpError(404, 'not-registered')
  target.pinned = pinned === true
  const others = store.projects.filter((project) => project.id !== id)
  if (target.pinned) {
    const pinnedBefore = others.filter((project) => project.pinned)
    const unpinned = others.filter((project) => !project.pinned)
    store.projects = [target, ...pinnedBefore, ...unpinned]
  } else {
    const pinnedBefore = others.filter((project) => project.pinned)
    const unpinned = others.filter((project) => !project.pinned)
    store.projects = [...pinnedBefore, target, ...unpinned]
  }
  await saveStore(store)
  return { projects: await projectRows(ctx) }
}

/**
 * Persist a dragged order. `pinnedCount` is how many leading entries the drag
 * left in the pinned group, so dropping a card into that group pins it and
 * pushing one out unpins it.
 * @param {any} ctx - host context.
 * @param {unknown} ids - entry ids in visual order.
 * @param {unknown} pinnedCount - leading pinned entries.
 * @returns {Promise<{projects: Array<Record<string, unknown>>}>} updated rows.
 */
async function reorderProjects(ctx, ids, pinnedCount) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new HttpError(400, 'bad-request')
  const count = typeof pinnedCount === 'number' && Number.isFinite(pinnedCount) ? Math.max(0, Math.trunc(pinnedCount)) : 0
  const store = await loadStore(ctx)
  const byId = new Map(store.projects.map((project) => [project.id, project]))
  const ordered = []
  for (const id of ids) {
    const project = byId.get(id)
    if (project === undefined) continue
    byId.delete(id)
    ordered.push(project)
  }
  for (const project of byId.values()) ordered.push(project)
  if (ordered.length !== store.projects.length) throw new HttpError(400, 'bad-request')
  ordered.forEach((project, index) => {
    project.pinned = index < Math.min(count, ordered.length)
  })
  store.projects = ordered
  await saveStore(store)
  return { projects: await projectRows(ctx) }
}

/**
 * Open one registered path with the operating system's default application.
 *
 * `Start-Process` has no `-LiteralPath` parameter, so the previous command
 * failed silently inside the hidden PowerShell. `Invoke-Item -LiteralPath`
 * performs the shell association and accepts paths with spaces, brackets and
 * non-ASCII names. The call waits for this short-lived PowerShell so a failure
 * reaches the user instead of looking like a no-op.
 * @param {string} target - absolute path.
 * @returns {Promise<{ok: boolean, message?: string}>} launch outcome.
 */
function openWithDefaultApp(target) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    if (process.platform === 'win32') {
      const literal = "'" + target.replace(/'/g, "''") + "'"
      const child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-Command', 'Invoke-Item -LiteralPath ' + literal,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      if (child.stderr !== null) {
        child.stderr.on('data', (chunk) => {
          if (stderr.length < 2000) stderr += String(chunk)
        })
      }
      child.on('error', (error) => finish({ ok: false, message: error.message }))
      child.on('close', (code) => {
        const detail = stderr.trim()
        finish(code === 0 && detail === ''
          ? { ok: true }
          : { ok: false, message: detail || ('powershell exit ' + String(code)) })
      })
      const timer = setTimeout(() => finish({ ok: true }), 5000)
      if (typeof timer.unref === 'function') timer.unref()
      return
    }
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
    try {
      const child = spawn(command, [target], { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('error', (error) => finish({ ok: false, message: error.message }))
      child.once('spawn', () => {
        child.unref()
        finish({ ok: true })
      })
    } catch (error) {
      finish({ ok: false, message: String((error && error.message) || error) })
    }
  })
}

/**
 * Reveal one path in the operating system's file manager.
 * @param {string} target - absolute path.
 * @returns {void}
 */
function revealInFileManager(target) {
  const options = { detached: true, stdio: 'ignore', windowsHide: true }
  let child
  if (process.platform === 'win32') {
    child = spawn('explorer.exe', ['/select,', target], options)
  } else if (process.platform === 'darwin') {
    child = spawn('open', ['-R', target], options)
  } else {
    child = spawn('xdg-open', [path.dirname(target)], options)
  }
  child.on('error', () => {})
  child.unref()
}

/**
 * Open or reveal one project already registered on the board.
 * @param {any} ctx - host context.
 * @param {unknown} id - entry id.
 * @param {unknown} action - `default` or `reveal`.
 * @returns {Promise<{ok: true}>} acknowledgement.
 */
async function openProjectPath(ctx, id, action) {
  if (typeof id !== 'string' || id === '') throw new HttpError(400, 'bad-request')
  const kind = action === 'reveal' ? 'reveal' : 'default'
  const store = await loadStore(ctx)
  const project = store.projects.find((entry) => entry.id === id)
  if (project === undefined) throw new HttpError(404, 'not-registered')
  try {
    await fs.stat(project.path)
  } catch {
    throw new HttpError(404, 'not-found')
  }
  if (kind === 'reveal') {
    revealInFileManager(project.path)
    return { ok: true }
  }
  const outcome = await openWithDefaultApp(project.path)
  if (!outcome.ok) throw new HttpError(502, 'launch-failed')
  return { ok: true }
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
 * Handle one board API call.
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
    if (verb === 'GET' && (route === '/projects' || route === '/projects/')) {
      return sendJson(res, 200, { ok: true, projects: await projectRows(ctx) })
    }
    if (verb === 'POST' && route === '/add') {
      requireJsonRequest(req)
      const body = await readBody(req)
      return sendJson(res, 200, { ok: true, ...(await addProject(ctx, body.path)) })
    }
    if (verb === 'POST' && route === '/remove') {
      requireJsonRequest(req)
      const body = await readBody(req)
      return sendJson(res, 200, { ok: true, ...(await removeProject(ctx, body.id)) })
    }
    if (verb === 'POST' && route === '/pin') {
      requireJsonRequest(req)
      const body = await readBody(req)
      return sendJson(res, 200, { ok: true, ...(await setPinned(ctx, body.id, body.pinned)) })
    }
    if (verb === 'POST' && route === '/reorder') {
      requireJsonRequest(req)
      const body = await readBody(req)
      return sendJson(res, 200, { ok: true, ...(await reorderProjects(ctx, body.ids, body.pinnedCount)) })
    }
    if (verb === 'POST' && route === '/open') {
      requireJsonRequest(req)
      const body = await readBody(req)
      return sendJson(res, 200, { ok: true, ...(await openProjectPath(ctx, body.id, body.action)) })
    }
    return sendJson(res, 404, { ok: false, code: 'bad-request', error: 'unknown route ' + route })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const code = error instanceof HttpError ? error.code : 'internal'
    sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
  }
}

/**
 * Agent-facing summary of the board.
 * @param {Array<Record<string, unknown>>} rows - board rows.
 * @returns {string} text.
 */
function summarize(rows) {
  if (rows.length === 0) return 'The Project Board is empty.'
  const lines = rows.map((row, index) => {
    const pin = row.pinned === true ? ' [pinned]' : ''
    const kind = row.kind === KIND_FILE ? 'file' : 'folder'
    const missing = row.exists === false ? ' [missing]' : ''
    return `${String(index + 1)}. ${String(row.name)} (${kind}) — ${String(row.path)}${pin}${missing}`
  })
  return [`Project Board — ${String(rows.length)} project(s):`, ...lines].join('\n')
}

/**
 * Keep only the fields the tool schema declares.
 * @param {Array<Record<string, unknown>>} rows - board rows.
 * @returns {Array<Record<string, unknown>>} schema-shaped rows.
 */
function toolRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    name: row.name,
    kind: row.kind,
    pinned: row.pinned === true,
    exists: row.exists !== false,
  }))
}

/** Tool schema: list/add/remove/pin the board. */
const toolDefinition = {
  name: 'project_board',
  description:
    'Read or change the DSH Project Board: the user\'s list of project roots (folders or files) shown as draggable cards. '
    + 'Use action "list" to see the board, "add" with an absolute path to put a project on it, "remove" with an id to take one off, '
    + 'and "pin" with an id to move it to the top (or unpin it). Opening a project with a local application stays user-only.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'remove', 'pin'],
        description: 'Operation to perform.',
      },
      path: {
        type: 'string',
        description: 'Absolute folder or file path; required by "add".',
      },
      id: {
        type: 'string',
        description: 'Entry id from "list"; required by "remove" and "pin".',
      },
      pinned: {
        type: 'boolean',
        description: 'For "pin": true pins to the top, false unpins. Defaults to true.',
      },
    },
    required: ['action'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              path: { type: 'string' },
              name: { type: 'string' },
              kind: { type: 'string' },
              pinned: { type: 'boolean' },
              exists: { type: 'boolean' },
            },
            required: ['id', 'path', 'name', 'kind', 'pinned', 'exists'],
          },
        },
      },
      required: ['ok', 'projects'],
    },
    render(_args, value) {
      const rows = Array.isArray(value?.projects) ? value.projects : []
      return [{ type: 'text', text: summarize(rows) }]
    },
  },
  async execute(args) {
    const action = args !== null && typeof args === 'object' ? args.action : undefined
    if (action === 'add') {
      const result = await addProject(hostContext, args.path)
      return { ok: true, projects: toolRows(result.projects) }
    }
    if (action === 'remove') {
      const result = await removeProject(hostContext, args.id)
      return { ok: true, projects: toolRows(result.projects) }
    }
    if (action === 'pin') {
      const result = await setPinned(hostContext, args.id, args.pinned !== false)
      return { ok: true, projects: toolRows(result.projects) }
    }
    if (action === 'list') {
      return { ok: true, projects: toolRows(await projectRows(hostContext)) }
    }
    throw new Error('unknown action; expected list, add, remove, or pin')
  },
}

/** Bound during apply so the tool and the HTTP routes share one Host context. */
let hostContext

/**
 * Host plugin body: serve the board API and register the agent tool.
 *
 * Both services are optional and may be provided by a fiber that is not ready
 * when this plugin activates, so wait for them with `ctx.inject` instead of
 * reading them once with `ctx.get`.
 * @param {any} ctx - host context.
 */
export function apply(ctx) {
  hostContext = ctx
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'prefix',
        path: PREFIX,
        handler: (req, res) => handle(webCtx, req, res),
      }),
      'project-board: api route',
    )
  })
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => toolCtx.tools.register(toolDefinition), 'project-board: tool')
  })
}
