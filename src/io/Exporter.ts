import { CSGScene } from '../csg/CSGScene';
import { Units } from '../units/Units';
import type { XrcadFile, SerializedObject } from './FileFormat';

function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export class Exporter {
  static serialize(scene: CSGScene): XrcadFile {
    return {
      version: 1,
      workspaceScale: Units.workspaceScale,
      objects: scene.objects.map(obj => {
        const serialized: SerializedObject = {
          id: obj.id,
          type: obj.type,
          operation: obj.operation,
          dims: { ...obj.dims },
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        };
        if (obj.type === 'imported' && obj.importedGeometry) {
          const positions = obj.importedGeometry.attributes.position.array as Float32Array;
          serialized.geometryData = float32ToBase64(positions);
          serialized.importedRestingZ = obj.importedRestingZMm;
        }
        return serialized;
      }),
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
