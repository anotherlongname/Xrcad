import * as THREE from 'three';

/**
 * Per-frame snapshot of one XR controller's button and axis state.
 * Call update() once at the top of the animation loop.
 */
export class ControllerState {
  readonly index: number;
  readonly controller: THREE.XRTargetRaySpace;
  readonly grip: THREE.XRGripSpace;

  triggerDown = false;
  triggerJustDown = false;
  triggerJustUp = false;

  gripDown = false;
  gripJustDown = false;
  gripJustUp = false;

  readonly thumbstick = new THREE.Vector2();

  private prevTrigger = false;
  private prevGrip = false;

  constructor(index: number, controller: THREE.XRTargetRaySpace, grip: THREE.XRGripSpace) {
    this.index = index;
    this.controller = controller;
    this.grip = grip;
  }

  update(session: XRSession | null): void {
    this.triggerJustDown = false;
    this.triggerJustUp = false;
    this.gripJustDown = false;
    this.gripJustUp = false;

    const source = session?.inputSources[this.index];
    const gp = source?.gamepad;

    const trigger = gp?.buttons[0]?.pressed ?? false;
    const grip = gp?.buttons[1]?.pressed ?? false;

    this.triggerJustDown = trigger && !this.prevTrigger;
    this.triggerJustUp = !trigger && this.prevTrigger;
    this.triggerDown = trigger;

    this.gripJustDown = grip && !this.prevGrip;
    this.gripJustUp = !grip && this.prevGrip;
    this.gripDown = grip;

    // Quest 3 thumbstick: axes[2]=X, axes[3]=Y
    this.thumbstick.set(gp?.axes[2] ?? 0, gp?.axes[3] ?? 0);

    this.prevTrigger = trigger;
    this.prevGrip = grip;
  }
}
