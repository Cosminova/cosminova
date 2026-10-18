/**
 * Planet classification and appearance.
 *
 * A catalogue entry for an exoplanet gives at most a mass, a radius, an orbit
 * and an equilibrium temperature. Everything you would need to draw it — colour,
 * whether it has an ocean, whether the poles are frozen, how thick the air is —
 * has to be inferred. Inventing those directly produces either a uniform field
 * of grey balls or a circus, so this follows the composable scheme SpaceEngine
 * uses, where a planet's class is the product of four independent axes and the
 * appearance falls out of the class:
 *
 *   [temperature] [volatiles] [mass prefix][bulk composition]
 *
 * The numeric boundaries are physical rather than decorative. 90 K is where
 * nitrogen and methane liquefy, 170 K the water snow line, 250 K Earth's
 * equilibrium temperature and roughly the floor for a temperate surface, 330 K
 * near Earth's maximum and the assumed onset of a runaway greenhouse. The
 * higher two are admittedly arbitrary.
 *
 * Anything not measured is drawn from a hash of the planet's name, so a given
 * planet looks the same on every visit and on every machine, and two planets in
 * a system never come out identical.
 */

const EARTH_RADIUS_KM = 6371;
const EARTH_DENSITY = 5.51; // g/cm3

// --- deterministic per-planet randomness ---------------------------------

/** FNV-1a, so a name maps to a stable 32-bit seed independent of the platform. */
export function hashName(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small deterministic generator, so draws are repeatable and independent. */
export function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// --- the four axes --------------------------------------------------------

const TEMPERATURE_BANDS = [
  [90, 'frigid'],
  [170, 'cold'],
  [250, 'cool'],
  [330, 'temperate'],
  [500, 'warm'],
  [1000, 'hot'],
  [Infinity, 'torrid'],
];

export function temperatureClass(kelvin) {
  for (const [ceiling, name] of TEMPERATURE_BANDS) if (kelvin < ceiling) return name;
  return 'torrid';
}

/**
 * Bulk composition from density, with mass deciding which family of thresholds
 * applies. Density is the only handle on interior composition there is: a planet
 * denser than iron-rock cannot be anything but metal-rich, and one much less
 * dense than rock must be carrying ice or gas.
 */
export function bulkClass({ massEarth, radiusEarth, densityGcc }) {
  const density =
    densityGcc ?? (massEarth && radiusEarth ? EARTH_DENSITY * (massEarth / radiusEarth ** 3) : null);

  // Above about 2 Jupiter radii nothing is a planet, and above ~50 Earth masses
  // at low density the envelope is hydrogen and helium.
  if (radiusEarth >= 8 || (massEarth ?? 0) >= 50) {
    return (massEarth ?? 0) >= 100 || radiusEarth >= 9 ? 'jupiter' : 'neptune';
  }
  if (radiusEarth >= 3.5) return 'neptune';
  if (density === null) return radiusEarth >= 1.8 ? 'neptune' : 'terra';
  if (density > 7.5) return 'ferria';
  if (density < 3.2) return 'aquaria';
  return 'terra';
}

const MASS_PREFIXES = {
  solid: [
    [0.002, 'micro'],
    [0.02, 'mini'],
    [0.2, 'sub'],
    [2, ''],
    [10, 'super'],
    [Infinity, 'mega'],
  ],
  neptune: [
    [4, 'mini'],
    [10, 'sub'],
    [25, ''],
    [62.5, 'super'],
    [Infinity, 'mega'],
  ],
  // In Jupiter masses.
  jupiter: [
    [0.2, 'sub'],
    [2, ''],
    [10, 'super'],
    [Infinity, 'mega'],
  ],
};

export function massPrefix(bulk, massEarth) {
  if (!massEarth) return '';
  const family = bulk === 'jupiter' ? 'jupiter' : bulk === 'neptune' ? 'neptune' : 'solid';
  const value = family === 'jupiter' ? massEarth / 317.8 : massEarth;
  for (const [ceiling, prefix] of MASS_PREFIXES[family]) if (value < ceiling) return prefix;
  return '';
}

/**
 * Volatiles: the atmosphere and any surface liquid, taken together, since one
 * cannot exist without the other. Nothing in the catalogue measures this for a
 * rocky planet, so it is inferred from temperature and gravity — a small warm
 * planet loses its air, a cool massive one keeps it — and the draw is
 * deterministic per planet.
 */
export function volatileClass({ bulk, temperatureK, massEarth, radiusEarth }, random) {
  if (bulk === 'jupiter' || bulk === 'neptune') return 'gaseous';

  // Escape velocity relative to Earth's, which is what sets whether an
  // atmosphere survives at a given temperature.
  const escape = massEarth && radiusEarth ? Math.sqrt(massEarth / radiusEarth) : 1;
  const retention = escape / Math.sqrt(Math.max(temperatureK, 20) / 255);

  if (retention < 0.55 || temperatureK > 900) return 'airless';
  if (temperatureK > 380) return 'desertic';
  if (temperatureK < 150) return random() < 0.25 ? 'desertic' : 'airless';

  // In the band where water can be liquid, how much of it there is is a genuine
  // unknown; ocean worlds are common in formation models, so the draw is not
  // heavily weighted against them.
  const draw = random();
  if (bulk === 'aquaria') return draw < 0.45 ? 'oceanic' : draw < 0.75 ? 'superoceanic' : 'marine';
  if (temperatureK > 330) return draw < 0.6 ? 'desertic' : draw < 0.85 ? 'lacustrine' : 'marine';
  if (draw < 0.18) return 'desertic';
  if (draw < 0.33) return 'lacustrine';
  if (draw < 0.68) return 'marine';
  if (draw < 0.92) return 'oceanic';
  return 'superoceanic';
}

// --- appearance -----------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const mixColour = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Hue rotation, saturation and lightness on an RGB triple.
 *
 * Two worlds of the same composition are not the same colour: how much dust is
 * on the plains, how oxidised the iron is and how long the surface has been
 * exposed all move the hue a little without changing what the rock is. Working
 * in HSV rather than scaling the channels keeps the shift a shift — scaling red
 * turns every mineral orange, whereas rotating the hue moves rust towards
 * ochre and basalt towards slate, which is what those surfaces actually do.
 */
function shift([r, g, b], { hue = 0, saturation = 1, value = 1 }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  let h = 0;
  if (span > 1e-6) {
    if (max === r) h = ((g - b) / span) % 6;
    else if (max === g) h = (b - r) / span + 2;
    else h = (r - g) / span + 4;
    h /= 6;
  }
  const s = clamp01((max > 1e-6 ? span / max : 0) * saturation);
  const v = clamp01(max * value);
  h = (h + hue + 1) % 1;

  const sector = h * 6;
  const i = Math.floor(sector);
  const f = sector - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/**
 * What the ground is made of, as the colour of its low plains, its uplands and
 * its highest exposed rock.
 *
 * Bulk composition — which is all the catalogue can tell you — fixes the
 * interior, not the surface. Mars and the Moon are both rock over iron and look
 * nothing alike, because what you see is the top few metres: how oxidised the
 * iron is, whether lava resurfaced the plains, whether organics or salts or
 * frost have collected on top. That is unmeasurable at interstellar distance,
 * so it is drawn per planet from these, weighted by the conditions each
 * mineralogy needs.
 */
const MINERALS = {
  // Fresh volcanic rock, the darkest common surface: the lunar maria.
  basalt: { low: [0.08, 0.08, 0.09], mid: [0.19, 0.19, 0.2], high: [0.44, 0.43, 0.45] },
  // Oxidised iron. Needs only a trace of atmosphere and a long time.
  rust: { low: [0.25, 0.11, 0.06], mid: [0.45, 0.22, 0.12], high: [0.7, 0.47, 0.33] },
  // Wind-laid silicate dust over anything else, which is most of Mars.
  ochre: { low: [0.3, 0.24, 0.15], mid: [0.51, 0.42, 0.26], high: [0.76, 0.69, 0.51] },
  // Vegetation. Only where there is liquid water and a temperate surface.
  verdant: { low: [0.12, 0.21, 0.1], mid: [0.27, 0.35, 0.15], high: [0.57, 0.53, 0.39] },
  // Olivine and serpentine, the green-grey of ultramafic crust.
  jade: { low: [0.1, 0.19, 0.17], mid: [0.23, 0.37, 0.31], high: [0.55, 0.62, 0.55] },
  // Volcanic sulphur, as on Io: brilliant yellow, and it needs the heat.
  sulphur: { low: [0.35, 0.26, 0.07], mid: [0.64, 0.53, 0.13], high: [0.88, 0.82, 0.42] },
  // Organic haze fallout. Titan's colour, and it wants cold and an atmosphere.
  tholin: { low: [0.28, 0.15, 0.07], mid: [0.56, 0.32, 0.13], high: [0.82, 0.61, 0.33] },
  // Water and nitrogen frost.
  frost: { low: [0.45, 0.51, 0.58], mid: [0.69, 0.75, 0.81], high: [0.93, 0.96, 0.99] },
  // Carbon. The old carbon-planet idea, and the colour of a burnt-out surface.
  graphite: { low: [0.05, 0.05, 0.06], mid: [0.11, 0.11, 0.12], high: [0.27, 0.26, 0.28] },
  // Feldspar highlands: the pale pink-grey of the lunar far side.
  granite: { low: [0.29, 0.23, 0.22], mid: [0.48, 0.41, 0.39], high: [0.74, 0.68, 0.63] },
  // Evaporite flats, left where a sea has gone.
  saline: { low: [0.41, 0.39, 0.34], mid: [0.64, 0.62, 0.56], high: [0.9, 0.89, 0.84] },
};

/** Weighted draw over the mineralogies the conditions allow. */
function mineralFor({ bulk, temperatureK, volatiles, oceanLevel }, random) {
  const weights = new Map();
  const add = (name, weight) => weights.set(name, (weights.get(name) ?? 0) + weight);

  if (bulk === 'ferria') {
    add('rust', 3);
    add('basalt', 2);
    add('granite', 1.2);
    add('graphite', 0.6);
  } else if (bulk === 'aquaria') {
    add('frost', 2.6);
    add('jade', 1.4);
    add('saline', 1.2);
    add('ochre', 0.8);
  } else {
    add('basalt', 2);
    add('ochre', 2.2);
    add('rust', 1.8);
    add('granite', 1.4);
    add('jade', 1);
  }

  if (temperatureK < 150) {
    add('frost', 3);
    add('tholin', volatiles === 'airless' ? 0.6 : 2);
    add('graphite', 0.5);
  } else if (temperatureK < 260) {
    add('frost', 1.2);
    add('tholin', 0.9);
    add('saline', 0.6);
  } else if (temperatureK > 700) {
    add('graphite', 2.4);
    add('basalt', 2);
    add('sulphur', 1.6);
  } else if (temperatureK > 420) {
    add('sulphur', 1.6);
    add('basalt', 1.4);
    add('rust', 1);
  }
  // Life is the one surface colour with a hard precondition: standing water at
  // a temperature where it stays standing.
  if (oceanLevel > 0 && temperatureK > 250 && temperatureK < 330) add('verdant', 2.6);
  if (oceanLevel > 0.3) add('saline', 0.8);
  if (volatiles === 'airless') {
    add('basalt', 1.5);
    add('graphite', 0.7);
    weights.delete('verdant');
    weights.delete('tholin');
  }

  let total = 0;
  for (const weight of weights.values()) total += weight;
  let draw = random() * total;
  for (const [name, weight] of weights) {
    draw -= weight;
    if (draw <= 0) return MINERALS[name];
  }
  return MINERALS.basalt;
}

/**
 * Eight stops from the deepest sea to the highest peak, the same ordering
 * SpaceEngine's surface palettes use. Anything without an ocean simply never
 * samples the first stops.
 */
function rockPalette({ bulk, temperatureK, volatiles, oceanLevel, life, starTeff }, random) {
  const mineral = mineralFor({ bulk, temperatureK, volatiles, oceanLevel }, random);
  // Half of all worlds show two crusts, not one: dark lowland lava under pale
  // highland, rust plains under grey mountains, as the Moon and Mars both do.
  const second = random() < 0.5 ? mineralFor({ bulk, temperatureK, volatiles, oceanLevel }, random) : mineral;
  // One shift for the whole palette, so the stops stay a set rather than
  // drifting apart into a surface that cannot have formed.
  const weathering = {
    hue: (random() - 0.5) * 0.14,
    saturation: 0.65 + random() * 0.8,
    value: 0.78 + random() * 0.45,
  };
  const low = shift(mineral.low, weathering);
  const mid = shift(mineral.mid, weathering);
  const high = shift(mineral.high, weathering);
  const highland = shift(second.mid, weathering);

  // Whatever the sea is made of. Below the water line it can only be methane
  // and ethane, which are the colour of weak tea over a dark bed, not blue.
  // Water ranges from the navy of open ocean to teal over shallow banks and
  // green where it is thick with algae.
  const hydrocarbon = temperatureK < 200;
  const waterHue = { hue: (random() - 0.5) * 0.1, saturation: 0.75 + random() * 0.5, value: 0.8 + random() * 0.6 };
  let sea = hydrocarbon ? [0.05, 0.035, 0.025] : shift([0.02, 0.05, 0.12], waterHue);
  let shelf = hydrocarbon ? [0.12, 0.09, 0.05] : shift([0.05, 0.14, 0.25], waterHue);
  if (life === 'unicellular' && !hydrocarbon && random() < 0.5) {
    sea = mixColour(sea, [0.02, 0.07, 0.05], 0.6);
    shelf = mixColour(shelf, [0.08, 0.2, 0.12], 0.5);
  }

  let lowland = low;
  let desert = mixColour(mixColour(low, mid, 0.8), highland, second === mineral ? 0 : 0.6);
  if (life === 'multicellular' || life === 'exotic') {
    // Vegetation over the wetter lowlands; the dry interiors stay bare rock.
    lowland = vegetationFor(starTeff, random, life === 'exotic');
    desert = mixColour(desert, lowland, 0.15);
  }

  return {
    sea,
    shelf,
    beach: mixColour(mid, high, 0.5),
    desert,
    lowland,
    upland: mid,
    rock: mixColour(mid, high, 0.25),
    snow: mixColour(high, [0.93, 0.95, 0.97], temperatureK < 260 ? 0.7 : 0.45),
  };
}

/**
 * Plant colour by the light it grows under. Leaves absorb where their star is
 * brightest and reflect the rest, so under a hotter star than the Sun they may
 * come out blue-green, under a K dwarf yellow-olive, and under the deep red
 * light of an M dwarf dark red or nearly black. Exotic biochemistry can be
 * anything at all.
 */
function vegetationFor(starTeff = 5772, random, exotic) {
  if (exotic) {
    return shift([0.32, 0.12, 0.3], { hue: random(), saturation: 0.7 + random() * 0.5, value: 0.6 + random() * 0.6 });
  }
  const base = starTeff > 6300 ? [0.07, 0.22, 0.2]
    : starTeff > 5200 ? [0.1, 0.23, 0.07]
      : starTeff > 4000 ? [0.24, 0.24, 0.07]
        : random() < 0.5 ? [0.22, 0.06, 0.07] : [0.1, 0.06, 0.12];
  return shift(base, { hue: (random() - 0.5) * 0.06, saturation: 0.8 + random() * 0.5, value: 0.8 + random() * 0.4 });
}

/**
 * What the air is made of and how much of it there is, in bar. Unmeasured for
 * every rocky exoplanet, so it follows the three atmospheres the Solar System
 * offers — nitrogen with whatever life has added, carbon dioxide that never
 * found an ocean to dissolve into, nitrogen and methane where it is cold enough
 * for the methane to stay — scaled by what the planet can hold.
 */
function atmosphereOf({ gaseous, bulk, volatiles, temperatureK, life, massEarth, radiusEarth }, random) {
  const pick = (gases) => {
    const total = gases.reduce((sum, [, v]) => sum + v, 0);
    return gases.map(([name, v]) => [name, (v / total) * 100]).sort((a, b) => b[1] - a[1]);
  };
  if (gaseous) {
    const ice = bulk === 'neptune';
    const extra = temperatureK < 150 ? ['NH₃', 0.03] : temperatureK < 400 ? ['H₂O', 0.4] : temperatureK < 1400 ? ['Na/K', 0.01] : ['SiO', 0.05];
    return {
      pressureBar: null,
      gases: pick([['H₂', ice ? 80 : 86], ['He', ice ? 15 : 13], ['CH₄', ice ? 2 + random() * 3 : 0.3], extra]),
    };
  }
  if (volatiles === 'airless') return null;
  const gravity = massEarth && radiusEarth ? massEarth / (radiusEarth * radiusEarth) : 1;
  const hold = Math.min(Math.max(gravity, 0.2), 3);
  if (temperatureK < 200) {
    return { pressureBar: (0.4 + random() * 2.5) * hold, gases: pick([['N₂', 90 + random() * 8], ['CH₄', 2 + random() * 6], ['Ar', random()]]) };
  }
  if (volatiles === 'desertic' && temperatureK > 380) {
    const thick = random() < 0.6;
    return {
      pressureBar: thick ? (8 + random() * 110) * hold : (0.01 + random() * 0.5) * hold,
      gases: pick([['CO₂', 92 + random() * 6], ['N₂', 2 + random() * 4], ['SO₂', 0.02 + random() * 0.2]]),
    };
  }
  if (volatiles === 'desertic') {
    return { pressureBar: (0.004 + random() * 0.4) * hold, gases: pick([['CO₂', 90 + random() * 6], ['N₂', 2 + random() * 3], ['Ar', 1 + random() * 2]]) };
  }
  if (life === 'multicellular') {
    return {
      pressureBar: (0.6 + random() * 1.4) * hold,
      gases: pick([['N₂', 70 + random() * 12], ['O₂', 15 + random() * 12], ['Ar', 0.5 + random()], ['H₂O', 0.5 + random() * 2], ['CO₂', 0.03 + random() * 0.2]]),
    };
  }
  return {
    pressureBar: (0.4 + random() * 2.2) * hold,
    gases: pick([['N₂', 60 + random() * 30], ['CO₂', 1 + random() * 20], ['H₂O', 0.5 + random() * 3], ['Ar', random()], ...(life === 'unicellular' ? [['CH₄', 0.05 + random() * 0.5]] : [])]),
  };
}

/**
 * Cloud-top colours for the gas families, by Sudarsky's classes: which
 * condensate forms the visible deck is set by temperature, and each one is a
 * different-looking planet.
 *
 *   I    below ~150 K, ammonia ice over hydrocarbon haze: Jupiter's creams and browns
 *   II   to ~350 K, water cloud: bright and nearly white
 *   III  to ~850 K, too warm for cloud at all: a clear deep atmosphere, azure
 *   IV   to ~1400 K, alkali metals absorb the red, silicate haze above: dark blue,
 *        as HD 189733 b is measured to be
 *   V    hotter, silicate and iron cloud high up: dark grey-brown, and past
 *        2000 K the night side glows
 *
 * Ice giants follow methane rather than ammonia, so the cold ones are the
 * cyan of Uranus and the blue of Neptune. Every planet then gets its own hue,
 * saturation and band contrast, since giants of one class are no more alike
 * than Jupiter and Saturn are.
 */
const JOVIAN = [
  [60, [0.86, 0.8, 0.66]],
  [150, [0.84, 0.7, 0.52]],
  [260, [0.9, 0.88, 0.84]],
  [380, [0.78, 0.84, 0.9]],
  [600, [0.36, 0.55, 0.88]],
  [900, [0.26, 0.4, 0.78]],
  [1250, [0.17, 0.25, 0.52]],
  [1600, [0.3, 0.24, 0.24]],
  [2200, [0.42, 0.22, 0.14]],
  [3000, [0.5, 0.2, 0.1]],
];
const ICE_GIANT = [
  [50, [0.6, 0.82, 0.88]],
  [90, [0.48, 0.72, 0.9]],
  [180, [0.32, 0.5, 0.88]],
  [350, [0.68, 0.76, 0.84]],
  [700, [0.44, 0.58, 0.8]],
  [1100, [0.26, 0.32, 0.5]],
  [1600, [0.34, 0.24, 0.22]],
  [3000, [0.46, 0.22, 0.14]],
];

function alongTemperature(table, t) {
  if (t <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (t <= table[i][0]) {
      const [t0, c0] = table[i - 1];
      const [t1, c1] = table[i];
      return mixColour(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return table[table.length - 1][1];
}

function giantPalette(temperatureK, random, bulk = 'jupiter') {
  const raw = alongTemperature(bulk === 'neptune' ? ICE_GIANT : JOVIAN, temperatureK);
  // Now and then a giant whose chemistry is not the usual: olive, teal,
  // violet or rose cloud decks, from hazes nobody has yet measured.
  const exotic = random() < 0.22;
  const base = shift(raw, {
    hue: exotic ? (random() - 0.5) * 0.8 : (random() - 0.5) * 0.09,
    saturation: 0.75 + random() * 0.55,
    value: 0.9 + random() * 0.2,
  });
  // Band depth varies more than anything else between real giants: Jupiter's
  // belts are about twice the depth of its zones, Uranus is almost blank. A
  // cloudless class III world and a hazy hot one have little banding to show.
  const clear = temperatureK > 380 && temperatureK < 1500;
  const contrast = (bulk === 'neptune' ? 0.12 + random() * 0.3 : 0.25 + random() * 0.4) * (clear ? 0.55 : 1);
  const zone = base.map((c) => Math.min(c * (1 + contrast * 0.35), 1));
  const belt = base.map((c) => c * (1 - contrast));
  // Storms: red ovals on a cool jovian, white methane or water cloud on the
  // cold ones; a hot giant has no white condensate, only lighter eddies.
  let accent;
  if (temperatureK < 200 && bulk !== 'neptune') accent = mixColour(base, [0.75, 0.38, 0.24], 0.6);
  else if (temperatureK < 380) accent = mixColour(base, [0.95, 0.96, 0.98], 0.5);
  else accent = base.map((c) => Math.min(c * 1.12, 1));
  return {
    sea: base.map((c) => c * 0.55),
    shelf: base.map((c) => c * 0.65),
    beach: accent,
    desert: zone,
    lowland: belt,
    upland: base,
    rock: base.map((c) => c * 1.1),
    snow: base.map((c) => Math.min(c * 1.3, 1)),
  };
}

/**
 * How brightly a world glows in its own heat, and what colour. Rock starts
 * to glow dull red near a thousand kelvin and is orange by two thousand; a
 * giant's cloud deck hides the deep heat until it is hotter still.
 */
function heatOf(temperatureK, gaseous) {
  const onset = gaseous ? 1500 : 950;
  const full = gaseous ? 2600 : 2000;
  const glow = clamp01((temperatureK - onset) / (full - onset));
  const t = clamp01((temperatureK - 900) / 1800);
  return {
    heatGlow: glow * glow * (gaseous ? 0.9 : 1.6),
    heatColour: mixColour([0.9, 0.12, 0.03], [1.0, 0.52, 0.16], t),
  };
}

/**
 * Full description of a catalogue planet: its class, and the parameters the
 * surface renderer needs. Radius is the one thing usually measured, so it is
 * taken as given; mass and temperature fall back to relations rather than
 * being invented outright.
 */
const pickOf = (random, list) => list[Math.floor(random() * list.length) % list.length];

/** The colour photosynthesis would settle on under a star of this temperature. */
function foliageWord(starTeff = 5772) {
  if (starTeff < 3400) return 'near-black';
  if (starTeff < 4300) return 'purple and maroon';
  if (starTeff < 5300) return 'rust-red and amber';
  if (starTeff < 6500) return 'green';
  return 'blue-green and teal';
}

/**
 * A sentence on what lives there, built from the world's own conditions so
 * two planets with life rarely read alike. Drawn from its own stream, seeded
 * by the life roll, so adding words never reshuffles a planet's colours.
 */
function describeLife({ life, temperatureK, oceanLevel, starTeff, volatiles, radiusEarth, hydrocarbon }, seed) {
  const random = rng(Math.floor(seed * 4294967295) ^ 0x5f3759df);
  const cold = temperatureK < 265;
  const hot = temperatureK > 315;
  const heavy = radiusEarth > 1.4;
  const light = radiusEarth < 0.7;
  const watery = oceanLevel > 0.85;
  const dry = oceanLevel > 0 && oceanLevel < 0.3;
  const foliage = foliageWord(starTeff);
  const dim = (starTeff ?? 5772) < 4000;

  if (life === 'none') {
    if (oceanLevel > 0 && !hydrocarbon && temperatureK > 240 && temperatureK < 345) {
      return pickOf(random, [
        'None detected: sterile seas, prebiotic chemistry only',
        'None detected, though the tide pools are rich in amino acids',
        'None found: the oceans are habitable but empty',
        'None detected; organic films collect along the shores',
      ]);
    }
    return null;
  }

  if (life === 'unicellular') {
    const where = cold
      ? pickOf(random, ['in brine pockets under the sea ice', 'around hydrothermal vents beneath the ice', 'in meltwater channels near the equator'])
      : hot
        ? pickOf(random, ['as heat-loving mats around hot springs', 'in sulphur-rich shallows', 'deep in the crust where the rock stays cool'])
        : dry
          ? pickOf(random, ['as crusts on the shores of shrinking lakes', 'in salt flats and evaporite pans', 'in damp soil under desert stones'])
          : pickOf(random, ['as stromatolite reefs in the shallows', 'as seasonal plankton blooms that tint the seas', 'as slime mats along every coastline', 'drifting through the upper ocean']);
    const tone = pickOf(random, [
      'Microbial', 'Single-celled', 'Bacterial', 'Archaeal', 'Microbial, photosynthetic',
    ]);
    const extra = random() < 0.4
      ? pickOf(random, ['; oxygen is only beginning to build', '; methane-makers dominate', `; the blooms are ${dim ? 'dark red' : 'olive'}`, '; viruses outnumber cells ten to one'])
      : '';
    return `${tone}, ${where}${extra}`;
  }

  if (life === 'multicellular') {
    const land = watery
      ? pickOf(random, [
        'Complex marine life: kelp-like forests, reef builders and drifting grazers',
        'Ocean ecosystems only; floating mats of vegetation the size of islands',
        'Complex sea life; the few islands are ringed with mangrove-like thickets',
      ])
      : dry
        ? pickOf(random, [
          `Hardy ${foliage} scrub clustered around oases and river valleys`,
          `Succulent-like plants with ${foliage} skins; burrowing animals`,
          'Lichens and drought-sleeping shrubs; life crowds the lake shores',
        ])
        : cold
          ? pickOf(random, [
            `Tundra of low ${foliage} mosses; grazing herds migrate with the seasons`,
            `Boreal forests of ${foliage} conifer-analogues near the equator`,
            'Ice-edge ecosystems: algae under the floes, swimmers that feed on them',
          ])
          : hot
            ? pickOf(random, [
              `Dense ${foliage} rainforest under constant cloud`,
              `Heat-tolerant ${foliage} jungles with canopies hundreds of metres tall`,
              'Swamp forests and steaming wetlands, crowded with insect-analogues',
            ])
            : pickOf(random, [
              `Forests and grasslands of ${foliage} vegetation; animals on land and sea`,
              `${foliage[0].toUpperCase()}${foliage.slice(1)} forests, plains grazers and their predators`,
              `Temperate ${foliage} woodland; flying animals and coral-like reefs`,
              `Savannah of ${foliage} grasses broken by river forests`,
              `Mixed ${foliage} forest; burrowers, swimmers and gliding animals`,
            ]);
    const twist = random() < 0.55
      ? pickOf(random, [
        heavy ? '. High gravity keeps plants low and animals squat' : light ? '. Low gravity lets trees grow kilometre-tall' : '. Seasonal migrations cross whole continents',
        dim ? '. Leaves turn to face the dim red sun' : '. Bioluminescent shores at night',
        '. No sign of intelligence',
        '. Colonial organisms build reefs visible from orbit',
        '. Mound-building colonies dot the plains',
        '. Many species are hermaphroditic and sessile',
      ])
      : '';
    return `${land}${twist}`;
  }

  if (life === 'exotic') {
    if (hydrocarbon || temperatureK < 200) {
      return pickOf(random, [
        'Exotic: azotosome cells swimming in liquid methane',
        'Exotic: slow hydrocarbon-based films on the methane lakes',
        'Exotic: cryogenic life metabolising acetylene and hydrogen',
      ]);
    }
    if (volatiles === 'airless' || temperatureK > 380) {
      return pickOf(random, [
        'Exotic: silicon-based crusts that grow over centuries',
        'Exotic: sulphur-reducing organisms deep in the hot crust',
      ]);
    }
    return pickOf(random, [
      'Exotic biochemistry: ammonia-water solvent, chiral opposites of ours',
      'Exotic: mineral-eating organisms that weather the rock into spires',
      'Exotic: floating spore clouds in the lower atmosphere',
      'Exotic: arsenic-tolerant mats in the salt basins',
      'Exotic: organisms that photosynthesise in the infrared',
    ]);
  }

  if (life === 'aerial') {
    return pickOf(random, [
      'Floating organisms in the cloud deck',
      'Gas-bag organisms drifting in the temperate layer, some kilometres wide',
      'Airborne microbes that ride the convection cells',
      'Sky-plankton and the jellyfish-like floaters that graze on it',
      'Hydrogen-filled floaters; hunters dive through them from above',
    ]);
  }
  return null;
}

export function describePlanet(entry, { starTeff, aAu } = {}) {
  const random = rng(hashName(entry.name ?? 'unnamed'));

  const radiusEarth = entry.radiusEarth ?? (entry.massEarth ? entry.massEarth ** 0.29 : 1);
  // Equilibrium temperature if the archive has none: the standard relation for a
  // grey body at this distance from a star of this temperature, with Earth's
  // albedo assumed.
  const temperatureK =
    entry.equilibriumK ??
    (starTeff && aAu ? 0.7 * starTeff * Math.sqrt(0.00465047 / (2 * aAu)) : 255);

  const bulk = bulkClass({
    massEarth: entry.massEarth,
    radiusEarth,
    densityGcc: entry.densityGcc,
  });
  const temperature = temperatureClass(temperatureK);
  const volatiles = volatileClass(
    { bulk, temperatureK, massEarth: entry.massEarth, radiusEarth },
    random,
  );
  const prefix = massPrefix(bulk, entry.massEarth);
  const gaseous = bulk === 'jupiter' || bulk === 'neptune';

  const oceanLevel =
    volatiles === 'superoceanic' ? 0.93 : volatiles === 'oceanic' ? 0.68 : volatiles === 'marine' ? 0.45
      : volatiles === 'lacustrine' ? 0.2 : 0;
  // Life as SpaceEngine grades it: none, microbial, complex enough to colour
  // the land, or of a chemistry unlike ours. Liquid water at a temperate
  // surface is the only setting the first three are drawn for.
  const lifeRoll = random();
  let life = 'none';
  if (!gaseous && oceanLevel > 0 && temperatureK > 240 && temperatureK < 345) {
    life = lifeRoll < 0.55 ? 'multicellular' : lifeRoll < 0.85 ? 'unicellular' : 'none';
  } else if (!gaseous && volatiles !== 'airless' && temperatureK > 120 && temperatureK < 460 && lifeRoll < 0.07) {
    life = 'exotic';
  } else if (gaseous && temperatureK > 200 && temperatureK < 420 && lifeRoll < 0.04) {
    life = 'aerial';
  }
  const lifeNote = describeLife(
    { life, temperatureK, oceanLevel, starTeff, volatiles, radiusEarth, hydrocarbon: temperatureK < 200 },
    lifeRoll,
  );
  const palette = gaseous
    ? giantPalette(temperatureK, random, bulk)
    : rockPalette({ bulk, temperatureK, volatiles, oceanLevel, life, starTeff }, random);
  const air = atmosphereOf({ gaseous, bulk, volatiles, temperatureK, life, massEarth: entry.massEarth, radiusEarth }, random);
  // Ice reaches down from the poles once it is cold enough for water to freeze
  // on the surface, and covers the planet outright below the nitrogen line.
  const icecapLatitude =
    temperatureK > 330 ? 1 : temperatureK < 170 ? 0 : (temperatureK - 170) / 160;

  const label = [temperature, volatiles, `${prefix}${bulk}`].filter(Boolean).join(' ');

  return {
    lifeNote,
    ...heatOf(temperatureK, gaseous),
    // More, narrower belts on some giants than others, the way Saturn's
    // differ from Jupiter's.
    bandScale: gaseous ? 0.7 + random() * 0.9 : 0,
    label,
    temperature,
    volatiles,
    bulk,
    prefix,
    gaseous,
    life,
    air,
    oceanKind: oceanLevel > 0 ? (temperatureK < 200 ? 'methane and ethane' : 'water') : null,
    temperatureK,
    radiusEarth,
    radiusKm: radiusEarth * EARTH_RADIUS_KM,
    palette,
    oceanLevel,
    icecapLatitude,
    // Terrain vigour: small bodies keep their craters, large ones resurface, and
    // gas giants have no surface at all. Air erases the record twice over — it
    // burns up the small impactors and it weathers what the large ones leave —
    // and running water finishes the job, so a wet temperate world should not
    // read as a cratered one.
    craterDensity: gaseous
      ? 0
      : (radiusEarth < 0.6 ? 0.6 : 0.3 / radiusEarth)
        * (volatiles === 'airless' ? 1 : oceanLevel > 0 ? 0.12 : 0.4),
    roughness: gaseous ? 0 : 0.08 + random() * 0.1,
    cloudCover: gaseous ? 1 : volatiles === 'airless' ? 0 : 0.18 + random() * 0.37,
    // How the surface is laid out, which is as unmeasured as its colour. A few
    // large provinces or many small ones; a crater population sitting on a
    // coarse lattice or a fine one; sharp young craters or soft filled ones.
    // Left at one value each, every world of a class comes out with the same
    // continents in the same places.
    // The colour of the air seen edge on. Thin clear air over a cool world
    // scatters blue like Earth's; below the water line the haze is organic and
    // orange, as Titan's is; a hot thick one is the white-yellow of Venus.
    hazeTint: shift(
      temperatureK < 200
        ? [0.82, 0.55, 0.32]
        : temperatureK > 420
          ? [0.95, 0.82, 0.58]
          : [0.38, 0.58, 1],
      { hue: (random() - 0.5) * 0.06, saturation: 0.8 + random() * 0.5, value: 0.9 + random() * 0.2 },
    ),
    provinceScale: 1.5 + random() * 2.9,
    craterScale: 0.5 + random() * 1.3,
    craterDepth: gaseous ? 0 : 0.11 + random() * 0.19,
    // The same erasure, in how many scales of crater survive at all: airless
    // worlds keep the whole range, a thin dry air keeps the big ones, and an
    // ocean world or a Venus has only the odd large basin left.
    craterOctaves: (() => {
      const roll = random();
      if (gaseous) return 0;
      const bar = air?.pressureBar ?? 0;
      if (volatiles === 'airless' || bar < 0.01) return 5 + Math.floor(roll * 3);
      if (bar > 5) return Math.floor(roll * 2);
      if (oceanLevel > 0) return 1 + Math.floor(roll * 2);
      return 2 + Math.floor(roll * 3);
    })(),
    // Layered rock eroded into cliffs and benches: mesas on a dry world,
    // stepped canyon walls, nothing on airless ones with no weather to cut it.
    terrace: gaseous || volatiles === 'airless' ? 0 : (lifeRoll * 7.31) % 1,
    // Whichever way the planet ended up, its axis and rotation are unmeasured.
    tiltDeg: random() * 45,
    rotationHours: gaseous ? 8 + random() * 12 : 12 + random() * 60,
  };
}
