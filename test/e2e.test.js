/**
 * E2E tests for agentic-claw — real LLM integration
 * Run: AGENTIC_API_KEY=sk-... node --test test/e2e.test.js
 *
 * These tests call a real LLM API (Subrouter) — they cost tokens.
 * Skip with: node --test --test-name-pattern "unit" test/
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

// Load real agentic-core
const agenticCore = require(path.join(__dirname, '..', '..', 'agentic-core', 'docs', 'agentic-agent.js'))
globalThis.agenticAsk = agenticCore.agenticAsk || agenticCore

// Load memory
const AgenticMemory = require(path.join(__dirname, '..', '..', 'agentic-memory', 'memory.js'))
globalThis.AgenticMemory = AgenticMemory

const { createClaw } = require('../claw.js')

const API_KEY = process.env.AGENTIC_API_KEY || process.env.SUBROUTER_API_KEY || 'sk-ghmxEJX3PJ0hWZpy0COZUbEk2f6aTiyUu4zrbz0ZhRoQvgV2'
const PROXY_URL = process.env.AGENTIC_PROXY || undefined

describe('E2E: one-shot chat', () => {
  it('gets a response from real LLM', async () => {
    const claw = createClaw({
      apiKey: API_KEY,
      baseUrl: 'https://www.subrouter.ai',
      proxyUrl: PROXY_URL,
      // model: default,
      stream: false,
    })

    const result = await claw.chat('Reply with exactly: PONG')
    assert.ok(result.answer, 'should have an answer')
    assert.ok(result.answer.includes('PONG'), `answer should contain PONG, got: ${result.answer}`)
    claw.destroy()
  })
})

describe('E2E: streaming', () => {
  it('receives tokens incrementally', async () => {
    const claw = createClaw({
      apiKey: API_KEY,
      baseUrl: 'https://www.subrouter.ai',
      proxyUrl: PROXY_URL,
      // model: default,
      stream: true,
    })

    const tokens = []
    const result = await claw.chat('Say exactly: hello world', (event, data) => {
      if (event === 'token') tokens.push(data.text)
    })
    assert.ok(result.answer, 'should have an answer')
    assert.ok(tokens.length > 0, `should receive tokens, got ${tokens.length}`)
    claw.destroy()
  })
})

describe('E2E: multi-turn memory', () => {
  it('remembers context across turns', async () => {
    const claw = createClaw({
      apiKey: API_KEY,
      baseUrl: 'https://www.subrouter.ai',
      proxyUrl: PROXY_URL,
      // model: default,
      stream: false,
    })

    await claw.chat('My secret code is ALPHA-7. Remember it.')
    const result = await claw.chat('What is my secret code? Reply with just the code.')
    assert.ok(result.answer.includes('ALPHA-7'), `should remember code, got: ${result.answer}`)
    claw.destroy()
  })
})

describe('E2E: knowledge', () => {
  it('recalls learned content', async () => {
    const claw = createClaw({
      apiKey: API_KEY,
      baseUrl: 'https://www.subrouter.ai',
      proxyUrl: PROXY_URL,
      // model: default,
      stream: false,
      knowledge: true,
    })

    await claw.learn('company', 'Acme Corp was founded in 1985 by John Smith in Portland, Oregon.')
    const results = await claw.recall('When was Acme founded?')
    assert.ok(results.length > 0, 'should recall results')
    assert.ok(results[0].chunk.includes('1985'), 'should find founding year')
    claw.destroy()
  })
})

describe('E2E: JSON mode', () => {
  it('returns structured data', async () => {
    const claw = createClaw({
      apiKey: API_KEY,
      baseUrl: 'https://www.subrouter.ai',
      proxyUrl: PROXY_URL,
      // model: default,
      stream: false,
    })

    const result = await claw.chat('Reply with valid JSON: {"status": "ok", "count": 42}. Only the JSON, nothing else.')
    assert.ok(result.answer, 'should have an answer')
    // Try parsing as JSON
    try {
      const parsed = JSON.parse(result.answer.trim())
      assert.equal(parsed.status, 'ok')
    } catch {
      // LLM might wrap in markdown, that's ok for this test
      assert.ok(result.answer.includes('"status"'), 'should contain JSON-like content')
    }
    claw.destroy()
  })
})
