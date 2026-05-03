import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { CSGScene } from '../csg/CSGScene';
import { CSGObject, CSGOperation } from '../csg/CSGObject';
import { Units } from '../units/Units';
import type { XrcadFile } from './FileFormat';

export class Importer {
  /** Load from localStorage autosave — works in VR without a file picker. */
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

  /** Open a file picker — works on desktop / 2D browser, not in active XR session. */
  static openFilePicker(scene: CSGScene): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xrcad,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        Importer.applyFile(scene, JSON.parse(text) as XrcadFile);
      } catch (e) {
        console.error('[XrCAD] Failed to parse file:', e);
      }
    };
    input.click();
  }

  /**
   * Open a file picker to import an STL mesh.
   * STL vertex coordinates are treated as millimetres.
   * The geometry is centred at the origin and placed on the grid.
   * `onImported` fires with the new CSGObject once added to the scene.
   */
  static importSTL(
    scene: CSGScene,
    op: CSGOperation,
    onImported: (obj: CSGObject) => void,
  ): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const geometry = new STLLoader().parse(buffer);

        // Centre geometry at origin (coordinates treated as mm)
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const center = new THREE.Vector3();
        box.getCenter(center);
        geometry.translate(-center.x, -center.y, -center.z);

        // Half-height in mm → restingY so the bottom face sits on the grid
        const halfH = (box.max.y - box.min.y) / 2;

        const obj = scene.addImportedObject(geometry, halfH, op);
        scene.compile();
        onImported(obj);
      } catch (e) {
        console.error('[XrCAD] STL import failed:', e);
      }
    };
    input.click();
  }

  private static applyFile(scene: CSGScene, file: XrcadFile): void {
    if (file.workspaceScale) Units.setScale(file.workspaceScale);
    scene.loadFromFile(file);
  }
}
