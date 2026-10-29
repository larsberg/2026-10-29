# 2026-10-29

Copied from `../2026-10-22` as the foundation for the new sketch.

Run in the visible VS Code terminal:

```sh
cd /Users/lars_berg/Documents/sketches/2026-10-29
pnpm dev
```

The fixed dev URL is `http://127.0.0.1:1234/`. Press **H** for the existing controls. `pnpm check` runs silent Node tests and the production build. Reuse the shared VS Code browser tab for visual checks.

The scene starts with seven randomly sized, positioned and rotated boxes combined using [Manifold](https://manifoldcad.org/docs/jsapi/documents/Using_Manifold.html) CSG. **Mesh → Box union → Box spread** scales their center spacing from 0× to 4× while preserving seeded sizes and rotations; 1× is the original spacing and 2× is the saved doubled spacing. Changing spread rebuilds the CSG surface, operation layers, colliders, joints, and skin binding. The union's bounds are centered at the origin, with the same centering applied to the source box poses. `src/box-union.js` converts the result into shared polygon vertices and triangle faces for the existing mesh operations, surface material and wireframe. Interior overlapping faces are removed by the union.

**Mesh → New variation** changes the saved random seed and regenerates all seven boxes. Reload and Reset reproduce the saved seed and spread. The saved pipeline runs Triangulate → Dialate → Hexelate → Smooth. Smoothing uses four passes at 0.5 strength; each layer remains adjustable in the existing drawer, and manual operations retain Undo. The union is cached by seed and spread, so resizing or changing operation layers does not repeat the CSG calculation.

`src/box-rig.js` binds the processed surface as a Three.js `SkinnedMesh` to seven bones. Seven dynamic Box3D boxes use the exact source dimensions and poses. Spherical joints form a tree within each overlapping cluster, preferring the largest overlaps, with anchors inside both boxes, 30° cone/twist limits, and damped 2 Hz rotation springs. Only actual intersections in the generated layout create connections: separated clusters remain unconnected, and isolated boxes have no joints. Changing spread or seed recalculates these connections. Internal box contacts are filtered because the source boxes intentionally overlap; outside objects can still collide with them. Four normalized influences per vertex blend by distance to the oriented boxes. The GPU skins the surface while matching CPU deformation updates the polygon wireframe, polygon-normal texture, camera target, and shadow bounds. Editing, Undo, Reset, and regeneration rebuild and rebind the rig without accumulating physics objects.

Drag a box with the primary pointer to grab it at the hit point, then release to let it go. A temporary Box3D motor joint pulls that point toward the pointer on a plane facing the camera, allowing the body to rotate and the connected cluster to follow. The picker tests the actual oriented source boxes at their current physics poses. Drag empty space to orbit. Camera follow freezes during a grab. Pointer release/cancel, lost capture, focus loss, Pause, Reset, mesh edits, and disposal release the grab and restore orbit controls. The pointer routing is reused from `../2026-10-16/src/collider-drag.js`.

**Mesh → Physics → Show colliders** displays green box-edge outlines through the surface at the actual physics poses. It is enabled in the saved setup, works with surface/wireframe visibility off, and changes visibility without resetting the simulation. Spread and collider visibility both use the existing Save/Reload workflow.

The wall plane generator, its controls, and its saved settings are removed. Loading older saves drops the wall fields. The café model remains in `src/cafe-setting.js` for reuse. The custom softbody solver, pin-noise coupling, Cannon solver, ground mesh and collider, and floor camera restriction are removed.

`src/physics.js` initializes `box3d-wasm/standard` 0.2.0, uses fixed 1/120-second steps, and follows play/pause, reset and focus suspension. `window.__meshSketch.physics` exposes the world and managed `addBody({object, body, shapes})` bindings. Shapes accept `type: 'box' | 'sphere' | 'capsule' | 'hull'` plus Box3D options. `window.__meshSketch.mesh.rig` exposes the bones, bodies, joints, weights, and deformed positions. Gravity is saved at zero for a floating cluster; the existing gravity and friction controls remain. No invisible floor is installed.

Strudel, the scheduler, instruments and audio recording hooks remain. No score or musical lighting/noise mapping is loaded; audio starts off and remains silent until a new pattern is supplied through `window.__meshSketch.audio.setPattern(pattern)`. The previous compositions and their render script are removed.

The drawer, tabs, materials, studio lighting, camera, editable scene text, thumbnail capture, recording, player bridge and Save/Reload workflow are retained. No new HTML overlays are introduced. The remaining tuned settings are copied into `public/setup.json` with the new sketch identity. In development Save writes that file; production saves remain isolated by sketch URL. The inherited publishing scripts target the new identity; nothing has been published. The thumbnail is a blank placeholder until captured from the new scene.
