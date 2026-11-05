// Headless check of the settings preview: stub React and the DOM, boot the
// browser half twice (defaults and a custom look) and assert that the preview
// card follows the chosen shape, corner, text size, font and style.
//
//   node tools/preview-smoke.mjs
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
}

function render(node, depth = 0) {
  if (depth > 60) throw new Error('render recursion too deep')
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (Array.isArray(node)) return node.map((child) => render(child, depth + 1))
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node.type === 'function') return render(node.type(node.props), depth + 1)
  return {
    type: node.type,
    props: node.props,
    children: (node.props?.children ?? []).flat(Infinity).map((child) => render(child, depth + 1)),
  }
}

const findAll = (node, predicate, out = []) => {
  if (node === null || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

const withClass = (name) => (node) => typeof node.type === 'string' && node.props?.className === name

/** Boot one fresh copy of the bundle against a given stored settings value. */
function boot(storedSettings) {
  let capturedModule
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
  if (capturedModule === undefined) throw new Error('bundle did not register a module')

  const exportsObject = capturedModule.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })

  const registered = []
  exportsObject.apply({
    locale: { bind: () => (key) => key, register: () => () => {}, subscribe: () => () => {} },
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
  return registered
}

function inspect(label, storedSettings, expected) {
  const registered = boot(storedSettings)
  const section = registered.find((entry) => entry.options.name === 'settings.section')
  if (section === undefined) throw new Error('settings section was not registered')
  const tree = render(createElement(section.component, { size: 16 }))

  const stage = findAll(tree, withClass('dsh-ntf-stage'))[0]
  if (stage === undefined) throw new Error('preview stage is missing')
  const cards = findAll(tree, (node) => typeof node.type === 'string'
    && String(node.props?.className ?? '').startsWith('dsh-ntf-card'))
  if (cards.length === 0) throw new Error('preview card is missing')
  const card = cards[0]
  const style = card.props.style ?? {}

  const rows = findAll(tree, withClass('dsh-ntf-row-title')).map((node) => String(node.children?.[0] ?? ''))
  const groups = findAll(tree, withClass('dsh-ntf-group-title')).map((node) => String(node.children?.[0] ?? ''))
  if (!groups.includes('Updates')) throw new Error('the updates section is missing')
  console.log(`[${label}]`)
  console.log('  groups  :', groups.join(' | '))
  console.log('  rows    :', rows.join(' | '))
  console.log('  corner  :', stage.props['data-pos'], '| variant:', card.props['data-variant'])
  console.log('  type    :', style['--dsh-ntf-font-size'], String(style['--dsh-ntf-font-family']).slice(0, 32),
    style['--dsh-ntf-font-style'], style['--dsh-ntf-font-weight'])
  console.log('  progress:', findAll(card, withClass('dsh-ntf-progress')).length > 0 ? 'yes' : 'no')

  if (card.props['data-variant'] !== expected.variant) throw new Error(`variant did not follow settings: ${card.props['data-variant']}`)
  if (stage.props['data-pos'] !== expected.corner) throw new Error(`corner did not follow settings: ${stage.props['data-pos']}`)
  if (style['--dsh-ntf-font-size'] !== expected.size) throw new Error(`text size did not follow settings: ${style['--dsh-ntf-font-size']}`)
  if (!String(style['--dsh-ntf-font-family']).includes(expected.family)) throw new Error('font family did not follow settings')
  if (style['--dsh-ntf-font-style'] !== expected.style) throw new Error('font style did not follow settings')
}

inspect('defaults', undefined, {
  variant: 'card',
  corner: 'bottom-right',
  size: '13px',
  family: 'inherit',
  style: 'normal',
})

inspect('custom look', {
  variant: 'banner',
  position: 'top-left',
  duration: 10000,
  textSize: 17,
  fontFamily: 'mono',
  fontStyle: 'italic',
  theme: 'dark',
}, {
  variant: 'banner',
  corner: 'top-left',
  size: '17px',
  family: 'mono',
  style: 'italic',
})

console.log('all preview checks passed')
process.exit(0)
