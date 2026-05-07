import { SceneManager } from './scene/SceneManager';

const manager = new SceneManager();
document.body.appendChild(manager.renderer.domElement);

// ── Custom VR button ──────────────────────────────────────────────────────────
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

const xrOverlay = document.getElementById('xr-overlay')!;

async function startXR(): Promise<void> {
  const session = await (navigator.xr as XRSystem).requestSession('immersive-ar', {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'dom-overlay'],
    domOverlay: { root: xrOverlay },
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

// ── 2D file-ops panel (hidden while in an active XR session) ─────────────────
const fileOps = document.getElementById('file-ops')!;

document.getElementById('file-ops-save')!.addEventListener('click', () => {
  manager.save2D();
});
document.getElementById('file-ops-load')!.addEventListener('click', () => {
  manager.load2D();
});
document.getElementById('file-ops-stl')!.addEventListener('click', () => {
  manager.importSTL2D();
});

manager.renderer.xr.addEventListener('sessionstart', () => {
  fileOps.style.display = 'none';
});
manager.renderer.xr.addEventListener('sessionend', () => {
  fileOps.style.display = '';
});

manager.start();
