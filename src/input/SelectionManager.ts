import * as THREE from 'three';
import { ControllerState } from './ControllerState';
import { CSGObject, CSGOperation, PrimitiveType } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';
import { ObjectInspector } from '../ui/ObjectInspector';
import { PrimitiveMenu } from '../ui/PrimitiveMenu';
import { Units } from '../units/Units';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const GRID_STEP_MM = 10; // snap to 10mm grid

function snapMm(mm: number): number {
  return Math.round(mm / GRID_STEP_MM) * GRID_STEP_MM;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'placing'; type: PrimitiveType; op: CSGOperation; restingY: number }
  | { kind: 'selected'; object: CSGObject };

/**
 * Manages the three interaction modes:
 *
 *  idle      — ray highlights UI panels; trigger on object → selected
 *  placing   — ghost preview follows ground plane; trigger → place + select
 *  selected  — trigger+drag moves object; inspector visible
 */
export class SelectionManager {
  private mode: Mode = { kind: 'idle' };
  private ghost: THREE.Mesh | null = null;
  private readonly dragOffsetMm = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tempMat = new THREE.Matrix4();
  private readonly hitPoint = new THREE.Vector3();

  constructor(
    private readonly right: ControllerState,
    private readonly csgScene: CSGScene,
    private readonly threeScene: THREE.Scene,
    private readonly inspector: ObjectInspector,
    private readonly menu: PrimitiveMenu,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Called by SceneManager when the user selects a shape type from the menu. */
  startPlacing(type: PrimitiveType, op: CSGOperation): void {
    this.clearGhost();
    this.deselectObject();

    const restingY = Units.mmToScene(CSGObject.restingY(type, CSGObject.defaultDims(type)));
    this.mode = { kind: 'placing', type, op, restingY };
    this.buildGhost(type, op, restingY);
  }

  /** Cancel placement (e.g. menu dismissed without placing). */
  cancelPlacing(): void {
    if (this.mode.kind === 'placing') {
      this.clearGhost();
      this.mode = { kind: 'idle' };
    }
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  update(): void {
    this.updateRaycaster(this.right.controller);

    switch (this.mode.kind) {
      case 'idle':     this.updateIdle();     break;
      case 'placing':  this.updatePlacing();  break;
      case 'selected': this.updateSelected(); break;
    }
  }

  // ── Mode: idle ──────────────────────────────────────────────────────────────

  private updateIdle(): void {
    const menuHit = this.menu.visible ? this.menu.hitTest(this.raycaster) : null;
    this.menu.onHover(menuHit);

    if (!this.right.triggerJustDown) return;

    if (menuHit) { this.menu.onPress(menuHit); return; }

    // Try selecting an object
    const hits = this.raycaster.intersectObjects(this.csgScene.selectableObjects, false);
    if (hits.length > 0) {
      const obj = this.csgScene.objects.find(o => o.brush === hits[0].object) ?? null;
      if (obj) { this.selectObject(obj); return; }
    }
  }

  // ── Mode: placing ───────────────────────────────────────────────────────────

  private updatePlacing(): void {
    const state = this.mode as Extract<Mode, { kind: 'placing' }>;

    // Panel interactions still work during placement
    const menuHit = this.menu.visible ? this.menu.hitTest(this.raycaster) : null;
    this.menu.onHover(menuHit);
    if (this.right.triggerJustDown && menuHit) { this.menu.onPress(menuHit); return; }

    // Move ghost to ray-ground intersection
    if (this.raycaster.ray.intersectPlane(GROUND, this.hitPoint)) {
      if (this.ghost) {
        this.ghost.position.set(
          snapMm(Units.sceneToMm(this.hitPoint.x)) * Units.workspaceScale / 1000,
          state.restingY,
          snapMm(Units.sceneToMm(this.hitPoint.z)) * Units.workspaceScale / 1000,
        );
        this.ghost.visible = true;
      }

      if (this.right.triggerJustDown) {
        this.placeObject(state);
      }
    }
  }

  private placeObject(state: Extract<Mode, { kind: 'placing' }>): void {
    const snapX = snapMm(Units.sceneToMm(this.hitPoint.x));
    const snapZ = snapMm(Units.sceneToMm(this.hitPoint.z));
    const restingYmm = CSGObject.restingY(state.type, CSGObject.defaultDims(state.type));

    const obj = this.csgScene.addObject(state.type, state.op);
    obj.position.set(snapX, restingYmm, snapZ);
    obj.rebuildBrush();
    this.csgScene.compile();

    this.clearGhost();
    this.menu.clearSelection();
    this.selectObject(obj);
  }

  // ── Mode: selected ──────────────────────────────────────────────────────────

  private updateSelected(): void {
    const state = this.mode as Extract<Mode, { kind: 'selected' }>;
    const obj = state.object;

    // Inspector hit-testing
    const inspHit = this.inspector.visible ? this.inspector.hitTest(this.raycaster) : null;
    const menuHit = this.menu.visible ? this.menu.hitTest(this.raycaster) : null;
    this.inspector.onHover(inspHit);
    this.menu.onHover(menuHit);

    if (this.right.triggerJustDown) {
      if (inspHit) { this.inspector.onPress(inspHit); return; }
      if (menuHit) { this.menu.onPress(menuHit); return; }

      // Tap on same object — start dragging; tap on empty → deselect
      const hits = this.raycaster.intersectObjects(this.csgScene.selectableObjects, false);
      const hitObj = hits.length > 0
        ? (this.csgScene.objects.find(o => o.brush === hits[0].object) ?? null)
        : null;

      if (hitObj === obj || hitObj === null) {
        if (hitObj === null) { this.deselectObject(); return; }
      } else {
        this.selectObject(hitObj); return;
      }

      // Record drag offset at click point
      if (this.raycaster.ray.intersectPlane(GROUND, this.hitPoint)) {
        this.dragOffsetMm.set(
          obj.position.x - Units.sceneToMm(this.hitPoint.x),
          obj.position.z - Units.sceneToMm(this.hitPoint.z),
        );
      }
    }

    // Drag
    if (this.right.triggerDown && this.raycaster.ray.intersectPlane(GROUND, this.hitPoint)) {
      obj.position.x = snapMm(Units.sceneToMm(this.hitPoint.x) + this.dragOffsetMm.x);
      obj.position.z = snapMm(Units.sceneToMm(this.hitPoint.z) + this.dragOffsetMm.y);
      obj.rebuildBrush();
      this.csgScene.compile();
      this.inspector.dirty();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private selectObject(obj: CSGObject): void {
    this.mode = { kind: 'selected', object: obj };
    this.inspector.inspect(obj);
    this.csgScene.setEditMode(true);
  }

  private deselectObject(): void {
    this.mode = { kind: 'idle' };
    this.inspector.inspect(null);
    this.csgScene.setEditMode(false);
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

  private updateRaycaster(controller: THREE.XRTargetRaySpace): void {
    this.tempMat.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMat);
  }
}
