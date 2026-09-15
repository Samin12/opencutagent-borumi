# Update a Music Segment

Music updates target a persisted `music` Segment by `segment_id`.

Example workflow: read current music properties, then send only the schema-approved fields that need changing in a non-empty `properties` patch.

- Updating properties does not replace the Media source or move the Segment.
- Use structural tools for timing changes.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{enable_looping?:boolean|null;fade_in?:boolean|null;fade_out?:boolean|null;volume_filter?:number|null};segment_id:string;type:"music"}[]};
```
