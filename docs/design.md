# Design

**Direction:** clean, Scandinavian, glassy, beautiful type. Nordic daylight: a warm paper-white
page, soft ink, and a handful of clear pastel accents. The orb is a ball of soft, glowing
plasma that casts a faint coloured light onto the page. Calm, unbouncy motion.

## One palette

Every colour comes from [`theme/palette.ts`](../packages/web/src/theme/palette.ts). It is
applied to CSS as `--eos-*` custom properties at boot, read by the orb's look table, and (from
M3) used for Vega-Lite chart series, so the orb, cards and charts read as one object.

| Token     | Hex       | Use                            |
| --------- | --------- | ------------------------------ |
| `paper`   | `#F7F5F2` | Background                     |
| `ink`     | `#1C1B19` | Primary type                   |
| `stone`   | `#76716B` | Secondary type                 |
| `mist`    | `#C9C4BD` | Tertiary type, hairlines       |
| `fjord`   | `#6E9DB3` | Zen plasma, first chart series |
| `azure`   | `#4FA3D1` | Listening plasma               |
| `glacier` | `#9CD3E2` | Zen and listening plasma       |
| `heather` | `#9A8CD0` | Thinking plasma                |
| `lilac`   | `#C9B6EC` | Zen and thinking accents       |
| `sand`    | `#E8C08F` | Speaking plasma                |
| `coral`   | `#E8937A` | Speaking plasma, chart series  |
| `rose`    | `#DE8FAE` | Speaking accent                |
| `moss`    | `#8DB59A` | Listening accent, chart series |
| `clay`    | `#B98E70` | Error (calm, never alarming)   |

## Type

Geist for text and Geist Mono for numbers, both self-hosted variable fonts
(`@fontsource-variable/*`), so nothing is fetched from a CDN. Generous sizes, light-to-regular
weights, slightly tight tracking on headings (`--eos-tracking-tight`), tabular figures for
data.

## Glass

The `.glass` utility in [`base.css`](../packages/web/src/styles/base.css): frosted white at
62%, an 8% ink hairline, a white inner highlight, a soft diffuse shadow and a 24 px backdrop
blur. Restraint over effect.

## The orb

A ball of plasma: large, slow fields of colour folded by a gentle domain warp, with soft hot
spots that drift through it and light gathering at the rim. Its aura tints the page around
it. Each state is a row in the look table in [`orb/look.ts`](../packages/web/src/orb/look.ts):

| State       | Feel                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| `zen`       | Small, faint and half see-through; barely moving; reads as asleep       |
| `listening` | Swells to full size in bright azure; the edge ripples with your voice   |
| `thinking`  | Heather and lilac; the plasma turns in a slow vortex                    |
| `speaking`  | Warm coral, sand and rose; the core and its shells pulse with the voice |
| `error`     | Muted clay and stone, nearly still; distinct but calm                   |

To tune the look, edit the numbers in that table: the three `colors`, `intensity`, `warp`,
`swirl`, `flow`, `ripple`, `breath`, `pulse`, `aura`, `size` and `opacity`. The shader blends
between rows, so a change to one state never breaks a transition.

Asleep and awake must never be confused. When the microphone opens after the wake word, the
orb swells to `listening` and a soft rising chime plays (`audio/chime.ts`, synthesised); a
falling chime marks going back to sleep. These are the only sounds ephemeralOS makes itself.

## Space

The orb is small (a radius of 4.25% of the shorter screen side) and centred, so the page reads as clean
and open. When content appears it fades into existence (opacity, a slight lift and a soft
focus pull; [`surface.css`](../packages/web/src/styles/surface.css)), and the orb glides into
the most open space left on screen at a smaller size
([`placement.ts`](../packages/web/src/orb/placement.ts)). When the content fades out, the orb
drifts back to the centre.

## Sound

The orb's shape is the audio. The microphone and voice output are each read as a 32-bin
log-spaced spectrum ([`audio-levels.ts`](../packages/web/src/audio/audio-levels.ts)) and
wrapped symmetrically around the edge, lows at the bottom and highs at the top. The same
spectrum lights concentric shells inside: lows at the core, highs near the rim.

## Motion

State changes cross-fade over 450 ms with a quintic ease. Moves between spaces use a
critically damped spring ([`spring.ts`](../packages/web/src/orb/spring.ts)): they ease in and
out, never overshoot, and can change course mid-flight.
Speeds are integrated over time on the CPU, so changing state never makes the swirl jump.
`prefers-reduced-motion` keeps every state but cuts motion to 30%.

## History

M1 first shipped a glass sphere with an internal light on black, with a bloom pass. It was
replaced by the plasma on white before merge.
