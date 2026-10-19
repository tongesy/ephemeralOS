# API verification

The brief marks several provider details [verify]. These were checked against official
documentation on **2026-10-19**. Re-check before each milestone that depends on them.

## OpenAI Realtime (voice, M2)

| Topic                | Finding                                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Models               | `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`. Both support function calling and configurable reasoning effort (default `low`). **Default for ephemeralOS: `gpt-realtime-2.1-mini`** (≈⅓ the audio cost).                                                                   |
| Ephemeral credential | Gateway calls `POST /v1/realtime/client_secrets` with the real key and `{ session: { type: "realtime", model, audio: { output: { voice } } } }`. The response's `value` is the browser's short-lived key. Expiry is not documented on the WebRTC guide.                      |
| WebRTC               | Browser POSTs its SDP offer to `/v1/realtime/calls` (`Content-Type: application/sdp`, `Authorization: Bearer <ephemeral key>`); the response body is the SDP answer. Events flow over the `oai-events` data channel.                                                         |
| Alternative          | "Unified interface": the gateway forwards the SDP to `/v1/realtime/calls` itself. Not used; the ephemeral-key flow keeps the gateway out of the media path.                                                                                                                  |
| Inject + respond     | `conversation.item.create` (a `message` with `input_text`), then `response.create`. Out-of-band responses: `response.create` with `response.conversation: "none"` and `metadata`.                                                                                            |
| Tool calls           | `response.done` carries `function_call` items (`name`, `arguments`, `call_id`). Reply with `conversation.item.create` of type `function_call_output` and the same `call_id`, then `response.create`.                                                                         |
| Barge-in             | Over WebRTC the server truncates unplayed audio itself when the user interrupts. Turn detection: `semantic_vad` or `server_vad`.                                                                                                                                             |
| Session limit        | 60 minutes. Long sessions resend context, so cost grows with length.                                                                                                                                                                                                         |
| Events used          | `input_audio_buffer.speech_started` / `speech_stopped`, `output_audio_buffer.started` / `stopped` / `cleared` (WebRTC only), `conversation.item.input_audio_transcription.completed`, `response.output_audio_transcript.done`, `response.done`. Rechecked while building M2. |
| Safety identifier    | Server-side requests should send `OpenAI-Safety-Identifier`.                                                                                                                                                                                                                 |

Sources: [Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc),
[Realtime conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations),
[gpt-realtime-2.1 launch coverage](https://www.marktechpost.com/2026/07/06/openai-gpt-realtime-2-1-mini-reasoning-realtime-api/).

## Open-Meteo (weather, M3)

| Topic     | Finding                                                                                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geocoding | `GET https://geocoding-api.open-meteo.com/v1/search?name=…&count=1` returns `results[]` with `name`, `latitude`, `longitude`, `country`, `admin1`.                                                                                              |
| Forecast  | `GET https://api.open-meteo.com/v1/forecast` with `current=temperature_2m,weather_code`, `daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`, `timezone=auto`, `forecast_days` (1–16), `temperature_unit`. |
| Codes     | `weather_code` is a WMO code (0 clear, 1–3 cloud, 45/48 fog, 51–67 drizzle and rain, 71–86 snow, 95–99 thunder).                                                                                                                                |
| Terms     | No key. Free for non-commercial use under 10,000 calls a day; attribution "Weather data by Open-Meteo.com" (CC BY 4.0).                                                                                                                         |

Sources: [Forecast API](https://open-meteo.com/en/docs), [Geocoding API](https://open-meteo.com/en/docs/geocoding-api), [Terms](https://open-meteo.com/en/terms).

## Anthropic (brain, M4)

| Topic      | Finding                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Models     | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.                                                                                                                                                                                            |
| Web search | `{ type: "web_search_20260318", name: "web_search" }` with `max_uses`, `allowed_domains` or `blocked_domains`, and `user_location`. Uses dynamic filtering by default; `allowed_callers: ["direct"]` turns it off. $10 per 1,000 searches plus tokens. |
| Tool use   | Messages API `tools` with a JSON Schema `input_schema`, which we generate from the shared zod schemas.                                                                                                                                                 |

Source: [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).

Rechecked 2026-10-19 for the `search` tool: versions are `web_search_20250305`,
`web_search_20260209` and `web_search_20260318`; the dynamic-filtering versions need
programmatic tool calling, so `search` uses the basic `web_search_20250305` with `max_uses: 3`
on `claude-haiku-5-5`. The reply holds `server_tool_use`, `web_search_tool_result`, then `text`
blocks whose `citations` are `web_search_result_location` (`url`, `title`, `cited_text`). A
long turn can stop with `pause_turn`; send the assistant content back unchanged to continue.
`user_location` is `{ type: "approximate", city?, region?, country?, timezone? }`.

## OpenAI web search (brain without an Anthropic key, M4)

| Topic    | Finding                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint | `POST /v1/responses` with `tools: [{ type: "web_search", search_context_size, user_location, filters }]`. `tool_choice: "required"` forces a search.                           |
| Reply    | `output[]` holds a `web_search_call` item, then a `message` whose `output_text` content has `annotations` of type `url_citation` (`url`, `title`, `start_index`, `end_index`). |
| Model    | `gpt-6-luna` (fast, cheapest; supports web search in Responses). Reasoning effort `low`.                                                                                       |
| Cost     | $10 per 1,000 searches plus search content tokens at model rates.                                                                                                              |

Sources: [OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search), [gpt-6-luna](https://developers.openai.com/docs/models/gpt-6-luna), [Pricing](https://developers.openai.com/api/docs/pricing).

## Logos (search layouts, M4)

| Topic     | Finding                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| logo.dev  | `GET https://img.logo.dev/<domain>?token=pk_…&size=128&format=png&fallback=404`. The publishable key goes in `token`; `fallback=404` returns 404 instead of a monogram. No SVG. |
| Keyless   | Google `https://www.google.com/s2/favicons?domain=<domain>&sz=128`, then DuckDuckGo `https://icons.duckduckgo.com/ip3/<domain>.ico` (unofficial; 404 with a grey placeholder).  |
| Checking  | Neither service is trusted for content type: the gateway reads the bytes' signature (PNG, JPEG, GIF, WebP, ICO), caps size at 256 KB and drops tiny placeholders.               |
| Unchecked | Not reachable from the build sandbox; tested with stand-ins only. Re-check against the live services.                                                                           |

Sources: [logo.dev images](https://www.logo.dev/docs/logo-images/get), [logo.dev CDN](https://logo.dev/docs/logo-images/introduction), [DuckDuckGo favicon notes](https://www.logo.dev/docs/duckduckgo-favicon-api).

## Wikipedia photos (cards, M4)

| Topic     | Finding                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint  | `GET https://en.wikipedia.org/api/rest_v1/page/summary/<Title_with_underscores>`; `thumbnail.source` is on `upload.wikimedia.org`.      |
| Pages     | `type: "disambiguation"` pages are skipped. A thumbnail URL's `/<n>px-` segment is asked for at 640 px first, then as given.            |
| Etiquette | Wikimedia blocks generic clients: requests send `User-Agent: ephemeralOS (https://github.com/tongesy/ephemeralOS)`.                     |
| Unchecked | Field names are from memory and secondary docs; the live API wasn't reachable from the build sandbox. Re-check against a real response. |

## Podcasts and YouTube (media, M4)

Checked 2026-10-19 against the documentation and forum answers below. The gateway can't reach
Apple from the build container, so the episode fields come from those sources and the tests
use recorded shapes; re-check against a live response.

| Topic          | Finding                                                                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Podcast search | `GET https://itunes.apple.com/search?term=…&media=podcast&entity=podcast` returns `results[]` with `collectionId`, `collectionName`, `artistName`, `artworkUrl600`. No key.                                                                                    |
| Episodes       | `GET https://itunes.apple.com/lookup?id=<collectionId>&media=podcast&entity=podcastEpisode&limit=50`: the show first, then episodes with `trackName`, `episodeUrl` (the audio file), `releaseDate`, `trackTimeMillis`. Not sorted; sort by `releaseDate`.      |
| Artwork        | On `is<n>-ssl.mzstatic.com`; the gateway fetches only from those hosts.                                                                                                                                                                                        |
| YouTube check  | `GET https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json` returns `title` and `author_name`; 401 when the owner disabled embedding, 404 when there is no such video. No key.                                                   |
| Embed          | `https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&autoplay=1…`. The player needs a referrer: a `Referrer-Policy` that strips it (our page sends `no-referrer`) gives error 153, so the frame sets `referrerpolicy="strict-origin-when-cross-origin"`. |
| Control        | With `enablejsapi=1` the frame takes `postMessage` commands (`{"event":"command","func":"pauseVideo","args":[]}`) and, after `{"event":"listening"}`, reports `onStateChange` and `infoDelivery` (`playerState`, `currentTime`, `duration`).                   |
| Posters        | `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` (not always present; then `sddefault`, `hqdefault`).                                                                                                                                                           |

Sources: [Lookup episodes with the iTunes API](https://developer.apple.com/forums/thread/654141),
[iTunes Search API](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/),
[YouTube error 153](https://til.simonwillison.net/youtube/fixing-153-embed).

## Wake word (local, M2)

| Topic          | Finding                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine         | openWakeWord runs in Chrome on `onnxruntime-web` (WASM; the WebGL backend lacks the melspectrogram ops).                                                                      |
| Pipeline       | 16 kHz mono in 80 ms chunks → `melspectrogram.onnx` → `embedding_model.onnx` (96-d) → wake-word model, confirmed by a VAD. About 1.3 s of warm-up before the first detection. |
| Custom phrases | Pre-trained models include "hey jarvis", "alexa" and "hey mycroft". "Hey Orb" needs a custom model from the openWakeWord training notebook (~45 min).                         |
| Plan           | Ship on "hey jarvis" in M2 and train "Hey Orb" alongside it. Measure CPU on real hardware then.                                                                               |

Sources: [openWakeWord](https://github.com/dscripka/openWakeWord),
[Open Wake Word on the Web](https://deepcorelabs.com/open-wake-word-on-the-web/).

## Meta Model API (v0.2)

Not verified yet; deferred to the v0.2 adapter.
