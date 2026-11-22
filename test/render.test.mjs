// Проверка страницы раздела «Уведомления»: общий каркас (контейнер 960,
// шапка с иконкой/чипом/«Обновить»), карточки-секции и словари ru/en.
//
//   node --test test/render.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

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

/** Развернуть функциональные компоненты в простые узлы { type, props, children }. */
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

/** Загрузить browser-часть плагина против заданных сохранённых настроек. */
function boot(storedSettings) {
  let capturedModule
  const dictionaries = []
  const window = {
    __ModuleLoader__: { load: (mod) => { capturedModule = mod } },
    localStorage: {
      getItem: (key) => (key === 'dsh-notify:settings:v1' && storedSettings !== undefined
        ? JSON.stringify(storedSettings)
        : null),
      setItem: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
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
  exportsObject.apply({
    locale: {
      bind: () => (key) => key,
      register: (namespace, language, dictionary) => {
        dictionaries.push({ namespace, language, dictionary })
        return () => {}
      },
      subscribe: () => () => {},
    },
    effect: (fn) => {
      const dispose = fn()
      if (typeof dispose !== 'function') throw new Error('effect returned no disposer')
    },
    on: () => () => {},
    slots: {
      inject: (name, fn) => fn(),
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  })
  // Фоновая лента и таймеры не нужны в тесте — гасим контроллер сразу.
  try {
    window.__dshNotifyController?.dispose?.()
  } catch {
    // контроллер не выставлен — нечего гасить
  }
  return { registered, dictionaries }
}

function renderPage(storedSettings) {
  const { registered } = boot(storedSettings)
  const section = registered.find((entry) => entry.options.name === 'settings.section')
  assert.ok(section !== undefined, 'раздел settings.section зарегистрирован')
  assert.equal(section.options.id, 'notifications')
  return render(createElement(section.component, { size: 16 }))
}

test('страница «Уведомления»: центрированный контейнер maxWidth 960', () => {
  const page = renderPage(undefined)
  const inner = find(page, (element) => element.props.className === 'dsh-ntf-settings-inner')[0]
  assert.ok(inner !== undefined, 'контейнер страницы')
  assert.equal(inner.props.style.maxWidth, 960)
  assert.equal(inner.props.style.margin, '0 auto')
  assert.equal(inner.props.style.padding, '24px 28px 40px')
  assert.equal(inner.props.style.boxSizing, 'border-box')
  assert.equal(inner.props.style.flexDirection, 'column')
})

test('шапка: иконка 52, заголовок, подзаголовок, чип и «Обновить»', () => {
  const page = renderPage(undefined)
  const header = find(page, (element) => element.props.className === 'dsh-ntf-page-head')[0]
  assert.ok(header !== undefined, 'шапка страницы')
  const icon = find(page, (element) => element.props.className === 'dsh-ntf-page-icon')[0]
  assert.equal(texts(icon).join(''), '🔔')
  assert.equal(texts(find(page, (element) => element.props.className === 'dsh-ntf-page-title')[0]).join(''), 'Notifications')
  assert.equal(texts(find(page, (element) => element.props.className === 'dsh-ntf-page-sub')[0]).join(''), 'Toasts, sound and appearance in one place')

  const chip = find(page, (element) => String(element.props.className ?? '').startsWith('dsh-ntf-chip'))[0]
  assert.ok(chip !== undefined, 'чип статуса')
  assert.ok(!chip.props.className.includes('is-off'), 'по умолчанию плашки включены')
  assert.equal(texts(chip).join(''), 'Toasts on')

  const refresh = find(page, (element) => element.props.className === 'dsh-ntf-refresh')[0]
  assert.ok(refresh !== undefined, 'кнопка «Обновить»')
  assert.equal(refresh.type, 'button')
  assert.equal(texts(refresh).join(''), 'Refresh')
})

test('чип меняется на «выключено», когда плашки отключены', () => {
  const page = renderPage({ notifications: false })
  const chip = find(page, (element) => String(element.props.className ?? '').startsWith('dsh-ntf-chip'))[0]
  assert.ok(chip.props.className.includes('is-off'))
  assert.equal(texts(chip).join(''), 'Toasts off')
})

test('карточки-секции: все группы настроек сохранены', () => {
  const page = renderPage(undefined)
  const cards = find(page, (element) => element.type === 'section' && element.props.className === 'dsh-ntf-group')
  assert.equal(cards.length, 7, 'семь карточек-секций')
  const titles = find(page, (element) => element.props.className === 'dsh-ntf-group-title').map((element) => texts(element).join(''))
  for (const key of ['Updates', 'Appearance', 'Notifications', 'Sound', 'System notifications', 'Preview', 'Recent']) {
    assert.ok(titles.includes(key), `заголовок карточки ${key}`)
  }
  // Функциональность: переключатели, поля, кнопки на месте.
  const buttons = find(page, (element) => element.type === 'button')
  assert.ok(buttons.length >= 12, `кнопок на странице: ${buttons.length}`)
  const sourceTexts = texts(page).join(' ')
  for (const key of ['Show notifications', 'Window corner', 'Dwell time', 'Game mode', 'Sound notifications', 'Volume', 'Show in the system', 'Finished', 'Attention', 'Error', 'Nothing yet. The latest notifications appear here.']) {
    assert.ok(sourceTexts.includes(key), `на странице есть строка ${key}`)
  }
  const ranges = find(page, (element) => element.props.className === 'dsh-ntf-range')
  assert.equal(ranges.length, 1, 'ползунок громкости')
  const selects = find(page, (element) => String(element.props.className ?? '').startsWith('dsh-ntf-select'))
  assert.equal(selects.length, 2, 'тема и шрифт')
})

test('CSS страницы: токены DSH, карточки, шапка, адаптив, состояния', () => {
  const page = renderPage(undefined)
  const css = texts(find(page, (element) => element.type === 'style')[0]).join('')
  assert.match(css, /max-width:960px/)
  assert.match(css, /padding:24px 28px 40px/)
  assert.match(css, /\.dsh-ntf-page-icon\{[^}]*width:52px[^}]*height:52px/)
  assert.match(css, /\.dsh-ntf-group\{[^}]*border-radius:14px[^}]*var\(--dsw-alias-bg-layer-1\)/)
  assert.match(css, /border:1px solid var\(--dsw-alias-border-l2\)/)
  assert.match(css, /\.dsh-ntf-group-title::before/)
  assert.match(css, /\.dsh-ntf-chip\{[^}]*display:inline-flex/, 'чип собран на inline-flex')
  assert.match(css, /\.dsh-ntf-chip\{[^}]*height:32px/, 'чип — кнопка: height 32')
  assert.match(css, /\.dsh-ntf-chip\{[^}]*border-radius:10px/, 'чип — не пилюля: radius 10')
  assert.match(css, /\.dsh-ntf-chip\{[^}]*padding:0 12px/, 'padding чипа 0 12')
  assert.match(css, /\.dsh-ntf-chip\{[^}]*border:1px solid/, 'у чипа рамка 1px')
  assert.match(css, /\.dsh-ntf-chip\{[^}]*font-size:12\.5px/, 'шрифт чипа 12.5')
  assert.match(css, /\.dsh-ntf-chip\{[^}]*font-weight:600/, 'шрифт чипа 600')
  assert.match(css, /\.dsh-ntf-chip-dot\{[^}]*width:6px[^}]*height:6px/, 'точка-индикатор 6px')
  assert.match(css, /\.dsh-ntf-chip-dot\{[^}]*background:currentColor/, 'точка наследует цвет чипа')
  assert.doesNotMatch(css, /\.dsh-ntf-chip\{[^}]*border-radius:999/, 'чип больше не пилюля')
  assert.match(css, /:focus-visible/)
  assert.match(css, /:disabled\{opacity:\.55/)
  assert.match(css, /@media \(max-width:760px\)/)
})

test('словари ru/en: одинаковый набор ключей и новые подписи шапки', () => {
  const { dictionaries } = boot(undefined)
  const ru = dictionaries.find((entry) => entry.language === 'ru')
  const en = dictionaries.find((entry) => entry.language === 'en')
  assert.ok(ru !== undefined && en !== undefined, 'зарегистрированы оба словаря')
  assert.deepEqual(Object.keys(ru.dictionary).sort(), Object.keys(en.dictionary).sort(), 'ключи совпадают')
  for (const key of ['pageSubtitle', 'pageChipOn', 'pageChipOff', 'pageRefresh', 'sectionTitle', 'settingsLead']) {
    assert.equal(typeof ru.dictionary[key], 'string', `ru: подпись ${key}`)
    assert.equal(typeof en.dictionary[key], 'string', `en: подпись ${key}`)
    assert.notEqual(ru.dictionary[key].trim(), '')
    assert.notEqual(en.dictionary[key].trim(), '')
  }
})

test('controller: «Обновить» перечитывает настройки и историю', () => {
  const sourceText = source
  assert.match(sourceText, /async function refreshPage\(\)/)
  assert.match(sourceText, /await pullSettingsFromHost\(\)/)
  assert.match(sourceText, /history\.set\(readHistory\(\)\)/)
  assert.match(sourceText, /refreshPage,/)
})
