# Update an Audio Segment

Audio updates target a persisted `audio` Segment by the `segment_id` returned by `get_timeline`.

Example workflow: read the Segment with `properties`, select only schema-approved audio fields that need changing, and send them in one non-empty `properties` patch.

- Do not include timing, source, grouping, or identity fields.
- Preserve fields you do not intend to change by omitting them.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{noise_cancelling_filter?:number|null;noise_cancelling_mode?:"auto"|"speed"|"quality"|null;voice_enhancement_filter?:"disabled"|"minimal"|"extended"|null;volume_filter?:number|null};segment_id:string;type:"audio"}[]};
```
