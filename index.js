/**
 * Host half of the task-notification bundle.
 *
 * The browser needs three facts the page cannot derive by itself: a turn just
 * finished, the agent is now waiting for a person, and a turn failed. All three
 * live in the Host, so this half observes the committed Session feed — turn
 * boundaries, approval audit events and `ask_user_question` calls — folds them
 * into small notification records, and serves them through an authenticated
 * long-poll route the Client half reads.
 *
 * The feed is a plain array keyed by an ascending id: a consumer asks for
 * "everything after N" and the request parks until something arrives or the
 * hold expires, so an idle page costs one quiet HTTP request every few seconds
 * and a busy page is told immediately. Records are transport-level data only —
 * no model request reads them.
 */

export const name = 'notify'
export const inject = ['connection']

/** Authenticated Fetch route the Client half long-polls. */
export const FEED_PATH = '/api/dsh-notify.feed'

/** Longest wait for a Session title before the notice goes out without it. */
export const TITLE_WAIT_MS = 400

/** A pending-interaction scan is reused for this long between page opens. */
export const PENDING_TTL_MS = 4_000

/** How long one poll may park before the Host answers with an empty batch. */
export const HOLD_MS = 12_000

/** Records kept for a consumer that reconnects after a short gap. */
export const MAX_ITEMS = 200

/** Longest free-text fragment a notification carries. */
export const MAX_TEXT = 240

/** A repeated Agent error inside this window belongs to the turn that already reported one. */
export const ERROR_DEDUPE_MS = 4_000

/** A Session title is reused for this long before the log is read again. */
export const TITLE_TTL_MS = 60_000

/** Collapse whitespace and cap a free-text fragment for a toast. */
export function clip(value, max = MAX_TEXT) {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
  if (text === '') return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** One readable line for an unknown thrown value. */
export function errorText(error) {
  if (error === null || error === undefined) return ''
  if (typeof error === 'string') return clip(error)
  if (typeof error === 'object' && typeof error.message === 'string') return clip(error.message)
  if (typeof error === 'object' && typeof error.reason === 'string') return clip(error.reason)
  return clip(String(error))
}

/** JSON answer with the no-store policy a live feed deserves. */
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Own one notification feed for this profile.
 * @param ctx - the plugin context; `connection` is required, session query optional.
 */
export function apply(ctx) {
  /** Cancels every parked poll when the plugin unloads. */
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'notify: release parked polls')

  // Ids are seeded from the clock so a record from a restarted Host is always
  // newer than any cursor a page kept from the previous generation.
  let sequence = Date.now()
  /** Distinguishes this Host generation from a previous one so a page can re-baseline. */
  const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  /** Published records, oldest first; bounded by MAX_ITEMS. */
  const feed = []
  /** Resolvers of polls that are waiting for the next record. */
  const waiters = new Set()
  /** Session id → start of its open turn. */
  const turnStarts = new Map()
  /** Session id → cached title and the moment it was read. */
  const titleCache = new Map()
  /** Session id → moment the last lost turn error was published. */
  const lastErrors = new Map()
  /** Last pending-interaction scan and the moment it ran. */
  const pendingCache = { at: 0, value: [] }
  /** Pending keys already published as reminders. */
  const publishedPending = new Set()
  /** Live attention records, so a sweep does not repeat one the page already got. */
  const liveAttentions = []

  /** Publish one record, waking every parked poll. */
  function publish(item) {
    sequence += 1
    const record = {
      id: sequence,
      at: Date.now(),
      kind: item.kind,
      sessionId: item.sessionId,
      sessionTitle: item.sessionTitle ?? '',
      reason: item.reason ?? '',
      tool: item.tool ?? '',
      question: item.question ?? '',
      message: item.message ?? '',
      durationMs: Number.isFinite(item.durationMs) && item.durationMs > 0 ? Math.round(item.durationMs) : 0,
      key: typeof item.key === 'string' ? item.key : '',
      reminder: item.reminder === true,
      sticky: item.sticky === true,
    }
    if (item.live === true && record.kind === 'attention') {
      liveAttentions.push({ sessionId: record.sessionId, reason: record.reason, at: record.at })
      if (liveAttentions.length > 100) liveAttentions.shift()
    }
    feed.push(record)
    if (feed.length > MAX_ITEMS) feed.splice(0, feed.length - MAX_ITEMS)
    const parked = [...waiters]
    waiters.clear()
    for (const wake of parked) wake()
    return record
  }

  /** The Session store, when this composition mounts one. */
  function sessionOf(sessionId) {
    const store = ctx.get('sessions')
    if (store === undefined || typeof store.get !== 'function') return undefined
    try {
      return store.get(sessionId)
    } catch {
      return undefined
    }
  }

  /** A delegated child finishing is not the task the person started. */
  function isSubagent(sessionId) {
    const session = sessionOf(sessionId)
    const header = session === null || session === undefined ? undefined : session.header
    return header !== undefined && header !== null && header.origin === 'subagent'
  }

  /** Latest log-backed title for a Session, cached for a minute. */
  async function readTitle(sessionId) {
    const cached = titleCache.get(sessionId)
    const now = Date.now()
    if (cached !== undefined && now - cached.at < TITLE_TTL_MS) return cached.title
    const query = ctx.get('sessionQuery')
    if (query === undefined || typeof query.readTitleSnapshots !== 'function') return ''
    try {
      const [observation] = await query.readTitleSnapshots([sessionId])
      let title = ''
      if (observation !== null && typeof observation === 'object' && observation.status === 'fulfilled') {
        const value = observation.value
        const snapshot = value !== null && typeof value === 'object' ? value.title : undefined
        if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.title === 'string') {
          title = clip(snapshot.title, 120)
        }
      }
      titleCache.set(sessionId, { at: now, title })
      return title
    } catch {
      return ''
    }
  }

  /** Attach the Session title, then publish; a title failure or a slow read must never hide the notice. */
  function announce(draft) {
    const cached = titleCache.get(draft.sessionId)
    if (cached !== undefined) {
      publish({ ...draft, sessionTitle: cached.title })
      return
    }
    const pendingTitle = readTitle(draft.sessionId)
    void Promise.race([
      pendingTitle.then(title => ({ title })),
      new Promise(resolve => setTimeout(() => resolve({ title: '' }), TITLE_WAIT_MS)),
    ]).then(result => {
      publish({ ...draft, sessionTitle: result.title })
    }).catch(() => {
      publish(draft)
    })
  }

  // A turn that finishes is the "task done" signal; its reason decides between
  // the green toast and the red one, so nothing here guesses from agent status.
  ctx.on('session/event', (session, event) => {
    if (session === undefined || session === null || event === null || typeof event !== 'object') return
    const header = session.header
    if (header === undefined || header === null || header.origin === 'subagent') return
    const sessionId = header.id
    if (typeof sessionId !== 'string') return
    // The person is asked at the moment the audit event (or the ask_user_question
    // call) is committed; a short grace period keeps auto-rejected approvals quiet.
    if (event.type === 'approval/asked') {
      const data = event.data
      const id = data !== null && typeof data === 'object' && typeof data.id === 'string' ? data.id : undefined
      if (id !== undefined) {
        scheduleAttention(`approval:${id}`, {
          kind: 'attention',
          sessionId,
          reason: 'approval',
          tool: clip(String(data.toolName ?? ''), 60),
        }, 1_200)
      }
      return
    }
    if (event.type === 'approval/decided') {
      const data = event.data
      if (data !== null && typeof data === 'object' && typeof data.id === 'string') cancelAttention(`approval:${data.id}`)
      return
    }
    if (event.type === 'tool/call') {
      const data = event.data
      if (data !== null && typeof data === 'object' && data.name === 'ask_user_question') {
        const callId = typeof data.callId === 'string' ? data.callId : `seq:${event.seq}`
        scheduleAttention(`question:${callId}`, {
          kind: 'attention',
          sessionId,
          reason: 'question',
          question: clip(questionText(data.arguments), 200),
        }, 800)
      }
      return
    }
    if (event.type === 'tool/result') {
      const data = event.data
      const message = data !== null && typeof data === 'object' ? data.message : undefined
      const callId = message !== null && message !== undefined && typeof message === 'object' ? message.toolCallId : undefined
      if (typeof callId === 'string') cancelAttention(`question:${callId}`)
      return
    }
    if (event.type === 'turn/start') {
      const data = event.data
      const turn = data !== null && typeof data === 'object' ? data.turn : undefined
      turnStarts.set(sessionId, { at: Number(event.time) || Date.now(), turn })
      if (turnStarts.size > 200) {
        const oldest = turnStarts.keys().next()
        if (!oldest.done) turnStarts.delete(oldest.value)
      }
      return
    }
    if (event.type !== 'turn/end') return
    const data = event.data
    const reason = data !== null && typeof data === 'object' ? data.reason : undefined
    const kind = reason !== null && reason !== undefined && typeof reason.kind === 'string' ? reason.kind : 'completed'
    const started = turnStarts.get(sessionId)
    turnStarts.delete(sessionId)
    const durationMs = started !== undefined && Number.isFinite(event.time)
      ? Math.max(0, Number(event.time) - started.at)
      : 0
    if (kind === 'completed') {
      announce({ kind: 'done', sessionId, durationMs })
      return
    }
    if (kind === 'error') {
      lastErrors.set(sessionId, Date.now())
      announce({
        kind: 'error',
        sessionId,
        durationMs,
        reason: 'turn-error',
        message: errorText(reason.error),
      })
      return
    }
    if (kind === 'max-tokens') {
      announce({ kind: 'error', sessionId, durationMs, reason: 'max-tokens' })
      return
    }
    if (kind === 'blocked') {
      announce({ kind: 'attention', sessionId, reason: 'blocked' })
    }
  })

  // Errors outside a durable turn position still deserve the red toast; the
  // dedupe window keeps one failure from being announced twice.
  ctx.on('agent/error', payload => {
    if (payload === null || typeof payload !== 'object') return
    const agent = payload.agent
    const sessionId = agent !== null && agent !== undefined ? agent.id : undefined
    if (typeof sessionId !== 'string' || isSubagent(sessionId)) return
    const now = Date.now()
    const previous = lastErrors.get(sessionId)
    if (previous !== undefined && now - previous < ERROR_DEDUPE_MS) return
    lastErrors.set(sessionId, now)
    if (lastErrors.size > 500) lastErrors.clear()
    announce({ kind: 'error', sessionId, reason: 'agent-error', message: errorText(payload.error) })
  })

  /** Pending "a person must act" notices, cancelled when the interaction settles at once. */
  const attentionTimers = new Map()

  /** Announce an interaction only if it is still waiting after a short grace period. */
  function scheduleAttention(key, draft, delay) {
    cancelAttention(key)
    const timer = setTimeout(() => {
      attentionTimers.delete(key)
      announce({ ...draft, live: true })
    }, delay)
    attentionTimers.set(key, timer)
  }

  function cancelAttention(key) {
    const timer = attentionTimers.get(key)
    if (timer === undefined) return
    clearTimeout(timer)
    attentionTimers.delete(key)
  }

  ctx.effect(() => () => {
    for (const timer of attentionTimers.values()) clearTimeout(timer)
    attentionTimers.clear()
  }, 'notify: attention timers')

  // Approvals and questions are Agent-scoped waterfalls that a shipped answerer
  // claims, so an observer there sees nothing. Their durable audit events are a
  // reliable seam instead: `approval/asked` and the `ask_user_question` call are
  // committed when the person is actually asked.

  /** Records newer than one consumer cursor. */
  function collect(cursor) {
    const items = []
    for (const item of feed) if (item.id > cursor) items.push(item)
    return { items, cursor: sequence, reset: false, epoch }
  }

  /** Resolve after a delay with a fixed value; bounds a read that must not delay a notice. */
  function after(ms, value) {
    return new Promise(resolve => setTimeout(() => resolve(value), ms))
  }

  /** One committed event's payload, or an empty object when it cannot be read. */
  async function readEventData(query, sessionId, seq) {
    try {
      const window = await query.readEvent({ sessionId, seq, before: 0, after: 0 })
      const target = window !== null && typeof window === 'object' ? window.target : undefined
      const data = target !== null && typeof target === 'object' ? target.data : undefined
      return data !== null && typeof data === 'object' ? data : {}
    } catch {
      return {}
    }
  }

  /** The question text carried by an `ask_user_question` call's arguments. */
  function questionText(argumentsJson) {
    if (typeof argumentsJson !== 'string' || argumentsJson === '') return ''
    try {
      const parsed = JSON.parse(argumentsJson)
      const first = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.questions) ? parsed.questions[0] : undefined
      return first !== null && typeof first === 'object' && typeof first.question === 'string' ? first.question : ''
    } catch {
      return ''
    }
  }

  /**
   * Interactions a live Session is still waiting on, folded from its committed log.
   * A turn that already ended cannot be waiting, so only records after its last
   * `turn/end` count; a decision or a result settles the interaction.
   */
  async function scanPending() {
    const store = ctx.get('sessions')
    const query = ctx.get('sessionQuery')
    if (store === undefined || query === undefined) return []
    if (typeof store.list !== 'function' || typeof query.listEvents !== 'function') return []
    let sessions
    try {
      sessions = store.list()
    } catch {
      return []
    }
    const found = []
    for (const session of sessions) {
      const header = session === null || session === undefined ? undefined : session.header
      if (header === undefined || header === null || header.origin === 'subagent') continue
      try {
        const records = await query.listEvents(header.id)
        if (!Array.isArray(records)) continue
        let lastEnd = -1
        for (const record of records) {
          if (record !== null && record !== undefined && record.type === 'turn/end' && Number(record.seq) > lastEnd) {
            lastEnd = Number(record.seq)
          }
        }
        let approval
        for (const record of records) {
          if (record !== null && record !== undefined && record.type === 'approval/asked' && Number(record.seq) > lastEnd) {
            approval = record
          }
        }
        if (approval !== undefined) {
          const decided = records.some(record =>
            record !== null && record !== undefined
            && record.type === 'approval/decided'
            && Number(record.seq) > Number(approval.seq))
          if (!decided) {
            const detail = await readEventData(query, header.id, approval.seq)
            found.push({
              key: `approval:${String(detail.id ?? approval.seq)}`,
              kind: 'attention',
              sessionId: header.id,
              reason: 'approval',
              tool: clip(String(detail.toolName ?? ''), 60),
              at: Number(approval.time) || Date.now(),
            })
          }
        }
        let call
        for (const record of records) {
          if (record !== null && record !== undefined && record.type === 'tool/call' && Number(record.seq) > lastEnd) {
            call = record
          }
        }
        if (call !== undefined) {
          const detail = await readEventData(query, header.id, call.seq)
          const answered = records.some(record =>
            record !== null && record !== undefined
            && record.type === 'tool/result'
            && Number(record.seq) > Number(call.seq))
          if (!answered && detail.name === 'ask_user_question') {
            found.push({
              key: `question:${String(detail.callId ?? call.seq)}`,
              kind: 'attention',
              sessionId: header.id,
              reason: 'question',
              question: clip(questionText(detail.arguments), 200),
              at: Number(call.time) || Date.now(),
            })
          }
        }
      } catch {
        // One unreadable Session must not hide the others.
      }
    }
    return found
  }

  /** A reminder-as-record for an interaction that is still waiting. */
  async function pendingSnapshot() {
    const now = Date.now()
    if (now - pendingCache.at < PENDING_TTL_MS) return pendingCache.value
    let found = []
    try {
      found = await scanPending()
    } catch {
      found = []
    }
    const reminders = []
    for (const item of found) {
      let title = ''
      try {
        title = await Promise.race([readTitle(item.sessionId), after(TITLE_WAIT_MS, '')])
      } catch {
        title = ''
      }
      reminders.push({
        key: item.key,
        kind: 'attention',
        sessionId: item.sessionId,
        sessionTitle: title,
        reason: item.reason,
        tool: item.tool ?? '',
        question: item.question ?? '',
        message: '',
        durationMs: 0,
        at: item.at,
        reminder: true,
        sticky: true,
      })
    }
    pendingCache.at = Date.now()
    pendingCache.value = reminders
    return reminders
  }

  /** Whether a live notice already covered this pending interaction. */
  function announcedLive(item) {
    return liveAttentions.some(entry =>
      entry.sessionId === item.sessionId
      && entry.reason === item.reason
      && Math.abs(entry.at - item.at) < 15_000)
  }

  /** Publish one reminder for every interaction that is still waiting. */
  async function refreshPending() {
    let reminders = []
    try {
      reminders = await pendingSnapshot()
    } catch {
      return
    }
    for (const item of reminders) {
      if (publishedPending.has(item.key)) continue
      publishedPending.add(item.key)
      if (publishedPending.size > 500) publishedPending.clear()
      if (announcedLive(item)) continue
      publish({ ...item, reminder: true, sticky: true })
    }
  }

  /** Park until the next publish, the client leaves, the hold expires, or the plugin unloads. */
  function waitForChange(signal) {
    return new Promise(resolve => {
      let timer
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        waiters.delete(finish)
        if (timer !== undefined) clearTimeout(timer)
        if (signal !== undefined && signal !== null) signal.removeEventListener('abort', finish)
        lifetime.signal.removeEventListener('abort', finish)
        resolve()
      }
      waiters.add(finish)
      timer = setTimeout(finish, HOLD_MS)
      if (signal !== undefined && signal !== null && signal.aborted === true) {
        finish()
        return
      }
      if (signal !== undefined && signal !== null) signal.addEventListener('abort', finish, { once: true })
      lifetime.signal.addEventListener('abort', finish, { once: true })
    })
  }

  /** Serve one long-poll: baseline plus waiting interactions without a cursor, otherwise everything after it. */
  async function serve(request) {
    const url = new URL(request.url)
    const rawCursor = url.searchParams.get('cursor')
    if (rawCursor === null) {
      const pending = await pendingSnapshot()
      return jsonResponse({
        items: [],
        pending: pending.filter(item => !announcedLive(item)),
        cursor: sequence,
        reset: false,
        epoch,
      })
    }
    const cursor = Number(rawCursor)
    if (!Number.isFinite(cursor) || cursor < 0 || cursor > sequence) {
      return jsonResponse({ items: [], cursor: sequence, reset: true, epoch })
    }
    const oldest = feed.length > 0 ? feed[0].id : sequence + 1
    if (cursor > 0 && cursor < oldest - 1) {
      return jsonResponse({ items: [], cursor: sequence, reset: true, epoch })
    }
    let batch = collect(cursor)
    if (batch.items.length === 0 && url.searchParams.get('hold') !== '0') {
      await waitForChange(request.signal)
      batch = collect(cursor)
    }
    return jsonResponse(batch)
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: FEED_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: serve,
  }), 'notify: long-poll feed')

  // A page that was already open when an interaction started, or a notice the
  // live detection missed, still reaches the user: the sweep republishes every
  // interaction that is still waiting, once.
  ctx.effect(() => {
    let stopped = false
    let timer
    const tick = () => {
      if (stopped) return
      void refreshPending()
      timer = setTimeout(tick, 60_000)
    }
    timer = setTimeout(tick, 700)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, 'notify: pending sweep')
}
