/**
 * agentic-claw — AI agent runtime
 * Wire up agentic-core + agentic-memory into a living agent.
 *
 * Usage:
 *   const { createClaw } = require('agentic-claw')
 *   const claw = createClaw({ apiKey: 'sk-...' })
 *   const answer = await claw.chat('Hello')
 *
 * Multi-session:
 *   const s1 = claw.session('alice')
 *   const s2 = claw.session('bob')
 *   await s1.chat('Hi')  // isolated conversation
 *
 * Browser:
 *   <script src="agentic-core/agentic-agent.js"></script>
 *   <script src="agentic-memory/memory.js"></script>
 *   <script src="agentic-claw/claw.js"></script>
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.AgenticClaw = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // ── Resolve dependencies ─────────────────────────────────────────
  // In browser: globals (AgenticAgent, AgenticMemory)
  // In Node: require peer dependencies

  function resolveDeps() {
    let core, memory
    if (typeof globalThis !== 'undefined') {
      core = globalThis.AgenticAgent || globalThis.agenticAsk
      memory = globalThis.AgenticMemory
    }
    if (!core && typeof require === 'function') {
      try { core = require('agentic-core') } catch {}
    }
    if (!memory && typeof require === 'function') {
      try { memory = require('agentic-memory') } catch {}
    }
    return { core, memory }
  }

  // ── Event emitter ────────────────────────────────────────────────

  function createEventEmitter() {
    const listeners = {}
    return {
      on(event, fn) {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(fn)
        return this
      },
      off(event, fn) {
        if (!listeners[event]) return this
        listeners[event] = listeners[event].filter(f => f !== fn)
        return this
      },
      emit(event, ...args) {
        if (listeners[event]) {
          for (const fn of listeners[event]) {
            try { fn(...args) } catch (e) { console.error(`[claw] event error:`, e) }
          }
        }
      }
    }
  }

  // ── createClaw ───────────────────────────────────────────────────

  function createClaw(options = {}) {
    const {
      apiKey,
      provider = 'anthropic',
      baseUrl = null,
      model = null,
      proxyUrl = null,
      systemPrompt = null,
      tools = [],
      knowledge = false,
      embedProvider = 'local',
      embedApiKey = null,
      embedBaseUrl = null,
      persist = null,
      maxTokens = 8000,
      stream = true,
    } = options

    if (!apiKey) throw new Error('apiKey is required')

    const { core, memory } = resolveDeps()
    if (!memory) throw new Error('agentic-memory not found. Install or include via <script>')

    // The agenticAsk function — could be global or from core module
    const askFn = typeof agenticAsk === 'function' ? agenticAsk
      : core?.agenticAsk || core
    if (!askFn || typeof askFn !== 'function') {
      throw new Error('agentic-core not found. Install or include via <script>')
    }

    const events = createEventEmitter()
    const sessions = new Map()
    let _heartbeatInterval = null
    let _schedules = []

    // Shared knowledge store (across all sessions)
    const sharedKnowledgeOpts = knowledge ? {
      knowledge: true,
      embedProvider,
      embedApiKey,
      embedBaseUrl,
    } : {}

    // Shared knowledge memory instance (for learn/recall/forget)
    let _sharedKnowledge = null
    if (knowledge) {
      _sharedKnowledge = memory.createMemory({
        maxTokens: 1000, // minimal — we only use knowledge features
        ...sharedKnowledgeOpts,
        storage: persist ? (persist + ':knowledge') : null,
      })
    }

    function _createSessionMemory(sessionId) {
      return memory.createMemory({
        maxTokens,
        systemPrompt,
        storage: persist ? (persist + ':' + sessionId) : null,
        id: sessionId,
      })
    }

    function _getSession(sessionId) {
      if (sessions.has(sessionId)) return sessions.get(sessionId)
      const mem = _createSessionMemory(sessionId)
      sessions.set(sessionId, mem)
      return mem
    }

    async function _chat(sessionMem, input, emitOrOpts, maybeEmit) {
      // Support: _chat(mem, input, emit) or _chat(mem, input, opts, emit)
      let chatOpts = {}
      let emit
      if (typeof emitOrOpts === 'function') {
        emit = emitOrOpts
      } else if (emitOrOpts && typeof emitOrOpts === 'object') {
        chatOpts = emitOrOpts
        emit = maybeEmit
      }

      events.emit('message', { role: 'user', content: input })

      // Store user message
      await sessionMem.user(input)

      // Recall relevant knowledge
      let knowledgeContext = ''
      if (_sharedKnowledge) {
        try {
          const results = await _sharedKnowledge.recall(input, { topK: 3 })
          if (results.length > 0) {
            knowledgeContext = '\n\nRelevant knowledge:\n' +
              results.map(r => `- ${r.chunk}`).join('\n')
          }
        } catch (e) {
          events.emit('error', e)
        }
      }

      // Build system prompt with knowledge
      let sys = systemPrompt || ''
      if (knowledgeContext) sys += knowledgeContext

      // Call LLM via agentic-core
      const emitFn = (event, data) => {
        if (emit) emit(event, data)
        if (event === 'token') events.emit('token', data)
        if (event === 'status') events.emit('status', data)
        if (event === 'tool_call') events.emit('tool_call', data)
      }

      try {
        const result = await askFn(input, {
          provider,
          apiKey,
          baseUrl: baseUrl || undefined,
          model: model || undefined,
          proxyUrl: proxyUrl || undefined,
          history: sessionMem.history(),
          system: sys || undefined,
          tools: chatOpts.tools || tools,
          stream,
          ...chatOpts.searchApiKey ? { searchApiKey: chatOpts.searchApiKey } : {},
        }, emitFn)

        const answer = result.answer || result.content || ''

        // Store assistant response
        await sessionMem.assistant(answer)

        events.emit('message', { role: 'assistant', content: answer })

        return {
          answer,
          rounds: result.rounds || 1,
          data: result.data || null,
          messages: sessionMem.messages(),
        }
      } catch (error) {
        events.emit('error', error)
        throw error
      }
    }

    // Default session
    const defaultSession = _getSession('default')

    const claw = {
      /** Chat — send a message, get a response. Options: { tools, searchApiKey } */
      async chat(input, optsOrEmit, maybeEmit) {
        return _chat(defaultSession, input, optsOrEmit, maybeEmit)
      },

      /** Create/get a named session */
      session(id) {
        const mem = _getSession(id)
        return {
          async chat(input, optsOrEmit, maybeEmit) { return _chat(mem, input, optsOrEmit, maybeEmit) },
          memory: mem,
          id,
        }
      },

      /** Learn — add to shared knowledge base */
      async learn(id, text, metadata = {}) {
        if (!_sharedKnowledge) throw new Error('Knowledge not enabled. Use createClaw({ knowledge: true })')
        await _sharedKnowledge.learn(id, text, metadata)
        return this
      },

      /** Recall — search shared knowledge */
      async recall(query, options = {}) {
        if (!_sharedKnowledge) throw new Error('Knowledge not enabled')
        return _sharedKnowledge.recall(query, options)
      },

      /** Forget — remove from knowledge base */
      async forget(id) {
        if (!_sharedKnowledge) throw new Error('Knowledge not enabled')
        await _sharedKnowledge.forget(id)
        return this
      },

      /** Register heartbeat callback */
      heartbeat(fn, intervalMs = 60000) {
        if (_heartbeatInterval) clearInterval(_heartbeatInterval)
        _heartbeatInterval = setInterval(() => {
          try { fn() } catch (e) { events.emit('error', e) }
        }, intervalMs)
        return this
      },

      /** Schedule a task */
      schedule(pattern, fn) {
        // Simple interval-based scheduling
        // pattern: number (ms) or string like '5m', '1h', '30s'
        let ms
        if (typeof pattern === 'number') {
          ms = pattern
        } else if (typeof pattern === 'string') {
          const match = pattern.match(/^(\d+)(s|m|h|d)$/)
          if (match) {
            const [, n, unit] = match
            const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
            ms = parseInt(n) * multipliers[unit]
          }
        }
        if (!ms) throw new Error('Invalid schedule pattern. Use number (ms) or "5m", "1h", etc.')

        const id = setInterval(() => {
          try { fn() } catch (e) { events.emit('error', e) }
        }, ms)
        _schedules.push(id)
        return this
      },

      /** Event listeners */
      on(event, fn) { events.on(event, fn); return this },
      off(event, fn) { events.off(event, fn); return this },

      /** List active sessions */
      sessions() {
        return [...sessions.keys()]
      },

      /** Get default memory instance */
      get memory() { return defaultSession },

      /** Get knowledge info */
      knowledgeInfo() {
        return _sharedKnowledge ? _sharedKnowledge.knowledgeInfo() : null
      },

      /** Destroy — cleanup intervals and storage */
      destroy() {
        if (_heartbeatInterval) clearInterval(_heartbeatInterval)
        for (const id of _schedules) clearInterval(id)
        _schedules = []
        for (const [, mem] of sessions) mem.destroy()
        sessions.clear()
        if (_sharedKnowledge) _sharedKnowledge.destroy()
      },
    }

    return claw
  }

  return { createClaw }
})
