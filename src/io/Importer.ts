import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { CSGScene } from '../csg/CSGScene';
import { CSGObject, CSGOperation } from '../csg/CSGObject';
import { Units } from '../units/Units';
import type { XrcadFile } from './FileFormat';

const STAGED_STL_KEY = 'xrcad_staged_stl';

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function processSTLBuffer(buffer: ArrayBuffer): { geometryData: string; halfH: number } {
  const geometry = new STLLoader().parse(buffer);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  const halfH = (box.max.y - box.min.y) / 2;
  const positions = geometry.attributes.position.array as Float32Array;
  return { geometryData: float32ToBase64(positions), halfH };
}

function geometryFromStaged(geometryData: string): THREE.BufferGeometry {
  const positions = base64ToFloat32(geometryData);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

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
   * Process an STL file and save it to localStorage so it can be loaded
   * inside an active WebXR session (where file pickers are unavailable).
   * Call this from a 2D browser context before entering VR.
   * `onReady` is called with the file name on success.
   */
  static stageSTLForVR(onReady: (name: string) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const staged = processSTLBuffer(buffer);
        localStorage.setItem(STAGED_STL_KEY, JSON.stringify({ ...staged, name: file.name }));
        onReady(file.name);
      } catch (e) {
        console.error('[XrCAD] STL staging failed:', e);
      }
    };
    input.click();
  }

  /** True if an STL has been staged and is waiting to be imported. */
  static hasStagedSTL(): boolean {
    return localStorage.getItem(STAGED_STL_KEY) !== null;
  }

  /**
   * Import an STL mesh into the scene.
   *
   * In VR (or when a staged file is available) this loads from the
   * localStorage entry written by `stageSTLForVR`. Otherwise it opens a
   * native file picker (works on desktop / 2D browser).
   *
   * `onImported` fires with the new CSGObject once it has been added.
   */
  static importSTL(
    scene: CSGScene,
    op: CSGOperation,
    onImported: (obj: CSGObject) => void,
  ): void {
    // Prefer staged file — the only path that works inside a WebXR session.
    const raw = localStorage.getItem(STAGED_STL_KEY);
    if (raw) {
      try {
        localStorage.removeItem(STAGED_STL_KEY);
        const { geometryData, halfH } = JSON.parse(raw) as { geometryData: string; halfH: number };
        const geometry = geometryFromStaged(geometryData);
        const obj = scene.addImportedObject(geometry, halfH, op);
        scene.compile();
        onImported(obj);
      } catch (e) {
        console.error('[XrCAD] Failed to load staged STL:', e);
      }
      return;
    }

    // Fall back to file picker (works on desktop, silently fails in active XR session).
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const { geometryData, halfH } = processSTLBuffer(buffer);
        const geometry = geometryFromStaged(geometryData);
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
