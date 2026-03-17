/**
 * Unit tests for claw CLI utilities
 * Run: node --test test/cli.test.js
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { execSync } = require('child_process')
const path = require('path')

const CLI_PATH = path.join(__dirname, '..', 'bin', 'claw.js')

describe('CLI --help', () => {
  it('shows help text', () => {
    const output = execSync(`node ${CLI_PATH} --help`, { encoding: 'utf8' })
    assert.ok(output.includes('claw'), 'should contain claw name')
    assert.ok(output.includes('--interactive'), 'should mention interactive flag')
    assert.ok(output.includes('--config'), 'should mention config flag')
    assert.ok(output.includes('--provider'), 'should mention provider option')
  })
})

describe('CLI --version', () => {
  it('shows version', () => {
    const output = execSync(`node ${CLI_PATH} --version`, { encoding: 'utf8' })
    assert.ok(output.includes('0.1.0'), 'should show version number')
  })
})

describe('CLI no API key', () => {
  it('shows error when no API key configured', () => {
    try {
      execSync(`node ${CLI_PATH} "test question"`, {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: '/tmp/claw-test-nokey',
          AGENTIC_API_KEY: '',
          ANTHROPIC_API_KEY: '',
          OPENAI_API_KEY: '',
        }
      })
      assert.fail('Should have thrown')
    } catch (err) {
      assert.ok(
        err.stderr.includes('No API key') || err.stdout.includes('No API key') || err.status !== 0,
        'should show API key error'
      )
    }
  })
})
