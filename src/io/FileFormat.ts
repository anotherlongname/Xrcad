import type { PrimitiveType, CSGOperation, Dimensions } from '../csg/CSGObject';

export interface SerializedObject {
  id: string;
  type: PrimitiveType;
  operation: CSGOperation;
  dims: Dimensions;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  /** Base64-encoded Float32Array vertex positions; only present when type === 'imported'. */
  geometryData?: string;
  /** Half-height in mm for Y-drag lower bound; only present when type === 'imported'. */
  importedRestingY?: number;
}

export interface XrcadFile {
  version: 1;
  workspaceScale: number;
  objects: SerializedObject[];
}
