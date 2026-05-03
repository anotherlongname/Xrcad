/**
 * All scene distances are in meters (WebXR standard).
 * All user-facing measurements are in millimeters.
 * workspaceScale lets the user magnify small objects to comfortable VR size
 * without changing their stored mm dimensions.
 *
 * Example: a 10mm bolt at scale=10 occupies 0.1m (10cm) in VR space.
 */
export class Units {
  static workspaceScale = 1; // default: 1:1 real-world scale

  static mmToScene(mm: number): number {
    return (mm / 1000) * Units.workspaceScale;
  }

  static sceneToMm(scene: number): number {
    return (scene * 1000) / Units.workspaceScale;
  }

  /** 1.0 = 1:1 real-world scale. 10 = 10x magnification. */
  static setScale(scale: number): void {
    Units.workspaceScale = Math.max(0.1, scale);
  }
}
