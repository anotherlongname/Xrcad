# XrCAD

A web-based VR CAD tool for the Meta Quest 3, inspired by TinkerCAD. Build 3D objects by combining primitive shapes with additive and subtractive boolean operations, using real millimetre measurements, from inside VR.

## Tech stack

- **Vite** — build tool and dev server
- **Three.js** — 3D rendering and WebXR session management
- **three-bvh-csg** — fast constructive solid geometry (boolean operations)
- **TypeScript** — throughout

## Getting started

```bash
npm install
npm run dev
```

Vite will print a local HTTPS URL (e.g. `https://192.168.x.x:5173`).  
Open that address in the Quest 3 browser, accept the self-signed certificate warning, and press **Enter VR**.

> HTTPS is required for WebXR. On desktop you can use a [WebXR emulator extension](https://github.com/MozillaReality/WebXR-emulator-extension) and browse `https://localhost:5173`.

## Controls (Quest 3)

| Action | Input |
|---|---|
| Open wrist menu | Look at left hand |
| Spawn primitive | Point right ray at button, press **right trigger** |
| Select object | Point ray at object, press **right trigger** |
| Drag object | Hold **right trigger** on object, move hand |
| Edit dimensions | Select object → use **+/−** in inspector panel |
| Toggle solid/hole | Select object → press **SOLID/HOLE** in inspector |
| Delete object | Select object → press **DEL** in inspector |
| Scale workspace | Hold **both grips**, move hands apart/together |
| Save | Wrist menu → **SAVE** (saves to localStorage + downloads file) |
| Load | Wrist menu → **LOAD** (loads last localStorage save) |

## Desktop keyboard shortcuts (2D testing)

| Key | Action |
|---|---|
| `b` | Spawn box |
| `c` | Spawn cylinder |
| `s` | Spawn sphere |
| `h` | Toggle last object solid/hole |
| `Ctrl+S` | Save |

## Units & scale

All dimensions are stored in **millimetres**. Internally, 1 Three.js unit = 1 metre (WebXR standard), so measurements are converted at render time:

```
scene_metres = mm / 1000 × workspaceScale
```

The default workspace scale is **10×** — a 10 mm part appears 10 cm in VR, comfortable to interact with. Gripping with both hands and moving them apart/together adjusts this live.

At **1× scale** the virtual object matches its real-world size exactly — useful for final inspection.

## File format

Designs are saved as `.xrcad` files (JSON). Only the *intent* (primitive type, dimensions, position, operation) is stored — the CSG mesh is recomputed on load.

```json
{
  "version": 1,
  "workspaceScale": 10,
  "objects": [
    {
      "id": "…",
      "type": "box",
      "operation": "add",
      "dims": { "width": 30, "height": 20, "depth": 40 },
      "position": { "x": 0, "y": 10, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 }
    },
    {
      "id": "…",
      "type": "cylinder",
      "operation": "subtract",
      "dims": { "radiusTop": 5, "radiusBottom": 5, "height": 25 },
      "position": { "x": 0, "y": 10, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 }
    }
  ]
}
```

## Primitives

| Shape | Dimensions |
|---|---|
| Box | width, height, depth (mm) |
| Sphere | radius (mm) |
| Cylinder | radiusTop, radiusBottom, height (mm) |
| Cone | radius, height (mm) |
| Torus | radius, tube (mm) |

## Project structure

```
src/
├── main.ts                  Entry point
├── units/Units.ts           mm ↔ scene-metre conversion + workspace scale
├── scene/
│   ├── SceneManager.ts      Three.js scene, lighting, XR session, update loop
│   └── WorkspaceGrid.ts     Reference grid (10mm minor / 100mm major lines)
├── csg/
│   ├── CSGObject.ts         Primitive data model + Brush builder
│   └── CSGScene.ts          Manages object list, CSG evaluation, edit mode
├── input/
│   ├── ControllerState.ts   Per-frame controller button/axis snapshot
│   ├── SelectionManager.ts  Ray-cast selection and drag
│   └── WorkspaceScaler.ts   Two-grip pinch to scale workspace
├── ui/
│   ├── VRPanel.ts           Canvas-texture floating panel base class
│   ├── PrimitiveMenu.ts     Wrist menu: spawn primitives, save/load
│   └── ObjectInspector.ts   Per-object dimension and operation editor
└── io/
    ├── FileFormat.ts        TypeScript types for .xrcad JSON
    ├── Exporter.ts          Serialize + download
    └── Importer.ts          Parse + apply (localStorage or file picker)
```
