import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { WorkspaceGrid } from './WorkspaceGrid';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private readonly controllerModelFactory = new XRControllerModelFactory();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x12121f);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.001, 100);
    this.camera.position.set(0, 1.6, 0.6); // seated eye height for desktop preview

    this.setupLighting();
    this.scene.add(new WorkspaceGrid());
    this.setupControllers();

    window.addEventListener('resize', this.onResize);
  }

  private setupLighting(): void {
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.5));

    const hemi = new THREE.HemisphereLight(0xaabbff, 0x332211, 0.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 20;
    sun.shadow.camera.top = 5;
    sun.shadow.camera.bottom = -5;
    sun.shadow.camera.left = -5;
    sun.shadow.camera.right = 5;
    this.scene.add(sun);
  }

  private setupControllers(): void {
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.add(this.buildRayLine());
      this.scene.add(controller);

      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(this.controllerModelFactory.createControllerModel(grip));
      this.scene.add(grip);
    }
  }

  private buildRayLine(): THREE.Line {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const line = new THREE.Line(geo, mat);
    line.scale.z = 5; // 5 metre ray
    return line;
  }

  start(): void {
    this.renderer.setAnimationLoop(this.animate);
  }

  private animate = (): void => {
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
