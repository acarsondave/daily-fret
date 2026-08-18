// Everything the Journey is allowed to say, and nothing that draws it.
//
// Split out of the panel so each sentence can be checked against the curriculum
// and against the rest of the app in tests/journey.test.mjs. Every line here is
// a claim: a count, a position, or a word for how much the app actually knows.
//
// One rule runs the whole file, and it used to be a workaround. The app had two
// vocabularies for "good enough": lib/readiness.ts owned **Held**, three runs
// running at the bar and still fresh, while lib/progression.ts called a skill
// solid on one best-ever result. Printing "Solid" here while Numbers printed
// "1 of 3" for the same pair was the app disagreeing with itself, so this file
// said "Cleared" and left Held alone.
//
// progression.ts reads the same rule now, so there is one meaning and it takes
// the word with it: **Held** here means exactly what it means on Numbers, and
// **Lapsed** means the same too. The workaround is gone rather than kept as a
// second spelling, because two words for one fact is how the app started
// disagreeing with itself the first time.

import type { SkillStanding } from '../../lib/progression';
import type { JourneyModule, ModuleContent } from './journeyCourse';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The module's shape in one sentence, which is the whole point of the split: a
 * module that is four lessons of theory and one chord should read as that before
 * a single row is expanded.
 *
 * It says whose count it is. "This module: 1 to practise, across 11 lessons" was
 * a sentence about Daily Fret's coverage wearing the clothes of a sentence about
 * the course, and on module 9 the two are nothing like the same thing: the
 * module is called The F Chord Journey and exactly one skill in the taxonomy
 * points anywhere inside it. Naming the source costs three words and stops a
 * thin mapping reading as a thin module.
 */
export function shapeOf(module: JourneyModule, content: ModuleContent): string {
  const lessons = plural(module.lessonCount, 'lesson');
  if (!content.mapped) return `This module: ${lessons}, none of them mapped to a drill here yet.`;
  const practice = content.practice.length;
  const once = content.taughtOnce.length;
  const of = `Of this module's ${lessons}, Daily Fret maps`;
  if (!practice) return `${of} ${once} taught but not drilled, and nothing to practise.`;
  if (!once) return `${of} ${practice} to practise.`;
  return `${of} ${practice} to practise and ${once} taught but not drilled.`;
}

/** The module's contents in the row, before anything is expanded. */
export function countLine(module: JourneyModule, content: ModuleContent): string {
  const lessons = plural(module.lessonCount, 'lesson');
  if (!content.mapped) return `${lessons} · no drills mapped yet`;
  if (content.measured === 0) {
    return content.practice.length
      ? `${lessons} · nothing here the app can score yet`
      : `${lessons} · nothing here to drill`;
  }
  return `${lessons} · ${content.atBar} of ${content.measured} held`;
}

const STATE_LABEL: Record<SkillStanding['state'], string> = {
  solid: 'Held',
  lapsed: 'Lapsed',
  working: 'Under way',
  ready: 'Ready',
  locked: 'Later',
};

/**
 * What the chip says.
 *
 * "Ready" on a skill the app has no analysis for is a promise it will never
 * keep: that skill cannot move off Ready however long the learner practises. The
 * taxonomy already knows the difference, so the chip reads it rather than
 * printing the progression state for every kind alike.
 */
export function stateLabel(standing: SkillStanding): string {
  if (standing.state === 'solid') return STATE_LABEL.solid;
  if (standing.skill.measure.kind === 'measurable') return 'Not measured yet';
  if (standing.skill.measure.kind === 'timed') return 'On the clock';
  return STATE_LABEL[standing.state];
}

/**
 * The one line under the name, or nothing.
 *
 * lib/progression.ts writes its sentences for a panel that offered a "mark done"
 * button next to every skill it could not hear. There is no such button now, so
 * "Mark it when it feels settled" would be an instruction to nothing, and "Not
 * measured yet" arrives twice once the chip above says it. The chip carries
 * those two kinds on its own and the module states underneath, once, what the
 * chip means. A measured skill keeps its real evidence, which is the only
 * sentence on this panel that reports a number.
 */
export function evidenceLine(standing: SkillStanding): string | null {
  const { skill, state, source, evidence, blockedBy } = standing;
  if (state === 'locked' && blockedBy.length) {
    return `After ${blockedBy.map((s) => s.title).join(' and ')}.`;
  }
  if (source === 'claimed') return evidence;
  return skill.measure.kind === 'measured' ? evidence : null;
}

/** What the chips in this module mean, said once rather than on every row. */
export function kindNote(content: ModuleContent): string | null {
  const kinds = new Set(content.practice.map((s) => s.skill.measure.kind));
  const parts: string[] = [];
  if (kinds.has('timed')) parts.push('On the clock: minutes are the measure, so there is no score.');
  if (kinds.has('measurable')) {
    parts.push('Not measured yet: real practice the app has no analysis for.');
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * Why nothing below is marked as behind you.
 *
 * Three different situations used to print the same sentence, and two of them
 * were false. Someone whose lesson code the curriculum no longer holds was told
 * "you have not said where you are" when they had said exactly that, and someone
 * reading Justin's own Grade 1 practice diary was told their lesson "sits
 * outside the beginner course" while the heading above named that course. A
 * companion series is inside the course and outside its numbered path, and the
 * only honest sentence is the one that says so.
 */
export function outsideNote(where: 'companion' | 'other-course' | 'unknown'): string {
  if (where === 'companion') {
    return 'That is a companion series alongside the course rather than one of its numbered modules, so nothing below is marked as behind you.';
  }
  if (where === 'unknown') {
    return 'Daily Fret does not hold that lesson, so nothing below is marked as behind you. Open a module and say you are on it.';
  }
  return 'That lesson sits outside the beginner course, so nothing below is marked as behind you.';
}

/** How many lessons the course counts here but refuses to name. */
export function paidGap(module: JourneyModule): string | null {
  if (module.paidNotListed === 0) return null;
  const one = module.paidNotListed === 1;
  return `${plural(module.paidNotListed, 'more lesson')} in this module ${
    one ? 'is' : 'are'
  } paid, and the course does not name ${one ? 'it' : 'them'}.`;
}
