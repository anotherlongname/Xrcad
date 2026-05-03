import { VRButton } from 'three/addons/webxr/VRButton.js';
import { SceneManager } from './scene/SceneManager';
import { Importer } from './io/Importer';

const manager = new SceneManager();
document.body.appendChild(manager.renderer.domElement);
document.getElementById('vr-button-container')!.appendChild(VRButton.createButton(manager.renderer));

window.addEventListener('keydown', e => manager.handleKeyDown(e));

// ── 2D STL staging panel (visible only outside an active XR session) ──────────
const stlPrep   = document.getElementById('stl-prep')!;
const stlBtn    = document.getElementById('stl-prep-btn')!;
const stlStatus = document.getElementById('stl-prep-status')!;

// Reflect any already-staged file on load
if (Importer.hasStagedSTL()) {
  stlStatus.textContent = 'STL ready — press IMPORT STL in VR';
  stlStatus.className = 'ready';
}

stlBtn.addEventListener('click', () => {
  Importer.stageSTLForVR((name) => {
    stlStatus.textContent = `Ready: ${name} — press IMPORT STL in VR`;
    stlStatus.className = 'ready';
  });
});

manager.renderer.xr.addEventListener('sessionstart', () => {
  stlPrep.style.display = 'none';
});
manager.renderer.xr.addEventListener('sessionend', () => {
  stlPrep.style.display = '';
  // Refresh status in case the VR session consumed the staged file
  if (Importer.hasStagedSTL()) {
    stlStatus.textContent = 'STL ready — press IMPORT STL in VR';
    stlStatus.className = 'ready';
  } else {
    stlStatus.textContent = 'Select an STL before entering VR';
    stlStatus.className = '';
  }
});

manager.start();
