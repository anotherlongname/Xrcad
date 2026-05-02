import * as THREE from 'three';
import { ControllerState } from './ControllerState';
import { ResizeHandles } from './ResizeHandles';
import { CSGObject, CSGOperation, PrimitiveType } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';
import { ObjectInspector } from '../ui/ObjectInspector';
import { PrimitiveMenu } from '../ui/PrimitiveMenu';
import { Units } from '../units/Units';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const GRID_STEP_MM = 10;
const Y_SNAP_MM    = 1;

function snapMm(mm: number): number {
  return Math.round(mm / GRID_STEP_MM) * GRID_STEP_MM;
}

type DragType = 'xz' | 'y' | 'resize';

interface ActiveDrag {
  ctrl: ControllerState;
  type: DragType;
  /** Drag plane for XZ / Y; resize uses ResizeHandles' own plane. */
  plane: THREE.Plane;
  startHit: THREE.Vector3;
  /** Object position in mm at drag start, for delta maths. */
  startPosMm: THREE.Vector3;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'placing'; type: PrimitiveType; op: CSGOperation; restingY: number }
  | { kind: 'selected'; object: CSGObject; drag: ActiveDrag | null };

/**
 * Interaction modes:
 *  idle     — ray hovers panels; either trigger on object → selected
 *  placing  — ghost follows ground; either trigger → place + auto-select
 *  selected — three drag sub-modes, both controllers supported:
 *               trigger on object  → XZ ground-plane drag
 *               grip (single hand) → Y (vertical) drag
 *               trigger on handle  → resize drag
 */
export class SelectionManager {
  private mode: Mode = { kind: 'idle' };
  private ghost: THREE.Mesh | null = null;
  private readonly resizeHandles: ResizeHandles;
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
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  startPlacing(type: PrimitiveType, op: CSGOperation): void {
    this.clearGhost();
    this.deselectObject();
    const restingY = Units.mmToScene(CSGObject.restingY(type, CSGObject.defaultDims(type)));
    this.mode = { kind: 'placing', type, op, restingY };
    this.buildGhost(type, op, restingY);
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
    const state = this.mode as Extract<Mode, { kind: 'placing' }>;

    for (const [ctrl, ray] of this.ctrlRays()) {
      const menuHit = this.menu.visible ? this.menu.hitTest(ray) : null;
      this.menu.onHover(menuHit);
      if (ctrl.triggerJustDown && menuHit) { this.menu.onPress(menuHit); return; }

      if (ray.ray.intersectPlane(GROUND, this.hitPoint)) {
        if (this.ghost) {
          this.ghost.position.set(
            Units.mmToScene(snapMm(Units.sceneToMm(this.hitPoint.x))),
            state.restingY,
            Units.mmToScene(snapMm(Units.sceneToMm(this.hitPoint.z))),
          );
          this.ghost.visible = true;
        }
        if (ctrl.triggerJustDown) { this.placeObject(state, cameraForward); return; }
      }
    }
  }

  private placeObject(state: Extract<Mode, { kind: 'placing' }>, cameraForward: THREE.Vector3): void {
    const snapX    = snapMm(Units.sceneToMm(this.hitPoint.x));
    const snapZ    = snapMm(Units.sceneToMm(this.hitPoint.z));
    const restingY = CSGObject.restingY(state.type, CSGObject.defaultDims(state.type));

    const obj = this.csgScene.addObject(state.type, state.op);
    obj.position.set(snapX, restingY, snapZ);
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
      const buttonStillDown = type === 'y' ? ctrl.gripDown : ctrl.triggerDown;
      if (!buttonStillDown) {
        if (type === 'resize') this.resizeHandles.endDrag();
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
      const inspHit   = this.inspector.visible ? this.inspector.hitTest(ray) : null;
      const menuHit   = this.menu.visible       ? this.menu.hitTest(ray)     : null;
      const handleSlot = this.resizeHandles.hitTest(ray);
      this.inspector.onHover(inspHit);
      this.menu.onHover(menuHit);
      this.resizeHandles.onHover(handleSlot);

      // ── Grip → Y-axis drag (only when the other grip is NOT down) ──────────
      if (ctrl.gripJustDown && !otherCtrl.gripDown) {
        state.drag = this.beginYDrag(ctrl, ray, obj, cameraForward);
        return;
      }

      if (!ctrl.triggerJustDown) continue;

      // Panels take priority
      if (inspHit) { this.inspector.onPress(inspHit); return; }
      if (menuHit) { this.menu.onPress(menuHit);     return; }

      // ── Trigger on resize handle ──────────────────────────────────────────
      if (handleSlot) {
        if (this.resizeHandles.beginDrag(handleSlot, ray, cameraForward, obj)) {
          state.drag = {
            ctrl, type: 'resize',
            plane: new THREE.Plane(), // unused — ResizeHandles owns its plane
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

      // Same object → begin XZ drag
      if (ray.ray.intersectPlane(GROUND, this.hitPoint)) {
        state.drag = {
          ctrl, type: 'xz',
          plane: GROUND,
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

    if (drag.type === 'xz') {
      const dx = Units.sceneToMm(this.hitPoint.x - drag.startHit.x);
      const dz = Units.sceneToMm(this.hitPoint.z - drag.startHit.z);
      obj.position.x = snapMm(drag.startPosMm.x + dx);
      obj.position.z = snapMm(drag.startPosMm.z + dz);
      changed = true;
    } else if (drag.type === 'y') {
      const dy = Units.sceneToMm(this.hitPoint.y - drag.startHit.y);
      const minY = CSGObject.restingY(obj.type, obj.dims);
      obj.position.y = Math.max(minY, Math.round(drag.startPosMm.y + dy / Y_SNAP_MM) * Y_SNAP_MM);
      changed = true;
    } else if (drag.type === 'resize') {
      changed = this.resizeHandles.continueDrag(ray, obj);
    }

    if (changed) {
      obj.rebuildBrush();
      this.csgScene.compile();
      this.resizeHandles.refresh(obj);
      this.inspector.dirty();
    }
  }

  private beginYDrag(
    ctrl: ControllerState,
    ray: THREE.Raycaster,
    obj: CSGObject,
    cameraForward: THREE.Vector3,
  ): ActiveDrag | null {
    // Vertical billboard plane facing the camera through the object's world centre.
    const horizFwd = cameraForward.clone();
    horizFwd.y = 0;
    if (horizFwd.lengthSq() < 0.001) horizFwd.set(0, 0, -1);
    horizFwd.normalize();

    const objWorld = new THREE.Vector3(
      Units.mmToScene(obj.position.x),
      Units.mmToScene(obj.position.y),
      Units.mmToScene(obj.position.z),
    );
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(horizFwd, objWorld);

    const startHit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, startHit)) return null;

    return { ctrl, type: 'y', plane, startHit: startHit.clone(), startPosMm: obj.position.clone() };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private selectObject(obj: CSGObject): void {
    this.mode = { kind: 'selected', object: obj, drag: null };
    this.inspector.inspect(obj);
    this.csgScene.setEditMode(true);
    this.resizeHandles.bindTo(obj);
  }

  private deselectObject(): void {
    this.mode = { kind: 'idle' };
    this.inspector.inspect(null);
    this.csgScene.setEditMode(false);
    this.resizeHandles.unbind();
  }

  private raycastObjects(ray: THREE.Raycaster): CSGObject | null {
    const hits = ray.intersectObjects(this.csgScene.selectableObjects, false);
    if (!hits.length) return null;
    return this.csgScene.objects.find(o => o.brush === hits[0].object) ?? null;
  }

  private buildGhost(type: PrimitiveType, op: CSGOperation, restingY: number): void {
    const tempObj = new CSGObject(type, op);
    const geo = tempObj.brush.geometry.clone();
    const mat = new THREE.MeshStandardMaterial({
      color: op === 'add' ? 0x88bbff : 0xff8888,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.ghost = new THREE.Mesh(geo, mat);
    this.ghost.position.y = restingY;
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
