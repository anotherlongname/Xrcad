import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { CSGScene } from '../csg/CSGScene';
import { CSGObject, CSGOperation } from '../csg/CSGObject';
import { Units } from '../units/Units';
import type { XrcadFile } from './FileFormat';

/**
 * Centre the geometry, then normalise so the longest axis equals 100 mm if the
 * raw coordinates fall outside the plausible mm range (< 1 mm or > 500 mm).
 * This handles STLs exported in metres or inches without breaking normal mm files.
 */
function processSTLBuffer(buffer: ArrayBuffer): { geometry: THREE.BufferGeometry; restingZ: number } {
  const geometry = new STLLoader().parse(buffer);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);

  if (maxDim > 0 && (maxDim < 1 || maxDim > 500)) {
    const s = 100 / maxDim;
    geometry.scale(s, s, s);
    size.multiplyScalar(s);
  }

  // STL files from 3D printing / CAD tools use Z-up convention.
  // Rotate −90° around X so STL-Z (up) maps to Three.js-Y (up), standing the
  // model upright instead of laying it on its side.
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

  // Recompute bounding box after rotation; restingZ is now the correct half-height.
  geometry.computeBoundingBox();
  geometry.boundingBox!.getSize(size);

  geometry.computeVertexNormals();
  const restingZ = size.y / 2;
  return { geometry, restingZ };
}

export class Importer {
  /** Load from localStorage autosave. */
  static loadAutosave(scene: CSGScene): boolean {
    const raw = localStorage.getItem('xrcad_autosave');
    if (!raw) return false;
    try {
      Importer.applyFile(scene, JSON.parse(raw) as XrcadFile);
      return true;
    } catch {
      return false;
    }
  }

  /** Open a .xrcad file picker (2D browser context only). */
  static openFilePicker(scene: CSGScene, onLoaded?: () => void, onError?: () => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xrcad,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        Importer.applyFile(scene, JSON.parse(text) as XrcadFile);
        onLoaded?.();
      } catch (e) {
        console.error('[XrCAD] Failed to parse file:', e);
        onError?.();
      }
    };
    input.click();
  }

  /** Open an STL file picker (2D browser context only). */
  static importSTL2D(
    scene: CSGScene,
    op: CSGOperation,
    onImported: (obj: CSGObject) => void,
    onError?: () => void,
  ): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const { geometry, restingZ } = processSTLBuffer(buffer);
        const obj = scene.addImportedObject(geometry, restingZ, op);
        onImported(obj);
      } catch (e) {
        console.error('[XrCAD] STL import failed:', e);
        onError?.();
      }
    };
    input.click();
  }

  private static applyFile(scene: CSGScene, file: XrcadFile): void {
    if (file.workspaceScale) Units.setScale(file.workspaceScale);
    scene.loadFromFile(file);
  }
}
