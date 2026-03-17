# F001: claw CLI 完整测试套件

## Phase 1: Unit Tests (claw.js library)
- [ ] Test createClaw() — basic instantiation with required options
- [ ] Test createClaw() — throws on missing apiKey
- [ ] Test createClaw() — dependency resolution (core + memory)
- [ ] Test session() — creates and returns named sessions
- [ ] Test session() — reuses existing session by id
- [ ] Test sessions() — lists all active session ids
- [ ] Test chat() — delegates to default session
- [ ] Test chat() — per-chat options (tools override)
- [ ] Test learn/recall/forget — knowledge operations
- [ ] Test learn/recall/forget — throws when knowledge not enabled
- [ ] Test heartbeat() — registers and fires interval
- [ ] Test schedule() — parses patterns ('5m', '1h', '30s', number)
- [ ] Test schedule() — throws on invalid pattern
- [ ] Test on/off — event registration and removal
- [ ] Test destroy() — clears all intervals and sessions
- [ ] Test memory.clear() — resets default session
- [ ] Test knowledgeInfo() — returns null when knowledge disabled

## Phase 2: Unit Tests (CLI — bin/claw.js)
- [ ] Test parseArgs() — flags parsing
- [ ] Test parseArgs() — positional arguments
- [ ] Test formatMarkdown() — bold, italic, code, headers
- [ ] Test loadConfig/saveConfig — read/write config file
- [ ] Test --help flag — shows help text
- [ ] Test --version flag — shows version

## Phase 3: DBB Scenarios (Design-Based Behavior)
- [ ] Scenario: First-time user runs `claw --config` → config wizard prompts
- [ ] Scenario: User runs `claw "question"` → one-shot mode, gets answer
- [ ] Scenario: User runs `claw -i` → enters REPL, can chat and /quit
- [ ] Scenario: User pipes `echo "text" | claw "summarize"` → pipe mode
- [ ] Scenario: User runs without API key → helpful error message
- [ ] Scenario: Multi-turn in REPL → memory persists across turns
- [ ] Scenario: /clear in REPL → resets conversation
- [ ] Scenario: /info in REPL → shows token count

## Phase 4: E2E Tests (integration with real LLM)
- [ ] E2E: One-shot chat with Subrouter → gets response
- [ ] E2E: REPL multi-turn → second message references first
- [ ] E2E: Knowledge learn + recall → recalls learned content
- [ ] E2E: Stream mode → tokens arrive incrementally
- [ ] E2E: JSON output mode → valid JSON with answer field

## Phase 5: Evidence Collection
- [ ] All unit tests pass — output log saved
- [ ] All DBB scenarios verified — evidence screenshots/logs
- [ ] All E2E tests pass — output log saved
- [ ] Coverage report generated
