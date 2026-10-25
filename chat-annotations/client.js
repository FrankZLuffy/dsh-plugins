/**
 * Chat Annotations — browser half.
 *
 * One compact control in the composer tool row. Selecting text anywhere in the
 * conversation raises a floating "highlight and annotate" button; saving paints
 * the passage with the CSS Custom Highlight API (no DOM mutation inside another
 * plugin's rendered Markdown) and records the quote, the note and the chat
 * node's durable key. The collected set can be dropped into the composer as the
 * base of the next turn, or appended to a Markdown file by the Host half.
 */
window.__ModuleLoader__.load({
  id: '@local/chat-annotations',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'chat-annotations'
    const API = '/chat-annotations/api'
    const HIGHLIGHT_PREFIX = 'dsh-chat-annotation-'
    /** Highlight name the first build registered; deleted so it never lingers. */
    const LEGACY_HIGHLIGHT_NAME = 'dsh-chat-annotation'
    const MAX_QUOTE = 4000
    const ANCHOR_WINDOW = 800

    /**
     * Highlighter inks. The first entry is the default, so an annotation that
     * predates colours (or names an unknown one) still paints.
     */
    const PALETTE = [
      { id: 'yellow', hex: '#f2c744' },
      { id: 'green', hex: '#45c98b' },
      { id: 'blue', hex: '#5b9cf8' },
      { id: 'pink', hex: '#ef7aa8' },
      { id: 'purple', hex: '#a78bfa' },
      { id: 'orange', hex: '#f59a5b' },
    ]
    const DEFAULT_COLOR = PALETTE[0].id

    /* ------------------------------------------------------------------ *
     * Dictionaries
     * ------------------------------------------------------------------ */

    const zh = {
      'trigger.label': '对话批注',
      'trigger.title': '对话批注：选中对话里的原文并批注',
      'panel.title': '对话批注',
      'panel.subtitle': '选中原文即可高亮批注；右键对话里的高亮可直接删除（带批注的会先让你复制）。批注可以导出，也可以作为下一轮对话的基础。',
      'panel.empty': '还没有批注。在对话里用鼠标选中一段文字，点浮出的「高亮并批注」。',
      'panel.emptyHint': '选中对话中的任何文字（回答、提问、工具输出都可以）。',
      'item.quote': '原文',
      'item.notePlaceholder': '写下你的批注（可留空）',
      'item.locate': '定位原文',
      'item.missing': '这段原文已不在当前加载范围内，请先向上加载历史',
      'item.remove': '删除这条批注',
      'item.unnamed': '仅高亮',
      'delete.title': '删除这条高亮？',
      'delete.body': '这条高亮带有批注，删除高亮会一起删掉批注。先把要留的文字复制出来：',
      'delete.quoteLabel': '原文',
      'delete.noteLabel': '批注（可选中复制，或点「复制批注」）',
      'delete.copy': '复制批注',
      'delete.copied': '已复制',
      'delete.confirm': '删除高亮',
      'delete.cancel': '取消',
      'panel.exportTitle': '导出到 Markdown',
      'panel.exportHint': '同一条目按「原文 + [原文来源](dsh://…)」写入；文件已有内容时在后面追加。',
      'panel.exportPlaceholder': '留空 = {path}',
      'panel.exportAction': '追加导出',
      'panel.exportBusy': '写入中…',
      'panel.exportDone': '已追加到 {path}（+{size}）',
      'panel.next': '作为下一轮对话的基础',
      'panel.nextDone': '已放进输入框，可以补充你的问题再发送',
      'panel.clear': '清空全部',
      'panel.clearConfirm': '清空这个会话的全部批注？',
      'panel.clearYes': '清空',
      'panel.clearNo': '取消',
      'panel.close': '关闭',
      'panel.count': '{count} 条',
      'toolbar.annotate': '高亮并批注',
      'editor.title': '添加批注',
      'editor.color': '高亮颜色',
      'editor.placeholder': '这条原文为什么重要？希望我下一轮怎么用它？',
      'editor.save': '保存',
      'editor.hint': '⌘/Ctrl + Enter 保存；留空则只高亮。',
      'editor.cancel': '取消',
      'color.yellow': '黄色',
      'color.green': '绿色',
      'color.blue': '蓝色',
      'color.pink': '粉色',
      'color.purple': '紫色',
      'color.orange': '橙色',
      'next.intro': '下面是我在这段对话里标记的原文与批注，请把它们作为这一轮的讨论基础：',
      'next.noteLabel': '批注：',
      'next.sourceLabel': '来源：',
      'error.load': '批注读取失败',
      'error.save': '批注保存失败',
      'error.export': '导出失败（{code}）',
      'error.export.no-path': '请填写导出路径',
      'error.export.is-directory': '这个路径是一个文件夹，请填写文件名',
      'error.export.forbidden': '没有写入这个路径的权限',
      'error.export.bad-request': '导出请求无效',
      'error.export.nothing-to-export': '没有可导出的批注',
      'error.export.write-failed': '写入失败，请检查路径',
      'export.heading': '对话批注',
      'export.quoteLabel': '原文：',
      'export.noteLabel': '批注：',
      'export.sourceLabel': '原文来源',
    }

    const en = {
      'trigger.label': 'Chat annotations',
      'trigger.title': 'Chat annotations: highlight a passage and annotate it',
      'panel.title': 'Chat annotations',
      'panel.subtitle': 'Select a passage to highlight it; right-clicking a highlight in the conversation deletes it (one with a note asks first, so you can copy the note). Export the set, or use it as the base of the next turn.',
      'panel.empty': 'No annotations yet. Select some text in the conversation, then choose “Highlight and annotate”.',
      'panel.emptyHint': 'Any passage works: a reply, a prompt, or tool output.',
      'item.quote': 'Passage',
      'item.notePlaceholder': 'Your note (optional)',
      'item.locate': 'Show the passage',
      'item.missing': 'That passage is outside the loaded range; load older history first',
      'item.remove': 'Delete this annotation',
      'item.unnamed': 'Highlight only',
      'delete.title': 'Delete this highlight?',
      'delete.body': 'This highlight carries a note, and deleting the highlight deletes the note too. Copy anything you want to keep first:',
      'delete.quoteLabel': 'Passage',
      'delete.noteLabel': 'Note (select to copy, or use “Copy note”)',
      'delete.copy': 'Copy note',
      'delete.copied': 'Copied',
      'delete.confirm': 'Delete highlight',
      'delete.cancel': 'Cancel',
      'panel.exportTitle': 'Export to Markdown',
      'panel.exportHint': 'Each entry is written as “passage + [source](dsh://…)”; when the file already has content, the new section is appended.',
      'panel.exportPlaceholder': 'empty = {path}',
      'panel.exportAction': 'Append export',
      'panel.exportBusy': 'Writing…',
      'panel.exportDone': 'Appended to {path} (+{size})',
      'panel.next': 'Use as the next turn’s base',
      'panel.nextDone': 'Placed in the composer; add your question and send',
      'panel.clear': 'Clear all',
      'panel.clearConfirm': 'Clear every annotation in this session?',
      'panel.clearYes': 'Clear',
      'panel.clearNo': 'Cancel',
      'panel.close': 'Close',
      'panel.count': '{count}',
      'toolbar.annotate': 'Highlight and annotate',
      'editor.title': 'Add an annotation',
      'editor.color': 'Highlight colour',
      'editor.placeholder': 'Why does this passage matter? How should I use it next turn?',
      'editor.save': 'Save',
      'editor.hint': '⌘/Ctrl + Enter saves; leaving it empty keeps just the highlight.',
      'editor.cancel': 'Cancel',
      'color.yellow': 'Yellow',
      'color.green': 'Green',
      'color.blue': 'Blue',
      'color.pink': 'Pink',
      'color.purple': 'Purple',
      'color.orange': 'Orange',
      'next.intro': 'These are passages from our conversation with my annotations. Use them as the base of this turn:',
      'next.noteLabel': 'Note: ',
      'next.sourceLabel': 'Source: ',
      'error.load': 'Could not load annotations',
      'error.save': 'Could not save the annotation',
      'error.export': 'Export failed ({code})',
      'error.export.no-path': 'Enter an export path',
      'error.export.is-directory': 'That path is a folder; enter a file name',
      'error.export.forbidden': 'No permission to write that path',
      'error.export.bad-request': 'Invalid export request',
      'error.export.nothing-to-export': 'No annotations to export',
      'error.export.write-failed': 'Write failed; check the path',
      'export.heading': 'Chat annotations',
      'export.quoteLabel': 'Passage: ',
      'export.noteLabel': 'Note: ',
      'export.sourceLabel': 'Source',
    }

    const ERROR_KEYS = {
      'no-path': 'error.export.no-path',
      'is-directory': 'error.export.is-directory',
      'forbidden': 'error.export.forbidden',
      'bad-request': 'error.export.bad-request',
      'nothing-to-export': 'error.export.nothing-to-export',
      'write-failed': 'error.export.write-failed',
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    /** One short random id for a new annotation. */
    function newId() {
      const bytes = new Uint8Array(8)
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        window.crypto.getRandomValues(bytes)
      } else {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
      }
      return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
    }

    /** Keep a number inside a range. */
    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max)
    }

    /** Human-readable size for the appended block. */
    function formatSize(characters) {
      if (!Number.isFinite(characters) || characters <= 0) return '0 B'
      if (characters < 1024) return String(characters) + ' B'
      return String(Math.round(characters / 102.4) / 10) + ' KB'
    }

    /** Internal record location of one annotation. */
    function sourceUrl(annotation) {
      const sessionId = typeof annotation.sessionId === 'string' ? annotation.sessionId : ''
      const seq = Number.isFinite(annotation.seq) ? String(Math.max(0, Math.floor(annotation.seq))) : '0'
      return 'dsh://session/' + sessionId + '?seq=' + seq
    }

    /**
     * Resolve the export target sent to the Host: an empty field means the
     * default file beside the workspace root, and a bare relative name is
     * anchored there too. The browser already knows that root, so the Host never
     * has to look the session up.
     */
    function absoluteTarget(input, defaultPath, cwd) {
      const text = typeof input === 'string' ? input.trim() : ''
      if (text === '') return defaultPath
      // Absolute (drive, UNC, POSIX) and home-relative paths go through as typed;
      // the Host expands `~`, and a bare relative name is anchored to the root.
      if (/^[a-zA-Z]:[\\/]/u.test(text) || text.startsWith('\\\\') || text.startsWith('/')
        || text.startsWith('~/') || text.startsWith('~\\')) return text
      if (typeof cwd !== 'string' || cwd === '') return text
      return cwd + (cwd.indexOf('\\') !== -1 ? '\\' : '/') + text
    }

    /** Same-origin JSON transport against the Host half. */
    async function api(route, options) {
      const method = (options && options.method) || 'GET'
      const init = { method, headers: {} }
      if (method !== 'GET') {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify((options && options.body) || {})
      }
      const response = await fetch(API + route, init)
      const raw = await response.text()
      let payload = {}
      try {
        payload = raw === '' ? {} : JSON.parse(raw)
      } catch {
        payload = {}
      }
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload.error || ('HTTP ' + String(response.status)))
        error.code = payload.code || 'http'
        throw error
      }
      return payload
    }

    /** The chat row that owns a selection boundary, or null outside the transcript. */
    function rowOf(node) {
      const element = node instanceof Element ? node : (node && node.parentElement)
      if (!element || typeof element.closest !== 'function') return null
      const row = element.closest('[data-chat-flow-key]')
      if (row === null) return null
      if (row.closest('[data-conversation-scroll]') === null) return null
      return row
    }

    /** Find one mounted chat row by its engine-owned key. */
    function findRowByKey(key) {
      if (typeof key !== 'string' || key === '') return null
      for (const row of document.querySelectorAll('[data-chat-flow-key]')) {
        if (row.getAttribute('data-chat-flow-key') === key) return row
      }
      return null
    }

    /**
     * Snapshot the current DOM selection as a chat-anchored annotation draft:
     * the quote, its offset inside the row's text, and the row's location on
     * screen for the floating button.
     * @returns {object | null} draft, or null when the selection is unusable.
     */
    function captureSelection() {
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null
      const range = selection.getRangeAt(0)
      const raw = range.toString()
      const quote = raw.trim()
      if (quote === '') return null
      // One annotation belongs to one chat row: a selection that starts in one
      // message and ends in another cannot be anchored, so it offers nothing
      // rather than record a quote no row contains.
      const startRow = rowOf(range.startContainer)
      const endRow = rowOf(range.endContainer)
      if (startRow === null || endRow === null || startRow !== endRow) return null
      const row = startRow
      const before = document.createRange()
      before.selectNodeContents(row)
      try {
        before.setEnd(range.startContainer, range.startOffset)
      } catch {
        return null
      }
      const leading = raw.length - raw.replace(/^\s+/u, '').length
      const start = Math.max(0, before.toString().length + leading)
      const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
      const rowRect = row.getBoundingClientRect()
      const collapsed = rect === null || (rect.width === 0 && rect.height === 0)
      return {
        nodeKey: row.getAttribute('data-chat-flow-key') || '',
        nodeKind: row.getAttribute('data-chat-flow-kind') || '',
        quote: quote.slice(0, MAX_QUOTE),
        start,
        anchor: {
          left: collapsed ? rowRect.left : rect.left,
          right: collapsed ? rowRect.right : rect.right,
          top: collapsed ? rowRect.top : rect.top,
          bottom: collapsed ? Math.min(rowRect.bottom, rowRect.top + 40) : rect.bottom,
        },
      }
    }

    /** Build a DOM range for [offset, offset + length) inside one row's text. */
    function rangeAtTextOffset(root, offset, length) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const end = offset + length
      let consumed = 0
      let startNode = null
      let startOffset = 0
      let endNode = null
      let endOffset = 0
      let node = walker.nextNode()
      while (node !== null) {
        const text = node.nodeValue || ''
        const next = consumed + text.length
        if (startNode === null && offset >= consumed && offset < next) {
          startNode = node
          startOffset = offset - consumed
        }
        if (startNode !== null && end <= next) {
          endNode = node
          endOffset = end - consumed
          break
        }
        consumed = next
        node = walker.nextNode()
      }
      if (startNode === null || endNode === null) return null
      const range = document.createRange()
      try {
        range.setStart(startNode, startOffset)
        range.setEnd(endNode, endOffset)
      } catch {
        return null
      }
      return range
    }

    /**
     * Re-anchor one stored quote inside its row. The recorded offset is tried
     * first; a short outward scan absorbs reflow and re-rendered text nodes
     * before falling back to the first exact occurrence.
     * @returns {Range | null} range whose text is the quote.
     */
    function locateRange(row, annotation) {
      const quote = String(annotation.quote || '')
      if (quote === '') return null
      const full = row.textContent || ''
      if (full === '') return null
      const recorded = Number.isFinite(annotation.start) ? Math.max(0, Math.floor(annotation.start)) : -1
      let index = -1
      if (recorded >= 0 && full.slice(recorded, recorded + quote.length) === quote) index = recorded
      if (index < 0 && recorded >= 0) {
        for (let distance = 1; distance <= ANCHOR_WINDOW && index < 0; distance += 1) {
          const before = recorded - distance
          if (before >= 0 && full.slice(before, before + quote.length) === quote) index = before
          const after = recorded + distance
          if (index < 0 && full.slice(after, after + quote.length) === quote) index = after
        }
      }
      if (index < 0) index = full.indexOf(quote)
      if (index < 0) return null
      return rangeAtTextOffset(row, index, quote.length)
    }

    /** Resolve one annotation's ink, falling back to the default colour. */
    function colorOf(annotation) {
      const value = annotation && typeof annotation.color === 'string' ? annotation.color : ''
      for (const entry of PALETTE) {
        if (entry.id === value) return entry.id
      }
      return DEFAULT_COLOR
    }

    /**
     * Paint every stored annotation of the loaded range. The Highlight API gives
     * one style per registry name, so each ink is its own Highlight holding all
     * ranges of that colour. The ranges are mirrored into `painted` (annotation
     * id → Range): a CSS highlight receives no events, so a click on the passage
     * is resolved by hit-testing these ranges instead.
     * @param annotations - stored annotations.
     * @param painted - per-session map to fill with the range actually drawn.
     */
    function paintHighlights(annotations, painted) {
      painted.clear()
      const registry = window.CSS && window.CSS.highlights ? window.CSS.highlights : undefined
      if (!registry || typeof window.Highlight !== 'function') return
      const byColor = new Map()
      for (const entry of PALETTE) byColor.set(entry.id, [])
      for (const annotation of annotations) {
        const row = findRowByKey(annotation.nodeKey)
        if (row === null) continue
        const range = locateRange(row, annotation)
        if (range === null) continue
        byColor.get(colorOf(annotation)).push(range)
        painted.set(annotation.id, range)
      }
      for (const entry of PALETTE) {
        const name = HIGHLIGHT_PREFIX + entry.id
        const ranges = byColor.get(entry.id)
        if (ranges.length === 0) {
          registry.delete(name)
          continue
        }
        registry.set(name, new window.Highlight(...ranges))
      }
      registry.delete(LEGACY_HIGHLIGHT_NAME)
    }

    /** The `::highlight()` rules, generated from the palette so ink has one source. */
    function highlightRules() {
      return PALETTE.map(entry => '::highlight(' + HIGHLIGHT_PREFIX + entry.id + '){'
        + 'background-color:color-mix(in srgb, ' + entry.hex + ' 32%, transparent);'
        + 'text-decoration:underline;'
        + 'text-decoration-color:color-mix(in srgb, ' + entry.hex + ' 62%, transparent);'
        + 'text-decoration-thickness:1px;'
        + 'text-underline-offset:2px}').join('\n')
    }

    /* ------------------------------------------------------------------ *
     * Icons
     * ------------------------------------------------------------------ */

    function IconHighlight(props) {
      const size = (props && props.size) || 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M15.4 3.9 20.1 8.6 11.7 17 6.4 17.6 7 12.3z' }),
        h('path', { d: 'M13.1 6.2 17.8 10.9' }),
        h('path', { d: 'M5 20.4h14' }))
    }

    function IconClose() {
      return h('svg', {
        width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', 'aria-hidden': 'true',
      },
        h('path', { d: 'm6.5 6.5 11 11' }),
        h('path', { d: 'm17.5 6.5-11 11' }))
    }

    /* ------------------------------------------------------------------ *
     * Component
     * ------------------------------------------------------------------ */

    function createSurface(t) {
      /** Translate with a literal fallback and `{name}` substitution. */
      function tr(key, vars) {
        let text
        try {
          text = t(key)
        } catch {
          text = undefined
        }
        if (typeof text !== 'string' || text === '') text = zh[key] || key
        if (vars) {
          for (const name of Object.keys(vars)) text = text.split('{' + name + '}').join(String(vars[name]))
        }
        return text
      }

      /** The composer block the “next turn” action inserts. */
      function transcriptOf(annotations) {
        const lines = [tr('next.intro')]
        annotations.forEach((annotation, index) => {
          lines.push('')
          lines.push(String(index + 1) + '. 「' + annotation.quote + '」')
          if (annotation.note !== '') lines.push('   - ' + tr('next.noteLabel') + annotation.note)
          lines.push('   - ' + tr('next.sourceLabel') + sourceUrl(annotation))
        })
        return lines.join('\n')
      }

      /** One row of ink choices; the current ink is ringed. Decorative dots, real buttons. */
      function ColorSwatches(props) {
        return h('div', { className: 'dca-swatches' },
          PALETTE.map(entry => h('button', {
            key: entry.id,
            type: 'button',
            className: 'dca-swatch' + (entry.id === props.value ? ' dca-swatch-on' : ''),
            style: { background: entry.hex },
            title: tr('color.' + entry.id),
            'aria-label': tr('color.' + entry.id),
            'aria-pressed': entry.id === props.value,
            onMouseDown: (event) => { event.preventDefault() },
            onClick: (event) => {
              event.preventDefault()
              props.onPick(entry.id)
            },
          })))
      }

      /** The compact composer control plus its three portaled surfaces. */
      function AnnotationSurface(props) {
        const { sessionId, useSession, useSessions, useInput, inputActions } = props
        // The host seats the control under the composer bar, which exists before a
        // session does: the session hooks can answer `undefined` here, so every
        // read below tolerates a missing snapshot instead of assuming one.
        const cwd = useSessions((snapshot) => {
          const row = snapshot && snapshot.byId ? snapshot.byId[sessionId] : undefined
          return row ? row.cwd : undefined
        })
        const draft = useInput((snapshot) => (snapshot && typeof snapshot.draft === 'string' ? snapshot.draft : ''))
        const nodes = useSession((snapshot) => (snapshot && snapshot.chat ? snapshot.chat.nodes : undefined))
        const active = typeof sessionId === 'string' && sessionId !== ''

        const draftRef = useRef(draft)
        draftRef.current = draft
        const nodesRef = useRef(nodes)
        nodesRef.current = nodes

        const [annotations, setAnnotations] = useState([])
        const annotationsRef = useRef(annotations)
        annotationsRef.current = annotations
        const [pending, setPending] = useState(null)
        const [editor, setEditor] = useState(null)
        const [open, setOpen] = useState(false)
        const [status, setStatus] = useState(null)
        const [exportPath, setExportPath] = useState('')
        const [busy, setBusy] = useState(false)
        const [confirmClear, setConfirmClear] = useState(false)
        const [pendingDelete, setPendingDelete] = useState(null)
        const [copied, setCopied] = useState(false)
        /** Ranges actually painted, by annotation id — the click target model. */
        const hitRanges = useRef(new Map())
        const deleteNoteRef = useRef(null)

        const alive = useRef(true)
        useEffect(() => () => { alive.current = false }, [])

        const defaultPath = cwd
          ? cwd + (cwd.indexOf('\\') !== -1 ? '\\' : '/') + 'annotations.md'
          : ''

        /* --- durable state --------------------------------------------- */

        useEffect(() => {
          if (!active) return undefined
          let live = true
          api('/list?session=' + encodeURIComponent(sessionId)).then((payload) => {
            if (!live || !alive.current) return
            setAnnotations(Array.isArray(payload.annotations) ? payload.annotations : [])
          }).catch(() => {
            if (live && alive.current) setStatus({ kind: 'error', text: tr('error.load') })
          })
          return () => { live = false }
        }, [active, sessionId])

        const persist = useCallback((next) => {
          setAnnotations(next)
          annotationsRef.current = next
          void api('/save', { method: 'POST', body: { sessionId, annotations: next } }).catch(() => {
            if (alive.current) setStatus({ kind: 'error', text: tr('error.save') })
          })
        }, [sessionId])

        /* --- highlight painting ---------------------------------------- */

        useEffect(() => {
          paintHighlights(annotations, hitRanges.current)
        }, [annotations])

        useEffect(() => {
          if (!active) return undefined
          const scroller = document.querySelector('[data-conversation-scroll]')
          if (scroller === null) return undefined
          let frame = 0
          const schedule = () => {
            if (frame !== 0) return
            frame = window.requestAnimationFrame(() => {
              frame = 0
              paintHighlights(annotationsRef.current, hitRanges.current)
            })
          }
          const observer = new MutationObserver(schedule)
          observer.observe(scroller, { childList: true, subtree: true, characterData: true })
          const onScroll = () => { setPending(null) }
          scroller.addEventListener('scroll', onScroll, { passive: true })
          return () => {
            observer.disconnect()
            scroller.removeEventListener('scroll', onScroll)
            if (frame !== 0) window.cancelAnimationFrame(frame)
          }
        }, [active])

        /* --- selection capture ----------------------------------------- */

        useEffect(() => {
          if (!active) return undefined
          const onSelectionChange = () => {
            const capture = captureSelection()
            if (capture === null) return
            setPending(capture)
            setEditor(null)
          }
          const onPointerDown = (event) => {
            const target = event.target
            if (target instanceof Element && target.closest('[data-dca-keep]') !== null) return
            setPending(null)
            setPendingDelete(null)
            setCopied(false)
          }
          const onKeyDown = (event) => {
            if (event.key !== 'Escape') return
            setPending(null)
            setEditor(null)
            setOpen(false)
            setConfirmClear(false)
            setPendingDelete(null)
            setCopied(false)
          }
          document.addEventListener('selectionchange', onSelectionChange)
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [active])

        /* --- actions ---------------------------------------------------- */

        const addAnnotation = useCallback((draftSelection, note, color) => {
          const node = nodesRef.current ? nodesRef.current.get(draftSelection.nodeKey) : undefined
          const anchorSeq = node && Number.isFinite(node.anchorSeq) ? node.anchorSeq : undefined
          const entry = {
            id: newId(),
            sessionId,
            nodeKey: draftSelection.nodeKey,
            nodeKind: draftSelection.nodeKind,
            seq: anchorSeq === undefined ? 0 : Math.max(0, Math.floor(anchorSeq)),
            quote: draftSelection.quote,
            start: draftSelection.start,
            note: note.trim(),
            color: colorOf({ color }),
            createdAt: new Date().toISOString(),
          }
          persist([...annotationsRef.current, entry])
          setEditor(null)
          setPending(null)
          setStatus(null)
          const selection = window.getSelection()
          if (selection !== null) selection.removeAllRanges()
        }, [persist, sessionId])

        const saveEditor = useCallback(() => {
          if (editor === null) return
          addAnnotation(editor.pending, editor.note, editor.color)
        }, [addAnnotation, editor])

        const updateNote = useCallback((id, note) => {
          const next = annotationsRef.current.map(item => (item.id === id ? { ...item, note } : item))
          setAnnotations(next)
          annotationsRef.current = next
        }, [])

        const updateColor = useCallback((id, color) => {
          const resolved = colorOf({ color })
          persist(annotationsRef.current.map(item => (item.id === id ? { ...item, color: resolved } : item)))
        }, [persist])

        const commitNotes = useCallback(() => {
          persist(annotationsRef.current)
        }, [persist])

        const removeAnnotation = useCallback((id) => {
          persist(annotationsRef.current.filter(item => item.id !== id))
        }, [persist])

        const locate = useCallback((annotation) => {
          const row = findRowByKey(annotation.nodeKey)
          if (row === null) {
            setStatus({ kind: 'error', text: tr('item.missing') })
            return
          }
          row.scrollIntoView({ block: 'center', behavior: 'smooth' })
          setOpen(false)
          setStatus(null)
        }, [])

        const useAsBasis = useCallback(() => {
          const list = annotationsRef.current
          if (list.length === 0) return
          const block = transcriptOf(list)
          const current = typeof draftRef.current === 'string' ? draftRef.current : ''
          const next = current.trim() === '' ? block : current.replace(/\s+$/u, '') + '\n\n' + block
          if (inputActions && typeof inputActions.setDraft === 'function') inputActions.setDraft(next)
          setOpen(false)
          setStatus({ kind: 'ok', text: tr('panel.nextDone') })
        }, [inputActions])

        const doExport = useCallback(async () => {
          const list = annotationsRef.current
          if (busy) return
          if (list.length === 0) {
            setStatus({ kind: 'error', text: tr('error.export.nothing-to-export') })
            return
          }
          setBusy(true)
          setStatus(null)
          try {
            const payload = await api('/export', {
              method: 'POST',
              body: {
                sessionId,
                // The browser knows the workspace root, so it sends a concrete
                // target: the Host then writes without needing the session.
                path: absoluteTarget(exportPath, defaultPath, cwd),
                annotations: list,
                heading: tr('export.heading'),
                quoteLabel: tr('export.quoteLabel'),
                noteLabel: tr('export.noteLabel'),
                sourceLabel: tr('export.sourceLabel'),
              },
            })
            if (!alive.current) return
            setStatus({
              kind: 'ok',
              text: tr('panel.exportDone', { path: payload.path, size: formatSize(payload.appended) }),
            })
          } catch (error) {
            if (!alive.current) return
            const code = error && error.code ? error.code : 'http'
            setStatus({ kind: 'error', text: tr(ERROR_KEYS[code] || 'error.export', { code }) })
          } finally {
            if (alive.current) setBusy(false)
          }
        }, [busy, cwd, defaultPath, exportPath, sessionId])

        const clearAll = useCallback(() => {
          persist([])
          setConfirmClear(false)
          setOpen(false)
          setStatus(null)
        }, [persist])

        /* --- delete by clicking the passage ------------------------------ */

        /** The annotation whose painted range covers one viewport point. */
        const annotationAt = useCallback((x, y) => {
          for (const [id, range] of hitRanges.current) {
            // A detached range belongs to a replaced render; the next paint drops it.
            if (!range || range.collapsed || !range.startContainer || !range.startContainer.isConnected) continue
            const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : []
            for (const rect of rects) {
              if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) {
                return annotationsRef.current.find(item => item.id === id) || null
              }
            }
          }
          return null
        }, [])

        const closeDelete = useCallback(() => {
          setPendingDelete(null)
          setCopied(false)
        }, [])

        const confirmDelete = useCallback(() => {
          if (pendingDelete === null) return
          removeAnnotation(pendingDelete.annotation.id)
          closeDelete()
        }, [closeDelete, pendingDelete, removeAnnotation])

        const copyNote = useCallback(() => {
          if (pendingDelete === null) return
          const text = String(pendingDelete.annotation.note || '')
          const fallback = () => {
            const node = deleteNoteRef.current
            if (node === null) return
            node.focus()
            node.select()
            try {
              document.execCommand('copy')
              if (alive.current) setCopied(true)
            } catch {
              /* the selection stays, so Ctrl+C still works */
            }
          }
          const clipboard = window.navigator ? window.navigator.clipboard : undefined
          if (clipboard && typeof clipboard.writeText === 'function') {
            clipboard.writeText(text).then(() => {
              if (alive.current) setCopied(true)
            }, fallback)
            return
          }
          fallback()
        }, [pendingDelete])

        // A CSS highlight is paint, not an element: the gesture is resolved by
        // hit-testing the ranges painted for each annotation. It is the right
        // click, so ordinary left-click reading/selection never deletes anything:
        // a note-less highlight goes at once; one with a note asks first and
        // shows the note so it can be copied. The native menu stays suppressed
        // only where a highlight was actually hit.
        useEffect(() => {
          if (!active) return undefined
          const onContextMenu = (event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
            const target = event.target
            if (!(target instanceof Element) || target.closest('[data-conversation-scroll]') === null) return
            if (target.closest('a,button,summary,input,textarea,select,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[contenteditable="true"]') !== null) return
            const selection = window.getSelection()
            if (selection !== null && selection.rangeCount > 0 && !selection.isCollapsed) return
            const annotation = annotationAt(event.clientX, event.clientY)
            if (annotation === null) return
            event.preventDefault()
            if (String(annotation.note || '').trim() === '') {
              removeAnnotation(annotation.id)
              return
            }
            setCopied(false)
            setPendingDelete({
              annotation,
              anchor: {
                left: event.clientX,
                right: event.clientX,
                top: event.clientY,
                bottom: event.clientY,
              },
            })
          }
          // Capture phase: the harness (or another feature) may own a contextual
          // menu of its own, and a hit must be decided before that runs.
          document.addEventListener('contextmenu', onContextMenu, true)
          return () => { document.removeEventListener('contextmenu', onContextMenu, true) }
        }, [active, annotationAt, removeAnnotation])

        // Focus and select the note so a plain Ctrl+C works before the user has
        // decided to delete anything.
        useEffect(() => {
          if (pendingDelete === null) return
          const node = deleteNoteRef.current
          if (node !== null) {
            node.focus()
            node.select()
          }
        }, [pendingDelete])

        /* --- placement --------------------------------------------------- */

        // No session yet (the resident composer bar still renders this seat):
        // hide the control entirely rather than offer an annotation for nothing.
        if (!active) return null

        const toolbarStyle = pending === null ? undefined : placeToolbar(pending.anchor)
        const editorStyle = editor === null ? undefined : placeEditor(editor.pending.anchor)
        const deleteStyle = pendingDelete === null ? undefined : placeDelete(pendingDelete.anchor)

        /* --- render ------------------------------------------------------ */

        const count = annotations.length
        const trigger = h('button', {
          type: 'button',
          className: 'dca-trigger' + (open ? ' dca-trigger-on' : '') + (count > 0 ? ' dca-trigger-counted' : ''),
          title: tr('trigger.title'),
          'aria-label': tr('trigger.label') + (count > 0 ? ' (' + String(count) + ')' : ''),
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          onClick: () => {
            setOpen(value => !value)
            setConfirmClear(false)
            setStatus(null)
          },
        },
          h(IconHighlight, { size: 16 }),
          count > 0 ? h('span', { className: 'dca-badge', 'aria-hidden': 'true' }, String(count)) : null)

        const toolbar = pending === null ? null : ReactDOM.createPortal(
          h('div', {
            className: 'dca-toolbar',
            'data-dca-keep': '',
            style: toolbarStyle,
            onPointerDown: (event) => { event.preventDefault() },
          },
            h('button', {
              type: 'button',
              className: 'dca-toolbar-btn',
              onClick: () => { setEditor({ pending, note: '', color: DEFAULT_COLOR }) },
            }, h(IconHighlight, { size: 14 }), h('span', null, tr('toolbar.annotate')))),
          document.body,
        )

        const editorNode = editor === null ? null : ReactDOM.createPortal(
          h('div', {
            className: 'dca-editor',
            'data-dca-keep': '',
            role: 'dialog',
            'aria-label': tr('editor.title'),
            style: editorStyle,
          },
            h('div', { className: 'dca-editor-title' }, tr('editor.title')),
            h('div', { className: 'dca-editor-quote' }, editor.pending.quote),
            h('div', { className: 'dca-editor-colors' },
              h('span', { className: 'dca-editor-color-label' }, tr('editor.color')),
              h(ColorSwatches, {
                value: editor.color,
                onPick: (color) => { setEditor(current => (current === null ? current : { ...current, color })) },
              })),
            h('textarea', {
              className: 'dca-editor-input',
              autoFocus: true,
              rows: 3,
              placeholder: tr('editor.placeholder'),
              value: editor.note,
              onChange: (event) => {
                const value = event.target.value
                setEditor(current => (current === null ? current : { ...current, note: value }))
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  saveEditor()
                }
              },
            }),
            h('div', { className: 'dca-editor-actions' },
              h('span', { className: 'dca-editor-hint' }, tr('editor.hint')),
              h('button', { type: 'button', className: 'dca-btn', onClick: () => { setEditor(null) } }, tr('editor.cancel')),
              h('button', { type: 'button', className: 'dca-btn dca-btn-primary', onClick: saveEditor }, tr('editor.save')))),
          document.body,
        )

        const itemNode = (annotation, index) => h('article', { className: 'dca-item', key: annotation.id },
          h('div', { className: 'dca-item-head' },
            h('span', { className: 'dca-item-index' }, String(index + 1)),
            h('span', { className: 'dca-item-source' }, sourceUrl(annotation)),
            h('div', { className: 'dca-item-actions' },
              h('button', {
                type: 'button',
                className: 'dca-link',
                onClick: () => { locate(annotation) },
              }, tr('item.locate')),
              h('button', {
                type: 'button',
                className: 'dca-link dca-link-danger',
                onClick: () => { removeAnnotation(annotation.id) },
              }, tr('item.remove')))),
          h('blockquote', { className: 'dca-quote' }, annotation.quote),
          h('div', { className: 'dca-item-colors' },
            h(ColorSwatches, {
              value: colorOf(annotation),
              onPick: (color) => { updateColor(annotation.id, color) },
            })),
          h('textarea', {
            className: 'dca-note',
            rows: 2,
            placeholder: tr('item.notePlaceholder'),
            value: annotation.note,
            onChange: (event) => { updateNote(annotation.id, event.target.value) },
            onBlur: commitNotes,
          }))

        const bodyNode = h('div', { className: 'dca-panel-body' },
          count === 0
            ? h('div', { className: 'dca-empty' },
              h('div', { className: 'dca-empty-title' }, tr('panel.empty')),
              h('div', { className: 'dca-empty-hint' }, tr('panel.emptyHint')))
            : annotations.map(itemNode))

        const exportRow = h('div', { className: 'dca-export-row' },
          h('input', {
            className: 'dca-input',
            type: 'text',
            spellCheck: false,
            autoComplete: 'off',
            placeholder: tr('panel.exportPlaceholder', { path: defaultPath || 'annotations.md' }),
            value: exportPath,
            onChange: (event) => { setExportPath(event.target.value) },
            onKeyDown: (event) => {
              if (event.key === 'Enter') doExport()
            },
          }),
          h('button', {
            type: 'button',
            className: 'dca-btn',
            disabled: busy || count === 0,
            onClick: doExport,
          }, busy ? tr('panel.exportBusy') : tr('panel.exportAction')))

        const exportBlock = h('div', { className: 'dca-export' },
          h('div', { className: 'dca-export-title' }, tr('panel.exportTitle')),
          exportRow,
          h('div', { className: 'dca-export-hint' }, tr('panel.exportHint')))

        const statusRow = status === null
          ? null
          : h('div', { className: 'dca-status dca-status-' + status.kind, role: 'status' }, status.text)

        const clearActions = confirmClear
          ? [
            h('span', { key: 'text', className: 'dca-confirm-text' }, tr('panel.clearConfirm')),
            h('button', {
              key: 'yes',
              type: 'button',
              className: 'dca-btn dca-btn-danger',
              onClick: clearAll,
            }, tr('panel.clearYes')),
            h('button', {
              key: 'no',
              type: 'button',
              className: 'dca-btn',
              onClick: () => { setConfirmClear(false) },
            }, tr('panel.clearNo')),
          ]
          : [
            h('button', {
              key: 'clear',
              type: 'button',
              className: 'dca-btn',
              disabled: count === 0,
              onClick: () => { setConfirmClear(true) },
            }, tr('panel.clear')),
            h('button', {
              key: 'next',
              type: 'button',
              className: 'dca-btn dca-btn-primary',
              disabled: count === 0,
              onClick: useAsBasis,
            }, tr('panel.next')),
          ]

        const footerNode = h('footer', { className: 'dca-panel-foot' },
          exportBlock,
          statusRow,
          h('div', { className: 'dca-foot-actions' }, clearActions))

        const headerNode = h('header', { className: 'dca-panel-head' },
          h('div', { className: 'dca-panel-heading' },
            h('h2', { className: 'dca-panel-title' },
              tr('panel.title'),
              count > 0 ? h('span', { className: 'dca-panel-count' }, tr('panel.count', { count: String(count) })) : null),
            h('p', { className: 'dca-panel-subtitle' }, tr('panel.subtitle'))),
          h('button', {
            type: 'button',
            className: 'dca-close',
            title: tr('panel.close'),
            'aria-label': tr('panel.close'),
            onClick: () => { setOpen(false); setStatus(null) },
          }, h(IconClose)))

        const panel = !open ? null : ReactDOM.createPortal(
          h(React.Fragment, null,
            h('div', { className: 'dca-backdrop', onClick: () => { setOpen(false); setStatus(null) } }),
            h('div', {
              className: 'dca-panel',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': tr('panel.title'),
              onClick: (event) => { event.stopPropagation() },
            }, headerNode, bodyNode, footerNode)),
          document.body,
        )

        const deleteNode = pendingDelete === null ? null : ReactDOM.createPortal(
          h('div', {
            className: 'dca-delete',
            'data-dca-keep': '',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': tr('delete.title'),
            style: deleteStyle,
            onPointerDown: (event) => { event.stopPropagation() },
          },
            h('div', { className: 'dca-delete-title' }, tr('delete.title')),
            h('div', { className: 'dca-delete-body' }, tr('delete.body')),
            h('div', { className: 'dca-delete-label' }, tr('delete.quoteLabel')),
            h('blockquote', { className: 'dca-quote dca-quote-small' }, pendingDelete.annotation.quote),
            h('div', { className: 'dca-delete-label' }, tr('delete.noteLabel')),
            h('textarea', {
              ref: deleteNoteRef,
              className: 'dca-note dca-note-readonly',
              readOnly: true,
              rows: 4,
              value: pendingDelete.annotation.note,
              onFocus: (event) => { event.target.select() },
            }),
            h('div', { className: 'dca-delete-actions' },
              h('button', { type: 'button', className: 'dca-btn', onClick: copyNote },
                copied ? tr('delete.copied') : tr('delete.copy')),
              h('span', { className: 'dca-delete-spacer' }),
              h('button', { type: 'button', className: 'dca-btn', onClick: closeDelete }, tr('delete.cancel')),
              h('button', { type: 'button', className: 'dca-btn dca-btn-danger', onClick: confirmDelete }, tr('delete.confirm')))),
          document.body,
        )

        return h(React.Fragment, null, trigger, toolbar, editorNode, deleteNode, panel)
      }

      return AnnotationSurface
    }

    /** Fixed placement for the floating button, kept inside the viewport. */
    function placeToolbar(anchor) {
      const width = 150
      const height = 34
      const margin = 8
      const left = clamp(anchor.left + (anchor.right - anchor.left) / 2 - width / 2, margin, Math.max(margin, window.innerWidth - width - margin))
      let top = anchor.top - height - 6
      if (top < margin) top = anchor.bottom + 6
      return { left: Math.round(left) + 'px', top: Math.round(top) + 'px' }
    }

    /** Fixed placement for the annotation editor, above the selection when needed. */
    function placeEditor(anchor) {
      const width = Math.min(360, Math.max(260, window.innerWidth - 24))
      const height = 210
      const margin = 10
      const left = clamp(anchor.left + (anchor.right - anchor.left) / 2 - width / 2, margin, Math.max(margin, window.innerWidth - width - margin))
      let top = anchor.bottom + 8
      if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - height - 8)
      return { left: Math.round(left) + 'px', top: Math.round(top) + 'px', width: Math.round(width) + 'px' }
    }

    /** Fixed placement for the delete-confirmation card, anchored at the click. */
    function placeDelete(anchor) {
      const width = Math.min(380, Math.max(280, window.innerWidth - 24))
      const height = 320
      const margin = 10
      const left = clamp(anchor.left - 24, margin, Math.max(margin, window.innerWidth - width - margin))
      let top = anchor.top + 14
      if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - height - 14)
      return { left: Math.round(left) + 'px', top: Math.round(top) + 'px', width: Math.round(width) + 'px' }
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const CSS = `
      .dca-trigger{display:inline-flex;align-items:center;justify-content:center;position:relative;height:26px;min-width:26px;padding:0 5px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;line-height:1}
      .dca-trigger:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .dca-trigger-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}
      .dca-trigger-counted{color:var(--dsw-alias-brand-primary)}
      .dca-trigger-error{color:var(--dsw-alias-state-error-primary);font-weight:700}
      .dca-badge{position:absolute;top:-3px;right:-4px;min-width:13px;height:13px;padding:0 3px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:#fff;font-size:9px;font-weight:600;line-height:13px;text-align:center}
      .dca-toolbar{position:fixed;z-index:1400;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 28px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);user-select:none}
      .dca-toolbar-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
      .dca-toolbar-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
      .dca-editor{position:fixed;z-index:1410;display:flex;flex-direction:column;gap:8px;padding:10px 11px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-overlay);box-shadow:0 16px 40px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);color:var(--dsw-alias-label-primary);font-size:12.5px;box-sizing:border-box}
      .dca-editor-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
      .dca-editor-quote{max-height:88px;overflow:auto;padding:6px 8px;border-left:2px solid var(--dsw-alias-brand-primary);border-radius:0 6px 6px 0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
      .dca-editor-input{width:100%;box-sizing:border-box;resize:vertical;min-height:56px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.5;outline:none}
      .dca-editor-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
      .dca-editor-actions{display:flex;align-items:center;gap:6px}
      .dca-editor-hint{flex:1;min-width:0;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .dca-backdrop{position:fixed;inset:0;z-index:1500;background:color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent)}
      .dca-panel{position:fixed;z-index:1510;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;width:min(720px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 48px));border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 24px 64px color-mix(in srgb,var(--dsw-alias-label-primary) 26%,transparent);font-size:13px;line-height:1.5;overflow:hidden}
      .dca-panel *{box-sizing:border-box}
      .dca-panel-head{display:flex;align-items:flex-start;gap:12px;padding:15px 16px 11px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .dca-panel-heading{flex:1;min-width:0}
      .dca-panel-title{display:flex;align-items:baseline;gap:8px;margin:0;font-size:14.5px;font-weight:650}
      .dca-panel-count{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary)}
      .dca-panel-subtitle{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .dca-close{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .dca-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .dca-panel-body{flex:1;min-height:0;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
      .dca-empty{padding:26px 8px;text-align:center;color:var(--dsw-alias-label-secondary)}
      .dca-empty-title{font-size:13px;color:var(--dsw-alias-label-primary)}
      .dca-empty-hint{margin-top:6px;font-size:12px}
      .dca-item{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:9px 10px 10px}
      .dca-item-head{display:flex;align-items:center;gap:8px;min-width:0}
      .dca-item-index{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary);font-size:10.5px;font-weight:600}
      .dca-item-source{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .dca-item-actions{flex:0 0 auto;display:flex;align-items:center;gap:8px}
      .dca-link{border:0;background:transparent;padding:0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer}
      .dca-link:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}
      .dca-link-danger:hover{color:var(--dsw-alias-state-error-primary)}
      .dca-quote{margin:7px 0 0;padding:6px 9px;border-left:2px solid var(--dsw-alias-brand-primary);border-radius:0 6px 6px 0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.62;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto}
      .dca-note{width:100%;margin-top:8px;resize:vertical;min-height:44px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.5;outline:none}
      .dca-note:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
      .dca-panel-foot{display:flex;flex-direction:column;gap:9px;padding:11px 16px 13px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .dca-export-title{font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary)}
      .dca-export-row{display:flex;align-items:center;gap:8px;margin-top:6px}
      .dca-input{flex:1;min-width:0;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}
      .dca-input::placeholder{color:var(--dsw-alias-label-secondary)}
      .dca-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
      .dca-export-hint{margin-top:5px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .dca-status{font-size:11.5px;word-break:break-word}
      .dca-status-ok{color:var(--dsw-alias-state-success-primary)}
      .dca-status-error{color:var(--dsw-alias-state-error-primary)}
      .dca-foot-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px}
      .dca-confirm-text{flex:1;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .dca-btn{height:29px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
      .dca-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
      .dca-btn:disabled{opacity:.5;cursor:default}
      .dca-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
      .dca-btn-primary:hover:not(:disabled){filter:brightness(1.05)}
      .dca-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
      .dca-swatches{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .dca-swatch{width:15px;height:15px;padding:0;border:1px solid color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent);border-radius:999px;cursor:pointer;box-sizing:border-box}
      .dca-swatch:hover{filter:brightness(1.08)}
      .dca-swatch-on{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}
      .dca-editor-colors{display:flex;align-items:center;gap:9px}
      .dca-editor-color-label{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .dca-item-colors{display:flex;align-items:center;gap:6px;margin-top:7px}
      .dca-delete{position:fixed;z-index:1420;display:flex;flex-direction:column;gap:7px;padding:12px 13px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-overlay);box-shadow:0 18px 44px color-mix(in srgb,var(--dsw-alias-label-primary) 24%,transparent);color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.5;box-sizing:border-box}
      .dca-delete *{box-sizing:border-box}
      .dca-delete-title{font-size:12.5px;font-weight:650}
      .dca-delete-body{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .dca-delete-label{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}
      .dca-quote-small{max-height:84px;margin:0}
      .dca-note-readonly{background:var(--dsw-alias-bg-layer-1);cursor:text}
      .dca-delete-actions{display:flex;align-items:center;gap:7px;margin-top:2px}
      .dca-delete-spacer{flex:1}
      @media (prefers-reduced-motion:reduce){.dca-panel{transition:none}}
    `

    /* ------------------------------------------------------------------ *
     * Containment
     * ------------------------------------------------------------------ */

    /**
     * A slot entry that throws is retired from its cell for the rest of the
     * page's life, so this control contains its own failures: the mistake stays
     * visible as one small button instead of silently removing the feature.
     */
    class AnnotationBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('chat-annotations: composer control failed', error)
      }

      render() {
        if (this.state.error !== null) {
          const message = String((this.state.error && this.state.error.message) || this.state.error)
          return h('button', {
            type: 'button',
            className: 'dca-trigger dca-trigger-error',
            title: 'Chat annotations: ' + message,
            'aria-label': 'Chat annotations error',
            onClick: () => { this.setState({ error: null }) },
          }, '!')
        }
        return this.props.children
      }
    }

    /* ------------------------------------------------------------------ *
     * Plugin body
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-annotations: dictionaries')
        const t = ctx.locale.bind(NS)
        const Surface = createSurface(t)

        const Guarded = function Guarded(props) {
          return h(AnnotationBoundary, null, h(Surface, props))
        }

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', '@local/chat-annotations')
          style.textContent = CSS + '\n' + highlightRules()
          document.head.append(style)
          return () => style.remove()
        }, 'chat-annotations: styles')

        ctx.effect(
          () => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
            name: 'conversation.input.right',
            id: 'annotations',
            order: 40,
            locale: NS,
          }, Guarded)),
          'chat-annotations: composer control',
        )
      },
    }
  },
})
