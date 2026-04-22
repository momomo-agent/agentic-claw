/**
 * test-claw-conductor.js — Full integration test: Claw + Conductor
 *
 * Tests all Claw features (session, memory, knowledge, skills, events, lifecycle)
 * and Conductor integration (single mode, dispatch mode, dependencies, scheduling).
 */

// ── Mock dependencies ──────────────────────────────────────────

let mockAskCalls = []
let mockAskResult = { answer: 'mock answer', rounds: 1 }
globalThis.agenticAsk = async function mockAsk(input, config, emit) {
  mockAskCalls.push({ input, config, emit })
  if (emit) emit('token', { text: mockAskResult.answer })
  return mockAskResult
}

const AgenticMemory = require('./node_modules/agentic-memory/memory.js')
globalThis.AgenticMemory = AgenticMemory

const { createClaw, builtinSkills, expandSkills } = require('./agentic-claw.js')

let passed = 0, failed = 0, total = 0
function assert(cond, msg) {
  total++
  if (cond) { passed++; console.log(`  ✅ ${msg}`) }
  else { failed++; console.error(`  ❌ ${msg}`) }
}

function resetMock() {
  mockAskCalls = []
  mockAskResult = { answer: 'mock answer', rounds: 1 }
}

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Test Suite: Claw + Conductor Integration')
  console.log('═══════════════════════════════════════════════════\n')

  // ═══════════════════════════════════════════════════════════════
  // 1. Basic creation
  // ═══════════════════════════════════════════════════════════════

  console.log('--- 1. Basic creation ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })
    assert(typeof claw.chat === 'function', 'chat() exists')
    assert(typeof claw.session === 'function', 'session() exists')
    assert(typeof claw.on === 'function', 'on() exists')
    assert(typeof claw.destroy === 'function', 'destroy() exists')
    assert(claw.conductor !== undefined, 'conductor property exists')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. Missing apiKey throws
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 2. Missing apiKey throws ---')
  {
    let threw = false
    try { createClaw({}) } catch { threw = true }
    assert(threw, 'Throws on missing apiKey')
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. Single mode chat (default)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 3. Single mode chat ---')
  {
    resetMock()
    mockAskResult = { answer: 'hello back', rounds: 1 }
    const claw = createClaw({ apiKey: 'test-key' })

    const result = await claw.chat('hello')
    assert(result.answer === 'hello back', 'Returns correct answer')
    assert(Array.isArray(result.messages), 'Returns messages array')
    assert(mockAskCalls.length === 1, 'Called askFn once')
    assert(mockAskCalls[0].input === 'hello', 'Passed correct input')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. Config passthrough
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 4. Config passthrough ---')
  {
    resetMock()
    const claw = createClaw({
      apiKey: 'my-key', provider: 'openai', model: 'gpt-4',
      baseUrl: 'https://custom.api', systemPrompt: 'Be helpful.',
    })
    await claw.chat('test')
    const cfg = mockAskCalls[0].config
    assert(cfg.apiKey === 'my-key', 'apiKey passed')
    assert(cfg.provider === 'openai', 'provider passed')
    assert(cfg.model === 'gpt-4', 'model passed')
    assert(cfg.baseUrl === 'https://custom.api', 'baseUrl passed')
    assert(cfg.system.includes('Be helpful'), 'systemPrompt passed')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. Session management
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 5. Session management ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })

    const alice = claw.session('alice')
    const bob = claw.session('bob')
    assert(alice.id === 'alice', 'Session alice created')
    assert(bob.id === 'bob', 'Session bob created')

    // Reuse
    const alice2 = claw.session('alice')
    assert(alice.memory === alice2.memory, 'Same session reused')

    // List
    const ids = claw.sessions()
    assert(ids.includes('default'), 'default session exists')
    assert(ids.includes('alice'), 'alice in session list')
    assert(ids.includes('bob'), 'bob in session list')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. Session isolation
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 6. Session isolation ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })

    const alice = claw.session('alice')
    const bob = claw.session('bob')
    await alice.chat('I am Alice')
    await bob.chat('I am Bob')

    const aHist = alice.memory.history()
    const bHist = bob.memory.history()
    assert(aHist.some(m => m.content === 'I am Alice'), 'Alice has her message')
    assert(!aHist.some(m => m.content === 'I am Bob'), 'Alice does not have Bob message')
    assert(bHist.some(m => m.content === 'I am Bob'), 'Bob has his message')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. Conversation history
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 7. Conversation history ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })
    await claw.chat('first')
    await claw.chat('second')
    assert(mockAskCalls.length === 2, 'Two calls made')
    const hist = mockAskCalls[1].config.history
    assert(hist.length >= 2, 'Second call has history from first')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 8. Events
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 8. Events ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })
    const events = []
    claw.on('message', (msg) => events.push(msg))
    claw.on('token', (data) => events.push({ type: 'token', ...data }))

    await claw.chat('hello')
    assert(events.some(e => e.role === 'user'), 'User message event')
    assert(events.some(e => e.role === 'assistant'), 'Assistant message event')
    assert(events.some(e => e.type === 'token'), 'Token event')

    // off()
    const count = events.length
    const handler = () => events.push('extra')
    claw.on('message', handler)
    claw.off('message', handler)
    await claw.chat('again')
    // 'extra' should not appear
    assert(!events.includes('extra'), 'off() removes listener')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. Emit callback
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 9. Emit callback ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })
    const tokens = []
    await claw.chat('hello', (event, data) => {
      if (event === 'token') tokens.push(data.text)
    })
    assert(tokens.length > 0, 'Emit callback receives tokens')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. Per-call options
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 10. Per-call options ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })
    await claw.chat('hello', { tools: ['custom_tool'] }, () => {})
    const cfg = mockAskCalls[0].config
    assert(cfg.tools.includes('custom_tool'), 'Per-call tools passed')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 11. Knowledge (learn/recall/forget)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 11. Knowledge ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key', knowledge: true })

    await claw.learn('physics', 'Quantum computing uses qubits')
    await claw.learn('ml', 'Neural networks are brain-inspired')

    const results = await claw.recall('quantum')
    assert(results.length > 0, 'recall() finds learned content')
    assert(results.some(r => r.id === 'physics'), 'Finds physics doc')

    await claw.forget('physics')
    const after = await claw.recall('quantum qubits')
    assert(!after.some(r => r.id === 'physics'), 'forget() removes doc')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 12. Knowledge disabled throws
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 12. Knowledge disabled ---')
  {
    const claw = createClaw({ apiKey: 'test-key' })
    let threw = false
    try { await claw.learn('x', 'y') } catch { threw = true }
    assert(threw, 'learn() throws when knowledge disabled')
    assert(claw.knowledgeInfo() === null, 'knowledgeInfo() returns null')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 13. Skills
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 13. Skills ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key', skills: ['calculate'] })
    const skills = claw.listSkills()
    assert(skills.length === 1, 'One skill registered')
    assert(skills[0].name === 'calculate', 'Calculate skill loaded')
    assert(skills[0].tools.includes('calculate'), 'Calculate tool available')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 14. Runtime skill addition
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 14. Runtime skill addition ---')
  {
    const claw = createClaw({ apiKey: 'test-key' })
    assert(claw.listSkills().length === 0, 'No skills initially')

    claw.use('calculate')
    assert(claw.listSkills().length === 1, 'Skill added at runtime')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 15. Heartbeat
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 15. Heartbeat ---')
  {
    const claw = createClaw({ apiKey: 'test-key' })
    let fired = 0
    claw.heartbeat(() => { fired++ }, 30)
    await new Promise(r => setTimeout(r, 100))
    assert(fired >= 2, `Heartbeat fired ${fired} times (expected >=2)`)
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 16. Schedule
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 16. Schedule ---')
  {
    const claw = createClaw({ apiKey: 'test-key' })
    let count = 0
    claw.schedule(30, () => { count++ })
    await new Promise(r => setTimeout(r, 100))
    assert(count >= 2, `Schedule fired ${count} times (expected >=2)`)

    // String patterns
    let ok = true
    try {
      claw.schedule('1s', () => {})
      claw.schedule('5m', () => {})
    } catch { ok = false }
    assert(ok, 'String schedule patterns accepted')

    // Invalid
    let threw = false
    try { claw.schedule('bad', () => {}) } catch { threw = true }
    assert(threw, 'Invalid pattern throws')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 17. Destroy cleanup
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 17. Destroy cleanup ---')
  {
    const claw = createClaw({ apiKey: 'test-key' })
    let hCount = 0, sCount = 0
    claw.heartbeat(() => { hCount++ }, 20)
    claw.schedule(20, () => { sCount++ })
    claw.destroy()
    const h = hCount, s = sCount
    await new Promise(r => setTimeout(r, 80))
    assert(hCount === h, 'Heartbeat stopped after destroy')
    assert(sCount === s, 'Schedule stopped after destroy')
  }

  // ═══════════════════════════════════════════════════════════════
  // 18. Memory access
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 18. Memory access ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })
    assert(claw.memory !== undefined, 'memory property exists')
    assert(typeof claw.memory.messages === 'function', 'memory.messages() exists')

    await claw.chat('hello')
    const info = claw.memory.info()
    assert(info.messageCount > 0, 'Messages stored in memory')

    claw.memory.clear()
    assert(claw.memory.info().messageCount === 0, 'Memory cleared')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 19. Conductor — single mode (default)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 19. Conductor single mode ---')
  {
    resetMock()
    const claw = createClaw({ apiKey: 'test-key' })
    assert(claw.conductor !== null, 'Conductor exists')

    const state = claw.conductor.getState()
    assert(state.strategy === 'single', 'Default strategy is single')
    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 20. Conductor — dispatch mode
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 20. Conductor dispatch mode ---')
  {
    resetMock()
    mockAskResult = {
      answer: `I'll search for that.\n\`\`\`intents\n[{"action":"create","goal":"Search AI news"}]\n\`\`\``,
    }
    const spawned = []
    const claw = createClaw({
      apiKey: 'test-key',
      conductor: 'dispatch',
      dispatchMode: 'code',
      onWorkerStart: (task, abort, opts) => {
        spawned.push({ task, opts })
        return new Promise(() => {})
      },
    })

    assert(claw.conductor.getState().strategy === 'dispatch', 'Strategy is dispatch')

    const result = await claw.chat('search AI news')
    assert(result.answer.includes("I'll search"), 'Reply preserved')
    assert(result.intents.length === 1, 'One intent created')
    assert(result.intents[0].goal === 'Search AI news', 'Intent goal correct')

    await new Promise(r => setTimeout(r, 50))
    assert(spawned.length === 1, 'Worker spawned')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 21. Conductor — dependencies in dispatch mode
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 21. Conductor dependencies ---')
  {
    resetMock()
    mockAskResult = {
      answer: `On it.\n\`\`\`intents\n[{"action":"create","goal":"Search"},{"action":"create","goal":"Report","dependsOn":["intent-1"]}]\n\`\`\``,
    }
    const spawned = []
    const claw = createClaw({
      apiKey: 'test-key',
      conductor: 'dispatch',
      dispatchMode: 'code',
      onWorkerStart: (task, abort, opts) => {
        spawned.push({ task, opts })
        return new Promise(() => {})
      },
    })

    await claw.chat('search then report')
    await new Promise(r => setTimeout(r, 50))
    assert(spawned.length === 1, 'Only first worker spawned')
    assert(spawned[0].task.includes('Search'), 'First is search')

    // Complete first worker
    claw.conductor.completeWorker(spawned[0].opts.workerId, { summary: 'Done searching' })
    await new Promise(r => setTimeout(r, 50))
    assert(spawned.length === 2, 'Second worker spawned after dep done')
    assert(spawned[1].task.includes('Report'), 'Second is report')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 22. Conductor — cancel intent
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 22. Conductor cancel ---')
  {
    resetMock()
    const claw = createClaw({
      apiKey: 'test-key',
      conductor: 'dispatch',
      dispatchMode: 'code',
      onWorkerStart: () => new Promise(() => {}),
    })

    claw.conductor.createIntent('Background task')
    await new Promise(r => setTimeout(r, 50))
    assert(claw.conductor.getIntents().length === 1, 'Intent created')

    claw.conductor.cancelIntent('intent-1')
    const intents = claw.conductor.getIntents()
    assert(intents[0].status === 'cancelled', 'Intent cancelled')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 23. Conductor — turn management
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 23. Conductor turn management ---')
  {
    resetMock()
    let workerOpts = null
    const claw = createClaw({
      apiKey: 'test-key',
      conductor: 'dispatch',
      dispatchMode: 'code',
      onWorkerStart: (task, abort, opts) => {
        workerOpts = opts
        return new Promise(() => {})
      },
    })

    claw.conductor.createIntent('Turn test')
    await new Promise(r => setTimeout(r, 50))
    assert(workerOpts !== null, 'Worker started')

    const pre = claw.conductor.beforeTurn(workerOpts.workerId)
    assert(pre.action === 'continue', 'beforeTurn → continue')

    const post = claw.conductor.afterTurn(workerOpts.workerId, { tokens: 500 })
    assert(post.action === 'continue', 'afterTurn → continue')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 24. Conductor — cascade failure
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 24. Conductor cascade failure ---')
  {
    resetMock()
    const claw = createClaw({
      apiKey: 'test-key',
      conductor: 'dispatch',
      dispatchMode: 'code',
      onWorkerStart: (task, abort, opts) => new Promise(() => {}),
    })

    const i1 = claw.conductor.createIntent('Task A')
    const i2 = claw.conductor.createIntent('Task B', { dependsOn: [i1.id] })
    await new Promise(r => setTimeout(r, 50))

    // Fail A
    const workers = claw.conductor.getState().workers
    const wA = workers.find(w => w.task.includes('Task A'))
    claw.conductor.failWorker(wA.id, 'error')
    await new Promise(r => setTimeout(r, 50))

    const intents = claw.conductor.getIntents()
    assert(intents.find(i => i.id === i1.id).status === 'failed', 'A failed')
    assert(intents.find(i => i.id === i2.id).status === 'failed', 'B cascade failed')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 25. Conductor — state inspection
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 25. Conductor state ---')
  {
    resetMock()
    const claw = createClaw({
      apiKey: 'test-key',
      conductor: 'dispatch',
      dispatchMode: 'code',
      onWorkerStart: () => new Promise(() => {}),
    })

    claw.conductor.createIntent('State test')
    await new Promise(r => setTimeout(r, 50))

    const state = claw.conductor.getState()
    assert(state.strategy === 'dispatch', 'Strategy correct')
    assert(state.intents.length === 1, 'One intent')
    assert(state.workers.length === 1, 'One worker')
    assert(state.scheduler.slots.length === 1, 'One slot used')

    claw.destroy()
  }

  // ═══════════════════════════════════════════════════════════════
  // 26. expandSkills utility
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 26. expandSkills ---')
  {
    const skill = {
      name: 'test',
      tools: [
        { name: 'tool_a', description: 'A', parameters: {}, execute: async () => 'a' },
        { name: 'tool_b', description: 'B', parameters: {}, execute: async () => 'b',
          requiresConfig: (cfg) => !!cfg.bKey },
      ],
    }
    const expanded = expandSkills([skill], {})
    assert(expanded.length === 1, 'Filtered out tool_b (missing config)')
    assert(expanded[0].name === 'tool_a', 'tool_a kept')

    const expanded2 = expandSkills([skill], { bKey: 'yes' })
    assert(expanded2.length === 2, 'Both tools when config present')
  }

  // ═══════════════════════════════════════════════════════════════
  // 27. builtinSkills
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- 27. builtinSkills ---')
  {
    assert(builtinSkills.calculate !== undefined, 'calculate skill exists')
    const calcTool = builtinSkills.calculate.tools[0]
    const result = await calcTool.execute({ expression: '2 + 3' })
    assert(result.result === 5, 'calculate works: 2+3=5')
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════

  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  Results: ${passed}/${total} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════════════\n')

  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => { console.error(err); process.exit(1) })
