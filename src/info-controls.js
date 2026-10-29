import { thumbnailControlsMarkup } from "./thumbnail-controls.js";
import { Editor } from "@tiptap/core";
import { defaultInfo, infoFields, validateInfo } from "./info-settings.js";
import { infoExtensions } from "./info-schema.js";

const commands = [
  ["toggleBold", "B", "Bold", "bold"], ["toggleItalic", "I", "Italic", "italic"],
  ["toggleUnderline", "U", "Underline", "underline"], ["toggleStrike", "S̶", "Strikethrough", "strike"],
  ["toggleBulletList", "• List", "Bulleted list", "bulletList"], ["toggleOrderedList", "1. List", "Numbered list", "orderedList"],
  ["toggleBlockquote", "❞", "Block quote", "blockquote"], ["toggleCode", "&lt;/&gt;", "Inline code", "code"],
  ["toggleSubscript", "x₂", "Subscript", "subscript"], ["toggleSuperscript", "x²", "Superscript", "superscript"],
  ["toggleHighlight", "Mark", "Highlight", "highlight"], ["link", "Link", "Edit link", "link"],
  ["setHorizontalRule", "—", "Horizontal rule"], ["indent", "→", "Indent list"], ["outdent", "←", "Outdent list"],
  ["soundIcon", "Sound icon", "Insert sound icon"],
  ["clear", "Clear", "Clear formatting"], ["undo", "↶", "Undo"], ["redo", "↷", "Redo"],
];
export function infoControlsMarkup() {
  return (import.meta.env?.DEV ? thumbnailControlsMarkup() : '') + `<p class="camera-hint">Rich text for each corner. Text wraps and fits automatically. Links render as underlined text on the info plane.</p>` + infoFields.map(({ key, label }) => `
    <div class="info-field">
      <label id="info-label-${key}">${label}</label>
      <div class="rich-toolbar" role="toolbar" aria-label="${label} formatting">
        <select data-editor="${key}" data-format="block" aria-label="${label} block style">
          <option value="p">Paragraph</option>${[1, 2, 3, 4, 5, 6].map(n => `<option value="h${n}">Heading ${n}</option>`).join("")}<option value="codeBlock">Code block</option>
        </select>
        <select data-editor="${key}" data-format="align" aria-label="${label} block alignment">
          ${["left", "center", "right", "justify"].map(a => `<option value="${a}">${a[0].toUpperCase() + a.slice(1)}</option>`).join("")}
        </select>
        ${commands.map(([command, text, title]) => `<button type="button" data-editor="${key}" data-command="${command}" aria-label="${title}" title="${title}">${text}</button>`).join("")}
      </div>
      <div class="rich-link" data-link="${key}" hidden><input type="url" aria-label="${label} link URL" placeholder="https://…"><button type="button" data-apply-link="${key}">Apply</button><button type="button" data-remove-link="${key}">Unlink</button></div>
      <div id="info-${key}" class="rich-editor"></div>
    </div>`).join("");
}
export function bindInfoControls(root, onChange, onError) {
  const editors = {};
  function get() { return validateInfo(Object.fromEntries(infoFields.map(({ key }) => [key, editors[key].getJSON()]))); }
  function changed() { try { onChange(get()); } catch (error) { onError(error.message); } }
  function updateToolbar(key) {
    const editor = editors[key];
    if (!editor) return;
    root.querySelector(`[data-editor="${key}"][data-format="block"]`).value = editor.isActive("heading") ? `h${editor.getAttributes("heading").level}` : editor.isActive("codeBlock") ? "codeBlock" : "p";
    root.querySelector(`[data-editor="${key}"][data-format="align"]`).value = editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph").textAlign || infoFields.find(f => f.key === key).align;
    for (const [command, , , active] of commands) {
      if (active) root.querySelector(`[data-editor="${key}"][data-command="${command}"]`).setAttribute("aria-pressed", String(editor.isActive(active)));
    }
  }
  const defaults = defaultInfo();
  for (const { key, align } of infoFields) {
    editors[key] = new Editor({
      element: root.querySelector(`#info-${key}`), extensions: infoExtensions(align), content: defaults[key],
      editorProps: { attributes: { role: "textbox", "aria-multiline": "true", "aria-labelledby": `info-label-${key}`, spellcheck: "true" } },
      onUpdate: () => { updateToolbar(key); changed(); }, onSelectionUpdate: () => updateToolbar(key),
    });
    const link = root.querySelector(`[data-link="${key}"]`);
    root.querySelector(`[data-apply-link="${key}"]`).addEventListener("click", () => {
      const href = link.querySelector("input").value.trim();
      if (!/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) { onError("Use an https, http, mailto, tel, or anchor link."); return; }
      editors[key].chain().focus(undefined, { scrollIntoView: false }).extendMarkRange("link").setLink({ href }).run(); link.hidden = true;
    });
    root.querySelector(`[data-remove-link="${key}"]`).addEventListener("click", () => {
      editors[key].chain().focus(undefined, { scrollIntoView: false }).extendMarkRange("link").unsetLink().run(); link.hidden = true;
    });
  }
  for (const control of root.querySelectorAll("[data-editor]")) {
    if (control.tagName === "BUTTON") control.addEventListener("mousedown", event => event.preventDefault());
    control.addEventListener(control.tagName === "BUTTON" ? "click" : "change", () => {
      const key = control.dataset.editor, editor = editors[key], value = control.value;
      const chain = editor.chain().focus(undefined, { scrollIntoView: false });
      if (control.dataset.format === "block") {
        if (value.startsWith("h")) chain.setHeading({ level: Number(value[1]) }).run();
        else if (value === "codeBlock") chain.setCodeBlock().run();
        else chain.setParagraph().run();
      } else if (control.dataset.format === "align") chain.setTextAlign(value).run();
      else {
        const command = control.dataset.command;
        if (command === "link") {
          const field = root.querySelector(`[data-link="${key}"]`); field.hidden = !field.hidden;
          field.querySelector("input").value = editor.getAttributes("link").href || "";
          if (!field.hidden) field.querySelector("input").focus({ preventScroll: true });
        } else if (command === "soundIcon") chain.insertContent({ type: 'soundIcon' }).run();
        else if (command === "clear") chain.clearNodes().unsetAllMarks().run();
        else if (command === "indent") chain.sinkListItem("listItem").run();
        else if (command === "outdent") chain.liftListItem("listItem").run();
        else chain[command]().run();
      }
      updateToolbar(key);
    });
  }
  return { get, editors,
    set(info) { for (const { key } of infoFields) { editors[key].commands.setContent(info[key], { emitUpdate: false }); updateToolbar(key); } },
    setDisabled(disabled) { for (const editor of Object.values(editors)) editor.setEditable(!disabled, false); },
    dispose() { for (const editor of Object.values(editors)) editor.destroy(); },
  };
}
