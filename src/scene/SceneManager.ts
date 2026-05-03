import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { WorkspaceGrid } from './WorkspaceGrid';
import { CSGScene } from '../csg/CSGScene';
import { ControllerState } from '../input/ControllerState';
import { SelectionManager } from '../input/SelectionManager';
import { WorkspaceScaler } from '../input/WorkspaceScaler';
import { PrimitiveMenu } from '../ui/PrimitiveMenu';
import { ObjectInspector } from '../ui/ObjectInspector';
import { NumberInputManager } from '../ui/NumberInputManager';
import { Exporter } from '../io/Exporter';
import { Importer } from '../io/Importer';
import { Units } from '../units/Units';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly csgScene: CSGScene;
  private readonly grid: WorkspaceGrid;
  private readonly left: ControllerState;
  private readonly right: ControllerState;
  private readonly selector: SelectionManager;
  private readonly scaler: WorkspaceScaler;
  private readonly menu: PrimitiveMenu;
  private readonly inspector: ObjectInspector;

  private readonly modelFactory = new XRControllerModelFactory();

  private xrMode: 'immersive-vr' | 'immersive-ar' | null = null;
  private lastScale = -1;

  // Reusable vectors for inspector/menu positioning
  private readonly _camPos = new THREE.Vector3();
  private readonly _forward = new THREE.Vector3();

  constructor() {
    // ── Renderer ──────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.xr.addEventListener('sessionstart', () => {
      // Disable Fixed Foveated Rendering to remove the visible low-res edge band.
      this.renderer.xr.setFoveation(0);
      const session = this.renderer.xr.getSession();
      this.xrMode = session?.environmentBlendMode !== 'opaque' ? 'immersive-ar' : 'immersive-vr';
      if (this.xrMode === 'immersive-ar') this.scene.background = null;
      this.menu.setXRMode(this.xrMode);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.scene.background = new THREE.Color(0x0a0f1a);
      this.xrMode = null;
      this.menu.setXRMode(null);
    });

    // ── Scene ─────────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1a);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.001, 100);
    this.camera.position.set(0, 1.6, 0.6);

    this.setupLighting();

    this.grid = new WorkspaceGrid();
    this.scene.add(this.grid);

    this.csgScene = new CSGScene();
    this.scene.add(this.csgScene);

    // ── UI panels ─────────────────────────────────────────────────────────────
    const numInput = new NumberInputManager();
    this.inspector = new ObjectInspector(this.csgScene, numInput);
    this.scene.add(this.inspector);

    // Menu is added to the scene (not to a grip) and starts hidden.
    // onShapeSelected fires when the user picks a shape type from the menu.
    this.menu = new PrimitiveMenu(
      this.csgScene,
      (type, op) => { this.selector.startPlacing(type, op); },
      () => { void this.switchXRMode(); },
      () => { this.scaler.toggleMode(); },
      () => { void this.renderer.xr.getSession()?.end(); },
    );
    this.scene.add(this.menu);

    // ── Controllers ───────────────────────────────────────────────────────────
    const [leftCtrl, leftGrip]   = this.setupController(0);
    const [rightCtrl, rightGrip] = this.setupController(1);

    this.left  = new ControllerState('left',  leftCtrl,  leftGrip);
    this.right = new ControllerState('right', rightCtrl, rightGrip);

    // ── Input managers ────────────────────────────────────────────────────────
    this.selector = new SelectionManager(
      this.left, this.right, this.csgScene, this.scene, this.inspector, this.menu,
    );
    this.scaler = new WorkspaceScaler(this.left, this.right, this.csgScene, this.grid);

    window.addEventListener('resize', this.onResize);
  }

  private setupLighting(): void {
    this.scene.add(new THREE.AmbientLight(0x8899cc, 0.5));
    this.scene.add(new THREE.HemisphereLight(0xaabbff, 0x332211, 0.6));

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 20;
    sun.shadow.camera.left = -5;
    sun.shadow.camera.right = 5;
    sun.shadow.camera.top = 5;
    sun.shadow.camera.bottom = -5;
    this.scene.add(sun);
  }

  private setupController(index: number): [THREE.XRTargetRaySpace, THREE.XRGripSpace] {
    const controller = this.renderer.xr.getController(index);
    controller.add(this.buildRayLine());
    this.scene.add(controller);

    const grip = this.renderer.xr.getControllerGrip(index);
    grip.add(this.modelFactory.createControllerModel(grip));
    this.scene.add(grip);

    return [controller, grip];
  }

  private buildRayLine(): THREE.Line {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    const line = new THREE.Line(geo, mat);
    line.scale.z = 5;
    return line;
  }

  save2D(): void {
    Exporter.save(this.csgScene);
  }

  load2D(): void {
    Importer.openFilePicker(this.csgScene);
  }

  importSTL2D(): void {
    Importer.importSTL2D(this.csgScene, 'add', (obj) => {
      this.csgScene.compile();
      this.selector.forceSelect(obj);
    });
  }

  start(): void {
    this.renderer.setAnimationLoop(this.animate);
  }

  private animate = (): void => {
    const session = this.renderer.xr.getSession();
    this.left.update(session);
    this.right.update(session);

    // X button on left controller → toggle menu
    if (this.left.primaryButtonJustDown) {
      this.toggleMenu();
    }

    // X button on right controller (A) → dismiss menu / cancel placement
    if (this.right.primaryButtonJustDown && this.menu.visible) {
      this.dismissMenu();
    }

    const xrCam = this.renderer.xr.getCamera();
    this._forward.set(0, 0, -1).transformDirection(xrCam.matrixWorld).normalize();
    this.selector.update(this._forward);
    this.scaler.update();

    if (Units.workspaceScale !== this.lastScale) {
      this.lastScale = Units.workspaceScale;
      this.menu.dirty();
    }

    this.updateFloatingPanels();

    this.renderer.render(this.scene, this.camera);
  };

  private toggleMenu(): void {
    if (this.menu.visible) {
      this.dismissMenu();
    } else {
      this.positionMenuInFront();
      this.menu.visible = true;
    }
  }

  private dismissMenu(): void {
    this.menu.visible = false;
    this.menu.clearSelection();
    this.selector.cancelPlacing();
  }

  private positionMenuInFront(): void {
    const xrCam = this.renderer.xr.getCamera();
    this._camPos.setFromMatrixPosition(xrCam.matrixWorld);
    this._forward.set(0, 0, -1).transformDirection(xrCam.matrixWorld);
    this._forward.y = 0;
    if (this._forward.lengthSq() < 0.001) this._forward.set(0, 0, -1);
    this._forward.normalize();

    this.menu.position.copy(this._camPos).addScaledVector(this._forward, 0.65);
    this.menu.position.y = Math.max(this._camPos.y - 0.05, 1.1);
    this.menu.lookAt(this._camPos);
  }

  private updateFloatingPanels(): void {
    const xrCam = this.renderer.xr.getCamera();
    this._camPos.setFromMatrixPosition(xrCam.matrixWorld);
    this._forward.set(0, 0, -1).transformDirection(xrCam.matrixWorld);
    this._forward.y = 0;
    if (this._forward.lengthSq() > 0.001) this._forward.normalize();

    if (this.inspector.visible) {
      // Inspector slightly to the right of center, at chest height
      const right = new THREE.Vector3().crossVectors(this._forward, new THREE.Vector3(0, 1, 0)).normalize();
      this.inspector.position
        .copy(this._camPos)
        .addScaledVector(this._forward, 0.55)
        .addScaledVector(right, 0.18);
      this.inspector.position.y = Math.max(this._camPos.y - 0.1, 1.0);
      this.inspector.lookAt(this._camPos);
    }
  }

  private async switchXRMode(): Promise<void> {
    const current = this.renderer.xr.getSession();
    if (current) await current.end();
    const target = this.xrMode === 'immersive-ar' ? 'immersive-vr' : 'immersive-ar';
    try {
      const opts = {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      } as XRSessionInit;
      const session = await (navigator.xr as XRSystem).requestSession(target, opts);
      await this.renderer.xr.setSession(session);
    } catch {
      // Mode not supported on this device — silently ignore.
    }
  }

  /** Desktop keyboard shortcuts for testing outside VR. */
  handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'b') this.csgScene.addObject('box');
    if (e.key === 'c') this.csgScene.addObject('cylinder');
    if (e.key === 's') this.csgScene.addObject('sphere');
    if (e.key === 'h') {
      const last = this.csgScene.objects.at(-1);
      if (last) {
        last.operation = last.operation === 'add' ? 'subtract' : 'add';
        last.rebuildBrush();
        this.csgScene.compile();
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      Exporter.save(this.csgScene);
    }
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
