# Add a Sound Effect Segment

A `sound_effect` Segment uses an existing Project audio Media ID and does not change Scene duration.

Example addition: `{"type":"sound_effect","placement":{"at_ms":1200},"content":{"media_id":"<media_id>"}}`.

- Import external audio before adding it.
- Use `at_ms` for the available source duration or `range` to shorten the Project-time interval.
- Sound effects may overlap; Borumi places overlapping Segments on separate audio layers.
- Omit optional `properties` rather than sending an empty object.

## Exact input type

```ts
type Input={additions:{content:{media_id:string};placement:{at_ms:number}|{range:number[]};properties?:{volume_filter?:number|null}|null;type:"sound_effect"}[];timeline_hash:string;tx_id:string};
```
