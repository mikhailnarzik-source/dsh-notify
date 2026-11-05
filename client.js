/**
 * Browser half of the task-notification bundle.
 *
 * Three toast kinds in the Harness look — green "done", amber "your move",
 * red "failed" — drawn in the frame-wide overlay layer, each with its own
 * synthesized sound. Notifications and sound switch independently, and the
 * settings page owns every choice: variant, corner, dwell time, volume,
 * background-only mode and system notifications.
 *
 * The Host half publishes small records; this half long-polls its authenticated
 * route so an idle page holds one quiet request instead of a timer loop.
 */

window.__ModuleLoader__.load({
  id: 'dsh-notify',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace and the package identity used by the module loader. */
    const NS = 'dsh-notify'
    /** Host route registered by this package's Node half. */
    const FEED_PATH = '/api/dsh-notify.feed'
    const STORAGE_KEY = 'dsh-notify:settings:v1'
    const HISTORY_KEY = 'dsh-notify:history:v1'
    const HISTORY_LIMIT = 10
    const MAX_VISIBLE = 4

    const VARIANTS = ['compact', 'card', 'banner']
    const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left']
    const DURATIONS = [4000, 6000, 10000, 0]

    const DEFAULTS = {
      notifications: true,
      sound: true,
      variant: 'card',
      position: 'bottom-right',
      duration: 6000,
      volume: 60,
      onlyUnfocused: false,
      system: false,
    }

    /** Every visible string, Russian and English; an unknown locale falls back to English. */
    const DICT = {
      ru: {
        doneTitle: 'Задача завершена',
        attentionTitle: 'Нужно ваше действие',
        errorTitle: 'Произошла ошибка',
        doneBody: 'Агент закончил работу.',
        doneIn: 'за {duration}',
        approvalBody: 'Подтвердите вызов инструмента «{tool}».',
        approvalBodyPlain: 'Агент ждёт подтверждения действия.',
        questionBody: 'Агент ждёт вашего ответа.',
        planBody: 'Агент просит проверить план.',
        blockedBody: 'Ход остановлен: нужно ваше разрешение.',
        errorBody: 'Не удалось завершить задачу.',
        maxTokensBody: 'Ответ оборван по лимиту длины.',
        untitledSession: 'Без названия',
        open: 'Открыть',
        dismiss: 'Скрыть',
        unitSec: 'с',
        unitMin: 'мин',
        unitHour: 'ч',
        sectionTitle: 'Уведомления',
        settingsLead: 'Плашки о завершённой задаче, запросе подтверждения и ошибке — со своим звуком для каждого случая.',
        groupShow: 'Показ уведомлений',
        notifications: 'Показывать уведомления',
        notificationsHint: 'Плашки в углу окна. Звук настраивается отдельно.',
        variant: 'Форма плашки',
        variantHint: 'Компактная строка, карточка с подробностями или широкая полоса.',
        variantCompact: 'Строка',
        variantCard: 'Карточка',
        variantBanner: 'Полоса',
        position: 'Угол экрана',
        positionHint: 'Где появляется стопка плашек.',
        positionBottomRight: 'Справа снизу',
        positionBottomLeft: 'Слева снизу',
        positionTopRight: 'Справа сверху',
        positionTopLeft: 'Слева сверху',
        duration: 'Сколько висит',
        durationHint: 'Через это время плашка уезжает сама.',
        duration4: '4 с',
        duration6: '6 с',
        duration10: '10 с',
        durationNever: 'Не скрывать',
        onlyUnfocused: 'Только когда окно не в фокусе',
        onlyUnfocusedHint: 'Пока вы в приложении, ничего не показывается и не звучит.',
        groupSound: 'Звук',
        sound: 'Звуковые уведомления',
        soundHint: 'Мягкие сигналы: завершение, внимание, ошибка.',
        volume: 'Громкость',
        volumeHint: 'Относительная громкость сигналов.',
        groupSystem: 'Системные уведомления',
        system: 'Показывать в системе',
        systemHint: 'Уведомление Windows, когда окно приложения свёрнуто или не в фокусе.',
        systemUnsupported: 'Это окно не поддерживает системные уведомления.',
        systemGranted: 'Разрешение выдано.',
        systemDenied: 'Системные уведомления запрещены в настройках браузера.',
        systemAsk: 'Разрешить',
        groupPreview: 'Проверка',
        previewHint: 'Показать плашку и проиграть звук прямо сейчас.',
        previewDone: 'Завершение',
        previewAttention: 'Внимание',
        previewError: 'Ошибка',
        groupHistory: 'Недавние',
        historyEmpty: 'Пока пусто. Здесь появятся последние уведомления.',
        clear: 'Очистить',
        previewSession: 'Пример задачи',
        previewErrorText: 'Не удалось выполнить запрос к модели.',
      },
      en: {
        doneTitle: 'Task finished',
        attentionTitle: 'Your action is needed',
        errorTitle: 'Something went wrong',
        doneBody: 'The agent finished working.',
        doneIn: 'in {duration}',
        approvalBody: 'Confirm the “{tool}” tool call.',
        approvalBodyPlain: 'The agent is waiting for a confirmation.',
        questionBody: 'The agent is waiting for your answer.',
        planBody: 'The agent asks you to review the plan.',
        blockedBody: 'The turn stopped and needs your permission.',
        errorBody: 'The task could not be finished.',
        maxTokensBody: 'The answer was cut off at the length limit.',
        untitledSession: 'Untitled',
        open: 'Open',
        dismiss: 'Dismiss',
        unitSec: 's',
        unitMin: 'm',
        unitHour: 'h',
        sectionTitle: 'Notifications',
        settingsLead: 'Toasts for a finished task, a confirmation request and a failure — each with its own sound.',
        groupShow: 'Notifications',
        notifications: 'Show notifications',
        notificationsHint: 'Toasts in a window corner. Sound is configured separately.',
        variant: 'Toast shape',
        variantHint: 'A compact line, a card with detail, or a wide strip.',
        variantCompact: 'Line',
        variantCard: 'Card',
        variantBanner: 'Strip',
        position: 'Window corner',
        positionHint: 'Where the toast stack appears.',
        positionBottomRight: 'Bottom right',
        positionBottomLeft: 'Bottom left',
        positionTopRight: 'Top right',
        positionTopLeft: 'Top left',
        duration: 'Dwell time',
        durationHint: 'The toast leaves by itself after this time.',
        duration4: '4 s',
        duration6: '6 s',
        duration10: '10 s',
        durationNever: 'Keep',
        onlyUnfocused: 'Only while the window is unfocused',
        onlyUnfocusedHint: 'While you are in the app, nothing is shown and nothing plays.',
        groupSound: 'Sound',
        sound: 'Sound notifications',
        soundHint: 'Soft cues: finished, attention, error.',
        volume: 'Volume',
        volumeHint: 'Relative loudness of the cues.',
        groupSystem: 'System notifications',
        system: 'Show in the system',
        systemHint: 'A Windows notification while the app window is in the background.',
        systemUnsupported: 'This window does not support system notifications.',
        systemGranted: 'Permission granted.',
        systemDenied: 'System notifications are blocked in the browser settings.',
        systemAsk: 'Allow',
        groupPreview: 'Preview',
        previewHint: 'Show a toast and play its sound right now.',
        previewDone: 'Finished',
        previewAttention: 'Attention',
        previewError: 'Error',
        groupHistory: 'Recent',
        historyEmpty: 'Nothing yet. The latest notifications appear here.',
        clear: 'Clear',
        previewSession: 'Example task',
        previewErrorText: 'The model request failed.',
      },
    }

    /**
     * The stylesheet follows the host: surfaces and text come from theme tokens,
     * accent colors from the semantic state tokens, geometry is plain CSS.
     */
    const CSS = `
.dsh-ntf-layer{position:fixed;inset:0;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;padding:22px;pointer-events:none;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;--dsh-ntf-shift:10px}
.dsh-ntf-pos-bottom-right{align-items:flex-end;justify-content:flex-end}
.dsh-ntf-pos-bottom-left{align-items:flex-start;justify-content:flex-end}
.dsh-ntf-pos-top-right{align-items:flex-end;justify-content:flex-start}
.dsh-ntf-pos-top-left{align-items:flex-start;justify-content:flex-start}
.dsh-ntf-pos-top-right,.dsh-ntf-pos-top-left{--dsh-ntf-shift:-10px}
.dsh-ntf-kind-done{--dsh-ntf-accent:var(--dsw-alias-state-success-primary)}
.dsh-ntf-kind-attention{--dsh-ntf-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ntf-kind-error{--dsh-ntf-accent:var(--dsw-alias-state-error-primary)}
.dsh-ntf-card{position:relative;box-sizing:border-box;width:min(392px,calc(100vw - 32px));overflow:hidden;pointer-events:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:inset 3px 0 0 var(--dsh-ntf-accent),0 14px 34px -18px color-mix(in srgb, var(--dsw-alias-label-primary) 38%, transparent);animation:dsh-ntf-enter .18s ease-out both}
.dsh-ntf-card[data-variant="banner"]{width:min(462px,calc(100vw - 32px))}
.dsh-ntf-card.is-leaving{animation:dsh-ntf-leave .18s ease-in both}
.dsh-ntf-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;color:var(--dsh-ntf-accent)}
.dsh-ntf-title{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary)}
.dsh-ntf-count{padding:0 5px;border-radius:999px;background:color-mix(in srgb, var(--dsh-ntf-accent) 22%, transparent);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600;line-height:16px}
.dsh-ntf-meta{overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap;text-overflow:ellipsis}
.dsh-ntf-body{margin:8px 0 0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;overflow-wrap:anywhere}
.dsh-ntf-compact{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 14px}
.dsh-ntf-compact-body{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
.dsh-ntf-inline{overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap;text-overflow:ellipsis}
.dsh-ntf-card--rich{padding:14px 14px 12px 16px}
.dsh-ntf-head{display:flex;align-items:flex-start;gap:10px}
.dsh-ntf-heading{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
.dsh-ntf-foot{display:flex;align-items:center;gap:10px;margin-top:10px}
.dsh-ntf-time{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-ntf-banner{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px}
.dsh-ntf-banner-text{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
.dsh-ntf-banner-body{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px;overflow-wrap:anywhere}
.dsh-ntf-close{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer}
.dsh-ntf-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-ntf-action{appearance:none;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-ntf-action:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-ntf-progress{position:absolute;right:0;bottom:0;left:0;height:2px;opacity:.5;background:var(--dsh-ntf-accent);transform-origin:left;animation-name:dsh-ntf-progress;animation-timing-function:linear;animation-fill-mode:forwards}
.dsh-ntf-close:focus-visible,.dsh-ntf-action:focus-visible,.dsh-ntf-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
@keyframes dsh-ntf-enter{from{opacity:0;transform:translateY(var(--dsh-ntf-shift)) scale(.985)}to{opacity:1;transform:none}}
@keyframes dsh-ntf-leave{to{opacity:0;transform:translateY(-4px) scale(.99)}}
@keyframes dsh-ntf-progress{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.dsh-ntf-settings{display:flex;flex-direction:column;box-sizing:border-box;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dsh-ntf-settings-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.dsh-ntf-settings-inner{box-sizing:border-box;max-width:720px;padding:4px 24px 40px;margin:0 auto}
.dsh-ntf-lead{margin:0 0 20px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-ntf-group{margin-bottom:18px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dsh-ntf-group-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px 0}
.dsh-ntf-group-title{margin:0;padding:12px 16px 0;font-size:13px;font-weight:600;line-height:20px}
.dsh-ntf-group-head .dsh-ntf-group-title{padding:0}
.dsh-ntf-group-body{padding:6px 0}
.dsh-ntf-row{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:9px 16px}
.dsh-ntf-row + .dsh-ntf-row{border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-ntf-row-text{flex:1;min-width:0}
.dsh-ntf-row-title{font-size:13px;line-height:20px}
.dsh-ntf-row-desc{margin-top:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dsh-ntf-row-control{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:10px}
.dsh-ntf-switch{position:relative;box-sizing:border-box;width:38px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .15s ease,border-color .15s ease}
.dsh-ntf-switch.is-on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary)}
.dsh-ntf-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-ntf-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-overlay);transition:transform .15s ease}
.dsh-ntf-switch.is-on .dsh-ntf-knob{transform:translateX(16px)}
.dsh-ntf-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.dsh-ntf-seg-btn{appearance:none;height:26px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.dsh-ntf-seg-btn:hover{color:var(--dsw-alias-label-primary)}
.dsh-ntf-seg-btn.is-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.dsh-ntf-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ntf-range{width:132px;accent-color:var(--dsw-alias-brand-primary)}
.dsh-ntf-value{width:40px;color:var(--dsw-alias-label-secondary);font-size:12px;text-align:right;font-variant-numeric:tabular-nums}
.dsh-ntf-previews{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px 16px}
.dsh-ntf-preview{display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dsh-ntf-preview:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-ntf-preview:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-ntf-preview-dot{width:8px;height:8px;border-radius:50%;background:var(--dsh-ntf-accent)}
.dsh-ntf-note{margin:0;padding:0 16px 14px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}
.dsh-ntf-history{list-style:none;margin:0;padding:4px 8px 8px}
.dsh-ntf-history-row{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.dsh-ntf-history-row:disabled{cursor:default}
.dsh-ntf-history-row:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-ntf-history-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsh-ntf-accent)}
.dsh-ntf-history-text{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dsh-ntf-history-time{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-ntf-empty{margin:0;padding:10px 16px 16px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-ntf-link{appearance:none;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-ntf-link:hover{color:var(--dsw-alias-label-primary)}
@media (prefers-reduced-motion: reduce){.dsh-ntf-card{animation:none}.dsh-ntf-progress{animation:none}}
`

    /** Bound by `apply`; every visible string goes through it. */
    let boundTranslate

    function lookup(key) {
      if (boundTranslate !== undefined) {
        try {
          const value = boundTranslate(key)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        } catch {
          // Fall through to the literal dictionaries.
        }
      }
      return DICT.en[key] ?? DICT.ru[key] ?? key
    }

    /** Translate one key, optionally filling `{name}` placeholders. */
    function t(key, params) {
      const text = lookup(key)
      if (params === undefined) return text
      return text.replace(/\{(\w+)\}/gu, (match, name) => (params[name] === undefined ? match : String(params[name])))
    }

    /** A minimal observable value React can subscribe to. */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        get: () => value,
        set(next) {
          value = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch {
              // One broken subscriber must not stop the others.
            }
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    /** Subscribe one component to a store without external state libraries. */
    function useStore(store) {
      const [value, setValue] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setValue(store.get())), [store])
      return value
    }

    /** Clamp a stored choice to the values this version understands. */
    function pick(value, allowed, fallback) {
      return allowed.includes(value) ? value : fallback
    }

    function readSettings() {
      const next = { ...DEFAULTS }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return next
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return next
        if (typeof parsed.notifications === 'boolean') next.notifications = parsed.notifications
        if (typeof parsed.sound === 'boolean') next.sound = parsed.sound
        if (typeof parsed.onlyUnfocused === 'boolean') next.onlyUnfocused = parsed.onlyUnfocused
        if (typeof parsed.system === 'boolean') next.system = parsed.system
        if (typeof parsed.variant === 'string') next.variant = pick(parsed.variant, VARIANTS, DEFAULTS.variant)
        if (typeof parsed.position === 'string') next.position = pick(parsed.position, POSITIONS, DEFAULTS.position)
        if (typeof parsed.duration === 'number') next.duration = pick(parsed.duration, DURATIONS, DEFAULTS.duration)
        if (typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)) {
          next.volume = Math.max(0, Math.min(100, Math.round(parsed.volume)))
        }
      } catch {
        return { ...DEFAULTS }
      }
      return next
    }

    function readHistory() {
      try {
        const raw = window.localStorage.getItem(HISTORY_KEY)
        if (raw === null) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter(entry => entry !== null && typeof entry === 'object').slice(0, HISTORY_LIMIT) : []
      } catch {
        return []
      }
    }

    /** Synthesized cues: no audio assets, no network, and silence instead of errors. */
    function createAudio() {
      let context
      let broken = false

      function ensure() {
        if (broken) return null
        try {
          if (context === undefined) {
            const Ctor = window.AudioContext ?? window.webkitAudioContext
            if (typeof Ctor !== 'function') {
              broken = true
              return null
            }
            context = new Ctor()
          }
          if (context.state === 'suspended') void context.resume().catch(() => {})
          return context
        } catch {
          broken = true
          return null
        }
      }

      function tone(spec, volume) {
        const audio = ensure()
        if (audio === null || audio.state !== 'running') return
        try {
          const start = audio.currentTime + spec.delay
          const oscillator = audio.createOscillator()
          const gain = audio.createGain()
          oscillator.type = spec.type
          oscillator.frequency.setValueAtTime(spec.freq, start)
          if (spec.glide !== undefined) oscillator.frequency.exponentialRampToValueAtTime(spec.glide, start + spec.duration)
          const peak = Math.max(0.0002, spec.peak * volume)
          gain.gain.setValueAtTime(0.0001, start)
          gain.gain.exponentialRampToValueAtTime(peak, start + 0.014)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration)
          oscillator.connect(gain)
          gain.connect(audio.destination)
          oscillator.start(start)
          oscillator.stop(start + spec.duration + 0.04)
        } catch {
          // A refused or interrupted audio graph is not worth a visible error.
        }
      }

      const SOUNDS = {
        done: [
          { freq: 523.25, delay: 0, duration: 0.38, type: 'sine', peak: 0.1 },
          { freq: 659.25, delay: 0.085, duration: 0.38, type: 'sine', peak: 0.09 },
          { freq: 783.99, delay: 0.17, duration: 0.55, type: 'sine', peak: 0.085 },
        ],
        attention: [
          { freq: 880, delay: 0, duration: 0.45, type: 'sine', peak: 0.075 },
          { freq: 1318.51, delay: 0.005, duration: 0.34, type: 'sine', peak: 0.032 },
          { freq: 880, delay: 0.26, duration: 0.5, type: 'sine', peak: 0.052 },
          { freq: 1318.51, delay: 0.265, duration: 0.38, type: 'sine', peak: 0.022 },
        ],
        error: [
          { freq: 392, delay: 0, duration: 0.26, type: 'triangle', peak: 0.09 },
          { freq: 311.13, delay: 0.17, duration: 0.55, type: 'triangle', peak: 0.085, glide: 261.63 },
        ],
      }

      function play(kind, volume) {
        const audio = ensure()
        if (audio === null) return
        const specs = SOUNDS[kind] ?? SOUNDS.done
        const run = () => {
          for (const spec of specs) tone(spec, volume)
        }
        if (audio.state === 'suspended') {
          void audio.resume().then(() => {
            if (audio.state === 'running') run()
          }).catch(() => {})
          return
        }
        run()
      }

      function dispose() {
        if (context !== undefined) {
          try {
            void context.close().catch(() => {})
          } catch {
            // Already closed.
          }
        }
        context = undefined
      }

      return { play, ensure, dispose }
    }

    /** One line for a duration in the active language. */
    function formatDuration(ms) {
      const total = Math.round(ms / 1000)
      if (!(total > 0)) return ''
      const seconds = total % 60
      const minutes = Math.floor(total / 60) % 60
      const hours = Math.floor(total / 3600)
      if (hours > 0) return `${hours} ${t('unitHour')} ${minutes} ${t('unitMin')}`
      if (minutes > 0) return seconds > 0 ? `${minutes} ${t('unitMin')} ${seconds} ${t('unitSec')}` : `${minutes} ${t('unitMin')}`
      return `${Math.max(1, seconds)} ${t('unitSec')}`
    }

    function formatClock(at) {
      try {
        return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    /** The localized title, meta line and body for one record. */
    function describe(record) {
      const session = record.sessionTitle !== '' ? record.sessionTitle : t('untitledSession')
      if (record.kind === 'done') {
        const duration = formatDuration(record.durationMs)
        return {
          title: t('doneTitle'),
          meta: duration === '' ? session : `${session} · ${t('doneIn', { duration })}`,
          body: t('doneBody'),
        }
      }
      if (record.kind === 'attention') {
        let body = t('questionBody')
        if (record.reason === 'approval') {
          body = record.tool !== '' ? t('approvalBody', { tool: record.tool }) : t('approvalBodyPlain')
        } else if (record.reason === 'plan') {
          body = t('planBody')
        } else if (record.reason === 'blocked') {
          body = t('blockedBody')
        } else if (record.question !== '') {
          body = record.question
        }
        return { title: t('attentionTitle'), meta: session, body }
      }
      let body = t('errorBody')
      if (record.reason === 'max-tokens') body = t('maxTokensBody')
      else if (record.message !== '') body = record.message
      return { title: t('errorTitle'), meta: session, body }
    }

    function Icon(props) {
      const size = Number(props.size) || 18
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 20 20',
        fill: 'none',
        'aria-hidden': true,
        focusable: false,
      }
      if (props.kind === 'done') {
        return h('svg', common,
          h('circle', { cx: 10, cy: 10, r: 8, stroke: 'currentColor', strokeWidth: 1.5 }),
          h('path', {
            d: 'M6.4 10.2l2.5 2.5 4.8-5.1',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }))
      }
      if (props.kind === 'error') {
        return h('svg', common,
          h('circle', { cx: 10, cy: 10, r: 8, stroke: 'currentColor', strokeWidth: 1.5 }),
          h('path', { d: 'M10 5.9v4.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
          h('circle', { cx: 10, cy: 14.1, r: 0.9, fill: 'currentColor' }))
      }
      return h('svg', common,
        h('path', {
          d: 'M10 3.1a4.15 4.15 0 0 0-4.15 4.15c0 3.15-.9 4.15-1.55 4.85h11.4c-.65-.7-1.55-1.7-1.55-4.85A4.15 4.15 0 0 0 10 3.1Z',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M8.35 14.2a1.75 1.75 0 0 0 3.3 0',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }))
    }

    /** One toast in the shape the settings chose. */
    function ToastCard(props) {
      const item = props.item
      const info = describe(item)
      const shape = props.variant === 'compact'
        ? ' dsh-ntf-compact'
        : props.variant === 'banner'
          ? ' dsh-ntf-banner'
          : ' dsh-ntf-card--rich'
      const className = `dsh-ntf-card${shape} dsh-ntf-kind-${item.kind}${item.leaving ? ' is-leaving' : ''}`
      const openable = item.sessionId !== ''
      const onOpen = event => {
        if (event !== undefined) event.stopPropagation()
        props.onOpen(item)
      }
      const keyboard = openable
        ? {
            tabIndex: 0,
            onKeyDown: event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(event)
              }
            },
          }
        : {}
      const body = h('div', { className: 'dsh-ntf-banner-text' },
        h('div', { className: 'dsh-ntf-title' },
          info.title,
          item.count > 1 ? h('span', { className: 'dsh-ntf-count' }, `×${item.count}`) : null),
        h('div', { className: props.variant === 'card' ? 'dsh-ntf-meta' : 'dsh-ntf-banner-body' }, info.body))
      const close = h('button', {
        type: 'button',
        className: 'dsh-ntf-close',
        'aria-label': t('dismiss'),
        title: t('dismiss'),
        onClick: event => {
          event.stopPropagation()
          props.onClose(item.uid)
        },
      }, h('span', { 'aria-hidden': true }, '×'))
      const progress = item.duration > 0 && !item.leaving
        ? h('span', { className: 'dsh-ntf-progress', style: { animationDuration: `${item.duration}ms` } })
        : null

      if (props.variant === 'compact') {
        return h('div', {
          className,
          'data-variant': props.variant,
          role: item.kind === 'error' ? 'alert' : 'status',
          onClick: openable ? onOpen : undefined,
          style: openable ? { cursor: 'pointer' } : undefined,
          ...keyboard,
        },
        h('span', { className: 'dsh-ntf-icon' }, h(Icon, { kind: item.kind, size: 16 })),
        h('div', { className: 'dsh-ntf-compact-body' },
          h('div', { className: 'dsh-ntf-title' },
            info.title,
            item.count > 1 ? h('span', { className: 'dsh-ntf-count' }, `×${item.count}`) : null),
          h('div', { className: 'dsh-ntf-inline' }, info.body)),
        close,
        progress)
      }

      if (props.variant === 'banner') {
        return h('div', {
          className,
          'data-variant': props.variant,
          role: item.kind === 'error' ? 'alert' : 'status',
          onClick: openable ? onOpen : undefined,
          style: openable ? { cursor: 'pointer' } : undefined,
          ...keyboard,
        },
        h('span', { className: 'dsh-ntf-icon' }, h(Icon, { kind: item.kind })),
        h('div', { className: 'dsh-ntf-banner-text' },
          h('div', { className: 'dsh-ntf-title' },
            info.title,
            item.count > 1 ? h('span', { className: 'dsh-ntf-count' }, `×${item.count}`) : null),
          h('div', { className: 'dsh-ntf-banner-body' }, info.body)),
        openable
          ? h('button', { type: 'button', className: 'dsh-ntf-action', onClick: onOpen }, t('open'))
          : null,
        close,
        progress)
      }

      return h('div', {
        className,
        'data-variant': props.variant,
        role: item.kind === 'error' ? 'alert' : 'status',
        onClick: openable ? onOpen : undefined,
        ...keyboard,
      },
      h('div', { className: 'dsh-ntf-head' },
        h('span', { className: 'dsh-ntf-icon' }, h(Icon, { kind: item.kind })),
        h('div', { className: 'dsh-ntf-heading' },
          h('div', { className: 'dsh-ntf-title' },
            info.title,
            item.count > 1 ? h('span', { className: 'dsh-ntf-count' }, `×${item.count}`) : null),
          h('div', { className: 'dsh-ntf-meta' }, info.meta)),
        close),
      h('p', { className: 'dsh-ntf-body' }, info.body),
      h('div', { className: 'dsh-ntf-foot' },
        openable ? h('button', { type: 'button', className: 'dsh-ntf-action', onClick: onOpen }, t('open')) : null,
        h('span', { className: 'dsh-ntf-time' }, formatClock(item.at))),
      progress)
    }

    /** The frame-wide stack; the overlay layer stays click-through around each card. */
    function ToastLayer(props) {
      const controller = props.controller
      useStore(controller.localeTick)
      const settings = useStore(controller.settings)
      const items = useStore(controller.toasts)
      const variant = pick(settings.variant, VARIANTS, DEFAULTS.variant)
      const position = pick(settings.position, POSITIONS, DEFAULTS.position)
      return h('div', {
        className: `dsh-ntf-layer dsh-ntf-pos-${position}`,
        'aria-live': 'polite',
        'aria-atomic': 'false',
      },
      h('style', null, CSS),
      items.map(item => h(ToastCard, {
        key: item.uid,
        item,
        variant,
        onClose: controller.dismiss,
        onOpen: controller.openFromToast,
      })))
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: `dsh-ntf-switch${props.checked ? ' is-on' : ''}`,
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled: props.disabled === true,
        onClick: () => props.onChange(!props.checked),
      }, h('span', { className: 'dsh-ntf-knob' }))
    }

    function Segmented(props) {
      return h('div', { className: 'dsh-ntf-seg', role: 'group', 'aria-label': props.label },
        props.options.map(option => h('button', {
          key: option.value,
          type: 'button',
          className: `dsh-ntf-seg-btn${option.value === props.value ? ' is-on' : ''}`,
          'aria-pressed': option.value === props.value,
          onClick: () => props.onChange(option.value),
        }, option.label)))
    }

    function Row(props) {
      return h('div', { className: 'dsh-ntf-row' },
        h('div', { className: 'dsh-ntf-row-text' },
          h('div', { className: 'dsh-ntf-row-title' }, props.title),
          props.description === undefined ? null : h('div', { className: 'dsh-ntf-row-desc' }, props.description)),
        h('div', { className: 'dsh-ntf-row-control' }, props.children))
    }

    function SettingsPage(props) {
      const controller = props.controller
      useStore(controller.localeTick)
      const settings = useStore(controller.settings)
      const history = useStore(controller.history)
      const permission = useStore(controller.permission)
      const variant = pick(settings.variant, VARIANTS, DEFAULTS.variant)
      const position = pick(settings.position, POSITIONS, DEFAULTS.position)
      const duration = pick(settings.duration, DURATIONS, DEFAULTS.duration)
      const systemSupported = typeof Notification === 'function'
      const systemHint = !systemSupported
        ? t('systemUnsupported')
        : permission === 'granted'
          ? t('systemGranted')
          : permission === 'denied'
            ? t('systemDenied')
            : null

      return h('section', { className: 'dsh-ntf-settings' },
        h('style', null, CSS),
        h('div', { className: 'dsh-ntf-settings-scroll' },
          h('div', { className: 'dsh-ntf-settings-inner' },
            h('p', { className: 'dsh-ntf-lead' }, t('settingsLead')),
            h('section', { className: 'dsh-ntf-group' },
              h('h2', { className: 'dsh-ntf-group-title' }, t('groupShow')),
              h('div', { className: 'dsh-ntf-group-body' },
                h(Row, {
                  title: t('notifications'),
                  description: t('notificationsHint'),
                }, h(Switch, {
                  checked: settings.notifications,
                  label: t('notifications'),
                  onChange: value => controller.update({ notifications: value }),
                })),
                h(Row, { title: t('variant'), description: t('variantHint') },
                  h(Segmented, {
                    label: t('variant'),
                    value: variant,
                    onChange: value => controller.update({ variant: value }),
                    options: [
                      { value: 'compact', label: t('variantCompact') },
                      { value: 'card', label: t('variantCard') },
                      { value: 'banner', label: t('variantBanner') },
                    ],
                  })),
                h(Row, { title: t('position'), description: t('positionHint') },
                  h(Segmented, {
                    label: t('position'),
                    value: position,
                    onChange: value => controller.update({ position: value }),
                    options: [
                      { value: 'bottom-right', label: t('positionBottomRight') },
                      { value: 'bottom-left', label: t('positionBottomLeft') },
                      { value: 'top-right', label: t('positionTopRight') },
                      { value: 'top-left', label: t('positionTopLeft') },
                    ],
                  })),
                h(Row, { title: t('duration'), description: t('durationHint') },
                  h(Segmented, {
                    label: t('duration'),
                    value: duration,
                    onChange: value => controller.update({ duration: value }),
                    options: [
                      { value: 4000, label: t('duration4') },
                      { value: 6000, label: t('duration6') },
                      { value: 10000, label: t('duration10') },
                      { value: 0, label: t('durationNever') },
                    ],
                  })),
                h(Row, { title: t('onlyUnfocused'), description: t('onlyUnfocusedHint') },
                  h(Switch, {
                    checked: settings.onlyUnfocused,
                    label: t('onlyUnfocused'),
                    onChange: value => controller.update({ onlyUnfocused: value }),
                  })))),
            h('section', { className: 'dsh-ntf-group' },
              h('h2', { className: 'dsh-ntf-group-title' }, t('groupSound')),
              h('div', { className: 'dsh-ntf-group-body' },
                h(Row, { title: t('sound'), description: t('soundHint') },
                  h(Switch, {
                    checked: settings.sound,
                    label: t('sound'),
                    onChange: value => controller.update({ sound: value }),
                  })),
                h(Row, { title: t('volume'), description: t('volumeHint') },
                  h('input', {
                    className: 'dsh-ntf-range',
                    type: 'range',
                    min: 0,
                    max: 100,
                    step: 5,
                    value: settings.volume,
                    'aria-label': t('volume'),
                    onChange: event => controller.update({ volume: Number(event.target.value) || 0 }),
                  }),
                  h('span', { className: 'dsh-ntf-value' }, `${settings.volume}%`)))),
            h('section', { className: 'dsh-ntf-group' },
              h('h2', { className: 'dsh-ntf-group-title' }, t('groupSystem')),
              h('div', { className: 'dsh-ntf-group-body' },
                h(Row, { title: t('system'), description: t('systemHint') },
                  h(Switch, {
                    checked: settings.system === true,
                    disabled: !systemSupported || permission === 'denied',
                    label: t('system'),
                    onChange: value => {
                      controller.update({ system: value })
                      if (value && permission === 'default') controller.requestPermission()
                    },
                  })),
                systemHint === null
                  ? null
                  : h('p', { className: 'dsh-ntf-note' }, systemHint),
                systemSupported && permission === 'default'
                  ? h('p', { className: 'dsh-ntf-note' },
                      h('button', { type: 'button', className: 'dsh-ntf-link', onClick: () => controller.requestPermission() }, t('systemAsk')))
                  : null)),
            h('section', { className: 'dsh-ntf-group' },
              h('h2', { className: 'dsh-ntf-group-title' }, t('groupPreview')),
              h('p', { className: 'dsh-ntf-note' }, t('previewHint')),
              h('div', { className: 'dsh-ntf-previews' },
                h('button', {
                  type: 'button',
                  className: 'dsh-ntf-preview dsh-ntf-kind-done',
                  onClick: () => controller.preview('done'),
                }, h('span', { className: 'dsh-ntf-preview-dot' }), t('previewDone')),
                h('button', {
                  type: 'button',
                  className: 'dsh-ntf-preview dsh-ntf-kind-attention',
                  onClick: () => controller.preview('attention'),
                }, h('span', { className: 'dsh-ntf-preview-dot' }), t('previewAttention')),
                h('button', {
                  type: 'button',
                  className: 'dsh-ntf-preview dsh-ntf-kind-error',
                  onClick: () => controller.preview('error'),
                }, h('span', { className: 'dsh-ntf-preview-dot' }), t('previewError')))),
            h('section', { className: 'dsh-ntf-group' },
              h('div', { className: 'dsh-ntf-group-head' },
                h('h2', { className: 'dsh-ntf-group-title' }, t('groupHistory')),
                history.length === 0
                  ? null
                  : h('button', { type: 'button', className: 'dsh-ntf-link', onClick: () => controller.clearHistory() }, t('clear'))),
              history.length === 0
                ? h('p', { className: 'dsh-ntf-empty' }, t('historyEmpty'))
                : h('ul', { className: 'dsh-ntf-history' },
                    history.map(entry => {
                      const info = describe(entry)
                      const openable = typeof entry.sessionId === 'string' && entry.sessionId !== ''
                      return h('li', { key: entry.uid ?? `${entry.at}-${entry.kind}` },
                        h('button', {
                          type: 'button',
                          className: `dsh-ntf-history-row dsh-ntf-kind-${entry.kind}`,
                          disabled: !openable,
                          onClick: openable ? () => controller.openFromToast(entry) : undefined,
                        },
                        h('span', { className: 'dsh-ntf-history-dot' }),
                        h('span', { className: 'dsh-ntf-history-text' }, `${info.title} — ${info.body}`),
                        h('span', { className: 'dsh-ntf-history-time' }, formatClock(entry.at))))
                    }))))))
    }

    /** Everything the two surfaces share: settings, toast stack, feed and sound. */
    function createController(ctx) {
      const settings = createStore(readSettings())
      const toasts = createStore([])
      const history = createStore(readHistory())
      const localeTickStore = createStore(0)
      const permissionStore = createStore(
        typeof Notification === 'function' ? Notification.permission : 'unsupported',
      )
      const timers = new Map()
      /** Pending-interaction keys already shown by this page. */
      const reminded = new Set()
      const audio = createAudio()
      const feedControl = new AbortController()
      let uid = 0
      let disposed = false

      function persistSettings() {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.get()))
        } catch {
          // A full or denied storage must not break the toggles.
        }
      }

      function update(patch) {
        settings.set({ ...settings.get(), ...patch })
        persistSettings()
      }

      function persistHistory(entries) {
        try {
          window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
        } catch {
          // History is a convenience.
        }
      }

      function setTimer(key, fn, ms) {
        clearTimer(key)
        const timer = setTimeout(() => {
          timers.delete(key)
          fn()
        }, ms)
        timers.set(key, timer)
      }

      function clearTimer(key) {
        const timer = timers.get(key)
        if (timer !== undefined) {
          clearTimeout(timer)
          timers.delete(key)
        }
      }

      function clearAllTimers() {
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
      }

      function dismiss(id) {
        const current = toasts.get()
        const target = current.find(item => item.uid === id)
        if (target === undefined || target.leaving) return
        clearTimer(`auto:${id}`)
        toasts.set(current.map(item => (item.uid === id ? { ...item, leaving: true } : item)))
        setTimer(`leave:${id}`, () => {
          toasts.set(toasts.get().filter(item => item.uid !== id))
        }, 200)
      }

      function openSession(sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return
        const workspace = ctx.get('uiWorkspace')
        if (workspace === undefined || typeof workspace.openSession !== 'function') return
        try {
          workspace.openSession(sessionId)
        } catch {
          // A closed panel or an archived Session simply does not open.
        }
      }

      function openFromToast(item) {
        if (item === null || typeof item !== 'object') return
        openSession(item.sessionId)
        dismiss(item.uid)
      }

      function remember(record) {
        const entry = {
          uid: record.uid,
          kind: record.kind,
          sessionId: record.sessionId,
          sessionTitle: record.sessionTitle,
          reason: record.reason,
          tool: record.tool,
          question: record.question,
          message: record.message,
          durationMs: record.durationMs,
          at: record.at,
        }
        const next = [entry, ...history.get()].slice(0, HISTORY_LIMIT)
        history.set(next)
        persistHistory(next)
      }

      function pushToast(record, config) {
        const existing = toasts.get().find(item =>
          item.kind === record.kind
          && item.sessionId === record.sessionId
          && item.leaving !== true
          && Date.now() - item.createdAt < 8000)
        if (existing !== undefined) {
          clearTimer(`auto:${existing.uid}`)
          toasts.set(toasts.get().map(item => (item.uid === existing.uid
            ? {
                ...item,
                count: item.count + 1,
                at: record.at,
                durationMs: (item.durationMs || 0) + (record.durationMs || 0),
                message: record.message !== '' ? record.message : item.message,
                question: record.question !== '' ? record.question : item.question,
                tool: record.tool !== '' ? record.tool : item.tool,
                createdAt: Date.now(),
              }
            : item)))
          const refreshed = toasts.get().find(item => item.uid === existing.uid)
          if (refreshed !== undefined) schedule(refreshed, config)
          return
        }
        const toast = {
          ...record,
          uid: record.uid,
          createdAt: Date.now(),
          duration: record.sticky === true ? 0 : config.duration,
          leaving: false,
          count: 1,
        }
        const current = toasts.get()
        const next = [...current, toast].slice(-MAX_VISIBLE)
        for (const dropped of current) {
          if (!next.some(item => item.uid === dropped.uid)) {
            clearTimer(`auto:${dropped.uid}`)
            clearTimer(`leave:${dropped.uid}`)
          }
        }
        toasts.set(next)
        schedule(toast, config)
      }

      function schedule(toast, config) {
        if (!(toast.duration > 0)) return
        setTimer(`auto:${toast.uid}`, () => dismiss(toast.uid), toast.duration)
      }

      function systemNotify(record) {
        if (typeof Notification !== 'function' || Notification.permission !== 'granted') return
        const focused = typeof document !== 'undefined' && document.hasFocus()
        if (focused) return
        try {
          const info = describe(record)
          const notice = new Notification(info.title, {
            body: `${info.body}${record.sessionTitle === '' ? '' : ` — ${record.sessionTitle}`}`,
            silent: true,
            tag: `dsh-notify:${record.sessionId}:${record.kind}`,
          })
          notice.onclick = () => {
            try {
              window.focus()
            } catch {
              // Focus is a hint.
            }
            openSession(record.sessionId)
            notice.close()
          }
        } catch {
          // A refused system notification is not an error worth showing.
        }
      }

      function ingest(item, options = {}) {
        if (disposed || item === null || typeof item !== 'object') return
        const key = typeof item.key === 'string' ? item.key : ''
        if (key !== '') {
          if (reminded.has(key)) return
          reminded.add(key)
        }
        const force = options.force === true
        const kind = item.kind === 'done' || item.kind === 'attention' || item.kind === 'error' ? item.kind : 'done'
        uid += 1
        const record = {
          uid,
          kind,
          sessionId: typeof item.sessionId === 'string' ? item.sessionId : '',
          sessionTitle: typeof item.sessionTitle === 'string' ? item.sessionTitle : '',
          reason: typeof item.reason === 'string' ? item.reason : '',
          tool: typeof item.tool === 'string' ? item.tool : '',
          question: typeof item.question === 'string' ? item.question : '',
          message: typeof item.message === 'string' ? item.message : '',
          durationMs: Number.isFinite(item.durationMs) ? item.durationMs : 0,
          at: Number.isFinite(item.at) ? item.at : Date.now(),
          sticky: item.sticky === true || item.reminder === true,
        }
        remember(record)
        const config = settings.get()
        const focused = typeof document !== 'undefined' && document.hasFocus()
        const quiet = config.onlyUnfocused === true && focused && !force
        if (quiet) return
        if (config.sound === true) audio.play(kind, config.volume / 100)
        if (force || config.notifications === true) {
          // A finished or failed turn means the waiting action is over: retire its
          // sticky reminder instead of leaving it on screen.
          if (kind !== 'attention' && record.sessionId !== '') {
            for (const item of toasts.get()) {
              if (item.sticky === true && item.leaving !== true && item.sessionId === record.sessionId) {
                dismiss(item.uid)
              }
            }
          }
          pushToast(record, config)
        }
        if (config.system === true && !focused) systemNotify(record)
      }

      /** Interactions the Host reports as still waiting; `ingest` owns the once-per-key rule. */
      function ingestPending(item) {
        if (item === null || typeof item !== 'object') return
        ingest(item)
      }

      function preview(kind) {
        const at = Date.now()
        if (kind === 'done') {
          ingest({ kind: 'done', sessionTitle: t('previewSession'), durationMs: 124000, at }, { force: true })
          return
        }
        if (kind === 'attention') {
          ingest({ kind: 'attention', sessionTitle: t('previewSession'), reason: 'approval', tool: 'bash', at }, { force: true })
          return
        }
        ingest({ kind: 'error', sessionTitle: t('previewSession'), reason: 'turn-error', message: t('previewErrorText'), at }, { force: true })
      }

      function clearHistory() {
        history.set([])
        persistHistory([])
      }

      function requestPermission() {
        if (typeof Notification !== 'function') return
        try {
          void Notification.requestPermission().then(result => {
            permissionStore.set(result)
            if (result !== 'granted') update({ system: false })
          }).catch(() => {})
        } catch {
          // Older implementations only accept a callback; nothing to do.
        }
      }

      function sleep(ms) {
        return new Promise(resolve => {
          let timer
          const done = () => {
            if (timer !== undefined) clearTimeout(timer)
            feedControl.signal.removeEventListener('abort', done)
            resolve()
          }
          timer = setTimeout(done, ms)
          if (feedControl.signal.aborted) {
            done()
            return
          }
          feedControl.signal.addEventListener('abort', done, { once: true })
        })
      }

      async function runFeed() {
        let cursor = null
        let epoch
        let failures = 0
        while (!disposed) {
          try {
            const url = cursor === null ? FEED_PATH : `${FEED_PATH}?cursor=${cursor}&hold=1`
            const response = await fetch(url, {
              credentials: 'same-origin',
              cache: 'no-store',
              signal: feedControl.signal,
            })
            if (disposed) return
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (disposed) return
            if (payload === null || typeof payload !== 'object') throw new Error('unexpected payload')
            // Another Host generation owns a fresh, short sequence: start over from
            // its baseline so the interactions it still waits on are delivered.
            const payloadEpoch = typeof payload.epoch === 'string' ? payload.epoch : undefined
            if (payloadEpoch !== undefined) {
              if (epoch !== undefined && epoch !== payloadEpoch) {
                epoch = payloadEpoch
                cursor = null
                continue
              }
              epoch = payloadEpoch
            }
            if (typeof payload.cursor === 'number' && Number.isFinite(payload.cursor)) cursor = payload.cursor
            // A restarted Host resets the sequence; re-open with a baseline so the
            // still-waiting interactions it reports are delivered again.
            if (payload.reset === true) cursor = null
            if (Array.isArray(payload.items)) {
              for (const item of payload.items) ingest(item)
            }
            if (Array.isArray(payload.pending)) {
              for (const item of payload.pending) ingestPending(item)
            }
            failures = 0
          } catch {
            if (disposed || feedControl.signal.aborted) return
            failures += 1
            await sleep(Math.min(15000, 800 * 2 ** Math.min(failures, 4)))
          }
        }
      }

      function dispose() {
        if (disposed) return
        disposed = true
        clearAllTimers()
        feedControl.abort()
        audio.dispose()
      }

      return {
        settings,
        toasts,
        history,
        localeTick: localeTickStore,
        permission: permissionStore,
        update,
        dismiss,
        openFromToast,
        preview,
        clearHistory,
        requestPermission,
        ingest,
        start: () => {
          void runFeed()
        },
        dispose,
        audio,
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        boundTranslate = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, 'ru', DICT.ru), 'notify: ru dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en), 'notify: en dictionary')

        const controller = createController(ctx)
        ctx.effect(() => () => controller.dispose(), 'notify: controller')
        ctx.effect(() => ctx.locale.subscribe(() => {
          const store = controller.localeTick
          store.set(store.get() + 1)
        }), 'notify: locale redraw')

        // Browsers only start an audio context from a gesture; the first click or
        // key press anywhere in the app is enough to make later cues audible.
        ctx.effect(() => {
          const unlock = () => controller.audio.ensure()
          window.addEventListener('pointerdown', unlock, { passive: true })
          window.addEventListener('keydown', unlock)
          return () => {
            window.removeEventListener('pointerdown', unlock)
            window.removeEventListener('keydown', unlock)
          }
        }, 'notify: audio unlock')

        controller.start()

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'notify.toasts',
          order: 40,
        }, function NotifyToastLayer(props) {
          return h(ToastLayer, { ...props, controller })
        }))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'notifications',
          order: 18,
          label: () => t('sectionTitle'),
        }, function NotifySettingsPage(props) {
          return h(SettingsPage, { ...props, controller })
        }))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'notifications',
          order: 18,
        }, function NotifySettingsIcon(props) {
          return h(Icon, { kind: 'attention', size: Number(props.size) || 16 })
        }))
      },
    }
  },
})
