import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { WorkspaceGrid } from './WorkspaceGrid';
import { CSGScene } from '../csg/CSGScene';
import { ControllerState } from '../input/ControllerState';
import { SelectionManager } from '../input/SelectionManager';
import { WorkspaceScaler } from '../input/WorkspaceScaler';
import { PrimitiveMenu } from '../ui/PrimitiveMenu';
import { ObjectInspector } from '../ui/ObjectInspector';
import { Units } from '../units/Units';
import { Exporter } from '../io/Exporter';

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

  constructor() {
    // ── Renderer ──────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // ── Scene ─────────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1a);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.001, 100);
    this.camera.position.set(0, 1.6, 0.6);

    this.setupLighting();

    this.grid = new WorkspaceGrid();
    this.scene.add(this.grid);

    // ── CSG scene ─────────────────────────────────────────────────────────────
    this.csgScene = new CSGScene();
    this.scene.add(this.csgScene);

    // ── UI panels ─────────────────────────────────────────────────────────────
    this.menu = new PrimitiveMenu(this.csgScene);
    this.inspector = new ObjectInspector(this.csgScene);
    this.scene.add(this.inspector);

    // ── Controllers ───────────────────────────────────────────────────────────
    const [leftCtrl, leftGrip] = this.setupController(0);
    const [rightCtrl, rightGrip] = this.setupController(1);

    this.left = new ControllerState(0, leftCtrl, leftGrip);
    this.right = new ControllerState(1, rightCtrl, rightGrip);

    // Menu lives on the left wrist
    this.menu.rotation.x = -Math.PI / 4; // tilt toward user
    this.menu.position.set(0, 0.06, -0.04);
    leftGrip.add(this.menu);

    // ── Input managers ────────────────────────────────────────────────────────
    this.selector = new SelectionManager(this.right, this.csgScene, this.inspector, this.menu);
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

  start(): void {
    this.renderer.setAnimationLoop(this.animate);
  }

  private animate = (): void => {
    const session = this.renderer.xr.getSession();
    this.left.update(session);
    this.right.update(session);

    this.selector.update();
    this.scaler.update();

    // Keep inspector facing the user when visible
    if (this.inspector.visible) {
      const xrCam = this.renderer.xr.getCamera();
      const camPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(xrCam.matrixWorld);
      forward.y = 0;
      if (forward.lengthSq() > 0.001) forward.normalize();
      this.inspector.position.copy(camPos).addScaledVector(forward, 0.55);
      this.inspector.position.y = Math.max(camPos.y - 0.1, 1.0);
      this.inspector.lookAt(camPos);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /** Keyboard shortcuts for desktop/2D browser testing. */
  handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'b') this.csgScene.addObject('box');
    if (e.key === 'c') this.csgScene.addObject('cylinder');
    if (e.key === 's') this.csgScene.addObject('sphere');
    if (e.key === 'h') {
      // toggle last object between add/subtract
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
}
