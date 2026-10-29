// Let animation and camera updates run while the first configured frame is hidden.
export function createStartupGate(root) {
  root.setAttribute("aria-busy", "true");
  root.setAttribute("inert", "");
  let loaded = false, revealed = false, disposed = false;
  return {
    async load(loadSetup) {
      // The setup loader reports errors in the controls. Retain its defaults
      // on failure (including its timeout) instead of leaving a blank sketch.
      try { await loadSetup(); } catch {}
      if (disposed) return;
      loaded = true;
    },
    reveal() {
      if (!loaded || revealed || disposed) return;
      revealed = true;
      root.removeAttribute("aria-busy");
      root.removeAttribute("inert");
    },
    dispose() { disposed = true; },
  };
}
