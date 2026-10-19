import type { Scene } from '@ephemeralos/shared';
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene as ThreeScene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import vertexShader from '../orb/orb.vert.glsl?raw';
import compositeShader from './backdrop.frag.glsl?raw';
import { approachLook, createSceneLook, sceneLook, type SceneLook } from './scene-look.ts';
import fragmentShader from './weather.frag.glsl?raw';

/** The scene renders at this share of CSS pixels: skies are soft, so half is plenty. */
const SCALE = 0.5;
/** How quickly the page turns into the weather, and back to paper. */
const FADE_MS = 1800;
/** How quickly one weather turns into another (time constant). */
const CHANGE_MS = 900;

/**
 * The page as the weather outside, on its own canvas beneath everything on screen. The sky
 * renders at half resolution into a texture; a second pass draws it to the canvas with
 * raindrops on the glass at full resolution. It fades in when a weather surface is shown
 * and back to paper (the page's own background, beneath the canvas) when it goes; at rest
 * it draws nothing at all. Lightning is timed here, so the shader only reads a flash level.
 */
export class Backdrop {
  private readonly renderer: WebGLRenderer;
  private readonly composite: ShaderMaterial;
  private readonly screen = new ThreeScene();
  /** The canvas was last cleared at rest, so there's nothing to redraw until the next scene. */
  private blank = false;
  private readonly target = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  private readonly scene = new ThreeScene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly look = createSceneLook();
  private readonly goal = createSceneLook();
  private wanted = false;
  private time = 0;
  private drift = 0;
  private nextFlash = 3;
  private flashAge = Infinity;
  /** How much of the page is the scene, 0 (paper) to 1. */
  mix = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly motion: number,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uDrift: { value: 0 },
        uSkyTop: { value: this.look.skyTop },
        uSkyHorizon: { value: this.look.skyHorizon },
        uLight: { value: this.look.light },
        uGlow: { value: 0 },
        uStars: { value: 0 },
        uCover: { value: 0 },
        uCloud: { value: this.look.cloud },
        uCloudShade: { value: this.look.cloudShade },
        uHaze: { value: 0 },
        uHazeColor: { value: this.look.hazeColor },
        uRain: { value: 0 },
        uSnow: { value: 0 },
        uWind: { value: 0 },
        uFlash: { value: 0 },
      },
    });
    this.composite = new ShaderMaterial({
      vertexShader,
      fragmentShader: compositeShader,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      uniforms: {
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uScene: { value: this.target.texture },
        uMix: { value: 0 },
        uDrops: { value: 0 },
      },
    });
    const plane = new PlaneGeometry(2, 2);
    this.scene.add(new Mesh(plane, this.material));
    this.screen.add(new Mesh(plane, this.composite));
  }

  /** The blended look, for tests and the dev readout. */
  get current(): Readonly<SceneLook> {
    return this.look;
  }

  /** Lightning right now, 0..1. */
  get flash(): number {
    return this.material.uniforms.uFlash!.value as number;
  }

  set(scene: Scene | null): void {
    this.wanted = scene !== null;
    if (!scene) return;
    sceneLook(scene, this.goal);
    // The first weather appears as itself, rather than morphing out of the last one.
    if (this.mix === 0) approachLook(this.look, this.goal, 1);
  }

  setSize(width: number, height: number): void {
    // Drops stay crisp at up to 2× density; beyond that nobody can tell.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, true);
    this.renderer.getDrawingBufferSize(this.composite.uniforms.uResolution!.value as Vector2);
    this.blank = false;
    const w = Math.max(1, Math.round(width * SCALE));
    const h = Math.max(1, Math.round(height * SCALE));
    this.target.setSize(w, h);
    (this.material.uniforms.uResolution!.value as Vector2).set(w, h);
  }

  update(dtMs: number): void {
    const step = dtMs / FADE_MS;
    this.mix = Math.min(Math.max(this.mix + (this.wanted ? step : -step), 0), 1);
    if (this.mix === 0) return;
    approachLook(this.look, this.goal, 1 - Math.exp(-dtMs / CHANGE_MS));

    const dt = (dtMs / 1000) * this.motion;
    this.time += dt;
    this.drift += dt * (0.004 + 0.03 * this.look.wind);
    const u = this.material.uniforms;
    u.uTime!.value = this.time;
    u.uDrift!.value = this.drift;
    u.uGlow!.value = this.look.glow;
    u.uStars!.value = this.look.stars;
    u.uCover!.value = this.look.cover;
    u.uHaze!.value = this.look.haze;
    u.uRain!.value = this.look.rain;
    u.uSnow!.value = this.look.snow;
    u.uWind!.value = this.look.wind;
    u.uFlash!.value = this.lightning(dtMs / 1000);
    const c = this.composite.uniforms;
    c.uTime!.value = this.time;
    c.uMix!.value = this.mix;
    c.uDrops!.value = this.look.drops * this.motion;
  }

  render(): void {
    if (this.mix === 0) {
      if (this.blank) return;
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.blank = true;
      return;
    }
    this.blank = false;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.screen, this.camera);
  }

  /** A flash every few seconds in a storm: a bright strike, a flicker, then a fade. */
  private lightning(dt: number): number {
    const storm = this.look.storm * this.mix;
    if (storm < 0.05) return 0;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.flashAge = 0;
      this.nextFlash = (4 + Math.random() * 8) / storm;
    }
    this.flashAge += dt;
    const a = this.flashAge;
    const strike =
      Math.exp(-a / 0.08) + 0.6 * Math.exp(-Math.max(a - 0.16, 0) / 0.12) * Number(a > 0.16);
    // Flashing light is softened for anyone who asks for less motion.
    return Math.min(strike, 1) * storm * (this.motion < 1 ? 0.3 : 1);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.composite.dispose();
    this.renderer.dispose();
  }
}
