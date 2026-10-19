# Performance

**Budget:** the orb holds 60 fps on integrated graphics (e.g. Intel Iris Xe, UHD 620/770, or
Apple M-series efficiency modes) at the display's native resolution, with `p95` frame time at
or under 16.7 ms.

## How it stays inside the budget

- **No raymarching, no post-processing.** The orb is one analytic disc curved onto a sphere,
  drawn in a single full-screen pass
  ([`orb.frag.glsl`](../packages/web/src/orb/orb.frag.glsl)). Pixels outside it skip the
  noise entirely and only compute the aura.
- **Bounded noise.** Inside the orb: six simplex samples (two for the warp, three colour
  fields, one for the edge ripple). Nothing loops on screen size.
- **Adaptive resolution.** [`QualityGovernor`](../packages/web/src/perf/frame-meter.ts) drops
  the render scale in 0.25 steps (down to 0.6×) after 1.5 s of slow frames and climbs back
  after 5 s of headroom, so a weak GPU degrades to slightly softer pixels, never to stutter.
- **Pixel ratio capped at 2×.** A 4K panel does not render 4× the pixels for a soft glow.
- **Reduced motion.** With `prefers-reduced-motion`, motion amplitudes and speeds drop to 30%.

## How to measure

1. `pnpm build && pnpm start`, then open `http://localhost:4317/?perf` in Chrome. (In dev,
   press <kbd>P</kbd> instead.)
2. Check `chrome://gpu` shows **WebGL: Hardware accelerated**. Plug the laptop in and close
   other GPU-heavy tabs.
3. Go full screen. The readout in the top-left shows rolling stats over the last 240 frames:
   average fps, p95 frame time, the share of frames over 25 ms, and the current render scale.
4. Watch each state for 30 s (dev build: keys <kbd>1</kbd>–<kbd>5</kbd>; the `speaking` state
   uses simulated voice output).
5. **Pass:** ≥ 59 fps average, p95 ≤ 16.7 ms, drops < 1%, and render scale still at the
   device's native ratio (the governor never had to step down).

For a frame-by-frame view, record 10 s in DevTools → Performance and check the Frames track
for long frames and the GPU track for the orb pass.

## Results

| Date | Machine | GPU | Resolution | State | fps | p95 | Scale |
| ---- | ------- | --- | ---------- | ----- | --- | --- | ----- |
| —    | —       | —   | —          | —     | —   | —   | —     |

Add a row when you measure on real hardware. Headless CI runs Chrome's software rasteriser
(SwiftShader), whose numbers say nothing about a GPU, so CI checks rendering, not speed.
