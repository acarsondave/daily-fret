// Everything the Journey is allowed to say, and nothing that draws it.
//
// Split out of the panel so each sentence can be checked against the curriculum
// and against the rest of the app in tests/journey.test.mjs. Every line here is
// a claim: a count, a position, or a word for how much the app actually knows.
//
// One rule runs the whole file. The app has two vocabularies for "good enough"
// and they mean different things. lib/readiness.ts owns **Held**: three runs
// running at the bar, still fresh, which is a standing fact about repeatability
// and is what the Numbers tab shows. lib/progression.ts owns `solid`, which is
// only that a best-ever result once cleared the bar. Printing "Solid" here while
// Numbers printed "1 of 3" for the same pair was the app disagreeing with
// itself, so this file says **Cleared** and leaves Held to the panel that earned
// it.

import type { SkillStanding } from '../../lib/progression';
import type { JourneyModule, ModuleContent } from './journeyCourse';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The module's real shape in one sentence, which is the whole point of the
 * split: a module that is four lessons of theory and one chord should read as
 * that before a single row is expanded.
 */
export function shapeOf(module: JourneyModule, content: ModuleContent): string {
  const lessons = plural(module.lessonCount, 'lesson');
  if (!content.mapped) return `This module: ${lessons}, none of them mapped to a drill here yet.`;
  const practice = content.practice.length;
  const once = content.taughtOnce.length;
  if (!practice) return `This module: ${lessons}, all of it taught rather than drilled.`;
  if (!once) return `This module: ${practice} to practise, across ${lessons}.`;
  return `This module: ${practice} to practise and ${once} taught but not drilled, across ${lessons}.`;
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
  return `${lessons} · ${content.atBar} of ${content.measured} cleared`;
}

const STATE_LABEL: Record<SkillStanding['state'], string> = {
  solid: 'Cleared',
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

/** How many lessons the course counts here but refuses to name. */
export function paidGap(module: JourneyModule): string | null {
  if (module.paidNotListed === 0) return null;
  const one = module.paidNotListed === 1;
  return `${plural(module.paidNotListed, 'more lesson')} in this module ${
    one ? 'is' : 'are'
  } paid, and the course does not name ${one ? 'it' : 'them'}.`;
}
