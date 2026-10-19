// The page behind everything when it is showing the weather: the scene (rendered at half
// resolution by weather.frag.glsl) seen through the window, with raindrops on the glass
// drawn here at full resolution so they stay crisp. Written premultiplied by `uMix`, so
// as the scene fades the paper beneath shows through.

precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;   // drawing-buffer pixels
uniform float uTime;
uniform sampler2D uScene;   // linear light
uniform float uMix;         // 0: paper, 1: the scene
uniform float uDrops;       // raindrops on the glass, 0..1

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Raindrops on the glass in front of the sky, one grid of cells per size. Each cell may
// hold a drop that beads, swells and fades, and some slide down their cell. Returns the
// refraction offset (xy) and how much of a drop is here (z).
vec3 dropLayer(vec2 g, float t, float density) {
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(cell);
  if (h > density) return vec3(0.0);
  float life = fract(t * (0.04 + 0.05 * hash21(cell + 2.0)) + h * 9.0);
  float size = mix(0.12, 0.22, hash21(cell + 5.0)) * smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.75, 1.0, life));
  vec2 at = (vec2(hash21(cell + 1.0), hash21(cell + 4.0)) - 0.5) * 0.45;
  // A third of the drops run down their cell once they are heavy enough.
  if (hash21(cell + 8.0) < 0.33) at.y += 0.25 - smoothstep(0.35, 0.95, life) * 0.55;
  vec2 v = (f - at) / max(size, 1e-3);
  v.y *= 0.85 + 0.15 * sign(v.y); // a little heavier at the bottom
  float d2 = dot(v, v);
  if (d2 > 1.0) return vec3(0.0);
  float lens = sqrt(1.0 - d2);
  return vec3(-v * (1.0 - lens) * size * 0.9, smoothstep(1.0, 0.75, d2));
}

// Interleaved gradient noise; dithers away banding in the soft skies.
float dither(vec2 frag) {
  return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
}

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 frag = vUv * uResolution;
  vec2 sceneUv = vUv;
  float dropLight = 0.0;
  if (uDrops > 0.0) {
    vec2 g = frag / uResolution.y;
    vec3 big = dropLayer(g * 7.0, uTime, uDrops * 0.45);
    vec3 small = dropLayer(g * 16.0 + 3.7, uTime * 1.3, uDrops * 0.6);
    vec3 drop = big.z > 0.0 ? big : small;
    // Each drop is a tiny lens: it shows the sky behind it, flipped.
    sceneUv += drop.xy * vec2(uResolution.y / uResolution.x, 1.0) * 0.35 * drop.z;
    dropLight = drop.z;
  }
  vec3 scene = texture2D(uScene, sceneUv).rgb;
  if (dropLight > 0.0) {
    // Water: a touch brighter than what it shows, with a glint on the upper left and a
    // thin shadow along the lower edge, the way a bead of rain sits on a window.
    vec2 n = normalize(sceneUv - vUv + 1e-5);
    float glint = pow(max(dot(-n, normalize(vec2(-0.6, 0.8))), 0.0), 6.0);
    float shadow = pow(max(dot(-n, vec2(0.0, -1.0)), 0.0), 3.0);
    vec3 wet = scene * (1.06 - 0.15 * shadow * dropLight) + vec3(0.3 * glint * dropLight);
    scene = mix(texture2D(uScene, vUv).rgb, wet, dropLight);
  }
  vec3 color = linearToSrgb(clamp(scene, 0.0, 1.0));
  color += (dither(frag) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(color * uMix, uMix);
}
