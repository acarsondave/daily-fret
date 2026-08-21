// Strum patterns. A pattern is a string of D (down), U (up), and - (a slot the
// arm travels through with the pick off the strings). Built-ins ship with the
// app; users add their own, which are stored on the account. A block keeps the
// pattern string directly, so deleting a saved pattern never breaks a task that
// already uses it.
//
// EIGHT SLOTS TO A BAR. A bar of 4/4 has eight eighth-note slots and the
// strumming arm passes through all of them: 1 + 2 + 3 + 4 +. Every rung here is
// eight characters, or sixteen where the phrase is two bars. That was not always
// true. `DDDD` and `DUDU` were four characters while everything else was six or
// eight, which meant the alphabet was being used for two different things at
// once, one bar in some entries and one repeating unit in others. `D-DUD-` was
// worse than inconsistent: six eighth-note slots is three beats, which is not a
// bar of anything the course teaches, so a matcher scoring against it would have
// been scoring against a bar that does not exist.
//
// THE LADDER. The order is the order to learn them in, and each rung adds
// exactly one new difficulty over the rung before it. That matters more than
// having many of them: "Exploring Strumming" tells the player to keep a few
// patterns and add more as they go, not to collect them. The deck a drill deals
// from is four cards wide and is read off this order against the player's own
// history (src/lib/patternDeck.ts), so a long ladder stays a path rather than a
// pile: a rung arrives only once the ones below it are automatic.
//
// WHAT THE LADDER IS FOR, IN JUSTIN'S WORDS. "Guitar Strumming Tips" builds the
// whole thing out of one move: four downs with the arm never stopping, then the
// four up strums that live between them, then "determine which up strums and
// down strums you'd like to include". Eight slots, choose which sound. So the
// rungs are not a taste in patterns, they are a walk across that space, and the
// axes are the ones that actually make a bar harder to hold:
//
//   how many up strums it asks for              rungs 1 to 5
//   whether a down strum is left out            rungs 6 to 10
//   whether the arm crosses two silent slots    rungs 8 to 10
//   whether the phrase is longer than one bar   rungs 11 and 12
//
// The last of those is "Exploring Strumming" again, also in as many words:
// "generally, every four or eight bars, a slight rhythmic strumming variation
// should happen. Your strumming pattern should stay the same most of the time,
// but this change will make it pop."
//
// WHAT IS DELIBERATELY ABSENT. No rung leaves beat one silent. Justin does not
// ask for it in Module 5, and beat one is the slot the player finds their place
// in the bar by, so a pattern without it drills finding the bar line rather than
// holding a pattern. That is a real exercise and it is not this one.

export interface StrumPattern {
  id: string;
  name: string;
  pattern: string;
  /** What this rung adds over the one before it. Shown where a player is choosing. */
  adds?: string;
}

export const BUILTIN_PATTERNS: StrumPattern[] = [
  {
    id: 'all-downs',
    name: 'All downs',
    pattern: 'D-D-D-D-',
    adds: 'The pendulum. Four downs, and the arm still travels through the offbeats.',
  },
  {
    id: 'last-up',
    name: 'One up',
    // Deliberately the last slot rather than an easier one. The "and" of four is
    // where a beginner's arm stops early, because the bar feels finished, and
    // every pattern below inherits the problem. Meeting it on a bar with one up
    // in it is cheaper than meeting it inside Old Faithful.
    pattern: 'D-D-D-DU',
    adds: 'One up strum, on the last slot, which is the one that gets dropped.',
  },
  {
    id: 'straight-eighths',
    name: 'Straight eighths',
    pattern: 'DUDUDUDU',
    adds: 'Every slot sounds. Nothing to choose, so all of it is evenness.',
  },
  {
    id: 'd-du-du-d',
    name: 'D DU DU D',
    pattern: 'D-DUDUD-',
    adds: 'The first pattern that leaves slots out while the arm keeps going.',
  },
  {
    // The same half-bar figure twice, which is why it sits here: no busier than
    // the rung above and asking for one thing that rung does not, which is the
    // last slot of the bar with all four downs still under it. That is rung
    // two's problem again, met inside a pattern rather than on its own.
    id: 'down-down-up',
    name: 'Down, down-up',
    pattern: 'D-DUD-DU',
    adds: 'The up moves to the end of the bar, where the arm wants to stop.',
  },
  {
    // Justin's, counted "1 2 + + 4": take D DU DU D and drop the down strum on
    // beat 3 while keeping the up after it. The hand still travels through the
    // missing down, which is the whole point of it.
    id: 'old-faithful',
    name: 'Old faithful',
    pattern: 'D-DU-UD-',
    adds: 'A missing down strum, with the up after it kept.',
  },
  {
    id: 'old-faithful-open',
    name: 'Old faithful, open',
    pattern: 'D-DU-UDU',
    adds: 'The final up comes back. This is the bar most pop songs are strummed on.',
  },
  {
    // Beat four gone takes two silent slots with it, and they are the two just
    // before the bar line, which is exactly where a beginner's arm stops. Every
    // rung above leaves at most one slot silent at a time.
    id: 'nothing-on-four',
    name: 'Nothing on four',
    pattern: 'D-DUDU--',
    adds: 'Two silent slots in a row, at the end of the bar.',
  },
  {
    // The same gap moved inside the bar, where there is no bar line to lean on
    // coming out of it. The up on the "and" of one is new as well, and it is the
    // only way into the gap that keeps the arm honest.
    id: 'nothing-on-two',
    name: 'Nothing on two',
    pattern: 'DU--DUDU',
    adds: 'The gap moves into the middle of the bar, with an up strum leading in.',
  },
  {
    // Old faithful with beat two taken out as well. Two down strums left in the
    // whole bar, and they are the two that hold it together.
    id: 'nothing-on-two-or-three',
    name: 'Nothing on two or three',
    pattern: 'D--U-UD-',
    adds: 'Two down strums left out at once, and the offbeats between them kept.',
  },
  {
    // Rungs six and seven joined, which is the exercise "Exploring Strumming"
    // describes: hold the pattern, then let the repeat change. Built from two
    // bars the player already owns, so the only new thing is the length.
    id: 'old-faithful-varied',
    name: 'Old faithful, varied',
    pattern: 'D-DU-UD-D-DU-UDU',
    adds: 'Two bars. The same pattern, opening up on the repeat.',
  },
  {
    // Get Lucky. How the nine strums map onto sixteen slots is argued in
    // src/data/songs.ts, because it is a claim about the song rather than about
    // the ladder. Here it is the top rung for a plain reason: it is the same
    // two-bar shape as the rung above with beat four out of both bars, which is
    // rung eight's mechanic held for twice as long.
    id: 'get-lucky',
    name: 'Get Lucky',
    pattern: 'D-D-DU-UD-D-DU--',
    adds: 'Two bars off a song rather than an exercise, differing by one strum.',
  },
];

// Find a pattern's display name by its string, across built-ins + custom.
export function patternName(pattern: string, custom: StrumPattern[]): string | undefined {
  const all = [...BUILTIN_PATTERNS, ...custom];
  return all.find((p) => p.pattern === pattern)?.name;
}
