# Update a Legacy Overlay Segment

`overlay` is a legacy Segment type. Update it only when `get_timeline` reports that exact type.

Example workflow: copy only the schema-approved properties that need changing into a non-empty patch for the returned `segment_id`.

- Do not use this type for a `media_overlay` Segment.
- Do not include timing, grouping, or identity fields.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{border_radius_ratio?:number;corner_shape?:"rounded_rect"|"squircle"|"squircle_v2";enter_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;entrance_transition?:{kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{direction:"up"|"right"|"down"|"left";kind:"slide"};exit_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;exit_transition?:{kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{direction:"up"|"right"|"down"|"left";kind:"slide"};lock_aspect_ratio?:boolean;position?:"auto"|{height_ratio:number;kind:"custom";width_ratio:number;x_ratio:number;y_ratio:number}|null;shadow?:{blur_ratio:number;color:{a:number;b:number;g:number;r:number};x_offset_ratio:number;y_offset_ratio:number}|null;stroke?:{color:{a:number;b:number;g:number;r:number};width_ratio:number}|null};segment_id:string;type:"overlay"}[]};
```
