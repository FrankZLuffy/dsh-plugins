/**
 * Attention Alerts — Host half.
 *
 * Raises a real Windows notification when a tool needs approval or a turn
 * finishes, so the alert reaches the user while DSH sits in the background or
 * is minimized. Nothing here depends on the Web page: the host observes the
 * durable Session log and shows the toast itself, which also means no timer in
 * a hidden tab can delay it.
 *
 * The durable Session log is the source of truth on purpose: `approval/asked`
 * is appended before any answerer runs, so an observer reading the log can
 * never swallow, reorder, or delay a decision. `turn/end` is the same commit
 * boundary the Conversation renders. Watching `approval/request` instead would
 * put this plugin inside the decision waterfall, where it could break the
 * answer flow merely by being installed.
 *
 * The toast is attributed to this app's own registered AppUserModelID, so it
 * carries the DeepSeek Harness name and icon and lands in the notification
 * center. It never takes focus; clicking it activates DSH like any toast.
 */
import path from 'node:path'
import { spawn } from 'node:child_process'

/** This app's registered toast identity (`Get-StartApps` reports it). */
const APP_ID = 'com.deepseek.dsh'

/** Identity used when the app's own shortcut is unavailable. */
const FALLBACK_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

/**
 * How long an ask stays silent before it becomes a toast. A request that is
 * decided inside this window (a fail-closed policy, no answerer, or a scripted
 * answer) never waited for a human, so alerting would be a false alarm.
 */
const ASK_GRACE_MS = 800

/**
 * How long a finished turn stays silent before it becomes a toast. A turn that
 * is immediately followed by another turn is a continuing job (a goal round),
 * not a finished task.
 */
const CONTINUATION_GRACE_MS = 1200

/** Windows sound names, chosen per mood. */
const SOUND = {
  approval: 'ms-winsoundevent:Notification.Reminder',
  done: 'ms-winsoundevent:Notification.Default',
  error: 'ms-winsoundevent:Notification.IM',
}

/**
 * Toast presentation script. The XML and identities arrive through the
 * environment so no user text is ever pasted into PowerShell source.
 */
const TOAST_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($env:DSH_TOAST_XML)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($document)
  $shown = $false
  foreach ($identity in @($env:DSH_TOAST_APPID, $env:DSH_TOAST_FALLBACK)) {
    if ([string]::IsNullOrEmpty($identity)) { continue }
    try {
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($identity).Show($toast)
      $shown = $true
      break
    } catch { }
  }
  if (-not $shown) { exit 1 }
} catch { exit 1 }
`

/** The script, pre-encoded for `-EncodedCommand` (UTF-16LE, base64). */
const ENCODED_SCRIPT = Buffer.from(TOAST_SCRIPT, 'utf16le').toString('base64')

/** Completion timers, keyed by session. */
const pendingTurns = new Map()

/** Ask timers, keyed by approval id. */
const pendingAsks = new Map()

/**
 * Escape text for XML content and attributes.
 * @param {unknown} value - raw text.
 * @returns {string} escaped text.
 */
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&apos;'
    }
  })
}

/**
 * Clip one line to a readable notification length.
 * @param {unknown} value - raw text.
 * @param {number} limit - maximum characters.
 * @returns {string} clipped text.
 */
function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? text.slice(0, limit - 1) + '\u2026' : text
}

/**
 * Build the toast document for one alert.
 * @param {{title: string, body: string, mood: string, long?: boolean}} alert - content.
 * @returns {string} toast XML.
 */
function toastXml(alert) {
  const duration = alert.long === true ? 'long' : 'short'
  const sound = SOUND[alert.mood] ?? SOUND.done
  return '<toast duration="' + duration + '">'
    + '<visual><binding template="ToastGeneric">'
    + '<text>' + escapeXml(clip(alert.title, 80)) + '</text>'
    + '<text>' + escapeXml(clip(alert.body, 200)) + '</text>'
    + '</binding></visual>'
    + '<audio src="' + escapeXml(sound) + '"/>'
    + '</toast>'
}

/**
 * Show one Windows notification. Fire and forget: a notification that cannot be
 * delivered must never disturb the agent loop.
 * @param {{title: string, body: string, mood: string, long?: boolean}} alert - content.
 * @returns {void}
 */
function showToast(alert) {
  if (process.platform !== 'win32') return
  let child
  try {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', ENCODED_SCRIPT,
    ], {
      env: { ...process.env, DSH_TOAST_XML: toastXml(alert), DSH_TOAST_APPID: APP_ID, DSH_TOAST_FALLBACK: FALLBACK_APP_ID },
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch {
    return
  }
  child.on('error', () => {})
  child.unref()
}

/**
 * Short human label for a session, derived from its working directory.
 * @param {any} session - session whose log grew.
 * @returns {string} directory basename, or a neutral fallback.
 */
function sessionLabel(session) {
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return '这个会话'
  const base = path.basename(cwd)
  return base === '' ? cwd : base
}

/**
 * Cancel every pending timer and forget it.
 * @returns {void}
 */
function clearTimers() {
  for (const timer of pendingTurns.values()) clearTimeout(timer)
  for (const timer of pendingAsks.values()) clearTimeout(timer)
  pendingTurns.clear()
  pendingAsks.clear()
}

/**
 * Alert for a permission request that is still unanswered after the grace.
 * @param {string} approvalId - request identity.
 * @param {any} session - requesting session.
 * @param {any} data - `approval/asked` payload.
 * @returns {void}
 */
function armApproval(approvalId, session, data) {
  const label = sessionLabel(session)
  const tool = typeof data?.toolName === 'string' ? data.toolName : '工具'
  const reason = typeof data?.reason === 'string' ? clip(data.reason, 120) : ''
  const timer = setTimeout(() => {
    pendingAsks.delete(approvalId)
    showToast({
      mood: 'approval',
      long: true,
      title: '需要授权',
      body: reason !== '' ? reason + '（' + label + '）' : tool + ' 请求越权执行（' + label + '）',
    })
  }, ASK_GRACE_MS)
  pendingAsks.set(approvalId, timer)
}

/**
 * Alert for a turn that finished and was not continued right away.
 * @param {any} session - session whose turn ended.
 * @param {any} data - `turn/end` payload.
 * @returns {void}
 */
function armTurn(session, data) {
  const sessionId = String(session.id)
  const previous = pendingTurns.get(sessionId)
  if (previous !== undefined) clearTimeout(previous)
  const status = data?.reason?.kind
  const label = sessionLabel(session)
  const timer = setTimeout(() => {
    pendingTurns.delete(sessionId)
    showToast(status === 'error'
      ? { mood: 'error', title: '任务中断', body: label + ' 的这一轮以错误结束' }
      : { mood: 'done', title: '任务完成', body: label + ' 的这一轮已经结束' })
  }, CONTINUATION_GRACE_MS)
  pendingTurns.set(sessionId, timer)
}

/**
 * Classify one committed Session event into an alert.
 * @param {any} session - session whose log grew.
 * @param {any} event - the appended event, exactly as recorded.
 * @returns {void}
 */
function observe(session, event) {
  if (session === null || session === undefined) return
  if (event === null || event === undefined) return
  const data = event.data
  if (event.type === 'approval/asked') {
    const approvalId = typeof data?.id === 'string' ? data.id : ''
    if (approvalId !== '') armApproval(approvalId, session, data)
    return
  }
  if (event.type === 'approval/decided') {
    const approvalId = typeof data?.id === 'string' ? data.id : ''
    const timer = pendingAsks.get(approvalId)
    if (timer !== undefined) {
      clearTimeout(timer)
      pendingAsks.delete(approvalId)
    }
    return
  }
  if (event.type === 'turn/start') {
    // A session that starts its next turn at once is continuing a job.
    const sessionId = String(session.id)
    const timer = pendingTurns.get(sessionId)
    if (timer !== undefined) {
      clearTimeout(timer)
      pendingTurns.delete(sessionId)
    }
    return
  }
  if (event.type !== 'turn/end') return
  if (session.header?.origin === 'subagent') return
  const status = data?.reason?.kind
  if (status !== 'completed' && status !== 'error') return
  armTurn(session, data)
}

/**
 * Host plugin body: observe Session commits and show Windows notifications.
 * @param {any} ctx - host context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.on('session/event', observe)
  ctx.effect(() => () => clearTimers(), 'attention-alerts: notification timers')
}
