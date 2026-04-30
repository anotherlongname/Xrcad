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
 * Wrist menu attached to the left controller grip.
 * Lets the user spawn primitives, toggle solid/hole mode, and save/load.
 */
export class PrimitiveMenu extends VRPanel {
  private nextOp: CSGOperation = 'add';

  constructor(private readonly scene: CSGScene) {
    // 0.30m wide × 0.38m tall
    super(0.30, 0.38, 512);

    const row = (r: number) => PAD + 44 + r * (BH + PAD);

    // Primitive spawn buttons
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
      // Last lone button spans full width
      const isLast = i === prims.length - 1 && prims.length % 2 === 1;
      this.buttons.push({
        id: `prim_${type}`,
        label,
        x: col === 0 ? PAD : COL2,
        y: row(rowIdx),
        w: isLast ? BW * 2 + PAD : BW,
        h: BH,
        action: () => scene.addObject(type, this.nextOp),
      });
    });

    // Solid / Hole toggle
    const opRow = row(3);
    this.buttons.push(
      { id: 'solid', label: 'SOLID', x: PAD,  y: opRow, w: BW, h: BH, action: () => { this.nextOp = 'add';      this.dirty(); } },
      { id: 'hole',  label: 'HOLE',  x: COL2, y: opRow, w: BW, h: BH, action: () => { this.nextOp = 'subtract'; this.dirty(); } },
    );

    // Save / Load
    const ioRow = row(4);
    this.buttons.push(
      { id: 'save', label: 'SAVE', x: PAD,  y: ioRow, w: BW, h: BH, action: () => Exporter.save(scene) },
      { id: 'load', label: 'LOAD', x: COL2, y: ioRow, w: BW, h: BH, action: () => Importer.loadAutosave(scene) },
    );

    this.dirty();
  }

  protected draw(): void {
    this.background();
    this.text('XrCAD', this.cw / 2, 10, 26, '#93c5fd', 'center');

    for (const btn of this.buttons) {
      const isOpBtn = btn.id === 'solid' || btn.id === 'hole';
      const isActive =
        (btn.id === 'solid' && this.nextOp === 'add') ||
        (btn.id === 'hole' && this.nextOp === 'subtract');
      this.button(btn, isOpBtn && isActive);
    }
  }
}
