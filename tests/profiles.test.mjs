import {
  activeProfileOf,
  LEGACY_PROFILE_ID,
  LEGACY_PROFILE_LABEL,
  makeProfile,
  newProfileId,
  nextProfileLabel,
  profileIsUsable,
  profilesOf,
  readyChords,
} from '../src/lib/chordProfiles.ts';
import { MIN_SAMPLES, fitTemplates } from '../src/audio/calibration.ts';

let failures = 0;
const check = (l, ok, d) => { if (!ok) failures++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l}${d?' — '+d:''}`); };

const chroma = (peak) => Array.from({ length: 12 }, (_, i) => (i === peak ? 1 : 0.1));
const learned = (peak, samples = MIN_SAMPLES) => ({ mean: chroma(peak), samples });
const cal = (chords) => Object.fromEntries(chords.map(([name, peak, n]) => [name, learned(peak, n)]));

const profile = (id, label, chords = {}) => makeProfile(id, label, chords, 1000);

console.log('\nMigrating the single calibration that came before\n');
{
  const legacy = { version: 1, createdAt: 5, updatedAt: 9, chords: cal([['A', 9], ['D', 2]]) };
  const migrated = profilesOf({ chordCalibration: legacy });
  check('one profile comes out', migrated.length === 1);
  check('it keeps the fixed legacy id', migrated[0].id === LEGACY_PROFILE_ID);
  check('and gets a name', migrated[0].label === LEGACY_PROFILE_LABEL);
  check('the fingerprints are untouched',
    JSON.stringify(migrated[0].chords) === JSON.stringify(legacy.chords));
  check('provenance survives', migrated[0].createdAt === 5 && migrated[0].updatedAt === 9);
  check('it is the active one', activeProfileOf({ chordCalibration: legacy }).id === LEGACY_PROFILE_ID);

  // A calibration that already carried a guitar name keeps it.
  const named = { ...legacy, label: 'Yamaha' };
  check('an existing label is kept', profilesOf({ chordCalibration: named })[0].label === 'Yamaha');

  // Migration is a read. Nothing may be written by looking.
  const acc = { chordCalibration: legacy };
  profilesOf(acc); activeProfileOf(acc);
  check('reading does not mutate the account',
    !('chordProfiles' in acc) && !('activeProfileId' in acc));
}

console.log('\nOnce profiles exist, the legacy field is ignored\n');
{
  const acc = {
    chordCalibration: { version: 1, createdAt: 1, updatedAt: 1, chords: cal([['G', 7]]) },
    chordProfiles: [profile('guitar-1', 'Nylon', cal([['A', 9], ['D', 2]]))],
    activeProfileId: 'guitar-1',
  };
  check('the list wins', profilesOf(acc).length === 1 && profilesOf(acc)[0].label === 'Nylon');
  check('and the stale single calibration is not resurrected',
    !profilesOf(acc).some((p) => 'G' in p.chords));
}

console.log('\nNothing stored\n');
{
  check('an empty account has no profiles', profilesOf({}).length === 0);
  check('and no active one', activeProfileOf({}) === undefined);
  check('undefined is handled', profilesOf(undefined).length === 0);
  check('and has no active one', activeProfileOf(undefined) === undefined);
}

console.log('\nWhich guitar is live\n');
{
  const acc = {
    chordProfiles: [profile('guitar-1', 'Steel'), profile('guitar-2', 'Nylon')],
    activeProfileId: 'guitar-2',
  };
  check('the chosen one is active', activeProfileOf(acc).label === 'Nylon');
  // A device that deleted guitar-2 leaves a dangling id behind on this one.
  // Dropping to the built-in templates would look exactly like the app breaking.
  const stale = { ...acc, activeProfileId: 'guitar-9' };
  check('a stale id falls back to the first, not to nothing',
    activeProfileOf(stale).label === 'Steel');
  const none = { ...acc, activeProfileId: undefined };
  check('no id set falls back to the first', activeProfileOf(none).label === 'Steel');
}

console.log('\nWhat counts as calibrated\n');
{
  const two = profile('g', 'Two', cal([['A', 9], ['D', 2]]));
  const one = profile('g', 'One', cal([['A', 9]]));
  const thin = profile('g', 'Thin', cal([['A', 9, MIN_SAMPLES - 1], ['D', 2, MIN_SAMPLES - 1]]));
  const empty = profile('g', 'Empty');

  check('two well-sampled chords is usable', profileIsUsable(two));
  // One chord cannot produce a discriminative fit; there is nothing to contrast
  // against. Calling that "calibrated" promises what the matcher will not do.
  check('one chord is not', !profileIsUsable(one));
  check('under-sampled chords do not count', readyChords(thin) === 0, String(readyChords(thin)));
  check('and so are not usable', !profileIsUsable(thin));
  check('an empty profile is not usable', !profileIsUsable(empty));
  check('nor is nothing at all', !profileIsUsable(undefined));
  check('the ready count is the count', readyChords(two) === 2);

  // The claim on screen has to match what the matcher actually builds.
  check('usable means templates really fit', Object.keys(fitTemplates(two.chords)).length >= 2);
  check('and unusable means they do not', Object.keys(fitTemplates(one.chords)).length === 0);
  check('nor for under-sampled', Object.keys(fitTemplates(thin.chords)).length === 0);
}

console.log('\nNaming and ids\n');
{
  check('the first guitar gets the plain name', nextProfileLabel([]) === LEGACY_PROFILE_LABEL);
  const one = [profile('guitar-1', LEGACY_PROFILE_LABEL)];
  check('the second is numbered', nextProfileLabel(one) === 'Guitar 2');
  const two = [...one, profile('guitar-2', 'Guitar 2')];
  check('and the third', nextProfileLabel(two) === 'Guitar 3');
  check('case does not fool it',
    nextProfileLabel([profile('guitar-1', 'my guitar')]) === 'Guitar 2');
  check('nor does whitespace',
    nextProfileLabel([profile('guitar-1', '  My guitar ')]) === 'Guitar 2');
  check('a custom name leaves the plain one free',
    nextProfileLabel([profile('guitar-1', 'Yamaha')]) === LEGACY_PROFILE_LABEL);

  check('ids start at one', newProfileId([]) === 'guitar-1');
  check('and skip what is taken', newProfileId(one) === 'guitar-2');
  // Deleting the middle guitar frees its id; reusing it is fine because the id
  // keys nothing outside this list.
  check('a gap is reused',
    newProfileId([profile('guitar-1', 'a'), profile('guitar-3', 'c')]) === 'guitar-2');
  const many = Array.from({ length: 50 }, (_, i) => profile(`guitar-${i + 1}`, `g${i}`));
  check('fifty guitars still get a fresh id', newProfileId(many) === 'guitar-51');
}

console.log(failures ? `\n${failures} FAILED\n` : '\nALL PASS\n');
process.exit(failures ? 1 : 0);
