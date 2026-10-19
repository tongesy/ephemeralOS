# Design

**Direction:** clean, Scandinavian, glassy, beautiful type. Nordic dusk: warm linen and stone
for type and glass, muted natural accents, set against true black so the orb owns the room.
Calm, unbouncy motion. A soft glow, never neon.

## One palette

Every colour comes from [`theme/palette.ts`](../packages/web/src/theme/palette.ts). It is
applied to CSS as `--eos-*` custom properties at boot, read by the orb's look table, and (from
M3) used for Vega-Lite chart series, so the orb, cards and charts read as one object.

| Token     | Hex       | Use                          |
| --------- | --------- | ---------------------------- |
| `void`    | `#000000` | Background                   |
| `linen`   | `#F3EFE8` | Primary type, glass light    |
| `stone`   | `#A8A199` | Secondary type               |
| `slate`   | `#5E5A55` | Tertiary type, hairlines     |
| `fjord`   | `#8FB3C2` | Zen rim, first chart series  |
| `frost`   | `#D6E6EC` | Listening rim                |
| `heather` | `#B4ABD3` | Thinking rim                 |
| `sand`    | `#E8D6BA` | Speaking rim                 |
| `clay`    | `#C29A78` | Error (calm, never alarming) |
| `moss`    | `#9DB39A` | Chart series                 |

The background stays black, as the brief asks; the warm tones live in the type and the glass.

## Type

Geist for text and Geist Mono for numbers, both self-hosted variable fonts
(`@fontsource-variable/*`), so nothing is fetched from a CDN. Generous sizes, light-to-regular
weights, slightly tight tracking on headings (`--eos-tracking-tight`), tabular figures for
data.

## Glass

The `.glass` utility in [`base.css`](../packages/web/src/styles/base.css): a 6% linen fill,
a 14% linen hairline, a soft diffuse shadow and a 24 px backdrop blur. Restraint over effect.

## The orb

A glass sphere holding a soft, drifting light. Each state is a row in the look table in
[`orb/look.ts`](../packages/web/src/orb/look.ts):

| State       | Feel                                                     |
| ----------- | -------------------------------------------------------- |
| `zen`       | Dim, cool, almost still; breathes slowly                 |
| `listening` | Brighter and whiter; the surface ripples with your voice |
| `thinking`  | Heather-tinted; the light turns in a slow vortex         |
| `speaking`  | Warm; the core and its shells pulse with the voice bands |
| `error`     | Low clay glow, nearly still; distinct but calm           |

To tune the look, edit the numbers in that table: colours, `intensity`, `swirl`, `flow`,
`ripple`, `breath` and `pulse`. The shader blends between rows, so a change to one state never
breaks a transition. Bloom strength lives in [`orb/orb.ts`](../packages/web/src/orb/orb.ts).

## Motion

State changes cross-fade over 450 ms with a quintic ease. Docking eases continuously.
Speeds are integrated over time on the CPU, so changing state never makes the swirl jump.
`prefers-reduced-motion` keeps every state but cuts motion to 30%.
