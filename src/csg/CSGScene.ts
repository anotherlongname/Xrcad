import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { CSGObject, CSGOperation, PrimitiveType } from './CSGObject';
import type { XrcadFile } from '../io/FileFormat';

const COMPILED_MAT = new THREE.MeshStandardMaterial({
  color: 0x3366ff,
  roughness: 0.4,
  metalness: 0.15,
});

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

    adds.forEach(o => o.brush.updateMatrixWorld(true));

    let current: Brush;
    if (adds.length === 1) {
      // Single add — clone geometry into world space, no evaluation needed
      const src = adds[0].brush;
      const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
      current = new Brush(geo);
      current.updateMatrixWorld(true);
    } else {
      current = this.evaluator.evaluate(adds[0].brush, adds[1].brush, ADDITION);
      current.updateMatrixWorld(true);
      for (let i = 2; i < adds.length; i++) {
        adds[i].brush.updateMatrixWorld(true);
        current = this.evaluator.evaluate(current, adds[i].brush, ADDITION);
        current.updateMatrixWorld(true);
      }
    }

    const subs = this.objects.filter(o => o.operation === 'subtract');
    for (const obj of subs) {
      obj.brush.updateMatrixWorld(true);
      current = this.evaluator.evaluate(current, obj.brush, SUBTRACTION);
      current.updateMatrixWorld(true);
    }

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
      const obj = new CSGObject(
        data.type,
        data.operation,
        data.dims,
        new THREE.Vector3(data.position.x, data.position.y, data.position.z),
        data.id,
      );
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
