import { VRPanel } from './VRPanel';
import { CSGObject, Dimensions } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';
import { NumberInputManager } from './NumberInputManager';

const PAD  = 10;
const BH   = 34;
const STEP = BH + 6;

// Column layout (canvas pixels, panel is 512 wide)
const LABEL_W = 86;   // dim key label
const MINUS_W = 36;
const VAL_W   = 76;   // tappable value — opens keyboard
const PLUS_W  = 36;
const MINUS_X = LABEL_W + PAD;
const VAL_X   = MINUS_X + MINUS_W + 4;
const PLUS_X  = VAL_X + VAL_W + 4;

/**
 * Floating inspector panel shown when an object is selected.
 *
 * For each dimension and each position axis the current value is rendered
 * as a tappable button — pointing at it and pressing trigger opens the
 * system keyboard (Quest) or an on-screen overlay (desktop) so the user
 * can type an exact mm value directly.
 *
 * The ± step buttons remain for small adjustments.
 */
export class ObjectInspector extends VRPanel {
  private obj: CSGObject | null = null;

  constructor(
    private readonly scene: CSGScene,
    private readonly numInput: NumberInputManager,
  ) {
    // 0.30m wide × 0.46m tall
    super(0.30, 0.46, 512);
    this.visible = false;
  }

  inspect(obj: CSGObject | null): void {
    this.obj = obj;
    this.visible = obj !== null;
    this.rebuildButtons();
    if (obj) this.dirty();
  }

  // ── Button layout ────────────────────────────────────────────────────────────

  private dimEntries(): [string, number][] {
    if (!this.obj) return [];
    return (Object.entries(this.obj.dims) as [string, number][])
      .filter(([, v]) => v !== undefined);
  }

  private rowY(i: number): number {
    return 48 + STEP + PAD + i * STEP;   // starts below op/delete row
  }

  private posRowY(i: number): number {
    return this.rowY(this.dimEntries().length) + PAD + 22 + i * STEP;
  }

  private rebuildButtons(): void {
    this.buttons = [];
    if (!this.obj) return;
    const obj = this.obj;

    // ── Operation toggle ───────────────────────────────────────────────────
    this.buttons.push({
      id: 'op_toggle',
      label: obj.operation === 'add' ? 'SOLID' : 'HOLE',
      x: PAD, y: 48, w: 130, h: BH,
      action: () => {
        obj.operation = obj.operation === 'add' ? 'subtract' : 'add';
        obj.rebuildBrush();
        this.scene.compile();
        this.rebuildButtons();
        this.dirty();
      },
    });

    // ── Delete ─────────────────────────────────────────────────────────────
    this.buttons.push({
      id: 'delete',
      label: 'DEL',
      x: PAD + 140, y: 48, w: 72, h: BH,
      action: () => { this.scene.removeObject(obj.id); this.inspect(null); },
    });

    // ── Dimension rows ─────────────────────────────────────────────────────
    this.dimEntries().forEach(([key, val], i) => {
      const y   = this.rowY(i);
      const dims = obj.dims as Record<string, number>;

      // − button
      this.buttons.push({
        id: `d_${key}_minus`,
        label: '−',
        x: MINUS_X, y, w: MINUS_W, h: BH,
        action: () => {
          dims[key] = Math.max(1, (dims[key] ?? 1) - 1);
          this.afterDimChange(obj);
        },
      });

      // value tap → keyboard
      this.buttons.push({
        id: `d_${key}_val`,
        label: `${Math.round(val)}`,
        x: VAL_X, y, w: VAL_W, h: BH,
        action: () => {
          this.numInput.open(dims[key] ?? 1, `${key} (mm)`, (v) => {
            dims[key] = Math.max(1, Math.round(v));
            this.afterDimChange(obj);
          });
        },
      });

      // + button
      this.buttons.push({
        id: `d_${key}_plus`,
        label: '+',
        x: PLUS_X, y, w: PLUS_W, h: BH,
        action: () => {
          dims[key] = (dims[key] ?? 1) + 1;
          this.afterDimChange(obj);
        },
      });
    });

    // ── Position rows ──────────────────────────────────────────────────────
    // Display order: X (left/right), Z (up/down), Y (depth) — CAD Z-up convention.
    const axes: ['x' | 'y' | 'z', string][] = [['x', 'X'], ['z', 'Z'], ['y', 'Y']];
    axes.forEach(([axis, label], i) => {
      const y = this.posRowY(i);

      this.buttons.push({
        id: `p_${axis}_minus`,
        label: '−',
        x: MINUS_X, y, w: MINUS_W, h: BH,
        action: () => {
          obj.position[axis] = Math.round(obj.position[axis] - 1);
          this.afterPosChange(obj);
        },
      });

      this.buttons.push({
        id: `p_${axis}_val`,
        label: `${Math.round(obj.position[axis])}`,
        x: VAL_X, y, w: VAL_W, h: BH,
        action: () => {
          this.numInput.open(obj.position[axis], `pos ${label} (mm)`, (v) => {
            obj.position[axis] = Math.round(v);
            this.afterPosChange(obj);
          });
        },
      });

      this.buttons.push({
        id: `p_${axis}_plus`,
        label: '+',
        x: PLUS_X, y, w: PLUS_W, h: BH,
        action: () => {
          obj.position[axis] = Math.round(obj.position[axis] + 1);
          this.afterPosChange(obj);
        },
      });
    });
  }

  private afterDimChange(obj: CSGObject): void {
    obj.rebuildBrush();
    this.scene.compile();
    this.rebuildButtons();
    this.dirty();
  }

  private afterPosChange(obj: CSGObject): void {
    obj.rebuildBrush();
    this.scene.compile();
    this.rebuildButtons();
    this.dirty();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────

  protected draw(): void {
    this.background();
    if (!this.obj) return;
    const obj = this.obj;

    this.text(obj.type.toUpperCase(), this.cw / 2, 10, 22, '#93c5fd', 'center');

    for (const btn of this.buttons) {
      const isOp = btn.id === 'op_toggle';
      this.button(btn, isOp);
    }

    // Dimension key labels and "mm" unit
    this.dimEntries().forEach(([key], i) => {
      const y = this.rowY(i);
      this.text(key, PAD, y + 8, 16, '#94a3b8');
      this.text('mm', PLUS_X + PLUS_W + 4, y + 9, 14, '#475569');
    });

    // Position section header
    const posHeaderY = this.rowY(this.dimEntries().length) + PAD;
    this.text('position', PAD, posHeaderY, 14, '#64748b');

    (['x', 'z', 'y'] as const).forEach((axis, i) => {
      const y = this.posRowY(i);
      this.text(axis.toUpperCase(), PAD, y + 9, 16, '#94a3b8');
      this.text('mm', PLUS_X + PLUS_W + 4, y + 9, 14, '#475569');
    });
  }
}
