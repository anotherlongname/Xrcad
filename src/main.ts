import { VRButton } from 'three/addons/webxr/VRButton.js';
import { SceneManager } from './scene/SceneManager';

const manager = new SceneManager();

document.body.appendChild(manager.renderer.domElement);

const vrButton = VRButton.createButton(manager.renderer);
document.getElementById('vr-button-container')!.appendChild(vrButton);

manager.start();
