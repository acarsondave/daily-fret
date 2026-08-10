// Which overlay is on top: the one question behind Escape, Tab, and paint order.
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
//
// Paint order is that same question, so it is answered here too rather than in
// stylesheets. The calibration surface used to set its layer by overriding
// `.practice-overlay` from a second file at equal specificity. The tuner's built
// chunk ships its own copy of that shell rule, so whichever stylesheet the
// browser happened to load last decided the winner: open the tuner, then
// recalibrate, and the calibration flow painted *behind* the settings dialog
// that launched it, with the settings close button the only one reachable. A
// stylesheet cannot know what is already open. This can.

/** Above the context menu (1000), below the crash screen (9999). */
const BASE_LAYER = 1100;

/** Room inside one layer for a backdrop and the panel that sits on it. */
const LAYER_STEP = 10;

export interface OverlayClaim {
  /** True while nothing has opened on top of this overlay. */
  isTop: () => boolean;
  /** The z-index this overlay paints at. */
  layer: number;
  /** Call on teardown. */
  release: () => void;
}

let stack: symbol[] = [];

/** Claim the top of the stack. Call `release` on teardown. */
export function pushOverlay(): OverlayClaim {
  const token = Symbol('overlay');
  stack.push(token);
  return {
    isTop: () => stack[stack.length - 1] === token,
    // Fixed at the moment of opening rather than recomputed. An overlay that
    // outlives one opened beneath it keeps the layer it claimed, because
    // "opened on top" is a fact about when it opened; recomputing would let a
    // surface drop behind something the user is still working in.
    layer: BASE_LAYER + (stack.length - 1) * LAYER_STEP,
    // Removed by identity rather than popped: overlays do not always unmount in
    // the order they mounted, and popping blindly would hand the top to
    // something already gone.
    release: () => {
      stack = stack.filter((t) => t !== token);
    },
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside `panel`, wrapping at both ends.
 *
 * Beside the stack because it answers the same question from the other side:
 * while an overlay is on top, both Escape and Tab belong to it. An overlay that
 * leaks focus to the page underneath is an overlay in appearance only, because a
 * keyboard lands on controls it cannot see.
 */
export function containFocus(panel: HTMLElement, event: KeyboardEvent): void {
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (items.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
