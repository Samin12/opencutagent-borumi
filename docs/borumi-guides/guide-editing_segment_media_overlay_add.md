# Add a Media Overlay Segment

A `media_overlay` Segment shows existing Project Media above the composition.

Example addition: `{"type":"media_overlay","placement":{"range":[1200,4200]},"content":{"media_id":"<media_id>"}}`.

- Import external Media before adding it, then use the returned Project Media ID.
- Use `at_ms` for the default duration or `range` for an explicit Project-time interval.
- Omit optional `properties` rather than sending an empty object.

## Exact input type

```ts
type Input={additions:{content:{media_id:string};placement:{at_ms:number}|{range:number[]};properties?:{border_radius_ratio?:number|null;corner_shape?:"rounded_rect"|"squircle"|"squircle_v2"|null;enter_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;entrance_transition?:{kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{direction:"up"|"right"|"down"|"left";kind:"slide"}|null;exit_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;exit_transition?:{kind:"auto"}|{kind:"instant"}|{kind:"fade"}|{direction:"up"|"right"|"down"|"left";kind:"slide"}|null;lock_aspect_ratio?:boolean|null;position?:"auto"|{height_ratio:number;kind:"custom";width_ratio:number;x_ratio:number;y_ratio:number}|null;shadow?:{blur_ratio:number;color:{a:number;b:number;g:number;r:number};x_offset_ratio:number;y_offset_ratio:number}|null;stroke?:{color:{a:number;b:number;g:number;r:number};width_ratio:number}|null}|null;type:"media_overlay"}[];timeline_hash:string;tx_id:string};
```
