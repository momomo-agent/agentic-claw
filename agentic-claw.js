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
 * Skills:
 *   const claw = createClaw({
 *     apiKey: 'sk-...',
 *     skills: [weatherSkill, searchSkill],
 *     skillConfig: { tavilyKey: '...' },
 *   })
 *
 * Via Agentic:
 *   const { Agentic } = require('agentic')
 *   const ai = new Agentic({ apiKey: 'sk-...' })
 *   const claw = ai.createClaw({ skills: [...] })
 *   await claw.chat('Hello')
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else if (typeof define === 'function' && define.amd) define(factory)
  else root.AgenticClaw = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // ── Optional sub-library loader ──────────────────────────────────
  // Tries require() first (Node), then globalThis (browser).
  // Returns null if not available — never throws.

  const _optCache = {}
  function optionalLoad(name, globalKey) {
    if (_optCache[name] !== undefined) return _optCache[name]
    let mod = null
    if (globalKey && typeof globalThis !== 'undefined' && globalThis[globalKey]) {
      mod = globalThis[globalKey]
    }
    if (!mod && typeof require === 'function') {
      try { mod = require(name) } catch {}
    }
    _optCache[name] = mod
    return mod
  }

  // ── Resolve dependencies ─────────────────────────────────────────

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
      },
    }
  }

  // ── Built-in skills ──────────────────────────────────────────────

  const builtinSkills = {
    calculate: {
      name: 'calculate',
      tools: [{
        name: 'calculate',
        description: 'Evaluate a mathematical expression. Supports +, -, *, /, ^, %, parentheses, and Math functions.',
        parameters: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Math expression (e.g. "125 * 0.85", "Math.sqrt(144)")' },
          },
          required: ['expression'],
        },
        execute: async (input) => {
          try {
            const expr = input.expression.replace(/\^/g, '**').replace(/(\d)%/g, '($1/100)')
            const result = new Function(`"use strict"; return (${expr})`)()
            if (typeof result !== 'number' || !isFinite(result)) return { error: 'Not a finite number', result: String(result) }
            return { expression: input.expression, result: Number(result.toPrecision(12)) }
          } catch (e) { return { error: e.message } }
        },
      }],
    },
  }

  function expandSkills(skills, skillConfig = {}) {
    const expanded = []
    const seen = new Set()
    for (const skill of skills) {
      if (!skill || !Array.isArray(skill.tools)) continue
      for (const tool of skill.tools) {
        if (typeof tool.requiresConfig === 'function' && !tool.requiresConfig(skillConfig)) continue
        if (seen.has(tool.name)) continue
        seen.add(tool.name)
        expanded.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: (input) => tool.execute(input, skillConfig),
        })
      }
    }
    return expanded
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
      skills = [],
      skillConfig = {},
      knowledge = false,
      embedProvider = 'local',
      embedApiKey = null,
      embedBaseUrl = null,
      persist = null,
      maxTokens = 8000,
      stream = true,
      providers = null,
    } = options

    if (!apiKey && (!providers || !providers.length)) throw new Error('apiKey is required')

    // Resolve skills
    const resolvedSkills = skills.map(s => {
      if (typeof s === 'string') {
        if (builtinSkills[s]) return builtinSkills[s]
        console.warn(`[claw] Unknown built-in skill: ${s}`)
        return null
      }
      return s
    }).filter(Boolean)

    const skillTools = expandSkills(resolvedSkills, skillConfig)
    const allTools = [...tools, ...skillTools]

    const { core, memory } = resolveDeps()
    if (!memory) throw new Error('agentic-memory not found. Install or include via <script>')

    const askFn = typeof agenticAsk === 'function' ? agenticAsk
      : core?.agenticAsk || core
    if (!askFn || typeof askFn !== 'function') {
      throw new Error('agentic-core not found. Install or include via <script>')
    }

    const events = createEventEmitter()
    const sessions = new Map()
    let _heartbeatInterval = null
    let _schedules = []

    // Shared knowledge
    const sharedKnowledgeOpts = knowledge ? {
      knowledge: true,
      embedProvider,
      embedApiKey,
      embedBaseUrl,
    } : {}

    let _sharedKnowledge = null
    if (knowledge) {
      _sharedKnowledge = memory.createMemory({
        maxTokens: 1000,
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

    // ── Persistence helpers ────────────────────────────────────────
    let _store = null
    function _getStore() {
      if (_store !== undefined && _store !== null) return _store
      if (!persist) { _store = null; return null }
      const storeMod = optionalLoad('agentic-store', 'AgenticStore')
      if (storeMod && storeMod.createStore) {
        _store = storeMod.createStore(persist)
      } else {
        _store = null
      }
      return _store
    }

    async function _persistHistory(sessionId, messages) {
      const store = _getStore()
      if (!store) return
      try { await store.kvSet('history:' + sessionId, JSON.stringify(messages)) } catch {}
    }

    async function _loadHistory(sessionId) {
      const store = _getStore()
      if (!store) return null
      try {
        const raw = await store.kvGet('history:' + sessionId)
        return raw ? JSON.parse(raw) : null
      } catch { return null }
    }

    // ── Token estimation ───────────────────────────────────────────
    function _estimateTokens(messages) {
      let chars = 0
      for (const m of messages) {
        chars += (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length) + 10
      }
      return Math.ceil(chars / 4) // ~4 chars per token
    }

    async function _compactIfNeeded(sessionMem) {
      const msgs = sessionMem.messages()
      const est = _estimateTokens(msgs)
      if (est <= maxTokens || msgs.length <= 4) return
      // Keep last 4 messages, summarize the rest
      const keepCount = 4
      const older = msgs.slice(0, msgs.length - keepCount)
      const recent = msgs.slice(msgs.length - keepCount)
      const summaryText = older.map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 200) : '[complex]'}`).join('\n')
      const summary = { role: 'system', content: `[Conversation summary]\n${summaryText.slice(0, maxTokens)}` }
      sessionMem.clear()
      await sessionMem.user(summary.content)
      // Re-add recent messages
      for (const m of recent) {
        if (m.role === 'user') await sessionMem.user(m.content)
        else if (m.role === 'assistant') await sessionMem.assistant(m.content)
      }
    }

    // ── Build askFn config ─────────────────────────────────────────
    function _buildAskConfig(sessionMem, chatOpts) {
      let sys = systemPrompt || ''
      return {
        provider,
        apiKey,
        baseUrl: baseUrl || undefined,
        model: model || undefined,
        proxyUrl: proxyUrl || undefined,
        history: sessionMem.history(),
        system: sys || undefined,
        tools: chatOpts.tools || allTools,
        stream,
        ...(providers ? { providers } : {}),
        ...(chatOpts.signal ? { signal: chatOpts.signal } : {}),
        ...(chatOpts.searchApiKey ? { searchApiKey: chatOpts.searchApiKey } : {}),
      }
    }

    // ── Knowledge context ──────────────────────────────────────────
    async function _appendKnowledge(input, config) {
      if (!_sharedKnowledge) return
      try {
        const results = await _sharedKnowledge.recall(input, { topK: 3 })
        if (results.length > 0) {
          const ctx = '\n\nRelevant knowledge:\n' + results.map(r => `- ${r.chunk}`).join('\n')
          config.system = (config.system || '') + ctx
        }
      } catch (e) {
        events.emit('error', e)
      }
    }

    // ── Chat (dual mode) ──────────────────────────────────────────
    function _chat(sessionMem, input, emitOrOpts, maybeEmit) {
      let chatOpts = {}
      let emit
      if (typeof emitOrOpts === 'function') {
        emit = emitOrOpts
      } else if (emitOrOpts && typeof emitOrOpts === 'object') {
        chatOpts = emitOrOpts
        emit = maybeEmit
      }

      // If emit callback provided → legacy Promise mode (returns Promise)
      if (emit) {
        return _chatLegacy(sessionMem, input, chatOpts, emit)
      }
      // Otherwise → return thenable async generator
      // This allows both: for await (const e of claw.chat(...)) AND await claw.chat(...)
      return _chatThenableGen(sessionMem, input, chatOpts)
    }

    // Wraps the async generator so it's also thenable (backward compat with await)
    function _chatThenableGen(sessionMem, input, chatOpts) {
      const gen = _chatGenerator(sessionMem, input, chatOpts)
      const wrapper = {
        [Symbol.asyncIterator]() { return gen },
        then(resolve, reject) {
          // Consume the generator, return final result
          return (async () => {
            let lastDone = null
            for await (const event of gen) {
              if (event.type === 'done') lastDone = event
            }
            if (lastDone) {
              return { answer: lastDone.answer, rounds: lastDone.rounds, messages: sessionMem.messages() }
            }
            return { answer: '', rounds: 0, messages: sessionMem.messages() }
          })().then(resolve, reject)
        },
      }
      return wrapper
    }

    // Legacy emit mode (backward compat)
    async function _chatLegacy(sessionMem, input, chatOpts, emit) {
      events.emit('message', { role: 'user', content: input })
      await sessionMem.user(input)
      await _compactIfNeeded(sessionMem)

      const config = _buildAskConfig(sessionMem, chatOpts)
      await _appendKnowledge(input, config)

      const emitFn = (event, data) => {
        if (emit) emit(event, data)
        if (event === 'token') events.emit('token', data)
        if (event === 'status') events.emit('status', data)
        if (event === 'tool_call') events.emit('tool_call', data)
      }

      try {
        const result = await askFn(input, config, emitFn)
        const answer = result.answer || result.content || ''
        await sessionMem.assistant(answer)
        events.emit('message', { role: 'assistant', content: answer })
        await _persistHistory(sessionMem.id || 'default', sessionMem.messages())
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

    // Generator mode — yields ChatEvent
    async function* _chatGenerator(sessionMem, input, chatOpts) {
      events.emit('message', { role: 'user', content: input })
      await sessionMem.user(input)
      await _compactIfNeeded(sessionMem)

      const config = _buildAskConfig(sessionMem, chatOpts)
      await _appendKnowledge(input, config)

      try {
        const result = askFn(input, config) // no emit → generator (or legacy Promise)

        // Handle legacy askFn that returns a Promise instead of AsyncGenerator
        if (result && typeof result.then === 'function' && !result[Symbol.asyncIterator]) {
          const resolved = await result
          const answer = resolved.answer || resolved.content || ''
          if (answer) events.emit('token', { text: answer })
          await sessionMem.assistant(answer)
          events.emit('message', { role: 'assistant', content: answer })
          await _persistHistory(sessionMem.id || 'default', sessionMem.messages())
          yield { type: 'text_delta', text: answer }
          yield { type: 'done', answer, rounds: resolved.rounds || 1, messages: sessionMem.messages() }
          return
        }

        for await (const event of result) {
          // Forward events to claw event emitter
          if (event.type === 'text_delta') events.emit('token', { text: event.text })
          else if (event.type === 'status') events.emit('status', event)
          else if (event.type === 'tool_use') events.emit('tool_call', event)

          yield event

          if (event.type === 'done') {
            const answer = event.answer || ''
            await sessionMem.assistant(answer)
            events.emit('message', { role: 'assistant', content: answer })
            await _persistHistory(sessionMem.id || 'default', sessionMem.messages())
          }
        }
      } catch (error) {
        events.emit('error', error)
        throw error
      }
    }

    // ── Retry ─────────────────────────────────────────────────────
    async function* _retry(sessionMem, chatOpts = {}) {
      const msgs = sessionMem.messages()
      if (msgs.length === 0) {
        yield { type: 'error', error: 'No messages to retry', category: 'usage', retryable: false }
        return
      }
      // Find last user message, remove everything after it (the assistant reply)
      let lastUserIdx = -1
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { lastUserIdx = i; break }
      }
      if (lastUserIdx === -1) {
        yield { type: 'error', error: 'No user message to retry', category: 'usage', retryable: false }
        return
      }
      const lastUserMsg = msgs[lastUserIdx].content
      // Remove assistant messages after last user message
      // We rebuild memory: clear and re-add up to (and excluding) the last user msg
      const keep = msgs.slice(0, lastUserIdx)
      sessionMem.clear()
      for (const m of keep) {
        if (m.role === 'user') await sessionMem.user(m.content)
        else if (m.role === 'assistant') await sessionMem.assistant(m.content)
      }
      // Re-send the last user message through the generator path
      yield* _chatGenerator(sessionMem, lastUserMsg, chatOpts)
    }

    const defaultSession = _getSession('default')

    // ── Sub-library instances (lazy-initialized) ──────────────────
    let _storeSub, _fs, _shell, _act, _render, _sense, _spatial, _embed, _voice

    const claw = {
      /** Chat — send a message, get a response (or async generator if no emit) */
      chat(input, optsOrEmit, maybeEmit) {
        return _chat(defaultSession, input, optsOrEmit, maybeEmit)
      },

      /** Retry last assistant turn on default session */
      retry(opts) {
        return _retry(defaultSession, opts)
      },

      /** Create/get a named session */
      session(id) {
        const mem = _getSession(id)
        return {
          chat(input, optsOrEmit, maybeEmit) { return _chat(mem, input, optsOrEmit, maybeEmit) },
          retry(opts) { return _retry(mem, opts) },
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

      /** Add a skill at runtime */
      use(skill) {
        const s = typeof skill === 'string' ? builtinSkills[skill] : skill
        if (!s || !Array.isArray(s.tools)) {
          console.warn('[claw] Invalid skill:', skill)
          return this
        }
        resolvedSkills.push(s)
        const fresh = expandSkills(resolvedSkills, skillConfig)
        allTools.length = tools.length
        allTools.push(...fresh)
        return this
      },

      /** List registered skills */
      listSkills() {
        return resolvedSkills.map(s => ({ name: s.name, tools: s.tools.map(t => t.name) }))
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

      /** Warmup: pre-heat connection + prompt cache */
      async warmup() {
        const warmupFn = core?.warmup || (typeof warmup === 'function' ? warmup : null)
        if (!warmupFn) {
          console.warn('[claw] warmup not available in agentic-core')
          return { ok: false, reason: 'not_available' }
        }
        return warmupFn({
          provider,
          apiKey,
          baseUrl,
          model,
          system: systemPrompt,
          tools: allTools,
          proxyUrl,
          providers,
        })
      },

      /** List active sessions */
      sessions() { return [...sessions.keys()] },

      /** Get default memory instance */
      get memory() { return defaultSession },

      /** Get knowledge info */
      knowledgeInfo() {
        return _sharedKnowledge ? _sharedKnowledge.knowledgeInfo() : null
      },

      // ── Sub-library accessors (lazy-loaded) ────────────────────

      /** KV store — get/set/delete/keys/has/clear */
      get store() {
        if (_storeSub) return _storeSub
        const mod = optionalLoad('agentic-store', 'AgenticStore')
        if (!mod) return null
        _storeSub = mod.createStore({ backend: 'sqlite' })
        _storeSub.init()
        return _storeSub
      },

      /** File system — read/write/ls/tree/grep/delete */
      get fs() {
        if (_fs) return _fs
        const mod = optionalLoad('agentic-filesystem', 'AgenticFileSystem')
        if (!mod) return null
        const Backend = mod.NodeFsBackend || mod.MemoryStorage
        _fs = new mod.AgenticFileSystem(Backend ? new Backend() : undefined)
        return _fs
      },

      /** Shell — exec/jobs */
      get shell() {
        if (_shell) return _shell
        const mod = optionalLoad('agentic-shell', 'AgenticShell')
        if (!mod) return null
        _shell = new mod.AgenticShell()
        return _shell
      },

      /** Act — AI decision + action */
      get act() {
        if (_act) return _act
        const mod = optionalLoad('agentic-act', 'AgenticAct')
        if (!mod) return null
        _act = {
          decide: (input, opts = {}) => new mod.AgenticAct({ apiKey, model, baseUrl, ...opts }).decide(input),
          run: (input, opts = {}) => new mod.AgenticAct({ apiKey, model, baseUrl, ...opts }).run(input),
        }
        return _act
      },

      /** Render — markdown to HTML */
      get render() {
        if (_render) return _render
        const mod = optionalLoad('agentic-render', 'AgenticRender')
        if (!mod) return null
        _render = {
          html: (markdown, opts = {}) => mod.render(markdown, opts),
          css: (theme) => mod.getCSS(theme === 'dark' ? mod.THEME_DARK : mod.THEME_LIGHT),
          THEME_DARK: mod.THEME_DARK,
          THEME_LIGHT: mod.THEME_LIGHT,
        }
        return _render
      },

      /** Sense — audio VAD, frame extraction */
      get sense() {
        if (_sense) return _sense
        const mod = optionalLoad('agentic-sense', 'AgenticSense')
        if (!mod) return null
        _sense = {
          Audio: mod.AgenticAudio,
          extractFrame: mod.extractFrame,
          Sense: mod.AgenticSense,
        }
        return _sense
      },

      /** Spatial — 3D spatial reasoning */
      get spatial() {
        if (_spatial) return _spatial
        const mod = optionalLoad('agentic-spatial', 'AgenticSpatial')
        if (!mod) return null
        _spatial = {
          reconstruct: (opts) => mod.reconstructSpace({ apiKey, model, baseUrl, ...opts }),
          Session: mod.SpatialSession,
          createSession: (opts = {}) => new mod.SpatialSession({ apiKey, model, baseUrl, ...opts }),
        }
        return _spatial
      },

      /** Embed — vector embeddings + search */
      get embed() {
        if (_embed) return _embed
        const mod = optionalLoad('agentic-embed', 'AgenticEmbed')
        if (!mod) return null
        _embed = {
          create: (opts) => mod.create(opts),
          chunkText: mod.chunkText,
          localEmbed: mod.localEmbed,
          cosineSimilarity: mod.cosineSimilarity,
        }
        return _embed
      },

      /** Voice — TTS + STT */
      get voice() {
        if (_voice) return _voice
        const mod = optionalLoad('agentic-voice', 'AgenticVoice')
        if (!mod) return null
        _voice = {
          createTTS: (opts = {}) => mod.createTTS({ apiKey, baseUrl, ...opts }),
          createSTT: (opts = {}) => mod.createSTT(opts),
          createVoice: (opts = {}) => mod.createVoice({ apiKey, baseUrl, ...opts }),
        }
        return _voice
      },

      /** List available sub-libraries */
      capabilities() {
        return {
          core: true,
          memory: true,
          store: !!optionalLoad('agentic-store'),
          filesystem: !!optionalLoad('agentic-filesystem'),
          shell: !!optionalLoad('agentic-shell'),
          act: !!optionalLoad('agentic-act'),
          render: !!optionalLoad('agentic-render'),
          sense: !!optionalLoad('agentic-sense'),
          spatial: !!optionalLoad('agentic-spatial'),
          embed: !!optionalLoad('agentic-embed'),
          voice: !!optionalLoad('agentic-voice'),
        }
      },

      /** Destroy — cleanup intervals and storage */
      destroy() {
        if (_heartbeatInterval) clearInterval(_heartbeatInterval)
        for (const id of _schedules) clearInterval(id)
        _schedules = []
        for (const [, mem] of sessions) mem.destroy()
        sessions.clear()
        if (_sharedKnowledge) _sharedKnowledge.destroy()
        if (_storeSub && _storeSub.close) _storeSub.close()
        _storeSub = _fs = _shell = _act = _render = _sense = _spatial = _embed = _voice = null
      },
    }

    return claw
  }

  return { createClaw, builtinSkills, expandSkills }
})
