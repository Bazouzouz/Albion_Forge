// EU server cities supported for market price comparison.
// Each entry maps the display name to the API identifier used by albion-online-data.com.

export const CITIES = [
  { id: 'Fort Sterling',  label: 'Fort Sterling',  region: 'highlands' },
  { id: 'Lymhurst',       label: 'Lymhurst',       region: 'forest'    },
  { id: 'Bridgewatch',    label: 'Bridgewatch',    region: 'steppe'    },
  { id: 'Martlock',       label: 'Martlock',       region: 'mountain'  },
  { id: 'Thetford',       label: 'Thetford',       region: 'swamp'     },
  { id: 'Caerleon',       label: 'Caerleon',       region: 'center'    },
  { id: 'Brecilien',      label: 'Brecilien',      region: 'forest'    },
];

// City that grants a +15% refining return bonus for each resource type.
// Matches the City Heart faction in items.js.
export const BONUS_CITY = {
  ORE:   'Fort Sterling',
  WOOD:  'Lymhurst',
  FIBER: 'Bridgewatch',
  HIDE:  'Thetford',
};

export const CITY_IDS = CITIES.map(c => c.id);
