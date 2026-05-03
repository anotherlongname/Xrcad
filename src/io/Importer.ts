import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { CSGScene } from '../csg/CSGScene';
import { CSGObject, CSGOperation } from '../csg/CSGObject';
import { Units } from '../units/Units';
import type { XrcadFile } from './FileFormat';

const STAGED_STL_KEY = 'xrcad_staged_stl';

function float32ToBase64(arr: Float32Array): string {
  // Use byteOffset/byteLength in case arr is a view into a larger buffer
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
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

/**
 * Centre the geometry, then normalise so the longest axis equals 100 mm if the
 * raw coordinates fall outside the plausible mm range (< 1 mm or > 500 mm).
 * This handles STLs exported in metres or inches without breaking normal mm files.
 */
function processSTLBuffer(buffer: ArrayBuffer): { geometryData: string; halfH: number } {
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

  const halfH = size.y / 2;
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
   * Show the dom-overlay import panel so the user can pick a file while in VR.
   * The overlay's file input provides a proper user-gesture context on Meta Quest,
   * allowing the native file picker to open reliably on every press.
   *
   * `onImported` fires after the object is added but before compile so the caller
   * can reposition it first.
   */
  static importSTLViaOverlay(
    panelEl: HTMLElement,
    inputEl: HTMLInputElement,
    scene: CSGScene,
    op: CSGOperation,
    onImported: (obj: CSGObject) => void,
  ): void {
    inputEl.value = ''; // reset so 'change' fires even if same file is re-selected
    inputEl.onchange = async () => {
      panelEl.style.display = 'none';
      const file = inputEl.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const { geometryData, halfH } = processSTLBuffer(buffer);
        const geometry = geometryFromStaged(geometryData);
        const obj = scene.addImportedObject(geometry, halfH, op);
        onImported(obj);
      } catch (e) {
        console.error('[XrCAD] STL overlay import failed:', e);
      }
    };
    panelEl.style.display = 'block';
  }

  /**
   * Import an STL mesh into the scene.
   *
   * Priority order:
   *  1. Staged file in localStorage  — instant, always works in XR
   *  2. dom-overlay panel            — reliable in-VR file picker (Meta Quest)
   *  3. Direct <input> click         — works on desktop, may fail in active XR
   *
   * `onImported` fires after the object is added but BEFORE compile so the caller
   * can reposition the object before compiling.
   */
  static importSTL(
    scene: CSGScene,
    op: CSGOperation,
    onImported: (obj: CSGObject) => void,
    overlayPanel?: HTMLElement,
    overlayInput?: HTMLInputElement,
  ): void {
    // 1. Pre-staged file
    const raw = localStorage.getItem(STAGED_STL_KEY);
    if (raw) {
      try {
        localStorage.removeItem(STAGED_STL_KEY);
        const { geometryData, halfH } = JSON.parse(raw) as { geometryData: string; halfH: number };
        const geometry = geometryFromStaged(geometryData);
        const obj = scene.addImportedObject(geometry, halfH, op);
        onImported(obj);
      } catch (e) {
        console.error('[XrCAD] Failed to load staged STL:', e);
      }
      return;
    }

    // 2. dom-overlay (reliable on Meta Quest)
    if (overlayPanel && overlayInput) {
      Importer.importSTLViaOverlay(overlayPanel, overlayInput, scene, op, onImported);
      return;
    }

    // 3. Direct file picker fallback (desktop; silently fails in active XR session)
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
