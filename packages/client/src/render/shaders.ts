const PLANET_RING_INNER_RADIUS = 1.18;
const PLANET_RING_OUTER_RADIUS = 2.05;

export const FULLSCREEN_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const GRAVITY_VECTOR_VERTEX_SHADER = `
attribute float aAlpha;

varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const GRAVITY_VECTOR_FRAGMENT_SHADER = `
uniform vec3 uColor;

varying float vAlpha;

void main() {
  if (vAlpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(uColor, vAlpha);
}
`;

export const SKY_DOME_VERTEX_SHADER = `
varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_BACKGROUND_FRAGMENT_SHADER = `
#define OCTAVES 3

uniform float uTime;

varying vec3 vDirection;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

vec2 rand2(vec2 p) {
  p = vec2(
    dot(p, vec2(12.9898, 78.233)),
    dot(p, vec2(26.65125, 83.054543))
  );
  return fract(sin(p) * 43758.5453);
}

float rand(vec2 p) {
  return fract(sin(dot(p.xy, vec2(54.90898, 18.233))) * 4337.5453);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float stars(vec2 x, float numCells, float size, float br) {
  vec2 n = x * numCells;
  vec2 f = floor(n);
  float d = 1.0e10;

  for (int i = -1; i <= 1; ++i) {
    for (int j = -1; j <= 1; ++j) {
      vec2 g = f + vec2(float(i), float(j));
      g = n - g - rand2(mod(g, numCells)) + rand(g);
      g *= 1.0 / (numCells * size);
      d = min(d, dot(g, g));
    }
  }

  return br * smoothstep(0.95, 1.0, 1.0 - sqrt(d));
}

float fractalNoise(vec2 coord, float persistence, float lacunarity) {
  float n = 0.0;
  float frequency = 1.0;
  float amplitude = 1.0;

  for (int octave = 0; octave < OCTAVES; ++octave) {
    n += amplitude * snoise(coord * frequency);
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return n;
}

vec3 fractalNebula(vec2 coord, vec3 color, float transparency) {
  float n = fractalNoise(coord, 0.5, 2.0);
  n = smoothstep(-0.18, 0.92, n);
  return n * color * transparency;
}

vec3 sampleSkyPlane(vec2 coord, vec2 drift, vec2 offset) {
  vec3 nebulaColor1 = hsv2rgb(vec3(0.54 + 0.03 * sin(uTime * 0.06), 0.48, 0.16));
  vec3 nebulaColor2 = hsv2rgb(vec3(0.70 + 0.02 * sin(uTime * 0.09), 0.62, 0.12));
  vec2 p = coord * 1.85 + offset;
  vec3 result = vec3(0.004, 0.006, 0.016);

  result += fractalNebula(p * 0.72 + vec2(0.12, 0.08) + drift, nebulaColor1, 0.24);
  result += fractalNebula(p * 1.12 + vec2(-0.18, 0.22) - drift, nebulaColor2, 0.15);
  result += stars(p + drift * 0.4, 7.0, 0.060, 1.0) * vec3(0.62, 0.66, 0.78);
  result += stars(p - drift * 0.3, 16.0, 0.030, 0.76) * vec3(0.90, 0.70, 0.82);
  result += stars(p * 1.25, 36.0, 0.014, 0.52) * vec3(0.88, 0.90, 0.98);

  return result;
}

vec3 triplanarWeights(vec3 direction) {
  vec3 weights = pow(abs(direction), vec3(3.0));
  return weights / max(weights.x + weights.y + weights.z, 0.0001);
}

void main() {
  vec3 skyDirection = normalize(vDirection);
  vec3 weights = triplanarWeights(skyDirection);
  vec2 slowDrift = vec2(uTime * 0.002, -uTime * 0.0014);
  vec3 result =
    sampleSkyPlane(skyDirection.yz, slowDrift, vec2(0.00, 0.17)) * weights.x +
    sampleSkyPlane(skyDirection.zx, slowDrift, vec2(0.31, 0.02)) * weights.y +
    sampleSkyPlane(skyDirection.xy, slowDrift, vec2(-0.16, 0.29)) * weights.z;

  gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
`;

export const SUN_FLARE_FRAGMENT_SHADER = `
uniform vec2 uResolution;
uniform vec2 uSunPosition;
uniform vec3 uSunColor;
uniform float uVisibility;
uniform float uTime;

float getSun(vec2 uv) {
  return smoothstep(0.014, 0.0, length(uv));
}

vec3 lensflares(vec2 uv, vec2 pos, out vec3 sunflare, out vec3 lensflare) {
  vec2 main = uv - pos;
  vec2 uvd = uv * length(uv);
  float ang = atan(main.y, main.x);
  float dist = pow(length(main), 0.1);
  float f0 = 1.0 / (length(uv - pos) * 25.0 + 1.0);
  f0 = pow(f0, 2.0);
  f0 = f0 + f0 * (sin((ang + 1.0 / 18.0) * 12.0) * 0.1 + dist * 0.1 + 0.8);

  float f2 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.8 * pos), 2.0)), 0.0) * 0.25;
  float f22 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.85 * pos), 2.0)), 0.0) * 0.23;
  float f23 = max(1.0 / (1.0 + 32.0 * pow(length(uvd + 0.9 * pos), 2.0)), 0.0) * 0.21;
  vec2 uvx = mix(uv, uvd, -0.5);
  float f4 = max(0.01 - pow(length(uvx + 0.4 * pos), 2.4), 0.0) * 6.0;
  float f42 = max(0.01 - pow(length(uvx + 0.45 * pos), 2.4), 0.0) * 5.0;
  float f43 = max(0.01 - pow(length(uvx + 0.5 * pos), 2.4), 0.0) * 3.0;
  uvx = mix(uv, uvd, -0.4);
  float f5 = max(0.01 - pow(length(uvx + 0.2 * pos), 5.5), 0.0) * 2.0;
  float f52 = max(0.01 - pow(length(uvx + 0.4 * pos), 5.5), 0.0) * 2.0;
  float f53 = max(0.01 - pow(length(uvx + 0.6 * pos), 5.5), 0.0) * 2.0;
  uvx = mix(uv, uvd, -0.5);
  float f6 = max(0.01 - pow(length(uvx - 0.3 * pos), 1.6), 0.0) * 6.0;
  float f62 = max(0.01 - pow(length(uvx - 0.325 * pos), 1.6), 0.0) * 3.0;
  float f63 = max(0.01 - pow(length(uvx - 0.35 * pos), 1.6), 0.0) * 5.0;

  sunflare = vec3(f0);
  lensflare = vec3(f2 + f4 + f5 + f6, f22 + f42 + f52 + f62, f23 + f43 + f53 + f63);
  return sunflare + lensflare;
}

vec3 anamorphicFlare(vec2 uv, float intensity, float stretch, float brightness) {
  uv.x *= 1.0 / (intensity * stretch);
  uv.y *= 0.5;
  return vec3(smoothstep(0.009, 0.0, length(uv))) * brightness;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy - 0.5;
  vec2 sun = uSunPosition - 0.5;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  uv.x *= aspect;
  sun.x *= aspect;

  vec3 sunflare = vec3(0.0);
  vec3 lensflare = vec3(0.0);
  vec3 flare = lensflares(uv * 1.5, sun * 1.5, sunflare, lensflare);
  vec3 anflare = pow(anamorphicFlare(uv - sun, 0.5, 400.0, 0.09), vec3(4.0));
  vec3 core = vec3(getSun(uv - sun));
  vec3 color = core * 1.55 + (flare + anflare) * uSunColor * 1.85;
  color *= smoothstep(0.0, 0.2, uVisibility);
  color = 1.0 - exp(-color * 1.15);
  color = pow(color, vec3(1.0 / 2.2));

  float alpha = clamp(max(max(color.r, color.g), color.b), 0.0, 0.72);
  gl_FragColor = vec4(color, alpha);
}
`;

export const PLANET_BILLBOARD_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PLANET_GLOW_FRAGMENT_SHADER = `
uniform vec3 uPlanetColor;
uniform vec3 uGasPaletteHigh;
uniform vec3 uGasPaletteAccent;
uniform vec3 uSunDirection;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform vec3 uCameraForward;
uniform sampler2D uGasNoiseTexture;
uniform float uPlanetClass;
uniform float uPlanetSeed;
uniform float uTime;
uniform float uRenderMode;
uniform float uGlowNoiseScale;
uniform float uGlowNoiseStrength;
uniform float uGlowOpacityFalloff;

varying vec2 vUv;

float sampleGlowNoise(vec3 point, float scale, vec3 offset) {
  vec3 axis = normalize(point);
  vec3 blend = pow(abs(axis), vec3(1.35));
  blend /= max(blend.x + blend.y + blend.z, 0.0001);
  vec3 p = point * scale + offset;
  float x = texture2D(uGasNoiseTexture, p.yz).r;
  float y = texture2D(uGasNoiseTexture, p.zx).r;
  float z = texture2D(uGasNoiseTexture, p.xy).r;

  return mix((x + y + z) * 0.333333, x * blend.x + y * blend.y + z * blend.z, 0.58);
}

vec2 projectedGlowSun(vec3 sunDirection) {
  vec2 projectedSun = vec2(dot(sunDirection, uCameraRight), dot(sunDirection, uCameraUp));
  float projectedStrength = smoothstep(0.035, 0.32, length(projectedSun));

  return normalize(mix(vec2(1.0, 0.5), projectedSun, projectedStrength) + vec2(0.0001));
}

float projectedSphereLight(vec2 spherePoint, float visibleHemisphere, vec2 sunOnBillboard) {
  vec3 projectedNormal = normalize(vec3(spherePoint, visibleHemisphere));
  vec3 projectedLight = normalize(vec3(sunOnBillboard, 1.0));

  return clamp(dot(projectedNormal, projectedLight), 0.0, 1.0);
}

float projectedSunward(vec2 spherePoint, vec2 sunOnBillboard) {
  return pow(
    clamp(dot(normalize(spherePoint + vec2(0.0001)), sunOnBillboard), 0.0, 1.0),
    0.9
  );
}

float projectedLimbWash(float sphereRadius, float sunward) {
  return (1.0 - pow(abs(sphereRadius - 1.0), 0.7)) * sunward;
}

void main() {
  vec2 centered = vUv * 2.0 - 1.0;
  float radius = length(centered);

  if (radius > 1.0) {
    discard;
  }

  float gasMask = 1.0 - step(0.5, uPlanetClass);

  if (uRenderMode < 0.5) {
    float bodyEdge = 0.637;
    float outside = max(radius - bodyEdge, 0.0);
    vec2 spherePoint = centered / bodyEdge;
    float sphereRadius = min(length(spherePoint), 0.999);
    float visibleHemisphere = sqrt(max(1.0 - sphereRadius * sphereRadius, 0.0));
    vec3 viewNormal = normalize(vec3(spherePoint, visibleHemisphere));
    vec3 worldNormal = normalize(
      uCameraRight * viewNormal.x +
      uCameraUp * viewNormal.y +
      uCameraForward * viewNormal.z
    );
    vec3 sunDirection = normalize(uSunDirection);
    float sunLit = smoothstep(-0.12, 0.64, dot(worldNormal, sunDirection));
    vec2 sunOnBillboard = projectedGlowSun(sunDirection);
    float projectedLight = projectedSphereLight(spherePoint, visibleHemisphere, sunOnBillboard);
    float sunward = projectedSunward(spherePoint, sunOnBillboard);
    float warmLimb = projectedLimbWash(sphereRadius, sunward) * gasMask;
    float litGlow = mix(
      sunLit,
      clamp(projectedLight * (0.58 + sunward * 0.62) + sunLit * 0.18, 0.0, 1.32),
      gasMask
    );
    float edgeReveal = smoothstep(bodyEdge - 0.024, bodyEdge + 0.018, radius);
    float rimBloom = exp(-outside * mix(8.8, 7.0, gasMask)) * edgeReveal;
    float surfaceBloom = exp(-abs(radius - bodyEdge) * mix(34.0, 25.0, gasMask));
    float wideBloom = exp(-outside * mix(4.8, 3.4, gasMask)) *
      smoothstep(bodyEdge + 0.035, bodyEdge + 0.16, radius);
    float forwardScatter = pow(
      clamp(dot(normalize(uCameraForward), sunDirection) * 0.5 + 0.5, 0.0, 1.0),
      2.0
    );
    float outerFade = 1.0 - smoothstep(0.9, 1.0, radius);
    vec3 gasBloom = mix(uGasPaletteHigh, uGasPaletteAccent, 0.46);
    vec3 scatterColor = mix(vec3(0.56, 0.68, 1.0), gasBloom, gasMask * 0.78);
    vec3 glowColor = mix(uPlanetColor, scatterColor, 0.66 + gasMask * 0.18);
    glowColor = mix(glowColor, vec3(0.8, 0.7, 0.6), warmLimb * 0.55);
    glowColor *= mix(1.0, 0.82 + litGlow * 0.5, gasMask);
    float density = mix(0.62, 1.0, gasMask);
    float alpha = surfaceBloom * (0.018 + litGlow * mix(0.08, 0.25, gasMask));
    alpha += rimBloom * (0.018 + litGlow * mix(0.055, 0.19, gasMask)) * density;
    alpha += wideBloom *
      (0.004 + (litGlow + forwardScatter * 0.36) * mix(0.018, 0.068, gasMask)) *
      density;
    alpha *= outerFade;
    alpha *= mix(1.0, 0.34 + litGlow * 0.98 + warmLimb * 0.28, gasMask);

    if (alpha <= 0.002) {
      discard;
    }

    gl_FragColor = vec4(glowColor, alpha);
    return;
  }

  float bodyEdge = 0.637;
  float outside = max(radius - bodyEdge, 0.0);
  float radialFalloff = clamp(outside / max(1.0 - bodyEdge, 0.0001), 0.0, 1.0);
  vec2 spherePoint = centered / bodyEdge;
  float sphereRadius = min(length(spherePoint), 0.999);
  vec2 surfacePoint = sphereRadius > 0.0001
    ? spherePoint * (sphereRadius / max(length(spherePoint), 0.0001))
    : vec2(0.0);
  float visibleHemisphere = sqrt(max(1.0 - sphereRadius * sphereRadius, 0.0));
  vec3 viewNormal = normalize(vec3(surfacePoint, visibleHemisphere));
  vec3 worldNormal = normalize(
    uCameraRight * viewNormal.x +
    uCameraUp * viewNormal.y +
    uCameraForward * viewNormal.z
  );
  vec3 sunDirection = normalize(uSunDirection);
  vec2 projectedSun = vec2(dot(sunDirection, uCameraRight), dot(sunDirection, uCameraUp));
  float projectedSunStrength = smoothstep(0.04, 0.3, length(projectedSun));
  vec2 sunOnBillboard = projectedGlowSun(sunDirection);
  float sunward = dot(normalize(centered + vec2(0.0001)), sunOnBillboard);
  float projectedDirectionality = projectedSunward(surfacePoint, sunOnBillboard);
  float projectedLight = projectedSphereLight(surfacePoint, visibleHemisphere, sunOnBillboard);
  float warmLimb = projectedLimbWash(sphereRadius, projectedDirectionality) * gasMask;
  float sunLit = smoothstep(-0.08, 0.62, dot(worldNormal, sunDirection));
  float directionalLight = mix(1.0, smoothstep(-0.35, 0.82, sunward), projectedSunStrength);
  float projectedGlowLight = clamp(
    projectedLight * (0.5 + projectedDirectionality * 0.75) + sunLit * 0.12,
    0.0,
    1.45
  );
  float litDust = mix(sunLit * directionalLight, projectedGlowLight, gasMask * 0.82);
  float edgeReveal = smoothstep(bodyEdge - 0.028, bodyEdge + 0.018, radius);
  float rimBloom = exp(-outside * 6.6) * edgeReveal;
  float surfaceBloom = exp(-abs(radius - bodyEdge) * 27.0);
  float hotSurface = exp(-abs(radius - bodyEdge) * 50.0);
  float wideBloom = exp(-outside * 3.05) *
    smoothstep(bodyEdge + 0.04, bodyEdge + 0.18, radius);
  float outerHaze = smoothstep(bodyEdge + 0.12, 0.9, radius);
  float planetSpin = uTime * 0.009 + uPlanetSeed * 0.013;
  float spinCos = cos(planetSpin);
  float spinSin = sin(planetSpin);
  vec3 spunNormal = vec3(
    spinCos * worldNormal.x + spinSin * worldNormal.z,
    worldNormal.y,
    -spinSin * worldNormal.x + spinCos * worldNormal.z
  );
  float dustEmission = uTime * 0.0018;
  vec3 noisePoint = spunNormal * (1.0 + radialFalloff * 0.18 - dustEmission);
  float broadNoise = sampleGlowNoise(
    noisePoint,
    1.3 * uGlowNoiseScale,
    vec3(uPlanetSeed * 0.013, uPlanetSeed * 0.017, uPlanetSeed * 0.021)
  );
  float fineNoise = sampleGlowNoise(
    noisePoint,
    3.75 * uGlowNoiseScale,
    vec3(uPlanetSeed * 0.007, uPlanetSeed * 0.011, uPlanetSeed * 0.019)
  );
  float glowNoiseContrast = mix(1.0, uGlowNoiseStrength, gasMask);
  broadNoise = clamp((broadNoise - 0.5) * glowNoiseContrast + 0.5, 0.0, 1.0);
  fineNoise = clamp((fineNoise - 0.5) * glowNoiseContrast + 0.5, 0.0, 1.0);
  float farMedia = smoothstep(0.26, 0.9, radialFalloff);
  float mediaNoise = mix(broadNoise, fineNoise, mix(0.24, 0.08, farMedia));
  mediaNoise = clamp((mediaNoise - 0.5) * glowNoiseContrast + 0.5, 0.0, 1.0);
  float nearDensity = mix(0.82, 1.22, smoothstep(0.18, 0.92, mediaNoise));
  float farDensity = mix(0.68, 1.08, smoothstep(0.12, 0.92, broadNoise));
  float farBreakup = mix(
    1.0,
    farDensity,
    farMedia
  );
  float thinMedia = mix(1.0, 0.26, smoothstep(0.14, 0.92, radialFalloff));
  float mediaDensity = nearDensity * farBreakup * thinMedia;
  float surfaceDensity = mix(0.86, 1.18, smoothstep(0.14, 0.88, mediaNoise));
  float forwardScatter = pow(
    clamp(dot(normalize(uCameraForward), sunDirection) * 0.5 + 0.5, 0.0, 1.0),
    3.0
  );
  float terminatorDust = pow(1.0 - abs(dot(worldNormal, sunDirection)), 3.0) *
    smoothstep(bodyEdge - 0.015, bodyEdge + 0.08, radius);
  float outerFade = 1.0 - smoothstep(0.94, 1.0, radius);
  float pulse = sin(uTime * 0.31 + uPlanetSeed * 0.071) * 0.5 + 0.5;
  vec3 gasBloom = mix(uGasPaletteHigh, uGasPaletteAccent, 0.5);
  vec3 scatterColor = mix(vec3(0.56, 0.68, 1.0), gasBloom, gasMask * 0.78);
  vec3 sunWarmth = mix(vec3(1.0, 0.84, 0.58), scatterColor, 0.52);
  vec3 glowColor = mix(uPlanetColor, scatterColor, 0.72 + gasMask * 0.18);
  glowColor = mix(glowColor, sunWarmth, litDust * 0.42);
  glowColor = mix(glowColor, vec3(0.8, 0.7, 0.6), warmLimb * 0.46);
  glowColor *=
    mix(1.24, 2.1, gasMask) *
    mix(0.94, 1.04, broadNoise) *
    mix(1.0, 0.78 + projectedGlowLight * 0.58, gasMask);
  float alpha = hotSurface * litDust * mix(0.06, 0.34, gasMask) * surfaceDensity;
  alpha += surfaceBloom * (0.028 + litDust * mix(0.08, 0.28, gasMask)) * surfaceDensity;
  alpha += rimBloom * (0.018 + litDust * mix(0.065, 0.22, gasMask)) * mediaDensity;
  alpha += wideBloom *
    (0.009 + (litDust + forwardScatter * 0.44) * mix(0.026, 0.09, gasMask)) *
    mediaDensity;
  alpha += outerHaze *
    (0.002 + (litDust + forwardScatter * 0.35) * mix(0.007, 0.024, gasMask)) *
    mediaDensity;
  alpha += terminatorDust * mix(0.009, 0.036, gasMask) * (0.25 + litDust) *
    mediaDensity;
  float thumbnailBreakup = clamp((uGlowNoiseStrength - 1.0) * 0.55, 0.0, 1.0);
  float cloudBreakup = mix(
    1.0,
    mix(0.42, 1.52, smoothstep(0.18, 0.9, mediaNoise)),
    gasMask * thumbnailBreakup
  );
  float previewFalloff = clamp(uGlowOpacityFalloff, 0.0, 1.0) * gasMask;
  float edgeDistance = smoothstep(0.08, 1.0, radialFalloff);
  float edgeFalloff = pow(
    clamp(1.0 - edgeDistance, 0.0, 1.0),
    1.0 + previewFalloff * 1.95
  );
  float edgeNoiseBreakup = mix(
    1.0,
    mix(0.28, 1.0, smoothstep(0.16, 0.86, mediaNoise)),
    previewFalloff * smoothstep(0.18, 0.95, radialFalloff)
  );
  float rimBreakupMask = smoothstep(bodyEdge - 0.015, bodyEdge + 0.095, radius);
  float rimNoiseBreakup = mix(
    1.0,
    mix(0.28, 1.0, smoothstep(0.08, 0.88, mediaNoise)),
    previewFalloff * rimBreakupMask
  );
  alpha *= cloudBreakup;
  alpha *= mix(1.0, edgeFalloff, previewFalloff) *
    edgeNoiseBreakup *
    rimNoiseBreakup;
  alpha *= outerFade;
  alpha *= 0.9 + pulse * 0.1;
  alpha *= mix(1.0, 0.28 + projectedGlowLight * 0.98 + warmLimb * 0.25, gasMask);

  if (alpha <= 0.002) {
    discard;
  }

  gl_FragColor = vec4(glowColor, alpha);
}
`;

export const PLANET_RING_VERTEX_SHADER = `
uniform vec3 uSunDirection;
uniform vec2 uRingEllipse;

varying float vRingRadius;
varying float vRingAngle;
varying float vRingLight;

void main() {
  vec3 localPosition = vec3(position.xy * uRingEllipse, position.z);
  vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
  vec3 sunDirection = normalize(uSunDirection);
  vec3 worldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  vec3 viewVector = cameraPosition - worldPosition.xyz;
  vec3 viewDirection = viewVector * inversesqrt(max(dot(viewVector, viewVector), 0.0001));
  float planeLight = 0.42 + 0.58 * abs(dot(worldNormal, sunDirection));
  float viewSunSide = smoothstep(-0.18, 0.72, dot(viewDirection, sunDirection));

  vRingRadius = length(position.xy);
  vRingAngle = atan(position.y, position.x);
  vRingLight = planeLight * mix(0.32, 1.0, viewSunSide);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const PLANET_BILLBOARD_FRAGMENT_SHADER = `
uniform vec3 uSunDirection;
uniform vec3 uPlanetColor;
uniform vec3 uGasPaletteShadow;
uniform vec3 uGasPaletteLow;
uniform vec3 uGasPaletteHigh;
uniform vec3 uGasPaletteAccent;
uniform sampler2D uGasGrungeTexture;
uniform sampler2D uGasNoiseTexture;
uniform float uPlanetClass;
uniform float uPlanetSeed;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform vec3 uCameraForward;
uniform float uTime;
uniform float uRenderMode;

varying vec2 vUv;

#ifdef CINEMATIC_RENDER
float rand(vec2 co, float seed) {
  return fract(sin(dot(co.xy + seed, vec2(12.9898, 78.233))) * 43758.5453);
}

float valueNoise(vec2 p, float seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float a = rand(i, seed);
  float b = rand(i + vec2(1.0, 0.0), seed);
  float c = rand(i + vec2(0.0, 1.0), seed);
  float d = rand(i + vec2(1.0, 1.0), seed);

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p, float seed) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;

  for (int octave = 0; octave < 5; octave += 1) {
    value += amplitude * valueNoise(p * frequency, seed + float(octave) * 19.17);
    frequency *= 2.03;
    amplitude *= 0.52;
  }

  return value;
}

float triplanarFbm(vec3 p, vec3 normal, float seed) {
  vec3 blend = pow(abs(normal), vec3(3.0));
  blend /= max(blend.x + blend.y + blend.z, 0.0001);

  float x = fbm(p.yz, seed + 11.0);
  float y = fbm(p.zx, seed + 23.0);
  float z = fbm(p.xy, seed + 37.0);

  return x * blend.x + y * blend.y + z * blend.z;
}

vec3 rotateY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 makeGasGiant(
  vec3 normal,
  vec3 baseColor,
  float seed,
  vec2 gasTextureUv,
  vec2 planetUv
) {
  vec3 p = normalize(normal);
  float shear = sin(p.y * 8.0 + uTime * 0.025 + seed * 0.17) * 0.18;
  vec3 flow = rotateY(p, shear);
  float turbulence = triplanarFbm(
    flow * 3.8 + vec3(seed * 0.013, uTime * 0.012, seed * 0.019),
    flow,
    seed
  );
  float fine = triplanarFbm(
    flow * 13.0 + vec3(uTime * 0.01, seed * 0.017, -uTime * 0.006),
    flow,
    seed + 31.0
  );
  float cellular = triplanarFbm(flow * 28.0 + vec3(seed * 0.031), flow, seed + 89.0);
  float bandWave = sin(
    flow.y * 38.0 +
      turbulence * 6.4 +
      sin(flow.x * 7.0 + flow.z * 4.3 + seed * 0.05) * 0.75
  );
  float widthRoll = sin(flow.y * 13.0 + seed * 0.29 + turbulence * 2.2) * 0.5 + 0.5;
  float bandSignal = bandWave + fine * mix(0.42, 0.96, widthRoll);
  float ribbon = smoothstep(
    mix(-0.92, -0.48, widthRoll),
    mix(0.5, 1.08, widthRoll),
    bandSignal
  );
  float filament = smoothstep(
    0.88,
    0.99,
    sin(flow.y * mix(74.0, 118.0, widthRoll) + turbulence * 7.2 + seed) * 0.5 + 0.5
  ) * smoothstep(0.42, 0.88, fine + ribbon * 0.24);
  vec2 grungeUv = (planetUv + vec2(0.5)) * 0.2 + vec2(seed * 0.013, seed * 0.017);
  vec3 grungeSample = texture2D(uGasGrungeTexture, grungeUv).rgb;
  float grungeLuma = dot(grungeSample, vec3(0.299, 0.587, 0.114));
  float grungePunch = pow(length(grungeSample), 2.0);
  float grungePoleFade = 1.0 - smoothstep(0.68, 0.94, abs(planetUv.y));
  float grungeSeamFade = 1.0 - smoothstep(2.58, 3.08, abs(planetUv.x));
  float grungeOpacity = grungePoleFade * grungeSeamFade;
  float grungeHigh = clamp(grungePunch, 0.0, 1.45) * grungeOpacity;
  float grungeLow =
    pow(1.0 - clamp(grungeLuma, 0.0, 1.0), 2.35) * grungeOpacity;
  float grungeExtreme =
    pow(clamp(abs(grungeLuma - 0.5) * 2.0, 0.0, 1.0), 1.35) * grungeOpacity;
  float noiseMask = texture2D(
    uGasNoiseTexture,
    gasTextureUv * 2.65 + vec2(seed * 0.017, uTime * 0.012)
  ).r;

  float paletteRoll = triplanarFbm(flow * 1.75 + vec3(seed * 0.041), flow, seed + 149.0);
  float accentRoll = smoothstep(0.38, 0.88, fine + turbulence * 0.28);
  vec3 shadowBand = mix(uGasPaletteShadow, baseColor * 0.38, 0.12);
  vec3 lowBand = mix(uGasPaletteLow, baseColor * 0.92, 0.16);
  vec3 highBand = mix(uGasPaletteHigh, vec3(1.0, 0.88, 0.68), 0.1);
  vec3 accentBand = mix(uGasPaletteAccent, baseColor * 1.16, 0.12);
  vec3 middle = mix(lowBand, accentBand, paletteRoll * 0.46);
  vec3 bright = mix(highBand, accentBand, accentRoll * 0.38);
  vec3 dark = mix(shadowBand, lowBand * 0.46, smoothstep(0.18, 0.82, cellular));
  vec3 color = mix(dark, middle, smoothstep(0.18, 0.78, turbulence));
  color = mix(color, bright, ribbon * 0.72);
  color = mix(color, accentBand, accentRoll * (0.1 + ribbon * 0.18));
  color = mix(
    color,
    mix(highBand, accentBand, 0.45),
    filament * (0.14 + noiseMask * 0.14)
  );
  color = mix(
    color,
    mix(vec3(1.0, 0.8, 0.7) * 0.8, highBand * 1.32, 0.35),
    clamp(grungeHigh * 0.48, 0.0, 0.9) *
      smoothstep(0.22, 0.86, turbulence + ribbon * 0.24 + noiseMask * 0.24) *
      0.92
  );
  color = mix(
    color,
    mix(vec3(0.018, 0.022, 0.035), shadowBand * 0.48, 0.58),
    grungeLow *
      (0.52 + cellular * 0.48) *
      (0.28 + (1.0 - noiseMask) * 0.34)
  );
  color += (grungeHigh - grungeLow) * (highBand - shadowBand) * 0.18;
  color = mix(
    color,
    color * (0.76 + clamp(grungePunch, 0.0, 1.0) * 0.52) +
      vec3(0.08, 0.075, 0.065) * clamp(grungePunch, 0.0, 1.0),
    grungeExtreme * smoothstep(0.34, 0.94, fine + ribbon * 0.18) * 0.28
  );
  color += (fine - 0.48) * (highBand - shadowBand) * 0.28;
  color += (cellular - 0.5) * mix(accentBand, shadowBand, 0.55) * 0.2;

  vec3 stormCenter = normalize(vec3(
    0.54 + 0.22 * sin(seed * 0.71),
    0.11 * sin(seed * 0.37),
    0.72 + 0.12 * cos(seed * 0.43)
  ));
  float stormDistance = length(flow - stormCenter);
  float storm = smoothstep(0.27, 0.07, stormDistance);
  float stormEye = smoothstep(
    0.08,
    0.02,
    length(flow - normalize(stormCenter + vec3(0.05, 0.0, -0.03)))
  );
  vec3 stormColor = mix(accentBand, highBand, 0.32);
  color = mix(color, stormColor, storm * 0.48);
  color += stormEye * mix(accentBand, vec3(0.32, 0.16, 0.08), 0.38);

  return clamp(color, 0.0, 1.0);
}
#endif

vec3 makeTerran(vec3 normal, vec3 baseColor) {
  vec3 soil = mix(baseColor, vec3(0.34, 0.43, 0.25), 0.42);
  float polarTint = smoothstep(0.72, 0.94, abs(normal.y));

  return mix(soil, vec3(0.78, 0.82, 0.76), polarTint * 0.18);
}

vec3 makeIceWorld(vec3 normal, vec3 baseColor) {
  vec3 ice = mix(baseColor, vec3(0.74, 0.9, 1.0), 0.72);
  float glint = pow(max(normal.y, 0.0), 4.0);

  return clamp(ice + glint * vec3(0.08, 0.1, 0.12), 0.0, 1.0);
}

vec3 samplePlanetSurface(
  vec3 normal,
  vec3 spunNormal,
  vec2 gasTextureUv,
  vec2 planetUv
) {
  if (uPlanetClass < 0.5) {
#ifdef CINEMATIC_RENDER
    return makeGasGiant(spunNormal, uPlanetColor, uPlanetSeed, gasTextureUv, planetUv);
#else
    return uPlanetColor;
#endif
  }

  if (uPlanetClass < 1.5) {
    return makeTerran(normal, uPlanetColor);
  }

  return makeIceWorld(normal, uPlanetColor);
}

void main() {
  vec2 centered = vUv * 2.0 - 1.0;
  float radius = length(centered);
  float solidRadius = 0.925;

  if (radius > solidRadius) {
    discard;
  }

  vec2 spherePoint = centered / solidRadius;
  float sphereRadius = length(spherePoint);
  float visibleHemisphere = sqrt(max(1.0 - sphereRadius * sphereRadius, 0.0));
  vec3 viewNormal = normalize(vec3(spherePoint, visibleHemisphere));
  vec3 normal = normalize(
    uCameraRight * viewNormal.x +
    uCameraUp * viewNormal.y +
    uCameraForward * viewNormal.z
  );
  vec3 sunDirection = normalize(uSunDirection);
  float mu = dot(normal, sunDirection);
  float solidMask = 1.0 - smoothstep(solidRadius - 0.004, solidRadius + 0.004, radius);

#ifdef CINEMATIC_RENDER
  vec3 spunNormal = rotateY(normal, uTime * 0.028 + uPlanetSeed * 0.013);
  vec2 planetUv = vec2(
    atan(spunNormal.z, spunNormal.x),
    spunNormal.y
  );
  vec2 gasTextureUv = vec2(
    planetUv.x * 0.18 + uPlanetSeed * 0.013,
    planetUv.y * 0.13 + 0.5 + uPlanetSeed * 0.017
  );
  vec3 surface = samplePlanetSurface(normal, spunNormal, gasTextureUv, planetUv);
#else
  vec3 surface = samplePlanetSurface(normal, normal, vec2(0.0), vec2(0.0));
#endif
  float limbShade = 1.0 - smoothstep(0.24, solidRadius, radius) * 0.34;
  vec3 viewDirection = normalize(uCameraForward);
  vec3 halfVector = normalize(sunDirection + viewDirection);
  float diffuse = max(mu, 0.0);
  float wrapDiffuse = smoothstep(-0.18, 0.92, mu);
  float specularPower = mix(28.0, 72.0, step(1.5, uPlanetClass));
  float specularStrength = mix(0.08, 0.18, step(1.5, uPlanetClass));
  float specular = pow(max(dot(normal, halfVector), 0.0), specularPower) *
    specularStrength *
    step(0.0, mu);
  vec3 nightTint = mix(vec3(0.03, 0.04, 0.07), surface * 0.22, 0.44);
  vec3 litColor = surface * (0.18 + diffuse * 0.72 + wrapDiffuse * 0.18);
  vec3 color = mix(nightTint, litColor, wrapDiffuse) * limbShade;
  color += vec3(1.0, 0.94, 0.82) * specular;
#ifdef CINEMATIC_RENDER
  float gasMask = 1.0 - step(0.5, uPlanetClass);
#else
  float gasMask = 0.0;
#endif
  vec2 projectedDirection = normalize(spherePoint + vec2(0.001));
  float directionalWash = pow(
    clamp(dot(projectedDirection, normalize(vec2(1.0, 0.5))), 0.0, 1.0),
    0.9
  );
  float centerPreserve = pow(abs(radius / solidRadius - 1.0), 0.7);
  vec3 edgeWash = mix(vec3(0.8, 0.7, 0.6), color, 1.0 - directionalWash * 0.62);
  color = mix(color, mix(edgeWash, color, centerPreserve), gasMask);

  float alpha = solidMask;

  if (alpha <= 0.004) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

export const PLANET_RING_FRAGMENT_SHADER = `
uniform vec3 uPlanetColor;
uniform float uPlanetSeed;

varying float vRingRadius;
varying float vRingAngle;
varying float vRingLight;

float seeded(float value) {
  return fract(sin(value * 12.9898 + uPlanetSeed * 78.233) * 43758.5453);
}

void main() {
  float radial = clamp(
    (vRingRadius - ${PLANET_RING_INNER_RADIUS.toFixed(2)}) /
      ${(
        PLANET_RING_OUTER_RADIUS - PLANET_RING_INNER_RADIUS
      ).toFixed(2)},
    0.0,
    1.0
  );
  float edgeFade =
    smoothstep(0.0, 0.05, radial) *
    (1.0 - smoothstep(0.94, 1.0, radial));
  float profileRoll = seeded(3.17);
  float fineFrequency = mix(52.0, 112.0, seeded(8.41));
  float radialWave =
    sin(radial * fineFrequency + seeded(9.7) * 6.28318530718) * 0.5 + 0.5;
  float angularDust =
    sin(vRingAngle * mix(17.0, 31.0, seeded(12.7)) + radial * 18.0 + uPlanetSeed) *
      0.5 + 0.5;
  float bandAWidth = mix(0.03, 0.09, profileRoll);
  float bandBWidth = mix(0.025, 0.08, seeded(5.4));
  float bandCWidth = mix(0.035, 0.12, seeded(7.6));
  float gapWidth = mix(0.02, 0.045, seeded(10.8));
  float bandA = 1.0 - smoothstep(
    0.0,
    bandAWidth,
    abs(radial - mix(0.18, 0.36, seeded(4.3)))
  );
  float bandB = 1.0 - smoothstep(
    0.0,
    bandBWidth,
    abs(radial - mix(0.44, 0.68, seeded(6.5)))
  );
  float bandC = 1.0 - smoothstep(
    0.0,
    bandCWidth,
    abs(radial - mix(0.72, 0.9, seeded(8.7)))
  );
  float gap = 1.0 - smoothstep(
    0.0,
    gapWidth,
    abs(radial - mix(0.32, 0.82, seeded(11.9)))
  );
  float density =
    mix(0.18, 0.36, profileRoll) +
    radialWave * mix(0.08, 0.18, seeded(13.1)) +
    angularDust * 0.035 +
    bandA * mix(0.2, 0.42, seeded(14.2)) +
    bandB * mix(0.16, 0.36, seeded(15.3)) +
    bandC * mix(0.1, 0.28, seeded(16.4));
  density *= 1.0 - gap * mix(0.55, 0.88, seeded(17.5));
  float alpha = edgeFade * density * mix(0.34, 0.62, profileRoll);
  vec3 gasColor = mix(uPlanetColor * 0.62, vec3(0.58, 0.54, 0.48), 0.55);
  vec3 dustColor = mix(vec3(0.82, 0.72, 0.55), uPlanetColor * 0.92, 0.18);
  vec3 ringColor = mix(gasColor, dustColor, smoothstep(0.24, 0.86, radialWave + bandA * 0.25));
  ringColor *= vRingLight * (0.72 + density * 0.28);

  if (alpha <= 0.003) {
    discard;
  }

  gl_FragColor = vec4(clamp(ringColor, 0.0, 1.0), clamp(alpha, 0.0, 0.58));
}
`;
