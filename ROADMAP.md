# Roadmap

Known features and improvements to add, roughly in priority order.

## Interaction

- **Y-axis drag** — thumbstick up/down while holding an object to raise/lower it
- **Snap to grid** — configurable step size (1mm, 5mm, 10mm) while dragging
- **Rotation** — thumbstick left/right (or two-finger twist gesture) to rotate selected object in 45° steps
- **Duplicate** — button in inspector to clone the selected object
- **Undo/redo** — simple command stack, B button to undo

## Editing

- **Per-axis dimension editing** — currently ±1mm per tap; add hold-to-repeat and larger step (10mm) for faster adjustment
- **Object locking** — lock an object in place so it can't be accidentally moved
- **Group/ungroup** — combine multiple objects into a named group
- **Mirror** — reflect object across X/Z/Y axis

## Primitives

- **Wedge / roof shape**
- **Text (extruded)** — useful for labels and nameplates
- **Import STL** — bring in external geometry as a solid or hole

## Export

- **Export to STL** — for 3D printing
- **Export to OBJ/GLB** — for use in other tools
- **Export preview** — show bounding box and real-world dimensions before export

## UI

- **Scale HUD** — persistent indicator showing current workspace scale (e.g. `10×  1mm = 10mm`)
- **Object list panel** — scrollable list of all objects in the scene with visibility toggles
- **Colour picker** — per-object colour for visual organisation (not exported, cosmetic only)
- **Measurement tool** — point at two surfaces to read the distance in mm

## Technical

- **Incremental CSG recompile** — only re-evaluate the part of the tree that changed, not the full chain
- **Worker-thread CSG** — offload `Evaluator.evaluate` to a Web Worker to avoid frame drops on complex scenes
- **Autosave on change** — debounced localStorage write after every edit (currently only on explicit Save)
- **Scene versioning** — append a timestamp to localStorage key so multiple autosaves are kept
