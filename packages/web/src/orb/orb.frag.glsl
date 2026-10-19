// The orb: a ball of soft, flowing plasma resting on a paper-white page.
//
// Drawn analytically (one disc, domain-warped noise, no raymarching) so it holds
// 60 fps on integrated graphics. Everything is computed in linear light and encoded
// to sRGB at the end, so the plasma's glow and the page blend correctly.

precision highp float;

varying vec2 vUv;

// Contract from the brief.
uniform float uTime;        // seconds
uniform float uState[5];    // blend weights: zen, listening, thinking, speaking, error
uniform float uInputLevel;  // mic, 0..1
uniform float uOutputLevel; // voice output, 0..1
uniform vec4 uBands;        // voice output bands, low → high, 0..1
uniform float uSpectrumIn[32];  // mic spectrum, log-spaced, low → high, 0..1
uniform float uSpectrumOut[32]; // voice output spectrum, log-spaced, low → high, 0..1

// Layout.
uniform vec2 uResolution;   // drawing-buffer pixels
uniform vec2 uCenter;       // drawing-buffer pixels
uniform float uRadius;      // drawing-buffer pixels

// Look, pre-blended on the CPU from look.ts. Colours are linear.
uniform vec3 uBackground;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uIntensity;
uniform float uWarp;
uniform float uRipple;
uniform float uBreath;
uniform float uPulse;
uniform float uAura;
uniform float uSwirlPhase;  // integrated on the CPU so speed changes never jump
uniform float uFlowPhase;

// --- Noise -----------------------------------------------------------------
// 3D simplex noise, Ashima Arts / Stefan Gustavson (MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Sample a spectrum at u ∈ [0, 1] with smooth interpolation between bins, so the
// edge it shapes stays a curve rather than a polygon.
float spectrumIn(float u) {
  float x = clamp(u, 0.0, 1.0) * 31.0;
  int i = int(floor(x));
  return mix(uSpectrumIn[i], uSpectrumIn[min(i + 1, 31)], smoothstep(0.0, 1.0, fract(x)));
}

float spectrumOut(float u) {
  float x = clamp(u, 0.0, 1.0) * 31.0;
  int i = int(floor(x));
  return mix(uSpectrumOut[i], uSpectrumOut[min(i + 1, 31)], smoothstep(0.0, 1.0, fract(x)));
}

// Interleaved gradient noise; dithers away banding in the soft gradients.
float dither(vec2 frag) {
  return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
}

mat2 rotate(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 frag = vUv * uResolution;
  vec2 p = (frag - uCenter) / uRadius;

  float listening = uState[1];
  float speaking = uState[3];

  // --- Silhouette: the audio itself shapes the edge ----------------------------
  // The spectrum wraps the orb symmetrically: lows at the bottom, highs at the top.
  float around = abs(atan(p.x, -p.y)) / 3.14159265;
  float angle = atan(p.y, p.x);
  vec2 ring = vec2(cos(angle), sin(angle));
  float breath = uBreath * sin(uTime * 0.9);
  float voiceIn = uRipple * 0.12 * spectrumIn(around);
  float voiceOut = uPulse * (0.10 * spectrumOut(around) + 0.04 * uOutputLevel);
  float drift = uRipple * 0.008 * snoise(vec3(ring * 1.4, uTime * 0.8));
  float radius = 1.0 + breath + voiceIn + voiceOut + drift;

  float r = length(p) / radius;
  vec2 q = p / radius;
  float aa = 1.5 / (uRadius * radius);
  // A crisp, pixel-accurate edge.
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);

  // --- Aura: the orb's light falling on the page -----------------------------
  vec3 auraColor = mix(uColorA, uColorB, 0.5);
  float outside = max(r - 1.0, 0.0);
  float aura = uAura * (0.55 * exp(-outside * 5.0) + 0.25 * exp(-outside * 1.6));
  vec3 page = mix(uBackground, auraColor, clamp(aura, 0.0, 1.0));

  vec3 color = page;

  if (r < 1.0 + aa) {
    // Curve the plane onto a sphere so the plasma reads as a volume.
    float z = sqrt(max(1.0 - dot(q, q), 0.0));
    vec2 s = q * (1.3 - 0.4 * z);
    s = rotate(uSwirlPhase * (1.1 - 0.6 * length(s))) * s;

    // --- Plasma: large, slow fields of colour, gently folded by a warp --------
    vec3 P = vec3(s * 0.75, uFlowPhase);
    vec2 w = vec2(snoise(P), snoise(P + vec3(5.2, 1.3, 2.7)));
    vec2 sw = s * 0.75 + uWarp * 0.45 * w;
    float n1 = snoise(vec3(sw, uFlowPhase * 1.2 + 1.7));
    float n2 = snoise(vec3(sw * 1.3 + 4.0, uFlowPhase * 0.9 + 3.1));
    float n3 = snoise(vec3(sw * 1.6 + 9.0, uFlowPhase * 1.5 + 5.3));

    vec3 plasma = mix(uColorA, uColorB, smoothstep(-0.6, 0.6, n1));
    plasma = mix(plasma, uColorC, smoothstep(0.0, 0.8, n2) * 0.8);

    // Soft hot spots drifting through the volume: the plasma's glow.
    float hot = smoothstep(0.15, 0.95, n3);
    // Fine filaments give the plasma definition up close.
    float n4 = snoise(vec3(sw * 3.4 + 2.0, uFlowPhase * 2.0 + 7.0));
    float fine = pow(1.0 - abs(n4), 16.0);
    float core = exp(-dot(q, q) * 2.2);

    // Inside, the same audio lights concentric shells: lows at the core, highs at the rim.
    float rr = length(q);
    float shells = listening * spectrumIn(rr) * 0.5 + speaking * (
        uBands.x * exp(-rr * rr * 6.0)
      + uBands.y * exp(-pow((rr - 0.3) * 7.0, 2.0))
      + uBands.z * exp(-pow((rr - 0.52) * 8.0, 2.0))
      + uBands.w * exp(-pow((rr - 0.72) * 9.0, 2.0)));

    float energy = uIntensity
      * (1.0 + 0.7 * listening * uInputLevel + 0.4 * speaking * uOutputLevel);
    float glow = clamp((hot * 0.5 + core * 0.22 + fine * 0.14) * energy + shells * 0.35, 0.0, 1.0);
    plasma = mix(plasma, vec3(1.0), glow);

    // Volume: light gathers at the rim, with a soft key light from above.
    float rim = pow(1.0 - z, 3.0);
    plasma = mix(plasma, mix(uColorB, vec3(1.0), 0.5), rim * 0.45);
    vec3 keyDir = normalize(vec3(-0.4, 0.6, 0.7));
    float sheen = pow(max(dot(vec3(q, z), keyDir), 0.0), 18.0) * 0.18;
    plasma += sheen;
    // A hairline of light right at the edge keeps the silhouette sharp.
    float edgePx = (1.0 - r) / aa;
    plasma = mix(plasma, vec3(1.0), exp(-edgePx * 0.6) * 0.35);

    color = mix(page, plasma, body);
  }

  color = linearToSrgb(clamp(color, 0.0, 1.0));
  color += (dither(frag) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(color, 1.0);
}
