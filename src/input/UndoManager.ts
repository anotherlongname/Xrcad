import { XrcadFile } from '../io/FileFormat';
import { CSGScene } from '../csg/CSGScene';
import { Exporter } from '../io/Exporter';

const MAX_HISTORY = 50;

export class UndoManager {
  private history: XrcadFile[] = [];
  private cursor = -1;

  push(scene: CSGScene): void {
    this.history.splice(this.cursor + 1);
    this.history.push(Exporter.serialize(scene));
    if (this.history.length > MAX_HISTORY) this.history.shift();
    else this.cursor++;
  }

  undo(scene: CSGScene): boolean {
    if (this.cursor <= 0) return false;
    scene.loadFromFile(this.history[--this.cursor]);
    return true;
  }

  redo(scene: CSGScene): boolean {
    if (this.cursor >= this.history.length - 1) return false;
    scene.loadFromFile(this.history[++this.cursor]);
    return true;
  }

  canUndo(): boolean { return this.cursor > 0; }
  canRedo(): boolean { return this.cursor < this.history.length - 1; }

  /** Reset history to just the current scene state (call after loading a file). */
  reset(scene: CSGScene): void {
    this.history = [];
    this.cursor = -1;
    this.push(scene);
  }
}
