// Собственная панель «Уведомления» в левой панели: клик показывает только
// настройки плагина (без блоков плагин-менеджера), строка в левой панели живёт
// по закреплению из общего ключа dsh-polish и реагирует на событие panels-changed.
//
//   node --test test/panel.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')
const PACKAGE = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))

const PANEL_ID = 'plugin-notify'
const PANEL_KEY = 'dsh-polish:panel-visibility'
const PANELS_EVENT = 'dsh-polish:panels-changed'

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

function makeStorage() {
  const map = new Map()
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

/** Загрузить browser-часть плагина против заданного состояния панелей. */
function boot(panelState, rawState) {
  const storage = makeStorage()
  if (rawState !== undefined) storage.setItem(PANEL_KEY, rawState)
  else if (panelState !== undefined) storage.setItem(PANEL_KEY, JSON.stringify(panelState))

  const listeners = new Map()
  const cleanups = []
  let capturedModule
  const window = {
    __ModuleLoader__: { load: (mod) => { capturedModule = mod } },
    localStorage: storage,
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      listeners.set(type, list.filter((item) => item !== listener))
    },
    navigator: { platform: 'Win32', userAgentData: { platform: 'Windows' } },
    fetch: () => Promise.resolve({ ok: false }),
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
  new Function('window', 'document', 'navigator', 'fetch', 'getComputedStyle', source)(
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
  const ctx = {
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
      inject: (name, fn) => fn(),
      register: (options, component) => {
        const entry = { options, component, disposed: false }
        registered.push(entry)
        return () => {
          entry.disposed = true
        }
      },
    },
  }
  exportsObject.apply(ctx)
  // Фоновая лента и таймеры не нужны в тесте — гасим контроллер сразу.
  try {
    window.__dshNotifyController?.dispose?.()
  } catch {
    // контроллер не выставлен — нечего гасить
  }

  return {
    registered,
    storage,
    dispatch(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type })
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length
    },
    unload() {
      for (const cleanup of cleanups.reverse()) cleanup()
      cleanups.length = 0
    },
    main() {
      return registered.find((entry) => entry.options.name === 'main')
    },
    panels() {
      return registered.filter((entry) => entry.options.name === 'sidebar.panellist')
    },
  }
}

test('main-панель: ключ plugin-notify зарегистрирован всегда', () => {
  for (const state of [undefined, { visible: [], pinned: [] }, { visible: ['notify'], pinned: ['notify'] }]) {
    const scenario = boot(state)
    const main = scenario.main()
    assert.ok(main !== undefined, 'main-панель зарегистрирована')
    assert.equal(main.options.key, PANEL_ID)
    assert.equal(typeof main.component, 'function')
  }
})

test('страница панели: настройки уведомлений без блоков плагин-менеджера', () => {
  const scenario = boot({ visible: ['notify'], pinned: ['notify'] })
  const page = render(createElement(scenario.main().component, {}))

  // Центрированная страница 960 с шапкой: эмодзи, название, подзаголовок.
  const inner = find(page, (element) => element.props.className === 'dsh-ntf-settings-inner')[0]
  assert.ok(inner !== undefined, 'контейнер страницы')
  assert.equal(inner.props.style.maxWidth, 960)
  assert.equal(inner.props.style.margin, '0 auto')
  assert.equal(inner.props.style.padding, '24px 28px 40px')
  assert.equal(texts(find(page, (element) => element.props.className === 'dsh-ntf-page-icon')[0]).join(''), '🔔')
  assert.equal(texts(find(page, (element) => element.props.className === 'dsh-ntf-page-title')[0]).join(''), 'Notifications')
  assert.equal(
    texts(find(page, (element) => element.props.className === 'dsh-ntf-page-sub')[0]).join(''),
    'Toasts, sound and appearance in one place',
  )

  // Все группы настроек плагина на месте: три группы + карточки «Дополнительно».
  const groups = find(page, (element) => element.type === 'section' && element.props.className === 'dsh-ntf-group')
  assert.equal(groups.length, 6, 'три группы настроек и три карточки «Дополнительно»')
  const labels = texts(page).join(' ')
  for (const key of ['Show notifications', 'Game mode', 'Sound notifications', 'Preview', 'Behavior', 'Events', 'Danger zone']) {
    assert.ok(labels.includes(key), `есть строка ${key}`)
  }

  // Служебных блоков плагин-менеджера нет.
  assert.equal(find(page, (element) => element.props['data-detail-document'] !== undefined).length, 0)
  assert.equal(find(page, (element) => element.props['data-detail-sections'] !== undefined).length, 0)
  const managerClasses = find(page, (element) => /detail(Desc|Document|Sections|Title|Source|Version)/i.test(String(element.props.className ?? '')))
  assert.equal(managerClasses.length, 0, 'нет классов страницы плагин-менеджера')
})

test('строки sidebar нет, пока панель не закреплена; main остаётся', () => {
  const scenario = boot({ visible: ['notify'], pinned: [] })
  assert.equal(scenario.panels().length, 0, 'незакреплённая панель не попадает в левую панель')
  assert.ok(scenario.main() !== undefined, 'main-панель всё равно доступна')
})

test('закреплённая панель: строка sidebar с id plugin-notify, order 23 и подписью', () => {
  const scenario = boot({ visible: ['notify'], pinned: ['notify'] })
  const rows = scenario.panels()
  assert.equal(rows.length, 1, 'одна строка левой панели')
  const [row] = rows
  assert.equal(row.options.id, PANEL_ID)
  assert.equal(row.options.order, 23)
  assert.equal(row.options.name, 'sidebar.panellist')
  assert.equal(typeof row.options.label, 'function')
  assert.equal(row.options.label(), 'Notifications')
  assert.equal(typeof row.component, 'function')

  // Иконка — эмодзи, размер берётся из props хоста.
  const icon = render(createElement(row.component, { size: 18 }))
  assert.equal(texts(icon).join(''), '🔔')
  assert.equal(icon.props.style.width, 18)
  assert.equal(icon.props.style.height, 18)
})

test('без ключа dsh-polish панель считается закреплённой (состояние по умолчанию)', () => {
  const scenario = boot(undefined)
  assert.equal(scenario.panels().length, 1, 'по умолчанию строка видна — как в dsh-polish')
  assert.equal(scenario.storage.getItem(PANEL_KEY), null, 'ключ по умолчанию не пишется')
})

test('битое значение ключа не ломает панель: состояние по умолчанию', () => {
  const scenario = boot(undefined, '{не json')
  assert.ok(scenario.main() !== undefined, 'main-панель на месте')
  assert.equal(scenario.panels().length, 1, 'при битом значении панель считается закреплённой')
})

test('реакция на dsh-polish:panels-changed: закрепили — строка появилась, открепили — снята', () => {
  const scenario = boot({ visible: ['notify'], pinned: [] })
  assert.equal(scenario.panels().length, 0)
  assert.equal(scenario.listenerCount(PANELS_EVENT), 1, 'слушатель события подписан')

  scenario.storage.setItem(PANEL_KEY, JSON.stringify({ visible: ['notify'], pinned: ['notify'] }))
  scenario.dispatch(PANELS_EVENT)
  assert.equal(scenario.panels().length, 1, 'строка появилась без перезагрузки')
  const row = scenario.panels()[0]

  // Повторное событие без изменений не плодит дубли.
  scenario.dispatch(PANELS_EVENT)
  assert.equal(scenario.panels().length, 1, 'дублей нет')

  // Открепили: регистрация снята через disposer.
  scenario.storage.setItem(PANEL_KEY, JSON.stringify({ visible: ['notify'], pinned: [] }))
  scenario.dispatch(PANELS_EVENT)
  assert.equal(row.disposed, true, 'disposer вызван')

  // Вернули: строка регистрируется заново.
  scenario.storage.setItem(PANEL_KEY, JSON.stringify({ visible: ['notify'], pinned: ['notify'] }))
  scenario.dispatch(PANELS_EVENT)
  assert.equal(scenario.panels().filter((entry) => entry.disposed === false).length, 1, 'строка вернулась')
})

test('выгрузка плагина снимает слушатель и строку панели', () => {
  const scenario = boot({ visible: ['notify'], pinned: ['notify'] })
  const row = scenario.panels()[0]
  scenario.unload()
  assert.equal(scenario.listenerCount(PANELS_EVENT), 0, 'слушатель снят')
  assert.equal(row.disposed, true, 'строка левой панели снята')
})

test('версия поднята на +0.0.1', () => {
  assert.equal(PACKAGE.version, '1.2.67')
})
