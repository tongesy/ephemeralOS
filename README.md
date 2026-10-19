<p align="center">
  <img src="docs/assets/orb-states.png" alt="The orb in its five states: zen, listening, thinking, speaking and error" width="100%">
</p>

<h1 align="center">ephemeralOS</h1>

<p align="center">A voice-only, agentic OS in the browser.<br>You talk to an orb. It talks back.</p>

---

The screen only shows something when voice isn't enough, and then it gets out of the way. There
is nothing to type, tap or click once it's running. It remembers, hands deep work to a stronger
model, and reports back when it's done.

Open source, bring your own API keys, local-first.

> **Status:** early. The orb (M1) is here; the voice loop (M2) is next. See the
> [roadmap](#roadmap).

## Principles

1. **Voice is the only input.** One click to grant the microphone is the single exception.
2. **The screen is ephemeral output.** Everything shown is numbered so it can be addressed by
   voice, and it fades when it's no longer relevant.
3. **Say the gist, show the detail.** Never a table read aloud.
4. **Keys never touch the browser.** They live in the local gateway's `.env`.
5. **Local-first.** A single Node process on `127.0.0.1` is the control plane; the browser is a
   thin body.
6. **Model-agnostic.** Voice and brain providers sit behind adapters.
7. **Human-readable state.** Memory, persona and config are files you can open.
8. **Safe by default.** No shell, no arbitrary file access, nothing exposed to the network.

The full brief is in [`docs/BRIEF.md`](docs/BRIEF.md).

## Quick start

Requires Node 22.12+ and pnpm 10.

```sh
pnpm install
pnpm dev
```

Open <http://localhost:5173> in Chrome and click once to grant the microphone.

In development builds, the keyboard drives the orb so you can see every state:

| Key                                            | Action                                    |
| ---------------------------------------------- | ----------------------------------------- |
| <kbd>Space</kbd> / <kbd>→</kbd> / <kbd>←</kbd> | Next / previous state                     |
| <kbd>1</kbd>–<kbd>5</kbd>                      | Zen, listening, thinking, speaking, error |
| <kbd>D</kbd>                                   | Dock to the corner and back               |
| <kbd>P</kbd>                                   | Frame-time readout                        |
| <kbd>V</kbd>                                   | Toggle simulated voice output             |

None of this exists in production builds.

### Production build

```sh
pnpm build
pnpm start   # http://localhost:4317
```

## How it fits together

```
Browser (the body)                         Gateway (local Node process, 127.0.0.1)
┌───────────────────────────────┐          ┌──────────────────────────────────────┐
│ Orb (three.js + bloom)        │          │ HTTP: serves the client, injects a   │
│ Audio levels (AnalyserNode)   │◀── WS ──▶│       per-launch token               │
│ Wake word, voice session (M2) │  token + │ WS:   validated messages (zod)       │
│ Display components (M3)       │  origin  │ Realtime credentials, tools, jobs,   │
└───────────────────────────────┘  checked │ memory (M2–M5)                       │
                                           └──────────────────────────────────────┘
```

| Package                                | Role                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------- |
| [`packages/gateway`](packages/gateway) | Local control plane: HTTP, WebSocket, and later tools, jobs and memory |
| [`packages/web`](packages/web)         | The browser body: orb, audio, display                                  |
| [`packages/shared`](packages/shared)   | zod schemas and types shared by both                                   |

## Privacy

Nothing leaves your machine in the current milestone. From M2, audio goes to OpenAI only while a
voice session is open (after the wake word fires, which is detected locally), and delegated
tasks go to Anthropic. Keys, memory and transcripts stay in `~/.ephemeralos/`.

## Roadmap

- [x] **M0** Scaffold: workspace, gateway, tokens, type, CI
- [x] **M1** The orb: five states, smooth transitions, mic-reactive, bloom
- [ ] **M2** Voice loop: `init`, wake word, Realtime session, barge-in, fallback
- [ ] **M3** Display: cards, lists, tables, charts, voice navigation
- [ ] **M4** Delegate: async Claude jobs with web search
- [ ] **M5** Memory: remember, recall, forget
- [ ] **M6** Polish and release

## Contributing

`pnpm check` runs formatting, lint, types, tests and the build: the same as CI. Conventions
are in [`CLAUDE.md`](CLAUDE.md); design notes in [`docs/design.md`](docs/design.md); the
performance budget and how to measure it in [`docs/performance.md`](docs/performance.md).

## License

[MIT](LICENSE)
