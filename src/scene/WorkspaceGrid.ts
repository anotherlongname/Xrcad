import * as THREE from 'three';
import { Units } from '../units/Units';

/**
 * Reference grid sitting at Y=0 (the work surface).
 * Minor lines every 10mm, major lines every 100mm.
 * Red axis = X, Blue axis = Z.
 */
export class WorkspaceGrid extends THREE.Group {
  private minorGrid: THREE.GridHelper;
  private majorGrid: THREE.GridHelper;

  constructor() {
    super();
    const sizeM = Units.mmToScene(1000); // 1000mm grid

    this.minorGrid = new THREE.GridHelper(sizeM, 100, 0x1a1a44, 0x1a1a44);
    this.majorGrid = new THREE.GridHelper(sizeM, 10, 0x2a2a77, 0x2a2a77);
    this.add(this.minorGrid, this.majorGrid);

    this.addAxes(sizeM);
    this.addOriginDot();
  }

  private addAxes(halfExtent: number): void {
    const axes: Array<[THREE.Vector3, THREE.Vector3, number]> = [
      [new THREE.Vector3(-halfExtent / 2, 0, 0), new THREE.Vector3(halfExtent / 2, 0, 0), 0xff3333],
      [new THREE.Vector3(0, 0, -halfExtent / 2), new THREE.Vector3(0, 0, halfExtent / 2), 0x3333ff],
    ];
    for (const [a, b, color] of axes) {
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      this.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
    }
  }

  private addOriginDot(): void {
    const r = Units.mmToScene(4);
    const geo = new THREE.SphereGeometry(r, 8, 8);
    this.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff })));
  }

  /** Rebuild grid geometry after workspace scale changes. */
  rebuild(): void {
    const sizeM = Units.mmToScene(1000);
    this.minorGrid.scale.setScalar(sizeM / this.minorGrid.geometry.boundingSphere!.radius / 2);
    this.majorGrid.scale.setScalar(sizeM / this.majorGrid.geometry.boundingSphere!.radius / 2);
  }
}
