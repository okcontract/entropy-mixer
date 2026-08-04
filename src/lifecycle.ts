export const resetOnPageHide = (target: EventTarget, reset: () => void) => {
  target.addEventListener("pagehide", reset);
};
