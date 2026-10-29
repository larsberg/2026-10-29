// Shared vector artwork for the info editor and the scene's canvas texture.
export const soundIconPath = 'M11 5 6 9H3v6h3l5 4Z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14';
let path;
export function drawSoundIcon(context, x, y, size) {
  path ??= new Path2D(soundIconPath);
  context.save();
  context.translate(x, y);context.scale(size / 24, size / 24);
  context.strokeStyle = context.fillStyle;
  context.lineWidth = 1.25;context.lineCap = 'round';context.lineJoin = 'round';
  context.stroke(path);
  context.restore();
}
