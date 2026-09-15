# Add a Screen Highlight Segment

A `screen_highlight` Segment keeps one rounded region of the screen at full color while a
semi-opaque black overlay dims the rest of the Canvas. The overlay extends across the complete
Canvas and remains below camera content.

Example addition with an explicit region:
`{"type":"screen_highlight","placement":{"range":[5000,8000]},"properties":{"x_ratio":0.1,"y_ratio":0.15,"width_ratio":0.4,"height_ratio":0.3,"border_radius_ratio":0.01,"transition":"auto"}}`.

- Screen Highlight requires `range` placement and visible screen content in that range.
- There is one exclusive `screen_highlight` Layer. Add multiple non-overlapping Segments to move
  the Highlight over time.
- `x_ratio`, `y_ratio`, `width_ratio`, and `height_ratio` describe the clear region in the active
  screen source, not the Canvas. This keeps the region attached to the same screen point through
  Screen Zoom and Layout changes. Ratios are from `0` to `1`, and the complete rectangle must
  remain inside the source.
- `border_radius_ratio` is relative to the shorter screen-source dimension. Increase it to create
  a pill or circle; rendering caps the effective radius at half the region's shorter side.
- Omit `properties` to use the centered default region
  `{"x_ratio":0.25,"y_ratio":0.25,"width_ratio":0.5,"height_ratio":0.5,"border_radius_ratio":0.01,"transition":"auto"}`;
  never send `{}`.
- For an isolated Segment, `auto` and `smooth` fade the dimming overlay in and out. `instant`
  applies and removes it immediately.
- When one Highlight ends exactly where the next starts, the incoming Segment's `transition`
  controls the boundary. `auto` and `smooth` use Borumi's standard spring motion without fading
  the overlay between Segments; `instant` snaps to the new region.
- Inspect the narrowest useful range before choosing the target region.

## Exact input type

```ts
type Input={additions:{placement:{range:number[]};properties?:{border_radius_ratio?:number|null;height_ratio?:number|null;transition?:"auto"|"instant"|"smooth"|null;width_ratio?:number|null;x_ratio?:number|null;y_ratio?:number|null}|null;type:"screen_highlight"}[];timeline_hash:string;tx_id:string};
```
