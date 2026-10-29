const CHANNEL = "sketch-player:v1";

// Optional, small contract for a future external website player. No parent DOM
// access is needed, and messages are accepted only from the selected parent.
export function attachPlayerBridge(sketch) {
  if (window.parent === window) return () => {};
  let origin;
  try {
    const requested = new URLSearchParams(location.search).get("parentOrigin");
    origin = requested ? new URL(requested).origin : location.origin;
    if (!/^https?:\/\//.test(origin)) return () => {};
  } catch {
    return () => {};
  }

  const reply = (data) =>
    window.parent.postMessage({ channel: CHANNEL, ...data }, origin);
  async function receive(event) {
    if (event.source !== window.parent || event.origin !== origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    try {
      switch (data.command) {
        case "play":
          await sketch.play();
          break;
        case "pause":
          await sketch.pause();
          break;
        case "reset":
          sketch.reset();
          break;
        case "get-setup":
          reply({ type: "setup", requestId: data.requestId, setup: sketch.getSetup() });
          return;
        case "setup":
          reply({ type: "setup", requestId: data.requestId, setup: sketch.setup(data.value) });
          return;
        case "save-setup":
          reply({ type: "setup", requestId: data.requestId, setup: await sketch.saveSetup() });
          return;
        case "load-setup":
          reply({ type: "setup", requestId: data.requestId, setup: await sketch.loadSetup() });
          return;
        default:
          return;
      }
      reply({ type: "state", requestId: data.requestId, ...sketch.getState() });
    } catch {
      reply({
        type: "error",
        requestId: data.requestId,
        message: "The sketch could not complete that command.",
      });
    }
  }
  window.addEventListener("message", receive);
  reply({ type: "ready", ...sketch.getState() });
  return () => window.removeEventListener("message", receive);
}
