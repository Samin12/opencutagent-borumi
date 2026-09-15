# Update a Screen Zoom Segment

Screen zoom updates target a persisted `screen_zoom` Segment by `segment_id`.

Example workflow: read current zoom properties, then send only schema-approved fields that need changing in a non-empty patch.

- Inspect the affected range if changing a visual target.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{enter_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;exit_sound?:{sound_id:"whooosh"|"whoosh"|"pop"|"ding"|"boom"|"click"|"drums"|"rewind"|"vinyl";volume:number}|null;focus_point?:"cursor"|{kind:"position";x_ratio:number;y_ratio:number}|null;zoom_factor?:number|null};segment_id:string;type:"screen_zoom"}[]};
```
