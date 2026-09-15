# Update a Video Segment

Video updates target a persisted `video` Segment by the `segment_id` returned by `get_timeline`.

Example workflow: read the Segment with `properties`, select only schema-approved fields that need changing, and send them in one non-empty `properties` patch.

- Do not include timing, source, grouping, or identity fields.
- Preserve fields you do not intend to change by omitting them.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{background?:{kind:"original"}|{edge_shift:number;kind:"transparent";quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|{blur:number;edge_shift:number;kind:"blur";quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|{blur:number;edge_shift:number;kind:"replace";media_id?:string|null;quality?:"fast"|"balanced"|"high"|"very_high"|null;softness:number}|null;color_adjustments?:{contrast?:number|null;exposure?:number|null;highlights?:number|null;lut?:{id:string;kind:"built_in"}|{kind:"media";media_id:string}|null;lut_intensity?:number|null;saturation?:number|null;shadows?:number|null;temperature?:number|null;tint?:number|null}|null;crop?:{height_ratio:number;width_ratio:number;x_ratio:number;y_ratio:number}|null;face_tracking_mode?:"disabled"|"auto"|null;mirrored?:boolean|null;transition?:{kind:"auto"}|{kind:"cut"}|{kind:"crossfade"}|{kind:"fade_through"}|{direction:"up"|"right"|"down"|"left";kind:"push"}};segment_id:string;type:"video"}[]};
```
