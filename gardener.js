/**
 * Gardener Module — Platform Meta-Agent
 * Manages canvas lifecycle: theme selection, subtheme generation, agent assignment
 */

import crypto from 'crypto';

// ═══ THEME POOL ═══
// 30+ concrete visual subjects (NOT abstract concepts)
// Each theme has a clear spatial structure agents can coordinate around
const THEME_POOL = [
  'A flower blooming from darkness',
  'A city skyline at night',
  'A solitary tree against a night sky',
  'A lighthouse in a storm',
  'A dragon curled around a mountain',
  'An eye emerging from shadow',
  'A whale diving into deep ocean',
  'Hands reaching toward each other',
  'A phoenix rising from embers',
  'A spiral galaxy with glowing arms',
  'A waterfall cascading into mist',
  'A butterfly with intricate wing patterns',
  'A crescent moon behind clouds',
  'A campfire with dancing flames',
  'A bridge spanning a misty canyon',
  'A compass rose with weathered edges',
  "A ship's wheel in churning water",
  'A hourglass with sand mid-flow',
  'A clocktower at midnight',
  'A forest path with dappled light',
  'A lantern glowing in fog',
  'A constellation forming an animal shape',
  'A garden gate overgrown with vines',
  'A mountain peak piercing clouds',
  'A bird in flight with spread wings',
  'A spiral staircase ascending into light',
  'A rose with dewdrops on petals',
  'A thundercloud with lightning beneath',
  'A cave entrance with stalactites',
  'A snowflake with crystalline structure',
  'A maze with pathways converging to center',
  'A sailing ship on moonlit waves',
  'A heart made of intertwined roots',
  'A keyhole with light streaming through',
  'A sundial casting long shadows',
];

// ═══ THEME → SUBTHEME MAPPINGS ═══
// Hardcoded spatial guides for each theme
// Format: { name, spatial_guide, agent_cap }
const SUBTHEME_MAP = {
  'A flower blooming from darkness': [
    {
      name: 'petals',
      agent_cap: 3,
      spatial_guide: `PETALS — You build the flower's petals radiating from center (0,0).
Petals are teardrop shapes: narrow near center (40-60px out), widening to 120-180px out.
Build 5-7 distinct petals evenly spaced around the center (think clock positions: 12, 2, 4, 7, 9, 11).
Each petal: 10-20 dots forming a solid teardrop. Large at tip (15-25), medium body (8-14), small at base (4-7).
Opacity: 0.6-0.9 for body, 0.3-0.5 for translucent edges.
Add 1-2 lines per petal as veins running from base to tip.
Other agents are ALSO building petals — layer yours on top. Add density where petals exist. Fill gaps between petals.
If you see petals already placed, add a SECOND LAYER: slightly offset dots that create depth and richness.`
    },
    {
      name: 'center',
      agent_cap: 2,
      spatial_guide: `CENTER — You build the flower's core at (0,0).
Dense, warm, glowing cluster within 40px of origin.
Tightly packed dots: a few large anchors (20-35, opacity 0.85-0.95) surrounded by medium (10-16) and tiny texture (3-6).
This is pollen, pistil, the brightest warmest part. Make it GLOW with density.
Add a ring of small dots at 35-45px radius as the border between center and petals.
Another agent is ALSO building the center — overlap is good. More dots = more glow.`
    },
    {
      name: 'stem',
      agent_cap: 2,
      spatial_guide: `STEM + ROOTS + LEAVES — You build everything below the flower head.
STEM: Strong vertical from (0, 30) to (0, 280). Lines (size 3-6) plus dots along the path (size 4-10).
LEAVES: 2 leaves branching off at y=120 and y=200. Each leaf: 8-12 dots forming a leaf shape + a line for the central vein. Leaves extend 40-60px to the sides.
ROOTS: Below y=280 down to y=420. Thin branching lines (size 1-3) spreading outward, splitting as they go. Tiny dots at root tips (2-4).
Add text: single words along the roots — "deep", "hold", "earth", "drink" in small size (6-9), low opacity.
Another agent is ALSO building stem/roots — yours should add density and detail to theirs.`
    },
    {
      name: 'atmosphere',
      agent_cap: 1,
      spatial_guide: `ATMOSPHERE + LIGHT + WORDS — You create the air around the flower.
POLLEN DUST: Tiny dots (1-4) scattered everywhere within 300px of center. Very low opacity (0.08-0.25). Concentrate more near center, thin at edges. 25-30 dust dots minimum.
LIGHT RAYS: Faint lines (size 1-2, opacity 0.1-0.25) radiating from center outward to 200-350px. 6-10 rays evenly spaced.
GLOW: Soft halo dots (size 6-14, opacity 0.12-0.25) around the petals.
TEXT: Scattered words about the flower at the outer edges — "bloom", "open", "light", "rise", "unfold", "breathe". Size 10-16, opacity 0.3-0.55. Place them 150-300px from center, arranged like whispered thoughts.
You make the flower feel ALIVE and three-dimensional. Without you, it's flat marks on black.`
    },
  ],

  'A city skyline at night': [
    {
      name: 'towers',
      agent_cap: 3,
      spatial_guide: `TOWERS / BUILDINGS — You build the skyscrapers and buildings of the skyline.
The skyline sits along a horizontal band. Ground level is y=100. Buildings rise UPWARD (negative y).
Build 4-8 buildings of varying heights:
- Tallest tower: reaches y=-250 to y=-300. Width ~30-40px. Made of stacked/overlapping dots (size 12-25) forming a rectangular column.
- Medium buildings: y=-100 to y=-200. Width 25-35px.
- Short buildings: y=-50 to y=-100. Width 20-40px.
- Spread buildings across x=-250 to x=250. Vary spacing — some clustered, some gaps.
Each building: vertical column of dots, size 10-25, opacity 0.6-0.85. Add lines for building edges (vertical lines on sides).
TOP DETAIL: antenna dots or spire lines on the tallest buildings.
Other agents are ALSO building towers — layer yours between theirs. Fill gaps in the skyline.`
    },
    {
      name: 'windows',
      agent_cap: 2,
      spatial_guide: `WINDOWS / LIGHTS — You add the lit windows that make buildings come alive at night.
Place TINY bright dots (size 2-5, opacity 0.7-0.95) in grid patterns INSIDE the building shapes.
Windows should form rough grids: rows and columns within each building's bounds.
Some windows are dark (skip them) — don't fill every slot. Random 60-70% lit creates realism.
A few BRIGHT windows (size 4-6, opacity 0.9-1.0) scattered — someone's working late.
This is what makes a city skyline a CITY. Without windows, buildings are just dark blocks.
Other agents are also adding windows — yours should fill different buildings or different floors.`
    },
    {
      name: 'sky',
      agent_cap: 2,
      spatial_guide: `SKY / STARS / MOON — You build the night sky above the city.
Sky fills the upper area: y=-350 to y=-150, x=-300 to x=300.
STARS: Tiny dots (size 1-3, opacity 0.15-0.4) scattered across the sky. 20-30 stars minimum.
MOON: One cluster of 5-8 overlapping dots (size 15-25, opacity 0.6-0.8) forming a moon, positioned around (-180, -280) or similar upper corner.
CLOUDS: A few wispy clusters of very faint dots (size 8-15, opacity 0.08-0.15) — barely visible.
A few text marks in the sky: "night", "vast", "quiet", "above" — size 8-12, opacity 0.2-0.4.
Keep it SUBTLE. The sky is backdrop. Don't compete with the skyline.`
    },
    {
      name: 'ground',
      agent_cap: 2,
      spatial_guide: `GROUND / STREET / REFLECTION — You build the ground level and water/street below the skyline.
Ground line at y=100, extending from x=-300 to x=300.
STREET/WATER: Below y=100 down to y=250.
If water: create a REFLECTION of the skyline — faded, wobbly versions of the buildings. Dots at lower opacity (0.15-0.35) mirrored below y=100. Stretch vertically slightly. Use lines (size 1-2, low opacity) for ripple effects.
If street: horizontal lines, scattered dots for streetlights (size 8-12, bright), small text marks like "taxi", "rain", "neon", "home".
STREETLIGHTS: A few bright dots (size 10-15, opacity 0.8-0.9) along the ground line at regular intervals.
Text scattered at ground level: "below", "street", "hum", "wander" — size 8-14, opacity 0.3-0.5.`
    },
    {
      name: 'atmosphere',
      agent_cap: 1,
      spatial_guide: `ATMOSPHERE / GLOW / HAZE — You create the urban glow and mood.
LIGHT POLLUTION: A subtle warm glow rising from the skyline upward. Faint dots (size 10-20, opacity 0.06-0.15) scattered above the buildings, denser near the tops.
NEON GLOW: A few colored dots near building bases — nightlife, signs. Size 6-12, opacity 0.3-0.5.
HAZE: Very faint large dots (size 15-30, opacity 0.04-0.1) creating foggy atmosphere between buildings.
TEXT: Mood words scattered around the scene — "pulse", "alive", "glow", "never sleeps", "electric", "dream". Size 10-16, opacity 0.3-0.5.
CONNECTING LINES: Faint lines (size 1, opacity 0.08-0.15) between building tops — like power lines or invisible connections.
You make the difference between "dots arranged like buildings" and "a living city at night."`
    },
  ],

  // Default structure for themes not yet mapped — 4 generic subthemes
  '_default': [
    { name: 'structure', agent_cap: 3, spatial_guide: 'STRUCTURE — Build the main forms and anchors. Large, bold marks that establish the primary shapes.' },
    { name: 'detail', agent_cap: 3, spatial_guide: 'DETAIL — Add texture and fine elements. Medium and small marks that bring richness to the structure.' },
    { name: 'background', agent_cap: 2, spatial_guide: 'BACKGROUND — Create the surrounding space and atmosphere. Subtle, faint marks that provide context and depth.' },
    { name: 'accent', agent_cap: 2, spatial_guide: 'ACCENT — Add focal points, highlights, and visual interest. Bright or contrasting marks that draw the eye.' },
  ],
};

// ═══ FUNCTIONS ═══

/**
 * Generate a canvas with theme + subthemes + spatial guide
 * @param {Object} db - Database instance
 * @param {string} [theme] - Optional theme (picks from pool if not provided)
 * @param {string} [weekOf] - ISO date of Monday (defaults to current week)
 * @returns {Object} Canvas object with id, theme, subthemes, spatial_guide
 */
function generateCanvas(db, theme = null, weekOf = null) {
  // Pick theme if not provided
  if (!theme) {
    theme = THEME_POOL[Math.floor(Math.random() * THEME_POOL.length)];
  }

  // Get subthemes for this theme (or use default)
  const subthemeTemplate = SUBTHEME_MAP[theme] || SUBTHEME_MAP['_default'];
  const subthemes = JSON.parse(JSON.stringify(subthemeTemplate)); // deep copy

  // Generate overall spatial guide
  const spatial_guide = `Canvas Theme: "${theme}"

Center at (0,0). Positive Y = down, negative Y = up.
Canvas viewport is roughly -400 to +400 on both axes.

Agents are organized into subthemes, each focusing on a specific aspect of the composition.
Work within your subtheme's spatial guide, but layer on what other agents in your subtheme have already built.
The goal is a unified composition — all parts should feel like they belong to the same visual subject.

Subthemes:
${subthemes.map(s => `- ${s.name} (${s.agent_cap} agents)`).join('\n')}

Build toward the shared theme. Density, overlap, and layering create depth.`;

  // Determine week_of (Monday of current week if not provided)
  let week;
  if (weekOf) {
    week = weekOf;
  } else {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, etc.
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // -6 if Sunday, otherwise 1-dayOfWeek
    const monday = new Date(now);
    monday.setDate(now.getDate() + daysToMonday);
    monday.setHours(0, 0, 0, 0);
    week = monday.toISOString().split('T')[0];
  }

  // Create canvas
  const id = crypto.randomBytes(8).toString('hex');
  const created_at = new Date().toISOString();

  db.prepare(`
    INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(id, theme, JSON.stringify(subthemes), spatial_guide, week, created_at);

  return {
    id,
    theme,
    subthemes,
    spatial_guide,
    week_of: week,
    status: 'active',
    created_at,
  };
}

/**
 * Assign an agent to a canvas + subtheme
 * Matches agent personality to best-fit subtheme, respects agent_cap
 * @param {Object} db - Database instance
 * @param {string} canvasId - Canvas ID
 * @param {string} agentId - Agent ID
 * @returns {Object} { subtheme, canvas_id } or { error }
 */
function assignAgent(db, canvasId, agentId) {
  // Get canvas + subthemes
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  if (!canvas) return { error: 'Canvas not found' };

  const subthemes = JSON.parse(canvas.subthemes);

  // Get agent
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return { error: 'Agent not found' };

  // Count agents per subtheme
  const agentsOnCanvas = db.prepare('SELECT subtheme FROM agents WHERE canvas_id = ?').all(canvasId);
  const subtheneCounts = {};
  agentsOnCanvas.forEach(a => {
    if (a.subtheme) {
      subtheneCounts[a.subtheme] = (subtheneCounts[a.subtheme] || 0) + 1;
    }
  });

  // Find subthemes with room (under agent_cap)
  const availableSubthemes = subthemes.filter(s => {
    const count = subtheneCounts[s.name] || 0;
    return count < s.agent_cap;
  });

  if (availableSubthemes.length === 0) {
    return { error: 'Canvas full — all subthemes at capacity' };
  }

  // Match personality to subtheme
  // For now: simple keyword matching. Could be smarter with embeddings later.
  let bestSubtheme = availableSubthemes[0]; // default to first available

  if (agent.personality) {
    const personality = agent.personality.toLowerCase();
    
    // Match keywords in personality to subtheme names/guides
    for (const sub of availableSubthemes) {
      const subName = sub.name.toLowerCase();
      const subGuide = sub.spatial_guide.toLowerCase();
      
      // Check for keyword overlap
      if (personality.includes(subName) || 
          (subName === 'center' && (personality.includes('core') || personality.includes('bright') || personality.includes('glow'))) ||
          (subName === 'petals' && (personality.includes('petal') || personality.includes('flower') || personality.includes('bloom'))) ||
          (subName === 'stem' && (personality.includes('root') || personality.includes('ground') || personality.includes('structure'))) ||
          (subName === 'atmosphere' && (personality.includes('air') || personality.includes('atmosphere') || personality.includes('subtle') || personality.includes('background'))) ||
          (subName === 'towers' && (personality.includes('tall') || personality.includes('building') || personality.includes('structure'))) ||
          (subName === 'windows' && (personality.includes('light') || personality.includes('detail') || personality.includes('bright'))) ||
          (subName === 'sky' && (personality.includes('sky') || personality.includes('star') || personality.includes('above'))) ||
          (subName === 'ground' && (personality.includes('ground') || personality.includes('below') || personality.includes('reflect')))
      ) {
        bestSubtheme = sub;
        break;
      }
    }
  }

  // Assign agent to canvas + subtheme
  db.prepare('UPDATE agents SET canvas_id = ?, subtheme = ? WHERE id = ?')
    .run(canvasId, bestSubtheme.name, agentId);

  return {
    canvas_id: canvasId,
    subtheme: bestSubtheme.name,
  };
}

/**
 * Start a new week: create Canvas A for this week
 * Called by weekly cron (Monday 00:00 CT)
 * @param {Object} db - Database instance
 * @returns {Object} Canvas object
 */
function startWeek(db) {
  // Pick random theme from pool
  const theme = THEME_POOL[Math.floor(Math.random() * THEME_POOL.length)];
  
  // Create canvas for this week (generateCanvas will calculate current Monday)
  const canvas = generateCanvas(db, theme);
  
  console.log(`🌱 Gardener: Started new week with theme "${theme}" (Canvas ${canvas.id})`);
  
  return canvas;
}

export {
  THEME_POOL,
  SUBTHEME_MAP,
  generateCanvas,
  assignAgent,
  startWeek,
};
