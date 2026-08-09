// Which overlay Escape belongs to.
//
// Overlays listen for Escape on `window`, so when one opens on top of another
// both hear the same keypress and both close. That is not cosmetic: the song
// editor opens from inside the task creator, so one Escape dismissed the
// editor's "you have unsaved work" question *and* tore down the dialog holding
// it, taking the half-written chart with it. The guard that was supposed to
// prevent exactly that loss was itself unmounted by the key that triggered it.
//
// Registration order cannot fix this. Listeners on one target fire in the order
// they were added, and the outer overlay always registers first, so it acts
// before the inner one has a chance to stop it. A stack is the only thing that
// answers the actual question: which overlay is on top right now.

let stack: symbol[] = [];

/** Claim the top of the stack. Call the returned function on teardown. */
export function pushOverlay(): { isTop: () => boolean; release: () => void } {
  const token = Symbol('overlay');
  stack.push(token);
  return {
    isTop: () => stack[stack.length - 1] === token,
    // Removed by identity rather than popped: overlays do not always unmount in
    // the order they mounted, and popping blindly would hand the top to
    // something already gone.
    release: () => {
      stack = stack.filter((t) => t !== token);
    },
  };
}
