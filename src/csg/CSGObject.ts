import * as THREE from 'three';
import { Brush } from 'three-bvh-csg';
import { Units } from '../units/Units';

export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'imported';
export type CSGOperation = 'add' | 'subtract';

export interface Dimensions {
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  tube?: number;
  radiusTop?: number;
  radiusBottom?: number;
}

const DEFAULTS: Record<PrimitiveType, Dimensions> = {
  box:      { width: 20, height: 20, depth: 20 },
  sphere:   { radius: 10 },
  cylinder: { radiusTop: 8, radiusBottom: 8, height: 20 },
  cone:     { radius: 8, height: 20 },
  torus:    { radius: 10, tube: 3 },
  imported: {},
};

const ADD_COLOR = 0x3366ff;
const SUB_COLOR = 0xff2200;

export class CSGObject {
  readonly id: string;
  type: PrimitiveType;
  operation: CSGOperation;
  dims: Dimensions;
  /** Position stored in mm. */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  brush: Brush;

  /** Raw geometry with coordinates in mm; set for type === 'imported'. */
  importedGeometry: THREE.BufferGeometry | null = null;
  /** Half-height in mm used as Z-drag lower bound for imported meshes. */
  importedRestingZMm = 0;

  static defaultDims(type: PrimitiveType): Dimensions {
    return { ...DEFAULTS[type] };
  }

  /** Z offset in mm so the primitive rests on the grid (CAD Z = up/down). */
  static restingZ(type: PrimitiveType, dims: Dimensions, importedRestingZ = 0): number {
    switch (type) {
      case 'imported':  return importedRestingZ;
      case 'box':      return (dims.height ?? 20) / 2;
      case 'sphere':   return dims.radius ?? 10;
      case 'cylinder': return (dims.height ?? 20) / 2;
      case 'cone':     return (dims.height ?? 20) / 2;
      case 'torus':    return (dims.tube ?? 3);
    }
  }

  constructor(
    type: PrimitiveType,
    operation: CSGOperation = 'add',
    dims?: Dimensions,
    position?: THREE.Vector3,
    id?: string,
  ) {
    this.id = id ?? crypto.randomUUID();
    this.type = type;
    this.operation = operation;
    this.dims = { ...DEFAULTS[type], ...dims };
    this.position = position?.clone() ?? new THREE.Vector3(0, 0, CSGObject.restingZ(type, this.dims));
    this.rotation = new THREE.Euler();
    this.brush = this.buildBrush();
  }

  private buildGeometry(): THREE.BufferGeometry {
    if (this.type === 'imported') {
      if (!this.importedGeometry) return new THREE.BufferGeometry();
      const geo = this.importedGeometry.clone();
      const s = Units.mmToScene(1);
      geo.scale(s, s, s);
      return geo;
    }
    const d = this.dims;
    switch (this.type) {
      case 'box':
        return new THREE.BoxGeometry(
          Units.mmToScene(d.width!),
          Units.mmToScene(d.height!),
          Units.mmToScene(d.depth!),
        );
      case 'sphere':
        return new THREE.SphereGeometry(Units.mmToScene(d.radius!), 32, 16);
      case 'cylinder':
        return new THREE.CylinderGeometry(
          Units.mmToScene(d.radiusTop!),
          Units.mmToScene(d.radiusBottom!),
          Units.mmToScene(d.height!),
          32,
        );
      case 'cone':
        return new THREE.ConeGeometry(Units.mmToScene(d.radius!), Units.mmToScene(d.height!), 32);
      case 'torus':
        return new THREE.TorusGeometry(Units.mmToScene(d.radius!), Units.mmToScene(d.tube!), 16, 64);
    }
  }

  buildBrush(): Brush {
    const geo = this.buildGeometry();
    const isSub = this.operation === 'subtract';
    const mat = new THREE.MeshStandardMaterial({
      color: isSub ? SUB_COLOR : ADD_COLOR,
      transparent: true,
      opacity: isSub ? 0.35 : 0.75,
      roughness: 0.4,
      side: isSub ? THREE.DoubleSide : THREE.FrontSide,
    });
    const brush = new Brush(geo, mat);
    this.applyTransformToBrush(brush);
    return brush;
  }

  rebuildBrush(): void {
    this.brush.geometry.dispose();
    this.brush.geometry = this.buildGeometry();
    const isSub = this.operation === 'subtract';
    const mat = this.brush.material as THREE.MeshStandardMaterial;
    mat.color.set(isSub ? SUB_COLOR : ADD_COLOR);
    mat.opacity  = isSub ? 0.35 : 0.75;
    mat.side     = isSub ? THREE.DoubleSide : THREE.FrontSide;
    mat.needsUpdate = true;
    this.applyTransformToBrush(this.brush);
  }

  private applyTransformToBrush(brush: Brush): void {
    // CAD uses Z-up convention; Three.js uses Y-up. Remap here so the scene
    // renders correctly while the inspector shows the CAD-native axes.
    brush.position.set(
      Units.mmToScene(this.position.x),  // CAD X → Three.js X (unchanged)
      Units.mmToScene(this.position.z),  // CAD Z (up) → Three.js Y (up)
      Units.mmToScene(this.position.y),  // CAD Y (depth) → Three.js Z (depth)
    );
    brush.rotation.copy(this.rotation);
    brush.updateMatrixWorld(true);
  }
}
