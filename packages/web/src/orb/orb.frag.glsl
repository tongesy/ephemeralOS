// The orb: a glass sphere holding a soft, drifting light.
//
// Drawn analytically (one ray-sphere hit per pixel, no raymarching) so it holds
// 60 fps on integrated graphics. Bloom is added afterwards by the post pipeline.

precision highp float;

varying vec2 vUv;

// Contract from the brief.
uniform float uTime;        // seconds
uniform float uState[5];    // blend weights: zen, listening, thinking, speaking, error
uniform float uInputLevel;  // mic, 0..1
uniform float uOutputLevel; // voice output, 0..1
uniform vec4 uBands;        // voice output bands, low → high, 0..1

// Layout.
uniform vec2 uResolution;   // drawing-buffer pixels
uniform vec2 uCenter;       // drawing-buffer pixels
uniform float uRadius;      // drawing-buffer pixels

// Look, pre-blended on the CPU from look.ts.
uniform vec3 uCore;
uniform vec3 uDeep;
uniform vec3 uRim;
uniform float uIntensity;
uniform float uRipple;
uniform float uBreath;
uniform float uPulse;
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

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * snoise(p);
    p = p * 2.02 + 7.13;
    amp *= 0.5;
  }
  return sum;
}

// Interleaved gradient noise; dithers away banding in the dark gradients.
float dither(vec2 frag) {
  return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
}

mat2 rotate(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 frag = vUv * uResolution;
  vec2 p = (frag - uCenter) / uRadius;

  float listening = uState[1];
  float speaking = uState[3];

  // --- Silhouette: breathing, listening ripples, speaking bloom ------------
  float r0 = length(p);
  float angle = atan(p.y, p.x);
  vec2 ring = vec2(cos(angle), sin(angle));

  float breath = uBreath * sin(uTime * 0.9);
  float pulse = uPulse * (0.07 * uOutputLevel + 0.035 * uBands.x);
  float rippleAmp = uRipple * (0.008 + 0.032 * uInputLevel);
  float ripple = rippleAmp * (
      0.6 * snoise(vec3(ring * 1.4, uTime * 0.8))
    + 0.4 * sin(angle * 6.0 - uTime * 2.4));
  float radius = 1.0 + breath + pulse + ripple;

  float r = r0 / radius;
  vec2 q = p / radius;
  float aa = 1.5 / (uRadius * radius);
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);

  vec3 color = vec3(0.0);

  if (r < 1.0 + aa) {
    // --- Glass surface ------------------------------------------------------
    float z = sqrt(max(1.0 - dot(q, q), 0.0));
    vec3 n = vec3(q, z);
    float fresnel = pow(1.0 - z, 4.0);
    vec3 keyDir = normalize(vec3(-0.45, 0.62, 0.64));

    // Look through the glass: refraction pulls the interior towards the centre.
    vec3 refr = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / 1.45);
    vec2 inner = q * 0.78 + refr.xy * 0.2;

    // Vortex: the centre turns faster than the edge.
    float rr = length(inner);
    inner = rotate(uSwirlPhase * (1.25 - rr)) * inner;

    // --- The light inside ---------------------------------------------------
    // A soft core, slow clouds around it, and fine ridged filaments of light.
    float cloud = fbm(vec3(inner * 1.25, uFlowPhase));
    float ridge = 1.0 - abs(snoise(vec3(inner * 2.1 + 5.0, uFlowPhase * 1.3 + 2.0)));
    float filaments = pow(ridge, 6.0) * smoothstep(0.95, 0.15, rr);
    float core = exp(-dot(inner, inner) * (7.0 - 2.5 * listening * uInputLevel));

    // Speaking: each band lights its own shell, low at the core, high at the rim.
    float bands = speaking * (
        uBands.x * exp(-rr * rr * 6.0)
      + uBands.y * exp(-pow((rr - 0.3) * 7.0, 2.0))
      + uBands.z * exp(-pow((rr - 0.52) * 8.0, 2.0))
      + uBands.w * exp(-pow((rr - 0.72) * 9.0, 2.0)));

    float energy = uIntensity
      * (1.0 + 0.45 * listening * uInputLevel + 0.4 * speaking * uOutputLevel);
    float glow = core * (0.9 + 0.45 * cloud) + 0.5 * filaments * (0.2 + core) + 0.4 * bands;
    // Shaped in linear light: squaring keeps the dim regions genuinely dark after sRGB.
    glow = glow * glow * energy * 1.4;

    // The medium stays dark and clear, so the glass reads as glass, not stone.
    vec3 medium = uDeep * (0.12 + 0.08 * cloud) * (1.0 - 0.6 * r * r);
    vec3 light = mix(uRim * uRim, uCore, smoothstep(0.02, 0.7, glow)) * glow * 1.8;

    // Light through a glass ball gathers on the rim opposite the key light.
    vec2 dir = q / max(length(q), 1e-4);
    float caustic = smoothstep(0.7, 0.97, r) * pow(max(dot(dir, -keyDir.xy * 1.25), 0.0), 3.0);
    vec3 interior = medium + light + uCore * caustic * 0.22 * energy;

    // --- Glass: thin rim light, a crisp highlight and a broad soft sheen ----
    float spec = pow(max(dot(reflect(-keyDir, n), vec3(0.0, 0.0, 1.0)), 0.0), 220.0);
    float sheen = pow(max(dot(n, keyDir), 0.0), 10.0) * 0.07;
    vec3 rim = uRim * fresnel * (0.5 + 0.5 * uIntensity);
    vec3 glass = rim + vec3(spec * 0.85 + sheen);

    color = (interior * (1.0 - 0.5 * fresnel) + glass) * body;
  }

  // --- Halo: a soft falloff into the black, never a neon ring --------------
  float outside = max(r - 1.0, 0.0);
  float halo = exp(-outside * 9.0) * 0.10 + exp(-outside * 2.6) * 0.035;
  color += uRim * halo * uIntensity * (1.0 - body);

  color += (dither(frag) - 0.5) / 255.0;
  gl_FragColor = vec4(max(color, 0.0), 1.0);
}
