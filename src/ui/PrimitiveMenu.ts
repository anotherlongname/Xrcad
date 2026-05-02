import { VRPanel } from './VRPanel';
import { CSGScene } from '../csg/CSGScene';
import { CSGOperation, PrimitiveType } from '../csg/CSGObject';
import { Exporter } from '../io/Exporter';
import { Importer } from '../io/Importer';

const PAD = 10;
const BW = 148;
const BH = 40;
const COL2 = PAD + BW + PAD;

/**
 * Floating menu for selecting which primitive type to place next.
 * Clicking a primitive button highlights it and fires onShapeSelected —
 * it does NOT immediately spawn anything. Placement is handled by SelectionManager.
 * Summon/dismiss with the X button on the left controller (wired in SceneManager).
 */
export class PrimitiveMenu extends VRPanel {
  selectedType: PrimitiveType | null = null;
  nextOp: CSGOperation = 'add';

  constructor(
    private readonly scene: CSGScene,
    private readonly onShapeSelected: (type: PrimitiveType, op: CSGOperation) => void,
  ) {
    super(0.30, 0.38, 512);

    const row = (r: number) => PAD + 44 + r * (BH + PAD);

    const prims: [PrimitiveType, string][] = [
      ['box', 'BOX'],
      ['sphere', 'SPHERE'],
      ['cylinder', 'CYLINDER'],
      ['cone', 'CONE'],
      ['torus', 'TORUS'],
    ];

    prims.forEach(([type, label], i) => {
      const col = i % 2;
      const rowIdx = Math.floor(i / 2);
      const isLast = i === prims.length - 1 && prims.length % 2 === 1;
      this.buttons.push({
        id: `prim_${type}`,
        label,
        x: col === 0 ? PAD : COL2,
        y: row(rowIdx),
        w: isLast ? BW * 2 + PAD : BW,
        h: BH,
        action: () => this.selectType(type),
      });
    });

    // Solid / Hole toggle
    const opRow = row(3);
    this.buttons.push(
      { id: 'solid', label: 'SOLID', x: PAD,  y: opRow, w: BW, h: BH,
        action: () => { this.nextOp = 'add';      this.dirty(); } },
      { id: 'hole',  label: 'HOLE',  x: COL2, y: opRow, w: BW, h: BH,
        action: () => { this.nextOp = 'subtract'; this.dirty(); } },
    );

    // Save / Load
    const ioRow = row(4);
    this.buttons.push(
      { id: 'save', label: 'SAVE', x: PAD,  y: ioRow, w: BW, h: BH,
        action: () => Exporter.save(scene) },
      { id: 'load', label: 'LOAD', x: COL2, y: ioRow, w: BW, h: BH,
        action: () => Importer.loadAutosave(scene) },
    );

    this.visible = false;
    this.dirty();
  }

  private selectType(type: PrimitiveType): void {
    // Toggle off if already selected
    this.selectedType = this.selectedType === type ? null : type;
    this.dirty();
    if (this.selectedType) {
      this.onShapeSelected(this.selectedType, this.nextOp);
    }
  }

  /** Called by SelectionManager after a shape is successfully placed. */
  clearSelection(): void {
    this.selectedType = null;
    this.dirty();
  }

  protected draw(): void {
    this.background();
    this.text('XrCAD  [X] to close', this.cw / 2, 10, 22, '#93c5fd', 'center');

    for (const btn of this.buttons) {
      const isPrimBtn = btn.id.startsWith('prim_');
      const isSelected = isPrimBtn && btn.id === `prim_${this.selectedType}`;
      const isOpBtn = btn.id === 'solid' || btn.id === 'hole';
      const isActiveOp =
        (btn.id === 'solid' && this.nextOp === 'add') ||
        (btn.id === 'hole'  && this.nextOp === 'subtract');
      this.button(btn, isSelected || (isOpBtn && isActiveOp));
    }
  }
}
