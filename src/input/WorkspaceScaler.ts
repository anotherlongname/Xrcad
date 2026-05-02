import * as THREE from 'three';
import { ControllerState } from './ControllerState';
import { CSGScene } from '../csg/CSGScene';
import { WorkspaceGrid } from '../scene/WorkspaceGrid';
import { Units } from '../units/Units';

export class WorkspaceScaler {
  private prevDist = 0;
  private active = false;
  private mode: 'scale' | 'transform' = 'scale';

  private readonly prevMid = new THREE.Vector3();
  private readonly prevVec = new THREE.Vector3();

  constructor(
    private readonly left: ControllerState,
    private readonly right: ControllerState,
    private readonly csgScene: CSGScene,
    private readonly grid: WorkspaceGrid,
  ) {}

  /** Toggle between scale and move/rotate mode; returns the new mode. */
  toggleMode(): 'scale' | 'transform' {
    this.mode = this.mode === 'scale' ? 'transform' : 'scale';
    this.active = false;
    return this.mode;
  }

  get currentMode(): 'scale' | 'transform' { return this.mode; }

  update(): void {
    const bothGrip = this.left.gripDown && this.right.gripDown;
    if (!bothGrip) { this.active = false; return; }
    this.mode === 'scale' ? this.updateScale() : this.updateTransform();
  }

  // ── Scale mode ───────────────────────────────────────────────────────────────

  private updateScale(): void {
    const leftPos  = new THREE.Vector3().setFromMatrixPosition(this.left.grip.matrixWorld);
    const rightPos = new THREE.Vector3().setFromMatrixPosition(this.right.grip.matrixWorld);
    const dist = leftPos.distanceTo(rightPos);

    if (!this.active) { this.prevDist = dist; this.active = true; return; }

    const delta = dist - this.prevDist;
    Units.setScale(Units.workspaceScale * (1 + delta * 3));
    this.csgScene.rebuildAll();
    this.grid.rebuild(Units.workspaceScale);
    this.prevDist = dist;
  }

  // ── Transform mode ───────────────────────────────────────────────────────────

  private updateTransform(): void {
    const L = new THREE.Vector3().setFromMatrixPosition(this.left.grip.matrixWorld);
    const R = new THREE.Vector3().setFromMatrixPosition(this.right.grip.matrixWorld);

    const currMid = new THREE.Vector3().addVectors(L, R).multiplyScalar(0.5);
    const currVec = new THREE.Vector3().subVectors(R, L);

    if (!this.active) {
      this.prevMid.copy(currMid);
      this.prevVec.copy(currVec);
      this.active = true;
      return;
    }

    // 3-axis translation via midpoint delta
    const translation = new THREE.Vector3().subVectors(currMid, this.prevMid);

    // Yaw: horizontal rotation of the controller-to-controller vector (Y axis)
    const yawDelta =
      Math.atan2(currVec.x, currVec.z) - Math.atan2(this.prevVec.x, this.prevVec.z);

    // Pitch: vertical tilt of the controller-to-controller vector
    const prevHoriz = Math.hypot(this.prevVec.x, this.prevVec.z) || 1e-4;
    const currHoriz = Math.hypot(currVec.x, currVec.z) || 1e-4;
    const pitchDelta =
      Math.atan2(currVec.y, currHoriz) - Math.atan2(this.prevVec.y, prevHoriz);

    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawDelta);

    // Pitch axis: XZ-perpendicular of the current controller-pair direction
    const pitchAxis = new THREE.Vector3(currVec.z, 0, -currVec.x);
    if (pitchAxis.lengthSq() < 1e-8) pitchAxis.set(1, 0, 0); else pitchAxis.normalize();
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(pitchAxis, pitchDelta);

    const totalQ = yawQ.multiply(pitchQ);

    // Rotate around the current grip midpoint, then translate
    for (const obj of [this.csgScene as THREE.Object3D, this.grid as THREE.Object3D]) {
      obj.position.sub(currMid).applyQuaternion(totalQ).add(currMid).add(translation);
      obj.quaternion.premultiply(totalQ);
    }

    this.prevMid.copy(currMid);
    this.prevVec.copy(currVec);
  }

  get currentScale(): number { return Units.workspaceScale; }
}
