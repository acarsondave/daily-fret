// Whether this is the first look at the app today.
//
// Two things on the day's screen are allowed to move once a day and not again:
// the figures counting up out of their underscores, and the streak cell that
// pops. Both are confirmations, and a confirmation that replays on every render,
// every tab focus and every navigation back to the screen stops confirming
// anything and becomes decoration.
//
// The answer is computed once per page load and then held, so every caller in a
// session agrees. Storage can be unavailable (private mode), in which case the
// honest answer is yes: the motion plays once for this load and nothing is lost.

const KEY = 'daily-fret-last-seen';

let answer: boolean | null = null;

export function isFirstViewToday(today: string): boolean {
  if (answer !== null) return answer;
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(KEY);
    localStorage.setItem(KEY, today);
  } catch {
    /* storage disabled; treat it as a first view and move on */
  }
  answer = seen !== today;
  return answer;
}

/** Test seam. Nothing in the app calls this. */
export function forgetFirstView(): void {
  answer = null;
}
