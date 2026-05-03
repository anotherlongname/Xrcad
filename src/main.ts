import { SceneManager } from './scene/SceneManager';
import { Importer } from './io/Importer';

const manager = new SceneManager();
document.body.appendChild(manager.renderer.domElement);

// ── dom-overlay elements ──────────────────────────────────────────────────────
const overlayRoot  = document.getElementById('xr-overlay')      as HTMLElement;
const importPanel  = document.getElementById('xr-import-panel') as HTMLElement;
const fileInput    = document.getElementById('xr-file-input')   as HTMLInputElement;

manager.setOverlayElements(overlayRoot, importPanel, fileInput);

document.getElementById('xr-import-cancel')!.addEventListener('click', () => {
  importPanel.style.display = 'none';
});

// ── Custom VR button with dom-overlay support ─────────────────────────────────
const vrBtn = document.createElement('button');
vrBtn.style.cssText = [
  'display:flex', 'align-items:center', 'justify-content:center',
  'border:1px solid #fff', 'border-radius:4px', 'color:#fff',
  'cursor:pointer', 'font-family:sans-serif', 'font-size:13px',
  'padding:12px 20px', 'min-width:120px',
  'background:rgba(0,0,0,0.1)', 'backdrop-filter:blur(12px)',
].join(';');
vrBtn.textContent = 'CHECKING…';
vrBtn.disabled = true;

let activeSession: XRSession | null = null;

async function startXR(): Promise<void> {
  const session = await (navigator.xr as XRSystem).requestSession('immersive-ar', {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay'],
    domOverlay: { root: overlayRoot },
  } as XRSessionInit);
  activeSession = session;
  session.addEventListener('end', () => {
    activeSession = null;
    vrBtn.textContent = 'ENTER AR';
  });
  await manager.renderer.xr.setSession(session);
  vrBtn.textContent = 'EXIT AR';
}

vrBtn.addEventListener('click', () => {
  if (activeSession) void activeSession.end();
  else void startXR();
});

if (navigator.xr) {
  (navigator.xr as XRSystem).isSessionSupported('immersive-ar')
    .then(supported => {
      vrBtn.textContent = supported ? 'ENTER AR' : 'AR NOT SUPPORTED';
      vrBtn.disabled    = !supported;
    })
    .catch(() => { vrBtn.textContent = 'AR NOT SUPPORTED'; });
} else {
  vrBtn.textContent = 'WEBXR NOT FOUND';
}

document.getElementById('vr-button-container')!.appendChild(vrBtn);

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
