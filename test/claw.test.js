/**
 * Unit tests for agentic-claw
 * Run: node --test test/claw.test.js
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')

// ── Setup: mock dependencies ──────────────────────────────────────

// Mock agenticAsk globally
let mockAskCalls = []
let mockAskResult = { answer: 'mock answer', rounds: 1 }
globalThis.agenticAsk = async function mockAsk(input, config, emit) {
  mockAskCalls.push({ input, config, emit })
  if (emit) {
    emit('token', { text: mockAskResult.answer })
  }
  return mockAskResult
}

// Load memory and claw
const AgenticMemory = require('../node_modules/agentic-memory/memory.js')
globalThis.AgenticMemory = AgenticMemory

const { createClaw } = require('../claw.js')

// ── Tests ─────────────────────────────────────────────────────────

describe('createClaw', () => {
  beforeEach(() => {
    mockAskCalls = []
    mockAskResult = { answer: 'mock answer', rounds: 1 }
  })

  it('creates with required options', () => {
    const claw = createClaw({ apiKey: 'test-key' })
    assert.ok(claw)
    assert.equal(typeof claw.chat, 'function')
    assert.equal(typeof claw.session, 'function')
    assert.equal(typeof claw.on, 'function')
    assert.equal(typeof claw.destroy, 'function')
    claw.destroy()
  })

  it('throws on missing apiKey', () => {
    assert.throws(() => createClaw({}), /apiKey is required/)
    assert.throws(() => createClaw(), /apiKey is required/)
  })

  it('accepts all configuration options', () => {
    const claw = createClaw({
      apiKey: 'test-key',
      provider: 'openai',
      baseUrl: 'https://custom.api',
      model: 'gpt-4',
      proxyUrl: 'https://proxy.example',
      systemPrompt: 'You are helpful.',
      maxTokens: 4000,
      stream: false,
    })
    assert.ok(claw)
    claw.destroy()
  })
})

describe('session management', () => {
  let claw

  beforeEach(() => {
    mockAskCalls = []
    claw = createClaw({ apiKey: 'test-key' })
  })

  afterEach(() => {
    claw.destroy()
  })

  it('session() creates a named session', () => {
    const s = claw.session('alice')
    assert.equal(s.id, 'alice')
    assert.equal(typeof s.chat, 'function')
    assert.ok(s.memory)
  })

  it('session() reuses existing session by id', () => {
    const s1 = claw.session('bob')
    const s2 = claw.session('bob')
    assert.equal(s1.memory, s2.memory) // same memory instance
  })

  it('sessions() lists active session ids', async () => {
    claw.session('alice')
    claw.session('bob')
    const ids = claw.sessions()
    assert.ok(ids.includes('default'))
    assert.ok(ids.includes('alice'))
    assert.ok(ids.includes('bob'))
  })
})

describe('chat', () => {
  let claw

  beforeEach(() => {
    mockAskCalls = []
    mockAskResult = { answer: 'hello back', rounds: 1 }
    claw = createClaw({ apiKey: 'test-key' })
  })

  afterEach(() => {
    claw.destroy()
  })

  it('chat() sends message and returns result', async () => {
    const result = await claw.chat('hello')
    assert.equal(result.answer, 'hello back')
    assert.equal(result.rounds, 1)
    assert.ok(result.messages)
    assert.equal(mockAskCalls.length, 1)
    assert.equal(mockAskCalls[0].input, 'hello')
  })

  it('chat() passes config to agenticAsk', async () => {
    const c = createClaw({
      apiKey: 'my-key',
      provider: 'openai',
      model: 'gpt-4',
      baseUrl: 'https://custom.api',
    })
    await c.chat('test')
    const config = mockAskCalls[0].config
    assert.equal(config.apiKey, 'my-key')
    assert.equal(config.provider, 'openai')
    assert.equal(config.model, 'gpt-4')
    assert.equal(config.baseUrl, 'https://custom.api')
    c.destroy()
  })

  it('chat() with emit callback', async () => {
    const tokens = []
    await claw.chat('hello', (event, data) => {
      if (event === 'token') tokens.push(data.text)
    })
    assert.ok(tokens.length > 0)
  })

  it('chat() with per-call options', async () => {
    await claw.chat('hello', { tools: ['search'] }, () => {})
    const config = mockAskCalls[0].config
    assert.deepEqual(config.tools, ['search'])
  })

  it('chat() stores conversation history', async () => {
    await claw.chat('hello')
    await claw.chat('follow up')
    assert.equal(mockAskCalls.length, 2)
    // Second call should include history from first
    const history = mockAskCalls[1].config.history
    assert.ok(history.length >= 2) // at least user + assistant from first turn
  })

  it('session chat is isolated', async () => {
    const alice = claw.session('alice')
    const bob = claw.session('bob')
    await alice.chat('I am Alice')
    await bob.chat('I am Bob')
    // Alice's history should not contain Bob's messages
    const aliceHistory = alice.memory.history()
    const bobHistory = bob.memory.history()
    assert.ok(aliceHistory.some(m => m.content === 'I am Alice'))
    assert.ok(!aliceHistory.some(m => m.content === 'I am Bob'))
    assert.ok(bobHistory.some(m => m.content === 'I am Bob'))
    assert.ok(!bobHistory.some(m => m.content === 'I am Alice'))
  })
})

describe('knowledge', () => {
  it('throws when knowledge not enabled', () => {
    const claw = createClaw({ apiKey: 'test-key' })
    assert.rejects(() => claw.learn('doc', 'content'), /Knowledge not enabled/)
    assert.rejects(() => claw.recall('query'), /Knowledge not enabled/)
    assert.rejects(() => claw.forget('doc'), /Knowledge not enabled/)
    claw.destroy()
  })

  it('learn/recall/forget work when knowledge enabled', async () => {
    const claw = createClaw({ apiKey: 'test-key', knowledge: true })
    await claw.learn('physics', 'Quantum computing uses qubits for calculations')
    await claw.learn('ml', 'Neural networks are inspired by the brain')

    const results = await claw.recall('quantum')
    assert.ok(results.length > 0)
    assert.ok(results.some(r => r.id === 'physics'))

    await claw.forget('physics')
    const after = await claw.recall('quantum qubits')
    // Should not find physics doc after forget
    assert.ok(!after.some(r => r.id === 'physics'))

    claw.destroy()
  })

  it('knowledgeInfo() returns null when knowledge disabled', () => {
    const claw = createClaw({ apiKey: 'test-key' })
    assert.equal(claw.knowledgeInfo(), null)
    claw.destroy()
  })
})

describe('lifecycle', () => {
  it('heartbeat() registers and fires', async () => {
    const claw = createClaw({ apiKey: 'test-key' })
    let fired = 0
    claw.heartbeat(() => { fired++ }, 50)
    await new Promise(r => setTimeout(r, 130))
    assert.ok(fired >= 2, `Expected >=2 fires, got ${fired}`)
    claw.destroy()
  })

  it('schedule() parses time patterns', async () => {
    const claw = createClaw({ apiKey: 'test-key' })
    let count = 0
    // 50ms expressed as number
    claw.schedule(50, () => { count++ })
    await new Promise(r => setTimeout(r, 130))
    assert.ok(count >= 2, `Expected >=2 fires, got ${count}`)
    claw.destroy()
  })

  it('schedule() parses string patterns', () => {
    const claw = createClaw({ apiKey: 'test-key' })
    // These should not throw
    claw.schedule('1s', () => {})
    claw.schedule('5m', () => {})
    claw.schedule('1h', () => {})
    claw.schedule('1d', () => {})
    claw.destroy()
  })

  it('schedule() throws on invalid pattern', () => {
    const claw = createClaw({ apiKey: 'test-key' })
    assert.throws(() => claw.schedule('invalid', () => {}), /Invalid schedule pattern/)
    assert.throws(() => claw.schedule('5x', () => {}), /Invalid schedule pattern/)
    claw.destroy()
  })

  it('destroy() clears all intervals', async () => {
    const claw = createClaw({ apiKey: 'test-key' })
    let heartCount = 0
    let schedCount = 0
    claw.heartbeat(() => { heartCount++ }, 30)
    claw.schedule(30, () => { schedCount++ })
    claw.destroy()
    const h = heartCount
    const s = schedCount
    await new Promise(r => setTimeout(r, 100))
    // Counts should not increase after destroy
    assert.equal(heartCount, h, 'heartbeat should stop after destroy')
    assert.equal(schedCount, s, 'schedule should stop after destroy')
  })
})

describe('events', () => {
  it('on/off registers and removes listeners', async () => {
    const claw = createClaw({ apiKey: 'test-key' })
    const messages = []
    const handler = (msg) => messages.push(msg)
    claw.on('message', handler)
    await claw.chat('hello')
    assert.ok(messages.length >= 1, 'should receive message events')

    const countBefore = messages.length
    claw.off('message', handler)
    await claw.chat('hello again')
    assert.equal(messages.length, countBefore, 'should not receive after off()')
    claw.destroy()
  })

  it('emits token events during chat', async () => {
    const claw = createClaw({ apiKey: 'test-key' })
    const tokens = []
    claw.on('token', (data) => tokens.push(data))
    await claw.chat('hello')
    assert.ok(tokens.length > 0)
    claw.destroy()
  })
})

describe('memory access', () => {
  it('memory property returns default session memory', () => {
    const claw = createClaw({ apiKey: 'test-key' })
    assert.ok(claw.memory)
    assert.equal(typeof claw.memory.messages, 'function')
    assert.equal(typeof claw.memory.info, 'function')
    claw.destroy()
  })

  it('memory.clear() resets conversation', async () => {
    const claw = createClaw({ apiKey: 'test-key' })
    await claw.chat('hello')
    const before = claw.memory.info().messageCount
    assert.ok(before > 0)
    claw.memory.clear()
    const after = claw.memory.info().messageCount
    assert.equal(after, 0)
    claw.destroy()
  })
})
