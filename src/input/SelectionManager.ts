import * as THREE from 'three';
import { ControllerState } from './ControllerState';
import { ResizeHandles } from './ResizeHandles';
import { RotationHandles } from './RotationHandles';
import { CSGObject, CSGOperation, PrimitiveType } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';
import { ObjectInspector } from '../ui/ObjectInspector';
import { PrimitiveMenu } from '../ui/PrimitiveMenu';
import { Units } from '../units/Units';

const GRID_STEP_MM = 10;
const Z_SNAP_MM    = 1;

function snapMm(mm: number): number {
  return Math.round(mm / GRID_STEP_MM) * GRID_STEP_MM;
}

// CAD convention: XY is the horizontal plane, Z is up/down.
type DragType = 'xy' | 'z' | 'resize' | 'rotate';

interface ActiveDrag {
  ctrl: ControllerState;
  type: DragType;
  /** Drag plane for XY / Z; resize uses ResizeHandles' own plane. */
  plane: THREE.Plane;
  startHit: THREE.Vector3;
  /** Object position in mm at drag start, for delta maths. */
  startPosMm: THREE.Vector3;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'placing'; type: PrimitiveType; op: CSGOperation; restingZ: number }
  | { kind: 'selected'; object: CSGObject; drag: ActiveDrag | null };

/**
 * Interaction modes:
 *  idle     — ray hovers panels; either trigger on object → selected
 *  placing  — ghost follows ground; either trigger → place + auto-select
 *  selected — three drag sub-modes, both controllers supported:
 *               trigger on object  → XY ground-plane drag (CAD X, Y)
 *               grip (single hand) → Z (vertical) drag
 *               trigger on handle  → resize drag
 */
export class SelectionManager {
  private mode: Mode = { kind: 'idle' };
  private ghost: THREE.Mesh | null = null;
  private readonly resizeHandles: ResizeHandles;
  private readonly rotationHandles: RotationHandles;
  private readonly rayL = new THREE.Raycaster();
  private readonly rayR = new THREE.Raycaster();
  private readonly tempMat = new THREE.Matrix4();
  private readonly hitPoint = new THREE.Vector3();

  constructor(
    private readonly left: ControllerState,
    private readonly right: ControllerState,
    private readonly csgScene: CSGScene,
    private readonly threeScene: THREE.Scene,
    private readonly inspector: ObjectInspector,
    private readonly menu: PrimitiveMenu,
  ) {
    this.resizeHandles = new ResizeHandles();
    threeScene.add(this.resizeHandles);
    this.rotationHandles = new RotationHandles();
    threeScene.add(this.rotationHandles);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Auto-select an object without requiring a ray hit (used after STL import). */
  forceSelect(obj: CSGObject): void {
    this.clearGhost();
    this.selectObject(obj);
  }

  startPlacing(type: PrimitiveType, op: CSGOperation): void {
    this.clearGhost();
    this.deselectObject();
    const restingZ = Units.mmToScene(CSGObject.restingZ(type, CSGObject.defaultDims(type)));
    this.mode = { kind: 'placing', type, op, restingZ };
    this.buildGhost(type, op, restingZ);
  }

  cancelPlacing(): void {
    if (this.mode.kind === 'placing') {
      this.clearGhost();
      this.mode = { kind: 'idle' };
    }
  }

  // ── Per-frame update ─────────────────────────────────────────────────────────

  update(cameraForward: THREE.Vector3): void {
    this.updateRay(this.rayL, this.left.controller);
    this.updateRay(this.rayR, this.right.controller);

    switch (this.mode.kind) {
      case 'idle':     this.updateIdle(cameraForward);     break;
      case 'placing':  this.updatePlacing(cameraForward);  break;
      case 'selected': this.updateSelected(cameraForward); break;
    }
  }

  // ── Mode: idle ───────────────────────────────────────────────────────────────

  private updateIdle(cameraForward: THREE.Vector3): void {
    for (const [ctrl, ray] of this.ctrlRays()) {
      const menuHit = this.menu.visible ? this.menu.hitTest(ray) : null;
      this.menu.onHover(menuHit);
      if (ctrl.triggerJustDown) {
        if (menuHit) { this.menu.onPress(menuHit); return; }
        const obj = this.raycastObjects(ray);
        if (obj) { this.selectObject(obj); return; }
      }
    }
  }

  // ── Mode: placing ────────────────────────────────────────────────────────────

  private updatePlacing(cameraForward: THREE.Vector3): void {
    const state  = this.mode as Extract<Mode, { kind: 'placing' }>;
    const ground = this.currentGroundPlane();

    for (const [ctrl, ray] of this.ctrlRays()) {
      const menuHit = this.menu.visible ? this.menu.hitTest(ray) : null;
      this.menu.onHover(menuHit);
      if (ctrl.triggerJustDown && menuHit) { this.menu.onPress(menuHit); return; }

      if (ray.ray.intersectPlane(ground, this.hitPoint)) {
        if (this.ghost) {
          // hitPoint is world space; convert to csgScene local for snapping,
          // then back to world space for the ghost mesh position.
          // Three.js local: X=CAD X, Y=CAD Z (up), Z=CAD Y (depth).
          const local = this.csgScene.worldToLocal(this.hitPoint.clone());
          const snappedLocal = new THREE.Vector3(
            Units.mmToScene(snapMm(Units.sceneToMm(local.x))),  // Three.js X (snapped)
            state.restingZ,                                     // Three.js Y = resting height
            Units.mmToScene(snapMm(Units.sceneToMm(local.z))),  // Three.js Z (snapped)
          );
          this.ghost.position.copy(this.csgScene.localToWorld(snappedLocal));
          this.ghost.quaternion.copy(this.csgScene.quaternion);
          this.ghost.visible = true;
        }
        if (ctrl.triggerJustDown) { this.placeObject(state, cameraForward); return; }
      }
    }
  }

  private placeObject(state: Extract<Mode, { kind: 'placing' }>, cameraForward: THREE.Vector3): void {
    // hitPoint is in world space; convert to csgScene local space.
    // Three.js X → CAD X; Three.js Z → CAD Y (depth); CAD Z = resting height.
    const local    = this.csgScene.worldToLocal(this.hitPoint.clone());
    const snapX    = snapMm(Units.sceneToMm(local.x));
    const snapY    = snapMm(Units.sceneToMm(local.z));  // Three.js Z → CAD Y
    const restingZ = CSGObject.restingZ(state.type, CSGObject.defaultDims(state.type));

    const obj = this.csgScene.addObject(state.type, state.op);
    obj.position.set(snapX, snapY, restingZ);
    obj.rebuildBrush();
    this.csgScene.compile();

    this.clearGhost();
    this.menu.clearSelection();
    this.selectObject(obj);
  }

  // ── Mode: selected ───────────────────────────────────────────────────────────

  private updateSelected(cameraForward: THREE.Vector3): void {
    const state = this.mode as Extract<Mode, { kind: 'selected' }>;
    const obj   = state.object;

    // ── End active drag when the controlling button is released ──────────────
    if (state.drag) {
      const { ctrl, type } = state.drag;
      const buttonStillDown = type === 'z' ? ctrl.gripDown : ctrl.triggerDown;
      if (!buttonStillDown) {
        if (type === 'resize') this.resizeHandles.endDrag();
        if (type === 'rotate') this.rotationHandles.endDrag();
        state.drag = null;
      }
    }

    // ── Continue active drag ─────────────────────────────────────────────────
    if (state.drag) {
      const ray = this.rayFor(state.drag.ctrl);
      this.continueDrag(state.drag, ray, obj);
      return;
    }

    // ── No drag — poll both controllers for new input ────────────────────────
    for (const [ctrl, ray] of this.ctrlRays()) {
      const otherCtrl = ctrl === this.left ? this.right : this.left;

      // Panel hit-testing
      const inspHit    = this.inspector.visible ? this.inspector.hitTest(ray) : null;
      const menuHit    = this.menu.visible       ? this.menu.hitTest(ray)     : null;
      const handleSlot = this.resizeHandles.hitTest(ray);
      const ringSlot   = this.rotationHandles.hitTest(ray);
      this.inspector.onHover(inspHit);
      this.menu.onHover(menuHit);
      this.resizeHandles.onHover(handleSlot);
      this.rotationHandles.onHover(ringSlot);

      // ── Grip → Z-axis drag (only when the other grip is NOT down) ──────────
      if (ctrl.gripJustDown && !otherCtrl.gripDown) {
        state.drag = this.beginZDrag(ctrl, ray, obj, cameraForward);
        return;
      }

      if (!ctrl.triggerJustDown) continue;

      // Panels take priority
      if (inspHit) { this.inspector.onPress(inspHit); return; }
      if (menuHit) { this.menu.onPress(menuHit);     return; }

      // ── Trigger on rotation ring ──────────────────────────────────────────
      if (ringSlot) {
        if (this.rotationHandles.beginDrag(ringSlot, ray, obj)) {
          state.drag = {
            ctrl, type: 'rotate',
            plane: new THREE.Plane(),       // unused — RotationHandles owns its plane
            startHit: new THREE.Vector3(),
            startPosMm: obj.position.clone(),
          };
        }
        return;
      }

      // ── Trigger on resize handle ──────────────────────────────────────────
      if (handleSlot) {
        if (this.resizeHandles.beginDrag(handleSlot, ray, cameraForward, obj)) {
          state.drag = {
            ctrl, type: 'resize',
            plane: new THREE.Plane(),       // unused — ResizeHandles owns its plane
            startHit: new THREE.Vector3(),
            startPosMm: obj.position.clone(),
          };
        }
        return;
      }

      // ── Trigger on object / empty ─────────────────────────────────────────
      const hitObj = this.raycastObjects(ray);
      if (hitObj === null) { this.deselectObject(); return; }
      if (hitObj !== obj)  { this.selectObject(hitObj); return; }

      // Same object → begin XY ground-plane drag
      const ground = this.currentGroundPlane();
      if (ray.ray.intersectPlane(ground, this.hitPoint)) {
        state.drag = {
          ctrl, type: 'xy',
          plane: ground,
          startHit: this.hitPoint.clone(),
          startPosMm: obj.position.clone(),
        };
      }
      return;
    }
  }

  private continueDrag(drag: ActiveDrag, ray: THREE.Raycaster, obj: CSGObject): void {
    if (!ray.ray.intersectPlane(drag.plane, this.hitPoint)) return;

    let changed = false;

    if (drag.type === 'xy') {
      // World-space delta rotated into csgScene local space (handles yaw rotation).
      // Three.js X delta → CAD X delta; Three.js Z delta → CAD Y (depth) delta.
      const worldDelta = new THREE.Vector3(
        this.hitPoint.x - drag.startHit.x,
        0,
        this.hitPoint.z - drag.startHit.z,
      ).applyQuaternion(this.csgScene.quaternion.clone().invert());
      obj.position.x = snapMm(drag.startPosMm.x + Units.sceneToMm(worldDelta.x));
      obj.position.y = snapMm(drag.startPosMm.y + Units.sceneToMm(worldDelta.z));  // Three.js Z → CAD Y
      changed = true;
    } else if (drag.type === 'z') {
      // Three.js Y delta → CAD Z (vertical) delta.
      const dz = Units.sceneToMm(this.hitPoint.y - drag.startHit.y);
      const minZ = CSGObject.restingZ(obj.type, obj.dims, obj.importedRestingZMm);
      obj.position.z = Math.max(minZ, Math.round(drag.startPosMm.z + dz / Z_SNAP_MM) * Z_SNAP_MM);
      changed = true;
    } else if (drag.type === 'resize') {
      changed = this.resizeHandles.continueDrag(ray, obj);
    } else if (drag.type === 'rotate') {
      changed = this.rotationHandles.continueDrag(ray, obj);
    }

    if (changed) {
      obj.rebuildBrush();
      this.csgScene.compile();
      this.resizeHandles.refresh(obj);
      this.rotationHandles.refresh(obj);
      this.inspector.dirty();
    }
  }

  private beginZDrag(
    ctrl: ControllerState,
    ray: THREE.Raycaster,
    obj: CSGObject,
    cameraForward: THREE.Vector3,
  ): ActiveDrag | null {
    // Vertical billboard plane facing the camera through the object's world centre.
    const horizFwd = cameraForward.clone();
    horizFwd.y = 0;  // zero Three.js Y to keep the forward direction horizontal
    if (horizFwd.lengthSq() < 0.001) horizFwd.set(0, 0, -1);
    horizFwd.normalize();

    // Convert CSG (CAD) position to Three.js world position:
    // Three.js Y = CAD Z (up), Three.js Z = CAD Y (depth).
    const objWorld = this.csgScene.localToWorld(new THREE.Vector3(
      Units.mmToScene(obj.position.x),
      Units.mmToScene(obj.position.z),  // CAD Z → Three.js Y
      Units.mmToScene(obj.position.y),  // CAD Y → Three.js Z
    ));
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(horizFwd, objWorld);

    const startHit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, startHit)) return null;

    return { ctrl, type: 'z', plane, startHit: startHit.clone(), startPosMm: obj.position.clone() };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Ground plane in world space, follows the csgScene's current Y position. */
  private currentGroundPlane(): THREE.Plane {
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.csgScene.position.y);
  }

  private selectObject(obj: CSGObject): void {
    this.mode = { kind: 'selected', object: obj, drag: null };
    this.inspector.inspect(obj);
    this.csgScene.setEditMode(true);
    this.resizeHandles.bindTo(obj);
    this.rotationHandles.bindTo(obj);
  }

  private deselectObject(): void {
    this.mode = { kind: 'idle' };
    this.inspector.inspect(null);
    this.csgScene.setEditMode(false);
    this.resizeHandles.unbind();
    this.rotationHandles.unbind();
  }

  private raycastObjects(ray: THREE.Raycaster): CSGObject | null {
    const hits = ray.intersectObjects(this.csgScene.selectableObjects, false);
    if (!hits.length) return null;
    return this.csgScene.objects.find(o => o.brush === hits[0].object) ?? null;
  }

  private buildGhost(type: PrimitiveType, op: CSGOperation, restingZ: number): void {
    const tempObj = new CSGObject(type, op);
    const geo = tempObj.brush.geometry.clone();
    const mat = new THREE.MeshStandardMaterial({
      color: op === 'add' ? 0x88bbff : 0xff8888,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(geo, mat);
    this.ghost.position.y = restingZ;  // Three.js Y = resting height (scene units)
    this.ghost.visible = false;
    this.threeScene.add(this.ghost);
  }

  private clearGhost(): void {
    if (this.ghost) {
      this.threeScene.remove(this.ghost);
      (this.ghost.material as THREE.Material).dispose();
      this.ghost.geometry.dispose();
      this.ghost = null;
    }
  }

  private updateRay(ray: THREE.Raycaster, ctrl: THREE.XRTargetRaySpace): void {
    this.tempMat.identity().extractRotation(ctrl.matrixWorld);
    ray.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    ray.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMat);
  }

  private rayFor(ctrl: ControllerState): THREE.Raycaster {
    return ctrl === this.left ? this.rayL : this.rayR;
  }

  private ctrlRays(): [ControllerState, THREE.Raycaster][] {
    return [[this.right, this.rayR], [this.left, this.rayL]];
  }
}
