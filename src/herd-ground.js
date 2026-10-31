import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';

export const GROUND_Y = 0;

export function createHerdGround(scene, physics, settings) {
  const material = new MeshStandardMaterial({ color: settings.color, roughness: settings.roughness, metalness: 0 });
  const mesh = new Mesh(new PlaneGeometry(2000, 2000), material);
  mesh.name = 'Herd ground'; mesh.rotation.x = -Math.PI / 2; mesh.position.y = GROUND_Y;
  mesh.receiveShadow = true; mesh.layers.enable(1); scene.add(mesh);
  const entry = physics.addBody({ body: { type: 'static', position: { x: 0, y: GROUND_Y - .5, z: 0 } },
    shapes: [{ type: 'box', halfExtents: { x: 1000, y: .5, z: 1000 } }] });
  return { mesh, entry,
    configure(value) { material.color.set(value.color); material.roughness = value.roughness; },
    dispose() { physics.removeBody(entry); mesh.removeFromParent(); mesh.geometry.dispose(); material.dispose(); },
  };
}
