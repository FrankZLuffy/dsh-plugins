/**
 * Markdown workbench — Host half.
 *
 * Owns everything the browser half cannot do safely: reading and writing
 * workspace Markdown files, keeping a "last content the user saved here"
 * snapshot for per-source attribution, and running plain git commands.
 * The browser half talks to it over a same-origin prefix route.
 */
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

const PREFIX = '/typora/api'
const MAX_BODY = 8 * 1024 * 1024
const MAX_FILES = 1200
const MAX_DEPTH = 8
const TEXT_EXT = new Set(['.md', '.markdown', '.mdx', '.txt'])
const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', 'dist', 'build', '.next', 'out', 'vendor', '__pycache__'])

/** Root of the plugin's own small state directory. */
function stateRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'typora-workbench')
}

/**
 * Stable snapshot file name for one workspace-relative document.
 * @param {string} dir - Workspace root.
 * @param {string} rel - Workspace-relative path.
 * @returns {string} absolute snapshot path.
 */
function snapshotPath(dir, rel) {
  const key = createHash('sha1').update(dir + '::' + rel).digest('hex')
  return path.join(stateRoot(), 'snap', key + '.md')
}

/** An error carrying an HTTP status the route handler forwards. */
class HttpError extends Error {
  /**
   * @param {number} status - HTTP status to answer with.
   * @param {string} message - Human-readable reason.
   */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * Run git and never throw: callers decide from `ok`/`stderr`.
 * @param {string} cwd - Directory to run in.
 * @param {string[]} args - git argv.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>} result.
 */
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'git.exe' : 'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null || error === undefined,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') || (error ? String(error.message) : ''),
        })
      },
    )
  })
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
 * Read and parse a small JSON request body.
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
        reject(new HttpError(413, 'request body too large'))
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
        reject(new HttpError(400, 'invalid JSON body'))
      }
    })
    req.on('error', (error) => reject(new HttpError(400, String(error && error.message))))
  })
}

/**
 * Registered workspaces, for the workspace picker.
 * @param {any} ctx - host context.
 * @returns {Array<{id: string, title: string, path: string}>} workspace rows.
 */
function workspaceRows(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return []
  return registry.list().map((w) => ({ id: String(w.id), title: String(w.title), path: String(w.path) }))
}

/**
 * Resolve a client-supplied workspace root, refusing anything not registered.
 * @param {any} ctx - host context.
 * @param {unknown} dir - candidate absolute directory.
 * @returns {string} the canonical workspace path.
 */
function requireWorkspace(ctx, dir) {
  if (typeof dir !== 'string' || dir === '') throw new HttpError(400, 'missing workspace directory')
  const absolute = path.resolve(dir)
  const known = workspaceRows(ctx).find((w) => path.resolve(w.path) === absolute)
  if (known === undefined) throw new HttpError(403, 'directory is not a registered workspace')
  return known.path
}

/**
 * Join a workspace-relative path, refusing traversal.
 * @param {string} root - workspace root.
 * @param {unknown} rel - relative path from the client.
 * @returns {string} absolute file path.
 */
function resolveInside(root, rel) {
  if (typeof rel !== 'string' || rel.trim() === '') throw new HttpError(400, 'missing file path')
  const absolute = path.resolve(root, rel)
  const inside = path.relative(root, absolute)
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new HttpError(400, 'file path escapes the workspace')
  }
  return absolute
}

/**
 * Convert an absolute path back to the workspace-relative form with forward slashes.
 * @param {string} root - workspace root.
 * @param {string} absolute - absolute path.
 * @returns {string} relative path.
 */
function relativeOf(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/')
}

/**
 * Parse `git status --porcelain=v1 -b` into branch and per-file codes.
 * @param {string} porcelain - raw output.
 * @returns {{branch: string, codes: Map<string, string>}} status.
 */
function parseStatus(porcelain) {
  const codes = new Map()
  let branch = ''
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('## ')) {
      const raw = line.slice(3).trim()
      branch = raw.startsWith('No commits yet on ')
        ? raw.slice('No commits yet on '.length) + '（还没有提交）'
        : raw.split('...')[0].trim()
      continue
    }
    if (line.length < 4) continue
    const code = line.slice(0, 2).trim() || line.slice(0, 1)
    let file = line.slice(3).trim()
    const arrow = file.indexOf(' -> ')
    if (arrow !== -1) file = file.slice(arrow + 4).trim()
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1)
    codes.set(file.split(path.sep).join('/'), code)
  }
  return { branch, codes }
}

/**
 * Walk one workspace and collect Markdown documents.
 * @param {string} root - workspace root.
 * @returns {Promise<Array<{rel: string, name: string, dir: string, size: number, mtime: number}>>} files.
 */
async function listDocuments(root) {
  const out = []
  const walk = async (dir, depth) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue
      let stat
      try {
        stat = await fs.stat(absolute)
      } catch {
        continue
      }
      const rel = relativeOf(root, absolute)
      out.push({
        rel,
        name: entry.name,
        dir: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel),
        size: stat.size,
        mtime: stat.mtimeMs,
      })
    }
  }
  await walk(root, 0)
  out.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'))
  return out
}

/**
 * Read the committed (HEAD) text of one document; '' when untracked.
 * @param {string} root - workspace root.
 * @param {string} rel - relative path.
 * @returns {Promise<string>} HEAD text.
 */
async function headText(root, rel) {
  const result = await git(root, ['show', 'HEAD:' + rel])
  return result.ok ? result.stdout : ''
}

/**
 * Read the panel snapshot, or '' when the file has never been saved here.
 * @param {string} dir - workspace root.
 * @param {string} rel - relative path.
 * @returns {Promise<string>} snapshot text.
 */
async function readSnapshot(dir, rel) {
  try {
    return await fs.readFile(snapshotPath(dir, rel), 'utf8')
  } catch {
    return ''
  }
}

/**
 * Persist the panel snapshot for one document.
 * @param {string} dir - workspace root.
 * @param {string} rel - relative path.
 * @param {string} text - content that the user just saved.
 * @returns {Promise<void>} completion.
 */
async function writeSnapshot(dir, rel, text) {
  const target = snapshotPath(dir, rel)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, text, 'utf8')
}

/**
 * Whether the directory sits inside a git work tree.
 * @param {string} root - workspace root.
 * @returns {Promise<boolean>} repository flag.
 */
async function isRepository(root) {
  const result = await git(root, ['rev-parse', '--is-inside-work-tree'])
  return result.ok && result.stdout.trim() === 'true'
}

/**
 * Build the payload for one document: current disk text plus both baselines.
 * @param {string} root - workspace root.
 * @param {string} rel - relative path.
 * @returns {Promise<Record<string, unknown>>} document payload.
 */
async function readDocument(root, rel) {
  const absolute = resolveInside(root, rel)
  let text
  let stat
  try {
    text = await fs.readFile(absolute, 'utf8')
    stat = await fs.stat(absolute)
  } catch {
    throw new HttpError(404, 'document not found')
  }
  const repo = await isRepository(root)
  const base = repo ? await headText(root, rel) : ''
  let snapshot = await readSnapshot(root, rel)
  const hasSnapshot = snapshot !== ''
  if (!hasSnapshot) snapshot = base
  return {
    ok: true,
    rel,
    text,
    base,
    mine: snapshot,
    snapshot: hasSnapshot,
    repo,
    mtime: stat.mtimeMs,
    size: stat.size,
  }
}

/**
 * Handle one API call.
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
    if (verb === 'GET' && (route === '/workspaces' || route === '/workspaces/')) {
      return sendJson(res, 200, { ok: true, workspaces: workspaceRows(ctx) })
    }

    if (verb === 'GET' && route === '/tree') {
      const root = requireWorkspace(ctx, url.searchParams.get('dir'))
      const repo = await isRepository(root)
      const status = repo ? parseStatus((await git(root, ['status', '--porcelain=v1', '-b', '--untracked-files=all'])).stdout) : { branch: '', codes: new Map() }
      const files = await listDocuments(root)
      return sendJson(res, 200, {
        ok: true,
        repo,
        branch: status.branch,
        files: files.map((file) => ({ ...file, status: status.codes.get(file.rel) ?? '' })),
      })
    }

    if (verb === 'GET' && route === '/file') {
      const root = requireWorkspace(ctx, url.searchParams.get('dir'))
      return sendJson(res, 200, await readDocument(root, url.searchParams.get('rel')))
    }

    if (verb === 'GET' && route === '/stat') {
      const root = requireWorkspace(ctx, url.searchParams.get('dir'))
      const absolute = resolveInside(root, url.searchParams.get('rel'))
      try {
        const stat = await fs.stat(absolute)
        return sendJson(res, 200, { ok: true, mtime: stat.mtimeMs, size: stat.size })
      } catch {
        return sendJson(res, 200, { ok: true, mtime: 0, size: 0 })
      }
    }

    if (verb === 'GET' && route === '/log') {
      const root = requireWorkspace(ctx, url.searchParams.get('dir'))
      const result = await git(root, ['log', '-12', '--pretty=%h\u0009%ad\u0009%s', '--date=format:%Y-%m-%d %H:%M'])
      return sendJson(res, 200, { ok: true, lines: result.ok ? result.stdout.split('\n').filter(Boolean) : [] })
    }

    if (verb === 'POST' && route === '/save') {
      const body = await readBody(req)
      const root = requireWorkspace(ctx, body.dir)
      const rel = String(body.rel ?? '')
      const text = String(body.text ?? '')
      if (!TEXT_EXT.has(path.extname(rel).toLowerCase())) throw new HttpError(400, 'only Markdown and text files are writable')
      const absolute = resolveInside(root, rel)
      await fs.mkdir(path.dirname(absolute), { recursive: true })
      await fs.writeFile(absolute, text, 'utf8')
      await writeSnapshot(root, rel, text)
      const stat = await fs.stat(absolute)
      return sendJson(res, 200, { ok: true, mtime: stat.mtimeMs, size: stat.size })
    }

    if (verb === 'POST' && route === '/mark') {
      const body = await readBody(req)
      const root = requireWorkspace(ctx, body.dir)
      const rel = String(body.rel ?? '')
      const absolute = resolveInside(root, rel)
      const text = await fs.readFile(absolute, 'utf8')
      await writeSnapshot(root, rel, text)
      return sendJson(res, 200, { ok: true })
    }

    if (verb === 'POST' && route === '/init') {
      const body = await readBody(req)
      const root = requireWorkspace(ctx, body.dir)
      const result = await git(root, ['init'])
      return sendJson(res, 200, { ok: result.ok, output: (result.stdout + result.stderr).trim() })
    }

    if (verb === 'POST' && route === '/commit') {
      const body = await readBody(req)
      const root = requireWorkspace(ctx, body.dir)
      const message = String(body.message ?? '').trim()
        || '更新 ' + new Date().toLocaleString('zh-CN', { hour12: false })
      if (!(await isRepository(root))) throw new HttpError(400, '这个目录还不是 Git 仓库，先点「初始化 Git」')
      const pending = await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
      if (pending.ok && pending.stdout.trim() === '') {
        return sendJson(res, 200, { ok: false, output: '没有可提交的改动。' })
      }
      const staged = await git(root, ['add', '-A'])
      if (!staged.ok) return sendJson(res, 200, { ok: false, output: (staged.stdout + staged.stderr).trim() })
      const committed = await git(root, ['commit', '-m', message])
      return sendJson(res, 200, { ok: committed.ok, output: (committed.stdout + committed.stderr).trim() })
    }

    if (verb === 'GET' && route === '/ping') return sendJson(res, 200, { ok: true, pong: Date.now() })

    return sendJson(res, 404, { ok: false, error: 'unknown route ' + route })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    sendJson(res, status, { ok: false, error: String((error && error.message) || error) })
  }
}

/**
 * Host plugin body: register the API prefix route with the web server.
 * @param {any} ctx - host context.
 */
export function apply(ctx) {
  const server = ctx.get('webServer')
  if (server === undefined) return
  ctx.effect(
    () => server.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => handle(ctx, req, res),
    }),
    'typora-workbench: api route',
  )
}
