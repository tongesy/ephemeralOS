import type { OrbState } from '@ephemeralos/shared';
import {
  Mesh,
  NoBlending,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderer,
} from 'three';
import type { LevelsSnapshot } from '../audio/audio-levels.ts';
import { SPECTRUM_SIZE } from '../audio/envelope.ts';
import { blendLook, createBlendedLook } from './look.ts';
import { openSpacePlacement, type Rect } from './placement.ts';
import fragmentShader from './orb.frag.glsl?raw';
import vertexShader from './orb.vert.glsl?raw';
import { Spring } from './spring.ts';
import { StateBlend } from './state-blend.ts';

export interface OrbOptions {
  /** Honour `prefers-reduced-motion`: same states, far less movement. */
  reducedMotion: boolean;
}

export class Orb {
  readonly blend = new StateBlend('zen');

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly look = createBlendedLook();
  private readonly motion: number;

  /** Placement in CSS pixels; eased so the orb glides between open spaces. */
  private readonly x = new Spring(0, 0, 900);
  private readonly y = new Spring(0, 0, 900);
  private readonly radius = new Spring(0, 0, 900);
  private occupied: Rect[] = [];
  private placed = false;
  private time = 0;
  private swirlPhase = 0;
  private flowPhase = 0;
  private pixelRatio = Math.min(window.devicePixelRatio, 3);

  constructor(canvas: HTMLCanvasElement, options: OrbOptions) {
    this.motion = options.reducedMotion ? 0.3 : 1;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      // Transparent: the orb floats over the page and whatever is on it.
      alpha: true,
      premultipliedAlpha: true,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    // The shader does its own colour management (linear in, sRGB out).
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      // The shader writes premultiplied colour and alpha itself.
      blending: NoBlending,
      uniforms: {
        uTime: { value: 0 },
        uState: { value: Array.from(this.blend.weights) },
        uInputLevel: { value: 0 },
        uOutputLevel: { value: 0 },
        uBands: { value: new Vector4() },
        uSpectrumIn: { value: new Float32Array(SPECTRUM_SIZE) },
        uSpectrumOut: { value: new Float32Array(SPECTRUM_SIZE) },
        uResolution: { value: new Vector2() },
        uCenter: { value: new Vector2() },
        uRadius: { value: 1 },
        uColorA: { value: this.look.colors[0] },
        uColorB: { value: this.look.colors[1] },
        uColorC: { value: this.look.colors[2] },
        uIntensity: { value: 0 },
        uWarp: { value: 0 },
        uRipple: { value: 0 },
        uBreath: { value: 0 },
        uPulse: { value: 0 },
        uAura: { value: 0 },
        uOpacity: { value: 1 },
        uSwirlPhase: { value: 0 },
        uSwirl: { value: 0 },
        uFlowPhase: { value: 0 },
      },
    });

    this.scene.add(new Mesh(new PlaneGeometry(2, 2), this.material));

    this.resize();
  }

  /** Where the orb is drawn this frame, in CSS pixels: its centre and radius. */
  anchor = { x: 0, y: 0, radius: 0 };

  get state(): OrbState {
    return this.blend.state;
  }

  setState(state: OrbState): void {
    this.blend.set(state);
  }

  /**
   * Tell the orb which parts of the screen hold content. It glides to the most open
   * space that is left, and back to the centre once the screen is clear.
   */
  setOccupied(rects: Rect[]): void {
    this.occupied = rects;
    this.retarget();
  }

  private retarget(): void {
    const target = openSpacePlacement(window.innerWidth, window.innerHeight, this.occupied);
    if (!this.placed) {
      this.x.snap(target.x);
      this.y.snap(target.y);
      this.radius.snap(target.radius);
      this.placed = true;
      return;
    }
    this.x.target = target.x;
    this.y.target = target.y;
    this.radius.target = target.radius;
  }

  /** Render scale relative to CSS pixels; lowered by the quality governor when frames run long. */
  setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.resize();
  }

  resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, true);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this.material.uniforms.uResolution!.value.copy(size);
    this.retarget();
  }

  frame(dtMs: number, levels: LevelsSnapshot): void {
    const dt = dtMs / 1000;
    const u = this.material.uniforms;
    const weights = this.blend.update(dtMs);
    blendLook(weights, this.look);

    this.time += dt * this.motion;
    this.swirlPhase = (this.swirlPhase + dt * this.look.swirl * this.motion) % (2 * Math.PI);
    this.flowPhase += dt * this.look.flow * this.motion;

    // CSS pixels (top-left origin) → drawing-buffer pixels (bottom-left origin).
    const ratio = this.renderer.getPixelRatio();
    const x = this.x.update(dtMs);
    const y = this.y.update(dtMs);
    const radius = this.radius.update(dtMs) * this.look.size;
    this.anchor = { x, y, radius };
    (u.uCenter!.value as Vector2).set(x * ratio, (window.innerHeight - y) * ratio);
    u.uRadius!.value = radius * ratio;

    u.uTime!.value = this.time;
    (u.uState!.value as number[]).splice(0, weights.length, ...weights);
    u.uInputLevel!.value = levels.input;
    u.uOutputLevel!.value = levels.output;
    (u.uBands!.value as Vector4).fromArray(levels.bands);
    (u.uSpectrumIn!.value as Float32Array).set(levels.spectrumIn);
    (u.uSpectrumOut!.value as Float32Array).set(levels.spectrumOut);
    u.uIntensity!.value = this.look.intensity;
    u.uWarp!.value = this.look.warp;
    u.uAura!.value = this.look.aura;
    u.uOpacity!.value = this.look.opacity;
    u.uRipple!.value = this.look.ripple * this.motion;
    u.uBreath!.value = this.look.breath * this.motion;
    u.uPulse!.value = this.look.pulse * (0.4 + 0.6 * this.motion);
    u.uSwirlPhase!.value = this.swirlPhase;
    u.uSwirl!.value = this.look.swirl * this.motion;
    u.uFlowPhase!.value = this.flowPhase;

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
    this.renderer.dispose();
  }
}
