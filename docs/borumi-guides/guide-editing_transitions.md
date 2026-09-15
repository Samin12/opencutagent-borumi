# Transition editing

Layout, video, and Screen Highlight transitions are attached to the incoming item; overlays own
separate entrance and exit transitions. Durations and easing are fixed and cannot be configured.

## Layout

`transition` controls Layer position and default visibility changes. Use `auto` normally,
`instant` to snap geometry and opacity, or `smooth` for Borumi's standard smoothing. If the user
wants a Layout and its Layers to change immediately without animation, use `instant`.

```json
{"transition":{"kind":"instant"}}
```

## Video clip

`transition` controls an incoming `video` Segment when it becomes visible, including after a Layout
change. It overrides the Layout's default entrance behavior and has no exit field. Values are
`auto|cut|crossfade|fade_through|push`: crossfade draws the new clip over the old, fade-through
removes the old before revealing the new, and push moves both. To animate only one visual, update
only its incoming clip. For example, to crossfade between slides, set `crossfade` on the incoming
Screen clip for each slide change.

```json
{"transition":{"kind":"crossfade"}}
{"transition":{"kind":"push","direction":"left"}}
```

## Overlay

`entrance_transition` and `exit_transition` independently control an overlay. Values are
`auto|instant|fade|slide`; auto uses Borumi's default fade-and-slide. To make an overlay appear
immediately, set its entrance to `instant`; set its exit to `instant` for immediate removal.

```json
{"entrance_transition":{"kind":"instant"},"exit_transition":{"kind":"instant"}}
```

## Screen Highlight

`transition` controls the Highlight at its boundaries. Use `auto` normally, `instant` to snap the
region and black overlay, or `smooth` to request Borumi's standard spring motion explicitly.
Isolated `auto` and `smooth` Highlights fade the black overlay in and out. When two Highlights are
exactly adjacent, the incoming Segment's setting controls the region change; `auto` and `smooth`
animate without fading the overlay between Segments.

```json
{"transition":"instant"}
```

For push and slide, `direction` is the direction of travel: `up|right|down|left`. These fields belong
inside the Segment `properties` object. Omit unrelated properties from updates.
