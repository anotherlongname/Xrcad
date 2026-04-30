import * as THREE from 'three';
import { ControllerState } from './ControllerState';
import { CSGObject } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';
import { ObjectInspector } from '../ui/ObjectInspector';
import { PrimitiveMenu } from '../ui/PrimitiveMenu';
import { Units } from '../units/Units';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Handles right-controller ray-cast selection and drag.
 * - Trigger on an object → select it, enter edit mode
 * - Trigger + move → drag object across the ground plane (Y unchanged)
 * - Trigger on a panel button → activate it
 * - Trigger on empty space → deselect
 */
export class SelectionManager {
  private selected: CSGObject | null = null;
  /** Drag offset in mm between object origin and cursor at time of click. */
  private readonly dragOffsetMm = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly tempMat = new THREE.Matrix4();
  private readonly hitPoint = new THREE.Vector3();

  constructor(
    private readonly right: ControllerState,
    private readonly scene: CSGScene,
    private readonly inspector: ObjectInspector,
    private readonly menu: PrimitiveMenu,
  ) {}

  update(): void {
    this.updateRaycaster(this.right.controller);

    // Panel hover feedback
    const menuHit = this.menu.visible ? this.menu.hitTest(this.raycaster) : null;
    const inspHit = this.inspector.visible ? this.inspector.hitTest(this.raycaster) : null;
    this.menu.onHover(menuHit);
    this.inspector.onHover(inspHit);

    if (this.right.triggerJustDown) {
      // Panel buttons take priority
      if (menuHit) { this.menu.onPress(menuHit); return; }
      if (inspHit) { this.inspector.onPress(inspHit); return; }

      // Object selection
      const hits = this.raycaster.intersectObjects(this.scene.selectableObjects, false);
      if (hits.length > 0) {
        const obj = this.scene.objects.find(o => o.brush === hits[0].object) ?? null;
        this.select(obj);
        if (obj && GROUND.intersectLine(
          new THREE.Line3(this.raycaster.ray.origin, this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, 10)),
          this.hitPoint,
        )) {
          this.dragOffsetMm.set(
            obj.position.x - Units.sceneToMm(this.hitPoint.x),
            obj.position.z - Units.sceneToMm(this.hitPoint.z),
          );
        }
      } else {
        this.select(null);
      }
    }

    // Drag selected object across Y=0 plane
    if (this.right.triggerDown && this.selected) {
      if (this.raycaster.ray.intersectPlane(GROUND, this.hitPoint)) {
        this.selected.position.x = Units.sceneToMm(this.hitPoint.x) + this.dragOffsetMm.x;
        this.selected.position.z = Units.sceneToMm(this.hitPoint.z) + this.dragOffsetMm.y;
        this.selected.rebuildBrush();
        this.scene.compile();
        this.inspector.dirty();
      }
    }
  }

  private select(obj: CSGObject | null): void {
    this.selected = obj;
    this.inspector.inspect(obj);
    this.scene.setEditMode(obj !== null);
  }

  private updateRaycaster(controller: THREE.XRTargetRaySpace): void {
    this.tempMat.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMat);
  }
}
