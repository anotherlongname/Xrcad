import type { PrimitiveType, CSGOperation, Dimensions } from '../csg/CSGObject';

export interface SerializedObject {
  id: string;
  type: PrimitiveType;
  operation: CSGOperation;
  dims: Dimensions;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface XrcadFile {
  version: 1;
  workspaceScale: number;
  objects: SerializedObject[];
}
