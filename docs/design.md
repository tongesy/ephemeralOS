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

## Weather scenes

While a weather surface is on screen, the page becomes the weather outside right now, the way
a window would show it: a sky that follows the time of day (stars and the moon at night),
clouds drifting with the wind, haze for fog, three depths of rain or snow, lightning in a
storm, and raindrops beading and running down the glass in front of it all. Glass cards sit
on top and frost what is behind them. When the surface goes, the page fades back to paper.

The sky's colours are `skyPalette` in [`theme/palette.ts`](../packages/web/src/theme/palette.ts);
every other knob (cloud cover, haze, rain, snow, drops, storm) is in the look table in
[`scene/scene-look.ts`](../packages/web/src/scene/scene-look.ts), set from the weather code,
how heavy it is, day or night, and the wind. Changes between weathers ease over about a
second. With `prefers-reduced-motion`, everything moves at 30% and lightning is softened.

The weather is drawn on its own canvas beneath everything; the orb has a transparent canvas
above it all, so it is never hidden by a picture.

## What is playing

Ask for a podcast, a song or a video and it plays on the page
([`media/media-player.ts`](../packages/web/src/media/media-player.ts),
[`styles/media.css`](../packages/web/src/styles/media.css)):

- **A podcast** arrives as a glass card beside the orb: the show's artwork large and square,
  the show in small capitals, the episode title, its date and length, and a hairline of
  progress with the time in Geist Mono. After twenty seconds on its own it settles into a
  small player in the bottom-left corner (artwork, title, progress), and it comes forward
  again while you talk about it. The orb sways gently to the sound.
- **A video or a piece of music** plays in a wide rounded screen, YouTube's poster first;
  the player fades in over it once the video is actually playing. It stays large while you
  watch, and glides into the corner when something else is shown.
- While a conversation is open, whatever is playing drops to 12% at once and comes back up
  gently afterwards, so the microphone hears you and you can still follow it. Paused, the
  progress line goes grey and the time breathes slowly; paused for ten minutes, it goes.

## Editorial layouts

When a picture tells it best, a surface is laid out like a magazine spread rather than a
glass card ([`display/editorial.ts`](../packages/web/src/display/editorial.ts),
[`styles/editorial.css`](../packages/web/src/styles/editorial.css)):

- **Hero:** one photo full bleed, a small uppercase kicker, the headline set large over it
  and a short dek, on a soft ink scrim from the bottom left so the type always reads.
- **Gallery:** a mosaic of up to eight, the first picture large and the rest arranged by
  count, each captioned over a gradient.
- **Slideshow:** one picture at a time, full screen. Each slide drifts slowly (Ken Burns,
  alternating direction) and crossfades into the next every 6.5 s; the old caption leaves
  before the new one arrives. "Next" and "back" step through the slides first.

Photos develop in once they have loaded rather than popping in. A hero whose picture fails
becomes an ordinary glass card. With `prefers-reduced-motion` the drift stops.
