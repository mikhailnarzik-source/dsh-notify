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
function boot(storedSettings, options = {}) {
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
  // Фоновая лента и таймеры не нужны в тесте — гасим контроллер сразу,
  // если тесту не нужен живой контроллер (например, для плашки обновления).
  let controller
  try {
    controller = window.__dshNotifyController
  } catch {
    controller = undefined
  }
  if (options.keepController !== true) {
    try {
      controller?.dispose?.()
    } catch {
      // контроллер не выставлен — нечего гасить
    }
    controller = undefined
  }
  return { registered, dictionaries, controller }
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

test('карточки-секции: группы «Оформление», «Поведение», «События» и «Дополнительно»', () => {
  const page = renderPage(undefined)
  const cards = find(page, (element) => element.type === 'section' && element.props.className === 'dsh-ntf-group')
  assert.equal(cards.length, 6, 'три группы настроек и три карточки внутри «Дополнительно»')
  const titles = find(page, (element) => element.props.className === 'dsh-ntf-group-title').map((element) => texts(element).join(''))
  for (const key of ['Appearance', 'Behavior', 'Events', 'Updates', 'Preview', 'Recent']) {
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

test('аккордеоны: «Дополнительно» и «Опасная зона» свёрнуты, опасная — внизу', () => {
  const page = renderPage(undefined)
  const accordions = find(page, (element) => element.type === 'section' && /dsh-ntf-acc/.test(String(element.props.className ?? '')))
  assert.equal(accordions.length, 2, 'два аккордеона')
  const toggles = find(page, (element) => String(element.props.className ?? '').startsWith('dsh-ntf-acc-toggle'))
  assert.equal(toggles.length, 2)
  for (const toggle of toggles) assert.equal(toggle.props['aria-expanded'], 'false', 'по умолчанию свёрнуто')
  const bodies = find(page, (element) => String(element.props.className ?? '').startsWith('dsh-ntf-acc-body'))
  assert.equal(bodies.length, 2)
  for (const body of bodies) assert.equal(body.props.hidden, true, 'тело скрыто атрибутом hidden')
  const danger = accordions.find((element) => element.props.className.includes('is-danger'))
  assert.ok(danger, 'опасная зона выделена красным')
  const dangerToggle = find(danger, (element) => String(element.props.className ?? '').startsWith('dsh-ntf-acc-toggle'))[0]
  assert.equal(texts(dangerToggle).join(' ').includes('Danger zone'), true)
  // Опасная зона идёт последней в контейнере страницы.
  const inner = find(page, (element) => element.props.className === 'dsh-ntf-settings-inner')[0]
  const last = inner.children.filter((child) => child !== null).at(-1)
  assert.equal(last, danger, 'опасная зона — последний блок страницы')
  // «Дополнительно» содержит обновления, нативную карточку и журнал.
  const more = accordions.find((element) => !element.props.className.includes('is-danger'))
  for (const key of ['Updates', 'Preview', 'Recent']) {
    assert.ok(texts(more).join(' ').includes(key), `в «Дополнительно» есть ${key}`)
  }
})

test('прогрессивное раскрытие: громкость — после включения звука', () => {
  const off = renderPage({ sound: false })
  assert.equal(find(off, (element) => element.props.className === 'dsh-ntf-range').length, 0, 'без звука ползунка нет')
  assert.ok(texts(off).join(' ').includes('Sound is off — volume appears once it is enabled.'))
  const on = renderPage({ sound: true })
  assert.equal(find(on, (element) => element.props.className === 'dsh-ntf-range').length, 1, 'со звуком ползунок есть')
})

test('прогрессивное раскрытие: разрешение системы — после включения системных', () => {
  const off = renderPage({ system: false })
  const offText = texts(off).join(' ')
  assert.ok(offText.includes('System notifications are off — permission is needed after enabling.'))
  assert.equal(find(off, (element) => element.props.className === 'dsh-ntf-link').length, 0, 'кнопки «Разрешить» нет')
  const on = renderPage({ system: true })
  const onText = texts(on).join(' ')
  assert.ok(!onText.includes('System notifications are off — permission is needed after enabling.'))
})

test('сохранение рядом с полями: бейдж «есть изменения» и кнопки в каждой группе', () => {
  const page = renderPage(undefined)
  const savebars = find(page, (element) => element.props.className === 'dsh-ntf-savebar')
  assert.equal(savebars.length, 3, 'три группы — три ряда сохранения')
  const badges = find(page, (element) => String(element.props.className ?? '').startsWith('dsh-ntf-savebar-badge'))
  assert.equal(badges.length, 3)
  for (const badge of badges) {
    assert.equal(badge.props.className, 'dsh-ntf-savebar-badge')
    assert.equal(texts(badge).join(''), 'no changes')
  }
  const saveButtons = find(page, (element) => element.type === 'button' && texts(element).join('') === 'Save')
  assert.equal(saveButtons.length, 3, 'по кнопке «Сохранить» в каждой группе')
  for (const button of saveButtons) assert.equal(button.props.disabled, true, 'без правок «Сохранить» неактивна')
  // «Отменить» тоже рядом с полями.
  assert.equal(find(page, (element) => element.type === 'button' && texts(element).join('') === 'Revert').length, 3)
})

test('превью тоста свёрнуто и раскрывается кнопкой «Показать пример»', () => {
  const page = renderPage(undefined)
  const toggle = find(page, (element) => element.props.className === 'dsh-ntf-preview-toggle')[0]
  assert.ok(toggle, 'кнопка «Показать пример»')
  assert.equal(toggle.props['aria-expanded'], 'false')
  assert.equal(texts(toggle).join(''), 'Show example')
  const body = find(page, (element) => element.props.className === 'dsh-ntf-preview-body')[0]
  assert.ok(body, 'тело превью')
  assert.equal(body.props.hidden, true, 'превью не показывается до клика')
  // Сцена и кнопки примеров внутри.
  assert.ok(find(body, (element) => element.props.className === 'dsh-ntf-stage').length === 1)
  assert.equal(find(body, (element) => element.type === 'button').length >= 3, true)
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

test('плашка обновления называет плагин, показывает версии и не теряет кнопки', () => {
  const { registered, dictionaries, controller } = boot(undefined, { keepController: true })
  assert.ok(controller !== undefined, 'живой контроллер для плашки')

  // Русская плашка: «Уведомления: доступно обновление», версии — плагин «Уведомления».
  const ru = dictionaries.find((entry) => entry.language === 'ru').dictionary
  assert.equal(`${ru.sectionTitle}: ${ru.updateTitle}`, 'Уведомления: доступно обновление')
  assert.match(`${ru.updatePluginWord} «${ru.sectionTitle}»`, /плагин «Уведомления»/)

  try {
    controller.ingest({ kind: 'update', latestVersion: '1.2.66', currentVersion: '1.2.65' })
    const overlay = registered.find((entry) => entry.options.name === 'shell.overlay')
    assert.ok(overlay !== undefined, 'слой плашек зарегистрирован')
    const tree = render(createElement(overlay.component, {}))

    // Заголовок: название плагина + «доступно обновление» (в тесте — английский словарь).
    const title = find(tree, (element) => element.props.className === 'dsh-ntf-title')[0]
    assert.ok(title !== undefined, 'заголовок плашки')
    assert.equal(texts(title).join(''), 'Notifications: update available')
    assert.match(texts(title).join(''), /Notifications/, 'название плагина в заголовке')

    // Строка версий: название плагина и «установлена → новая».
    const meta = find(tree, (element) => element.props.className === 'dsh-ntf-meta')[0]
    assert.ok(meta !== undefined, 'строка версий')
    assert.equal(texts(meta).join(''), 'plugin «Notifications»: 1.2.65 → 1.2.66')

    // Текст: тоже называет плагин, чтобы было понятно без заголовка.
    const body = find(tree, (element) => element.props.className === 'dsh-ntf-body')[0]
    assert.ok(body !== undefined, 'текст плашки')
    assert.match(texts(body).join(''), /«Notifications» plugin/)
    assert.match(texts(body).join(''), /1\.2\.66/)

    // Кнопки «Обновить» и × на месте, × действительно закрывает плашку.
    const updateButton = find(tree, (element) => element.type === 'button' && texts(element).join('') === 'Update')[0]
    assert.ok(updateButton !== undefined, 'кнопка «Обновить»')
    assert.equal(typeof updateButton.props.onClick, 'function', 'обновление подключено')
    const close = find(tree, (element) => element.type === 'button' && element.props['aria-label'] === 'Dismiss')[0]
    assert.ok(close !== undefined, 'кнопка ×')
    close.props.onClick({ stopPropagation: () => {} })
    assert.equal(controller.toasts.get()[0]?.leaving, true, '× помечает плашку закрытой')
  } finally {
    controller.dispose()
  }
})
