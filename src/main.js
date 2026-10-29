import "./mobile-canvas.css";
import { mountMesh } from "./mesh-sketch.js";
import { attachPlayerBridge } from "./player-bridge.js";

const params = new URLSearchParams(location.search);
if (window.top === window && params.get("embed") !== "1") {
  document.documentElement.dataset.mobileCanvas = "";
  // Let the opening swipe scroll the page, then return gestures to the sketch.
  const syncCanvasGesture = () => document.documentElement.toggleAttribute('data-canvas-interactive', window.scrollY >= 20);
  window.addEventListener('scroll', syncCanvasGesture, { passive: true });
  window.addEventListener('pageshow', syncCanvasGesture);
  syncCanvasGesture();
}
if (params.get("embed") === "1") {
  document.documentElement.dataset.embed = "";
}
async function start() {
  const sketch = await mountMesh(document.querySelector("#sketch-root"), {
    ui: ["true", "1"].includes(params.get("ui")?.toLowerCase()),
  });
  const detach = attachPlayerBridge(sketch);
  function leave(event) {
    // Back/forward cache keeps this document alive. The playback lifecycle
    // pauses it on pagehide and resumes on pageshow without losing the canvas.
    if (event.persisted) return;
    window.removeEventListener("pagehide", leave);
    detach();
    sketch.dispose();
  }
  window.addEventListener("pagehide", leave);
}
start().catch((error) => {
  console.error("Unable to start 2026-10-29", error);
  document.querySelector("#sketch-root").textContent = `Unable to start 2026-10-29: ${error.message}`;
  document.querySelector("#sketch-root").removeAttribute("aria-busy");
  document.querySelector("#sketch-root").removeAttribute("inert");
});
