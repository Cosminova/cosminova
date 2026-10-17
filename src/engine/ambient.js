/**
 * Original score for Cosminova, synthesised at runtime — no samples and no
 * audio files.
 *
 * The score is a set of short composed piano pieces with silence between them,
 * in the manner of the music in Minecraft: a soft felt piano, a broken-chord
 * left hand under the sustain pedal, a melody simple enough to remember, and
 * then nothing for half a minute before the next one. The silence is not a
 * gap in the score; it is most of what makes it calm. Music that never stops
 * cannot be listened past, and this is meant to be listened past.
 *
 * Where the camera is chooses which piece comes next and how it is played —
 * at home a dry piano at walking pace, out in deep space the same instrument
 * slower and further away with a pad under it, on an alien world a celesta
 * doubling the tune. A piece that has started is always allowed to finish.
 */

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const STEM_NAMES = ['home', 'leave', 'deep', 'approach', 'land', 'alien', 'void', 'wonder'];

// Output level with the music enabled. Set so a piece sits around -26 dBFS
// with its loudest notes ten decibels clear of the ceiling: quiet, the way
// music you are meant to half-notice should be.
const LEVEL = 1.5;

// ---------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const accidental = (a) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
const pcOf = (letter, acc) => (LETTER[letter] + accidental(acc) + 12) % 12;

/** 'C4' is 60, as in MIDI. */
export function noteNumber(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`not a note: ${name}`);
  return (Number(m[3]) + 1) * 12 + LETTER[m[1]] + accidental(m[2]);
}

const QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  7: [0, 4, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
};

export function parseChord(name) {
  const m = /^([A-G])(#|b)?(maj9|maj7|madd9|m9|m7|m6|add9|sus2|sus4|m|6|7)?(?:\/([A-G])(#|b)?)?$/.exec(name);
  if (!m) throw new Error(`not a chord: ${name}`);
  const root = pcOf(m[1], m[2]);
  const intervals = QUALITIES[m[3] ?? ''];
  const bass = m[4] ? pcOf(m[4], m[5]) : root;
  return {
    name,
    root,
    bass,
    intervals,
    pcs: [...new Set([...intervals.map((i) => (root + i) % 12), bass])],
  };
}

/** 'E5:1.5 D5:.5 r:1 G4:1' — pitch and length in beats, 'r' for a rest. */
export function parseBar(text) {
  const notes = [];
  let beat = 0;
  for (const token of text.trim().split(/\s+/)) {
    const [pitch, len] = token.split(':');
    const dur = Number(len);
    if (!(dur > 0)) throw new Error(`no length in ${token}`);
    if (pitch !== 'r') notes.push({ note: noteNumber(pitch), beat, dur });
    beat += dur;
  }
  return { notes, beats: beat };
}

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

function parseScale(text) {
  const [tonic, mode] = text.split(' ');
  const m = /^([A-G])(#|b)?$/.exec(tonic);
  const root = pcOf(m[1], m[2]);
  return MODES[mode].map((d) => (root + d) % 12);
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/**
 * Eight short pieces. Each is a four-bar progression with a tune over it, a
 * variation of that tune, and usually a contrasting section, arranged into a
 * form that comes back to where it started: the shape of a song you could hum
 * after hearing it twice, which is the whole difference between a score and a
 * generated texture.
 *
 * `lh` is the left-hand figure. `form` names sections in order; `intro` is the
 * first section's chords with no tune over them, which is how almost every
 * piece in this style begins. `moods` are the places a piece belongs.
 */
export const PIECES = [
  {
    name: 'Hearth',
    scale: 'C major',
    bpm: 72,
    meter: 4,
    lh: 'arp',
    sections: {
      A: {
        chords: ['Cmaj7', 'G/B', 'Am7', 'Fmaj7'],
        melody: ['E5:1.5 D5:.5 C5:1 G4:1', 'D5:2 B4:1 C5:1', 'C5:1.5 B4:.5 A4:1 E4:1', 'A4:3 r:1'],
      },
      A2: {
        chords: ['Cmaj7', 'G/B', 'Am7', 'Fmaj7'],
        melody: ['E5:1.5 D5:.5 C5:1 G4:1', 'D5:2 B4:1 C5:1', 'C5:1 D5:1 E5:1 G5:1', 'E5:3 r:1'],
      },
      B: {
        chords: ['Fmaj7', 'Em7', 'Dm7', 'Gsus4'],
        melody: ['A4:1 C5:1 F5:2', 'E5:1 D5:1 B4:2', 'D5:1.5 C5:.5 A4:2', 'G4:4'],
      },
    },
    form: ['intro', 'A', 'A2', 'B', 'A2'],
    ending: { chord: 'Cmaj7', note: 'C5' },
  },
  {
    name: 'Lantern Moss',
    scale: 'G major',
    bpm: 66,
    meter: 3,
    lh: 'arp',
    sections: {
      A: {
        chords: ['G', 'Em7', 'Cmaj7', 'D'],
        melody: ['B4:2 D5:1', 'G5:1.5 F#5:.5 E5:1', 'D5:2 B4:1', 'A4:3'],
      },
      A2: {
        chords: ['G', 'Em7', 'Cmaj7', 'D'],
        melody: ['B4:2 D5:1', 'G5:1.5 A5:.5 B5:1', 'A5:1 G5:1 E5:1', 'F#5:3'],
      },
      B: {
        chords: ['Cmaj7', 'Bm7', 'Am7', 'D'],
        melody: ['E5:1 G5:1 B5:1', 'A5:2 F#5:1', 'E5:1 C5:1 A4:1', 'D5:3'],
      },
    },
    form: ['intro', 'A', 'A2', 'B', 'A', 'A2'],
    ending: { chord: 'G', note: 'G5' },
  },
  {
    name: 'Small Hours',
    scale: 'F major',
    bpm: 60,
    meter: 4,
    lh: 'rolled',
    sections: {
      A: {
        chords: ['Fmaj7', 'Am7', 'Bbmaj7', 'Csus4'],
        melody: ['r:1 A4:1 C5:2', 'E5:3 r:1', 'D5:1 C5:1 A4:2', 'G4:4'],
      },
      A2: {
        chords: ['Fmaj7', 'Am7', 'Bbmaj7', 'C'],
        melody: ['r:1 A4:1 C5:1 F5:1', 'E5:2 C5:2', 'D5:2 F5:2', 'E5:4'],
      },
      B: {
        chords: ['Dm7', 'Am7', 'Bbmaj7', 'C'],
        melody: ['F5:1.5 E5:.5 D5:2', 'C5:2 A4:2', 'Bb4:1 C5:1 D5:2', 'C5:4'],
      },
    },
    form: ['intro', 'A', 'A2', 'B', 'A2'],
    ending: { chord: 'Fmaj7', note: 'A4' },
  },
  {
    name: 'Drift',
    scale: 'D major',
    bpm: 58,
    meter: 4,
    lh: 'drift',
    pad: true,
    intro: 4,
    sections: {
      A: {
        chords: ['Dmaj7', 'Dmaj7', 'Gmaj7', 'Gmaj7', 'Bm7', 'Bm7', 'Asus2', 'A'],
        melody: [
          'F#5:4', 'E5:2 A4:2', 'D5:4', 'r:2 B4:2',
          'D5:3 C#5:1', 'B4:4', 'C#5:2 E5:2', 'A4:4',
        ],
      },
      A2: {
        chords: ['Dmaj7', 'Dmaj7', 'Gmaj7', 'Gmaj7', 'Bm7', 'Bm7', 'Asus2', 'A'],
        melody: [
          'A5:4', 'F#5:2 E5:2', 'D5:4', 'r:2 F#5:2',
          'F#5:3 E5:1', 'D5:4', 'E5:2 C#5:2', 'E5:4',
        ],
      },
    },
    form: ['intro', 'A', 'A2'],
    ending: { chord: 'Dmaj7', note: 'F#5' },
  },
  {
    name: 'Far Shore',
    scale: 'Eb major',
    bpm: 64,
    meter: 4,
    lh: 'arp-slow',
    pad: true,
    sections: {
      A: {
        chords: ['Ebmaj9', 'Cm7', 'Abmaj7', 'Bbsus4'],
        melody: ['G5:1.5 F5:.5 Eb5:2', 'Bb4:2 C5:1 Eb5:1', 'C5:3 r:1', 'Bb4:4'],
      },
      A2: {
        chords: ['Ebmaj9', 'Cm7', 'Abmaj7', 'Bbsus4'],
        melody: ['G5:1.5 F5:.5 Eb5:1 G5:1', 'Bb5:3 G5:1', 'Ab5:1 G5:1 Eb5:2', 'F5:4'],
      },
      B: {
        chords: ['Abmaj7', 'Gm7', 'Fm7', 'Bb'],
        melody: ['C5:1 Eb5:1 G5:2', 'F5:1.5 D5:.5 Bb4:2', 'Ab4:1 C5:1 F5:2', 'D5:4'],
      },
    },
    form: ['intro', 'A', 'A2', 'B', 'A2'],
    ending: { chord: 'Ebmaj9', note: 'Eb5' },
  },
  {
    name: 'Glass Garden',
    // Lydian: a major key with its fourth raised. The chord a step above the
    // tonic, over the tonic in the bass, is the whole sound of it — bright,
    // in key, and faintly not of here.
    scale: 'A lydian',
    bpm: 62,
    meter: 4,
    lh: 'arp',
    bell: true,
    sections: {
      A: {
        chords: ['Aadd9', 'B/A', 'Aadd9', 'B/A'],
        melody: ['E5:1 C#5:1 B4:1 C#5:1', 'D#5:3 r:1', 'E5:1 F#5:1 G#5:2', 'F#5:2 D#5:2'],
      },
      B: {
        chords: ['F#m7', 'E/G#', 'Amaj7', 'B'],
        melody: ['C#5:2 A4:2', 'B4:1 G#4:1 B4:2', 'C#5:1 E5:1 G#5:2', 'F#5:4'],
      },
    },
    form: ['intro', 'A', 'B', 'A', 'B', 'A'],
    ending: { chord: 'Aadd9', note: 'E5' },
  },
  {
    name: 'Under Dark Water',
    scale: 'A aeolian',
    bpm: 54,
    meter: 4,
    lh: 'drift',
    lhLow: 33,
    pad: true,
    sections: {
      A: {
        chords: ['Am', 'Fmaj7', 'Am', 'Em7'],
        melody: ['r:2 E5:2', 'C5:4', 'r:2 B4:1 A4:1', 'G4:4'],
      },
      A2: {
        chords: ['Am', 'Fmaj7', 'Am', 'Em7'],
        melody: ['r:2 E5:2', 'A5:4', 'G5:2 E5:2', 'D5:4'],
      },
    },
    form: ['intro', 'A', 'A2', 'A', 'A2'],
    ending: { chord: 'Am9', note: 'E5' },
  },
  {
    name: 'Pale Blue',
    scale: 'Bb major',
    bpm: 70,
    meter: 4,
    lh: 'arp',
    sections: {
      A: {
        chords: ['Bb', 'F/A', 'Gm7', 'Ebmaj7'],
        melody: ['D5:1 F5:1 Bb5:1.5 A5:.5', 'A5:2 F5:2', 'G5:1 F5:1 D5:2', 'Eb5:1 D5:1 Bb4:2'],
      },
      A2: {
        chords: ['Bb', 'F/A', 'Gm7', 'Ebmaj7'],
        melody: ['D5:1 F5:1 Bb5:1.5 A5:.5', 'C6:2 A5:2', 'Bb5:1 A5:1 G5:2', 'G5:3 r:1'],
      },
      B: {
        chords: ['Cm7', 'Dm7', 'Ebmaj7', 'F'],
        melody: ['Eb5:1.5 D5:.5 C5:2', 'D5:1 F5:1 A5:2', 'G5:2 Bb4:2', 'C5:4'],
      },
    },
    form: ['intro', 'A', 'A2', 'B', 'A2'],
    ending: { chord: 'Bb', note: 'D5' },
  },
];

/**
 * Where a piece is played, and how. `tempo` scales the written tempo, `pad`
 * adds a soft sustained chord under the piano, `bell` doubles the tune on a
 * celesta from the second section on, and `gap` is the range of silence after
 * a piece, in seconds.
 */
const MOODS = {
  home: {
    pieces: ['Hearth', 'Lantern Moss', 'Small Hours', 'Pale Blue'],
    tempo: 1, pad: false, bell: false, lift: false, gap: [20, 45],
  },
  deep: {
    pieces: ['Drift', 'Far Shore', 'Under Dark Water', 'Small Hours'],
    tempo: 0.95, pad: true, bell: false, lift: true, gap: [25, 55],
  },
  wonder: {
    pieces: ['Far Shore', 'Pale Blue', 'Drift', 'Glass Garden'],
    tempo: 1, pad: true, bell: true, lift: true, gap: [18, 40],
  },
  alien: {
    pieces: ['Glass Garden', 'Drift', 'Far Shore'],
    tempo: 0.96, pad: true, bell: true, lift: true, gap: [25, 50],
  },
  void: {
    pieces: ['Under Dark Water', 'Drift'],
    tempo: 0.92, pad: true, bell: false, lift: false, gap: [35, 70],
  },
};

const PIECE_ERRORS = [];
const LIBRARY = new Map();
for (const piece of PIECES) {
  try {
    const sections = {};
    for (const [key, s] of Object.entries(piece.sections)) {
      if (s.chords.length !== s.melody.length) {
        PIECE_ERRORS.push(`${piece.name} ${key}: ${s.chords.length} chords, ${s.melody.length} bars of tune`);
      }
      sections[key] = {
        chords: s.chords.map(parseChord),
        melody: s.melody.map((text, i) => {
          const bar = parseBar(text);
          if (Math.abs(bar.beats - piece.meter) > 1e-6) {
            PIECE_ERRORS.push(`${piece.name} ${key} bar ${i + 1} has ${bar.beats} beats, not ${piece.meter}`);
          }
          return bar.notes;
        }),
      };
    }
    LIBRARY.set(piece.name, {
      ...piece,
      sections,
      scalePcs: parseScale(piece.scale),
      ending: { chord: parseChord(piece.ending.chord), note: noteNumber(piece.ending.note) },
    });
  } catch (err) {
    PIECE_ERRORS.push(`${piece.name}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Arranging
// ---------------------------------------------------------------------------

/**
 * Left-hand voicing: the bass, then the chord spread open above it. Root
 * position chords take the shape a pianist's hand falls into for a broken
 * chord — fifth, octave, tenth, then the colour tone on top. Slash chords
 * spread their tones evenly over the next two octaves instead, so a bass that
 * is not the root does not end up a step below it.
 */
export function leftHand(chord, low) {
  const bass = low + (((chord.bass - low) % 12) + 12) % 12;
  if (chord.bass === chord.root) {
    const third = chord.intervals.find((i) => i >= 2 && i <= 5) ?? 4;
    const colour = chord.intervals.find((i) => i === 9 || i === 10 || i === 11 || i === 14);
    return [bass, bass + 7, bass + 12, bass + 12 + third, colour != null ? bass + 12 + colour : bass + 19];
  }
  const pool = [];
  for (let n = bass + 5; n <= bass + 26; n++) if (chord.pcs.includes(n % 12) && n % 12 !== chord.bass) pool.push(n);
  const out = [bass];
  const count = Math.min(4, pool.length);
  for (let i = 0; i < count; i++) {
    out.push(pool[Math.round((count === 1 ? 0 : i / (count - 1)) * (pool.length - 1))]);
  }
  return out;
}

const eighths = (order, accent) => order.map((i, k) => ({ i, b: k * 0.5, v: k === 0 ? accent : 0.33 }));

/** Figures as indices into the voicing, beats and velocities. */
export const FIGURES = {
  arp: {
    4: eighths([0, 1, 2, 3, 4, 3, 2, 1], 0.48),
    3: eighths([0, 1, 2, 3, 4, 3], 0.48),
  },
  'arp-slow': {
    4: [{ i: 0, b: 0, v: 0.46 }, { i: 2, b: 1, v: 0.33 }, { i: 3, b: 2, v: 0.35 }, { i: 4, b: 3, v: 0.32 }],
    3: [{ i: 0, b: 0, v: 0.46 }, { i: 2, b: 1, v: 0.33 }, { i: 4, b: 2, v: 0.32 }],
  },
  drift: {
    4: [{ i: [0, 1], b: 0, v: 0.4 }, { i: [2, 3], b: 2, v: 0.3 }],
    3: [{ i: [0, 1], b: 0, v: 0.4 }, { i: [2, 3], b: 1.5, v: 0.3 }],
  },
  rolled: {
    4: [{ i: [0, 1, 2, 3, 4], b: 0, v: 0.37, roll: 0.05 }, { i: 0, b: 2, v: 0.28 }],
    3: [{ i: [0, 1, 2, 3, 4], b: 0, v: 0.37, roll: 0.05 }],
  },
};

// Nobody plays dead on the grid, or at one dynamic. A few milliseconds and a
// few percent are the difference between a player and a music box.
const jitter = () => (Math.random() - 0.5) * 0.02;
const humanise = (v) => v * (1 + (Math.random() - 0.5) * 0.12);

function padNotes(chord) {
  const pool = [];
  for (let n = 52; n <= 71; n++) if (chord.pcs.includes(n % 12)) pool.push(n);
  return [pool[0], pool[Math.round((pool.length - 1) / 2)], pool[pool.length - 1]];
}

function makeBar(piece, chord, melody, { beat, shift = 0, bell = false, phraseEnd = false }) {
  const length = beat * piece.meter;
  // The pedal changes just after the next downbeat, so each chord rings into
  // the bass of the next one and never into its arpeggio.
  const pedal = length + 0.06;
  const tones = leftHand(chord, piece.lhLow ?? 36);
  const events = [];
  for (const step of FIGURES[piece.lh][piece.meter]) {
    const list = [].concat(step.i);
    list.forEach((idx, k) => {
      events.push({
        part: 'lh',
        voice: 'piano',
        note: tones[Math.min(idx, tones.length - 1)],
        vel: humanise(step.v),
        b: step.b,
        at: Math.max(step.b * beat + (step.roll ?? 0) * k + jitter(), 0),
        release: pedal,
      });
    });
  }
  if (melody) {
    melody.forEach((n, i) => {
      let vel = 0.6;
      if (i === 0) vel += 0.05;
      if (n.dur >= 2) vel += 0.03;
      if (phraseEnd && i === melody.length - 1) vel -= 0.07;
      const at = Math.max(n.beat * beat + jitter(), 0);
      events.push({
        part: 'melody',
        voice: 'piano',
        note: n.note + shift,
        vel: humanise(vel),
        b: n.beat,
        dur: n.dur,
        at,
        release: Math.max((n.beat + n.dur) * beat, pedal),
      });
      if (bell && n.note + shift + 12 <= 96) {
        events.push({ part: 'bell', voice: 'bell', note: n.note + shift + 12, vel: vel * 0.55, b: n.beat, at, release: pedal });
      }
    });
  }
  return { chord: chord.name, pcs: chord.pcs, length, events, padChord: chord };
}

function arrange(piece, mood) {
  const style = MOODS[mood] ?? MOODS.home;
  const beat = 60 / (piece.bpm * style.tempo);
  const melodic = piece.form.filter((s) => s !== 'intro');
  const highest = Math.max(...Object.values(piece.sections).flatMap((s) => s.melody.flat().map((n) => n.note)));
  // Out in the open the last statement of the tune sometimes goes up an
  // octave, which is the cheapest way to make a return feel like an arrival.
  const lift = style.lift && highest + 12 <= 88 && Math.random() < 0.4;
  const bars = [];
  let index = 0;
  for (const step of piece.form) {
    if (step === 'intro') {
      const { chords } = piece.sections.A;
      const count = piece.intro ?? chords.length;
      for (let i = 0; i < count; i++) bars.push(makeBar(piece, chords[i % chords.length], null, { beat }));
      continue;
    }
    const section = piece.sections[step];
    const last = index === melodic.length - 1;
    const bell = piece.bell || (style.bell && index > 0);
    section.chords.forEach((chord, i) => {
      bars.push(makeBar(piece, chord, section.melody[i], {
        beat,
        shift: lift && last ? 12 : 0,
        bell,
        phraseEnd: i === section.chords.length - 1,
      }));
    });
    index++;
  }

  // The final chord, rolled slowly and left to ring out.
  const end = piece.ending;
  const tones = leftHand(end.chord, piece.lhLow ?? 36);
  const ring = 8.5;
  const finale = {
    chord: end.chord.name,
    pcs: end.chord.pcs,
    length: ring,
    padChord: end.chord,
    events: [
      ...tones.map((note, k) => ({ part: 'lh', voice: 'piano', note, vel: humanise(0.34), b: 0, at: k * 0.07, release: ring - 1 })),
      { part: 'melody', voice: 'piano', note: end.note, vel: 0.5, b: 0, dur: piece.meter, at: tones.length * 0.07 + 0.05, release: ring - 1 },
    ],
  };
  bars.push(finale);

  // Pads hold across repeated chords instead of re-attacking every bar.
  if (piece.pad || style.pad) {
    for (let i = 0; i < bars.length; i++) {
      if (i > 0 && bars[i].chord === bars[i - 1].chord) continue;
      let span = 0;
      for (let k = i; k < bars.length && bars[k].chord === bars[i].chord; k++) span += bars[k].length;
      bars[i].pad = { notes: padNotes(bars[i].padChord), length: Math.min(span, bars[i] === finale ? 6 : span) };
    }
  }
  for (const bar of bars) delete bar.padChord;

  const duration = bars.reduce((sum, b) => sum + b.length, 0);
  return { name: piece.name, mood, scale: piece.scalePcs, meter: piece.meter, beat, duration, bars };
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

// Per context, because buffers and waves belong to the context that made them.
const noiseCache = new WeakMap();
const waveCache = new WeakMap();

function noiseBuffer(ctx) {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buffer);
  return buffer;
}

/**
 * The piano's tone as one waveform: a strong fundamental and a quickly falling
 * series above it, the spectrum of a string struck by felt rather than by a
 * bare hammer. The brightness that changes over a note's life is the filter's
 * job, not the wave's.
 */
function pianoWave(ctx) {
  const cached = waveCache.get(ctx);
  if (cached) return cached;
  const amps = [0, 1, 0.52, 0.3, 0.17, 0.11, 0.075, 0.05, 0.034, 0.022, 0.015, 0.01];
  const real = new Float32Array(amps.length);
  const imag = new Float32Array(amps);
  const wave = ctx.createPeriodicWave(real, imag);
  waveCache.set(ctx, wave);
  return wave;
}

/**
 * A reverb tail, built rather than recorded. The tail is progressively damped
 * so the top end dies first, as it does in a real space, and the two channels
 * are generated independently, which is where the width comes from.
 */
function reverbImpulse(ctx, { seconds, decay = 2.6, damp = 0.5, preDelay = 0 }) {
  const rate = ctx.sampleRate;
  const pre = Math.floor(preDelay * rate);
  const tail = Math.floor(seconds * rate);
  const buffer = ctx.createBuffer(2, pre + tail, rate);
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < tail; i++) {
      const t = i / tail;
      const env = (1 - t) ** decay;
      const k = damp * (1 - t * 0.88) + 0.02;
      lp += k * (Math.random() * 2 - 1 - lp);
      const v = lp * env;
      data[pre + i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
  }
  if (peak > 0) {
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] /= peak;
    }
  }
  return buffer;
}

function lfo(ctx, dest, { rate, depth, phase = 0 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = rate;
  gain.gain.value = depth;
  osc.connect(gain);
  gain.connect(dest);
  osc.start(ctx.currentTime + phase);
  return osc;
}

/**
 * Felt piano. Two strings per note a cent or two apart, which beat slowly
 * against each other the way a real unison does; a quick initial fall and then
 * a long ring, longer the lower the note; a lowpass that closes as the note
 * decays so it darkens while it fades; and a soft thump of felt on string.
 * `release` is when the damper comes down, in context time.
 */
function playPiano(ctx, dest, note, vel, when, release) {
  const t = Math.max(when, ctx.currentTime);
  const f = midi(note);
  const peak = 0.24 * vel ** 1.6;
  const high = clamp((note - 48) / 36, 0, 1);
  const ring = clamp(3 * 2 ** (-(note - 60) / 20), 0.8, 6.5);
  const lift = Math.max(release, t + 0.5);

  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(peak, t + 0.005);
  out.gain.setTargetAtTime(peak * 0.4, t + 0.005, 0.24 - high * 0.12);
  out.gain.setTargetAtTime(0, t + 0.45, ring);
  out.gain.setTargetAtTime(0, lift, 0.17);

  const felt = ctx.createBiquadFilter();
  felt.type = 'lowpass';
  felt.Q.value = 0.6;
  felt.frequency.setValueAtTime(Math.min(f * (3 + 9 * vel), 9000), t);
  felt.frequency.setTargetAtTime(Math.min(f * 1.8 + 300, 9000), t + 0.01, 0.4 + ring * 0.15);

  const pan = ctx.createStereoPanner();
  // Low notes a little to the left and high ones to the right: where they sit
  // from the piano stool.
  pan.pan.value = clamp((note - 62) / 48, -0.4, 0.4);
  out.connect(felt);
  felt.connect(pan);
  pan.connect(dest);

  const stop = lift + 1.4;
  const wave = pianoWave(ctx);
  const spread = 0.8 + Math.random() * 1.2;
  for (const sign of [-1, 1]) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = f;
    osc.detune.value = sign * spread;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(stop);
  }

  const thump = ctx.createBufferSource();
  thump.buffer = noiseBuffer(ctx);
  const tf = ctx.createBiquadFilter();
  tf.type = 'bandpass';
  tf.frequency.value = Math.min(f * 3, 4500);
  tf.Q.value = 1;
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(peak * 0.16, t);
  tg.gain.exponentialRampToValueAtTime(0.00001, t + 0.035);
  thump.connect(tf);
  tf.connect(tg);
  tg.connect(pan);
  thump.start(t, Math.random());
  thump.stop(t + 0.05);
}

/** Celesta: a nearly harmonic struck bar with a bright attack and short ring. */
function playBell(ctx, dest, note, vel, when) {
  const t = Math.max(when, ctx.currentTime);
  const f = midi(note);
  const peak = 0.11 * vel ** 1.4;
  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() - 0.5) * 0.8;
  pan.connect(dest);
  const partials = [[1, 1, 1.3], [2, 0.28, 0.55], [3, 0.1, 0.3], [4.17, 0.06, 0.18]];
  for (const [ratio, gain, tc] of partials) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * gain, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, tc);
    osc.connect(g);
    g.connect(pan);
    osc.start(t);
    osc.stop(t + tc * 8);
  }
}

/** A soft sustained chord that fades in under the piano and out again. */
function playPad(ctx, dest, notes, when, length, level) {
  const t = Math.max(when, ctx.currentTime);
  const hold = Math.max(length - 0.4, 2.8);
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(level, t + 2.6);
  out.gain.setValueAtTime(level, t + hold);
  out.gain.setTargetAtTime(0, t + hold, 1.3);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.4;
  out.connect(filter);
  filter.connect(dest);
  const stop = t + hold + 8;
  notes.forEach((note, i) => {
    const pan = ctx.createStereoPanner();
    pan.pan.value = (i / Math.max(notes.length - 1, 1) - 0.5) * 1.2;
    pan.connect(out);
    for (const [type, cents, gain] of [['triangle', -5, 0.5], ['sawtooth', 6, 0.14]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midi(note);
      osc.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = gain / notes.length;
      osc.connect(g);
      g.connect(pan);
      osc.start(t);
      osc.stop(stop);
    }
  });
}

// ---------------------------------------------------------------------------
// Scene mapping
// ---------------------------------------------------------------------------

/**
 * Mix weights from camera state. Values are 0–1 and do not need to sum to 1.
 * They choose the mood of the next piece and how far away it sounds.
 */
export function sceneWeights({
  viewFromEarth = false,
  kind = 'body',
  key = 'earth',
  distanceRadii = 4,
  fromSunKm = 1.5e8,
  earthDistanceKm = 1e6,
} = {}) {
  const AU = 149597870.7;
  const fromSunAU = fromSunKm / AU;
  const earthAlt = earthDistanceKm - 6371;
  const w = {
    home: 0, leave: 0, deep: 0, approach: 0,
    land: 0, alien: 0, void: 0, wonder: 0, awe: 0,
  };

  if (kind === 'black-hole') {
    w.void = 1;
    w.deep = 0.22;
    w.awe = smoothstep(60, 8, distanceRadii) * 0.45;
    w.wonder = w.awe * 0.5;
    return w;
  }

  if (kind === 'galaxy') {
    w.deep = 0.62;
    w.approach = smoothstep(16, 5, distanceRadii) * 0.4;
    w.awe = smoothstep(7, 2, distanceRadii);
    w.wonder = w.awe;
    return w;
  }

  const onEarth = viewFromEarth || (key === 'earth' && (distanceRadii < 1.12 || earthAlt < 120));
  if (onEarth) {
    w.home = 1;
    w.leave = smoothstep(40, 400, earthAlt) * 0.18;
    return w;
  }

  // Other stars and their planets are unfamiliar; ours is not. The Sun shares
  // the 'star' kind with the whole catalogue, so it is excluded by key.
  const exo = kind === 'exo-planet' || (kind === 'star' && key !== 'sun');
  const world = kind === 'body' || kind === 'moon';
  const target = world || exo || key === 'sun';

  const arriving = target ? smoothstep(90, 12, distanceRadii) : 0;
  const arrived = target ? smoothstep(9, 2.4, distanceRadii) : 0;

  // Leaving Earth, measured on a log scale because that is how the camera
  // moves — distance changes by factors, not by increments.
  if (earthAlt < 4e5 && fromSunAU < 1.3) {
    const gone = smoothstep(2.3, 4.8, Math.log10(Math.max(earthAlt, 1)));
    w.home = (1 - gone) * 0.95;
    w.deep = smoothstep(4.6, 5.6, Math.log10(Math.max(earthAlt, 1))) * 0.35;
    if (key === 'moon') {
      w.approach = arriving * 0.7;
      w.land = arrived * 0.85;
      w.awe = smoothstep(9, 2.5, distanceRadii) * 0.35;
    }
    w.leave = gone * (1 - w.land * 0.8) * (1 - w.approach * 0.3);
    w.wonder = w.awe;
    return w;
  }

  const far = smoothstep(1.5, 9, fromSunAU);
  w.deep = 0.35 + far * 0.55;
  w.leave = (1 - far) * 0.4;

  if (arriving > 0) {
    w.approach = arriving * 0.85 * (1 - arrived * 0.6);
    w.deep *= 1 - arriving * 0.45;
    w.awe = smoothstep(30, 4, distanceRadii) * 0.5;
  }
  if (arrived > 0) {
    w.land = arrived * 0.9;
    w.deep *= 1 - arrived * 0.7;
    w.leave *= 1 - arrived;
  }
  if (exo) {
    w.alien = smoothstep(40, 4, distanceRadii) * 0.9;
    w.approach *= 0.6;
    w.land *= 0.55;
    w.awe = Math.max(w.awe, smoothstep(20, 3, distanceRadii) * 0.6);
  }
  if (arrived > 0.5 && key === 'earth') {
    w.home = 0.7;
    w.land = 0;
  }
  w.wonder = w.awe;
  return w;
}

/** Which kind of piece the current place calls for. */
function moodOf(m) {
  const score = {
    home: (m.home ?? 0) + (m.land ?? 0) * 0.9,
    deep: (m.deep ?? 0) + (m.leave ?? 0) * 0.8,
    wonder: (m.approach ?? 0) * 0.7 + (m.awe ?? 0) + (m.wonder ?? 0) * 0.4,
    alien: (m.alien ?? 0) * 1.3,
    void: (m.void ?? 0) * 1.2,
  };
  let best = 'home';
  for (const [mood, v] of Object.entries(score)) if (v > score[best]) best = mood;
  return best;
}

function presenceOf(m) {
  const total = STEM_NAMES.reduce((sum, n) => sum + clamp(m[n] ?? 0, 0, 1), 0);
  return clamp(total / 0.3, 0, 1);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

// How far ahead of the audio clock bars are written. A whole bar goes down at
// once, so this only has to cover the timer's own lateness.
const LOOKAHEAD = 1.2;

/**
 * `context`, `autoResume` and `schedule` exist for the offline render tests,
 * which supply their own OfflineAudioContext and place pieces themselves. In
 * the app all three defaults are what you want.
 */
export function createAmbient({ context = null, autoResume = true, schedule = true } = {}) {
  let ctx = context;
  let master = null;
  let muted = false;
  let started = false;
  let timers = [];
  let parts = {};
  let glideScale = 1;
  let mix = {
    home: 1, leave: 0, deep: 0, approach: 0,
    land: 0, alien: 0, void: 0, wonder: 0, awe: 0,
  };
  let lastApply = -1e9;

  // The piece being played, and the silence after the last one.
  let current = null;
  let restUntil = 0;
  let restFrom = 0;
  let lastMood = null;
  const history = [];

  function later(ms, fn) {
    timers.push(setTimeout(fn, ms));
  }

  function choose(mood, name) {
    if (name && LIBRARY.has(name)) return LIBRARY.get(name);
    const list = (MOODS[mood] ?? MOODS.home).pieces.filter((n) => LIBRARY.has(n));
    // Not the last two played, where there is a choice: hearing a tune again
    // is the point, hearing it twice running is a loop.
    const fresh = list.filter((n) => !history.slice(-2).includes(n));
    const pool = fresh.length ? fresh : list;
    const pickName = pool[(Math.random() * pool.length) | 0];
    history.push(pickName);
    if (history.length > 6) history.shift();
    return LIBRARY.get(pickName);
  }

  function playBar(bar, t0) {
    for (const e of bar.events) {
      if (e.voice === 'bell') playBell(ctx, parts.bell, e.note, e.vel, t0 + e.at);
      else playPiano(ctx, parts.piano, e.note, e.vel, t0 + e.at, t0 + e.release);
    }
    if (bar.pad) playPad(ctx, parts.pad, bar.pad.notes, t0, bar.pad.length, 0.05);
  }

  function tick() {
    later(250, tick);
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    if (!current) {
      const mood = moodOf(mix);
      // Arriving somewhere that calls for different music cuts the silence
      // short, so a new place is greeted rather than waited out.
      const early = lastMood && mood !== lastMood && now - restFrom > 6;
      if (now < restUntil && !early) return;
      if (presenceOf(mix) < 0.05) return;
      current = { plan: arrange(choose(mood), mood), index: 0, nextAt: now + 0.2 };
      lastMood = mood;
    }
    while (current && current.nextAt < now + LOOKAHEAD) {
      // A throttled timer can come back late. Carry on from now rather than
      // writing every missed bar into the same instant.
      if (current.nextAt < now - 0.1) current.nextAt = now + 0.05;
      const bar = current.plan.bars[current.index];
      playBar(bar, current.nextAt);
      current.nextAt += bar.length;
      current.index++;
      if (current.index >= current.plan.bars.length) {
        const [lo, hi] = (MOODS[current.plan.mood] ?? MOODS.home).gap;
        restFrom = current.nextAt;
        restUntil = current.nextAt + lo + Math.random() * (hi - lo);
        current = null;
      }
    }
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : LEVEL;

    // How present the music is at all. Only reaches zero when every scene
    // weight does, which is how the score is silenced from outside.
    parts.presence = ctx.createGain();
    parts.presence.gain.value = 1;

    /*
     Tape. A few cents of slow pitch wander and a trace of flutter across the
     whole mix, reverb included. It is the quality that makes this kind of
     score sound remembered rather than played — a piano that is perfectly
     steady sounds like a demonstration of a piano.
     */
    const tape = ctx.createDelay(0.1);
    tape.delayTime.value = 0.015;
    lfo(ctx, tape.delayTime, { rate: 0.43, depth: 0.0007 });
    lfo(ctx, tape.delayTime, { rate: 0.067, depth: 0.0011, phase: 1.3 });
    lfo(ctx, tape.delayTime, { rate: 5.3, depth: 0.000018, phase: 0.4 });

    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowshelf';
    warmth.frequency.value = 220;
    warmth.gain.value = 1.5;
    const tilt = ctx.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 4200;
    tilt.gain.value = -3;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 11000;
    air.Q.value = 0.6;
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'highpass';
    rumble.frequency.value = 28;
    rumble.Q.value = 0.7;

    // Slow enough that it rides the level of a passage and never grabs an
    // individual note.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 20;
    glue.ratio.value = 2;
    glue.attack.value = 0.3;
    glue.release.value = 1.2;

    // A hard ceiling: unity below about -12 dBFS and an asymptote just under
    // full scale, so nothing the arrangement does can clip.
    const trim = ctx.createGain();
    trim.gain.value = 0.25;
    const ceiling = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(4.21 * x);
    }
    ceiling.curve = curve;
    const makeup = ctx.createGain();
    makeup.gain.value = 0.95;

    parts.presence.connect(tape);
    tape.connect(rumble);
    rumble.connect(warmth);
    warmth.connect(tilt);
    tilt.connect(air);
    air.connect(glue);
    glue.connect(master);
    master.connect(trim);
    trim.connect(ceiling);
    ceiling.connect(makeup);
    makeup.connect(ctx.destination);

    // A room for the piano to stand in, and a hall for distance. How much of
    // the hall it gets is the one thing that follows the camera continuously.
    const room = ctx.createConvolver();
    room.buffer = reverbImpulse(ctx, { seconds: 2.2, decay: 2.4, damp: 0.5, preDelay: 0.01 });
    const roomSend = ctx.createGain();
    roomSend.gain.value = 0.32;
    const roomOut = ctx.createGain();
    roomOut.gain.value = 0.6;
    roomSend.connect(room);
    room.connect(roomOut);
    roomOut.connect(parts.presence);

    const hall = ctx.createConvolver();
    hall.buffer = reverbImpulse(ctx, { seconds: 9, decay: 3, damp: 0.32, preDelay: 0.05 });
    parts.hallSend = ctx.createGain();
    parts.hallSend.gain.value = 0.3;
    const hallOut = ctx.createGain();
    hallOut.gain.value = 0.55;
    parts.hallSend.connect(hall);
    hall.connect(hallOut);
    hallOut.connect(parts.presence);

    const dry = ctx.createGain();
    dry.gain.value = 0.8;
    dry.connect(parts.presence);

    parts.piano = ctx.createGain();
    parts.piano.connect(dry);
    parts.piano.connect(roomSend);
    parts.piano.connect(parts.hallSend);

    parts.bell = ctx.createGain();
    parts.bell.connect(dry);
    const bellHall = ctx.createGain();
    bellHall.gain.value = 1.6;
    parts.bell.connect(bellHall);
    bellHall.connect(parts.hallSend);

    parts.pad = ctx.createGain();
    parts.pad.connect(dry);
    const padHall = ctx.createGain();
    padHall.gain.value = 1.4;
    parts.pad.connect(padHall);
    padHall.connect(parts.hallSend);
  }

  async function start() {
    if (started) {
      if (autoResume && ctx.state === 'suspended') await ctx.resume();
      return;
    }
    started = true;
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    build();
    // The first piece begins almost at once, so turning the music on is heard
    // to have done something.
    restUntil = ctx.currentTime + 2;
    if (schedule) later(300, tick);
    lastApply = -1e9;
    apply();
    if (autoResume && ctx.state === 'suspended') await ctx.resume();
  }

  function apply() {
    const now = ctx.currentTime;
    parts.presence.gain.cancelScheduledValues(now);
    parts.presence.gain.setTargetAtTime(presenceOf(mix), now, 4.5 * glideScale);
    // Further away in empty places: the same piano, heard across a larger room.
    const vast = clamp(mix.deep * 0.8 + mix.void + mix.leave * 0.5
      + mix.awe * 0.6 + mix.alien * 0.5, 0, 1.6);
    parts.hallSend.gain.cancelScheduledValues(now);
    parts.hallSend.gain.setTargetAtTime(clamp(0.22 + vast * 0.38, 0.22, 0.8), now, 4.5 * glideScale);
  }

  function updateScene(next) {
    if (!next) return;
    mix = { ...mix, ...next };
    if (!started || !ctx) return;
    if (ctx.currentTime - lastApply < 0.75) return;
    lastApply = ctx.currentTime;
    apply();
  }

  function setMuted(value) {
    const was = muted;
    muted = value;
    if (master && ctx) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(muted ? 0 : LEVEL, now, 0.35);
      // Turned off mid-piece, the piece is abandoned; turned back on, a new one
      // starts shortly rather than resuming halfway through a phrase.
      if (muted) current = null;
      else if (was) restUntil = ctx.currentTime + 1.5;
    }
    if (!muted) start();
  }

  function dispose() {
    for (const id of timers) clearTimeout(id);
    timers = [];
    if (ctx && ctx.close) ctx.close();
    ctx = null;
    started = false;
  }

  return {
    start,
    setMuted,
    updateScene,
    dispose,
    get muted() { return muted; },
    // For the offline render tests, which have no wall clock and place the
    // music themselves.
    _internals: {
      get ctx() { return ctx; },
      get parts() { return parts; },
      pieces: [...LIBRARY.keys()],
      errors: PIECE_ERRORS,
      moods: Object.fromEntries(Object.entries(MOODS).map(([k, v]) => [k, v.pieces])),
      setGlideScale(v) { glideScale = v; },
      mood() { return moodOf(mix); },
      /** Arrange a piece without playing it, to read what would be played. */
      planPiece(name, mood) { return arrange(choose(mood ?? moodOf(mix), name), mood ?? moodOf(mix)); },
      /** Write a whole piece into the context starting at `at` seconds. */
      renderPiece(name, at = 0) {
        const mood = moodOf(mix);
        const plan = arrange(choose(mood, name), mood);
        let t = at;
        for (const bar of plan.bars) {
          playBar(bar, t);
          t += bar.length;
        }
        return { name: plan.name, mood, duration: t - at };
      },
      /** Jump straight to a mix, for offline rendering where time does not pass. */
      snap(next) {
        mix = { ...Object.fromEntries(Object.keys(mix).map((k) => [k, 0])), ...next };
        lastApply = -1e9;
        apply();
      },
    },
  };
}
