# Update a Media Overlay Segment

Media overlay updates target a persisted `media_overlay` Segment by `segment_id`.

Example workflow: read current overlay properties, then send only schema-approved fields that need changing in a non-empty `properties` patch.

- Updating properties does not replace the referenced Project Media.
- Use structural tools for timing changes.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{border_radius_ratio?:number;corner_shape?:"rounded_rect"|"squircle"|"squircle_v2";enter_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;entrance_transition?:{kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{direction:"up"|"right"|"down"|"left";kind:"slide"};exit_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;exit_transition?:{kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{direction:"up"|"right"|"down"|"left";kind:"slide"};lock_aspect_ratio?:boolean;position?:"auto"|{height_ratio:number;kind:"custom";width_ratio:number;x_ratio:number;y_ratio:number}|null;shadow?:{blur_ratio:number;color:{a:number;b:number;g:number;r:number};x_offset_ratio:number;y_offset_ratio:number}|null;stroke?:{color:{a:number;b:number;g:number;r:number};width_ratio:number}|null};segment_id:string;type:"media_overlay"}[]};
```
