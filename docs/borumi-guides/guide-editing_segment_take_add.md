# Add a Take Segment

A `take` Segment starts at one exact Project time and uses its source duration.

Existing Take example:
`{"type":"take","placement":{"at_ms":1200},"content":{"take_id":"<take_id>"}}`.

Media example:
`{"type":"take","placement":{"at_ms":1200},"content":{"media_id":"<media_id>","video_kind":"screen","audio_kind":"system_sound"}}`.

- Use `take_id` to place an existing Take.
- Use `media_id` to create a Take and one Clip per usable Media track. Optional `video_kind` and
  `audio_kind` values override inference only for the new Segments.
- Import external Media first by following `importing_media`; never pass a file path here.
- Use `at_ms`, not `range`, for Take placement.

## Exact input type

```ts
type Input={additions:{content:{take_id:string}|{audio_kind?:"microphone"|"system_sound"|"music"|null;media_id:string;video_kind?:"camera"|"screen"|null};placement:{at_ms:number};type:"take"}[];timeline_hash:string;tx_id:string};
```
