import { blockSizes } from "./info-settings.js";
import { drawSoundIcon } from "./sound-icon.js";

// Flatten only for canvas layout; nested structure and links remain in saved Tiptap JSON.
export function canvasBlocks(doc, defaultAlign = "left") {
  const blocks = [];
  function walk(node, context = {}) {
    if (["paragraph", "heading", "codeBlock", "horizontalRule"].includes(node.type)) {
      const runs = (node.content || []).map(child => ({ text: child.type === "hardBreak" ? "\n" : child.text || "",
        ...(child.type === 'soundIcon' ? { icon: 'sound' } : {}),
        ...Object.fromEntries((child.marks || []).map(mark => [mark.type, true])) }));
      blocks.push({ type: node.type === "heading" ? `h${node.attrs.level}` : node.type === "codeBlock" ? "code" : node.type === "horizontalRule" ? "hr" : "p",
        align: node.attrs?.textAlign || defaultAlign, runs, ...context });
    } else if (["bulletList", "orderedList"].includes(node.type)) {
      let index = node.attrs?.start || 1;
      for (const item of node.content || []) {
        const prefix = node.type === "orderedList" ? `${index++}. ` : "• ";
        for (const [i, child] of (item.content || []).entries()) walk(child, { ...context, depth: (context.depth || 0) + 1, prefix: i === 0 ? prefix : "" });
      }
    } else {
      const next = node.type === "blockquote" ? { ...context, quote: true, depth: (context.depth || 0) + 1 } : context;
      for (const child of node.content || []) walk(child, next);
    }
  }
  walk(doc);
  return blocks;
}

export function drawRichText(context, document, definition) {
  const blocks = canvasBlocks(document, definition.align);
  const [x, y, width, height] = definition.box;
  const font = (size, run, heading) => `${run.italic ? "italic " : ""}${run.bold || heading ? "700 " : "400 "}${run.subscript || run.superscript ? size * 0.7 : size}px ${run.code ? "monospace" : "sans-serif"}`;
  function layout(scale) {
    return blocks.map((block, index) => {
      const size = blockSizes[block.type] * scale, heading = block.type.startsWith("h");
      const lineHeight = size * (block.type === 'h1' ? 1.05 : 1.3);
      // Enter splits a heading into blocks; keep adjacent H1s as close as
      // wrapped lines, while retaining separation before other text styles.
      const gap = block.type === 'h1' && blocks[index + 1]?.type === 'h1' ? 0 : size * 0.35;
      const prefix = block.prefix || "";
      const indent = size * ((block.depth || 0) * 1.2 + (prefix ? Math.max(1.1, prefix.length * 0.6) : 0));
      const lines = [{ parts: [], width: 0 }];
      for (const original of block.runs) {
        const run = { ...original, code: original.code || block.type === "code" };
        context.font = font(size, run, heading);
        if (run.icon === 'sound') {
          let line = lines.at(-1);
          if (line.width + size > width - indent && line.parts.length) { line = { parts: [], width: 0 }; lines.push(line); }
          line.parts.push({ ...run, width: size });line.width += size;
          continue;
        }
        for (const token of run.text.replace(/\r\n?/g, "\n").split(/(\n|[^\S\n]+|[^\s]+)/).filter(Boolean)) {
          if (token === "\n") { lines.push({ parts: [], width: 0 }); continue; }
          for (const text of context.measureText(token).width > width - indent ? Array.from(token) : [token]) {
            let line = lines.at(-1);
            const measured = context.measureText(text).width;
            if (line.width + measured > width - indent && line.parts.length) { line = { parts: [], width: 0 }; lines.push(line); }
            if (!line.parts.length && /^\s+$/.test(text) && block.type !== "code") continue;
            line.parts.push({ ...run, text, width: measured }); line.width += measured;
          }
        }
      }
      return { block, size, heading, prefix, indent, lines, lineHeight, gap, height: lines.length * lineHeight + gap };
    });
  }
  let scale = 1, laid = layout(scale);
  while (laid.reduce((sum, b) => sum + b.height, 0) > height && scale > 0.015) { scale *= 0.9; laid = layout(scale); }
  const total = laid.reduce((sum, b) => sum + b.height, 0);
  let top = definition.bottom ? y + height - total : y;
  const bounds = { x, y: top, width, height: total };
  context.save(); context.beginPath(); context.rect(x, y, width, height); context.clip();
  context.textAlign = "left"; context.textBaseline = "top";
  for (const item of laid) {
    if (item.block.type === "hr") { context.fillRect(x, top + item.size * 0.65, width, Math.max(1, item.size / 20)); top += item.height; continue; }
    if (item.block.quote) context.fillRect(x, top, Math.max(1, item.size / 12), item.height - item.gap);
    for (let i = 0; i < item.lines.length; i++) {
      const line = item.lines[i], lineWidth = line.width + item.indent;
      let left = x + (item.block.align === "right" ? width - lineWidth : item.block.align === "center" ? (width - lineWidth) / 2 : 0);
      if (i === 0 && item.prefix) { context.font = font(item.size, {}, false); context.fillText(item.prefix, left + item.indent - item.size * Math.max(1.1, item.prefix.length * 0.6), top); }
      left += item.indent;
      const spaces = line.parts.filter(p => /^\s+$/.test(p.text)).length;
      const extra = item.block.align === "justify" && i < item.lines.length - 1 && spaces ? (width - lineWidth) / spaces : 0;
      for (const part of line.parts) {
        context.font = font(item.size, part, item.heading);
        const baseline = top + (part.subscript ? item.size * 0.35 : part.superscript ? -item.size * 0.12 : 0);
        if (part.highlight) { context.save(); context.globalAlpha = 0.2; context.fillRect(left, top, part.width, item.size * 1.15); context.restore(); }
        if (part.icon === 'sound') drawSoundIcon(context, left, baseline, item.size);
        else context.fillText(part.text, left, baseline);
        if (part.strike) context.fillRect(left, top + item.size * 0.5, part.width, Math.max(1, item.size / 18));
        if (part.underline || part.link) context.fillRect(left, top + item.size, part.width, Math.max(1, item.size / 18));
        left += part.width + (/^\s+$/.test(part.text) ? extra : 0);
      }
      top += item.lineHeight;
    }
    top += item.gap;
  }
  context.restore();
  return bounds;
}
