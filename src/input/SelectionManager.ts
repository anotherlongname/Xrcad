import * as THREE from 'three';
import { ControllerState } from './ControllerState';
import { ResizeHandles } from './ResizeHandles';
import { CSGObject, CSGOperation, PrimitiveType } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';
import { ObjectInspector } from '../ui/ObjectInspector';
import { PrimitiveMenu } from '../ui/PrimitiveMenu';
import { NumberInputPanel } from '../ui/NumberInputPanel';
import { Units } from '../units/Units';

const GRID_STEP_MM = 10;
const Z_SNAP_MM    = 1;

function snapMm(mm: number): number {
  return Math.round(mm / GRID_STEP_MM) * GRID_STEP_MM;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'placing'; type: PrimitiveType; op: CSGOperation; restingZ: number }
  | { kind: 'selected'; object: CSGObject };

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
  private leftLine:  THREE.Line | null = null;
  private rightLine: THREE.Line | null = null;
  private readonly rayL = new THREE.Raycaster();
  private readonly rayR = new THREE.Raycaster();
  private readonly tempMat = new THREE.Matrix4();
  private readonly hitPoint = new THREE.Vector3();

  // Manipulation state
  private xyDrag: { ctrl: ControllerState; plane: THREE.Plane; startHit: THREE.Vector3; startPosMm: THREE.Vector3 } | null = null;
  private zDrag:  { plane: THREE.Plane; startHit: THREE.Vector3; startPosMm: THREE.Vector3 } | null = null;
  private rotateStart:    { ctrlQuat: THREE.Quaternion; objQuat: THREE.Quaternion } | null = null;
  private activeDimIdx       = 0;
  private resizeStepIdx      = 1;
  private resizeAccum        = 0;
  private lastLStickX        = 0;
  private lastLStickY        = 0;
  private resizeUndoPending  = false;
  private static readonly RESIZE_STEPS = [1, 5, 10, 50]; // mm

  constructor(
    private readonly left: ControllerState,
    private readonly right: ControllerState,
    private readonly csgScene: CSGScene,
    private readonly threeScene: THREE.Scene,
    private readonly inspector: ObjectInspector,
    private readonly menu: PrimitiveMenu,
    private readonly numInputPanel: NumberInputPanel,
    private readonly pushUndo: () => void,
  ) {
    this.resizeHandles = new ResizeHandles();
    threeScene.add(this.resizeHandles);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  setRayLines(left: THREE.Line, right: THREE.Line): void {
    this.leftLine  = left;
    this.rightLine = right;
  }

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

  deselect(): void {
    if (this.mode.kind === 'selected') this.deselectObject();
    else if (this.mode.kind === 'placing') this.cancelPlacing();
  }

  /** Nudge the selected object by the given mm deltas. Returns false if nothing is selected. */
  nudgeSelected(dxMm: number, dyMm: number, dzMm: number): boolean {
    if (this.mode.kind !== 'selected') return false;
    const obj = this.mode.object;
    obj.position.x += dxMm;
    obj.position.y += dyMm;
    const minZ = CSGObject.restingZ(obj.type, obj.dims, obj.importedRestingZMm);
    obj.position.z = Math.max(minZ, obj.position.z + dzMm);
    obj.rebuildBrush();
    this.csgScene.compile();
    this.resizeHandles.refresh(obj);
    this.inspector.dirty();
    return true;
  }

  /** Delete the currently selected object. Returns false if nothing is selected. */
  deleteSelected(): boolean {
    if (this.mode.kind !== 'selected') return false;
    const obj = this.mode.object;
    this.deselectObject();
    this.csgScene.removeObject(obj.id);
    return true;
  }

  /** Cycle which dimension is active by delta (+1 / -1). */
  cycleActiveDim(delta: number): void {
    if (this.mode.kind !== 'selected') return;
    const obj = this.mode.object;
    const dims = obj.dims as Record<string, number>;
    const dimKeys = Object.keys(dims).filter(k => dims[k] !== undefined);
    if (!dimKeys.length) return;
    this.activeDimIdx = (this.activeDimIdx + delta + dimKeys.length) % dimKeys.length;
    this.inspector.setActiveDim(dimKeys[this.activeDimIdx], SelectionManager.RESIZE_STEPS[this.resizeStepIdx]);
  }

  /** Change resize step size index by delta (+1 / -1). */
  changeStepSize(delta: number): void {
    this.resizeStepIdx = Math.max(0, Math.min(SelectionManager.RESIZE_STEPS.length - 1, this.resizeStepIdx + delta));
    if (this.mode.kind === 'selected') {
      const obj = this.mode.object;
      const dims = obj.dims as Record<string, number>;
      const dimKeys = Object.keys(dims).filter(k => dims[k] !== undefined);
      const activeKey = dimKeys.length ? dimKeys[this.activeDimIdx % dimKeys.length] : null;
      this.inspector.setActiveDim(activeKey, SelectionManager.RESIZE_STEPS[this.resizeStepIdx]);
    }
  }

  /** Resize the active dimension by one step in the given direction (+1 / -1). */
  resizeActiveDim(direction: 1 | -1): boolean {
    if (this.mode.kind !== 'selected') return false;
    const obj = this.mode.object;
    const dims = obj.dims as Record<string, number>;
    const dimKeys = Object.keys(dims).filter(k => dims[k] !== undefined);
    if (!dimKeys.length) return false;
    const key = dimKeys[this.activeDimIdx % dimKeys.length];
    const step = SelectionManager.RESIZE_STEPS[this.resizeStepIdx];
    dims[key] = Math.max(1, (dims[key] ?? 1) + direction * step);
    obj.rebuildBrush();
    this.csgScene.compile();
    this.resizeHandles.refresh(obj);
    this.inspector.dirty();
    return true;
  }

  // ── Per-frame update ─────────────────────────────────────────────────────────

  update(cameraForward: THREE.Vector3): void {
    this.updateRay(this.rayL, this.left.controller);
    this.updateRay(this.rayR, this.right.controller);

    // Number-input keypad has highest priority — while open, all other interaction
    // is suppressed so stray trigger presses don't also move objects.
    if (this.numInputPanel.visible) {
      for (const [ctrl, ray] of this.ctrlRays()) {
        const hit = this.numInputPanel.hitTest(ray);
        this.numInputPanel.onHover(hit);
        if (ctrl.triggerJustDown && hit) {
          this.numInputPanel.onPress(hit);
          break;
        }
      }
      this.updateRayLines();
      return;
    }

    switch (this.mode.kind) {
      case 'idle':     this.updateIdle(cameraForward);     break;
      case 'placing':  this.updatePlacing(cameraForward);  break;
      case 'selected': this.updateSelected(cameraForward); break;
    }

    this.updateRayLines();
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
    this.pushUndo();

    this.clearGhost();
    this.menu.clearSelection();
    this.selectObject(obj);
  }

  // ── Mode: selected ───────────────────────────────────────────────────────────

  private updateSelected(cameraForward: THREE.Vector3): void {
    const obj = (this.mode as Extract<Mode, { kind: 'selected' }>).object;
    let changed = false;

    // Both grips down → deselect so workspace scale/rotate gesture works cleanly.
    if (this.left.gripDown && this.right.gripDown) {
      this.deselectObject();
      return;
    }

    // ── XY trigger drag (continue) ────────────────────────────────────────────
    if (this.xyDrag) {
      if (!this.xyDrag.ctrl.triggerDown) {
        this.xyDrag = null;
        this.pushUndo();
      } else {
        const ray = this.rayFor(this.xyDrag.ctrl);
        const hit = new THREE.Vector3();
        if (ray.ray.intersectPlane(this.xyDrag.plane, hit)) {
          const worldDelta = new THREE.Vector3(
            hit.x - this.xyDrag.startHit.x,
            0,
            hit.z - this.xyDrag.startHit.z,
          ).applyQuaternion(this.csgScene.quaternion.clone().invert());
          obj.position.x = snapMm(this.xyDrag.startPosMm.x + Units.sceneToMm(worldDelta.x));
          obj.position.y = snapMm(this.xyDrag.startPosMm.y + Units.sceneToMm(worldDelta.z));
          changed = true;
        }
      }
    }

    // ── Right grip → Z drag ───────────────────────────────────────────────────
    if (this.right.gripJustDown) {
      const horizFwd = cameraForward.clone();
      horizFwd.y = 0;
      if (horizFwd.lengthSq() < 0.001) horizFwd.set(0, 0, -1);
      horizFwd.normalize();
      const objWorld = this.csgScene.localToWorld(new THREE.Vector3(
        Units.mmToScene(obj.position.x),
        Units.mmToScene(obj.position.z),  // CAD Z → Three.js Y
        Units.mmToScene(obj.position.y),  // CAD Y → Three.js Z
      ));
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(horizFwd, objWorld);
      const startHit = new THREE.Vector3();
      if (this.rayR.ray.intersectPlane(plane, startHit)) {
        this.zDrag = { plane, startHit: startHit.clone(), startPosMm: obj.position.clone() };
      }
    }
    if (!this.right.gripDown) {
      const wasDragging = this.zDrag !== null;
      this.zDrag = null;
      if (wasDragging) this.pushUndo();
    }
    if (this.right.gripDown && this.zDrag) {
      const hit = new THREE.Vector3();
      if (this.rayR.ray.intersectPlane(this.zDrag.plane, hit)) {
        const dz = Units.sceneToMm(hit.y - this.zDrag.startHit.y);
        const minZ = CSGObject.restingZ(obj.type, obj.dims, obj.importedRestingZMm);
        obj.position.z = Math.max(minZ,
          Math.round((this.zDrag.startPosMm.z + dz) / Z_SNAP_MM) * Z_SNAP_MM);
        changed = true;
      }
    }

    // ── Left grip → rotate ─────────────────────────────────────────────────────
    if (this.left.gripJustDown) {
      const q = new THREE.Quaternion();
      this.left.grip.getWorldQuaternion(q);
      this.rotateStart = {
        ctrlQuat: q.clone(),
        objQuat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z, 'XYZ')),
      };
    }
    if (!this.left.gripDown) {
      const wasRotating = this.rotateStart !== null;
      this.rotateStart = null;
      if (wasRotating) this.pushUndo();
    }
    if (this.left.gripDown && this.rotateStart) {
      const cur = new THREE.Quaternion();
      this.left.grip.getWorldQuaternion(cur);
      const worldDelta = cur.clone().multiply(this.rotateStart.ctrlQuat.clone().invert());
      // Express delta in csgScene local space to handle workspace rotation.
      const sceneQ = new THREE.Quaternion();
      this.csgScene.getWorldQuaternion(sceneQ);
      const localDelta = sceneQ.clone().invert().multiply(worldDelta).multiply(sceneQ);
      const newQ = localDelta.multiply(this.rotateStart.objQuat.clone());
      const e = new THREE.Euler().setFromQuaternion(newQ, 'XYZ');
      const snap = 5 * Math.PI / 180;
      obj.rotation.x = Math.round(e.x / snap) * snap;
      obj.rotation.y = Math.round(e.y / snap) * snap;
      obj.rotation.z = Math.round(e.z / snap) * snap;
      changed = true;
    }

    // ── Left joystick → cycle active dimension / step size ─────────────────────
    const dims = obj.dims as Record<string, number>;
    const dimKeys = Object.keys(dims).filter(k => dims[k] !== undefined);
    const nDims = Math.max(dimKeys.length, 1);
    const lx = this.left.thumbstick.x;
    const ly = this.left.thumbstick.y;
    if (lx >  0.6 && this.lastLStickX <=  0.6) this.activeDimIdx = (this.activeDimIdx + 1) % nDims;
    if (lx < -0.6 && this.lastLStickX >= -0.6) this.activeDimIdx = (this.activeDimIdx - 1 + nDims) % nDims;
    if (ly >  0.6 && this.lastLStickY <=  0.6)
      this.resizeStepIdx = Math.min(SelectionManager.RESIZE_STEPS.length - 1, this.resizeStepIdx + 1);
    if (ly < -0.6 && this.lastLStickY >= -0.6)
      this.resizeStepIdx = Math.max(0, this.resizeStepIdx - 1);
    this.lastLStickX = lx;
    this.lastLStickY = ly;
    const activeKey = dimKeys.length ? dimKeys[this.activeDimIdx % dimKeys.length] : null;
    this.inspector.setActiveDim(activeKey, SelectionManager.RESIZE_STEPS[this.resizeStepIdx]);

    // ── Right joystick → adjust active dimension ───────────────────────────────
    const ry = -this.right.thumbstick.y;  // push up = increase
    const step = SelectionManager.RESIZE_STEPS[this.resizeStepIdx];
    if (Math.abs(ry) > 0.3 && activeKey) {
      this.resizeUndoPending = true;
      this.resizeAccum += ry * 3 / 72;   // ~3 discrete steps/second at full deflection
      if (Math.abs(this.resizeAccum) >= 1) {
        const n = Math.trunc(this.resizeAccum);
        this.resizeAccum -= n;
        dims[activeKey] = Math.max(1, (dims[activeKey] ?? 1) + n * step);
        changed = true;
      }
    } else {
      if (this.resizeUndoPending) {
        this.resizeUndoPending = false;
        this.pushUndo();
      }
      this.resizeAccum = 0;
    }

    // ── Trigger → panel interaction / select / deselect ───────────────────────
    for (const [ctrl, ray] of this.ctrlRays()) {
      const inspHit = this.inspector.visible ? this.inspector.hitTest(ray) : null;
      const menuHit = this.menu.visible       ? this.menu.hitTest(ray)     : null;
      this.inspector.onHover(inspHit);
      this.menu.onHover(menuHit);

      if (!ctrl.triggerJustDown) continue;
      if (inspHit) { this.inspector.onPress(inspHit); return; }
      if (menuHit) { this.menu.onPress(menuHit);      return; }
      const hitObj = this.raycastObjects(ray);
      if (hitObj === null) { this.deselectObject(); return; }
      if (hitObj !== obj)  { this.selectObject(hitObj); return; }
      // Trigger on already-selected object → start XY ground-plane drag
      if (!this.xyDrag) {
        const ground = this.currentGroundPlane();
        const startHit = new THREE.Vector3();
        if (ray.ray.intersectPlane(ground, startHit)) {
          this.xyDrag = { ctrl, plane: ground, startHit: startHit.clone(), startPosMm: obj.position.clone() };
        }
      }
    }

    if (changed) {
      obj.rebuildBrush();
      this.csgScene.compile();
      this.resizeHandles.refresh(obj);
      this.inspector.dirty();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Ground plane in world space, follows the csgScene's current Y position. */
  private currentGroundPlane(): THREE.Plane {
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.csgScene.position.y);
  }

  private selectObject(obj: CSGObject): void {
    this.mode = { kind: 'selected', object: obj };
    this.inspector.inspect(obj);
    this.csgScene.setEditMode(true);
    this.resizeHandles.bindTo(obj);
  }

  private deselectObject(): void {
    this.mode = { kind: 'idle' };
    this.inspector.inspect(null);
    this.csgScene.setEditMode(false);
    this.resizeHandles.unbind();
    this.xyDrag            = null;
    this.zDrag             = null;
    this.rotateStart       = null;
    this.activeDimIdx      = 0;
    this.resizeStepIdx     = 1;
    this.resizeAccum       = 0;
    this.resizeUndoPending = false;
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

  private updateRayLines(): void {
    const pairs: [THREE.Raycaster, THREE.Line | null][] = [
      [this.rayL, this.leftLine],
      [this.rayR, this.rightLine],
    ];

    // Exclude the selected object's brush so it doesn't truncate the ray while
    // the user is trying to point at a menu or panel behind/around the object.
    const selectedBrush = this.mode.kind === 'selected' ? this.mode.object.brush : null;
    const selectables = this.csgScene.selectableObjects.filter(b => b !== selectedBrush);

    for (const [ray, line] of pairs) {
      if (!line) continue;
      const hits = ray.intersectObjects([
        ...selectables,
        this.menu,
        this.inspector,
        this.resizeHandles,
        ...(this.numInputPanel.visible ? [this.numInputPanel] : []),
      ], true);
      line.scale.z = hits.length > 0 ? hits[0].distance : 5;
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
