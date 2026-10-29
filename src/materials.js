import * as THREE from "three";
import { defaultInfo, infoFields } from "./info-settings.js";
import { drawRichText } from "./rich-text.js";
import { config } from "./config.js";

const TEXT_CANVAS_SIZE = 2048, TEXT_FRAME_INSET = 128;
const TEXT_FRAME_SIZE = TEXT_CANVAS_SIZE - 2 * TEXT_FRAME_INSET;

export function createTextProp(anisotropy, resolution = 2048) {
  function createMap(size, filtering) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = filtering;
    return texture;
  }
  let map = createMap(resolution, anisotropy);
  let info = defaultInfo();
  function redraw() {
    const context = map.image.getContext("2d");
    // Keep the existing text layout in its original 2048-unit coordinate space.
    const scale = map.image.width / TEXT_CANVAS_SIZE;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, TEXT_CANVAS_SIZE, TEXT_CANVAS_SIZE);
    context.fillStyle = context.strokeStyle = "#ffffff";
    context.lineWidth = 6;
    context.strokeRect(TEXT_FRAME_INSET, TEXT_FRAME_INSET, TEXT_FRAME_SIZE, TEXT_FRAME_SIZE);
    for (const definition of infoFields) drawRichText(context, info[definition.key], definition);
    map.needsUpdate = true;
  }
  redraw();
  const material = new THREE.MeshStandardMaterial({
    color: "#000000",
    map,
    roughness: 1,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(config.textSize, config.textSize), material);
  mesh.name = "Text prop";
  mesh.position.set(0, 0, -1);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return {
    mesh,
    material,
    alignToTiles(tileSize, { size, column, row }) {
      // Align the visible frame, accounting for transparent texture margins.
      // Uniform X/Y scaling preserves the proportions of the rich text.
      const scale = size * tileSize / (config.textSize * TEXT_FRAME_SIZE / TEXT_CANVAS_SIZE);
      mesh.scale.set(scale, scale, 1);
      // Tile centers, rather than grout intersections, lie on the world origin.
      mesh.position.x = (column + size / 2 - 0.5) * tileSize;
      mesh.position.z = (row + size / 2 - 0.5) * tileSize;
    },
    setTextureQuality(size, filtering) {
      if (map.image.width === size && map.anisotropy === filtering) return;
      const previous = map;
      map = createMap(size, filtering);
      redraw();
      material.map = map;
      previous.dispose();
    },
    setInfo(value) {
      info = value;
      redraw();
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}
