import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { CSGObject, CSGOperation, PrimitiveType } from './CSGObject';
import type { XrcadFile } from '../io/FileFormat';

const COMPILED_MAT = new THREE.MeshStandardMaterial({
  color: 0x3366ff,
  roughness: 0.4,
  metalness: 0.15,
});

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export class CSGScene extends THREE.Group {
  objects: CSGObject[] = [];
  private evaluator = new Evaluator();
  private resultMesh: Brush | null = null;
  /** Individual brushes shown during edit mode. */
  readonly previewGroup = new THREE.Group();
  private editMode = false;

  constructor() {
    super();
    this.add(this.previewGroup);
    this.previewGroup.visible = false;
  }

  addObject(type: PrimitiveType, operation: CSGOperation = 'add'): CSGObject {
    const obj = new CSGObject(type, operation);
    this.objects.push(obj);
    this.previewGroup.add(obj.brush);
    this.compile();
    return obj;
  }

  /** Add a mesh imported from an external file (e.g. STL). */
  addImportedObject(
    geometry: THREE.BufferGeometry,
    restingYMm: number,
    op: CSGOperation,
  ): CSGObject {
    const obj = new CSGObject('imported', op);
    obj.importedGeometry = geometry;
    obj.importedRestingYMm = restingYMm;
    obj.position.y = restingYMm;
    obj.rebuildBrush();
    this.objects.push(obj);
    this.previewGroup.add(obj.brush);
    return obj;
  }

  removeObject(id: string): void {
    const idx = this.objects.findIndex(o => o.id === id);
    if (idx === -1) return;
    const [obj] = this.objects.splice(idx, 1);
    this.previewGroup.remove(obj.brush);
    obj.brush.geometry.dispose();
    this.compile();
  }

  compile(): void {
    if (this.resultMesh) {
      this.remove(this.resultMesh);
      this.resultMesh.geometry.dispose();
      this.resultMesh = null;
    }

    const adds = this.objects.filter(o => o.operation === 'add');
    if (adds.length === 0) return;

    // Temporarily override each brush's matrixWorld with its local matrix so the
    // CSG result lives in csgScene-local space. This prevents the resultMesh from
    // being double-transformed when the workspace has been moved/rotated.
    // (previewGroup has identity transform, so brush.matrix === local-to-csgScene.)
    const savedMatrices = this.objects.map(o => o.brush.matrixWorld.clone());
    this.objects.forEach(o => {
      o.brush.updateMatrix();
      o.brush.matrixWorld.copy(o.brush.matrix);
    });

    let current: Brush;
    if (adds.length === 1) {
      const src = adds[0].brush;
      const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
      current = new Brush(geo);
      current.updateMatrixWorld(true);
    } else {
      current = this.evaluator.evaluate(adds[0].brush, adds[1].brush, ADDITION);
      current.updateMatrixWorld(true);
      for (let i = 2; i < adds.length; i++) {
        current = this.evaluator.evaluate(current, adds[i].brush, ADDITION);
        current.updateMatrixWorld(true);
      }
    }

    const subs = this.objects.filter(o => o.operation === 'subtract');
    for (const obj of subs) {
      current = this.evaluator.evaluate(current, obj.brush, SUBTRACTION);
      current.updateMatrixWorld(true);
    }

    // Restore brush matrixWorld values for same-frame operations (e.g. resize handles).
    this.objects.forEach((o, i) => o.brush.matrixWorld.copy(savedMatrices[i]));

    current.material = COMPILED_MAT;
    current.castShadow = true;
    current.receiveShadow = true;
    this.resultMesh = current;
    this.add(current);

    this.resultMesh.visible = !this.editMode;
  }

  setEditMode(on: boolean): void {
    this.editMode = on;
    this.previewGroup.visible = on;
    if (this.resultMesh) this.resultMesh.visible = !on;
  }

  /** Rebuild all brushes after workspace scale change, then recompile. */
  rebuildAll(): void {
    for (const obj of this.objects) obj.rebuildBrush();
    this.compile();
  }

  /** Replace scene contents from a parsed .xrcad file. */
  loadFromFile(file: XrcadFile): void {
    for (const obj of this.objects) {
      this.previewGroup.remove(obj.brush);
      obj.brush.geometry.dispose();
    }
    this.objects = [];
    if (this.resultMesh) {
      this.remove(this.resultMesh);
      this.resultMesh.geometry.dispose();
      this.resultMesh = null;
    }
    this.editMode = false;
    this.previewGroup.visible = false;

    for (const data of file.objects) {
      let obj: CSGObject;

      if (data.type === 'imported' && data.geometryData) {
        const positions = base64ToFloat32(data.geometryData);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        obj = new CSGObject(
          'imported', data.operation, {},
          new THREE.Vector3(data.position.x, data.position.y, data.position.z),
          data.id,
        );
        obj.importedGeometry = geometry;
        obj.importedRestingYMm = data.importedRestingY ?? 0;
      } else {
        obj = new CSGObject(
          data.type,
          data.operation,
          data.dims,
          new THREE.Vector3(data.position.x, data.position.y, data.position.z),
          data.id,
        );
      }

      obj.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
      obj.rebuildBrush();
      this.objects.push(obj);
      this.previewGroup.add(obj.brush);
    }

    this.compile();
  }

  /** Brushes that the selection raycaster should test against in edit mode. */
  get selectableObjects(): THREE.Object3D[] {
    return this.objects.map(o => o.brush);
  }
}
