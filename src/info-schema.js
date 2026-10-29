import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Highlight from "@tiptap/extension-highlight";
import { Node } from "@tiptap/core";
import { soundIconPath } from "./sound-icon.js";

const SoundIcon = Node.create({
  name: 'soundIcon', inline: true, group: 'inline', atom: true,
  parseHTML: () => [{ tag: 'span[data-info-icon="sound"]' }],
  renderHTML: () => ['span', { 'data-info-icon': 'sound', role: 'img', 'aria-label': 'Sound', contenteditable: 'false' },
    ['svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', width: '1em', height: '1em', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.25', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
      ['path', { d: soundIconPath }]]],
});

export function infoExtensions(align = "left") {
  return [StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: { openOnClick: false, defaultProtocol: "https" },
    trailingNode: false,
  }), TextAlign.configure({ types: ["heading", "paragraph"], defaultAlignment: align }),
  Subscript, Superscript, Highlight, SoundIcon];
}
