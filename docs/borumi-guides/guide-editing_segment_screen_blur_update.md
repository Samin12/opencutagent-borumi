# Update a Screen Blur Segment

Screen blur updates target a persisted `screen_blur` Segment by `segment_id`.

Example workflow: inspect the affected range, read current blur properties, and send only schema-approved fields that need changing.

- The `properties` patch must be non-empty.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{blur_kind?:"pixelated"|"grainy"|"black";height_ratio?:number;width_ratio?:number;x_ratio?:number;y_ratio?:number};segment_id:string;type:"screen_blur"}[]};
```
