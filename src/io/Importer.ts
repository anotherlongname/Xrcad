import { CSGScene } from '../csg/CSGScene';
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

  private static applyFile(scene: CSGScene, file: XrcadFile): void {
    if (file.workspaceScale) Units.setScale(file.workspaceScale);
    scene.loadFromFile(file);
  }
}
