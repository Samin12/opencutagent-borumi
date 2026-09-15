# Segment schemas

The exact input types Borumi's guides publish for `add_segments` and `update_segments`, condensed from `docs/borumi-guides/guide-editing_segment_*.md`. Fetch the matching guide before the call anyway (gating is per connection); this file is for planning the JSON and for the types the guides do not repeat.

Shared shapes:
- `Color = {r, g, b, a}` integers 0 to 255, alpha included (black at 35% is `{"r":0,"g":0,"b":0,"a":90}`).
- `Sound = {sound_id: "whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl", volume: number}`.
- `Rect = {x_ratio, y_ratio, width_ratio, height_ratio}` as ratios of the canvas (custom layout and overlay positions) or of the screen source (highlight, blur).
- `Shadow = {blur_ratio, color: Color, x_offset_ratio, y_offset_ratio}`; `Stroke = {color: Color, width_ratio}`.
- `VideoBackground = {kind:"original"} | {kind:"transparent", edge_shift, softness, quality?} | {kind:"blur", blur, edge_shift, softness, quality?} | {kind:"replace", blur, edge_shift, softness, media_id?, quality?}` with `quality` in `fast|balanced|high|very_high`.
- Every `add_segments` call: `{tx_id, timeline_hash, additions:[...]}`. Every `update_segments` call: `{tx_id, timeline_hash, updates:[{type, segment_id, properties}]}`. Updates never carry timing, source, grouping or identity fields; omit properties you do not change. Never send `properties: {}`.

## take (add only)

```ts
{type:"take", placement:{at_ms:number}, content: {take_id:string} | {media_id:string, video_kind?:"camera"|"screen"|null, audio_kind?:"microphone"|"system_sound"|"music"|null}}
```
`at_ms` only, never `range`; the take uses its source duration. `media_id` creates a Take plus one Clip per usable track; `video_kind`/`audio_kind` override inference for the new segments. A take becomes `video` and `audio` segments; update those.

## video (update only)

```ts
{type:"video", segment_id, properties:{
  background?: VideoBackground|null,
  color_adjustments?: {contrast?, exposure?, highlights?, shadows?, saturation?, temperature?, tint?, lut?: {kind:"built_in", id}|{kind:"media", media_id}|null, lut_intensity?}|null,
  crop?: Rect|null,
  face_tracking_mode?: "disabled"|"auto"|null,
  mirrored?: boolean|null,
  transition?: {kind:"auto"}|{kind:"cut"}|{kind:"crossfade"}|{kind:"fade_through"}|{kind:"push", direction:"up"|"right"|"down"|"left"}
}}
```
For an animation take: `{"face_tracking_mode":"disabled","transition":{"kind":"cut"}}`.

## audio (update only)

```ts
{type:"audio", segment_id, properties:{noise_cancelling_filter?: number|null, noise_cancelling_mode?: "auto"|"speed"|"quality"|null, voice_enhancement_filter?: "disabled"|"minimal"|"extended"|null, volume_filter?: number|null}}
```

## layout

Placement is a `range`. `properties` is one complete layout definition (updates replace the whole definition):

```ts
{transition?: {kind:"auto"}|{kind:"instant"}|{kind:"smooth"}|null, transition_sound?: Sound|null} & (
  {kind:"custom", sources:[{layer_id, x_ratio, y_ratio, width_ratio, height_ratio, border_radius_ratio, corner_shape?:"regular"|"squircle"|"squircle_v2"|null, lock_aspect_ratio?:boolean|null, overflow?:boolean|null, shadow?:Shadow|null, stroke?:Stroke|null, face_tracking_mode_override?:"disabled"|"auto"|null, video_background_override?: VideoBackground|null}]}
| {kind:"fullscreen", layer_id, fit?:"cover"|"padding"|null}
| {kind:"corner", main_layer_id, corner_layer_id, corner_shape?:"rounded_rect"|"circle"|"squircle"|"squircle_v2"|null, main_fit?:"cover"|"padding"|null}
| {kind:"side", main_layer_id, side_layer_id, main_size?: {kind:"adaptive"}|{kind:"fixed", ratio}|null}
| {kind:"transparent_corner", main_layer_id, corner_layer_id, main_fit?:"cover"|"padding"|null})
```
Later custom sources render in front of earlier ones (camera last). Rectangles may extend beyond the canvas but need positive size. `overflow:false` clips to the rectangle. Custom video background overrides: only `original` or `transparent`. Read the visual layer ids from `get_timeline` for the same range first.

## media_overlay

```ts
add:    {type:"media_overlay", placement:{at_ms}|{range:[a,b]}, content:{media_id}, properties?: OverlayProps|null}
update: {type:"media_overlay", segment_id, properties: Partial<OverlayProps>}
OverlayProps = {position?: "auto"|{kind:"custom", x_ratio, y_ratio, width_ratio, height_ratio}|null, lock_aspect_ratio?: boolean|null, border_radius_ratio?: number|null, corner_shape?: "rounded_rect"|"squircle"|"squircle_v2"|null, entrance_transition?: {kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{kind:"slide", direction}|null, exit_transition?: same|null, enter_sound?: Sound|null, exit_sound?: Sound|null, shadow?: Shadow|null, stroke?: Stroke|null}
```
`at_ms` uses the media's own duration; `range` sets an explicit interval. Full-frame alpha overlay: `position {kind:"custom", 0, 0, 1, 1}`, `lock_aspect_ratio false`, entrance and exit `instant`. Overlays render above the camera. The legacy `overlay` type takes the same update properties; use it only when `get_timeline` reports that exact type.

## text_overlay

```ts
add:    {type:"text_overlay", placement:{at_ms}|{range:[a,b]}, properties: TextProps & {text: string}}
update: {type:"text_overlay", segment_id, properties: Partial<TextProps> & {text?: string}}
TextProps = {
  sizing_mode?: "hug"|"fixed"|null, position?: "auto"|{kind:"custom", x_ratio, y_ratio, width_ratio, height_ratio}|null, lock_aspect_ratio?: boolean|null,
  alignment?: "left"|"center"|"right"|null, text_size?: number|null (1080p reference pixels, default 80), line_height?: number|null, wrapping_mode?: "no_wrap"|"wrap"|null, casing_mode?: "original"|"uppercase"|"lowercase"|null,
  font_families?: string[]|null (omit for the default stack; name a concrete installed family), bold?: boolean|null, italic?: boolean|null, text_color?: Color|null,
  background_color?: Color|null, background_sizing_mode?: "auto"|"packed"|"paragraph"|null, background_horizontal_padding_ratio?, background_vertical_padding_ratio?, background_x_offset_ratio?, background_y_offset_ratio?, border_radius_ratio?, corner_shape?: "rounded_rect"|"squircle"|"squircle_v2"|null,
  stroke?: Stroke|null, stroke_color?: Color|null, stroke_width?: number|null, shadow?: Shadow|null,
  text_shadow?: boolean|null, text_shadow_color?: Color|null, text_shadow_blur_ratio?, text_shadow_spread_ratio?, text_shadow_x_offset_ratio?, text_shadow_y_offset_ratio?,
  entrance_transition?: {kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{kind:"slide", direction}|null, exit_transition?: same|null, enter_sound?: Sound|null, exit_sound?: Sound|null,
  style_ranges?: [{start, end, style?: subset of the text fields above}]|null
}
```
`fixed` sizing uses the position rectangle as the overlay box. `hug` measures the rendered text and ignores width and height; its `x_ratio` is the left, center or right anchor per `alignment`, `y_ratio` the top edge. Fetch `editing_segment_text_overlay_templates` and start from the closest template; when applying a template to an existing overlay with `style_ranges`, set `style_ranges: null` for a uniform style.

### Text overlay templates (copy the fields, supply `text` and position yourself)

Common to all except where noted: `line_height 1.3`, `text_color` white, `background_color null`, `background_sizing_mode "auto"`, `background_horizontal_padding_ratio 0.18`, `background_vertical_padding_ratio 0.12`, offsets 0, `stroke_color null`, `stroke_width 0`, `text_shadow true`, `text_shadow_color null`, `text_shadow_blur_ratio 0.5`, `text_shadow_spread_ratio 0.25`, shadow offsets 0, `alignment "center"`, `wrapping_mode null`, `italic false`, `sizing_mode "hug"`.

| Template | text_size | bold | casing | font_families | Differences |
|---|---|---|---|---|---|
| Bold | 150 | true | uppercase | Poppins, sans-serif | headline cards |
| Modern | 150 | true | uppercase | Bebas Neue, sans-serif | condensed headlines |
| Classy | 180 | false | uppercase | DM Serif Display, Georgia, serif | formal serif titles |
| Glowing | 150 | true | uppercase | Poppins, sans-serif | `text_shadow_color {241,196,15,137}` warm glow |
| Elegant | 84 | false | original | DM Serif Display, Georgia, serif | `italic true`; quotes, names, chapter cards |
| Highlight | 150 | false | uppercase | Bebas Neue, sans-serif | `text_color` black, `background_color {255,246,52,255}`, `background_horizontal_padding_ratio 0.2`, `text_shadow false` |
| Subtitle | 40 | false | original | Poppins, sans-serif | supporting text (speech captions use a captions segment) |
| Label | 64 | true | original | DM Sans, sans-serif | `background_color {0,0,0,153}`, `background_sizing_mode "paragraph"`, padding 0.48/0.42, `text_shadow false`, `text_shadow_blur_ratio 0.04`, `text_shadow_spread_ratio 0`, `text_shadow_y_offset_ratio 0.01` |

Samin's chapter card (the Astra look) is a Label-family card with its own numbers; see `treatment.md`.

## captions

```ts
add:    {type:"captions", placement:{range:[a,b]}, properties?: CaptionProps|null}
update: {type:"captions", segment_id, properties: Partial<CaptionProps>}
CaptionProps = {position?: "bottom"|"top"|"center"|{kind:"custom", x_ratio, y_ratio, width_ratio, height_ratio}|null, paragraph_mode?: "single_word"|"fill"|null, text_size?, text_color?: Color|null, future_color?: Color|null, background_color?: Color|null, background_horizontal_padding_ratio?, background_vertical_padding_ratio?, border_radius?, accent_color?: Color|null, highlight_color?: Color|null, highlight_horizontal_padding_ratio?, highlight_vertical_padding_ratio?, casing_mode?: "original"|"uppercase"|null, font_families?: string[]|null, bold?, italic?, stroke_color?: Color|null, stroke_width?}
```
Captions need a transcript: check `get_project_overview` slice `transcripts` first; if missing, abort the transaction, `request_transcriptions {project_id}`, poll, then begin a fresh transaction. Never send empty properties; copy a template.

### Captions templates

All: `position null`, `casing_mode null` unless noted, `italic null` unless noted.

| Template | text_size | font | Fields |
|---|---|---|---|
| Boxed | 48 | DM Sans, sans-serif | `future_color {255,255,255,120}`, `background_color {0,0,0,160}`, padding 0.7/0.42, `border_radius 18` |
| Highlight | 56 | DM Sans, sans-serif | `bold true`, `highlight_color {0,153,255,255}`, highlight padding 0.22/0.13 |
| Accent | 56 | Poppins, sans-serif | `bold true`, `casing_mode "uppercase"`, `accent_color {255,212,0,255}` |
| Impact | 120 | Poppins, sans-serif | `paragraph_mode "single_word"`, `bold true`, `italic false`, `casing_mode "uppercase"`, `stroke_color` black, `stroke_width 20` |
| Card | 60 | Poppins, sans-serif | `text_color` black, `background_color` white, padding 0.5/0.14, `border_radius 20`, `accent_color {0,166,255,255}`, `bold true`, `casing_mode "uppercase"` |
| Outline | 56 | DM Sans, sans-serif | `stroke_color` black, `stroke_width 10` |

Text color is white unless noted; every field not listed is `null`.

## screen_zoom

```ts
add:    {type:"screen_zoom", placement:{range:[a,b]}, properties?: {zoom_factor?: number|null, focus_point?: "cursor"|{kind:"position", x_ratio, y_ratio}|null, enter_sound?: Sound|null, exit_sound?: Sound|null}|null}
update: {type:"screen_zoom", segment_id, properties: same fields}
```

## camera_zoom

```ts
add:    {type:"camera_zoom", placement:{range:[a,b]}, properties?: {zoom_factor?, focus_point?: "face"|{kind:"position", x_ratio, y_ratio}|null, enter_mode?: "instant"|"fast"|"gradual"|null, exit_mode?: "instant"|"fast"|null, enter_sound?: Sound|null, exit_sound?: Sound|null}|null}
update: {type:"camera_zoom", segment_id, properties: same fields}
```
Confirm the interval has visible camera content.

## screen_highlight

```ts
add:    {type:"screen_highlight", placement:{range:[a,b]}, properties?: {x_ratio?, y_ratio?, width_ratio?, height_ratio?, border_radius_ratio?, transition?: "auto"|"instant"|"smooth"|null}|null}
update: {type:"screen_highlight", segment_id, properties: same fields (send all four coordinates together when moving the region)}
```
Ratios are relative to the active screen source, not the canvas; the region must stay inside the source. One exclusive layer; add non-overlapping segments to move the highlight. Default region when properties are omitted: `{0.25, 0.25, 0.5, 0.5, border_radius_ratio 0.01, transition auto}`. The dimming overlay stays below camera content.

## screen_blur

```ts
add:    {type:"screen_blur", placement:{range:[a,b]}, properties?: {blur_kind?: "pixelated"|"grainy"|"black"|null, x_ratio?, y_ratio?, width_ratio?, height_ratio?}|null}
update: {type:"screen_blur", segment_id, properties: same fields}
```

## music

```ts
add:    {type:"music", placement:{at_ms}|{range:[a,b]}, content:{media_id}, properties?: {volume_filter?, fade_in?: boolean|null, fade_out?: boolean|null, enable_looping?: boolean|null}|null}
update: {type:"music", segment_id, properties: same fields}
```

## sound_effect

```ts
add:    {type:"sound_effect", placement:{at_ms}|{range:[a,b]}, content:{media_id}, properties?: {volume_filter?: number|null}|null}
update: {type:"sound_effect", segment_id, properties:{volume_filter?}}
```
Sound effects may overlap (Borumi stacks audio layers) and never change scene duration.

## cursor

```ts
add:    {type:"cursor", placement:{range:[a,b]}, properties?: CursorProps|null}
update: {type:"cursor", segment_id, properties: Partial<CursorProps>}
CursorProps = {style?: {kind:"mac"}|{kind:"mac_tahoe"}|{kind:"windows"}|{kind:"windows_vintage"}|{kind:"pointer", primary_color: Color, secondary_color: Color, stroke_width}|{kind:"arm", arm_kind: <see guide list>}|null, size_factor?, following_mode?: "auto"|"minimal"|"medium"|"tight"|null, hide_when_still?: boolean|null, hide_camera_on_overlap?: boolean|null, click_effect?: {kind:"circle"|"ring", color: Color, radius}|null, click_sound?: "click1"|"click2"|null, click_sound_volume?, highlight?: {color: Color, radius}|null}
```
Fetch `editing_cursors` first; the range must contain screen content with cursor data. `arm_kind` values are listed in `guide-editing_segment_cursor_add.md`.

## Transitions summary (from `editing_transitions`)

- Layout `transition`: `auto` | `instant` (snap geometry and opacity) | `smooth`.
- Video clip `transition` (incoming clip only, no exit): `auto|cut|crossfade|fade_through|push{direction}`.
- Overlay: separate `entrance_transition` and `exit_transition`, `auto|instant|fade|slide{direction}`; `auto` is Borumi's fade-and-slide.
- Screen highlight `transition` is a bare string: `"auto"|"instant"|"smooth"`.
- Durations and easing are fixed; only the kind is configurable.
