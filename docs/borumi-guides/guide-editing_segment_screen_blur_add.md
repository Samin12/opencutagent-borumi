# Add a Screen Blur Segment

A `screen_blur` Segment obscures a selected screen interval.

Example addition using defaults: `{"type":"screen_blur","placement":{"range":[5000,8000]}}`.

- Screen blur requires `range` placement.
- Omit optional `properties` to use defaults; never send `{}`.
- Inspect the narrowest useful interval before choosing coordinates or intensity.

## Exact input type

```ts
type Input={additions:{placement:{range:number[]};properties?:{blur_kind?:"pixelated"|"grainy"|"black"|null;height_ratio?:number|null;width_ratio?:number|null;x_ratio?:number|null;y_ratio?:number|null}|null;type:"screen_blur"}[];timeline_hash:string;tx_id:string};
```
