# Add a Camera Zoom Segment

A `camera_zoom` Segment emphasizes an exact Project-time interval.

Example addition using defaults: `{"type":"camera_zoom","placement":{"range":[5000,8000]}}`.

- Camera zoom requires `range` placement.
- Omit optional `properties` to use defaults; never send `{}`.
- Confirm the selected interval has visible camera content.

## Exact input type

```ts
type Input={additions:{placement:{range:number[]};properties?:{enter_mode?:"instant"|"fast"|"gradual"|null;enter_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;exit_mode?:"instant"|"fast"|null;exit_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;focus_point?:"face"|{kind:"position";x_ratio:number;y_ratio:number}|null;zoom_factor?:number|null}|null;type:"camera_zoom"}[];timeline_hash:string;tx_id:string};
```
