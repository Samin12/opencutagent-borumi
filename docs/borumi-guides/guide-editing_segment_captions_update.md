# Update a Captions Segment

Captions updates target a persisted `captions` Segment by `segment_id`.

Example workflow: read current caption properties, then send only schema-approved style or behavior fields that need changing.

- The `properties` patch must be non-empty.
- Do not include transcript content, placement, or duration.
- For a small, explicit style change, update only the requested fields without retrieving a template.
- If the user specifies a complete style, use it directly without retrieving a template.
- Otherwise, before replacing the overall style, retrieve `editing_segment_captions_templates`, choose the closest built-in template, and copy all of its fields into `properties`.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{accent_color?:{a:number;b:number;g:number;r:number}|null;background_color?:{a:number;b:number;g:number;r:number}|null;background_horizontal_padding_ratio?:number|null;background_vertical_padding_ratio?:number|null;bold?:boolean|null;border_radius?:number|null;casing_mode?:"original"|"uppercase"|null;font_families?:string[]|null;future_color?:{a:number;b:number;g:number;r:number}|null;highlight_color?:{a:number;b:number;g:number;r:number}|null;highlight_horizontal_padding_ratio?:number|null;highlight_vertical_padding_ratio?:number|null;italic?:boolean|null;paragraph_mode?:"single_word"|"fill"|null;position?:"bottom"|"top"|"center"|{height_ratio:number;kind:"custom";width_ratio:number;x_ratio:number;y_ratio:number}|null;stroke_color?:{a:number;b:number;g:number;r:number}|null;stroke_width?:number|null;text_color?:{a:number;b:number;g:number;r:number}|null;text_size?:number|null};segment_id:string;type:"captions"}[]};
```
