# Update a Layout Segment

Layout updates target a persisted `layout` Segment by `segment_id`.

Example workflow: read the current layout and send one complete `LayoutKind` matching the desired composition as `properties`.

- Retrieve and follow `editing_layouts` before calling `update_segments`.
- Layout properties replace the layout definition rather than acting as a partial field patch.
- Read the visual Layer IDs from `get_timeline` for the same range and use them in the direct Layer
  ID fields.
- Use structural tools for timing changes.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{transition?:{kind:"auto"}|{kind:"instant"}|{kind:"smooth"};transition_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null}&({kind:"custom";sources:{border_radius_ratio:number;corner_shape?:"regular"|"squircle"|"squircle_v2"|null;face_tracking_mode_override?:"disabled"|"auto"|null;height_ratio:number;layer_id:string;lock_aspect_ratio?:boolean|null;overflow?:boolean|null;shadow?:{blur_ratio:number;color:{a:number;b:number;g:number;r:number};x_offset_ratio:number;y_offset_ratio:number}|null;stroke?:{color:{a:number;b:number;g:number;r:number};width_ratio:number}|null;video_background_override?:{kind:"original"}|{edge_shift:number;kind:"transparent";quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|{blur:number;edge_shift:number;kind:"blur";quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|{blur:number;edge_shift:number;kind:"replace";media_id?:string|null;quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|null;width_ratio:number;x_ratio:number;y_ratio:number}[]}|{fit?:"cover"|"padding"|null;kind:"fullscreen";layer_id:string}|{corner_layer_id:string;corner_shape?:"rounded_rect"|"circle"|"squircle"|"squircle_v2"|null;kind:"corner";main_fit?:"cover"|"padding"|null;main_layer_id:string}|{kind:"side";main_layer_id:string;main_size?:{kind:"adaptive"}|{kind:"fixed";ratio:number}|null;side_layer_id:string}|{corner_layer_id:string;kind:"transparent_corner";main_fit?:"cover"|"padding"|null;main_layer_id:string}|unknown);segment_id:string;type:"layout"}[]};
```
