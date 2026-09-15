# Update a Screen Highlight Segment

Screen Highlight updates target a persisted `screen_highlight` Segment by `segment_id`.

Example region update:
`{"type":"screen_highlight","segment_id":"<highlight_segment_id>","properties":{"x_ratio":0.55,"y_ratio":0.15,"width_ratio":0.3,"height_ratio":0.3}}`.

Example transition-only update:
`{"type":"screen_highlight","segment_id":"<highlight_segment_id>","properties":{"transition":"instant"}}`.

- Read the Segment's current properties from the `screen_highlight` Layer with `get_timeline`,
  then send only schema-approved fields that need changing in a non-empty `properties` patch.
- When changing the region, send all four coordinate fields together. Ratios are relative to the
  active screen source, and the resulting rectangle must remain inside it.
- The region follows the same source point through Screen Zoom and Layout changes. The black
  overlay still covers the complete Canvas and remains below camera content.
- `border_radius_ratio` is relative to the shorter screen-source dimension and may be updated
  independently.
- At a boundary between adjacent Highlights, the incoming Segment's `transition` controls the
  change. Use `auto` normally, `smooth` to request Borumi's standard spring motion explicitly, or
  `instant` to snap. Isolated `auto` and `smooth` Segments fade the overlay at both ends.
- Use structural tools to change timing. Inspect the affected range when changing the visual
  target.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{border_radius_ratio?:number;height_ratio?:number;transition?:"auto"|"instant"|"smooth";width_ratio?:number;x_ratio?:number;y_ratio?:number};segment_id:string;type:"screen_highlight"}[]};
```
