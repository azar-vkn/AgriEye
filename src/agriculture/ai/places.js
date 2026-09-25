// Place resolution for the agent and search: states and Census 2011
// districts from the boundary index, plus common alternative spellings and
// post-2011 districts mapped to the 2011 district that contains them.

export const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STATE_ALIASES = {
  'tamil-nadu': ['tamilnadu'],
  odisha: ['orissa'],
  puducherry: ['pondicherry', 'pondy'],
  'jammu-and-kashmir': ['j and k', 'kashmir'],
  uttarakhand: ['uttaranchal'],
};

// alias → [2011 district name, note when the alias is a newer district]
const DISTRICT_ALIASES = {
  'tamil-nadu': {
    tuticorin: ['Thoothukkudi'],
    thoothukudi: ['Thoothukkudi'],
    kanyakumari: ['Kanniyakumari'],
    trichy: ['Tiruchirappalli'],
    tiruchi: ['Tiruchirappalli'],
    tiruchirapalli: ['Tiruchirappalli'],
    villupuram: ['Viluppuram'],
    virudhunagar: ['Virudunagar'],
    nagapattinam: ['Nagappattinam'],
    tiruvallur: ['Thiruvallur'],
    tiruvarur: ['Thiruvarur'],
    nilgiris: ['The Nilgiris'],
    ooty: ['The Nilgiris'],
    kanchipuram: ['Kancheepuram'],
    tirupur: ['Tiruppur'],
    tenkasi: ['Tirunelveli', 'Tenkasi (formed 2019) lies within the 2011 Tirunelveli district'],
    chengalpattu: ['Kancheepuram', 'Chengalpattu (formed 2019) lies within the 2011 Kancheepuram district'],
    kallakurichi: ['Viluppuram', 'Kallakurichi (formed 2019) lies within the 2011 Viluppuram district'],
    ranipet: ['Vellore', 'Ranipet (formed 2019) lies within the 2011 Vellore district'],
    tirupathur: ['Vellore', 'Tirupathur (formed 2019) lies within the 2011 Vellore district'],
    mayiladuthurai: ['Nagappattinam', 'Mayiladuthurai (formed 2020) lies within the 2011 Nagappattinam district'],
  },
};

/** Build a searchable place list from the boundary index. */
export function buildPlaceIndex(index) {
  const places = [{ kind: 'country', id: 'india', name: 'India', keys: ['india', 'bharat'] }];
  for (const state of index?.states || []) {
    places.push({
      kind: 'state',
      id: state.id,
      name: state.name,
      bbox: state.bbox,
      keys: [normalize(state.name), ...(STATE_ALIASES[state.id] || [])],
    });
    const aliases = DISTRICT_ALIASES[state.id] || {};
    for (const district of state.districts) {
      const keys = [normalize(district.name)];
      if (district.name.startsWith('The ')) keys.push(normalize(district.name.slice(4)));
      const notes = {};
      for (const [alias, [target, note]] of Object.entries(aliases))
        if (target === district.name) {
          keys.push(alias);
          if (note) notes[alias] = note;
        }
      places.push({
        kind: 'district',
        id: district.id,
        name: district.name,
        stateId: state.id,
        stateName: state.name,
        bbox: district.bbox,
        centroid: district.centroid,
        keys,
        notes,
      });
    }
  }
  return places;
}

/**
 * Every place named in `text`, longest names first, without overlaps.
 * @returns {Array<{place:object, key:string, note?:string}>}
 */
export function findPlaces(places, text) {
  const haystack = ` ${normalize(text)} `;
  const hits = [];
  for (const place of places)
    for (const key of place.keys) {
      const at = haystack.indexOf(` ${key} `);
      if (at >= 0) hits.push({ place, key, at, end: at + key.length, note: place.notes?.[key] });
    }
  hits.sort((a, b) => b.key.length - a.key.length || a.at - b.at);
  const taken = [];
  const result = [];
  for (const hit of hits) {
    if (taken.some(([s, e]) => hit.at < e && hit.end > s)) continue;
    if (result.some((r) => r.place.id === hit.place.id)) continue;
    taken.push([hit.at, hit.end]);
    result.push(hit);
  }
  return result.sort((a, b) => a.at - b.at);
}

/** Ranked suggestions for a partial search query. */
export function searchPlaces(places, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  for (const place of places) {
    let best = Infinity;
    for (const key of place.keys) {
      if (key === q) best = Math.min(best, 0);
      else if (key.startsWith(q)) best = Math.min(best, 1);
      else if (key.includes(` ${q}`)) best = Math.min(best, 2);
      else if (key.includes(q)) best = Math.min(best, 3);
    }
    if (best < Infinity)
      scored.push({ place, score: best + (place.kind === 'district' ? 0.5 : place.kind === 'state' ? 0.2 : 0) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map((entry) => entry.place);
}
