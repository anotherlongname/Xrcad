import * as THREE from 'three';
import { ControllerState } from './ControllerState';
import { CSGScene } from '../csg/CSGScene';
import { WorkspaceGrid } from '../scene/WorkspaceGrid';
import { Units } from '../units/Units';

/**
 * Scales the workspace by tracking the distance between both grips.
 * Pull hands apart → zoom in (objects appear larger).
 * Push hands together → zoom out.
 */
export class WorkspaceScaler {
  private prevDist = 0;
  private active = false;

  constructor(
    private readonly left: ControllerState,
    private readonly right: ControllerState,
    private readonly scene: CSGScene,
    private readonly grid: WorkspaceGrid,
  ) {}

  update(): void {
    const bothGrip = this.left.gripDown && this.right.gripDown;

    if (!bothGrip) {
      this.active = false;
      return;
    }

    const leftPos = new THREE.Vector3().setFromMatrixPosition(this.left.grip.matrixWorld);
    const rightPos = new THREE.Vector3().setFromMatrixPosition(this.right.grip.matrixWorld);
    const dist = leftPos.distanceTo(rightPos);

    if (!this.active) {
      this.prevDist = dist;
      this.active = true;
      return;
    }

    const delta = dist - this.prevDist;
    // Sensitivity: 1m of hand travel ≈ 3× scale change
    const newScale = Units.workspaceScale * (1 + delta * 3);
    Units.setScale(newScale);
    this.scene.rebuildAll();
    this.grid.rebuild(Units.workspaceScale);
    this.prevDist = dist;
  }

  get currentScale(): number {
    return Units.workspaceScale;
  }
}
