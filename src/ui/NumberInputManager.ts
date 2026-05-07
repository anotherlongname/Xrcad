/**
 * Manages a DOM number-input overlay for precise value entry.
 *
 * On desktop: renders as a centred overlay card with a <input type="number">.
 * In a WebXR session on Meta Quest: focusing the input triggers the Quest
 * system keyboard as an in-headset overlay (Quest browser v23+).
 *
 * Usage:
 *   manager.open(currentValue, 'width', (v) => { obj.dims.width = v; ... });
 */
export class NumberInputManager {
  private readonly container: HTMLDivElement;
  private readonly labelEl: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private onConfirm: ((value: number) => void) | null = null;
  private blurTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      bottom: '22%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#0f172a',
      border: '2px solid #3b5bdb',
      borderRadius: '10px',
      padding: '18px 24px',
      zIndex: '200',
      display: 'none',
      textAlign: 'center',
      fontFamily: 'monospace',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      minWidth: '200px',
      pointerEvents: 'auto',  // re-enable inside the pointer-events:none overlay root
    });

    this.labelEl = document.createElement('div');
    Object.assign(this.labelEl.style, {
      color: '#93c5fd',
      fontSize: '15px',
      marginBottom: '10px',
      letterSpacing: '0.05em',
    });
    this.container.appendChild(this.labelEl);

    this.input = document.createElement('input');
    this.input.type = 'number';
    this.input.step = '1';
    this.input.inputMode = 'decimal';
    Object.assign(this.input.style, {
      background: '#1e293b',
      color: '#f1f5f9',
      border: '1px solid #3b5bdb',
      borderRadius: '6px',
      padding: '8px 12px',
      fontSize: '28px',
      width: '140px',
      textAlign: 'center',
      fontFamily: 'monospace',
      outline: 'none',
    });
    this.container.appendChild(this.input);

    const hint = document.createElement('div');
    hint.textContent = 'Enter or dismiss keyboard to confirm  ·  Esc to cancel';
    Object.assign(hint.style, {
      color: '#475569',
      fontSize: '12px',
      marginTop: '8px',
    });
    this.container.appendChild(hint);

    // Append inside the dom-overlay root so the element is visible during a
    // WebXR session and the Quest system keyboard activates on input focus.
    const overlayRoot = document.getElementById('xr-overlay') ?? document.body;
    overlayRoot.appendChild(this.container);

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); this.confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); this.close();   }
    });

    // Quest keyboard dismissal fires blur — treat as confirm.
    this.input.addEventListener('blur', () => {
      // Use a short timeout so an Escape key handler that calls close() first
      // can set onConfirm=null before this fires.
      this.blurTimeout = setTimeout(() => {
        if (this.onConfirm) this.confirm();
      }, 80);
    });
  }

  open(currentValue: number, label: string, onConfirm: (value: number) => void): void {
    if (this.blurTimeout) { clearTimeout(this.blurTimeout); this.blurTimeout = null; }
    this.onConfirm = onConfirm;
    this.labelEl.textContent = label;
    this.input.value = String(Math.round(currentValue));
    this.input.min = '1';
    this.container.style.display = 'block';
    // rAF ensures the element is visible before focus (required for Quest keyboard)
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.select();
    });
  }

  close(): void {
    if (this.blurTimeout) { clearTimeout(this.blurTimeout); this.blurTimeout = null; }
    this.onConfirm = null;
    this.container.style.display = 'none';
    this.input.blur();
  }

  private confirm(): void {
    const cb = this.onConfirm;
    this.onConfirm = null;
    this.container.style.display = 'none';

    const v = parseFloat(this.input.value);
    if (!isNaN(v) && v >= 1) cb?.(v);
  }
}
