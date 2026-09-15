# Sound effects

Choose the sound type by how it should behave:

- For a sound synchronized to an overlay, Layout change, Screen Zoom, or Camera Zoom, attach a
  built-in sound directly to that Segment's properties. Use `enter_sound`/`exit_sound` for
  overlays and zooms, `transition_sound` for Layouts.
- For any custom audio file or independently timed sound, retrieve `importing_media`, import the
  audio, then retrieve `editing_segment_sound_effect_add` and add a `sound_effect` Segment using
  the returned Media ID.

```ts
type BuiltInSoundId =
  | "whooosh"
  | "whoosh"
  | "pop"
  | "ding"
  | "boom"
  | "click"
  | "drums"
  | "rewind"
  | "vinyl";

type SegmentSound = {
  sound_id: BuiltInSoundId;
  volume: number;
};
```

Keep `volume` at `0` unless an adjustment is intended. Example `update_segments` entries:

```json
{"type":"layout","segment_id":"<layout_segment_id>","properties":{"transition_sound":{"sound_id":"whoosh","volume":0}}}
{"type":"screen_zoom","segment_id":"<zoom_segment_id>","properties":{"enter_sound":{"sound_id":"whooosh","volume":0}}}
```

Set a sound property to `null` to remove it. Custom sound example after import:

```json
{"type":"sound_effect","placement":{"at_ms":1200},"content":{"media_id":"<media_id>"}}
```
