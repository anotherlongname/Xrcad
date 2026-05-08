import * as THREE from 'three';
import { VRPanel } from './VRPanel';
import { CSGObject, Dimensions } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';

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
  private activeDimKey: string | null = null;
  private activeDimStep = 5;

  setActiveDim(key: string | null, step: number): void {
    if (key === this.activeDimKey && step === this.activeDimStep) return;
    this.activeDimKey = key;
    this.activeDimStep = step;
    this.dirty();
  }

  constructor(
    private readonly scene: CSGScene,
    private readonly openInput: (value: number, label: string, onConfirm: (v: number) => void) => void,
    private readonly pushUndo: () => void,
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

  private rotHeaderY(): number {
    return this.posRowY(3) + PAD;
  }

  private rotRowY(i: number): number {
    return this.rotHeaderY() + 22 + i * STEP;
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
        this.pushUndo();
      },
    });

    // ── Delete ─────────────────────────────────────────────────────────────
    this.buttons.push({
      id: 'delete',
      label: 'DEL',
      x: PAD + 140, y: 48, w: 72, h: BH,
      action: () => { this.scene.removeObject(obj.id); this.inspect(null); this.pushUndo(); },
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
          this.openInput(dims[key] ?? 1, `${key} (mm)`, (v) => {
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
    // Z is displayed as base (bottom face) position, not center, so the value
    // reads 0mm when the object sits flush on the grid.
    const axes: ['x' | 'y' | 'z', string][] = [['x', 'X'], ['z', 'Z'], ['y', 'Y']];
    axes.forEach(([axis, label], i) => {
      const y = this.posRowY(i);
      const isZ = axis === 'z';

      // Base Z = center Z − half-height; other axes display as center.
      const displayVal = (): number => {
        if (!isZ) return Math.round(obj.position[axis]);
        const h = CSGObject.restingZ(obj.type, obj.dims, obj.importedRestingZMm);
        return Math.round(obj.position.z - h);
      };

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
        label: `${displayVal()}`,
        x: VAL_X, y, w: VAL_W, h: BH,
        action: () => {
          this.openInput(displayVal(), `pos ${label} (mm)`, (v) => {
            if (isZ) {
              const h = CSGObject.restingZ(obj.type, obj.dims, obj.importedRestingZMm);
              obj.position.z = Math.round(v) + h;
            } else {
              obj.position[axis] = Math.round(v);
            }
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

    // ── Rotation rows ──────────────────────────────────────────────────────
    // Three.js X/Y/Z euler angles displayed in degrees.
    const rotAxes: ['x' | 'y' | 'z'][] = [['x'], ['y'], ['z']];
    const ROT_STEP = 15 * Math.PI / 180;
    rotAxes.forEach(([axis], i) => {
      const y = this.rotRowY(i);
      const getDeg = () => Math.round(THREE.MathUtils.radToDeg(obj.rotation[axis]));

      this.buttons.push({
        id: `r_${axis}_minus`,
        label: '−',
        x: MINUS_X, y, w: MINUS_W, h: BH,
        action: () => {
          obj.rotation[axis] = Math.round((obj.rotation[axis] - ROT_STEP) / ROT_STEP) * ROT_STEP;
          this.afterRotChange(obj);
        },
      });

      this.buttons.push({
        id: `r_${axis}_val`,
        label: `${getDeg()}°`,
        x: VAL_X, y, w: VAL_W, h: BH,
        action: () => {
          this.openInput(getDeg(), `rot ${axis.toUpperCase()} (deg)`, (v) => {
            obj.rotation[axis] = THREE.MathUtils.degToRad(v);
            this.afterRotChange(obj);
          });
        },
      });

      this.buttons.push({
        id: `r_${axis}_plus`,
        label: '+',
        x: PLUS_X, y, w: PLUS_W, h: BH,
        action: () => {
          obj.rotation[axis] = Math.round((obj.rotation[axis] + ROT_STEP) / ROT_STEP) * ROT_STEP;
          this.afterRotChange(obj);
        },
      });
    });
  }

  private afterDimChange(obj: CSGObject): void {
    obj.rebuildBrush();
    this.scene.compile();
    this.rebuildButtons();
    this.dirty();
    this.pushUndo();
  }

  private afterPosChange(obj: CSGObject): void {
    obj.rebuildBrush();
    this.scene.compile();
    this.rebuildButtons();
    this.dirty();
    this.pushUndo();
  }

  private afterRotChange(obj: CSGObject): void {
    obj.rebuildBrush();
    this.scene.compile();
    this.rebuildButtons();
    this.dirty();
    this.pushUndo();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────

  protected draw(): void {
    this.background();
    if (!this.obj) return;
    const obj = this.obj;

    this.text(obj.type.toUpperCase(), this.cw / 2, 10, 22, '#93c5fd', 'center');

    // Active dim subtitle — prominent feedback at top of panel
    if (this.activeDimKey) {
      this.text(`▶ ${this.activeDimKey.toUpperCase()}`, this.cw / 2, 34, 13, '#60a5fa', 'center');
    }

    for (const btn of this.buttons) {
      const isOp = btn.id === 'op_toggle';
      this.button(btn, isOp);
    }

    // Dimension key labels, active highlight, and "mm" unit
    this.dimEntries().forEach(([key], i) => {
      const y = this.rowY(i);
      if (key === this.activeDimKey) {
        // Stronger background + left accent bar
        this.ctx.fillStyle = 'rgba(59,130,246,0.4)';
        this.ctx.fillRect(PAD, y - 2, this.cw - 2 * PAD, BH + 4);
        this.ctx.fillStyle = '#60a5fa';
        this.ctx.fillRect(PAD, y - 2, 4, BH + 4);
        this.text(key, PAD + 6, y + 8, 16, '#93c5fd');
      } else {
        this.text(key, PAD, y + 8, 16, '#94a3b8');
      }
      this.text('mm', PLUS_X + PLUS_W + 4, y + 9, 14, '#475569');
    });

    // Step indicator: 4 dots showing [1, 5, 10, 50] mm options
    if (this.dimEntries().length) {
      const dimHeaderY = 48 + STEP + PAD;
      const STEPS = [1, 5, 10, 50];
      const dotSize = 11;
      const dotGap = 5;
      const dotsW = STEPS.length * dotSize + (STEPS.length - 1) * dotGap;
      const dotY = dimHeaderY - 16;
      const dotsStartX = this.cw - PAD - dotsW;
      STEPS.forEach((s, i) => {
        const active = s === this.activeDimStep;
        const dx = dotsStartX + i * (dotSize + dotGap);
        this.ctx.fillStyle = active ? '#60a5fa' : '#1e293b';
        this.ctx.fillRect(dx, dotY, dotSize, dotSize);
        if (!active) {
          this.ctx.strokeStyle = '#334155';
          this.ctx.lineWidth = 1;
          this.ctx.strokeRect(dx, dotY, dotSize, dotSize);
        }
      });
      this.text(`${this.activeDimStep}mm`, dotsStartX - 6, dotY, 14, '#94a3b8', 'right');
    }

    // Position section header
    const posHeaderY = this.rowY(this.dimEntries().length) + PAD;
    this.text('position', PAD, posHeaderY, 14, '#64748b');

    (['x', 'z', 'y'] as const).forEach((axis, i) => {
      const y = this.posRowY(i);
      this.text(axis.toUpperCase(), PAD, y + 9, 16, '#94a3b8');
      this.text('mm', PLUS_X + PLUS_W + 4, y + 9, 14, '#475569');
    });

    // Rotation section header
    this.text('rotation', PAD, this.rotHeaderY(), 14, '#64748b');

    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      const y = this.rotRowY(i);
      this.text(axis.toUpperCase(), PAD, y + 9, 16, '#94a3b8');
    });

    // Joystick control legend
    const legendY = this.rotRowY(2) + BH + 24;
    this.ctx.strokeStyle = '#1e293b';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(PAD, legendY - 10);
    this.ctx.lineTo(this.cw - PAD, legendY - 10);
    this.ctx.stroke();
    this.text('controls', PAD, legendY, 12, '#475569');
    this.text('L ←→  cycle dim',  PAD, legendY + 18, 13, '#64748b');
    this.text('L ↑↓   step size', PAD, legendY + 36, 13, '#64748b');
    this.text('R ↑↓   resize',    PAD, legendY + 54, 13, '#64748b');
  }
}
