# Samin's treatment

The look he approved on the Astra edit and the Fable 5.1 hook (measured 2026-09-01, re-verified in a Borumi export on 2026-09-15). These are the defaults for every visual the plugin places; deviate only when the footage forces it, and say why.

## The frame

- Asset full frame, presenter on top. The animation, b-roll or screen fills the canvas. The camera is a custom-layout source drawn last, bottom-right: x 0.775, y 0.715, width 0.21, height 0.25 of the canvas, `squircle_v2` corners with radius ratio 0.0284, soft shadow (blur 0.0185, black at alpha 100, offset y 0.0185). The camera is never covered, never resized per slot, never vignetted.
- No panels, no rounded card around the proof, no desktop showing at the edges, no letterbox in a different black than the background. A source that is not 16:9 sits centered on near-black `#0f0d0b` so the padding reads as background, not bars.
- Keep the object of the sentence out from under the camera window. Keep-out rectangle in canvas ratios: x >= 0.775, y >= 0.715 (at 1080p: x >= 1488, y >= 772). Crop or nudge the source so labels, the last bar of a chart, or the output node of a diagram stay visible.

### The pinned-camera layout (verified render)

`SCREEN` is the layer that carries the full-frame visual: `screen_1` when the scene's screen layer is free, `screen_2` (or higher) when the animation take landed on a new layer because `screen_1` already had content. Read it from `get_timeline`; never assume.

```json
{"type":"layout","placement":{"range":[START_MS,END_MS]},"properties":{"kind":"custom","transition":{"kind":"instant"},"sources":[
 {"layer_id":"SCREEN","x_ratio":0,"y_ratio":0,"width_ratio":1,"height_ratio":1,"border_radius_ratio":0,"lock_aspect_ratio":false,"overflow":false},
 {"layer_id":"camera_1","x_ratio":0.775,"y_ratio":0.715,"width_ratio":0.21,"height_ratio":0.25,"border_radius_ratio":0.0284,"corner_shape":"squircle_v2","lock_aspect_ratio":false,"overflow":false,
  "shadow":{"blur_ratio":0.0185,"color":{"r":0,"g":0,"b":0,"a":100},"x_offset_ratio":0,"y_offset_ratio":0.0185}}]}}
```

Camera last so it draws on top. Verified in the export: animation full frame, camera bottom-right with squircle corners and shadow.

### Fallbacks by canvas format

- Landscape canvas (`canvas.format.preset == "landscape"` or width > height): the custom layout above.
- Any other format (vertical, square, portrait, photo, custom): Borumi's `corner` layout, `{"kind":"corner","main_layer_id":"SCREEN","corner_layer_id":"camera_1","corner_shape":"squircle_v2","transition":{"kind":"instant"}}`. The measured rectangle only fits 16:9.
- No camera segment in the range (screen-only scene): `{"kind":"fullscreen","layer_id":"SCREEN","transition":{"kind":"instant"}}`.
- Camera only, with an overlay going in front (visualize front mode when the effective layout shows the camera fullscreen): the custom layout with the camera source alone, so the overlay never covers his face. Skip on a non-landscape canvas and warn.

## Chapter cards (the Astra look, verified render)

DM Sans bold 62, fixed sizing, bottom-left, dark navy card with a fade in and an instant out. 3.2 s per card, 4 s when the title is longer than 27 characters. Cards sit at each chapter start except 0:00 unless asked.

```json
{"type":"text_overlay","placement":{"range":[START_MS,END_MS]},"properties":{
 "text":"01  Why this matters","font_families":["DM Sans"],"bold":true,"text_size":62,"line_height":1.13,"alignment":"left",
 "sizing_mode":"fixed","position":{"kind":"custom","x_ratio":0.055,"y_ratio":0.76,"width_ratio":0.7,"height_ratio":0.16},"lock_aspect_ratio":false,
 "text_color":{"r":255,"g":255,"b":255,"a":255},"text_shadow":false,
 "background_color":{"r":17,"g":31,"b":47,"a":239},"background_sizing_mode":"paragraph","background_horizontal_padding_ratio":0.3,"background_vertical_padding_ratio":0.22,"border_radius_ratio":0.016,
 "entrance_transition":{"kind":"fade"},"exit_transition":{"kind":"instant"}}}
```

The text carries the two-digit chapter number, two spaces, then the title. Titles stay under 32 characters. `--style label` swaps the properties for Borumi's Label template (see `segment-schemas.md`); `--style bold` for the Bold template with `sizing_mode "hug"` centered.

## Text on screen (tweets, posts, results pages, cards)

- Centered, big, on near-black. At 1080p the block is 1250 to 1450 px wide depending on the card's aspect, so the text ends before the camera window. A slow push of 1.06 to 1.07 anchored on the line that carries the proof. Vignette yes, bottom line no (it is not later footage).
- Crop the card to the words and the one element that proves the point (the author row, the quote, the red-boxed bar). Drop rotated axis labels and menu chrome. Never leave a line half under the camera.
- A results page (a YouTube search, a feed) pans: scale to canvas width, slide down about 900 px over the slot.
- Never composite a screenshot that has the presenter's own player or camera baked into it.
- In a Remotion animation the same rules hold: text blocks end before x 0.775 on the bottom rows, one line of proof is the biggest thing in the frame, and pushes are geometric and eased on every channel (the kit's camera rule), never stepped.

## Later-footage b-roll ("this is happening later")

Clips pulled from later in the same recording get two marks so the viewer reads them as a preview: a slight vignette (about 78% brightness in the corners, 88% at the edge centers; heavier reads as a dirty frame edge) and a thin line, 3 px white at 35%, full width, 28 px above the bottom edge, just below the camera window. Real motion inside the clip (cursor, a box drawn, a scroll, a click) plus at most a slow push of 1.04 to 1.08 over the slot; the push is never the only motion. Crop to the proof region and scale to fill.

## Rhythm

- One visual per spoken clause. Slots run 2.4 to 6.5 s; the hook opens on the strongest proof, not on the presenter.
- Every cut leads the spoken word by about 120 ms so the eye lands before the ear. Cut on the clause boundary the visual proves.
- A beat inside an animation needs at least 2 s to read; a few strong beats beat many rushed ones.
- Stills (a thumbnail, a roster hold) get one motivated push (1.15 anchored on the subject); never more than two stills in a row.
- When he says "posts", show the post and the wall of posts. When he says "the agent team", show the faces and the model tags, not the chat log. When he says a number, the number is the biggest thing in the frame with the cursor on it.

## What he rejected (do not ship these)

- Static screenshots standing in for footage ("you're just showing me literal pictures").
- An 82% overlay panel with the desktop recording visible around it and drifting behind it.
- A full-frame overlay that hides the camera (Borumi draws overlays above the camera; behind mode exists for this reason).
- A tweet at 44% width with black bars, or a tweet whose fourth line runs under the camera.
- A dense chat or log scroll, or a loading skeleton, where an agent grid was promised.
- A hype tweet on a sentence about the release date; the tweet belongs on the sentence about posts.
- Any zoom that shimmers or stutters (per-frame integer rounding). Zooms glide: geometric, eased, sub-pixel.
