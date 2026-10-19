// The weather outside, drawn behind everything: sky, sun or moon, stars, clouds, haze,
// falling rain and snow, and lightning.
//
// Rendered at half resolution into a texture the orb pass samples as its page, so it
// stays cheap on integrated graphics: value noise only, a fixed number of layers, no
// loops over screen size. Output is linear light; the orb pass encodes to sRGB.

precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;   // render-target pixels
uniform float uTime;        // seconds
uniform float uDrift;       // clouds' travel, integrated on the CPU from the wind

uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uLight;
uniform float uGlow;
uniform float uStars;
uniform float uCover;
uniform vec3 uCloud;
uniform vec3 uCloudShade;
uniform float uHaze;
uniform vec3 uHazeColor;
uniform float uRain;
uniform float uSnow;
uniform float uWind;
uniform float uFlash;       // lightning, 0..1, driven on the CPU

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

// One layer of rain: thin streaks falling in columns, slanted by the wind.
float rainLayer(vec2 p, float scale, float speed, float density) {
  vec2 q = vec2(p.x + p.y * uWind * 0.35, p.y) * vec2(scale, scale * 0.12);
  q.y += uTime * speed;
  float column = floor(q.x);
  float h = hash(vec2(column, scale));
  float y = fract(q.y + h * 7.0);
  float streak = smoothstep(0.0, 0.05, y) * smoothstep(0.32, 0.06, y);
  float across = 1.0 - smoothstep(0.02, 0.1, abs(fract(q.x) - 0.5));
  return streak * across * step(1.0 - density, hash(vec2(column, floor(q.y + h * 7.0))));
}

// One layer of snow: soft flakes drifting down and sideways.
float snowLayer(vec2 p, float scale, float speed, float density) {
  vec2 q = p * scale;
  q.y += uTime * speed;
  q.x += uTime * speed * uWind * 1.5 + sin(uTime * 0.6 + q.y * 0.35) * 0.35;
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5;
  float h = hash(cell);
  vec2 at = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
  float size = mix(0.07, 0.16, hash(cell + 1.3));
  float flake = 1.0 - smoothstep(size * 0.3, size, length(f - at));
  return flake * step(1.0 - density, h);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // --- Sky: a soft gradient from the horizon up --------------------------------
  vec3 color = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 1.0, uv.y));

  // --- Sun or moon, low in the top right, glowing through thin cloud -----------
  vec2 lightAt = vec2(aspect * 0.8, 0.82);
  float d = length(p - lightAt);
  float glow = uGlow * (0.55 * exp(-d * 9.0) + 0.3 * exp(-d * 2.6));
  color += uLight * glow;

  // --- Stars on a clear night ---------------------------------------------------
  if (uStars > 0.0) {
    vec2 s = p * 180.0;
    vec2 cell = floor(s);
    float h = hash(cell);
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
    float star = step(0.985, h) * (1.0 - smoothstep(0.0, 0.35, length(fract(s) - 0.5)));
    color += vec3(star * twinkle * uStars * smoothstep(0.25, 0.9, uv.y));
  }

  // --- Clouds: two layers drifting with the wind --------------------------------
  vec2 cp = vec2(p.x * 1.1 + uDrift, p.y * 2.4);
  float far = fbm(cp * 1.3 + vec2(uDrift * 0.4, 3.0));
  float near = fbm(cp + vec2(0.0, uTime * 0.01));
  float edge = 1.0 - uCover;
  float farMask = smoothstep(edge - 0.05, edge + 0.35, far) * 0.7;
  float nearMask = smoothstep(edge, edge + 0.3, near);
  // Clouds gather towards the top of the sky; full cover reaches the horizon.
  float height = mix(smoothstep(0.15, 0.75, uv.y), 1.0, uCover * uCover);
  vec3 cloud = mix(uCloud, uCloudShade, smoothstep(0.35, 0.85, near) * 0.8 + uCover * 0.2);
  // Lightning lights the clouds from within.
  cloud += vec3(uFlash * 0.9);
  color = mix(color, cloud, farMask * height * 0.8);
  color = mix(color, cloud, nearMask * height);

  // --- Haze rising from the horizon ---------------------------------------------
  float mist = uHaze * (1.0 - smoothstep(-0.1, 0.9, uv.y)) * (0.75 + 0.25 * noise(p * 3.0 + uTime * 0.05));
  color = mix(color, uHazeColor, clamp(mist + uHaze * 0.35, 0.0, 1.0));

  // --- Rain and snow, three layers each, far to near ------------------------------
  if (uRain > 0.0) {
    vec3 streak = mix(uSkyHorizon, vec3(1.0), 0.6);
    // Columns stay a few pixels wide at half resolution, or far rain turns into grey wash.
    float rain = rainLayer(p, 64.0, 5.5, uRain * 0.4) * 0.1
               + rainLayer(p + 3.7, 42.0, 7.5, uRain * 0.4) * 0.16
               + rainLayer(p + 8.1, 26.0, 10.0, uRain * 0.35) * 0.24;
    color = mix(color, streak, rain);
  }
  if (uSnow > 0.0) {
    float snow = snowLayer(p, 26.0, 0.25, uSnow * 0.5) * 0.5
               + snowLayer(p + 5.3, 15.0, 0.4, uSnow * 0.45) * 0.75
               + snowLayer(p + 9.1, 8.0, 0.6, uSnow * 0.35);
    color = mix(color, vec3(1.0), clamp(snow, 0.0, 1.0) * 0.9);
  }

  // --- Lightning flashes the whole sky -------------------------------------------
  color += vec3(0.85, 0.9, 1.0) * uFlash * 0.35;

  gl_FragColor = vec4(max(color, 0.0), 1.0);
}
