import * as THREE from 'three';
import { Units } from '../units/Units';

/**
 * Reference grid at Y=0 with minor lines every 10mm and major lines every 100mm.
 * Red axis = X, Blue axis = Y (depth in CAD convention), white dot at origin.
 * Call rebuild() after Units.workspaceScale changes.
 */
export class WorkspaceGrid extends THREE.Group {
  private minor: THREE.GridHelper;
  private major: THREE.GridHelper;
  private axisGroup = new THREE.Group();

  constructor() {
    super();
    const size = Units.mmToScene(1000);
    this.minor = new THREE.GridHelper(size, 100, 0x0f172a, 0x0f172a);
    this.major = new THREE.GridHelper(size, 10, 0x1e3a5f, 0x1e3a5f);
    this.add(this.minor, this.major, this.axisGroup);
    this.buildAxes(size);
    this.buildOrigin();
  }

  private buildAxes(size: number): void {
    this.axisGroup.clear();
    const half = size / 2;
    const axes: [THREE.Vector3, THREE.Vector3, number][] = [
      [new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0), 0xff3333],
      [new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half), 0x3355ff],
    ];
    for (const [a, b, color] of axes) {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      this.axisGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
    }
    const r = Units.mmToScene(4);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(r, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.axisGroup.add(dot);
  }

  private buildOrigin(): void {
    // origin dot already added in buildAxes
  }

  /** Rebuild after workspace scale changes. */
  rebuild(newScale: number): void {
    this.remove(this.minor, this.major, this.axisGroup);
    this.axisGroup = new THREE.Group();

    const size = (1000 / 1000) * newScale; // mmToScene(1000)
    this.minor = new THREE.GridHelper(size, 100, 0x0f172a, 0x0f172a);
    this.major = new THREE.GridHelper(size, 10, 0x1e3a5f, 0x1e3a5f);
    this.add(this.minor, this.major, this.axisGroup);
    this.buildAxes(size);
  }
}
