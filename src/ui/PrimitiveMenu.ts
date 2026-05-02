import { VRPanel } from './VRPanel';
import { CSGScene } from '../csg/CSGScene';
import { CSGOperation, PrimitiveType } from '../csg/CSGObject';
import { Units } from '../units/Units';
import { Exporter } from '../io/Exporter';
import { Importer } from '../io/Importer';

const PAD  = 10;
const BW   = 148;
const BH   = 40;
const COL2 = PAD + BW + PAD;

export class PrimitiveMenu extends VRPanel {
  selectedType: PrimitiveType | null = null;
  nextOp: CSGOperation = 'add';
  private xrMode: 'immersive-vr' | 'immersive-ar' | null = null;

  constructor(
    private readonly scene: CSGScene,
    private readonly onShapeSelected: (type: PrimitiveType, op: CSGOperation) => void,
    private readonly onModeToggle: () => void,
  ) {
    // Slightly taller panel to accommodate scale + mode row
    super(0.30, 0.44, 512);

    const row = (r: number) => PAD + 44 + r * (BH + PAD);

    // ── Primitive buttons ───────────────────────────────────────────────────
    const prims: [PrimitiveType, string][] = [
      ['box', 'BOX'], ['sphere', 'SPHERE'], ['cylinder', 'CYLINDER'],
      ['cone', 'CONE'], ['torus', 'TORUS'],
    ];
    prims.forEach(([type, label], i) => {
      const col    = i % 2;
      const rowIdx = Math.floor(i / 2);
      const isLast = i === prims.length - 1 && prims.length % 2 === 1;
      this.buttons.push({
        id: `prim_${type}`, label,
        x: col === 0 ? PAD : COL2,
        y: row(rowIdx),
        w: isLast ? BW * 2 + PAD : BW,
        h: BH,
        action: () => this.selectType(type),
      });
    });

    // ── Solid / Hole toggle ─────────────────────────────────────────────────
    const opRow = row(3);
    this.buttons.push(
      { id: 'solid', label: 'SOLID', x: PAD,  y: opRow, w: BW, h: BH,
        action: () => { this.nextOp = 'add';      this.dirty(); } },
      { id: 'hole',  label: 'HOLE',  x: COL2, y: opRow, w: BW, h: BH,
        action: () => { this.nextOp = 'subtract'; this.dirty(); } },
    );

    // ── Save / Load ─────────────────────────────────────────────────────────
    const ioRow = row(4);
    this.buttons.push(
      { id: 'save', label: 'SAVE', x: PAD,  y: ioRow, w: BW, h: BH,
        action: () => Exporter.save(scene) },
      { id: 'load', label: 'LOAD', x: COL2, y: ioRow, w: BW, h: BH,
        action: () => Importer.loadAutosave(scene) },
    );

    // ── AR / VR toggle ──────────────────────────────────────────────────────
    // Shown as a half-width button so scale text has room beside it.
    this.buttons.push({
      id: 'mode_toggle',
      label: 'AR / VR',
      x: COL2, y: row(5), w: BW, h: BH,
      action: () => onModeToggle(),
    });

    this.visible = false;
    this.dirty();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  private selectType(type: PrimitiveType): void {
    this.selectedType = this.selectedType === type ? null : type;
    this.dirty();
    if (this.selectedType) this.onShapeSelected(this.selectedType, this.nextOp);
  }

  clearSelection(): void {
    this.selectedType = null;
    this.dirty();
  }

  /** Call when the XR session mode changes so the button label stays current. */
  setXRMode(mode: 'immersive-vr' | 'immersive-ar' | null): void {
    this.xrMode = mode;
    // Update toggle button label to show what the button will switch TO.
    const modeBtn = this.buttons.find(b => b.id === 'mode_toggle');
    if (modeBtn) {
      modeBtn.label = mode === 'immersive-ar' ? '→ VR' : '→ AR';
    }
    this.dirty();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  protected draw(): void {
    const modeLabel = this.xrMode === 'immersive-ar' ? 'AR' : 'VR';
    this.background();
    this.text(`XrCAD  [X] to close`, this.cw / 2, 10, 22, '#93c5fd', 'center');

    for (const btn of this.buttons) {
      const isPrimBtn = btn.id.startsWith('prim_');
      const isSelected = isPrimBtn && btn.id === `prim_${this.selectedType}`;
      const isOpBtn    = btn.id === 'solid' || btn.id === 'hole';
      const isActiveOp =
        (btn.id === 'solid' && this.nextOp === 'add') ||
        (btn.id === 'hole'  && this.nextOp === 'subtract');
      this.button(btn, isSelected || (isOpBtn && isActiveOp));
    }

    // ── Scale info (left of the mode toggle button) ─────────────────────────
    const scaleRow = PAD + 44 + 5 * (BH + PAD); // same y as row(5)
    const scale    = Units.workspaceScale;
    const scaleStr = Number.isInteger(scale) ? `${scale}×` : `${scale.toFixed(1)}×`;
    this.text('Scale', PAD, scaleRow + 4, 14, '#64748b');
    this.text(scaleStr, PAD, scaleRow + 20, 20, '#e0e8ff');

    // Current mode badge
    const modeColor = this.xrMode === 'immersive-ar' ? '#34d399' : '#93c5fd';
    this.text(modeLabel, PAD, scaleRow + 44, 14, modeColor);
  }
}
