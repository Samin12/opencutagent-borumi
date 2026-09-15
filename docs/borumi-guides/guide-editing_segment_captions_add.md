# Add a Captions Segment

A `captions` Segment displays generated captions over a Project-time range.

- Captions require `range` placement.
- Confirm transcript availability before adding Captions. If relevant transcription is missing,
  abort the edit transaction, call `request_transcriptions` with `project_id`, wait for completion,
  then begin a fresh transaction.
- If the user specifies a style, use the requested style directly without retrieving a template.
- Otherwise, retrieve `editing_segment_captions_templates`, choose the closest built-in template, and copy its fields into `properties`.
- Never send empty `properties`.

## Exact input type

```ts
type Input={additions:{placement:{range:number[]};properties?:{accent_color?:{a:number;b:number;g:number;r:number}|null;background_color?:{a:number;b:number;g:number;r:number}|null;background_horizontal_padding_ratio?:number|null;background_vertical_padding_ratio?:number|null;bold?:boolean|null;border_radius?:number|null;casing_mode?:"original"|"uppercase"|null;font_families?:string[]|null;future_color?:{a:number;b:number;g:number;r:number}|null;highlight_color?:{a:number;b:number;g:number;r:number}|null;highlight_horizontal_padding_ratio?:number|null;highlight_vertical_padding_ratio?:number|null;italic?:boolean|null;paragraph_mode?:"single_word"|"fill"|null;position?:"bottom"|"top"|"center"|{height_ratio:number;kind:"custom";width_ratio:number;x_ratio:number;y_ratio:number}|null;stroke_color?:{a:number;b:number;g:number;r:number}|null;stroke_width?:number|null;text_color?:{a:number;b:number;g:number;r:number}|null;text_size?:number|null}|null;type:"captions"}[];timeline_hash:string;tx_id:string};
```
