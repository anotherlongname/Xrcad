import * as THREE from 'three';
import { CSGScene } from '../csg/CSGScene';
import { CSGObject, Dimensions } from '../csg/CSGObject';
import { Units } from '../units/Units';

const CANVAS_W = 256;
const CANVAS_H = 48;
const WORLD_W  = 0.11; // meters

function formatDims(obj: CSGObject): string {
  const d = obj.dims as Record<string, number | undefined>;
  switch (obj.type) {
    case 'box':      return `${d.width ?? 0}×${d.height ?? 0}×${d.depth ?? 0}mm`;
    case 'sphere':   return `r${d.radius ?? 0}mm`;
    case 'cylinder': return `r${d.radiusTop ?? 0} h${d.height ?? 0}mm`;
    case 'cone':     return `r${d.radius ?? 0} h${d.height ?? 0}mm`;
    case 'torus':    return `r${d.radius ?? 0} t${d.tube ?? 0}mm`;
    case 'imported': return 'imported';
  }
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width  = CANVAS_W;
  c.height = CANVAS_H;
  return [c, c.getContext('2d')!];
}

function renderLabel(ctx: CanvasRenderingContext2D, obj: CSGObject): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Background pill
  const isHole = obj.operation === 'subtract';
  ctx.fillStyle = isHole ? 'rgba(80,20,10,0.82)' : 'rgba(10,20,50,0.82)';
  const r = 8;
  ctx.beginPath();
  ctx.roundRect(2, 2, CANVAS_W - 4, CANVAS_H - 4, r);
  ctx.fill();

  ctx.strokeStyle = isHole ? '#ff6644' : '#3b5bdb';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(2, 2, CANVAS_W - 4, CANVAS_H - 4, r);
  ctx.stroke();

  // Type name
  ctx.fillStyle = isHole ? '#fca5a5' : '#93c5fd';
  ctx.font = 'bold 16px monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(obj.type.toUpperCase(), 12, 6);

  // Dimensions
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px monospace';
  ctx.fillText(formatDims(obj), 12, 26);
}

export class ObjectLabelSystem {
  private labels = new Map<string, {
    sprite: THREE.Sprite;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
    lastDimHash: string;
  }>();

  constructor(
    private readonly csgScene: CSGScene,
    private readonly scene: THREE.Scene,
  ) {}

  update(): void {
    // Remove stale labels
    for (const [id, entry] of this.labels) {
      if (!this.csgScene.objects.find(o => o.id === id)) {
        this.scene.remove(entry.sprite);
        entry.texture.dispose();
        (entry.sprite.material as THREE.SpriteMaterial).dispose();
        this.labels.delete(id);
      }
    }

    for (const obj of this.csgScene.objects) {
      let entry = this.labels.get(obj.id);

      if (!entry) {
        const [canvas, ctx] = makeCanvas();
        const texture = new THREE.CanvasTexture(canvas);
        const mat  = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        const aspect = CANVAS_W / CANVAS_H;
        sprite.scale.set(WORLD_W, WORLD_W / aspect, 1);
        sprite.center.set(0.5, 0);  // anchor at bottom-center of sprite
        this.scene.add(sprite);
        entry = { sprite, canvas, ctx, texture, lastDimHash: '' };
        this.labels.set(obj.id, entry);
      }

      // Redraw only when dims/operation change
      const hash = `${obj.operation}|${JSON.stringify(obj.dims)}`;
      if (hash !== entry.lastDimHash) {
        renderLabel(entry.ctx, obj);
        entry.texture.needsUpdate = true;
        entry.lastDimHash = hash;
      }

      // Position: just above the object's top face
      const halfH = Units.mmToScene(this.objectHalfHeight(obj));
      const local = new THREE.Vector3(
        Units.mmToScene(obj.position.x),
        Units.mmToScene(obj.position.z) + halfH + Units.mmToScene(8),
        Units.mmToScene(obj.position.y),
      );
      entry.sprite.position.copy(this.csgScene.localToWorld(local));
    }
  }

  /** Show labels only in edit mode (object selected). */
  setVisible(v: boolean): void {
    for (const { sprite } of this.labels.values()) sprite.visible = v;
  }

  dispose(): void {
    for (const { sprite, texture } of this.labels.values()) {
      this.scene.remove(sprite);
      texture.dispose();
      (sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.labels.clear();
  }

  private objectHalfHeight(obj: CSGObject): number {
    const d = obj.dims as Record<string, number | undefined>;
    switch (obj.type) {
      case 'box':
      case 'cylinder':
      case 'cone':     return (d.height ?? 20) / 2;
      case 'sphere':   return d.radius ?? 10;
      case 'torus':    return d.tube ?? 3;
      case 'imported': return obj.importedRestingZMm;
    }
  }
}
