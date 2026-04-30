import { VRButton } from 'three/addons/webxr/VRButton.js';
import { SceneManager } from './scene/SceneManager';

const manager = new SceneManager();
document.body.appendChild(manager.renderer.domElement);
document.getElementById('vr-button-container')!.appendChild(VRButton.createButton(manager.renderer));

window.addEventListener('keydown', e => manager.handleKeyDown(e));

manager.start();
