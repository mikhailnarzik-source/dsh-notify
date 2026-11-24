// Настройка «Тосты о субагентах в открытом чате» и индикатор субагентов.
//
// Клиентская часть: настройка читается/сохраняется, при выключенной настройке
// плашка субагента подавлена в открытом родительском чате при фокусе, при
// включённой — показывается; чип «субагенты: N работают, M завершено» виден
// в шапке настроек.
//
// Host-часть: счётчик активных по turnStarts и завершённых накопительно,
// запись `subagents` в ленте, снимок в ответах ленты, state.json и settings.json.
//
//   node --test test/subagents.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, FEED_PATH, SETTINGS_PATH } from '../index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/* --- Общий каркас для рендера без браузера -------------------------------- */

const createElement = (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } })

const React = {
  createElement,
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (value) => ({ current: value }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  memo: (fn) => fn,
  useReducer: (_reducer, initial) => [initial, () => {}],
}

function render(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (Array.isArray(node)) return node.map(render)
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node.type === 'function') return render(node.type(node.props))
  const raw = node.props?.children
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return { type: node.type, props: node.props ?? {}, children: list.map(render) }
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  for (const child of node.children ?? []) walk(child, visit)
}

function texts(node, found = []) {
  if (typeof node === 'string') {
    found.push(node)
    return found
  }
  if (node === null || node === undefined) return found
  if (Array.isArray(node)) {
    for (const item of node) texts(item, found)
    return found
  }
  for (const child of node.children ?? []) texts(child, found)
  return found
}

function find(node, predicate) {
  const found = []
  walk(node, (element) => {
    if (predicate(element)) found.push(element)
  })
  return found
}

/* --- Загрузка browser-части плагина --------------------------------------- */

function bootClient(storedSettings) {
  let capturedModule
  const storage = new Map()
  const window = {
    __ModuleLoader__: { load: (mod) => { capturedModule = mod } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    navigator: { platform: 'Win32', userAgentData: { platform: 'Windows' } },
    fetch: () => Promise.resolve({ ok: false }),
    matchMedia: () => ({ matches: false }),
  }
  const document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '#000000' }) }),
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
    documentElement: {},
    body: {},
    hasFocus: () => true,
  }
  if (storedSettings !== undefined) storage.set('dsh-notify:settings:v1', JSON.stringify(storedSettings))

  new Function('window', 'document', 'navigator', 'fetch', 'getComputedStyle', SOURCE)(
    window,
    document,
    globalThis.navigator,
    window.fetch,
    () => ({ getPropertyValue: () => '' }),
  )
  assert.ok(capturedModule !== undefined, 'bundle зарегистрировал модуль')

  const exportsObject = capturedModule.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })

  const registered = []
  const cleanups = []
  exportsObject.apply({
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
      subscribe: () => () => {},
    },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose !== 'function') throw new Error('effect returned no disposer')
      cleanups.push(dispose)
    },
    on: () => () => {},
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  })
  const controller = window.__dshNotifyController
  assert.ok(controller !== undefined, 'контроллер выставлен на window')

  return {
    registered,
    storage,
    document,
    controller,
    dispose() {
      for (const dispose of [...cleanups].reverse()) dispose()
    },
    settingsPage() {
      const section = registered.find((entry) => entry.options.name === 'settings.section')
      assert.ok(section !== undefined, 'раздел settings.section зарегистрирован')
      return render(createElement(section.component, { size: 16 }))
    },
  }
}

/** Запись о завершившемся субагенте, как её публикует host. */
function subagentDone(parentSessionId = 'parent-1') {
  return {
    kind: 'done',
    sessionId: 'agent-1',
    sessionTitle: 'Разведчик',
    reason: '',
    tool: '',
    question: '',
    message: '',
    durationMs: 12000,
    at: Date.now(),
    subagent: true,
    agentTitle: 'agent-1',
    parentTitle: 'Родитель',
    parentSessionId,
  }
}

/* --- Клиентские тесты ------------------------------------------------------ */

test('настройка subagentInChat: по умолчанию выключена, читается из localStorage', () => {
  const off = bootClient(undefined)
  try {
    assert.equal(off.controller.settings.get().subagentInChat, false)
  } finally {
    off.dispose()
  }
  const on = bootClient({ subagentInChat: true })
  try {
    assert.equal(on.controller.settings.get().subagentInChat, true)
  } finally {
    on.dispose()
  }
})

test('выключено: плашка субагента подавлена в открытом родительском чате при фокусе', () => {
  const scenario = bootClient(undefined)
  try {
    const c = scenario.controller
    c.setActiveSession('parent-1')
    scenario.document.hasFocus = () => true
    c.ingest(subagentDone())
    assert.equal(c.toasts.get().length, 0, 'плашка не показана')
    assert.equal(c.history.get().length, 1, 'событие осталось в истории')
  } finally {
    scenario.dispose()
  }
})

test('включено: плашка субагента показывается в открытом родительском чате', () => {
  const scenario = bootClient({ subagentInChat: true })
  try {
    const c = scenario.controller
    c.setActiveSession('parent-1')
    c.ingest(subagentDone())
    assert.equal(c.toasts.get().length, 1, 'плашка показана')
    assert.equal(c.toasts.get()[0].subagent, true)
    assert.equal(c.toasts.get()[0].parentSessionId, 'parent-1')
  } finally {
    scenario.dispose()
  }
})

test('выключено, но окно не в фокусе: подавления нет (канал карточки/плашки)', () => {
  const scenario = bootClient(undefined)
  try {
    const c = scenario.controller
    c.setActiveSession('parent-1')
    scenario.document.hasFocus = () => false
    c.ingest(subagentDone())
    assert.equal(c.toasts.get().length, 1, 'без фокуса плашка показывается')
  } finally {
    scenario.dispose()
  }
})

test('в чужом чате подавления нет и при выключенной настройке', () => {
  const scenario = bootClient(undefined)
  try {
    const c = scenario.controller
    c.setActiveSession('other-session')
    scenario.document.hasFocus = () => true
    c.ingest(subagentDone())
    assert.equal(c.toasts.get().length, 1, 'другая сессия — плашка видна')
  } finally {
    scenario.dispose()
  }
})

test('запись subagents обновляет счётчик, чип виден в шапке настроек', () => {
  const scenario = bootClient(undefined)
  try {
    const c = scenario.controller
    c.ingest({ kind: 'subagents', active: 2, completed: 5, at: Date.now() })
    assert.deepEqual(c.subagentStats.get(), { active: 2, completed: 5 })

    const page = scenario.settingsPage()
    const chips = find(page, (element) => element.props.className === 'dsh-ntf-subagents')
    assert.equal(chips.length, 1, 'чип-индикатор в шапке')
    assert.equal(texts(chips[0]).join(''), 'subagents: 2 are working, 5 finished')

    c.ingest({ kind: 'subagents', active: 1, completed: 0, at: Date.now() })
    const chipOne = find(scenario.settingsPage(), (element) => element.props.className === 'dsh-ntf-subagents')[0]
    assert.equal(texts(chipOne).join(''), 'subagents: 1 is working, 0 finished')

    c.ingest({ kind: 'subagents', active: 0, completed: 0, at: Date.now() })
    assert.equal(find(scenario.settingsPage(), (element) => element.props.className === 'dsh-ntf-subagents').length, 0, 'при нулях чипа нет')
  } finally {
    scenario.dispose()
  }
})

test('переключатель в настройках: подпись, по умолчанию выключен, применяется «Сохранить»', () => {
  const scenario = bootClient(undefined)
  try {
    const page = scenario.settingsPage()
    assert.ok(texts(page).join(' ').includes('Subagent toasts in the open chat'), 'подпись настройки')
    const switches = find(page, (element) => element.type === 'button' && element.props['aria-label'] === 'Subagent toasts in the open chat')
    assert.equal(switches.length, 1, 'один переключатель')
    assert.ok(!switches[0].props.className.includes('is-on'), 'по умолчанию выключен')

    // Клик только правит черновик: без «Сохранить» настройка не применяется и не пишется.
    switches[0].props.onClick()
    assert.equal(scenario.controller.settings.get().subagentInChat, false, 'до «Сохранить» настройка не применена')
    assert.equal(scenario.storage.get('dsh-notify:settings:v1'), undefined, 'на диск раньше времени не пишется')

    // Сохранение группы «События» (то, что делает кнопка «Сохранить») применяет поле.
    scenario.controller.update({ subagentInChat: true })
    assert.equal(scenario.controller.settings.get().subagentInChat, true, 'после «Сохранить» настройка применена')
    const stored = JSON.parse(scenario.storage.get('dsh-notify:settings:v1'))
    assert.equal(stored.subagentInChat, true, 'настройка сохранена')
  } finally {
    scenario.dispose()
  }
})

/* --- Host-тесты ------------------------------------------------------------ */

/** Контекст плагина с поддельными сессиями и регистрацией маршрутов. */
function makeHostCtx(sessions) {
  const handlers = {}
  const routes = new Map()
  const cleanups = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
    on(event, handler) {
      handlers[event] = handler
      return () => {}
    },
    get(name) {
      if (name === 'sessions') {
        return {
          get: (id) => sessions.get(id),
          list: () => [...sessions.values()],
        }
      }
      if (name === 'sessionQuery') {
        return {
          readTitleSnapshots: async (ids) => ids.map((id) => ({ status: 'fulfilled', value: { title: { title: `title-${id}` } } })),
          listEvents: async () => [],
          readEvent: async () => ({}),
        }
      }
      return undefined
    },
    connection: {
      fetch: {
        register(options) {
          routes.set(options.path, options.fetch)
        },
      },
    },
  }
  return { ctx, handlers, routes, cleanups }
}

function subagentSessions() {
  return new Map([
    ['agent-1', { header: { id: 'agent-1', origin: 'subagent', parentSession: 'parent-1' } }],
    ['parent-1', { header: { id: 'parent-1', origin: 'agent' } }],
  ])
}

function json(response) {
  return response.json()
}

test('host: счётчик субагентов, state.json, лента и settings.json', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-subagents-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = temp
  t.after(() => {
    process.env.DSH_HOME = previousHome
    fs.rmSync(temp, { recursive: true, force: true })
  })

  const first = makeHostCtx(subagentSessions())
  t.after(() => {
    for (const dispose of first.cleanups.reverse()) dispose()
  })
  apply(first.ctx)

  const feed = first.routes.get(FEED_PATH)
  const settingsRoute = first.routes.get(SETTINGS_PATH)
  assert.ok(feed !== undefined && settingsRoute !== undefined, 'маршруты зарегистрированы')

  // Базовый срез: счётчик нулевой.
  const base = await feed(new Request(`http://host${FEED_PATH}`)).then(json)
  assert.deepEqual(base.subagents, { active: 0, completed: 0 })

  // Субагент начал ход: active = 1.
  first.handlers['session/event'](first.ctx.get('sessions').get('agent-1'), { type: 'turn/start', time: 1000, data: {} })
  const working = await feed(new Request(`http://host${FEED_PATH}`)).then(json)
  assert.deepEqual(working.subagents, { active: 1, completed: 0 })

  // Субагент завершил ход: active = 0, completed = 1, счётчик на диске.
  first.handlers['session/event'](first.ctx.get('sessions').get('agent-1'), {
    type: 'turn/end',
    time: 5000,
    data: { reason: { kind: 'completed' } },
  })
  await new Promise((resolve) => setTimeout(resolve, 40))
  const done = await feed(new Request(`http://host${FEED_PATH}`)).then(json)
  assert.deepEqual(done.subagents, { active: 0, completed: 1 })
  const state = JSON.parse(fs.readFileSync(path.join(temp, 'dsh-notify', 'state.json'), 'utf8'))
  assert.equal(state.completedSubagents, 1, 'счётчик сохранён в state.json')

  // В ленте за курсором: записи счётчика и плашка субагента с полями агента.
  const batch = await feed(new Request(`http://host${FEED_PATH}?cursor=${base.cursor}&hold=0`)).then(json)
  const kinds = batch.items.map((item) => item.kind)
  assert.ok(kinds.includes('subagents'), 'запись счётчика в ленте')
  assert.ok(kinds.includes('done'), 'плашка субагента в ленте')
  const toastItem = batch.items.find((item) => item.kind === 'done')
  assert.equal(toastItem.subagent, true, 'запись помечена subagent')
  assert.equal(toastItem.agentTitle, 'title-agent-1')
  assert.equal(toastItem.parentTitle, 'title-parent-1')
  assert.equal(toastItem.parentSessionId, 'parent-1')
  const statsItems = batch.items.filter((item) => item.kind === 'subagents')
  assert.ok(statsItems.length >= 2, 'записи счётчика на старте и на завершении')
  const lastStats = statsItems[statsItems.length - 1]
  assert.equal(lastStats.active, 0)
  assert.equal(lastStats.completed, 1)

  // Настройки: subagentInChat сохраняется в settings.json и читается обратно.
  const save = await settingsRoute(new Request(`http://host${SETTINGS_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings: { notifications: false, subagentInChat: true } }),
  })).then(json)
  assert.equal(save.ok, true)
  const fileSettings = JSON.parse(fs.readFileSync(path.join(temp, 'dsh-notify', 'settings.json'), 'utf8'))
  assert.equal(fileSettings.subagentInChat, true, 'настройка в settings.json')
  const readBack = await settingsRoute(new Request(`http://host${SETTINGS_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })).then(json)
  assert.equal(readBack.ok, true)
  assert.equal(readBack.settings.subagentInChat, true, 'настройка читается из settings.json')

  // Новый хост (после перезапуска) читает счётчик завершённых с диска.
  const second = makeHostCtx(subagentSessions())
  t.after(() => {
    for (const dispose of second.cleanups.reverse()) dispose()
  })
  apply(second.ctx)
  const feed2 = second.routes.get(FEED_PATH)
  const base2 = await feed2(new Request(`http://host${FEED_PATH}`)).then(json)
  assert.deepEqual(base2.subagents, { active: 0, completed: 1 }, 'счётчик пережил перезапуск хоста')
})
