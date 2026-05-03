import * as THREE from 'three';
import { CSGObject } from '../csg/CSGObject';
import { Units } from '../units/Units';

const COL_X      = 0xff4444;
const COL_Y      = 0x44cc44;
const COL_Z      = 0x4488ff;
const COL_HOVER  = 0xffee00;
const COL_ACTIVE = 0xff8800;
const RING_TUBE_MM   = 3;
const RING_MARGIN_MM = 14;
const ROT_SNAP_RAD   = 5 * Math.PI / 180;  // 5° snap

interface RingSlot {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  eulerKey: 'x' | 'y' | 'z';
  color: number;
}

export interface RotDragState {
  slot: RingSlot;
  plane: THREE.Plane;
  center: THREE.Vector3;
  startHit: THREE.Vector3;
  startAngle: number;
}

const RING_DEFS: [THREE.Vector3, 'x' | 'y' | 'z', number][] = [
  [new THREE.Vector3(1, 0, 0), 'x', COL_X],
  [new THREE.Vector3(0, 1, 0), 'y', COL_Y],
  [new THREE.Vector3(0, 0, 1), 'z', COL_Z],
];

/**
 * Three torus rings — one per world axis — for TinkerCAD-style drag rotation.
 * Rings are positioned around the selected object's bounding sphere and resize
 * automatically when the object is resized.
 */
export class RotationHandles extends THREE.Group {
  private slots: RingSlot[] = [];
  private hovered: RingSlot | null = null;
  activeDrag: RotDragState | null = null;
  private lastRingR = -1;

  constructor() {
    super();
    this.visible = false;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  bindTo(obj: CSGObject): void {
    this.unbind();

    const { center, ringR, tubeR } = this.ringMetrics(obj);
    this.lastRingR = ringR;

    const zAxis = new THREE.Vector3(0, 0, 1);
    for (const [axis, eulerKey, color] of RING_DEFS) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(this.buildTorus(ringR, tubeR), mat);
      // Orient ring so its hole axis faces along `axis` (default hole axis = +Z)
      mesh.quaternion.setFromUnitVectors(zAxis, axis);
      mesh.position.copy(center);
      const slot: RingSlot = { mesh, axis: axis.clone(), eulerKey, color };
      this.slots.push(slot);
      this.add(mesh);
    }

    this.visible = true;
  }

  unbind(): void {
    for (const s of this.slots) {
      this.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.slots = [];
    this.lastRingR = -1;
    this.hovered = null;
    this.activeDrag = null;
    this.visible = false;
  }

  refresh(obj: CSGObject): void {
    const { center, ringR, tubeR } = this.ringMetrics(obj);

    for (const slot of this.slots) {
      slot.mesh.position.copy(center);
    }

    // Rebuild geometry only when the ring radius meaningfully changed (resize)
    if (Math.abs(ringR - this.lastRingR) > 0.0002) {
      this.lastRingR = ringR;
      for (const slot of this.slots) {
        slot.mesh.geometry.dispose();
        slot.mesh.geometry = this.buildTorus(ringR, tubeR);
      }
    }
  }

  // ── Hit testing & hover ──────────────────────────────────────────────────────

  hitTest(raycaster: THREE.Raycaster): RingSlot | null {
    if (!this.visible) return null;
    const hits = raycaster.intersectObjects(this.slots.map(s => s.mesh), false);
    if (!hits.length) return null;
    return this.slots.find(s => s.mesh === hits[0].object) ?? null;
  }

  onHover(slot: RingSlot | null): void {
    if (slot === this.hovered) return;
    if (this.hovered && this.hovered !== this.activeDrag?.slot) {
      (this.hovered.mesh.material as THREE.MeshBasicMaterial).color.set(this.hovered.color);
    }
    this.hovered = slot;
    if (slot && slot !== this.activeDrag?.slot) {
      (slot.mesh.material as THREE.MeshBasicMaterial).color.set(COL_HOVER);
    }
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────

  beginDrag(slot: RingSlot, raycaster: THREE.Raycaster, obj: CSGObject): boolean {
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(obj.brush).getCenter(center);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(slot.axis, center);
    const startHit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, startHit)) return false;

    this.activeDrag = {
      slot, plane, center,
      startHit: startHit.clone(),
      startAngle: obj.rotation[slot.eulerKey],
    };
    (slot.mesh.material as THREE.MeshBasicMaterial).color.set(COL_ACTIVE);
    return true;
  }

  continueDrag(raycaster: THREE.Raycaster, obj: CSGObject): boolean {
    if (!this.activeDrag) return false;
    const { slot, plane, center, startHit, startAngle } = this.activeDrag;

    const currentHit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, currentHit)) return false;

    const startVec = new THREE.Vector3().subVectors(startHit, center);
    const currentVec = new THREE.Vector3().subVectors(currentHit, center);
    if (startVec.length() < 0.001 || currentVec.length() < 0.001) return false;
    startVec.normalize();
    currentVec.normalize();

    // Signed angle around the rotation axis using atan2
    const cross = new THREE.Vector3().crossVectors(startVec, currentVec);
    const delta = Math.atan2(cross.dot(slot.axis), startVec.dot(currentVec));

    const snapped = Math.round((startAngle + delta) / ROT_SNAP_RAD) * ROT_SNAP_RAD;
    if (Math.abs(obj.rotation[slot.eulerKey] - snapped) < 0.0001) return false;

    obj.rotation[slot.eulerKey] = snapped;
    return true;
  }

  endDrag(): void {
    if (!this.activeDrag) return;
    const slot = this.activeDrag.slot;
    (slot.mesh.material as THREE.MeshBasicMaterial).color.set(
      slot === this.hovered ? COL_HOVER : slot.color,
    );
    this.activeDrag = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private ringMetrics(obj: CSGObject): { center: THREE.Vector3; ringR: number; tubeR: number } {
    const box = new THREE.Box3().setFromObject(obj.brush);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const bsRadius = size.length() / 2;
    const ringR = bsRadius + Units.mmToScene(RING_MARGIN_MM);
    const tubeR = Units.mmToScene(RING_TUBE_MM);
    return { center, ringR, tubeR };
  }

  private buildTorus(ringR: number, tubeR: number): THREE.TorusGeometry {
    return new THREE.TorusGeometry(ringR, tubeR, 12, 64);
  }
}
