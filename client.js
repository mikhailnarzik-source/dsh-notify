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
    /** Host route for native-card presentation and control. */
    const CONTROL_PATH = '/api/dsh-notify.control'
    const STORAGE_KEY = 'dsh-notify:settings:v1'
    const HISTORY_KEY = 'dsh-notify:history:v1'
    const HISTORY_LIMIT = 10
    const MAX_VISIBLE = 4

    const VARIANTS = ['compact', 'card', 'banner']
    const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left']
    const DURATIONS = [4000, 6000, 10000, 0]
    const THEMES = ['system', 'dark', 'light']
    /** Base text size of a toast in px; every inner size is an em multiple of it. */
    const TEXT_SIZES = [12, 13, 15, 17]
    const FONT_FAMILIES = ['system', 'sans', 'serif', 'mono']
    const FONT_STYLES = ['normal', 'bold', 'italic']
    /** Families the dropdown offers; `system` keeps whatever the app already uses. */
    /** The Windows companion needs one concrete family, not a CSS stack. */
    const NATIVE_FONTS = { system: 'Segoe UI', sans: 'Segoe UI', serif: 'Georgia', mono: 'Consolas' }
    const FONT_STACKS = {
      system: 'inherit',
      sans: '"Segoe UI Variable Text","Segoe UI",Inter,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif',
      serif: 'Georgia,"Times New Roman","PT Serif",serif',
      mono: '"Cascadia Mono","JetBrains Mono",Consolas,"SF Mono",ui-monospace,monospace',
    }

    /** The platform the page runs on; macOS gets a slightly softer card geometry. */
    const OS = (() => {
      try {
        const brand = navigator.userAgentData !== undefined ? navigator.userAgentData.platform : navigator.platform
        const text = String(brand ?? '')
        if (/mac/i.test(text)) return 'mac'
        if (/win/i.test(text)) return 'windows'
        return 'other'
      } catch {
        return 'other'
      }
    })()

    /** Fixed palettes for an explicitly chosen theme; `system` reads the app tokens. */
    const NATIVE_PALETTES = {
      dark: {
        background: '#F21C1D22',
        foreground: '#F2F4F7',
        muted: '#A4AAB3',
        border: '#2E3037',
        done: '#3BD69A',
        attention: '#F0BE58',
        error: '#F07B7B',
      },
      light: {
        background: '#F2FFFFFF',
        foreground: '#16181D',
        muted: '#626873',
        border: '#E4E6EB',
        done: '#1FA974',
        attention: '#C08A18',
        error: '#D14B4B',
      },
    }

    const DEFAULTS = {
      notifications: true,
      sound: true,
      theme: 'system',
      variant: 'card',
      position: 'bottom-right',
      duration: 6000,
      volume: 60,
      gameMode: false,
      system: false,
      textSize: 13,
      fontFamily: 'system',
      fontStyle: 'normal',
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
        open: 'Перейти',
        dismiss: 'Закрыть',
        unitSec: 'с',
        unitMin: 'мин',
        unitHour: 'ч',
        sectionTitle: 'Уведомления',
        settingsLead: 'Плашка появляется, только если вы не в той сессии, где что-то произошло, или окно приложения не в фокусе. Звук звучит всегда — даже когда вы в этой сессии.',
        groupLook: 'Оформление',
        themeLabel: 'Тема плашек',
        themeHint: '«Как в системе» следует светлой или тёмной теме приложения и вашей ОС; можно зафиксировать явно.',
        themeSystem: 'Как в системе',
        themeDark: 'Тёмная',
        themeLight: 'Светлая',
        lookPreview: 'Предпросмотр выбранного стиля',
        textSize: 'Размер текста',
        textSizeHint: 'Базовый размер шрифта плашки; остальные надписи масштабируются вместе с ним.',
        textSizeSmall: 'Мелкий',
        textSizeNormal: 'Обычный',
        textSizeLarge: 'Крупный',
        textSizeHuge: 'Очень крупный',
        fontFamily: 'Шрифт',
        fontFamilyHint: 'Гарнитура текста уведомления.',
        fontSystem: 'Как в приложении',
        fontSans: 'Без засечек',
        fontSerif: 'С засечками',
        fontMono: 'Моноширинный',
        fontStyle: 'Стиль текста',
        fontStyleHint: 'Начертание текста уведомления.',
        styleNormal: 'Обычный',
        styleBold: 'Полужирный',
        styleItalic: 'Курсив',
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
        gameMode: 'Игровой режим',
        gameModeHint: 'Плашки и системные уведомления не показываются, чтобы не перекрывать игру. Звук остаётся.',
        groupSound: 'Звук',
        sound: 'Звуковые уведомления',
        soundHint: 'Мягкие сигналы: завершение, внимание, ошибка.',
        volume: 'Громкость',
        volumeHint: 'Относительная громкость сигналов.',
        groupSystem: 'Системные уведомления',
        system: 'Показывать в системе',
        systemHint: 'Уведомление Windows, когда приложение свёрнуто или не в фокусе. В полноэкранной игре Windows может его скрыть.',
        systemUnsupported: 'Это окно не поддерживает системные уведомления.',
        systemGranted: 'Разрешение выдано.',
        systemDenied: 'Системные уведомления запрещены в настройках браузера.',
        systemAsk: 'Разрешить',
        groupPreview: 'Проверка',
        previewHint: 'Показать плашку и проиграть звук прямо сейчас.',
        previewDone: 'Завершение',
        previewAttention: 'Внимание',
        previewError: 'Ошибка',
        nativeTest: 'Поверх всех окон',
        nativeTestHint: 'Нативная карточка поверх других приложений — её видно, даже когда Harness не в фокусе.',
        nativeShow: 'Показать',
        nativeUnavailable: 'Нативная карточка доступна в приложении Harness на Windows.',
        groupHistory: 'Недавние',
        historyEmpty: 'Пока пусто. Здесь появятся последние уведомления.',
        clear: 'Очистить',
        previewSession: 'Пример задачи',
        previewErrorText: 'Не удалось выполнить запрос к модели.',
        updateTitle: 'Доступно обновление',
        updateBody: 'Вышла версия dsh-notify {version}.',
        updateNow: 'Обновить',
        updateDoneTitle: 'Обновление установлено',
        updateGroup: 'Обновления',
        updateCurrent: 'Установленная версия',
        updateStatus: 'Проверка обновлений',
        updateCheck: 'Проверить обновления',
        updateInstall: 'Установить обновление',
        updateChecking: 'Проверяю GitHub…',
        updateInstalling: 'Скачиваю и устанавливаю…',
        updateUpToDate: 'Обновлений нет.',
        updateAvailable: 'Доступна версия {version}.',
        updateInstalled: 'Версия {version} установлена.',
        updateFailed: 'Не удалось проверить обновления: {reason}.',
        updateInstallFailed: 'Не удалось установить обновление: {reason}.',
        updateNever: 'Проверка ещё не выполнялась.',
        updateCheckedAt: 'Проверено в {time}.',
        updateHint: 'Плагин сам проверяет GitHub при запуске и раз в несколько часов.',
        updateRestart: 'Новая версия заработает после перезапуска DeepSeek Harness.',
        updateNoSource: 'Источник обновлений не настроен.',
        updateControlFailed: 'Harness не ответил.',
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
        settingsLead: 'A toast appears only when you are not in the chat where it happened, or the app window is not focused. Sound always plays — even while you are in that chat.',
        groupLook: 'Appearance',
        themeLabel: 'Toast theme',
        themeHint: '“System” follows the light or dark theme of the app and your OS; you can pin one explicitly.',
        themeSystem: 'System',
        themeDark: 'Dark',
        themeLight: 'Light',
        lookPreview: 'Preview of the selected style',
        textSize: 'Text size',
        textSizeHint: 'Base font size of a toast; every other label scales with it.',
        textSizeSmall: 'Small',
        textSizeNormal: 'Normal',
        textSizeLarge: 'Large',
        textSizeHuge: 'Extra large',
        fontFamily: 'Font',
        fontFamilyHint: 'Typeface of the notification text.',
        fontSystem: 'As in the app',
        fontSans: 'Sans serif',
        fontSerif: 'Serif',
        fontMono: 'Monospace',
        fontStyle: 'Text style',
        fontStyleHint: 'Weight and slant of the notification text.',
        styleNormal: 'Regular',
        styleBold: 'Semibold',
        styleItalic: 'Italic',
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
        gameMode: 'Game mode',
        gameModeHint: 'No toasts and no system notifications, so nothing covers a game. Sound stays on.',
        groupSound: 'Sound',
        sound: 'Sound notifications',
        soundHint: 'Soft cues: finished, attention, error.',
        volume: 'Volume',
        volumeHint: 'Relative loudness of the cues.',
        groupSystem: 'System notifications',
        system: 'Show in the system',
        systemHint: 'A Windows notification while the app window is in the background. Windows may hide it in a fullscreen game.',
        systemUnsupported: 'This window does not support system notifications.',
        systemGranted: 'Permission granted.',
        systemDenied: 'System notifications are blocked in the browser settings.',
        systemAsk: 'Allow',
        groupPreview: 'Preview',
        previewHint: 'Show a toast and play its sound right now.',
        previewDone: 'Finished',
        previewAttention: 'Attention',
        previewError: 'Error',
        nativeTest: 'Above all windows',
        nativeTestHint: 'A native card above other applications — visible even when Harness is not focused.',
        nativeShow: 'Show',
        nativeUnavailable: 'The native card is available in the Windows Harness app.',
        groupHistory: 'Recent',
        historyEmpty: 'Nothing yet. The latest notifications appear here.',
        clear: 'Clear',
        previewSession: 'Example task',
        previewErrorText: 'The model request failed.',
        updateTitle: 'Update available',
        updateBody: 'dsh-notify {version} has been released.',
        updateNow: 'Update',
        updateDoneTitle: 'Update installed',
        updateGroup: 'Updates',
        updateCurrent: 'Installed version',
        updateStatus: 'Update check',
        updateCheck: 'Check for updates',
        updateInstall: 'Install update',
        updateChecking: 'Checking GitHub…',
        updateInstalling: 'Downloading and installing…',
        updateUpToDate: 'You are up to date.',
        updateAvailable: 'Version {version} is available.',
        updateInstalled: 'Version {version} is installed.',
        updateFailed: 'Could not check for updates: {reason}.',
        updateInstallFailed: 'Could not install the update: {reason}.',
        updateNever: 'Not checked yet.',
        updateCheckedAt: 'Checked at {time}.',
        updateHint: 'The plugin checks GitHub on startup and every few hours.',
        updateRestart: 'The new version starts working after DeepSeek Harness restarts.',
        updateNoSource: 'No update source is configured.',
        updateControlFailed: 'Harness did not answer.',
      },
    }

    /**
     * The stylesheet follows the host: surfaces and text come from theme tokens,
     * accent colors from the semantic state tokens, geometry is plain CSS.
     */
    const CSS = `
.dsh-ntf-layer{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:10px;box-sizing:border-box;padding:22px;pointer-events:none;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;--dsh-ntf-shift:10px}
.dsh-ntf-pos-bottom-right{align-items:flex-end;justify-content:flex-end}
.dsh-ntf-pos-bottom-left{align-items:flex-start;justify-content:flex-end}
.dsh-ntf-pos-top-right{align-items:flex-end;justify-content:flex-start}
.dsh-ntf-pos-top-left{align-items:flex-start;justify-content:flex-start}
.dsh-ntf-pos-top-right,.dsh-ntf-pos-top-left{--dsh-ntf-shift:-10px}
.dsh-ntf-kind-done{--dsh-ntf-accent:var(--dsw-alias-state-success-primary)}
.dsh-ntf-kind-attention{--dsh-ntf-accent:var(--dsw-alias-state-warn-primary)}
.dsh-ntf-kind-error{--dsh-ntf-accent:var(--dsw-alias-state-error-primary)}
.dsh-ntf-kind-update{--dsh-ntf-accent:var(--dsw-alias-brand-primary)}
.dsh-ntf-kind-update-done{--dsh-ntf-accent:var(--dsw-alias-state-success-primary)}
.dsh-ntf-card{--dsh-ntf-surface:var(--dsw-alias-bg-overlay);--dsh-ntf-text:var(--dsw-alias-label-primary);--dsh-ntf-muted:var(--dsw-alias-label-secondary);--dsh-ntf-edge:var(--dsw-alias-border-l2);--dsh-ntf-chip:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);--dsh-ntf-chip-hover:color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent);position:relative;box-sizing:border-box;width:min(392px,calc(100vw - 32px));overflow:hidden;pointer-events:auto;border:1px solid var(--dsh-ntf-edge);border-radius:13px;background:var(--dsh-ntf-surface);color:var(--dsh-ntf-text);font-family:var(--dsh-ntf-font-family,inherit);font-size:var(--dsh-ntf-font-size,13px);font-style:var(--dsh-ntf-font-style,normal);font-weight:var(--dsh-ntf-font-weight,400);box-shadow:inset 3px 0 0 var(--dsh-ntf-accent),0 20px 44px -22px color-mix(in srgb, var(--dsh-ntf-text) 45%, transparent);animation:dsh-ntf-enter .18s ease-out both}
.dsh-ntf-card[data-theme="dark"]{--dsh-ntf-surface:#1C1D22;--dsh-ntf-text:#F2F4F7;--dsh-ntf-muted:#A4AAB3;--dsh-ntf-edge:#2E3037;--dsh-ntf-chip:#2A2C33;--dsh-ntf-chip-hover:#34363E}
.dsh-ntf-card[data-theme="light"]{--dsh-ntf-surface:#FFFFFF;--dsh-ntf-text:#16181D;--dsh-ntf-muted:#626873;--dsh-ntf-edge:#E4E6EB;--dsh-ntf-chip:#F1F2F5;--dsh-ntf-chip-hover:#E8EAEF}
.dsh-ntf-card[data-theme="dark"].dsh-ntf-kind-done{--dsh-ntf-accent:#3BD69A}
.dsh-ntf-card[data-theme="dark"].dsh-ntf-kind-attention{--dsh-ntf-accent:#F0BE58}
.dsh-ntf-card[data-theme="dark"].dsh-ntf-kind-error{--dsh-ntf-accent:#F07B7B}
.dsh-ntf-card[data-theme="light"].dsh-ntf-kind-done{--dsh-ntf-accent:#1FA974}
.dsh-ntf-card[data-theme="light"].dsh-ntf-kind-attention{--dsh-ntf-accent:#C08A18}
.dsh-ntf-card[data-theme="light"].dsh-ntf-kind-error{--dsh-ntf-accent:#D14B4B}
.dsh-ntf-card[data-theme="dark"][data-os="mac"]{border-radius:16px}
.dsh-ntf-card[data-theme="light"][data-os="mac"]{border-radius:16px}
.dsh-ntf-card[data-os="mac"]{border-radius:15px;box-shadow:inset 3px 0 0 var(--dsh-ntf-accent),0 24px 54px -26px color-mix(in srgb, var(--dsh-ntf-text) 40%, transparent)}
.dsh-ntf-card[data-variant="banner"]{width:min(462px,calc(100vw - 32px))}
.dsh-ntf-card.is-leaving{animation:dsh-ntf-leave .18s ease-in both}
.dsh-ntf-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;background:color-mix(in srgb, var(--dsh-ntf-accent) 14%, transparent);color:var(--dsh-ntf-accent)}
.dsh-ntf-compact .dsh-ntf-icon{width:28px;height:28px;border-radius:9px}
.dsh-ntf-title{display:flex;align-items:center;gap:6px;font-size:1.04em;font-weight:var(--dsh-ntf-title-weight,600);line-height:1.45em;color:var(--dsh-ntf-text)}
.dsh-ntf-count{padding:0 6px;border-radius:999px;background:color-mix(in srgb, var(--dsh-ntf-accent) 15%, transparent);color:var(--dsh-ntf-accent);font-size:0.85em;font-weight:600;line-height:1.45em}
.dsh-ntf-meta{overflow:hidden;color:var(--dsh-ntf-muted);font-size:0.88em;line-height:1.4em;white-space:nowrap;text-overflow:ellipsis}
.dsh-ntf-body{margin:8px 0 0;color:var(--dsh-ntf-text);font-size:1em;line-height:1.46em;overflow-wrap:anywhere}
.dsh-ntf-compact{display:flex;align-items:center;gap:10px;padding:11px 11px 11px 14px}
.dsh-ntf-compact-body{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
.dsh-ntf-inline{overflow:hidden;color:var(--dsh-ntf-muted);font-size:0.92em;line-height:1.4em;white-space:nowrap;text-overflow:ellipsis}
.dsh-ntf-card--rich{padding:14px 14px 13px 16px}
.dsh-ntf-head{display:flex;align-items:flex-start;gap:11px}
.dsh-ntf-heading{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
.dsh-ntf-foot{display:flex;align-items:center;gap:10px;margin-top:11px}
.dsh-ntf-time{margin-left:auto;color:var(--dsh-ntf-muted);font-size:0.85em;font-variant-numeric:tabular-nums}
.dsh-ntf-banner{display:flex;align-items:center;gap:11px;padding:12px 12px 12px 15px}
.dsh-ntf-banner-text{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
.dsh-ntf-banner-body{color:var(--dsh-ntf-muted);font-size:0.92em;line-height:1.42em;overflow-wrap:anywhere}
.dsh-ntf-close{display:inline-flex;flex:none;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:var(--dsh-ntf-chip);color:var(--dsh-ntf-muted);font:inherit;font-size:1.38em;font-weight:500;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease}
.dsh-ntf-close:hover{background:var(--dsh-ntf-chip-hover);color:var(--dsh-ntf-text)}
.dsh-ntf-head .dsh-ntf-close,.dsh-ntf-compact .dsh-ntf-close{align-self:flex-start}
.dsh-ntf-banner .dsh-ntf-close{align-self:center}
.dsh-ntf-action{appearance:none;height:29px;padding:0 13px;border:1px solid color-mix(in srgb, var(--dsh-ntf-accent) 32%, transparent);border-radius:9px;background:color-mix(in srgb, var(--dsh-ntf-accent) 12%, transparent);color:var(--dsh-ntf-text);font:inherit;font-size:0.92em;font-weight:500;line-height:1.5em;cursor:pointer;transition:background .12s ease}
.dsh-ntf-action:hover{background:color-mix(in srgb, var(--dsh-ntf-accent) 20%, transparent)}
.dsh-ntf-progress{position:absolute;right:0;bottom:0;left:0;height:2px;opacity:.45;background:var(--dsh-ntf-accent);transform-origin:left;animation-name:dsh-ntf-progress;animation-timing-function:linear;animation-fill-mode:forwards}
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
.dsh-ntf-look{padding:0 16px 16px}
.dsh-ntf-look-row{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:4px 0 12px}
.dsh-ntf-select{box-sizing:border-box;height:32px;min-width:190px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsh-ntf-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-ntf-stage{display:flex;align-items:center;justify-content:center;min-height:168px;padding:18px;border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base)}
.dsh-ntf-stage[data-pos="bottom-right"]{align-items:flex-end;justify-content:flex-end}
.dsh-ntf-stage[data-pos="bottom-left"]{align-items:flex-start;justify-content:flex-end}
.dsh-ntf-stage[data-pos="top-right"]{align-items:flex-end;justify-content:flex-start}
.dsh-ntf-stage[data-pos="top-left"]{align-items:flex-start;justify-content:flex-start}
.dsh-ntf-stage .dsh-ntf-card{max-width:100%;animation:none;pointer-events:none}
.dsh-ntf-stage .dsh-ntf-progress{animation-iteration-count:infinite}
.dsh-ntf-stage .dsh-ntf-card{animation:none;pointer-events:none}
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

    /** The theme a card should draw with; `system` leaves the app tokens in charge. */
    function resolvedTheme(settings) {
      return pick(settings.theme, THEMES, 'system')
    }

    /** Normalize one computed CSS color to the #rrggbb / #aarrggbb the companion parses. */
    function hexColor(raw, fallback) {
      try {
        const value = String(raw ?? '').trim()
        if (value === '') return fallback
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext('2d')
        if (context === null) return fallback
        context.fillStyle = '#000000'
        context.fillStyle = value
        const normalized = context.fillStyle
        if (typeof normalized !== 'string') return fallback
        if (normalized.startsWith('#')) return normalized
        const match = /^rgba?\(([^)]+)\)$/u.exec(normalized)
        if (match === null) return fallback
        const parts = match[1].split(',').map(part => Number.parseFloat(part))
        const clamp = (input, max) => Math.max(0, Math.min(max, Math.round(input)))
        const red = clamp(parts[0] ?? 0, 255)
        const green = clamp(parts[1] ?? 0, 255)
        const blue = clamp(parts[2] ?? 0, 255)
        const alpha = parts.length > 3 ? Math.max(0, Math.min(1, parts[3] ?? 1)) : 1
        const two = input => input.toString(16).padStart(2, '0')
        if (alpha >= 1) return `#${two(red)}${two(green)}${two(blue)}`
        return `#${two(Math.round(alpha * 255))}${two(red)}${two(green)}${two(blue)}`
      } catch {
        return fallback
      }
    }

    /** Read a theme token off the document and return it as a companion-ready color. */
    function tokenColor(name, fallback) {
      try {
        const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name)
        if (fromRoot.trim() !== '') return hexColor(fromRoot, fallback)
        const fromBody = getComputedStyle(document.body).getPropertyValue(name)
        return hexColor(fromBody, fallback)
      } catch {
        return fallback
      }
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
        if (typeof parsed.theme === 'string') next.theme = pick(parsed.theme, THEMES, DEFAULTS.theme)
        if (typeof parsed.gameMode === 'boolean') next.gameMode = parsed.gameMode
        if (typeof parsed.system === 'boolean') next.system = parsed.system
        if (typeof parsed.variant === 'string') next.variant = pick(parsed.variant, VARIANTS, DEFAULTS.variant)
        if (typeof parsed.textSize === 'number') next.textSize = pick(parsed.textSize, TEXT_SIZES, DEFAULTS.textSize)
        if (typeof parsed.fontFamily === 'string') next.fontFamily = pick(parsed.fontFamily, FONT_FAMILIES, DEFAULTS.fontFamily)
        if (typeof parsed.fontStyle === 'string') next.fontStyle = pick(parsed.fontStyle, FONT_STYLES, DEFAULTS.fontStyle)
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
      if (record.kind === 'update') {
        const latest = typeof record.latestVersion === 'string' ? record.latestVersion : ''
        const installed = typeof record.currentVersion === 'string' ? record.currentVersion : ''
        return {
          title: t('updateTitle'),
          meta: installed !== '' && latest !== '' ? `${installed} → ${latest}` : latest,
          body: t('updateBody', { version: latest }),
        }
      }
      if (record.kind === 'update-done') {
        const version = typeof record.latestVersion === 'string' ? record.latestVersion : ''
        return { title: t('updateDoneTitle'), meta: version, body: t('updateRestart') }
      }
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
      const textSize = pick(props.textSize, TEXT_SIZES, DEFAULTS.textSize)
      const fontChoice = pick(props.fontFamily, FONT_FAMILIES, DEFAULTS.fontFamily)
      const textStyle = pick(props.fontStyle, FONT_STYLES, DEFAULTS.fontStyle)
      /** Typography the settings chose, handed to CSS through custom properties. */
      const look = {
        '--dsh-ntf-font-size': `${textSize}px`,
        '--dsh-ntf-font-family': FONT_STACKS[fontChoice],
        '--dsh-ntf-font-style': textStyle === 'italic' ? 'italic' : 'normal',
        '--dsh-ntf-font-weight': textStyle === 'bold' ? '600' : '400',
        '--dsh-ntf-title-weight': textStyle === 'bold' ? '700' : '600',
      }
      const shape = props.variant === 'compact'
        ? ' dsh-ntf-compact'
        : props.variant === 'banner'
          ? ' dsh-ntf-banner'
          : ' dsh-ntf-card--rich'
      const className = `dsh-ntf-card${shape} dsh-ntf-kind-${item.kind}${item.leaving ? ' is-leaving' : ''}`
      const openable = item.sessionId !== ''
      const updatable = item.kind === 'update'
      const onOpen = event => {
        if (event !== undefined) event.stopPropagation()
        props.onOpen(item)
      }
      const onUpdate = event => {
        if (event !== undefined) event.stopPropagation()
        if (typeof props.onUpdate === 'function') props.onUpdate(item)
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
      }, h('span', { 'aria-hidden': true }, '✕'))
      const progress = item.duration > 0 && !item.leaving
        ? h('span', { className: 'dsh-ntf-progress', style: { animationDuration: `${item.duration}ms` } })
        : null

      if (props.variant === 'compact') {
        return h('div', {
          className,
          'data-variant': props.variant,
          'data-theme': props.theme ?? 'system',
          'data-os': OS,
          role: item.kind === 'error' ? 'alert' : 'status',
          onClick: openable ? onOpen : undefined,
          style: { ...look, ...(openable ? { cursor: 'pointer' } : {}) },
          ...keyboard,
        },
        h('span', { className: 'dsh-ntf-icon' }, h(Icon, { kind: item.kind, size: 16 })),
        h('div', { className: 'dsh-ntf-compact-body' },
          h('div', { className: 'dsh-ntf-title' },
            info.title,
            item.count > 1 ? h('span', { className: 'dsh-ntf-count' }, `×${item.count}`) : null),
          h('div', { className: 'dsh-ntf-inline' }, info.body)),
        updatable
          ? h('button', { type: 'button', className: 'dsh-ntf-action', onClick: onUpdate }, t('updateNow'))
          : null,
        close,
        progress)
      }

      if (props.variant === 'banner') {
        return h('div', {
          className,
          'data-variant': props.variant,
          'data-theme': props.theme ?? 'system',
          'data-os': OS,
          role: item.kind === 'error' ? 'alert' : 'status',
          onClick: openable ? onOpen : undefined,
          style: { ...look, ...(openable ? { cursor: 'pointer' } : {}) },
          ...keyboard,
        },
        h('span', { className: 'dsh-ntf-icon' }, h(Icon, { kind: item.kind })),
        h('div', { className: 'dsh-ntf-banner-text' },
          h('div', { className: 'dsh-ntf-title' },
            info.title,
            item.count > 1 ? h('span', { className: 'dsh-ntf-count' }, `×${item.count}`) : null),
          h('div', { className: 'dsh-ntf-banner-body' }, info.body)),
        updatable
          ? h('button', { type: 'button', className: 'dsh-ntf-action', onClick: onUpdate }, t('updateNow'))
          : openable
            ? h('button', { type: 'button', className: 'dsh-ntf-action', onClick: onOpen }, t('open'))
            : null,
        close,
        progress)
      }

      return h('div', {
        className,
        'data-variant': props.variant,
        'data-theme': props.theme ?? 'system',
        'data-os': OS,
        role: item.kind === 'error' ? 'alert' : 'status',
        onClick: openable ? onOpen : undefined,
        style: look,
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
        updatable
          ? h('button', { type: 'button', className: 'dsh-ntf-action', onClick: onUpdate }, t('updateNow'))
          : openable
            ? h('button', { type: 'button', className: 'dsh-ntf-action', onClick: onOpen }, t('open'))
            : null,
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
      const theme = resolvedTheme(settings)
      const textSize = pick(settings.textSize, TEXT_SIZES, DEFAULTS.textSize)
      const fontFamily = pick(settings.fontFamily, FONT_FAMILIES, DEFAULTS.fontFamily)
      const fontStyle = pick(settings.fontStyle, FONT_STYLES, DEFAULTS.fontStyle)
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
        theme,
        textSize,
        fontFamily,
        fontStyle,
        onClose: controller.dismiss,
        onOpen: controller.openFromToast,
        onUpdate: controller.installUpdateFromToast,
      })))
    }

    /**
     * Invisible passenger in the conversation body: while this chat is on screen
     * the Host receives its id, and switching away clears it. Rendering nothing
     * keeps the dock visually unchanged.
     */
    function SessionTracker(props) {
      const sessionId = props.sessionId
      const controller = props.controller
      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        controller.setActiveSession(sessionId)
        return () => controller.clearActiveSession(sessionId)
      }, [sessionId, controller])
      return null
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

    /** The one-line status the Updates group shows for the current state. */
    function updateStatusText(state) {
      if (state.status === 'checking') return t('updateChecking')
      if (state.status === 'installing') return t('updateInstalling')
      if (state.status === 'installed') return t('updateInstalled', { version: state.latest || state.current })
      if (state.status === 'available') {
        if (state.installError !== '') return t('updateInstallFailed', { reason: state.installError })
        return t('updateAvailable', { version: state.latest })
      }
      if (state.status === 'error') return t('updateFailed', { reason: state.error })
      if (state.checkedAt > 0) return t('updateUpToDate')
      return t('updateNever')
    }

    function SettingsPage(props) {
      const controller = props.controller
      useStore(controller.localeTick)
      const settings = useStore(controller.settings)
      const history = useStore(controller.history)
      const permission = useStore(controller.permission)
      const nativeAvailable = useStore(controller.nativeState)
      const update = useStore(controller.updateState)
      const updateBusy = update.status === 'checking' || update.status === 'installing'
      React.useEffect(() => {
        // The page may have been open for hours; read the current status.
        void controller.refreshUpdate()
      }, [controller])
      const variant = pick(settings.variant, VARIANTS, DEFAULTS.variant)
      const position = pick(settings.position, POSITIONS, DEFAULTS.position)
      const duration = pick(settings.duration, DURATIONS, DEFAULTS.duration)
      const textSize = pick(settings.textSize, TEXT_SIZES, DEFAULTS.textSize)
      const fontFamily = pick(settings.fontFamily, FONT_FAMILIES, DEFAULTS.fontFamily)
      const fontStyle = pick(settings.fontStyle, FONT_STYLES, DEFAULTS.fontStyle)
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
              h('h2', { className: 'dsh-ntf-group-title' }, t('updateGroup')),
              h('div', { className: 'dsh-ntf-group-body' },
                h(Row, {
                  title: t('updateCurrent'),
                  description: update.source !== '' ? update.source : undefined,
                }, h('span', { className: 'dsh-ntf-row-title' }, update.current !== '' ? update.current : '—')),
                h(Row, {
                  title: t('updateStatus'),
                  description: `${updateStatusText(update)}${update.checkedAt > 0
                    ? ` ${t('updateCheckedAt', { time: formatClock(update.checkedAt) })}`
                    : ''}`,
                },
                h('button', {
                  type: 'button',
                  className: 'dsh-ntf-preview',
                  disabled: updateBusy,
                  onClick: () => {
                    void controller.checkUpdates()
                  },
                }, t('updateCheck')),
                update.status === 'available'
                  ? h('button', {
                      type: 'button',
                      className: 'dsh-ntf-action',
                      disabled: updateBusy,
                      onClick: () => {
                        void controller.installUpdate()
                      },
                    }, t('updateInstall'))
                  : null),
                h('p', { className: 'dsh-ntf-note' },
                  update.restartRequired ? t('updateRestart') : t('updateHint')))),
            h('section', { className: 'dsh-ntf-group' },
              h('h2', { className: 'dsh-ntf-group-title' }, t('groupLook')),
              h('div', { className: 'dsh-ntf-look' },
                h('div', { className: 'dsh-ntf-look-row' },
                  h('label', { className: 'dsh-ntf-row-title', htmlFor: 'dsh-ntf-theme' }, t('themeLabel')),
                  h('select', {
                    id: 'dsh-ntf-theme',
                    className: 'dsh-ntf-select',
                    value: resolvedTheme(settings),
                    'aria-label': t('themeLabel'),
                    onChange: event => controller.update({ theme: pick(event.target.value, THEMES, 'system') }),
                  },
                  h('option', { value: 'system' }, t('themeSystem')),
                  h('option', { value: 'dark' }, t('themeDark')),
                  h('option', { value: 'light' }, t('themeLight')))),
                h('p', { className: 'dsh-ntf-note', style: { padding: '0 0 10px' } }, t('themeHint')),
                h('div', { className: 'dsh-ntf-look-row' },
                  h('span', { className: 'dsh-ntf-row-title', title: t('variantHint') }, t('variant')),
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
                h('div', { className: 'dsh-ntf-look-row' },
                  h('span', { className: 'dsh-ntf-row-title', title: t('textSizeHint') }, t('textSize')),
                  h(Segmented, {
                    label: t('textSize'),
                    value: textSize,
                    onChange: value => controller.update({ textSize: value }),
                    options: [
                      { value: 12, label: t('textSizeSmall') },
                      { value: 13, label: t('textSizeNormal') },
                      { value: 15, label: t('textSizeLarge') },
                      { value: 17, label: t('textSizeHuge') },
                    ],
                  })),
                h('div', { className: 'dsh-ntf-look-row' },
                  h('label', { className: 'dsh-ntf-row-title', htmlFor: 'dsh-ntf-font', title: t('fontFamilyHint') }, t('fontFamily')),
                  h('select', {
                    id: 'dsh-ntf-font',
                    className: 'dsh-ntf-select',
                    value: fontFamily,
                    'aria-label': t('fontFamily'),
                    onChange: event => controller.update({ fontFamily: pick(event.target.value, FONT_FAMILIES, DEFAULTS.fontFamily) }),
                  },
                  h('option', { value: 'system' }, t('fontSystem')),
                  h('option', { value: 'sans' }, t('fontSans')),
                  h('option', { value: 'serif' }, t('fontSerif')),
                  h('option', { value: 'mono' }, t('fontMono')))),
                h('div', { className: 'dsh-ntf-look-row' },
                  h('span', { className: 'dsh-ntf-row-title', title: t('fontStyleHint') }, t('fontStyle')),
                  h(Segmented, {
                    label: t('fontStyle'),
                    value: fontStyle,
                    onChange: value => controller.update({ fontStyle: value }),
                    options: [
                      { value: 'normal', label: t('styleNormal') },
                      { value: 'bold', label: t('styleBold') },
                      { value: 'italic', label: t('styleItalic') },
                    ],
                  })),
                h('div', { className: 'dsh-ntf-stage', 'data-pos': position },
                  h(ToastCard, {
                    item: {
                      uid: 'style-preview',
                      kind: 'done',
                      sessionId: 'preview',
                      sessionTitle: t('previewSession'),
                      reason: '',
                      tool: '',
                      question: '',
                      message: '',
                      durationMs: 120_000,
                      at: Date.now(),
                      duration,
                      count: 1,
                      leaving: false,
                      sticky: false,
                      unseen: false,
                    },
                    variant,
                    theme: resolvedTheme(settings),
                    textSize,
                    fontFamily,
                    fontStyle,
                    onClose: () => {},
                    onOpen: () => {},
                  })))),
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
                h(Row, { title: t('gameMode'), description: t('gameModeHint') },
                  h(Switch, {
                    checked: settings.gameMode === true,
                    label: t('gameMode'),
                    onChange: value => controller.update({ gameMode: value }),
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
                }, h('span', { className: 'dsh-ntf-preview-dot' }), t('previewError'))),
              h(Row, { title: t('nativeTest'), description: t('nativeTestHint') },
                h('button', {
                  type: 'button',
                  className: 'dsh-ntf-action',
                  disabled: !nativeAvailable,
                  onClick: () => controller.previewNative(),
                }, t('nativeShow'))),
              nativeAvailable ? null : h('p', { className: 'dsh-ntf-note' }, t('nativeUnavailable'))),
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
      /** The chat currently shown in the conversation body, or '' on any other view. */
      const activeSession = createStore('')
      /** Whether the native above-all-windows card is available in this Host. */
      const nativeState = createStore(false)
      /** Self-update status mirrored from the Host. */
      const updateState = createStore({
        status: 'idle',
        current: '',
        latest: '',
        checkedAt: 0,
        error: '',
        installError: '',
        restartRequired: false,
        source: '',
      })
      /** Releases already offered as a toast in this page. */
      const offeredUpdates = new Set()
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
      /** Whether this Host can draw an always-on-top card on this platform. */
      let nativeAvailable = false

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
        void syncPresentation()
      }

      function persistHistory(entries) {
        try {
          window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
        } catch {
          // History is a convenience.
        }
      }

      /** The theme palette the Windows companion draws with. */
      function readPalette() {
        const mode = resolvedTheme(settings.get())
        if (mode === 'dark' || mode === 'light') return { ...NATIVE_PALETTES[mode] }
        return {
          background: tokenColor('--dsw-alias-bg-overlay', '#F21E1F24'),
          foreground: tokenColor('--dsw-alias-label-primary', '#F2F3F5'),
          muted: tokenColor('--dsw-alias-label-secondary', '#9AA0A6'),
          border: tokenColor('--dsw-alias-border-l2', '#33FFFFFF'),
          done: tokenColor('--dsw-alias-state-success-primary', '#38C98A'),
          attention: tokenColor('--dsw-alias-state-warn-primary', '#E8B341'),
          error: tokenColor('--dsw-alias-state-error-primary', '#E05B5B'),
        }
      }

      /** One authenticated call to the control route; null when it did not answer. */
      async function postControl(body) {
        try {
          const response = await fetch(CONTROL_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: feedControl.signal,
          })
          if (!response.ok) return null
          return await response.json()
        } catch {
          return null
        }
      }

      /** Tell the Host how a native card should look; also learns whether it exists. */
      async function syncPresentation() {
        const config = settings.get()
        const result = await postControl({
          type: 'presentation',
          value: {
            enabled: config.notifications === true,
            gameMode: config.gameMode === true,
            corner: pick(config.position, POSITIONS, DEFAULTS.position),
            durationMs: config.duration,
            width: 384,
            labels: { open: t('open'), dismiss: t('dismiss') },
            palette: readPalette(),
            fonts: {
              family: NATIVE_FONTS[pick(config.fontFamily, FONT_FAMILIES, DEFAULTS.fontFamily)] ?? 'Segoe UI',
              size: Number.isFinite(config.textSize) ? config.textSize : DEFAULTS.textSize,
              weight: config.fontStyle === 'bold' ? 600 : 400,
              italic: config.fontStyle === 'italic',
            },
          },
        })
        nativeAvailable = result !== null && result.native === true
        nativeState.set(nativeAvailable)
      }

      /** Draw a card above every application; fall back to the held in-app toast. */
      async function showNative(record, options = {}) {
        const info = describe(record)
        /** The page title names this window when Harness runs in a browser tab. */
        const pageTitle = typeof document !== 'undefined' && typeof document.title === 'string'
          ? document.title.trim()
          : ''
        const result = await postControl({
          type: 'native',
          token: `n${record.uid}-${Date.now()}`,
          sessionId: record.sessionId,
          kind: record.kind,
          title: info.title,
          body: info.body,
          meta: info.meta ?? '',
          windowTitle: pageTitle,
          record: {
            kind: record.kind,
            sessionId: record.sessionId,
            sessionTitle: record.sessionTitle,
            reason: record.reason,
            tool: record.tool,
            question: record.question,
            message: record.message,
            durationMs: record.durationMs,
            at: record.at,
          },
        })
        if (result !== null && result.ok === true) return
        pushToast(record, settings.get(), { unseen: options.unseenFallback !== false })
      }

      /** Show the native card on demand, even while the app is focused. */
      function previewNative() {
        uid += 1
        const record = {
          uid,
          kind: 'attention',
          sessionId: '',
          sessionTitle: t('previewSession'),
          reason: 'approval',
          tool: 'bash',
          question: '',
          message: '',
          durationMs: 0,
          at: Date.now(),
          sticky: false,
        }
        if (nativeState.get() !== true) {
          pushToast(record, settings.get(), { unseen: false })
          return
        }
        void showNative(record, { unseenFallback: false })
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

      /** Remember the chat the person is looking at and drop its toasts and cards. */
      function setActiveSession(sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return
        if (activeSession.get() === sessionId) return
        activeSession.set(sessionId)
        for (const item of toasts.get()) {
          if (item.sessionId === sessionId && item.leaving !== true) dismiss(item.uid)
        }
        void postControl({ type: 'dismiss', sessionId })
      }

      /** The conversation left the screen (another chat, another panel, or a closed tab). */
      function clearActiveSession(sessionId) {
        if (activeSession.get() !== sessionId) return
        activeSession.set('')
      }

      /** The app window is back: drop toasts for the chat being read, wake the rest. */
      function markWindowActive() {
        const active = activeSession.get()
        if (active !== '') {
          for (const item of toasts.get()) {
            if (item.sessionId === active && item.leaving !== true) dismiss(item.uid)
          }
        }
        const current = toasts.get()
        const woken = []
        const next = current.map(item => {
          if (item.unseen !== true) return item
          const updated = { ...item, unseen: false }
          woken.push(updated)
          return updated
        })
        if (woken.length === 0) return
        toasts.set(next)
        for (const item of woken) schedule(item, settings.get())
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

      function pushToast(record, config, options = {}) {
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
                unseen: item.unseen === true || options.unseen === true,
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
          duration: record.sticky === true ? 0 : (Number.isFinite(options.duration) ? options.duration : config.duration),
          unseen: options.unseen === true,
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
        // A toast created while the window was hidden waits for the person to
        // come back instead of expiring unseen.
        if (toast.unseen === true) return
        if (!(toast.duration > 0)) return
        setTimer(`auto:${toast.uid}`, () => dismiss(toast.uid), toast.duration)
      }

      /** Mirror the Host's self-update status and offer a discovered release. */
      function applyUpdateState(next) {
        if (next === null || typeof next !== 'object') return undefined
        const state = {
          status: typeof next.status === 'string' ? next.status : 'idle',
          current: typeof next.current === 'string' ? next.current : '',
          latest: typeof next.latest === 'string' ? next.latest : '',
          checkedAt: Number.isFinite(next.checkedAt) ? next.checkedAt : 0,
          error: typeof next.error === 'string' ? next.error : '',
          installError: typeof next.installError === 'string' ? next.installError : '',
          restartRequired: next.restartRequired === true,
          source: typeof next.source === 'string' ? next.source : '',
        }
        updateState.set(state)
        if (state.status === 'available' && state.latest !== '') offerUpdate(state.latest, state.current)
        return state
      }

      /** Show the update toast once per release, respecting the toast settings. */
      function offerUpdate(latest, current) {
        if (offeredUpdates.has(latest)) return
        offeredUpdates.add(latest)
        const config = settings.get()
        if (config.notifications !== true || config.gameMode === true) return
        const windowActive = typeof document !== 'undefined'
          && document.hasFocus()
          && document.visibilityState !== 'hidden'
        uid += 1
        pushToast({
          uid,
          kind: 'update',
          sessionId: '',
          sessionTitle: '',
          reason: 'update',
          tool: '',
          question: '',
          message: '',
          durationMs: 0,
          at: Date.now(),
          sticky: false,
          latestVersion: latest,
          currentVersion: current,
        }, config, { duration: 15_000, unseen: !windowActive })
      }

      /** Read the current self-update status without asking GitHub. */
      async function refreshUpdate() {
        const result = await postControl({ type: 'update/state' })
        if (result !== null && result.ok === true) applyUpdateState(result.state)
      }

      /** Ask the Host to compare the installed package with GitHub. */
      async function checkUpdates() {
        updateState.set({ ...updateState.get(), status: 'checking', error: '', installError: '' })
        const result = await postControl({ type: 'update/check' })
        if (result !== null && result.ok === true) {
          applyUpdateState(result.state)
          return
        }
        updateState.set({
          ...updateState.get(),
          status: 'error',
          error: t('updateControlFailed'),
          checkedAt: Date.now(),
        })
      }

      /** Download and install the offered release; a restart applies it. */
      async function installUpdate() {
        if (updateState.get().status === 'installing') return
        updateState.set({ ...updateState.get(), status: 'installing', installError: '' })
        const result = await postControl({ type: 'update/install' })
        if (result === null || result.ok !== true) {
          updateState.set({ ...updateState.get(), status: 'available', installError: t('updateControlFailed') })
          return
        }
        const state = applyUpdateState(result.state)
        if (state !== undefined && state.status === 'installed') {
          uid += 1
          pushToast({
            uid,
            kind: 'update-done',
            sessionId: '',
            sessionTitle: '',
            reason: 'update',
            tool: '',
            question: '',
            message: '',
            durationMs: 0,
            at: Date.now(),
            sticky: false,
            latestVersion: state.latest,
            currentVersion: state.current,
          }, settings.get(), { duration: 15_000 })
        }
      }

      /** The toast action: close the offer, then install. */
      function installUpdateFromToast(item) {
        if (item !== null && typeof item === 'object' && item.uid !== undefined) dismiss(item.uid)
        void installUpdate()
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
        // The companion reported that "open" was pressed on a native card.
        if (item.kind === 'action') {
          if (item.action === 'open' && typeof item.sessionId === 'string' && item.sessionId !== '') {
            // The Windows companion already raised the target window; focusing
            // from here would let another connected client (a browser tab of
            // the same Host) pull its own window in front of the app.
            openSession(item.sessionId)
            for (const toast of toasts.get()) {
              if (toast.sessionId === item.sessionId && toast.leaving !== true) dismiss(toast.uid)
            }
          }
          return
        }
        // A newer release discovered by the Host.
        if (item.kind === 'update') {
          const latest = typeof item.latestVersion === 'string' ? item.latestVersion : ''
          if (latest !== '') {
            const current = typeof item.currentVersion === 'string' ? item.currentVersion : ''
            updateState.set({ ...updateState.get(), status: 'available', latest, current: current || updateState.get().current })
            offerUpdate(latest, current)
          }
          return
        }
        // Another page installed the release; refresh without announcing it.
        if (item.kind === 'update-installed') {
          void refreshUpdate()
          return
        }
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
        const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden'
        const windowActive = focused && visible
        // The person may be reading exactly this chat: a toast would cover the
        // answer they are watching, so only the sound reports it.
        const watchingThisChat = windowActive && record.sessionId !== '' && activeSession.get() === record.sessionId
        if (config.sound === true) audio.play(kind, config.volume / 100)
        const showToast = force === true
          || (config.notifications === true && config.gameMode !== true && !watchingThisChat)
        // While the app window is not the one in front, a Windows companion card
        // floats above every other application; the in-app toast would be hidden.
        const useNative = showToast
          && !windowActive
          && force !== true
          && item.nativeFallback !== true
          && nativeAvailable === true
          && config.gameMode !== true
        if (showToast) {
          // A finished or failed turn means the waiting action is over: retire its
          // sticky reminder instead of leaving it on screen.
          if (kind !== 'attention' && record.sessionId !== '') {
            for (const item of toasts.get()) {
              if (item.sticky === true && item.leaving !== true && item.sessionId === record.sessionId) {
                dismiss(item.uid)
              }
            }
          }
          if (useNative) void showNative(record)
          else pushToast(record, config, { unseen: !windowActive && force !== true })
        }
        if (config.system === true && config.gameMode !== true && !windowActive && !useNative) systemNotify(record)
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
        nativeState,
        update,
        updateState,
        checkUpdates,
        installUpdate,
        installUpdateFromToast,
        refreshUpdate,
        dismiss,
        openFromToast,
        setActiveSession,
        clearActiveSession,
        markWindowActive,
        syncPresentation,
        preview,
        previewNative,
        clearHistory,
        requestPermission,
        ingest,
        start: () => {
          void syncPresentation()
          // The Host may have discovered a release before this page connected.
          void refreshUpdate()
          // A slow Host boot can miss the first sync; retry once, quietly.
          setTimeout(() => {
            if (!disposed) void syncPresentation()
          }, 3000)
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
          void controller.syncPresentation()
        }), 'notify: locale redraw')

        ctx.effect(() => {
          const off = ctx.on('theme/change', () => {
            void controller.syncPresentation()
          })
          return () => off()
        }, 'notify: theme presentation')

        ctx.effect(() => {
          const off = ctx.on('connection/reset', () => {
            void controller.syncPresentation()
          })
          return () => off()
        }, 'notify: connection presentation')

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

        // Toasts created while the window was hidden wait for the person to return.
        ctx.effect(() => {
          const onFocus = () => controller.markWindowActive()
          const onVisibility = () => {
            if (document.visibilityState === 'visible') controller.markWindowActive()
          }
          window.addEventListener('focus', onFocus)
          document.addEventListener('visibilitychange', onVisibility)
          return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }, 'notify: window presence')

        controller.start()

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'notify.session-tracker',
          order: 60,
        }, function NotifySessionTracker(props) {
          return h(SessionTracker, { ...props, controller })
        }))

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
