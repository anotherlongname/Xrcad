import * as THREE from 'three';
import { CSGObject, Dimensions, PrimitiveType } from '../csg/CSGObject';
import { Units } from '../units/Units';

const COL = { x: 0xff4444, y: 0x44cc44, z: 0x4488ff };
const COL_HOVER  = 0xffee00;
const COL_ACTIVE = 0xff8800;
const HANDLE_MM  = 7;

interface Cfg {
  /** Dimension key this handle controls. */
  dimKey: keyof Dimensions;
  /** Also update this key in sync (e.g. radiusBottom when radiusTop changes). */
  linkedKey?: keyof Dimensions;
  /** Unit direction the handle faces outward. */
  axis: THREE.Vector3;
  /** +1 means the handle is on the positive side, -1 on the negative side.
   *  Dragging outward (in the axis direction × sign) increases the dimension. */
  sign: 1 | -1;
  color: number;
}

/** Per-primitive handle definitions. */
const CFGS: Record<PrimitiveType, Cfg[]> = {
  box: [
    { dimKey: 'width',  axis: new THREE.Vector3( 1, 0, 0), sign:  1, color: COL.x },
    { dimKey: 'width',  axis: new THREE.Vector3(-1, 0, 0), sign: -1, color: COL.x },
    { dimKey: 'height', axis: new THREE.Vector3( 0, 1, 0), sign:  1, color: COL.y },
    { dimKey: 'height', axis: new THREE.Vector3( 0,-1, 0), sign: -1, color: COL.y },
    { dimKey: 'depth',  axis: new THREE.Vector3( 0, 0, 1), sign:  1, color: COL.z },
    { dimKey: 'depth',  axis: new THREE.Vector3( 0, 0,-1), sign: -1, color: COL.z },
  ],
  sphere: [
    { dimKey: 'radius', axis: new THREE.Vector3( 1, 0, 0), sign: 1, color: COL.x },
    { dimKey: 'radius', axis: new THREE.Vector3( 0, 1, 0), sign: 1, color: COL.y },
    { dimKey: 'radius', axis: new THREE.Vector3( 0, 0, 1), sign: 1, color: COL.z },
  ],
  cylinder: [
    { dimKey: 'radiusTop', linkedKey: 'radiusBottom',
      axis: new THREE.Vector3(1, 0, 0), sign: 1, color: COL.x },
    { dimKey: 'height', axis: new THREE.Vector3(0,  1, 0), sign:  1, color: COL.y },
    { dimKey: 'height', axis: new THREE.Vector3(0, -1, 0), sign: -1, color: COL.y },
  ],
  cone: [
    { dimKey: 'radius', axis: new THREE.Vector3(1, 0, 0), sign: 1, color: COL.x },
    { dimKey: 'height', axis: new THREE.Vector3(0,  1, 0), sign:  1, color: COL.y },
    { dimKey: 'height', axis: new THREE.Vector3(0, -1, 0), sign: -1, color: COL.y },
  ],
  torus: [
    { dimKey: 'radius', axis: new THREE.Vector3(1, 0, 0), sign: 1, color: COL.x },
    { dimKey: 'tube',   axis: new THREE.Vector3(0, 1, 0), sign: 1, color: COL.y },
  ],
  imported: [], // no resizable dimensions for imported meshes
};

interface HandleSlot {
  mesh: THREE.Mesh;
  cfg: Cfg;
}

export interface DragState {
  slot: HandleSlot;
  /** Billboard plane used to map ray movement to world delta. */
  plane: THREE.Plane;
  startHit: THREE.Vector3;
  startValue: number;
  startLinkedValue: number | undefined;
}

/**
 * Axis-coloured cubic handles placed at the face extremes of a selected object.
 * Red = X, Green = Y, Blue = Z.
 *
 * Attach to an object after selection; call refresh() whenever dims/position
 * changes; call detach() on deselection.
 */
export class ResizeHandles extends THREE.Group {
  private slots: HandleSlot[] = [];
  private hovered: HandleSlot | null = null;
  activeDrag: DragState | null = null;

  constructor() {
    super();
    this.visible = false;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  bindTo(obj: CSGObject): void {
    this.unbind();
    const s = Units.mmToScene(HANDLE_MM);
    const geo = new THREE.BoxGeometry(s, s, s);

    for (const cfg of CFGS[obj.type]) {
      const mat = new THREE.MeshBasicMaterial({ color: cfg.color, depthTest: false });
      const mesh = new THREE.Mesh(geo, mat);
      const slot: HandleSlot = { mesh, cfg };
      this.slots.push(slot);
      this.add(mesh);
    }

    this.refresh(obj);
    this.visible = true;
  }

  unbind(): void {
    for (const s of this.slots) {
      this.remove(s.mesh);
      (s.mesh.material as THREE.Material).dispose();
    }
    this.slots = [];
    this.hovered = null;
    this.activeDrag = null;
    this.visible = false;
  }

  /** Reposition handles after the object's dims or position changed. */
  refresh(obj: CSGObject): void {
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(obj.brush).getCenter(center);

    for (const slot of this.slots) {
      const halfMm = this.halfExtent(obj.dims, slot.cfg.dimKey);
      const offset = Units.mmToScene(halfMm) * slot.cfg.sign;
      slot.mesh.position.copy(center).addScaledVector(slot.cfg.axis, offset);
    }
  }

  // ── Hit testing & hover ──────────────────────────────────────────────────────

  hitTest(raycaster: THREE.Raycaster): HandleSlot | null {
    if (!this.visible) return null;
    const hits = raycaster.intersectObjects(this.slots.map(s => s.mesh), false);
    if (!hits.length) return null;
    return this.slots.find(s => s.mesh === hits[0].object) ?? null;
  }

  onHover(slot: HandleSlot | null): void {
    if (slot === this.hovered) return;
    if (this.hovered && this.hovered !== this.activeDrag?.slot) {
      (this.hovered.mesh.material as THREE.MeshBasicMaterial).color.set(this.hovered.cfg.color);
    }
    this.hovered = slot;
    if (slot && slot !== this.activeDrag?.slot) {
      (slot.mesh.material as THREE.MeshBasicMaterial).color.set(COL_HOVER);
    }
  }

  // ── Drag ─────────────────────────────────────────────────────────────────────

  /**
   * Begin a resize drag.
   * @param cameraForward  normalised world-space forward vector of the XR camera.
   *                       Used to orient the billboard drag plane toward the user.
   */
  beginDrag(slot: HandleSlot, raycaster: THREE.Raycaster, cameraForward: THREE.Vector3, obj: CSGObject): boolean {
    // Billboard plane: faces the camera, passes through the handle.
    const normal = cameraForward.clone().negate().normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, slot.mesh.position);

    const startHit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, startHit)) return false;

    const dims = obj.dims as Record<string, number>;
    this.activeDrag = {
      slot,
      plane,
      startHit: startHit.clone(),
      startValue: dims[slot.cfg.dimKey as string] ?? 1,
      startLinkedValue: slot.cfg.linkedKey ? dims[slot.cfg.linkedKey as string] : undefined,
    };
    (slot.mesh.material as THREE.MeshBasicMaterial).color.set(COL_ACTIVE);
    return true;
  }

  /**
   * Continue drag. Returns true if a dimension changed (caller should rebuild).
   * The outward drag direction for the handle is: axis × sign.
   */
  continueDrag(raycaster: THREE.Raycaster, obj: CSGObject): boolean {
    if (!this.activeDrag) return false;
    const { slot, plane, startHit, startValue } = this.activeDrag;

    const currentHit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, currentHit)) return false;

    // Project world-space delta onto the handle's outward direction.
    const outward = slot.cfg.axis.clone().multiplyScalar(slot.cfg.sign);
    const deltaMm = Units.sceneToMm(currentHit.clone().sub(startHit).dot(outward));

    const newVal = Math.max(1, Math.round(startValue + deltaMm));
    const dims = obj.dims as Record<string, number>;
    if (dims[slot.cfg.dimKey as string] === newVal) return false;

    dims[slot.cfg.dimKey as string] = newVal;
    if (slot.cfg.linkedKey) dims[slot.cfg.linkedKey as string] = newVal;
    return true;
  }

  endDrag(): void {
    if (!this.activeDrag) return;
    const slot = this.activeDrag.slot;
    (slot.mesh.material as THREE.MeshBasicMaterial).color.set(
      slot === this.hovered ? COL_HOVER : slot.cfg.color,
    );
    this.activeDrag = null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private halfExtent(dims: Dimensions, key: keyof Dimensions): number {
    const v = (dims as Record<string, number>)[key as string] ?? 10;
    // Box dimensions: half-extent is val/2. Radii and tube are already the full extent.
    return key === 'width' || key === 'height' || key === 'depth' ? v / 2 : v;
  }
}
