// Background suspension is separate from a deliberate user/player pause.
// Both app switching (blur) and tab switching (visibility) can arrive together.
export function bindFocusPlayback({ documentTarget = document, windowTarget = window,
  isRunning, pause, play, pauseOnBlur = windowTarget.top === windowTarget }) {
  // A visible document may report hasFocus() === false until the first tap,
  // especially on iOS or inside a newly mounted iframe. That is not a pause.
  let focused = true, pageHidden = false, suspended = false, resumeOnReturn = false, disposed = false;
  const active = () => focused && !pageHidden && !documentTarget.hidden;
  function update() {
    if (disposed) return;
    if (!active()) {
      if (suspended) return;
      suspended = true;
      resumeOnReturn = isRunning();
      pause();
    } else if (suspended) {
      suspended = false;
      const resume = resumeOnReturn;
      resumeOnReturn = false;
      if (resume) play();
    }
  }
  function blur() {
    // A visible iframe loses focus whenever its parent receives input. The
    // parent player, not iframe keyboard focus, chooses the active sketch.
    if (!pauseOnBlur) return;
    focused = false; update();
  }
  function focus() { focused = true; update(); }
  function visibility() {
    // Visibility is authoritative on mobile, where focus can arrive late or
    // never arrive when returning from another tab/app.
    if (!documentTarget.hidden) focused = true;
    update();
  }
  function pagehide() { pageHidden = true; update(); }
  function pageshow() { pageHidden = false; focused = true; update(); }
  function interact() {
    if (disposed || documentTarget.hidden) return;
    focused = true; pageHidden = false;
    update();
  }
  windowTarget.addEventListener("blur", blur);
  windowTarget.addEventListener("focus", focus);
  documentTarget.addEventListener("visibilitychange", visibility);
  windowTarget.addEventListener("pagehide", pagehide);
  windowTarget.addEventListener("pageshow", pageshow);
  // Playback recovery must also work when the sketch has no audio controller.
  documentTarget.addEventListener("pointerdown", interact, true);
  documentTarget.addEventListener("keydown", interact, true);
  update();
  return {
    interact,
    cancelResume() { resumeOnReturn = false; },
    deferPlay() {
      if (disposed || active()) return false;
      // A player command can arrive before the visibility event is delivered.
      if (!suspended) {
        suspended = true;
        pause();
      }
      resumeOnReturn = true;
      return true;
    },
    dispose() {
      disposed = true;
      resumeOnReturn = false;
      windowTarget.removeEventListener("blur", blur);
      windowTarget.removeEventListener("focus", focus);
      documentTarget.removeEventListener("visibilitychange", visibility);
      windowTarget.removeEventListener("pagehide", pagehide);
      windowTarget.removeEventListener("pageshow", pageshow);
      documentTarget.removeEventListener("pointerdown", interact, true);
      documentTarget.removeEventListener("keydown", interact, true);
    },
  };
}
