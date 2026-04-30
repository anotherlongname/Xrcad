import { VRPanel } from './VRPanel';
import { CSGObject, Dimensions } from '../csg/CSGObject';
import { CSGScene } from '../csg/CSGScene';

const PAD = 10;
const BH = 36;
const LABEL_W = 90;
const VAL_W = 72;
const BTN_W = 44;
const STEP = BH + PAD;

/**
 * Floating inspector panel that appears when an object is selected.
 * Shows type, operation toggle, per-dimension ±1mm controls, and a delete button.
 */
export class ObjectInspector extends VRPanel {
  private obj: CSGObject | null = null;

  constructor(private readonly scene: CSGScene) {
    super(0.28, 0.42, 512);
    this.visible = false;
  }

  inspect(obj: CSGObject | null): void {
    this.obj = obj;
    this.visible = obj !== null;
    this.rebuildButtons();
    if (obj) this.dirty();
  }

  private dimEntries(): [string, number][] {
    if (!this.obj) return [];
    return Object.entries(this.obj.dims).filter(([, v]) => v !== undefined) as [string, number][];
  }

  private rebuildButtons(): void {
    this.buttons = [];
    if (!this.obj) return;
    const obj = this.obj;

    // Operation toggle
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

    // Delete
    this.buttons.push({
      id: 'delete',
      label: 'DEL',
      x: PAD + 140, y: 48, w: 80, h: BH,
      action: () => {
        this.scene.removeObject(obj.id);
        this.inspect(null);
      },
    });

    // Dimension ± controls
    this.dimEntries().forEach(([key, _val], i) => {
      const y = 48 + STEP + PAD + i * STEP;
      const dims = obj.dims as Record<string, number>;

      this.buttons.push({
        id: `d_${key}_minus`,
        label: '−',
        x: LABEL_W, y, w: BTN_W, h: BH,
        action: () => {
          dims[key] = Math.max(1, (dims[key] ?? 1) - 1);
          obj.rebuildBrush();
          this.scene.compile();
          this.rebuildButtons();
          this.dirty();
        },
      });

      this.buttons.push({
        id: `d_${key}_plus`,
        label: '+',
        x: LABEL_W + BTN_W + VAL_W, y, w: BTN_W, h: BH,
        action: () => {
          dims[key] = (dims[key] ?? 1) + 1;
          obj.rebuildBrush();
          this.scene.compile();
          this.rebuildButtons();
          this.dirty();
        },
      });
    });
  }

  protected draw(): void {
    this.background();
    if (!this.obj) return;
    const obj = this.obj;

    this.text(obj.type.toUpperCase(), this.cw / 2, 10, 24, '#93c5fd', 'center');

    for (const btn of this.buttons) {
      const isOp = btn.id === 'op_toggle';
      this.button(btn, isOp);
    }

    // Dimension labels and values
    this.dimEntries().forEach(([key, val], i) => {
      const y = 48 + STEP + PAD + i * STEP;
      this.text(key, PAD, y + 8, 18, '#94a3b8');
      this.text(`${Math.round(val)}mm`, LABEL_W + BTN_W + 4, y + 9, 18, '#e0e8ff');
    });

    // Position
    const posY = 48 + STEP + PAD + this.dimEntries().length * STEP + PAD;
    this.text('position', PAD, posY, 16, '#94a3b8');
    this.text(
      `X ${Math.round(obj.position.x)}  Y ${Math.round(obj.position.y)}  Z ${Math.round(obj.position.z)} mm`,
      PAD, posY + 20, 16, '#e0e8ff',
    );
  }
}
