import { Box3, Matrix4, Vector3 } from 'three';

const bounds = new Box3(), propBounds = new Box3(), lightSpace = new Matrix4();

// Fit the shadow camera to the editable surface bounds.
export function fitMeshShadows(light, mesh, floorY = 0, props = null) {
  if (!mesh?.visible || !mesh.geometry.getAttribute('position')?.count) return;
  mesh.updateWorldMatrix(true, false); light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
  light.shadow.updateMatrices(light);
  const camera = light.shadow.camera;
  if (mesh.isSkinnedMesh) mesh.computeBoundingBox();
  else mesh.geometry.computeBoundingBox();
  lightSpace.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
  bounds.copy(mesh.isSkinnedMesh ? mesh.boundingBox : mesh.geometry.boundingBox).applyMatrix4(lightSpace);
  if(props)bounds.union(propBounds.setFromObject(props).applyMatrix4(camera.matrixWorldInverse));
  const padding = Math.max(0.25, bounds.getSize(mesh.position.clone()).length() * 0.03);
  if (light.isSpotLight) {
    camera.near = Math.max(0.05, -bounds.max.z - padding);
    // Keep the ground receiver in range as the object is thrown upward.
    // Its illuminated footprint is much larger than the mesh's own bounds.
    const floor = new Vector3(light.target.position.x, floorY, light.target.position.z).applyMatrix4(camera.matrixWorldInverse);
    camera.far = Math.max(camera.near + 1, -bounds.min.z + padding, -floor.z + light.position.y * 2 + 20);
    camera.updateProjectionMatrix();
    return;
  }
  Object.assign(camera, { left: bounds.min.x - padding, right: bounds.max.x + padding,
    bottom: bounds.min.y - padding, top: bounds.max.y + padding,
    near: Math.max(0.01, -bounds.max.z - padding), far: Math.max(0.02, -bounds.min.z + padding) });
  camera.far = Math.max(camera.far, camera.near + 0.1); camera.updateProjectionMatrix();
}
