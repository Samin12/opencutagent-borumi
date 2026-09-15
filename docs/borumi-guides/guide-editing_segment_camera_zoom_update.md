# Update a Camera Zoom Segment

Camera zoom updates target a persisted `camera_zoom` Segment by `segment_id`.

Example workflow: read current zoom properties, then send only schema-approved fields that need changing in a non-empty patch.

- Inspect the affected range if changing framing or tracking behavior.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{enter_mode?:"instant"|"fast"|"gradual"|null;enter_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;exit_mode?:"instant"|"fast"|null;exit_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;focus_point?:"face"|{kind:"position";x_ratio:number;y_ratio:number}|null;zoom_factor?:number|null};segment_id:string;type:"camera_zoom"}[]};
```
