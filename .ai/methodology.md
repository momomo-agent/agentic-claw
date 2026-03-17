# Methodology — agentic-claw

## Tech Stack
- **Language**: Vanilla JavaScript (UMD)
- **Runtime**: Node.js + Browser
- **Dependencies**: 0 (peer deps: agentic-core, agentic-memory)
- **Format**: UMD (CommonJS + AMD + global)
- **Test**: Node.js built-in test runner + assert

## Architecture Decisions
- **UMD not ESM**: Must work with `<script>` tag in browser AND `require()` in Node
- **Peer deps not bundled**: Users bring their own core + memory (avoid duplication)
- **Lazy dependency resolution**: Dependencies resolved at runtime, not import time
- **Global agenticAsk bridge**: Browser uses global, Node uses require — claw abstracts this
- **Per-chat options**: tools/searchApiKey overridable per chat() call for dynamic UIs
