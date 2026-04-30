import { CSGScene } from '../csg/CSGScene';
import { Units } from '../units/Units';
import type { XrcadFile, SerializedObject } from './FileFormat';

export class Exporter {
  static serialize(scene: CSGScene): XrcadFile {
    return {
      version: 1,
      workspaceScale: Units.workspaceScale,
      objects: scene.objects.map(obj => ({
        id: obj.id,
        type: obj.type,
        operation: obj.operation,
        dims: { ...obj.dims },
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
      } satisfies SerializedObject)),
    };
  }

  /** Save to localStorage (works in VR) and also trigger a file download. */
  static save(scene: CSGScene): void {
    const json = JSON.stringify(Exporter.serialize(scene), null, 2);
    localStorage.setItem('xrcad_autosave', json);
    Exporter.downloadJson(json);
  }

  private static downloadJson(json: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `design_${Date.now()}.xrcad`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
