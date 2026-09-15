# Add a Layout Segment

A `layout` Segment applies a composition layout over a Project-time range.

Example placement: `{"range":[5000,15000]}`. Choose one complete `LayoutKind` from the schema for `properties`.

- Retrieve and follow `editing_layouts` before calling `add_segments`.
- Layout requires range placement and a complete layout definition.
- Read the visual Layer IDs from `get_timeline` for the same range and use them in the direct Layer
  ID fields.
- Do not use layout updates to change Segment timing.

## Exact input type

```ts
type Input={additions:{placement:{range:number[]};properties:{transition?:{kind:"auto"}|{kind:"instant"}|{kind:"smooth"}|null;transition_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null}&({kind:"custom";sources:{border_radius_ratio:number;corner_shape?:"regular"|"squircle"|"squircle_v2"|null;face_tracking_mode_override?:"disabled"|"auto"|null;height_ratio:number;layer_id:string;lock_aspect_ratio?:boolean|null;overflow?:boolean|null;shadow?:{blur_ratio:number;color:{a:number;b:number;g:number;r:number};x_offset_ratio:number;y_offset_ratio:number}|null;stroke?:{color:{a:number;b:number;g:number;r:number};width_ratio:number}|null;video_background_override?:{kind:"original"}|{edge_shift:number;kind:"transparent";quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|{blur:number;edge_shift:number;kind:"blur";quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|{blur:number;edge_shift:number;kind:"replace";media_id?:string|null;quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|null;width_ratio:number;x_ratio:number;y_ratio:number}[]}|{fit?:"cover"|"padding"|null;kind:"fullscreen";layer_id:string}|{corner_layer_id:string;corner_shape?:"rounded_rect"|"circle"|"squircle"|"squircle_v2"|null;kind:"corner";main_fit?:"cover"|"padding"|null;main_layer_id:string}|{kind:"side";main_layer_id:string;main_size?:{kind:"adaptive"}|{kind:"fixed";ratio:number}|null;side_layer_id:string}|{corner_layer_id:string;kind:"transparent_corner";main_fit?:"cover"|"padding"|null;main_layer_id:string});type:"layout"}[];timeline_hash:string;tx_id:string};
```
