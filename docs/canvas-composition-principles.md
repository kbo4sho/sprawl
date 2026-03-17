# Canvas Composition Principles

*How to make any subject beautiful in primitives. Not a template — a system.*

---

## The Core Insight

Beauty in primitives comes from **layered visual functions**, not from scattering marks in a region. Every good canvas has the same structure: shadow behind, form in the middle, detail on top, atmosphere everywhere.

---

## The Four Layers

Every canvas, regardless of subject, is built from back to front in four layers. Each layer has different mark characteristics. Later layers are drawn on top of earlier ones.

### Layer 1: Shadow / Negative Space (back)
**Purpose:** Define what's NOT the subject. Create depth behind the forms.
- Marks: LARGE (size 20-50)
- Opacity: LOW (0.05-0.40)
- Density: Sparse — fewer marks, bigger coverage
- Color: Dark, muted, cool
- Examples: The darkness behind a portrait. The deep sky behind buildings. The soil beneath flowers.

### Layer 2: Structure / Form (middle)
**Purpose:** Build the recognizable shapes. This is the subject.
- Marks: MEDIUM (size 8-25)
- Opacity: MEDIUM-HIGH (0.40-0.90)
- Density: Dense — tightly packed, overlapping
- Color: The subject's main colors
- Placement: SEQUENTIAL along paths. Trace shapes point by point with 8-10px spacing. Not scattered.
- Examples: The face oval. Building columns. Flower petal clusters.

### Layer 3: Detail / Definition (front)
**Purpose:** Make forms recognizable and alive. The thing that makes you go "oh, that's a building."
- Marks: SMALL (size 2-8)
- Opacity: HIGH (0.70-1.00)
- Density: Moderate — precise placement matters more than quantity
- Color: Bright, often contrasting with structure layer
- Examples: Window grids on buildings. Eye highlights in a portrait. Pollen dots on flowers.

### Layer 4: Atmosphere / Unity (everywhere)
**Purpose:** Connect everything. Make it feel like one scene, not separate objects.
- Marks: MIXED sizes (tiny dust 1-3, medium haze 10-20)
- Opacity: VERY LOW (0.05-0.20)
- Density: Sparse but widespread — covers entire canvas
- Color: Muted, theme-appropriate
- Includes: Text words, faint connecting lines, light effects, particle dust
- Examples: Light pollution glow. Pollen dust. Rain. Fog between buildings.

---

## Agent Design Rules

### One Agent = One Visual Function
An agent is NOT assigned a region. It's assigned a FUNCTION:
- ❌ "Left side agent" / "Top area agent"  
- ✅ "Shadow agent" / "Window grid agent" / "Atmosphere agent"

Multiple agents can share a function (e.g., 3 agents on "petals" but in different positions). They coordinate through the spatial guide.

### One Agent = One Color
Each agent uses a SINGLE assigned color for all its marks. This creates visual coherence. The color comes from the agent, not the palette.

### Agents Build Sequentially
Marks are NOT scattered randomly in a zone. They trace paths:
- A building is a column of dots stepping y by 8-10px
- A petal is a radial sweep of dots at increasing angles
- A stem is dots stepping down from flower to ground
- Size and opacity can vary along the path to create taper/gradient

Example — a tapered column:
```
y=-200, size=25, opacity=0.85
y=-190, size=23, opacity=0.82
y=-180, size=21, opacity=0.80
y=-170, size=19, opacity=0.78
...
```

### Mark Budget Per Agent
Target: 80-130 marks per agent across all phases.
- Foundation: ~30-35 marks (bold structure)
- Layering: ~25 marks (fill gaps, add density)
- Polish: ~15-20 marks (fine detail, texture)

---

## Spatial Guide Writing Rules

The spatial guide is what makes or breaks a canvas. Bad guides produce scattered output. Good guides produce recognizable forms.

### Be Geometric, Not Conceptual
- ❌ "A tall building on the left"
- ✅ "Column of dots from (x=-150, y=-250) to (x=-150, y=100), width 60px. Step y by 10px."

### Specify Relationships
- ❌ "Some buildings in the background"
- ✅ "Background tower at x=-200: same structure but opacity 0.15-0.30, size reduced 30%"

### Describe the Shape in Dot Language
- ❌ "A flower petal"
- ✅ "Radial cluster: 12-15 dots arranged in a circle, radius 40px from center, size 15-25, slight size decrease at tips"

### Include Depth Cues
Every spatial guide should mention:
- What's in FRONT (higher opacity, more detail)
- What's BEHIND (lower opacity, larger/softer)
- What CONNECTS them (atmosphere, reflections, transitions)

---

## Subtheme Design

For any subject, decompose into these functional roles:

| Role | Layer | Agent Count | Mark Style |
|------|-------|-------------|------------|
| Shadow/Ground | 1 (back) | 1-2 | Big, faint, wide |
| Primary Form | 2 (structure) | 2-3 | Medium, dense, sequential |
| Secondary Form | 2 (structure) | 1-2 | Medium, supporting shapes |
| Detail | 3 (front) | 1-2 | Small, bright, precise |
| Atmosphere | 4 (everywhere) | 1 | Mixed, very faint, scattered |

Total: 6-10 agents per canvas.

### Example Decomposition: City Skyline
| Subtheme | Layer | Function |
|----------|-------|----------|
| sky_mass | 1 | Large dark blue blobs filling upper canvas |
| ground_mass | 1 | Dark mass below skyline |
| towers | 2 | Building silhouette columns, traced point-by-point |
| tower_edges | 2 | Bright lines defining building outlines |
| windows | 3 | Tiny bright grid dots inside tower shapes |
| streetlights | 3 | Bright warm dots along ground line |
| reflections | 2 | Low-opacity mirrored towers below ground |
| stars | 3 | Tiny scattered dots in sky |
| atmosphere | 4 | Light pollution, haze, text, connections |

### Example Decomposition: Flower
| Subtheme | Layer | Function |
|----------|-------|----------|
| darkness | 1 | Large dark blobs behind the flower |
| petals | 2 | Radial dot clusters forming petal shapes |
| center | 2+3 | Dense warm cluster, mix of anchor and detail |
| stem | 2 | Column of dots tracing downward |
| atmosphere | 4 | Pollen dust, light rays, text words |

### Example Decomposition: Portrait  
| Subtheme | Layer | Function |
|----------|-------|----------|
| shadow | 1 | Large dark blobs behind the face |
| face_fill | 2 | Medium dots filling the face oval |
| face_contour | 2 | Edge-tracing dots defining face outline |
| features | 3 | Small precise dots for eyes, nose, mouth |
| hair | 2+3 | Lines and small dots for hair strands |
| atmosphere | 4 | Faint dots, text, rim lighting |

---

## Phase Execution

Canvases are built in passes, not all at once. Each pass serves a different purpose.

### Phase 1: Foundation (2 passes)
- Layer 1 agents go FIRST — establish the negative space
- Layer 2 agents lay down main forms — bold, structural, imperfect
- 30-35 marks per agent per pass
- Instruction: "Be bold. Establish structure. Don't worry about perfection."

### Phase 2: Layering (2 passes)  
- All agents active
- Layer 2 agents fill gaps between foundation marks, add density
- Layer 3 agents start adding detail ON TOP of existing structure
- 20-25 marks per agent per pass
- Instruction: "Build on what exists. Fill gaps. Add density. The scene should be recognizable now."

### Phase 3: Polish (1-2 passes)
- Primarily Layer 3 and 4 agents
- Fine detail, texture, atmosphere
- 15-20 marks per agent per pass
- Instruction: "Every mark counts. Add the details that make someone stop and look."

---

## Quality Checklist

Before a canvas is "done," verify:
- [ ] Shadow layer exists (can you see depth?)
- [ ] Main forms are recognizable from 3 feet away
- [ ] Detail layer adds definition (zoom in — do you see texture?)
- [ ] Atmosphere connects everything (does it feel like one scene?)
- [ ] Size variation exists (dust + texture + structure + anchors all present)
- [ ] Opacity creates depth (can you sense foreground vs background?)
- [ ] No region is empty unless intentionally so
- [ ] Text words add mood without cluttering
- [ ] Total marks: 600-1000 for a standard canvas

---

*These principles apply to every canvas regardless of subject. The subject changes the spatial guides. The system stays the same.*
