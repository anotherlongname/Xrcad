import * as THREE from 'three';
import { Brush } from 'three-bvh-csg';
import { Units } from '../units/Units';

export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus';
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
};

const ADD_COLOR = 0x3366ff;
const SUB_COLOR = 0xff3333;

export class CSGObject {
  readonly id: string;
  type: PrimitiveType;
  operation: CSGOperation;
  dims: Dimensions;
  /** Position stored in mm. */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  brush: Brush;

  static defaultDims(type: PrimitiveType): Dimensions {
    return { ...DEFAULTS[type] };
  }

  /** Y offset in mm so the primitive rests on the grid. */
  static restingY(type: PrimitiveType, dims: Dimensions): number {
    switch (type) {
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
    this.position = position?.clone() ?? new THREE.Vector3(0, CSGObject.restingY(type, this.dims), 0);
    this.rotation = new THREE.Euler();
    this.brush = this.buildBrush();
  }

  private buildGeometry(): THREE.BufferGeometry {
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
    const mat = new THREE.MeshStandardMaterial({
      color: this.operation === 'add' ? ADD_COLOR : SUB_COLOR,
      transparent: true,
      opacity: 0.75,
      roughness: 0.4,
    });
    const brush = new Brush(geo, mat);
    this.applyTransformToBrush(brush);
    return brush;
  }

  rebuildBrush(): void {
    this.brush.geometry.dispose();
    this.brush.geometry = this.buildGeometry();
    (this.brush.material as THREE.MeshStandardMaterial).color.set(
      this.operation === 'add' ? ADD_COLOR : SUB_COLOR,
    );
    this.applyTransformToBrush(this.brush);
  }

  private applyTransformToBrush(brush: Brush): void {
    brush.position.set(
      Units.mmToScene(this.position.x),
      Units.mmToScene(this.position.y),
      Units.mmToScene(this.position.z),
    );
    brush.rotation.copy(this.rotation);
    brush.updateMatrixWorld(true);
  }
}
