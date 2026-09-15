# Cursors

The Project has global cursor properties. In Borumi's Edit tool, changing the cursor without an
active timeline range or selected `cursor` Segment updates those global properties directly.
Persisted `cursor` Segments are overrides: they apply only within their range, and uncovered ranges
continue using the global cursor. The absence of a `cursor` Segment does not mean the cursor is
disabled.

The MCP does not currently expose a direct global cursor update. Through the MCP, change cursor
properties by adding or updating `cursor` Segments. To produce a whole-video change, add an override
whose range is `[0, <project_duration_ms>]`; this has the same visual scope as a global change but
remains a Segment override. To change only a section, use that section's exact Project-time range.
A later cursor addition replaces the cursor-layer value in its range, and the timeline planner
splits or merges surrounding overrides.

Before adding an override, retrieve `editing_segment_cursor_add`. To change an existing override,
retrieve `editing_segment_cursor_update` and target the exact `segment_id` returned by
`get_timeline`. Property updates do not change an override's timing; add, move, or delete Segments
for range changes.

Choose styles by the effect the user wants:

- `mac_tahoe` is the current Mac look; `mac` is the legacy Mac look.
- `windows` is the current Windows look; `windows_vintage` is the older Windows look.
- `pointer` is a graphic pointer with customizable RGBA `primary_color`, `secondary_color`, and
  `stroke_width`.
- `arm` replaces the classic cursor with an arm or pointing object. It extends from the bottom edge
  of the frame and aims its fingertip at the recorded cursor position, which is useful for playful
  emphasis or presentation-style pointing.

The MCP cursor style is normalized as a `kind`-tagged object. `arm_kind` is a snake-case string,
not a nested object. Examples:

```json
{"type":"cursor","placement":{"range":[0,15000]},"properties":{"style":{"kind":"mac_tahoe"}}}
{"type":"cursor","placement":{"range":[3200,5100]},"properties":{"style":{"kind":"pointer","primary_color":{"r":255,"g":214,"b":0,"a":255},"secondary_color":{"r":243,"g":156,"b":18,"a":255},"stroke_width":12}}}
{"type":"cursor","placement":{"range":[8000,10500]},"properties":{"style":{"kind":"arm","arm_kind":"presentation_pointer"}}}
```

## Arm kinds

- `arrow`: A slim physical arrow provides direct, neutral emphasis.
- `bodybuilder_masculine_deep`: An exaggerated muscular arm with a deep skin tone creates bold,
  high-energy emphasis.
- `bodybuilder_masculine_light`: An exaggerated muscular arm with a light skin tone creates bold,
  high-energy emphasis.
- `bodybuilder_masculine_medium`: An exaggerated muscular arm with a medium skin tone creates bold,
  high-energy emphasis.
- `candy_cane`: A red-and-white candy cane adds playful holiday emphasis.
- `cartoon`: A flat yellow cartoon hand creates a bright, comic pointing effect.
- `cat_orange_tabby`: An extended orange tabby paw adds playful cat-themed emphasis.
- `conductor_baton`: A slim conductor's baton suits music, timing, or orchestral references.
- `crystal_staff`: An ornate blue crystal staff creates a dramatic fantasy effect.
- `dog_golden`: An extended golden dog paw adds friendly animal-themed emphasis.
- `drumstick`: A wooden drumstick suits music, rhythm, or percussion references.
- `felt_tv_puppet`: A bright felt puppet arm creates a playful handmade-character effect.
- `human_feminine_deep`: A natural feminine hand and forearm with a deep skin tone gives a human,
  understated pointer.
- `human_feminine_light`: A natural feminine hand and forearm with a light skin tone gives a human,
  understated pointer.
- `human_feminine_medium`: A natural feminine hand and forearm with a medium skin tone gives a
  human, understated pointer.
- `human_masculine_deep`: A natural masculine hand and forearm with a deep skin tone gives a human,
  understated pointer.
- `human_masculine_light`: A natural masculine hand and forearm with a light skin tone gives a
  human, understated pointer.
- `human_masculine_medium`: A natural masculine hand and forearm with a medium skin tone gives a
  human, understated pointer.
- `laser_blue`: A glowing blue laser blade adds a strong science-fiction effect.
- `magic_wand_classic`: A simple dark wooden wand provides restrained, classic magical emphasis.
- `magic_wand`: An ornate purple-tipped wand creates a more decorative fantasy effect.
- `matchstick`: An oversized matchstick adds a simple prop with playful or fire-related context.
- `paintbrush`: A pointed paintbrush suits art, design, or creative-work references.
- `pencil`: A classic yellow pencil suits writing, drawing, or annotation references.
- `pool_cue`: A wooden pool cue suits billiards references or precise straight-line pointing.
- `presentation_pointer`: A telescoping presentation pointer gives a formal teaching or demo effect.
- `robot_chrome`: An articulated chrome robot arm creates a polished technology or science-fiction
  effect.
- `santa_glove`: A white Santa glove with a red sleeve adds clear holiday character.
- `skeleton_bone`: A skeletal pointing arm creates a spooky or Halloween-themed effect.
- `stick_hand_black_black`: A black pointing hand on a black rod gives a compact graphic pointer for
  light backgrounds.
- `stick_hand_white_chrome`: A white pointing hand on a chrome rod gives a clean, symbolic pointer.
- `wooden_mannequin`: An articulated wooden mannequin arm suits art, animation, or workshop themes.

Use the exact cursor add/update schema for all accepted values and behavior properties.
