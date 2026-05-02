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

function snapMm(mm: number): number {
  return Math.round(mm / GRID_STEP_MM) * GRID_STEP_MM;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'placing'; type: PrimitiveType; op: CSGOperation; restingY: number }
  | { kind: 'selected'; object: CSGObject; dragCtrl: ControllerState | null; resizing: boolean };

/**
 * Three interaction modes:
 *  idle     — ray hovers panels; either trigger on object → selected
 *  placing  — ghost follows ground; either trigger → place + auto-select
 *  selected — either trigger drags object or resize handles; other trigger ignored
 *
 * Both left and right controllers work identically for all actions.
 */
export class SelectionManager {
  private mode: Mode = { kind: 'idle' };
  private ghost: THREE.Mesh | null = null;
  private readonly resizeHandles: ResizeHandles;
  private readonly dragOffsetMm = new THREE.Vector2();
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

  /** @param cameraForward  Normalised world-space forward of the XR camera. */
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
        if (obj) { this.selectObject(obj, ctrl, cameraForward); return; }
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
        if (ctrl.triggerJustDown) {
          this.placeObject(state, ctrl, cameraForward);
          return;
        }
      }
    }
  }

  private placeObject(
    state: Extract<Mode, { kind: 'placing' }>,
    ctrl: ControllerState,
    cameraForward: THREE.Vector3,
  ): void {
    const snapX = snapMm(Units.sceneToMm(this.hitPoint.x));
    const snapZ = snapMm(Units.sceneToMm(this.hitPoint.z));
    const restingYmm = CSGObject.restingY(state.type, CSGObject.defaultDims(state.type));

    const obj = this.csgScene.addObject(state.type, state.op);
    obj.position.set(snapX, restingYmm, snapZ);
    obj.rebuildBrush();
    this.csgScene.compile();

    this.clearGhost();
    this.menu.clearSelection();
    this.selectObject(obj, ctrl, cameraForward);
  }

  // ── Mode: selected ───────────────────────────────────────────────────────────

  private updateSelected(cameraForward: THREE.Vector3): void {
    const state = this.mode as Extract<Mode, { kind: 'selected' }>;
    const obj = state.object;

    // If the controller that started dragging released, end the drag.
    if (state.dragCtrl && !state.dragCtrl.triggerDown) {
      if (state.resizing) this.resizeHandles.endDrag();
      (state as { dragCtrl: ControllerState | null }).dragCtrl = null;
      (state as { resizing: boolean }).resizing = false;
    }

    // Active drag in progress.
    if (state.dragCtrl?.triggerDown) {
      const ray = this.rayFor(state.dragCtrl);
      if (state.resizing) {
        if (this.resizeHandles.continueDrag(ray, obj)) {
          obj.rebuildBrush();
          this.csgScene.compile();
          this.resizeHandles.refresh(obj);
          this.inspector.dirty();
        }
      } else {
        // Position drag along ground plane.
        if (ray.ray.intersectPlane(GROUND, this.hitPoint)) {
          obj.position.x = snapMm(Units.sceneToMm(this.hitPoint.x) + this.dragOffsetMm.x);
          obj.position.z = snapMm(Units.sceneToMm(this.hitPoint.z) + this.dragOffsetMm.y);
          obj.rebuildBrush();
          this.csgScene.compile();
          this.resizeHandles.refresh(obj);
          this.inspector.dirty();
        }
      }
      return;
    }

    // No drag active — check for new interactions on either controller.
    for (const [ctrl, ray] of this.ctrlRays()) {
      // Panel hit-testing
      const inspHit = this.inspector.visible ? this.inspector.hitTest(ray) : null;
      const menuHit = this.menu.visible    ? this.menu.hitTest(ray)      : null;
      this.inspector.onHover(inspHit);
      this.menu.onHover(menuHit);

      // Handle hover
      const handleSlot = this.resizeHandles.hitTest(ray);
      this.resizeHandles.onHover(handleSlot);

      if (!ctrl.triggerJustDown) continue;

      if (inspHit) { this.inspector.onPress(inspHit); return; }
      if (menuHit) { this.menu.onPress(menuHit); return; }

      // Resize handle grab
      if (handleSlot) {
        if (this.resizeHandles.beginDrag(handleSlot, ray, cameraForward, obj)) {
          (state as { dragCtrl: ControllerState | null }).dragCtrl = ctrl;
          (state as { resizing: boolean }).resizing = true;
        }
        return;
      }

      // Object or empty — position drag / deselect
      const hitObj = this.raycastObjects(ray);
      if (hitObj === null) {
        this.deselectObject();
        return;
      }
      if (hitObj !== obj) {
        this.selectObject(hitObj, ctrl, cameraForward);
        return;
      }

      // Same object — begin position drag
      if (ray.ray.intersectPlane(GROUND, this.hitPoint)) {
        this.dragOffsetMm.set(
          obj.position.x - Units.sceneToMm(this.hitPoint.x),
          obj.position.z - Units.sceneToMm(this.hitPoint.z),
        );
        (state as { dragCtrl: ControllerState | null }).dragCtrl = ctrl;
        (state as { resizing: boolean }).resizing = false;
      }
      return;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private selectObject(obj: CSGObject, _ctrl: ControllerState, _camFwd: THREE.Vector3): void {
    this.mode = { kind: 'selected', object: obj, dragCtrl: null, resizing: false };
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

  /** Iterate [ctrl, ray] pairs. Right first (dominant hand convention). */
  private ctrlRays(): [ControllerState, THREE.Raycaster][] {
    return [
      [this.right, this.rayR],
      [this.left,  this.rayL],
    ];
  }
}
