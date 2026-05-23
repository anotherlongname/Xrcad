import * as THREE from 'three';

export interface PanelButton {
  id: string;
  label: string;
  /** Canvas pixel coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
}

/**
 * Base class for all floating VR UI panels.
 * Renders to an HTML canvas which is streamed as a CanvasTexture onto a PlaneGeometry.
 * Subclasses define buttons and override draw().
 */
export abstract class VRPanel extends THREE.Group {
  protected readonly cw: number;
  protected readonly ch: number;
  protected readonly canvas: HTMLCanvasElement;
  protected readonly ctx: CanvasRenderingContext2D;
  protected readonly texture: THREE.CanvasTexture;
  protected readonly mesh: THREE.Mesh;
  protected buttons: PanelButton[] = [];
  private hoveredId: string | null = null;
  private _fadeOpacity    = 1;
  private _targetOpacity  = 1;
  private static readonly FADE_RATE = 1 / 0.15; // full transition in 150 ms

  constructor(worldWidth: number, worldHeight: number, canvasWidth = 512) {
    super();
    this.cw = canvasWidth;
    this.ch = Math.round(canvasWidth * (worldHeight / worldWidth));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldWidth, worldHeight),
      new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide, transparent: true }),
    );
    this.add(this.mesh);
  }

  /** Call after modifying state to redraw and upload texture. */
  dirty(): void {
    this.draw();
    this.texture.needsUpdate = true;
  }

  /** Show with a fade-in. */
  fadeIn(): void {
    this.visible = true;
    this._targetOpacity = 1;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this._fadeOpacity;
  }

  /** Fade out, then hide. */
  fadeOut(): void {
    this._targetOpacity = 0;
  }

  /** Advance fade animation. Call once per frame with elapsed seconds. */
  tick(dtSec: number): void {
    if (this._fadeOpacity === this._targetOpacity) return;
    const dir = this._targetOpacity > this._fadeOpacity ? 1 : -1;
    this._fadeOpacity = Math.max(0, Math.min(1, this._fadeOpacity + dir * VRPanel.FADE_RATE * dtSec));
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this._fadeOpacity;
    if (this._fadeOpacity === 0) this.visible = false;
  }

  protected abstract draw(): void;

  // ── Hit testing ─────────────────────────────────────────────────────────────

  hitTest(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObject(this.mesh);
    if (!hits.length || !hits[0].uv) return null;
    const px = hits[0].uv.x * this.cw;
    const py = (1 - hits[0].uv.y) * this.ch;
    for (const btn of this.buttons) {
      if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
        return btn.id;
      }
    }
    return null;
  }

  onHover(id: string | null): void {
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.dirty();
    }
  }

  onPress(id: string | null, haptic?: () => void): void {
    if (!id) return;
    haptic?.();
    this.buttons.find(b => b.id === id)?.action();
  }

  /** The underlying plane mesh, used for raycaster hit-type detection. */
  get panelMesh(): THREE.Mesh { return this.mesh; }

  protected get hovered(): string | null {
    return this.hoveredId;
  }

  // ── Drawing helpers ──────────────────────────────────────────────────────────

  protected background(color = '#111827'): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.cw, this.ch);
    this.ctx.strokeStyle = '#2a3a6a';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(1, 1, this.cw - 2, this.ch - 2);
  }

  protected text(
    str: string,
    x: number,
    y: number,
    size = 22,
    color = '#e0e8ff',
    align: CanvasTextAlign = 'left',
    baseline: CanvasTextBaseline = 'top',
  ): void {
    this.ctx.fillStyle = color;
    this.ctx.font = `${size}px monospace`;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = baseline;
    this.ctx.fillText(str, x, y);
  }

  protected button(btn: PanelButton, active = false): void {
    const isHov = btn.id === this.hoveredId;
    this.ctx.fillStyle = active ? '#1e3a8a' : isHov ? '#1e2d5a' : '#0f172a';
    this.ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
    this.ctx.strokeStyle = active ? '#60a5fa' : isHov ? '#3b5bdb' : '#1e3a6a';
    this.ctx.lineWidth = isHov || active ? 2 : 1;
    this.ctx.strokeRect(btn.x + 0.5, btn.y + 0.5, btn.w - 1, btn.h - 1);
    this.ctx.fillStyle = active ? '#93c5fd' : '#e0e8ff';
    this.ctx.font = '20px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
  }
}
