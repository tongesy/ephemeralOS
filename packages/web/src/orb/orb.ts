import type { OrbState } from '@ephemeralos/shared';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import {
  HalfFloatType,
  Mesh,
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
import { blendLook, createBlendedLook } from './look.ts';
import fragmentShader from './orb.frag.glsl?raw';
import vertexShader from './orb.vert.glsl?raw';
import { StateBlend } from './state-blend.ts';

export interface OrbOptions {
  /** Honour `prefers-reduced-motion`: same states, far less movement. */
  reducedMotion: boolean;
}

/** Orb size as a fraction of the shorter screen side. */
const RADIUS_CENTRED = 0.17;
const RADIUS_DOCKED = 0.055;
/** Docked orb sits this far (fraction of shorter side) from the bottom-right corner. */
const DOCK_MARGIN = 0.06;
/** Time constant for docking moves, in ms. */
const DOCK_TAU_MS = 160;

export class Orb {
  readonly blend = new StateBlend('zen');

  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly material: ShaderMaterial;
  private readonly look = createBlendedLook();
  private readonly motion: number;

  private dock = 0;
  private dockTarget = 0;
  private time = 0;
  private swirlPhase = 0;
  private flowPhase = 0;
  private pixelRatio = Math.min(window.devicePixelRatio, 2);

  constructor(canvas: HTMLCanvasElement, options: OrbOptions) {
    this.motion = options.reducedMotion ? 0.3 : 1;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uState: { value: Array.from(this.blend.weights) },
        uInputLevel: { value: 0 },
        uOutputLevel: { value: 0 },
        uBands: { value: new Vector4() },
        uResolution: { value: new Vector2() },
        uCenter: { value: new Vector2() },
        uRadius: { value: 1 },
        uCore: { value: this.look.core },
        uDeep: { value: this.look.deep },
        uRim: { value: this.look.rim },
        uIntensity: { value: 0 },
        uRipple: { value: 0 },
        uBreath: { value: 0 },
        uPulse: { value: 0 },
        uSwirlPhase: { value: 0 },
        uFlowPhase: { value: 0 },
      },
    });

    const scene = new Scene();
    scene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(
      new EffectPass(
        camera,
        new BloomEffect({
          mipmapBlur: true,
          luminanceThreshold: 0.62,
          luminanceSmoothing: 0.3,
          intensity: 0.7,
          radius: 0.68,
        }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      ),
    );

    this.resize();
  }

  get state(): OrbState {
    return this.blend.state;
  }

  setState(state: OrbState): void {
    this.blend.set(state);
  }

  /** Move to a corner (content on screen) or back to the centre. */
  setDocked(docked: boolean): void {
    this.dockTarget = docked ? 1 : 0;
  }

  get docked(): boolean {
    return this.dockTarget === 1;
  }

  /** Render scale relative to CSS pixels; lowered by the quality governor when frames run long. */
  setPixelRatio(ratio: number): void {
    this.pixelRatio = ratio;
    this.resize();
  }

  resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h, true);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    this.material.uniforms.uResolution!.value.copy(size);
  }

  frame(dtMs: number, levels: LevelsSnapshot): void {
    const dt = dtMs / 1000;
    const u = this.material.uniforms;
    const weights = this.blend.update(dtMs);
    blendLook(weights, this.look);

    this.time += dt * this.motion;
    this.swirlPhase += dt * this.look.swirl * this.motion;
    this.flowPhase += dt * this.look.flow * this.motion;
    this.dock += (this.dockTarget - this.dock) * (1 - Math.exp(-dtMs / DOCK_TAU_MS));

    const res = u.uResolution!.value as Vector2;
    const short = Math.min(res.x, res.y);
    const ease = this.dock * this.dock * (3 - 2 * this.dock);
    const radius = short * (RADIUS_CENTRED + (RADIUS_DOCKED - RADIUS_CENTRED) * ease);
    const dockedX = res.x - short * (DOCK_MARGIN + RADIUS_DOCKED);
    const dockedY = short * (DOCK_MARGIN + RADIUS_DOCKED);
    (u.uCenter!.value as Vector2).set(
      res.x / 2 + (dockedX - res.x / 2) * ease,
      res.y / 2 + (dockedY - res.y / 2) * ease,
    );

    u.uTime!.value = this.time;
    (u.uState!.value as number[]).splice(0, weights.length, ...weights);
    u.uInputLevel!.value = levels.input;
    u.uOutputLevel!.value = levels.output;
    (u.uBands!.value as Vector4).fromArray(levels.bands);
    u.uRadius!.value = radius;
    u.uIntensity!.value = this.look.intensity;
    u.uRipple!.value = this.look.ripple * this.motion;
    u.uBreath!.value = this.look.breath * this.motion;
    u.uPulse!.value = this.look.pulse * (0.4 + 0.6 * this.motion);
    u.uSwirlPhase!.value = this.swirlPhase;
    u.uFlowPhase!.value = this.flowPhase;

    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
