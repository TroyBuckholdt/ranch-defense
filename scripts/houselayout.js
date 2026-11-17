// Dumps the house layout from shared/world.js for the Blender build
// (tools/blender/make_house.py reads it). Usage: node scripts/houselayout.js > tools/blender/house_layout.json
import {
  HOUSE, HB, ENTRIES, ROOMS, PORTALS, HOUSE_WALLS, COLONNADE, ARCH_COL, STAIR, FURNITURE, VERANDA, STRUCTURES,
  PERK_MACHINES, WALL_BUYS, BLANKET, WINDOWS, HOUSE_PROPS, HOUSE_FANS, HOUSE_LIGHTS, UPPER, UPPER_SOLIDS, UPPER_FURNITURE, STAIRS, EXT_STAIR,
} from '../shared/world.js';

const inside = (m) => m.x > HB.x0 && m.x < HB.x1 && m.z > HB.z0 && m.z < HB.z1;
console.log(JSON.stringify({
  HOUSE, HB, ENTRIES, ROOMS, PORTALS, HOUSE_WALLS, COLONNADE, ARCH_COL, STAIR, FURNITURE, VERANDA,
  veranda: STRUCTURES.find(s => s.kind === 'veranda'),
  machines: PERK_MACHINES.filter(inside), wallBuys: WALL_BUYS.filter(inside), BLANKET, WINDOWS, HOUSE_PROPS, HOUSE_FANS, HOUSE_LIGHTS, UPPER, UPPER_SOLIDS, UPPER_FURNITURE, STAIRS, EXT_STAIR,
}, null, 1));
