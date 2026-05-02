import * as THREE from 'three';

/**
 * Per-frame snapshot of one XR controller's button and axis state.
 * Uses handedness to find the right input source regardless of connection order.
 * Call update() once at the top of the animation loop.
 */
export class ControllerState {
  readonly handedness: 'left' | 'right';
  readonly controller: THREE.XRTargetRaySpace;
  readonly grip: THREE.XRGripSpace;

  triggerDown = false;
  triggerJustDown = false;
  triggerJustUp = false;

  gripDown = false;
  gripJustDown = false;
  gripJustUp = false;

  /** X on left controller / A on right controller. */
  primaryButtonJustDown = false;
  /** Y on left controller / B on right controller. */
  secondaryButtonJustDown = false;

  readonly thumbstick = new THREE.Vector2();

  private prevTrigger = false;
  private prevGrip = false;
  private prevPrimary = false;
  private prevSecondary = false;

  constructor(
    handedness: 'left' | 'right',
    controller: THREE.XRTargetRaySpace,
    grip: THREE.XRGripSpace,
  ) {
    this.handedness = handedness;
    this.controller = controller;
    this.grip = grip;
  }

  update(session: XRSession | null): void {
    this.triggerJustDown = false;
    this.triggerJustUp = false;
    this.gripJustDown = false;
    this.gripJustUp = false;
    this.primaryButtonJustDown = false;
    this.secondaryButtonJustDown = false;

    // Find source by handedness — more reliable than index on Quest.
    let gp: Gamepad | null = null;
    if (session) {
      for (const src of session.inputSources) {
        if (src.handedness === this.handedness) { gp = src.gamepad ?? null; break; }
      }
    }

    const trigger   = gp?.buttons[0]?.pressed ?? false;
    const grip      = gp?.buttons[1]?.pressed ?? false;
    const primary   = gp?.buttons[4]?.pressed ?? false; // X / A
    const secondary = gp?.buttons[5]?.pressed ?? false; // Y / B

    this.triggerJustDown = trigger && !this.prevTrigger;
    this.triggerJustUp   = !trigger && this.prevTrigger;
    this.triggerDown = trigger;

    this.gripJustDown = grip && !this.prevGrip;
    this.gripJustUp   = !grip && this.prevGrip;
    this.gripDown = grip;

    this.primaryButtonJustDown   = primary && !this.prevPrimary;
    this.secondaryButtonJustDown = secondary && !this.prevSecondary;

    // Quest 3 thumbstick: axes[2]=X, axes[3]=Y
    this.thumbstick.set(gp?.axes[2] ?? 0, gp?.axes[3] ?? 0);

    this.prevTrigger   = trigger;
    this.prevGrip      = grip;
    this.prevPrimary   = primary;
    this.prevSecondary = secondary;
  }
}
