import { VRPanel } from './VRPanel';

const PAD   = 10;
const BTN_W = Math.floor((512 - 4 * PAD) / 3);  // 157
const BTN_H = 58;
const STEP  = BTN_H + PAD;
const COL   = [PAD, PAD + BTN_W + PAD, PAD + 2 * (BTN_W + PAD)] as const;
const ROW0  = 118;

const KEYS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['.', '0', '←'],
  ['−', 'OK', '✕'],
] as const;

/**
 * In-scene number entry keypad for VR/AR use.
 * Replaces the DOM input overlay, which is unreliable inside WebXR sessions.
 *
 * Usage:
 *   panel.open(currentValue, 'width (mm)', v => { dims.width = v; ... });
 *   // position the panel in SceneManager.updateFloatingPanels()
 */
export class NumberInputPanel extends VRPanel {
  private displayStr = '0';
  private labelStr   = '';
  private onConfirm: ((v: number) => void) | null = null;

  constructor() {
    super(0.24, 0.35, 512);
    this.visible = false;
    this.rebuildButtons();
  }

  open(value: number, label: string, onConfirm: (v: number) => void): void {
    this.displayStr = Number.isInteger(value) ? String(value) : String(value);
    this.labelStr   = label;
    this.onConfirm  = onConfirm;
    this.rebuildButtons();
    this.dirty();
    this.visible = true;
  }

  close(): void {
    this.visible   = false;
    this.onConfirm = null;
  }

  // ── Button layout ────────────────────────────────────────────────────────────

  private rebuildButtons(): void {
    this.buttons = [];
    KEYS.forEach((row, ri) => {
      (row as readonly string[]).forEach((key, ci) => {
        this.buttons.push({
          id: `k_${ri}_${ci}`,
          label: key,
          x: COL[ci], y: ROW0 + ri * STEP, w: BTN_W, h: BTN_H,
          action: () => this.handleKey(key),
        });
      });
    });
  }

  private handleKey(key: string): void {
    switch (key) {
      case '←':
        this.displayStr = this.displayStr.length > 1 ? this.displayStr.slice(0, -1) : '0';
        break;
      case '−':
        this.displayStr = this.displayStr.startsWith('-')
          ? this.displayStr.slice(1)
          : '-' + this.displayStr;
        break;
      case '.':
        if (!this.displayStr.includes('.')) this.displayStr += '.';
        break;
      case 'OK': {
        const v = parseFloat(this.displayStr);
        if (!isNaN(v)) this.onConfirm?.(v);
        this.close();
        return;
      }
      case '✕':
        this.close();
        return;
      default: {
        // Digit pressed
        const isNegZero = this.displayStr === '-0' || this.displayStr === '0';
        this.displayStr = isNegZero
          ? (this.displayStr.startsWith('-') ? '-' : '') + key
          : this.displayStr + key;
      }
    }
    this.rebuildButtons();
    this.dirty();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────

  protected draw(): void {
    this.background();

    // Field label
    this.text(this.labelStr, this.cw / 2, 10, 16, '#93c5fd', 'center');

    // Value display box
    this.ctx.fillStyle = '#0f172a';
    this.ctx.fillRect(PAD, 40, this.cw - 2 * PAD, 66);
    this.ctx.strokeStyle = '#3b5bdb';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(PAD + 0.5, 40.5, this.cw - 2 * PAD - 1, 65);
    this.text(this.displayStr, this.cw - PAD - 6, 73, 38, '#f1f5f9', 'right', 'middle');

    // Buttons
    for (const btn of this.buttons) {
      this.button(btn, btn.label === 'OK');
    }
  }
}
