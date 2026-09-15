# Add a Screen Zoom Segment

A `screen_zoom` Segment emphasizes an exact Project-time interval.

Example addition using defaults: `{"type":"screen_zoom","placement":{"range":[5000,8000]}}`.

- Screen zoom requires `range` placement.
- Omit optional `properties` to use defaults; never send `{}`.
- Avoid overlapping effects unless the intended composition requires them.

## Exact input type

```ts
type Input={additions:{placement:{range:number[]};properties?:{enter_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;exit_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;focus_point?:"cursor"|{kind:"position";x_ratio:number;y_ratio:number}|null;zoom_factor?:number|null}|null;type:"screen_zoom"}[];timeline_hash:string;tx_id:string};
```
