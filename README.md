<p align="center">
  <img src="docs/assets/orb-states.png" alt="The plasma orb in its five states: zen, listening, thinking, speaking and error" width="100%">
</p>

<h1 align="center">ephemeralOS</h1>

<p align="center">A voice-only, agentic OS in the browser.<br>You talk to an orb. It talks back.</p>

---

The screen only shows something when voice isn't enough, and then it gets out of the way. There
is nothing to type, tap or click once it's running. It remembers, hands deep work to a stronger
model, and reports back when it's done.

Open source, bring your own API keys, local-first.

<p align="center">
  <img src="docs/assets/open-space.png" alt="A glass card fades in on the left; the orb has glided into the open space on the right" width="80%">
</p>

> **Status:** early. The orb (M1) and the voice loop (M2) are here; the display (M3) is next.
> See the [roadmap](#roadmap).

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

Requires Node 22.12+, pnpm 10, Chrome, and an OpenAI API key.

```sh
pnpm install
pnpm ephemeralos init   # API keys, name, voice, wake-word models → ~/.ephemeralos
pnpm build
pnpm start              # http://localhost:4317
```

Open <http://localhost:4317> in Chrome and click once to grant the microphone. Then say
**"Hey Jarvis"**. Talk normally, interrupt whenever you like, and say "that's all" (or just stop
talking for ten seconds) to send it back to sleep.

`init` is the only setup step, and it happens in the terminal: keys are typed there, hidden,
and saved to `~/.ephemeralos/.env` (mode `600`). They are never typed into, sent to, or spoken
by the orb. Re-run it any time to change a key; your persona and memory files are never
overwritten.

The wake word is detected in the browser with [openWakeWord](https://github.com/dscripka/openWakeWord).
Its pretrained models are CC BY-NC-SA 4.0 (personal, non-commercial use), so `init` downloads
them to your machine rather than ephemeralOS bundling them. Skip them and a click on the page
starts a conversation instead. A custom "Hey Orb" model is on the roadmap.

A USB speakerphone helps a lot across a room: it cancels echo far better than laptop speakers.

### Development

```sh
pnpm dev                # gateway (watch) + Vite on http://localhost:5173
```

In development builds, the keyboard drives the orb so you can see every state:

| Key                                            | Action                                                       |
| ---------------------------------------------- | ------------------------------------------------------------ |
| <kbd>Space</kbd> / <kbd>→</kbd> / <kbd>←</kbd> | Next / previous state                                        |
| <kbd>1</kbd>–<kbd>5</kbd>                      | Zen, listening, thinking, speaking, error                    |
| <kbd>A</kbd>                                   | Voice preview: talking switches to listening (without a key) |
| <kbd>D</kbd>                                   | Show or hide a demo card (the orb moves into open space)     |
| <kbd>P</kbd>                                   | Frame-time readout                                           |
| <kbd>V</kbd>                                   | Toggle simulated voice output (without a key)                |
| <kbd>W</kbd>                                   | Wake: start a voice session without saying the wake word     |

None of this exists in production builds.

## How it fits together

```
Browser (the body)                          Gateway (local Node process, 127.0.0.1)
┌────────────────────────────────┐          ┌───────────────────────────────────────┐
│ Orb (three.js plasma shader)   │          │ Serves the client, injects a          │
│ Audio levels (AnalyserNode)    │◀── WS ──▶│   per-launch token                    │
│ Wake word (openWakeWord, WASM) │  token,  │ Mints short-lived Realtime secrets;   │
│ Voice session (WebRTC)         │  origin, │   the API key never leaves            │
│ Display components (M3)        │  host    │ Tool calls, transcripts; jobs and     │
└───────────────┬────────────────┘  checked │   memory from M4–M5                   │
                │                           └───────────────────────────────────────┘
                │ audio + events, only while a session is open
                ▼
        OpenAI Realtime
```

| Package                                | Role                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| [`packages/gateway`](packages/gateway) | Local control plane: HTTP, WebSocket, Realtime secrets, tools     |
| [`packages/web`](packages/web)         | The browser body: orb, audio, wake word, voice session, display   |
| [`packages/cli`](packages/cli)         | `ephemeralos init` and `ephemeralos start`                        |
| [`packages/shared`](packages/shared)   | zod schemas and types shared by all of them                       |
| [`home`](home)                         | Starting persona, memory and settings, copied to `~/.ephemeralos` |

## Privacy

The wake word is detected in the browser; until it fires, no audio leaves your machine. Audio
then goes to OpenAI only while a voice session is open, and the session closes on a sleep phrase
or ten seconds of silence. From M4, delegated tasks go to Anthropic. Keys, persona, memory and
transcripts (`transcripts/YYYY-MM-DD.jsonl`) stay in `~/.ephemeralos/`.

## Roadmap

- [x] **M0** Scaffold: workspace, gateway, tokens, type, CI
- [x] **M1** The orb: plasma, five states, audio-shaped, glides into open space
- [x] **M2** Voice loop: `init`, wake word, Realtime session, barge-in, fallback
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
