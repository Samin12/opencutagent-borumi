# Add a Music Segment

A `music` Segment uses an existing Project Media ID.

Example addition: `{"type":"music","placement":{"at_ms":0},"content":{"media_id":"<media_id>"}}`.

- Import external audio before adding it.
- Use `at_ms` for the source duration or `range` to constrain the Project-time interval.
- Omit optional `properties` rather than sending an empty object.

## Exact input type

```ts
type Input={additions:{content:{media_id:string};placement:{at_ms:number}|{range:number[]};properties?:{enable_looping?:boolean|null;fade_in?:boolean|null;fade_out?:boolean|null;volume_filter?:number|null}|null;type:"music"}[];timeline_hash:string;tx_id:string};
```
