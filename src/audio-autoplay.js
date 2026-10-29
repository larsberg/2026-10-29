// Start with the saved tuning. Browser autoplay restrictions may leave resume()
// pending, so keep interaction listeners available without blocking the controls.
export function bindAudioAutoplay({ audio, target, ready = Promise.resolve(), beforeRetry = () => {}, canRetry = () => true, shouldEnable = () => true, onError = () => {} }) {
  let disposed = false;
  const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  const retry = () => {
    if (disposed || !canRetry()) return;
    // Keep resume() on the gesture stack, including iOS touch release. A touch
    // also repairs an automatic pause if the browser omitted its return event.
    beforeRetry();
    audio.retry().catch(onError);
  };
  for (const event of events) target.addEventListener(event, retry, true);
  ready.then(() => {
    if (!disposed && shouldEnable()) return audio.enable();
  }).catch(error => { if (!disposed) onError(error); });
  return () => {
    disposed = true;
    for (const event of events) target.removeEventListener(event, retry, true);
  };
}
