# Update a Sound Effect Segment

Sound effect updates target a persisted `sound_effect` Segment by `segment_id`.

Example workflow: read the current sound effect properties, then send only the schema-approved fields that need changing in a non-empty `properties` patch.

- Updating properties does not replace the Media source or move the Segment.
- Use structural tools for timing changes.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{volume_filter?:number|null};segment_id:string;type:"sound_effect"}[]};
```
