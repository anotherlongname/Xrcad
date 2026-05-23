const DURATION_MS = 2500;
const FADE_MS     = 200;

const STYLES: Record<string, { bg: string; border: string; text: string }> = {
  success: { bg: '#14532d', border: '#22c55e', text: '#86efac' },
  error:   { bg: '#450a0a', border: '#ef4444', text: '#fca5a5' },
  info:    { bg: '#0f172a', border: '#3b5bdb', text: '#93c5fd' },
};

export function showToast(message: string, type: keyof typeof STYLES = 'info'): void {
  const { bg, border, text } = STYLES[type];
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:20px', 'left:50%',
    'transform:translateX(-50%) translateY(-6px)',
    `background:${bg}`, `border:1px solid ${border}`, `color:${text}`,
    'padding:9px 18px', 'border-radius:4px', 'font:13px monospace',
    'z-index:500', 'pointer-events:none', 'white-space:nowrap',
    'opacity:0',
    `transition:opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
  ].join(';');
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(-6px)';
    setTimeout(() => el.remove(), FADE_MS + 50);
  }, DURATION_MS);
}
