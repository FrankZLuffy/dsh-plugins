window.__ModuleLoader__.load({
  id: '@local/project-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const API = '/project-board/api'
    const NS = 'project-board'
    const CHOICE_KEY = 'dsh.project-board.openApp.v2'
    const APPS_ROUTE = 'open-in-app/apps'
    const ICON_ROUTE = 'open-in-app/icon/'
    const OPEN_ROUTE = 'open-in-app/open'

    /* ------------------------------------------------------------------ *
     * Dictionaries
     * ------------------------------------------------------------------ */

    const zh = {
      'panel.label': '项目看板',
      'title': '项目看板',
      'subtitle': '每张卡片是一个项目根，可以是文件夹或单个文件。拖拽排序，拖到最前或用图钉置顶。',
      'add.placeholder': '粘贴项目根目录的绝对路径，例如 D:\\MyGithub\\my-app',
      'add.action': '添加',
      'add.busy': '添加中…',
      'added': '已添加到看板',
      'removed': '已从看板移除',
      'loading': '读取中…',
      'empty.title': '还没有项目',
      'empty.body': '把项目根目录粘到上面的输入框里，然后点「添加」。文件夹会用右上角同一份本地应用菜单打开；单个文件用系统默认应用打开，也可以直接显示位置。',
      'kind.dir': '文件夹',
      'kind.file': '文件',
      'missing': '路径不存在',
      'pin.on': '置顶',
      'pin.off': '取消置顶',
      'remove': '移除',
      'confirm.remove': '从看板移除？',
      'confirm.yes': '移除',
      'confirm.no': '取消',
      'drag.hint': '拖拽排序（拖到最前即置顶）',
      'open.folder': '用 {app} 打开',
      'open.file': '用默认应用打开',
      'open.more': '更多打开方式',
      'open.default': '默认',
      'open.reveal': '显示文件位置',
      'open.noApps': '没有检测到可用的本地应用',
      'default.label': '默认打开',
      'default.title': '修改默认打开方式',
      'default.current': '当前',
      'default.changed': '默认打开方式已设为 {app}',
      'app.finder': '访达',
      'app.explorer': '文件资源管理器',
      'app.filemanager': '文件管理器',
      'app.terminal': '终端',
      'count.projects': '个项目',
      'count.pinned': '个置顶',
      'error.not-absolute': '请填写绝对路径（例如 D:\\…）',
      'error.not-found': '路径不存在',
      'error.duplicate': '这个项目已经在看板里了',
      'error.not-registered': '项目不在看板里，请刷新后再试',
      'error.bad-request': '请求无效',
      'error.open': '打开失败，请重试',
      'error.reveal': '无法显示文件位置，请重试',
      'error.add': '添加失败',
      'error.remove': '移除失败',
      'error.generic': '操作失败，请重试',
    }

    const en = {
      'panel.label': 'Project Board',
      'title': 'Project Board',
      'subtitle': 'Each card is a project root — a folder or one file. Drag to reorder, and drop at the front or use the pin to keep it on top.',
      'add.placeholder': 'Paste an absolute project path, e.g. D:\\MyGithub\\my-app',
      'add.action': 'Add',
      'add.busy': 'Adding…',
      'added': 'Added to the board',
      'removed': 'Removed from the board',
      'loading': 'Loading…',
      'empty.title': 'No projects yet',
      'empty.body': 'Paste a project root into the field above and choose Add. Folders open through the same local-application menu as the header; single files open with their system default application, or you can show their location.',
      'kind.dir': 'Folder',
      'kind.file': 'File',
      'missing': 'Path not found',
      'pin.on': 'Pinned',
      'pin.off': 'Unpin',
      'remove': 'Remove',
      'confirm.remove': 'Remove from the board?',
      'confirm.yes': 'Remove',
      'confirm.no': 'Cancel',
      'drag.hint': 'Drag to reorder (drop at the front to pin)',
      'open.folder': 'Open in {app}',
      'open.file': 'Open with default app',
      'open.more': 'More ways to open',
      'open.default': 'default',
      'open.reveal': 'Show file location',
      'open.noApps': 'No local application detected',
      'default.label': 'Default open',
      'default.title': 'Change the default opening app',
      'default.current': 'Current',
      'default.changed': 'Default opening app set to {app}',
      'app.finder': 'Finder',
      'app.explorer': 'File Explorer',
      'app.filemanager': 'Files',
      'app.terminal': 'Terminal',
      'count.projects': 'projects',
      'count.pinned': 'pinned',
      'error.not-absolute': 'Enter an absolute path (for example D:\\…)',
      'error.not-found': 'That path does not exist',
      'error.duplicate': 'That project is already on the board',
      'error.not-registered': 'That project is no longer on the board; refresh and retry',
      'error.bad-request': 'Invalid request',
      'error.open': 'Could not open. Try again.',
      'error.reveal': 'Could not show the location. Try again.',
      'error.add': 'Could not add the project',
      'error.remove': 'Could not remove the project',
      'error.generic': 'Something went wrong. Try again.',
    }

    const ERROR_KEYS = {
      'not-absolute': 'error.not-absolute',
      'not-found': 'error.not-found',
      'duplicate': 'error.duplicate',
      'not-registered': 'error.not-registered',
      'bad-request': 'error.bad-request',
    }

    /** Application ids the shipped open-in-app catalog can label. */
    const PRODUCT_NAMES = {
      cursor: 'Cursor',
      vscode: 'VS Code',
      vscodeinsiders: 'VS Code Insiders',
      typora: 'Typora',
      windsurf: 'Windsurf',
      zed: 'Zed',
      sublimetext: 'Sublime Text',
      xcode: 'Xcode',
      androidstudio: 'Android Studio',
      intellij: 'IntelliJ IDEA',
      pycharm: 'PyCharm',
      webstorm: 'WebStorm',
      phpstorm: 'PhpStorm',
      goland: 'GoLand',
      rider: 'Rider',
      rustrover: 'RustRover',
      fork: 'Fork',
      sourcetree: 'Sourcetree',
      github: 'GitHub Desktop',
      tower: 'Tower',
      gitkraken: 'GitKraken',
      smartgit: 'SmartGit',
      sublimemerge: 'Sublime Merge',
      ghostty: 'Ghostty',
      warp: 'Warp',
      iterm: 'iTerm2',
      kitty: 'kitty',
      windowsterminal: 'Windows Terminal',
      gitbash: 'Git Bash',
      gnometerminal: 'GNOME Terminal',
      konsole: 'Konsole',
    }

    const LOCALIZED_APPS = {
      finder: 'app.finder',
      explorer: 'app.explorer',
      filemanager: 'app.filemanager',
      terminal: 'app.terminal',
    }

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
        payload = {}
      }
      if (!response.ok || payload.ok === false) {
        const error = new Error(payload.error || ('HTTP ' + response.status))
        error.code = payload.code || 'http'
        throw error
      }
      return payload
    }

    async function fetchApps() {
      try {
        const response = await fetch(APPS_ROUTE, { headers: { accept: 'application/json' } })
        if (!response.ok) return []
        const payload = await response.json()
        return Array.isArray(payload.apps) ? payload.apps.filter((id) => typeof id === 'string') : []
      } catch {
        return []
      }
    }

    async function launchInApp(appId, target) {
      const response = await fetch(OPEN_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: appId, path: target }),
      })
      if (response.ok) return
      let code = 'open'
      try {
        const payload = await response.json()
        if (typeof payload.code === 'string') code = payload.code
      } catch {
        /* non-JSON failure keeps the generic code */
      }
      const error = new Error(code)
      error.code = code
      throw error
    }

    function readChoice() {
      try {
        return window.localStorage.getItem(CHOICE_KEY) || 'typora'
      } catch {
        return 'typora'
      }
    }

    function writeChoice(id) {
      try {
        window.localStorage.setItem(CHOICE_KEY, id)
      } catch {
        /* private mode: the choice stays in memory */
      }
    }

    /* ------------------------------------------------------------------ *
     * Icons
     * ------------------------------------------------------------------ */

    function IconFolder(props) {
      const size = (props && props.size) || 15
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M3.5 7.2a2 2 0 0 1 2-2h3.3l1.9 2.1h7.8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z' }))
    }

    function IconFile(props) {
      const size = (props && props.size) || 15
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M6 3.5h7.2L18 8.3v12.2H6z' }),
        h('path', { d: 'M13 3.8V8.6h4.8' }))
    }

    function IconPin(props) {
      const size = (props && props.size) || 13
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'm9 4 6 0 .6 5.2 3 2.5v1.6H5.4v-1.6l3-2.5z' }),
        h('path', { d: 'M12 13.5V20' }))
    }

    function IconGrip() {
      return h('svg', {
        width: 12, height: 18, viewBox: '0 0 12 18', fill: 'currentColor', 'aria-hidden': 'true',
      },
        h('circle', { cx: 3.4, cy: 4, r: 1.25 }),
        h('circle', { cx: 8.6, cy: 4, r: 1.25 }),
        h('circle', { cx: 3.4, cy: 9, r: 1.25 }),
        h('circle', { cx: 8.6, cy: 9, r: 1.25 }),
        h('circle', { cx: 3.4, cy: 14, r: 1.25 }),
        h('circle', { cx: 8.6, cy: 14, r: 1.25 }))
    }

    function IconChevron() {
      return h('svg', {
        width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, h('path', { d: 'm6 9 6 6 6-6' }))
    }

    function IconOpen(props) {
      const size = (props && props.size) || 14
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M13.5 4.5H19.5V10.5' }),
        h('path', { d: 'M19.2 4.8 11 13' }),
        h('path', { d: 'M18 14.5v3.9a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V7.6A1.6 1.6 0 0 1 5.6 6h3.9' }))
    }

    function IconReveal(props) {
      const size = (props && props.size) || 14
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M3.8 7.2a1.9 1.9 0 0 1 1.9-1.9h3.1l1.8 2h7.7a1.9 1.9 0 0 1 1.9 1.9v8a1.9 1.9 0 0 1-1.9 1.9H5.7a1.9 1.9 0 0 1-1.9-1.9z' }),
        h('path', { d: 'M9.4 12.3h5.2' }),
        h('path', { d: 'm12.4 10.2 2.2 2.1-2.2 2.1' }))
    }

    function IconClose(props) {
      const size = (props && props.size) || 13
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'm6.5 6.5 11 11' }),
        h('path', { d: 'm17.5 6.5-11 11' }))
    }

    function IconBoard(props) {
      const size = (props && props.size) || 18
      const color = (props && props.active) ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
        h('path', { d: 'M8 8.2h8' }),
        h('path', { d: 'M8 12h4.6' }),
        h('path', { d: 'M8 15.8h6.2' }),
        h('path', { d: 'M15.4 11.2v2.4' }))
    }

    function AppIcon(props) {
      const [failed, setFailed] = useState(false)
      const size = props.size || 14
      if (failed || !props.id) return h(IconOpen, { size })
      return h('img', {
        src: ICON_ROUTE + props.id,
        width: size,
        height: size,
        alt: '',
        draggable: false,
        style: { borderRadius: 3, display: 'block' },
        onError: () => setFailed(true),
      })
    }

    /* ------------------------------------------------------------------ *
     * Board
     * ------------------------------------------------------------------ */

    function createBoard(t) {
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

      function errorText(error) {
        const code = error && error.code
        return tr(ERROR_KEYS[code] || 'error.generic')
      }

      function appLabel(id) {
        const key = LOCALIZED_APPS[id]
        if (key) return tr(key)
        return PRODUCT_NAMES[id] || id
      }

      function Board() {
        const [projects, setProjects] = useState([])
        const [apps, setApps] = useState([])
        const [loading, setLoading] = useState(true)
        const [choice, setChoice] = useState(readChoice)
        const [input, setInput] = useState('')
        const [adding, setAdding] = useState(false)
        const [busyId, setBusyId] = useState('')
        const [notice, setNotice] = useState(null)
        const [menu, setMenu] = useState(null)
        const [confirmId, setConfirmId] = useState(null)
        const [dragId, setDragId] = useState(null)
        const orderRef = useRef([])
        const pinnedCountRef = useRef(0)
        const menuRef = useRef(null)
        const inputRef = useRef(null)
        const noticeTimer = useRef(null)

        const flash = useCallback((kind, text) => {
          setNotice({ kind, text })
          if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
          noticeTimer.current = window.setTimeout(() => { setNotice(null) }, 4200)
        }, [])

        useEffect(() => () => {
          if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
        }, [])

        const reload = useCallback(async () => {
          try {
            const payload = await api('/projects')
            setProjects(Array.isArray(payload.projects) ? payload.projects : [])
          } catch (error) {
            flash('error', errorText(error))
          }
        }, [flash])

        useEffect(() => {
          let alive = true
          api('/projects').then((payload) => {
            if (!alive) return
            setProjects(Array.isArray(payload.projects) ? payload.projects : [])
            setLoading(false)
          }).catch((error) => {
            if (!alive) return
            setLoading(false)
            flash('error', errorText(error))
          })
          fetchApps().then((list) => { if (alive) setApps(list) })
          return () => { alive = false }
        }, [flash])

        const pinnedCount = useMemo(() => projects.filter((project) => project.pinned).length, [projects])
        const preferredId = useMemo(() => {
          if (apps.length === 0) return undefined
          if (apps.indexOf(choice) !== -1) return choice
          return apps.indexOf('typora') !== -1 ? 'typora' : apps[0]
        }, [apps, choice])

        const add = useCallback(async () => {
          const value = input.trim()
          if (value === '' || adding) {
            if (inputRef.current) inputRef.current.focus()
            return
          }
          setAdding(true)
          try {
            const payload = await api('/add', { method: 'POST', body: { path: value } })
            setProjects(Array.isArray(payload.projects) ? payload.projects : [])
            setInput('')
            flash('ok', tr('added'))
          } catch (error) {
            flash('error', errorText(error))
          } finally {
            setAdding(false)
            if (inputRef.current) inputRef.current.focus()
          }
        }, [adding, flash, input])

        const remove = useCallback(async (id) => {
          try {
            const payload = await api('/remove', { method: 'POST', body: { id } })
            setProjects(Array.isArray(payload.projects) ? payload.projects : [])
            setConfirmId(null)
            flash('ok', tr('removed'))
          } catch (error) {
            flash('error', errorText(error))
          }
        }, [flash])

        const togglePin = useCallback(async (project) => {
          try {
            const payload = await api('/pin', { method: 'POST', body: { id: project.id, pinned: !project.pinned } })
            setProjects(Array.isArray(payload.projects) ? payload.projects : [])
          } catch (error) {
            flash('error', errorText(error))
          }
        }, [flash])

        const setDefaultApp = useCallback((appId) => {
          if (!appId) return
          writeChoice(appId)
          setChoice(appId)
          setMenu(null)
          flash('ok', tr('default.changed', { app: appLabel(appId) }))
        }, [flash])

        const openFolder = useCallback(async (project, appId) => {
          if (!appId) {
            flash('error', tr('open.noApps'))
            return
          }
          setMenu(null)
          setBusyId(project.id)
          try {
            await launchInApp(appId, project.path)
          } catch (error) {
            flash('error', tr('error.open'))
          } finally {
            setBusyId('')
          }
        }, [flash])

        const openFile = useCallback(async (project, action) => {
          setMenu(null)
          setBusyId(project.id)
          try {
            await api('/open', { method: 'POST', body: { id: project.id, action } })
          } catch (error) {
            flash('error', tr(action === 'reveal' ? 'error.reveal' : 'error.open'))
          } finally {
            setBusyId('')
          }
        }, [flash])

        const commitOrder = useCallback(async () => {
          const ids = orderRef.current
          if (ids.length === 0) return
          const pinned = pinnedCountRef.current
          try {
            const payload = await api('/reorder', { method: 'POST', body: { ids, pinnedCount: pinned } })
            setProjects(Array.isArray(payload.projects) ? payload.projects : [])
          } catch (error) {
            flash('error', errorText(error))
            await reload()
          }
        }, [flash, reload])

        const onDragStart = useCallback((event, id) => {
          pinnedCountRef.current = projects.filter((project) => project.pinned).length
          orderRef.current = projects.map((project) => project.id)
          setMenu(null)
          setDragId(id)
          try {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', id)
          } catch {
            /* some WebViews expose no dataTransfer */
          }
        }, [projects])

        const onDragOver = useCallback((event, targetId) => {
          if (dragId === null) return
          event.preventDefault()
          if (dragId === targetId) return
          setProjects((previous) => {
            const from = previous.findIndex((project) => project.id === dragId)
            const to = previous.findIndex((project) => project.id === targetId)
            if (from === -1 || to === -1) return previous
            const next = previous.slice()
            const moved = next.splice(from, 1)[0]
            next.splice(to, 0, moved)
            const count = Math.min(pinnedCountRef.current, next.length)
            const flagged = next.map((project, index) => (index < count
              ? (project.pinned ? project : { ...project, pinned: true })
              : (project.pinned ? { ...project, pinned: false } : project)))
            orderRef.current = flagged.map((project) => project.id)
            return flagged
          })
        }, [dragId])

        const onDragEnd = useCallback(() => {
          const hadDrag = dragId !== null
          setDragId(null)
          if (hadDrag) void commitOrder()
        }, [commitOrder, dragId])

        useEffect(() => {
          if (menu === null) return undefined
          const onPointerDown = (event) => {
            if (menuRef.current !== null && menuRef.current.contains(event.target)) return
            const toggle = event.target && event.target.closest ? event.target.closest('[data-pb-menu-toggle]') : null
            if (toggle !== null) return
            setMenu(null)
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setMenu(null)
          }
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [menu])

        const placeMenu = useCallback((rect) => {
          const width = 232
          return {
            left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 8 - 280)),
          }
        }, [])

        const openMenu = useCallback((event, id) => {
          event.preventDefault()
          event.stopPropagation()
          if (menu !== null && menu.kind === 'project' && menu.id === id) {
            setMenu(null)
            return
          }
          setMenu({ kind: 'project', id, ...placeMenu(event.currentTarget.getBoundingClientRect()) })
        }, [menu, placeMenu])

        const openDefaultMenu = useCallback((event) => {
          event.preventDefault()
          event.stopPropagation()
          if (menu !== null && menu.kind === 'defaults') {
            setMenu(null)
            return
          }
          setMenu({ kind: 'defaults', ...placeMenu(event.currentTarget.getBoundingClientRect()) })
        }, [menu, placeMenu])

        const menuProject = menu === null || menu.kind !== 'project' ? undefined : projects.find((project) => project.id === menu.id)

        function menuItems(project) {
          if (project.kind === 'file') {
            return [
              h(MenuItem, {
                key: 'default',
                icon: h(IconOpen, { size: 14 }),
                label: tr('open.file'),
                onClick: () => { void openFile(project, 'default') },
              }),
              h(MenuItem, {
                key: 'reveal',
                icon: h(IconReveal, { size: 14 }),
                label: tr('open.reveal'),
                onClick: () => { void openFile(project, 'reveal') },
              }),
            ]
          }
          if (apps.length === 0) {
            return [h('div', { key: 'none', className: 'pb-menu-empty' }, tr('open.noApps'))]
          }
          return apps.map((id) => h(MenuItem, {
            key: id,
            icon: h(AppIcon, { id, size: 16 }),
            label: appLabel(id),
            note: id === preferredId ? tr('open.default') : null,
            onClick: () => { void openFolder(project, id) },
          }))
        }

        function card(project) {
          const isFile = project.kind === 'file'
          const preferred = apps.find((id) => id === preferredId)
          const missing = project.exists === false
          const busy = busyId === project.id
          const canOpen = !missing && !busy && (isFile || preferred !== undefined)
          const primaryTitle = isFile
            ? tr('open.file')
            : (preferred !== undefined ? tr('open.folder', { app: appLabel(preferred) }) : tr('open.noApps'))
          const dragging = dragId === project.id

          return h('article', {
            key: project.id,
            className: 'pb-card' + (dragging ? ' pb-dragging' : '') + (project.pinned ? ' pb-pinned' : '') + (missing ? ' pb-missing' : ''),
            onDragOver: (event) => { onDragOver(event, project.id) },
            onDrop: (event) => { event.preventDefault() },
          },
            h('div', { className: 'pb-card-head' },
              h('span', {
                className: 'pb-grip',
                draggable: true,
                title: tr('drag.hint'),
                'aria-label': tr('drag.hint'),
                onDragStart: (event) => { onDragStart(event, project.id) },
                onDragEnd: onDragEnd,
              }, h(IconGrip)),
              h('span', { className: 'pb-kind-icon', 'aria-hidden': 'true' },
                isFile ? h(IconFile, { size: 17 }) : h(IconFolder, { size: 17 })),
              h('div', { className: 'pb-info' },
                h('div', { className: 'pb-name-row' },
                  h('span', { className: 'pb-name', title: project.name }, project.name),
                  project.pinned
                    ? h('span', { className: 'pb-pin-badge', title: tr('pin.on') }, h(IconPin, { size: 11 }), tr('pin.on'))
                    : null),
                h('div', { className: 'pb-path', title: project.path }, project.path),
                h('div', { className: 'pb-meta' },
                  h('span', { className: 'pb-chip' }, isFile ? tr('kind.file') : tr('kind.dir')),
                  missing ? h('span', { className: 'pb-chip pb-chip-warn' }, tr('missing')) : null))),
            h('div', { className: 'pb-card-foot' },
              confirmId === project.id
                ? h('div', { className: 'pb-confirm' },
                  h('span', { className: 'pb-confirm-text' }, tr('confirm.remove')),
                  h('button', {
                    type: 'button',
                    className: 'pb-btn pb-btn-danger',
                    onClick: () => { void remove(project.id) },
                  }, tr('confirm.yes')),
                  h('button', {
                    type: 'button',
                    className: 'pb-btn',
                    onClick: () => { setConfirmId(null) },
                  }, tr('confirm.no')))
                : h('div', { className: 'pb-actions' },
                  h('button', {
                    type: 'button',
                    className: 'pb-icon-btn' + (project.pinned ? ' pb-icon-btn-on' : ''),
                    title: project.pinned ? tr('pin.off') : tr('pin.on'),
                    'aria-label': project.pinned ? tr('pin.off') : tr('pin.on'),
                    'aria-pressed': project.pinned,
                    onClick: () => { void togglePin(project) },
                  }, h(IconPin, { size: 14 })),
                  h('button', {
                    type: 'button',
                    className: 'pb-icon-btn',
                    title: tr('remove'),
                    'aria-label': tr('remove'),
                    onClick: () => { setConfirmId(project.id) },
                  }, h(IconClose, { size: 14 })),
                  h('div', { className: 'pb-split' + (canOpen ? '' : ' pb-split-off') },
                    h('button', {
                      type: 'button',
                      className: 'pb-split-main',
                      disabled: !canOpen,
                      title: primaryTitle,
                      onClick: () => {
                        if (isFile) void openFile(project, 'default')
                        else void openFolder(project, preferred)
                      },
                    }, busy
                      ? h('span', { className: 'pb-spinner' })
                      : (isFile ? h(IconOpen, { size: 14 }) : h(AppIcon, { id: preferred, size: 14 }))),
                    h('button', {
                      type: 'button',
                      className: 'pb-split-more',
                      disabled: missing,
                      title: tr('open.more'),
                      'aria-label': tr('open.more'),
                      'data-pb-menu-toggle': 'true',
                      onPointerDown: (event) => { event.stopPropagation() },
                      onClick: (event) => { openMenu(event, project.id) },
                    }, h(IconChevron)))))
          )
        }

        const countText = projects.length === 0
          ? ''
          : String(projects.length) + ' ' + tr('count.projects') + (pinnedCount > 0 ? ' · ' + String(pinnedCount) + ' ' + tr('count.pinned') : '')

        const body = loading
          ? h('div', { className: 'pb-center' }, h('span', { className: 'pb-spinner pb-spinner-lg' }), h('span', null, tr('loading')))
          : projects.length === 0
            ? h('div', { className: 'pb-center pb-empty' },
              h('div', { className: 'pb-empty-icon' }, h(IconBoard, { size: 40 })),
              h('div', { className: 'pb-empty-title' }, tr('empty.title')),
              h('div', { className: 'pb-empty-body' }, tr('empty.body')))
            : h('div', { className: 'pb-grid' }, projects.map(card))

        return h('div', { className: 'pb-root' },
          h('header', { className: 'pb-top' },
            h('div', { className: 'pb-top-row' },
              h('div', { className: 'pb-heading' },
                h('h1', { className: 'pb-title' }, tr('title')),
                h('p', { className: 'pb-subtitle' }, tr('subtitle'))),
              h('div', { className: 'pb-top-side' },
                preferredId === undefined ? null : h('div', { className: 'pb-default' },
                  h('span', { className: 'pb-default-label' }, tr('default.label')),
                  h('button', {
                    type: 'button',
                    className: 'pb-default-btn',
                    title: tr('default.title'),
                    'data-pb-menu-toggle': 'true',
                    onPointerDown: (event) => { event.stopPropagation() },
                    onClick: openDefaultMenu,
                  },
                    h(AppIcon, { id: preferredId, size: 14 }),
                    h('span', { className: 'pb-default-name' }, appLabel(preferredId)),
                    h(IconChevron))),
                countText === '' ? null : h('span', { className: 'pb-count' }, countText))),
            h('form', {
              className: 'pb-add',
              onSubmit: (event) => { event.preventDefault(); void add() },
            },
              h('input', {
                ref: inputRef,
                className: 'pb-input',
                type: 'text',
                spellCheck: false,
                autoComplete: 'off',
                placeholder: tr('add.placeholder'),
                value: input,
                onChange: (event) => { setInput(event.target.value) },
                'aria-label': tr('add.placeholder'),
              }),
              h('button', {
                type: 'submit',
                className: 'pb-btn pb-btn-primary',
                disabled: adding || input.trim() === '',
              }, adding ? tr('add.busy') : tr('add.action')))),
          h('div', { className: 'pb-scroll', onScroll: () => { if (menu !== null) setMenu(null) } }, body),
          notice === null ? null : h('div', {
            className: 'pb-notice pb-notice-' + (notice.kind === 'error' ? 'error' : 'ok'),
            role: 'status',
          }, notice.text),
          menu === null ? null : h('div', {
            ref: menuRef,
            className: 'pb-menu',
            role: 'menu',
            style: { left: menu.left + 'px', top: menu.top + 'px' },
          }, menu.kind === 'defaults'
            ? [
              h('div', { key: 'title', className: 'pb-menu-title' }, tr('default.title')),
              ...(apps.length === 0
                ? [h('div', { key: 'none', className: 'pb-menu-empty' }, tr('open.noApps'))]
                : apps.map((id) => h(MenuItem, {
                  key: id,
                  icon: h(AppIcon, { id, size: 16 }),
                  label: appLabel(id),
                  note: id === preferredId ? tr('default.current') : null,
                  onClick: () => { setDefaultApp(id) },
                }))),
            ]
            : menuProject === undefined ? null : menuItems(menuProject)))
      }

      function MenuItem(props) {
        return h('button', {
          type: 'button',
          role: 'menuitem',
          className: 'pb-menu-item',
          onClick: props.onClick,
        },
          h('span', { className: 'pb-menu-icon' }, props.icon),
          h('span', { className: 'pb-menu-label' }, props.label),
          props.note ? h('span', { className: 'pb-menu-note' }, props.note) : null)
      }

      function PanelIcon(props) {
        return h(IconBoard, { size: (props && props.size) || 18, active: props && props.active })
      }

      return { Board, PanelIcon }
    }

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    const CSS = `
      .pb-root{display:flex;flex-direction:column;height:100%;min-height:360px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden;position:relative}
      .pb-root *{box-sizing:border-box}
      .pb-top{padding:16px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .pb-top-row{display:flex;align-items:flex-start;gap:16px}
      .pb-heading{flex:1;min-width:0}
      .pb-title{margin:0;font-size:15px;font-weight:650;letter-spacing:.01em}
      .pb-subtitle{margin:3px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);max-width:760px}
      .pb-count{flex:0 0 auto;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .pb-top-side{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
      .pb-default{display:flex;align-items:center;gap:6px}
      .pb-default-label{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .pb-default-btn{display:flex;align-items:center;gap:6px;height:26px;max-width:190px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer}
      .pb-default-btn:hover{border-color:var(--dsw-alias-border-l2)}
      .pb-default-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pb-add{display:flex;gap:8px;margin-top:12px;max-width:820px}
      .pb-input{flex:1;min-width:0;height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12.5px;outline:none}
      .pb-input::placeholder{color:var(--dsw-alias-label-secondary)}
      .pb-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
      .pb-btn{height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer;white-space:nowrap}
      .pb-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
      .pb-btn:disabled{opacity:.5;cursor:default}
      .pb-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
      .pb-btn-primary:hover:not(:disabled){filter:brightness(1.05)}
      .pb-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
      .pb-scroll{flex:1;min-height:0;overflow:auto;padding:16px 20px 48px}
      .pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;max-width:1360px}
      .pb-card{display:flex;flex-direction:column;gap:10px;padding:11px 12px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);transition:border-color .12s ease,box-shadow .12s ease,opacity .12s ease;min-width:0}
      .pb-card:hover{border-color:var(--dsw-alias-border-l2);box-shadow:0 2px 10px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
      .pb-card.pb-dragging{opacity:.45;border-style:dashed;border-color:var(--dsw-alias-brand-primary)}
      .pb-card.pb-pinned{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,var(--dsw-alias-border-l1))}
      .pb-card.pb-missing{opacity:.72}
      .pb-card-head{display:flex;align-items:flex-start;gap:8px;min-width:0}
      .pb-grip{flex:0 0 auto;display:flex;align-items:center;justify-content:center;height:20px;margin-top:1px;color:var(--dsw-alias-state-idle-primary);cursor:grab;opacity:.7}
      .pb-grip:hover{opacity:1;color:var(--dsw-alias-label-secondary)}
      .pb-grip:active{cursor:grabbing}
      .pb-kind-icon{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
      .pb-info{flex:1;min-width:0}
      .pb-name-row{display:flex;align-items:center;gap:6px;min-width:0}
      .pb-name{font-weight:600;font-size:13px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pb-pin-badge{flex:0 0 auto;display:inline-flex;align-items:center;gap:3px;font-size:10px;line-height:1;padding:2px 5px;border-radius:999px;color:var(--dsw-alias-brand-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent)}
      .pb-path{margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pb-meta{display:flex;align-items:center;gap:5px;margin-top:6px;flex-wrap:wrap}
      .pb-chip{font-size:10px;line-height:1;padding:3px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base)}
      .pb-chip-warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent)}
      .pb-card-foot{display:flex;align-items:center;justify-content:flex-end;gap:4px;min-height:26px}
      .pb-actions{display:flex;align-items:center;gap:4px}
      .pb-icon-btn{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
      .pb-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
      .pb-icon-btn-on{color:var(--dsw-alias-brand-primary)}
      .pb-split{display:flex;align-items:stretch;height:26px;margin-left:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
      .pb-split-off{opacity:.5}
      .pb-split-main{display:flex;align-items:center;justify-content:center;min-width:30px;height:100%;padding:0 7px;border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
      .pb-split-main:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
      .pb-split-main:disabled{cursor:default}
      .pb-split-more{display:flex;align-items:center;justify-content:center;width:22px;height:100%;padding:0;border:0;border-left:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .pb-split-more:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
      .pb-split-more:disabled{cursor:default}
      .pb-confirm{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .pb-confirm .pb-btn{height:26px;padding:0 9px;font-size:11.5px}
      .pb-confirm-text{white-space:nowrap}
      .pb-menu{position:fixed;z-index:1200;width:232px;max-height:300px;overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
      .pb-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;text-align:left;cursor:pointer}
      .pb-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}
      .pb-menu-icon{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary)}
      .pb-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pb-menu-note{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-secondary)}
      .pb-menu-title{padding:5px 8px 6px;margin-bottom:3px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}
      .pb-menu-empty{padding:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .pb-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;min-height:220px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center}
      .pb-empty-icon{color:var(--dsw-alias-state-idle-primary);opacity:.8}
      .pb-empty-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
      .pb-empty-body{max-width:440px;line-height:1.75}
      .pb-notice{position:absolute;right:20px;bottom:18px;z-index:1300;padding:7px 13px;border-radius:8px;font-size:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}
      .pb-notice-ok{color:var(--dsw-alias-state-success-primary)}
      .pb-notice-error{color:var(--dsw-alias-state-error-primary)}
      .pb-spinner{display:inline-block;width:12px;height:12px;border:1.6px solid color-mix(in srgb,var(--dsw-alias-label-secondary) 45%,transparent);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:pb-spin .7s linear infinite}
      .pb-spinner-lg{width:18px;height:18px}
      @keyframes pb-spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){.pb-spinner{animation-duration:1.8s}}
    `

    /* ------------------------------------------------------------------ *
     * Plugin body
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'project-board: dictionaries')
        const t = ctx.locale.bind(NS)
        const { Board, PanelIcon } = createBoard(t)

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', '@local/project-board')
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        }, 'project-board: styles')

        ctx.effect(
          () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'projects',
            order: 30,
            label: () => t('panel.label'),
          }, PanelIcon)),
          'project-board: panel icon',
        )

        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: 'projects',
          }, Board)),
          'project-board: board panel',
        )
      },
    }
  },
})
