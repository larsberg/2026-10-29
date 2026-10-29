import { getSchema } from "@tiptap/core";
import { infoExtensions } from "./info-schema.js";
import { meshInfo } from "./mesh-info.js";


export const infoFields = [
  { key: "upperLeft", label: "Upper left", align: "left", box: [176, 176, 2048 * 2 / 3, 650] },
  { key: "upperRight", label: "Upper right", align: "right", box: [1072, 176, 800, 650] },
  { key: "lowerLeft", label: "Lower left", align: "left", box: [176, 1222, 800, 650], bottom: true },
  { key: "lowerRight", label: "Lower right", align: "right", box: [1072, 1222, 800, 650], bottom: true },
];
export const blockSizes = { h1: 160, h2: 96, h3: 64, h4: 52, h5: 44, h6: 38, p: 34, ul: 34, ol: 34, code: 32, hr: 34 };
export function defaultInfo() {
  return validateInfo(meshInfo);
}
export function validateLegacyInfo(value) {
  return Object.fromEntries(infoFields.map(({ key }) => {
    const blocks = value?.[key];
    if (!Array.isArray(blocks) || blocks.length > 64) throw new Error(`Invalid rich text for ${key}.`);
    let length = 0, runCount = 0;
    const result = blocks.map(field => {
      if (!field || !Object.hasOwn(blockSizes, field.type) || !["left", "center", "right"].includes(field.align) || !Array.isArray(field.runs))
        throw new Error(`Invalid block in ${key}.`);
      const runs = field.runs.map(run => {
        if (!run || typeof run.text !== "string" || ["bold", "italic", "underline"].some(mark => typeof run[mark] !== "boolean"))
          throw new Error(`Invalid formatting in ${key}.`);
        length += run.text.length; runCount++;
        return { text: run.text, bold: run.bold, italic: run.italic, underline: run.underline };
      });
      return { type: field.type, align: field.align, runs };
    });
    const maxRuns = key === "upperLeft" ? 256 : 128;
    if (length > 2000 || runCount > maxRuns) throw new Error(`${key} allows 2,000 characters and ${maxRuns} formatting runs.`);
    return [key, result];
  }));
}
export function migrateInfo(value) {
  const legacy = (key, type) => {
    const field = value?.[key];
    if (!field) throw new Error(`Missing info field ${key}.`);
    return { type, align: field.align, runs: field.runs };
  };
  return migrateBlocks(validateLegacyInfo({
    upperLeft: [legacy("byline", "p"), legacy("title", "h1")],
    upperRight: [legacy("description", "p")],
    lowerLeft: [legacy("drag", "p")], lowerRight: [legacy("joints", "p")],
  }));
}

export function migrateBlocks(value) {
  return Object.fromEntries(infoFields.map(({ key }) => {
    const content = [];
    let list;
    for (const block of value[key]) {
      const inline = block.runs.flatMap(run => run.text.split("\n").flatMap((text, index) => [
        ...(index ? [{ type: "hardBreak" }] : []),
        ...(text ? [{ type: "text", text, marks: ["bold", "italic", "underline"].filter(mark => run[mark]).map(type => ({ type })) }] : []),
      ]));
      const node = { type: block.type.startsWith("h") ? "heading" : "paragraph",
        attrs: { textAlign: block.align, ...(block.type.startsWith("h") ? { level: Number(block.type[1]) } : {}) }, content: inline };
      if (["ul", "ol"].includes(block.type)) {
        const type = block.type === "ul" ? "bulletList" : "orderedList";
        if (list?.type !== type) { list = { type, content: [] }; content.push(list); }
        list.content.push({ type: "listItem", content: [node] });
      } else { list = null; content.push(node); }
    }
    return [key, { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }];
  }));
}

const schemas = new Map();
export function validateInfo(value) {
  return Object.fromEntries(infoFields.map(({ key, align }) => {
    const doc = value?.[key];
    let count = 0, characters = 0;
    function check(node, depth = 0) {
      if (!node || typeof node !== "object" || ++count > 1024 || depth > 12) throw new Error(`Invalid rich text in ${key}.`);
      if (node.text !== undefined) {
        if (typeof node.text !== "string") throw new Error("Invalid text.");
        characters += node.text.length;
      }
      if (node.type === "heading" && ![1, 2, 3, 4, 5, 6].includes(node.attrs?.level)) throw new Error("Invalid heading level.");
      if (node.attrs?.textAlign != null && !["left", "center", "right", "justify"].includes(node.attrs.textAlign)) throw new Error("Invalid text alignment.");
      if (node.type === "orderedList" && node.attrs?.start !== undefined && (!Number.isInteger(node.attrs.start) || node.attrs.start < 1 || node.attrs.start > 9999)) throw new Error("Invalid list start.");
      for (const mark of node.marks || []) {
        if (mark.type === "link" && (typeof mark.attrs?.href !== "string" || !/^(https?:\/\/|mailto:|tel:|#)/i.test(mark.attrs.href))) throw new Error("Use an https, http, mailto, tel, or anchor link.");
      }
      if (node.content !== undefined && !Array.isArray(node.content)) throw new Error("Invalid content.");
      for (const child of node.content || []) check(child, depth + 1);
    }
    check(doc);
    if (doc.type !== "doc" || characters > 2000) throw new Error(`${key} allows 2,000 characters.`);
    if (!schemas.has(align)) schemas.set(align, getSchema(infoExtensions(align)));
    const schema = schemas.get(align);
    const parsed = schema.nodeFromJSON(doc);
    parsed.check();
    return [key, structuredClone(parsed.toJSON())];
  }));
}
