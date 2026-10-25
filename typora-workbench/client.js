window.__ModuleLoader__.load({
  id: '@local/typora-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const API = '/typora/api'

    /* ------------------------------------------------------------------ *
     * Transport
     * ------------------------------------------------------------------ */

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
        throw new Error('接口返回的不是 JSON：' + raw.slice(0, 160))
      }
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || ('HTTP ' + response.status))
      }
      return payload
    }

    function query(params) {
      const search = new URLSearchParams()
      for (const key of Object.keys(params)) search.set(key, params[key])
      return '?' + search.toString()
    }

    /* ------------------------------------------------------------------ *
     * Markdown → HTML
     * ------------------------------------------------------------------ */

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    function inlineMarkdown(source) {
      const codes = []
      let out = escapeHtml(source)
      out = out.replace(/`([^`]+)`/g, (match, code) => {
        codes.push(code)
        return '\u0001' + (codes.length - 1) + '\u0001'
      })
      out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, alt, src) => {
        return '<img alt="' + alt + '" src="' + src + '">'
      })
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (match, label, href) => {
        return '<a href="' + href + '" target="_blank" rel="noreferrer">' + label + '</a>'
      })
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
      out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
      out = out.replace(/\u0001(\d+)\u0001/g, (match, index) => '<code>' + codes[Number(index)] + '</code>')
      return out
    }

    function splitRow(line) {
      return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
    }

    const BLOCK_START = /^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/

    function markdownToHtml(markdown) {
      const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n')
      const out = []
      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        if (/^\s*$/.test(line)) { i += 1; continue }

        const fence = /^```\s*(.*)$/.exec(line)
        if (fence) {
          const language = fence[1].trim()
          const body = []
          i += 1
          while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
          i += 1
          out.push('<pre><code data-lang="' + escapeHtml(language) + '">' + escapeHtml(body.join('\n')) + '</code></pre>')
          continue
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
          const level = heading[1].length
          out.push('<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>')
          i += 1
          continue
        }

        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
          out.push('<hr>')
          i += 1
          continue
        }

        if (/^>\s?/.test(line)) {
          const body = []
          while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''))
          out.push('<blockquote>' + markdownToHtml(body.join('\n')) + '</blockquote>')
          continue
        }

        if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
          const head = splitRow(line)
          const rows = []
          i += 2
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]))
          out.push(
            '<table><thead><tr>' + head.map((cell) => '<th>' + inlineMarkdown(cell) + '</th>').join('') + '</tr></thead>'
            + '<tbody>' + rows.map((row) => '<tr>' + row.map((cell) => '<td>' + inlineMarkdown(cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table>',
          )
          continue
        }

        if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
          const ordered = /^\s*\d+[.)]\s+/.test(line)
          const items = []
          while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
            let text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')
            i += 1
            const task = /^\[([ xX])\]\s+(.*)$/.exec(text)
            let marker = ''
            if (task) {
              marker = task[1].toLowerCase() === 'x' ? 'checked' : 'unchecked'
              text = task[2]
            }
            items.push({ text, marker })
          }
          const tag = ordered ? 'ol' : 'ul'
          out.push('<' + tag + '>' + items.map((item) => {
            if (item.marker === 'checked') return '<li class="tw-task"><span class="tw-box">✓</span>' + inlineMarkdown(item.text) + '</li>'
            if (item.marker === 'unchecked') return '<li class="tw-task"><span class="tw-box"></span>' + inlineMarkdown(item.text) + '</li>'
            return '<li>' + inlineMarkdown(item.text) + '</li>'
          }).join('') + '</' + tag + '>')
          continue
        }

        const body = []
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) body.push(lines[i++])
        if (body.length === 0) body.push(lines[i++])
        out.push('<p>' + inlineMarkdown(body.join('\n')).replace(/\n/g, '<br>') + '</p>')
      }
      return out.join('\n')
    }

    /* ------------------------------------------------------------------ *
     * Line diff
     * ------------------------------------------------------------------ */

    function splitLines(text) {
      if (text === '' || text === undefined || text === null) return []
      return String(text).replace(/\r\n?/g, '\n').split('\n')
    }

    function diffOps(before, after) {
      const a = before
      const b = after
      const n = a.length
      const m = b.length
      let start = 0
      while (start < n && start < m && a[start] === b[start]) start += 1
      let endA = n
      let endB = m
      while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1 }
      const A = a.slice(start, endA)
      const B = b.slice(start, endB)
      const ops = []
      for (let k = 0; k < start; k += 1) ops.push({ t: ' ', s: a[k] })
      const nn = A.length
      const mm = B.length
      if (nn === 0) {
        for (const line of B) ops.push({ t: '+', s: line })
      } else if (mm === 0) {
        for (const line of A) ops.push({ t: '-', s: line })
      } else if (nn * mm > 4000000) {
        for (const line of A) ops.push({ t: '-', s: line })
        for (const line of B) ops.push({ t: '+', s: line })
      } else {
        const width = mm + 1
        const table = new Uint16Array((nn + 1) * width)
        for (let x = nn - 1; x >= 0; x -= 1) {
          for (let y = mm - 1; y >= 0; y -= 1) {
            table[x * width + y] = A[x] === B[y]
              ? table[(x + 1) * width + y + 1] + 1
              : Math.max(table[(x + 1) * width + y], table[x * width + y + 1])
          }
        }
        let x = 0
        let y = 0
        while (x < nn && y < mm) {
          if (A[x] === B[y]) { ops.push({ t: ' ', s: A[x] }); x += 1; y += 1 }
          else if (table[(x + 1) * width + y] >= table[x * width + y + 1]) { ops.push({ t: '-', s: A[x] }); x += 1 }
          else { ops.push({ t: '+', s: B[y] }); y += 1 }
        }
        while (x < nn) { ops.push({ t: '-', s: A[x] }); x += 1 }
        while (y < mm) { ops.push({ t: '+', s: B[y] }); y += 1 }
      }
      for (let k = endA; k < n; k += 1) ops.push({ t: ' ', s: a[k] })
      return ops
    }

    function collapse(ops) {
      const KEEP = 2
      const out = []
      let i = 0
      while (i < ops.length) {
        if (ops[i].t !== ' ') { out.push(ops[i]); i += 1; continue }
        let j = i
        while (j < ops.length && ops[j].t === ' ') j += 1
        const run = j - i
        const bounded = i > 0 && j < ops.length
        if (bounded && run > KEEP * 2 + 1) {
          for (let k = 0; k < KEEP; k += 1) out.push(ops[i + k])
          out.push({ t: '~', s: String(run - KEEP * 2) })
          for (let k = j - KEEP; k < j; k += 1) out.push(ops[k])
        } else {
          for (let k = i; k < j; k += 1) out.push(ops[k])
        }
        i = j
      }
      return out
    }

    function diffStats(ops) {
      let added = 0
      let removed = 0
      for (const op of ops) {
        if (op.t === '+') added += 1
        else if (op.t === '-') removed += 1
      }
      return { added, removed }
    }

    /* ------------------------------------------------------------------ *
     * Small building blocks
     * ------------------------------------------------------------------ */

    function button(label, onClick, options) {
      const opts = options || {}
      return h('button', {
        type: 'button',
        className: 'tw-btn' + (opts.primary ? ' tw-btn-primary' : '') + (opts.ghost ? ' tw-btn-ghost' : ''),
        onClick,
        disabled: Boolean(opts.disabled),
        title: opts.title || '',
      }, label)
    }

    function StatusBadge(props) {
      if (!props.code) return null
      const labels = { M: '改', A: '新', '?': '未跟踪', D: '删', R: '改', U: '冲' }
      return h('span', { className: 'tw-status tw-status-' + (props.code === '?' ? 'new' : 'mod') }, labels[props.code] || props.code)
    }

    function EmptyState(props) {
      return h('div', { className: 'tw-empty' },
        h('div', { className: 'tw-empty-title' }, props.title),
        h('div', { className: 'tw-empty-body' }, props.body))
    }

    /* ------------------------------------------------------------------ *
     * Diff section
     * ------------------------------------------------------------------ */

    function DiffSection(props) {
      const ops = useMemo(() => collapse(diffOps(splitLines(props.from), splitLines(props.to))), [props.from, props.to])
      const stats = useMemo(() => diffStats(ops), [ops])
      const changed = stats.added + stats.removed > 0
      return h('section', { className: 'tw-change ' + (props.tone || '') },
        h('header', { className: 'tw-change-head' },
          h('span', { className: 'tw-change-title' }, props.title),
          h('span', { className: 'tw-change-sub' }, props.subtitle || ''),
          h('span', { className: 'tw-change-stat' },
            changed ? '+' + stats.added + ' / −' + stats.removed : '无改动')),
        changed
          ? h('div', { className: 'tw-diff' }, ops.map((op, index) => {
              if (op.t === '~') {
                return h('div', { key: index, className: 'tw-gap' }, '⋯ ' + op.s + ' 行未改动')
              }
              return h('div', { key: index, className: 'tw-line tw-line-' + (op.t === ' ' ? 'same' : op.t === '+' ? 'add' : 'del') },
                h('span', { className: 'tw-sign' }, op.t === ' ' ? ' ' : op.t),
                h('span', { className: 'tw-code' }, op.s === '' ? ' ' : op.s))
            }))
          : h('div', { className: 'tw-none' }, props.emptyText || '没有改动'))
    }

    /* ------------------------------------------------------------------ *
     * Main workbench panel
     * ------------------------------------------------------------------ */

    function Workbench() {
      const [workspaces, setWorkspaces] = useState([])
      const [workspace, setWorkspace] = useState('')
      const [tree, setTree] = useState({ repo: false, branch: '', files: [] })
      const [filter, setFilter] = useState('')
      const [rel, setRel] = useState('')
      const [doc, setDoc] = useState(null)
      const [draft, setDraft] = useState('')
      const [dirty, setDirty] = useState(false)
      const [mode, setMode] = useState('split')
      const [notice, setNotice] = useState(null)
      const [message, setMessage] = useState('')
      const [logLines, setLogLines] = useState([])
      const [busy, setBusy] = useState('')
      const [external, setExternal] = useState(false)
      const [gitOutput, setGitOutput] = useState('')
      const editorRef = useRef(null)
      const docRef = useRef(null)
      docRef.current = doc

      const flash = useCallback((kind, text) => {
        setNotice({ kind, text })
        window.setTimeout(() => setNotice((current) => (current && current.text === text ? null : current)), 4000)
      }, [])

      const loadTree = useCallback(async (target) => {
        if (!target) return
        setBusy('tree')
        try {
          const payload = await api('/tree' + query({ dir: target }))
          setTree({ repo: payload.repo, branch: payload.branch, files: payload.files })
          const lines = payload.repo ? await api('/log' + query({ dir: target })) : { lines: [] }
          setLogLines(lines.lines)
        } catch (error) {
          flash('error', String(error.message || error))
        } finally {
          setBusy('')
        }
      }, [flash])

      useEffect(() => {
        let alive = true
        api('/workspaces').then((payload) => {
          if (!alive) return
          setWorkspaces(payload.workspaces)
          if (payload.workspaces.length === 0) return
          let saved = ''
          try {
            saved = window.localStorage.getItem('typora-workbench.workspace') || ''
          } catch { saved = '' }
          const initial = payload.workspaces.some((item) => item.path === saved) ? saved : payload.workspaces[0].path
          setWorkspace(initial)
          let savedRel = ''
          try {
            savedRel = window.localStorage.getItem('typora-workbench.file::' + initial) || ''
          } catch { savedRel = '' }
          if (savedRel) setRel(savedRel)
        }).catch((error) => flash('error', String(error.message || error)))
        return () => { alive = false }
      }, [flash])

      useEffect(() => {
        if (!workspace) return
        try { window.localStorage.setItem('typora-workbench.workspace', workspace) } catch { /* ignore */ }
        loadTree(workspace)
        setDoc(null)
        setDirty(false)
        setExternal(false)
      }, [workspace, loadTree])

      const openDocument = useCallback(async (targetRel) => {
        if (!workspace || !targetRel) return
        if (dirty && !window.confirm('当前文档有未保存的修改，仍然切换吗？')) return
        setBusy('file')
        try {
          const payload = await api('/file' + query({ dir: workspace, rel: targetRel }))
          setRel(targetRel)
          setDoc(payload)
          setDraft(payload.text)
          setDirty(false)
          setExternal(false)
          setGitOutput('')
          try { window.localStorage.setItem('typora-workbench.file::' + workspace, targetRel) } catch { /* ignore */ }
        } catch (error) {
          flash('error', String(error.message || error))
        } finally {
          setBusy('')
        }
      }, [workspace, dirty, flash])

      useEffect(() => {
        if (rel && doc === null && workspace) openDocument(rel)
      }, [rel, doc, workspace, openDocument])

      useEffect(() => {
        if (!workspace || !rel || !doc) return undefined
        const id = window.setInterval(async () => {
          try {
            const payload = await api('/stat' + query({ dir: workspace, rel }))
            const current = docRef.current
            if (current && payload.mtime > 0 && Math.abs(payload.mtime - current.mtime) > 1) {
              setExternal(true)
            }
          } catch { /* ignore polling errors */ }
        }, 5000)
        return () => window.clearInterval(id)
      }, [workspace, rel, doc])

      const save = useCallback(async (silent) => {
        if (!workspace || !rel) return
        setBusy('save')
        try {
          const payload = await api('/save', { method: 'POST', body: { dir: workspace, rel, text: draft } })
          setDoc((current) => (current ? { ...current, text: draft, mine: draft, snapshot: true, mtime: payload.mtime, size: payload.size } : current))
          setDirty(false)
          setExternal(false)
          if (!silent) flash('ok', '已保存')
          loadTree(workspace)
        } catch (error) {
          flash('error', '保存失败：' + String(error.message || error))
        } finally {
          setBusy('')
        }
      }, [workspace, rel, draft, flash, loadTree])

      const reload = useCallback(async () => {
        if (dirty && !window.confirm('重新载入会丢弃未保存的修改，继续吗？')) return
        if (rel) await openDocument(rel)
      }, [dirty, rel, openDocument])

      const markMine = useCallback(async () => {
        if (!workspace || !rel) return
        try {
          await api('/mark', { method: 'POST', body: { dir: workspace, rel } })
          await openDocument(rel)
          flash('ok', '已把当前内容记为「你的改动」基准')
        } catch (error) {
          flash('error', String(error.message || error))
        }
      }, [workspace, rel, openDocument, flash])

      const commit = useCallback(async () => {
        if (!workspace) return
        if (dirty && !window.confirm('编辑器里还有未保存的修改：提交的是磁盘上的内容。仍然提交吗？')) return
        setBusy('commit')
        try {
          const payload = await api('/commit', { method: 'POST', body: { dir: workspace, message } })
          setGitOutput(payload.output || '')
          if (payload.ok) {
            setMessage('')
            flash('ok', '已提交')
            await loadTree(workspace)
            if (rel) {
              const fresh = await api('/file' + query({ dir: workspace, rel }))
              setDoc(fresh)
              setDraft(fresh.text)
              setDirty(false)
            }
          } else {
            flash('error', '提交没有完成，见下方输出')
          }
        } catch (error) {
          flash('error', String(error.message || error))
        } finally {
          setBusy('')
        }
      }, [workspace, message, rel, loadTree, flash])

      const initRepo = useCallback(async () => {
        try {
          const payload = await api('/init', { method: 'POST', body: { dir: workspace } })
          setGitOutput(payload.output || '')
          flash(payload.ok ? 'ok' : 'error', payload.ok ? '已初始化 Git 仓库' : '初始化失败')
          await loadTree(workspace)
        } catch (error) {
          flash('error', String(error.message || error))
        }
      }, [workspace, loadTree, flash])

      const filtered = useMemo(() => {
        const keyword = filter.trim().toLowerCase()
        if (!keyword) return tree.files
        return tree.files.filter((file) => file.rel.toLowerCase().includes(keyword))
      }, [tree.files, filter])

      const words = useMemo(() => (draft.replace(/\s/g, '').length), [draft])
      const lineCount = useMemo(() => (draft === '' ? 0 : draft.split('\n').length), [draft])

      const handleEditorKey = useCallback((event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          save(false)
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          const target = event.target
          const start = target.selectionStart
          const end = target.selectionEnd
          const next = draft.slice(0, start) + '  ' + draft.slice(end)
          setDraft(next)
          setDirty(true)
          window.requestAnimationFrame(() => {
            target.selectionStart = target.selectionEnd = start + 2
          })
        }
      }, [draft, save])

      const theme = (name) => 'var(--dsw-alias-' + name + ')'

      const header = h('div', { className: 'tw-top' },
        h('div', { className: 'tw-top-left' },
          h('select', {
            className: 'tw-select',
            value: workspace,
            onChange: (event) => {
              setRel('')
              setDoc(null)
              setDirty(false)
              setExternal(false)
              setWorkspace(event.target.value)
            },
            title: '选择工作区',
          }, workspaces.map((item) => h('option', { key: item.id, value: item.path }, item.title + ' — ' + item.path))),
          tree.repo
            ? h('span', { className: 'tw-branch', title: '当前分支' }, '⎇ ' + (tree.branch || 'detached'))
            : button('初始化 Git', initRepo, { ghost: true, title: '在这个工作区执行 git init' })),
        h('div', { className: 'tw-tabs' }, [
          { id: 'split', label: '分屏' },
          { id: 'edit', label: '源码' },
          { id: 'preview', label: '预览' },
          { id: 'changes', label: '改动' },
        ].map((tab) => h('button', {
          key: tab.id,
          type: 'button',
          className: 'tw-tab' + (mode === tab.id ? ' tw-tab-active' : ''),
          onClick: async () => {
            setMode(tab.id)
            if ((tab.id === 'changes' || tab.id === 'preview') && rel && !dirty) {
              try {
                const fresh = await api('/file' + query({ dir: workspace, rel }))
                setDoc(fresh)
                setDraft(fresh.text)
                setExternal(false)
              } catch { /* keep current */ }
            }
          },
        }, tab.label))),
        h('div', { className: 'tw-top-right' },
          dirty ? h('span', { className: 'tw-dirty' }, '未保存') : null,
          button(busy === 'save' ? '保存中…' : '保存', () => save(false), { primary: true, disabled: !rel || busy === 'save', title: 'Ctrl+S' }),
          button('刷新', reload, { ghost: true, disabled: !rel, title: '从磁盘重新载入' })))

      const aside = h('aside', { className: 'tw-files' },
        h('input', {
          className: 'tw-filter',
          placeholder: '筛选 Markdown 文件',
          value: filter,
          onChange: (event) => setFilter(event.target.value),
        }),
        h('div', { className: 'tw-file-list' }, filtered.length === 0
          ? h('div', { className: 'tw-none' }, busy === 'tree' ? '读取中…' : '没有 Markdown 文件')
          : filtered.map((file) => h('button', {
              key: file.rel,
              type: 'button',
              className: 'tw-file' + (file.rel === rel ? ' tw-file-active' : ''),
              onClick: () => openDocument(file.rel),
              title: file.rel,
            },
              h('span', { className: 'tw-file-name' }, file.name),
              h('span', { className: 'tw-file-dir' }, file.dir),
              h(StatusBadge, { code: file.status })))))

      let body = null
      if (!rel || !doc) {
        body = h(EmptyState, {
          title: workspaces.length === 0 ? '还没有注册的工作区' : '选择左侧的 Markdown 文件',
          body: '面板会读取工作区里的 .md 文件；保存时把内容写回磁盘，并记录「你最后一次保存」的内容用于区分你和 DSH 的改动。',
        })
      } else if (mode === 'changes') {
        body = h('div', { className: 'tw-changes' },
          external ? h('div', { className: 'tw-banner' }, '磁盘上的文件在面板外被改动过，点「刷新」载入最新内容后再看归属。') : null,
          doc.snapshot === false
            ? h('div', { className: 'tw-banner' }, '这个文件还没有在面板里保存过，暂时以「上次提交」为基准；保存一次后就能精确区分你和 DSH 的改动。')
            : null,
          h(DiffSection, {
            title: '你的改动',
            subtitle: '上次提交（HEAD） → 你在这个面板里最后一次保存',
            from: doc.base,
            to: doc.mine,
            tone: 'tone-user',
            emptyText: '这一层没有改动。',
          }),
          h(DiffSection, {
            title: 'DSH / 外部工具的改动',
            subtitle: '你最后一次保存 → 现在磁盘上的内容',
            from: doc.mine,
            to: doc.text,
            tone: 'tone-agent',
            emptyText: '你保存之后，文件没有被其他进程改过。',
          }),
          h('div', { className: 'tw-commit' },
            h('div', { className: 'tw-commit-row' },
              h('input', {
                className: 'tw-input',
                placeholder: '提交说明（留空会自动生成）',
                value: message,
                onChange: (event) => setMessage(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter') commit() },
              }),
              button(busy === 'commit' ? '提交中…' : '提交全部改动', commit, { primary: true, disabled: busy === 'commit' })),
            h('div', { className: 'tw-commit-actions' },
              button('把当前内容记为「我的改动」基准', markMine, { ghost: true }),
              gitOutput ? button('清空输出', () => setGitOutput(''), { ghost: true }) : null),
            gitOutput ? h('pre', { className: 'tw-output' }, gitOutput) : null,
            logLines.length > 0 ? h('div', { className: 'tw-log' },
              h('div', { className: 'tw-log-title' }, '最近提交'),
              logLines.map((line) => {
                const parts = line.split('\t')
                return h('div', { key: line, className: 'tw-log-row' },
                  h('code', null, parts[0] || ''),
                  h('span', { className: 'tw-log-date' }, parts[1] || ''),
                  h('span', { className: 'tw-log-subject' }, parts[2] || ''))
              })) : null))
      } else {
        const editor = h('textarea', {
          ref: editorRef,
          className: 'tw-editor',
          value: draft,
          spellCheck: false,
          onChange: (event) => { setDraft(event.target.value); setDirty(true) },
          onKeyDown: handleEditorKey,
        })
        const preview = h('div', { className: 'tw-preview' },
          h('article', { className: 'tw-doc', dangerouslySetInnerHTML: { __html: markdownToHtml(draft) } }))
        if (mode === 'edit') body = h('div', { className: 'tw-single' }, editor)
        else if (mode === 'preview') body = h('div', { className: 'tw-single' }, preview)
        else body = h('div', { className: 'tw-split' }, editor, preview)
      }

      const docBar = rel ? h('div', { className: 'tw-docbar' },
        h('span', { className: 'tw-path' }, rel),
        external ? h('span', { className: 'tw-external' }, '磁盘内容已变化，建议刷新') : null,
        h('span', { className: 'tw-spacer' }),
        h('span', { className: 'tw-meta' }, lineCount + ' 行 · ' + words + ' 字')) : null

      return h('div', { className: 'tw-root' },
        header,
        docBar,
        h('div', { className: 'tw-body' }, aside, h('main', { className: 'tw-main' }, body)),
        notice ? h('div', { className: 'tw-notice tw-notice-' + notice.kind }, notice.text) : null)
    }

    /* ------------------------------------------------------------------ *
     * Sidebar panel icon
     * ------------------------------------------------------------------ */

    function PanelIcon(props) {
      const size = (props && props.size) || 18
      const color = (props && props.active) ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
        h('path', { d: 'M7.2 15.2 9.8 9.4l2.6 5.8' }),
        h('path', { d: 'M8.2 13.2h3.2' }),
        h('path', { d: 'M16.2 9.4v5.8' }),
        h('path', { d: 'M16.2 15.2c1.6 0 2.1-1.2 2.1-2.4s-.5-2.4-2.1-2.4' }))
    }

    /* ------------------------------------------------------------------ *
     * Plugin body
     * ------------------------------------------------------------------ */

    const CSS = `
      .tw-root{display:flex;flex-direction:column;height:100%;min-height:420px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden;position:relative}
      .tw-root *{box-sizing:border-box}
      .tw-top{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap}
      .tw-top-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
      .tw-top-right{display:flex;align-items:center;gap:8px}
      .tw-select{max-width:340px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 8px;font-size:12px}
      .tw-branch{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .tw-tabs{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:2px}
      .tw-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:4px 12px;border-radius:6px;cursor:pointer}
      .tw-tab:hover{color:var(--dsw-alias-label-primary)}
      .tw-tab-active{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l1) inset}
      .tw-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
      .tw-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
      .tw-btn:disabled{opacity:.5;cursor:default}
      .tw-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
      .tw-btn-ghost{background:transparent}
      .tw-dirty{font-size:11px;color:var(--dsw-alias-state-warn-primary)}
      .tw-docbar{display:flex;align-items:center;gap:10px;padding:4px 14px;font-size:11px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .tw-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary)}
      .tw-external{color:var(--dsw-alias-state-warn-primary)}
      .tw-spacer{flex:1}
      .tw-meta{white-space:nowrap}
      .tw-body{display:flex;flex:1;min-height:0}
      .tw-files{width:250px;flex:0 0 250px;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill);min-height:0}
      .tw-filter{margin:8px;padding:5px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px}
      .tw-file-list{overflow:auto;flex:1;padding:0 6px 10px}
      .tw-file{display:flex;align-items:center;gap:6px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:12px}
      .tw-file:hover{background:var(--dsw-alias-bg-layer-2)}
      .tw-file-active{background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 1px var(--dsw-alias-border-l1) inset}
      .tw-file-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tw-file-dir{font-size:10px;color:var(--dsw-alias-label-secondary);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tw-status{font-size:10px;padding:0 4px;border-radius:4px;border:1px solid currentColor}
      .tw-status-mod{color:var(--dsw-alias-state-warn-primary)}
      .tw-status-new{color:var(--dsw-alias-state-success-primary)}
      .tw-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}
      .tw-split{display:flex;flex:1;min-height:0}
      .tw-single{display:flex;flex:1;min-height:0}
      .tw-editor{flex:1;min-width:0;resize:none;border:0;outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.75;padding:22px 26px;tab-size:2}
      .tw-preview{flex:1;min-width:0;overflow:auto;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
      .tw-single .tw-editor,.tw-single .tw-preview{border-left:0}
      .tw-doc{max-width:780px;margin:0 auto;padding:34px 44px 90px;font-size:15px;line-height:1.85;color:var(--dsw-alias-label-primary)}
      .tw-doc h1,.tw-doc h2,.tw-doc h3,.tw-doc h4,.tw-doc h5,.tw-doc h6{line-height:1.35;margin:1.4em 0 .6em;font-weight:650}
      .tw-doc h1{font-size:1.9em;margin-top:.7em;padding-bottom:.25em;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .tw-doc h2{font-size:1.5em;padding-bottom:.2em;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .tw-doc h3{font-size:1.25em}
      .tw-doc h4{font-size:1.08em}
      .tw-doc p{margin:.75em 0}
      .tw-doc a{color:var(--dsw-alias-brand-primary);text-decoration:none}
      .tw-doc a:hover{text-decoration:underline}
      .tw-doc ul,.tw-doc ol{padding-left:1.6em;margin:.6em 0}
      .tw-doc li{margin:.25em 0}
      .tw-doc blockquote{margin:.9em 0;padding:.2em 1em;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
      .tw-doc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:.15em .35em}
      .tw-doc pre{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 14px;overflow:auto;margin:.9em 0}
      .tw-doc pre code{background:transparent;padding:0;font-size:12.5px;line-height:1.6}
      .tw-doc table{border-collapse:collapse;margin:.9em 0;font-size:.95em}
      .tw-doc th,.tw-doc td{border:1px solid var(--dsw-alias-border-l1);padding:5px 10px}
      .tw-doc th{background:var(--dsw-alias-bg-layer-2)}
      .tw-doc hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:1.6em 0}
      .tw-doc img{max-width:100%;border-radius:6px}
      .tw-doc .tw-task{list-style:none;margin-left:-1.2em}
      .tw-doc .tw-box{display:inline-block;width:13px;height:13px;border:1px solid var(--dsw-alias-border-l2);border-radius:3px;margin-right:8px;text-align:center;font-size:10px;line-height:13px;color:var(--dsw-alias-brand-primary)}
      .tw-changes{flex:1;overflow:auto;padding:14px 18px 60px}
      .tw-change{margin-bottom:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
      .tw-change-head{display:flex;align-items:baseline;gap:10px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .tw-change-title{font-weight:600;font-size:13px}
      .tw-change-sub{font-size:11px;color:var(--dsw-alias-label-secondary);flex:1}
      .tw-change-stat{font-size:11px;font-family:ui-monospace,monospace}
      .tone-user .tw-change-title{color:var(--dsw-alias-brand-primary)}
      .tone-agent .tw-change-title{color:var(--dsw-alias-state-success-primary)}
      .tw-diff{max-height:420px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6}
      .tw-line{display:flex;gap:8px;padding:0 12px;white-space:pre-wrap;word-break:break-word}
      .tw-sign{width:10px;flex:0 0 10px;color:var(--dsw-alias-label-secondary);user-select:none}
      .tw-code{flex:1;min-width:0}
      .tw-line-add{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)}
      .tw-line-del{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);opacity:.85}
      .tw-line-del .tw-code{text-decoration:line-through}
      .tw-gap{padding:2px 12px;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);text-align:center}
      .tw-none{padding:18px 14px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .tw-commit{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .tw-commit-row{display:flex;gap:8px}
      .tw-input{flex:1;padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px}
      .tw-commit-actions{display:flex;gap:8px;margin-top:8px}
      .tw-output{margin:10px 0 0;padding:10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,monospace;font-size:11px;white-space:pre-wrap;max-height:160px;overflow:auto}
      .tw-log{margin-top:12px}
      .tw-log-title{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
      .tw-log-row{display:flex;gap:10px;font-size:11px;padding:2px 0;align-items:baseline}
      .tw-log-row code{font-family:ui-monospace,monospace;color:var(--dsw-alias-brand-primary)}
      .tw-log-date{color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .tw-log-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tw-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px;text-align:center}
      .tw-empty-title{font-size:15px;font-weight:600}
      .tw-empty-body{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:420px;line-height:1.8}
      .tw-notice{position:absolute;right:18px;bottom:16px;padding:8px 14px;border-radius:8px;font-size:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2)}
      .tw-notice-ok{color:var(--dsw-alias-state-success-primary)}
      .tw-notice-error{color:var(--dsw-alias-state-error-primary)}
      .tw-banner{margin-bottom:12px;padding:8px 12px;border-radius:8px;font-size:12px;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);color:var(--dsw-alias-state-warn-primary)}
    `

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', '@local/typora-workbench')
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        }, 'typora-workbench: styles')
        ctx.effect(
          () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'typora',
            order: 20,
            label: 'Markdown',
          }, PanelIcon)),
          'typora-workbench: panel icon',
        )
        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: 'typora',
          }, Workbench)),
          'typora-workbench: workbench panel',
        )
      },
    }
  },
})
