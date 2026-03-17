# agentic-claw

AI agent runtime + CLI — `createClaw()` wires up agentic-core + agentic-memory into a living agent.

Part of the [agentic](https://momomo-agent.github.io/agentic/) family.

## Install

```bash
npm install agentic-claw agentic-core agentic-memory
```

## CLI

```bash
# One-shot
claw "What is quantum computing?"

# Interactive REPL
claw -i

# Configure API key
claw --config

# Pipe mode
cat report.md | claw "summarize this"

# Options
claw --provider openai --model gpt-4 "question"
claw --json "extract structured data"
```

## Library

```js
const { createClaw } = require('agentic-claw')

const claw = createClaw({
  apiKey: 'sk-...',
  provider: 'anthropic',
  systemPrompt: 'You are a helpful assistant.',
})

// Chat
const result = await claw.chat('Hello')
console.log(result.answer)

// Streaming
await claw.chat('Tell me a story', (event, data) => {
  if (event === 'token') process.stdout.write(data.text)
})
```

## Multi-session

```js
const alice = claw.session('alice')
const bob = claw.session('bob')

await alice.chat('My name is Alice')
await bob.chat('My name is Bob')

// Conversations are isolated
await alice.chat('What is my name?') // → Alice
await bob.chat('What is my name?')   // → Bob
```

## Knowledge

```js
const claw = createClaw({
  apiKey: 'sk-...',
  knowledge: true,
})

// Teach
await claw.learn('docs', 'Quantum computing uses qubits...')

// Chat with knowledge
await claw.chat('How do qubits work?')
// → Uses recalled knowledge in response
```

## Lifecycle

```js
// Heartbeat — periodic check-in
claw.heartbeat(() => {
  console.log('Still alive')
}, 60000) // every 60s

// Schedule — recurring tasks
claw.schedule('5m', () => {
  console.log('Every 5 minutes')
})

// Events
claw.on('message', msg => console.log(msg))
claw.on('token', data => process.stdout.write(data.text))
claw.on('error', err => console.error(err))

// Cleanup
claw.destroy()
```

## Architecture

```
agentic-claw
  ├── agentic-core   — LLM engine (calls, tools, schema, stream)
  └── agentic-memory — Memory (conversation + knowledge)

Your App → claw.chat() → auto: memory → recall → core → store
```

## License

MIT
