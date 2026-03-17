#!/usr/bin/env node
/**
 * claw — AI agent CLI
 * Usage:
 *   claw 'What is quantum computing?'
 *   claw -i                              # interactive REPL
 *   claw --config                        # configure API key
 *   cat file.md | claw 'summarize this'  # pipe mode
 *   claw --provider openai --model gpt-4 'question'
 *   claw --json 'extract structured data'
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')

// ── Config ─────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.agentic')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch {}
  return {}
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

// ── Parse args ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { flags: {}, positional: [] }
  let i = 2 // skip node and script path
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === '-i' || arg === '--interactive') { args.flags.interactive = true }
    else if (arg === '--config') { args.flags.config = true }
    else if (arg === '--json') { args.flags.json = true }
    else if (arg === '-h' || arg === '--help') { args.flags.help = true }
    else if (arg === '-v' || arg === '--version') { args.flags.version = true }
    else if (arg === '--provider' && argv[i + 1]) { args.flags.provider = argv[++i] }
    else if (arg === '--model' && argv[i + 1]) { args.flags.model = argv[++i] }
    else if (arg === '--base-url' && argv[i + 1]) { args.flags.baseUrl = argv[++i] }
    else if (arg === '--api-key' && argv[i + 1]) { args.flags.apiKey = argv[++i] }
    else if (arg === '--proxy' && argv[i + 1]) { args.flags.proxyUrl = argv[++i] }
    else if (arg === '--system' && argv[i + 1]) { args.flags.system = argv[++i] }
    else if (arg === '--no-stream') { args.flags.noStream = true }
    else if (!arg.startsWith('-')) { args.positional.push(arg) }
    i++
  }
  return args
}

// ── Terminal formatting ────────────────────────────────────────────

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const ITALIC = '\x1b[3m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const GRAY = '\x1b[90m'

function formatMarkdown(text) {
  // Simple terminal markdown: bold, italic, code, headers
  return text
    .replace(/^### (.+)$/gm, `${BOLD}${CYAN}   $1${RESET}`)
    .replace(/^## (.+)$/gm, `${BOLD}${CYAN}  $1${RESET}`)
    .replace(/^# (.+)$/gm, `${BOLD}${CYAN} $1${RESET}`)
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
    .replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`)
    .replace(/`([^`]+)`/g, `${YELLOW}$1${RESET}`)
    .replace(/^```[\s\S]*?```$/gm, (match) => {
      const lines = match.split('\n')
      const code = lines.slice(1, -1).join('\n')
      return `${DIM}┌──${RESET}\n${code}\n${DIM}└──${RESET}`
    })
    .replace(/^- (.+)$/gm, `  ${DIM}•${RESET} $1`)
    .replace(/^\d+\. (.+)$/gm, (_, text, offset, str) => `  ${DIM}${_.match(/^\d+/)[0]}.${RESET} ${text}`)
}

// ── Help ───────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
${BOLD}claw${RESET} — AI agent CLI ${DIM}(powered by agentic)${RESET}

${BOLD}Usage:${RESET}
  claw "What is quantum computing?"     ${DIM}# one-shot${RESET}
  claw -i                               ${DIM}# interactive REPL${RESET}
  claw --config                         ${DIM}# configure API key${RESET}
  cat file.md | claw "summarize"        ${DIM}# pipe mode${RESET}

${BOLD}Options:${RESET}
  -i, --interactive    Interactive REPL mode
  --config             Configure API key and preferences
  --provider <name>    LLM provider (anthropic, openai) [default: anthropic]
  --model <name>       Model name
  --base-url <url>     Custom API base URL
  --api-key <key>      API key (overrides config)
  --proxy <url>        Proxy URL
  --system <prompt>    System prompt
  --json               JSON output mode
  --no-stream          Disable streaming
  -h, --help           Show this help
  -v, --version        Show version
`)
}

// ── Config wizard ──────────────────────────────────────────────────

async function configWizard() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q) => new Promise(r => rl.question(q, r))

  console.log(`\n${BOLD}claw config${RESET}\n`)

  const config = loadConfig()

  const apiKey = await ask(`${DIM}API Key${RESET} [${config.apiKey ? '****' + config.apiKey.slice(-4) : 'none'}]: `)
  if (apiKey) config.apiKey = apiKey

  const provider = await ask(`${DIM}Provider${RESET} [${config.provider || 'anthropic'}]: `)
  if (provider) config.provider = provider

  const model = await ask(`${DIM}Model${RESET} [${config.model || 'default'}]: `)
  if (model && model !== 'default') config.model = model

  const baseUrl = await ask(`${DIM}Base URL${RESET} [${config.baseUrl || 'default'}]: `)
  if (baseUrl && baseUrl !== 'default') config.baseUrl = baseUrl

  const proxyUrl = await ask(`${DIM}Proxy URL${RESET} [${config.proxyUrl || 'none'}]: `)
  if (proxyUrl && proxyUrl !== 'none') config.proxyUrl = proxyUrl

  saveConfig(config)
  console.log(`\n${GREEN}✓${RESET} Config saved to ${DIM}${CONFIG_FILE}${RESET}\n`)

  rl.close()
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const { flags, positional } = parseArgs(process.argv)

  if (flags.help) { showHelp(); return }
  if (flags.version) { console.log('claw 0.1.0'); return }
  if (flags.config) { await configWizard(); return }

  // Load dependencies
  let AgenticCore, AgenticMemory
  try {
    // Try local paths first (development), then npm packages
    const corePaths = [
      path.join(__dirname, '..', '..', 'agentic-core', 'docs', 'agentic-agent.js'),
      'agentic-core',
    ]
    const memoryPaths = [
      path.join(__dirname, '..', '..', 'agentic-memory', 'memory.js'),
      'agentic-memory',
    ]

    for (const p of corePaths) {
      try { AgenticCore = require(p); break } catch {}
    }
    for (const p of memoryPaths) {
      try { AgenticMemory = require(p); break } catch {}
    }
  } catch {}

  if (!AgenticCore) {
    console.error(`${RED}Error:${RESET} agentic-core not found. Run: npm install agentic-core`)
    process.exit(1)
  }
  if (!AgenticMemory) {
    console.error(`${RED}Error:${RESET} agentic-memory not found. Run: npm install agentic-memory`)
    process.exit(1)
  }

  // Make agenticAsk available globally for claw.js
  const askFn = AgenticCore.agenticAsk || AgenticCore
  if (typeof askFn === 'function') {
    globalThis.agenticAsk = askFn
  } else if (AgenticCore.default) {
    globalThis.agenticAsk = AgenticCore.default
  }
  globalThis.AgenticMemory = AgenticMemory

  const { createClaw } = require('../claw.js')

  // Resolve config
  const config = loadConfig()
  const apiKey = flags.apiKey || config.apiKey || process.env.AGENTIC_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY

  if (!apiKey) {
    console.error(`${RED}Error:${RESET} No API key. Run: ${BOLD}claw --config${RESET} or set AGENTIC_API_KEY`)
    process.exit(1)
  }

  const claw = createClaw({
    apiKey,
    provider: flags.provider || config.provider || 'anthropic',
    model: flags.model || config.model || undefined,
    baseUrl: flags.baseUrl || config.baseUrl || undefined,
    proxyUrl: flags.proxyUrl || config.proxyUrl || undefined,
    systemPrompt: flags.system || config.systemPrompt || undefined,
    stream: !flags.noStream,
  })

  // Check for piped stdin
  let stdinContent = ''
  if (!process.stdin.isTTY) {
    stdinContent = await new Promise((resolve) => {
      let data = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', chunk => data += chunk)
      process.stdin.on('end', () => resolve(data))
    })
  }

  // Interactive REPL
  if (flags.interactive || (!positional.length && !stdinContent)) {
    console.log(`\n${BOLD}claw${RESET} ${DIM}v0.1.0${RESET} — type ${YELLOW}/quit${RESET} to exit\n`)

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${CYAN}> ${RESET}`,
    })

    rl.prompt()

    rl.on('line', async (line) => {
      const input = line.trim()
      if (!input) { rl.prompt(); return }
      if (input === '/quit' || input === '/exit' || input === '/q') {
        console.log(`\n${DIM}bye${RESET}\n`)
        claw.destroy()
        rl.close()
        return
      }
      if (input === '/clear') {
        claw.memory.clear()
        console.log(`${DIM}memory cleared${RESET}`)
        rl.prompt()
        return
      }
      if (input === '/info') {
        const info = claw.memory.info()
        console.log(`${DIM}turns: ${info.turns} | messages: ${info.messageCount} | tokens: ${info.tokens}/${info.maxTokens}${RESET}`)
        rl.prompt()
        return
      }

      process.stdout.write('\n')

      try {
        let fullAnswer = ''
        await claw.chat(input, (event, data) => {
          if (event === 'token') {
            process.stdout.write(data.text)
            fullAnswer += data.text
          } else if (event === 'status') {
            process.stdout.write(`\r${DIM}${data.message}${RESET}`)
          }
        })
        if (!fullAnswer) {
          // Non-streaming response already printed
        }
        process.stdout.write('\n\n')
      } catch (err) {
        console.error(`\n${RED}Error:${RESET} ${err.message}\n`)
      }

      rl.prompt()
    })

    rl.on('close', () => process.exit(0))
    return
  }

  // One-shot mode
  let input = positional.join(' ')
  if (stdinContent) {
    input = input ? `${input}\n\n${stdinContent}` : stdinContent
  }

  if (!input.trim()) {
    showHelp()
    return
  }

  try {
    let fullAnswer = ''
    const result = await claw.chat(input, (event, data) => {
      if (event === 'token' && !flags.json) {
        process.stdout.write(data.text)
        fullAnswer += data.text
      } else if (event === 'status' && !flags.json) {
        process.stderr.write(`\r${DIM}${data.message}${RESET}`)
      }
    })

    if (flags.json) {
      console.log(JSON.stringify({
        answer: result.answer,
        rounds: result.rounds,
        data: result.data,
      }, null, 2))
    } else if (!fullAnswer && result.answer) {
      // Non-streaming: format and print
      console.log(formatMarkdown(result.answer))
    } else {
      process.stdout.write('\n')
    }
  } catch (err) {
    console.error(`${RED}Error:${RESET} ${err.message}`)
    process.exit(1)
  }

  claw.destroy()
}

main().catch(err => {
  console.error(`${RED}Fatal:${RESET} ${err.message}`)
  process.exit(1)
})
