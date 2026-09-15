# Text Overlay Templates

Use these built-in templates as starting points when styling a text overlay. Copy the selected template's fields into the overlay `properties`; provide the actual `text` and choose its position separately. The template names are not suggested overlay text.

When applying a template to an existing overlay, the `null` values clear conflicting optional styling. If the overlay has `style_ranges`, set `style_ranges` to `null` when the selected template should apply uniformly to all text.

## Bold

Use for primary headlines and energetic title cards where maximum impact matters.

```json
{"sizing_mode":"hug","text_size":150.0,"line_height":1.3,"text_color":{"r":255,"g":255,"b":255,"a":255},"background_color":null,"background_sizing_mode":"auto","background_horizontal_padding_ratio":0.18,"background_vertical_padding_ratio":0.12,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":true,"italic":false,"stroke_color":null,"stroke_width":0.0,"text_shadow":true,"text_shadow_color":null,"text_shadow_blur_ratio":0.5,"text_shadow_spread_ratio":0.25,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.0,"casing_mode":"uppercase","font_families":["Poppins","sans-serif"],"alignment":"center","wrapping_mode":null}
```

## Modern

Use for contemporary, condensed headlines with a clean editorial or technical character.

```json
{"sizing_mode":"hug","text_size":150.0,"line_height":1.3,"text_color":{"r":255,"g":255,"b":255,"a":255},"background_color":null,"background_sizing_mode":"auto","background_horizontal_padding_ratio":0.18,"background_vertical_padding_ratio":0.12,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":true,"italic":false,"stroke_color":null,"stroke_width":0.0,"text_shadow":true,"text_shadow_color":null,"text_shadow_blur_ratio":0.5,"text_shadow_spread_ratio":0.25,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.0,"casing_mode":"uppercase","font_families":["Bebas Neue","sans-serif"],"alignment":"center","wrapping_mode":null}
```

## Classy

Use for large formal or editorial titles with a strong serif presence.

```json
{"sizing_mode":"hug","text_size":180.0,"line_height":1.3,"text_color":{"r":255,"g":255,"b":255,"a":255},"background_color":null,"background_sizing_mode":"auto","background_horizontal_padding_ratio":0.18,"background_vertical_padding_ratio":0.12,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":false,"italic":false,"stroke_color":null,"stroke_width":0.0,"text_shadow":true,"text_shadow_color":null,"text_shadow_blur_ratio":0.5,"text_shadow_spread_ratio":0.25,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.0,"casing_mode":"uppercase","font_families":["DM Serif Display","Georgia","serif"],"alignment":"center","wrapping_mode":null}
```

## Glowing

Use for high-impact titles that need warm emphasis against a dark or visually busy image.

```json
{"sizing_mode":"hug","text_size":150.0,"line_height":1.3,"text_color":{"r":255,"g":255,"b":255,"a":255},"background_color":null,"background_sizing_mode":"auto","background_horizontal_padding_ratio":0.18,"background_vertical_padding_ratio":0.12,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":true,"italic":false,"stroke_color":null,"stroke_width":0.0,"text_shadow":true,"text_shadow_color":{"r":241,"g":196,"b":15,"a":137},"text_shadow_blur_ratio":0.5,"text_shadow_spread_ratio":0.25,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.0,"casing_mode":"uppercase","font_families":["Poppins","sans-serif"],"alignment":"center","wrapping_mode":null}
```

## Elegant

Use for quotes, names, chapter cards, or refined callouts that benefit from softer italic serif text.

```json
{"sizing_mode":"hug","text_size":84.0,"line_height":1.3,"text_color":{"r":255,"g":255,"b":255,"a":255},"background_color":null,"background_sizing_mode":"auto","background_horizontal_padding_ratio":0.18,"background_vertical_padding_ratio":0.12,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":false,"italic":true,"stroke_color":null,"stroke_width":0.0,"text_shadow":true,"text_shadow_color":null,"text_shadow_blur_ratio":0.5,"text_shadow_spread_ratio":0.25,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.0,"casing_mode":"original","font_families":["DM Serif Display","Georgia","serif"],"alignment":"center","wrapping_mode":null}
```

## Highlight

Use for short announcements, keywords, or calls to attention that need strong foreground/background contrast.

```json
{"sizing_mode":"hug","text_size":150.0,"line_height":1.3,"text_color":{"r":0,"g":0,"b":0,"a":255},"background_color":{"r":255,"g":246,"b":52,"a":255},"background_sizing_mode":"auto","background_horizontal_padding_ratio":0.2,"background_vertical_padding_ratio":0.12,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":false,"italic":false,"stroke_color":null,"stroke_width":0.0,"text_shadow":false,"text_shadow_color":null,"text_shadow_blur_ratio":0.5,"text_shadow_spread_ratio":0.25,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.0,"casing_mode":"uppercase","font_families":["Bebas Neue","sans-serif"],"alignment":"center","wrapping_mode":null}
```

## Subtitle

Use for authored supporting text that should remain visually subordinate to titles. Use a captions Segment instead for speech-synchronized transcription.

```json
{"sizing_mode":"hug","text_size":40.0,"line_height":1.3,"text_color":{"r":255,"g":255,"b":255,"a":255},"background_color":null,"background_sizing_mode":"auto","background_horizontal_padding_ratio":0.18,"background_vertical_padding_ratio":0.12,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":false,"italic":false,"stroke_color":null,"stroke_width":0.0,"text_shadow":true,"text_shadow_color":null,"text_shadow_blur_ratio":0.5,"text_shadow_spread_ratio":0.25,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.0,"casing_mode":"original","font_families":["Poppins","sans-serif"],"alignment":"center","wrapping_mode":null}
```

## Label

Use for short identifiers, section tags, speaker names, or lower-third-like labels that need a stable background.

```json
{"sizing_mode":"hug","text_size":64.0,"line_height":1.3,"text_color":{"r":255,"g":255,"b":255,"a":255},"background_color":{"r":0,"g":0,"b":0,"a":153},"background_sizing_mode":"paragraph","background_horizontal_padding_ratio":0.48,"background_vertical_padding_ratio":0.42,"background_x_offset_ratio":0.0,"background_y_offset_ratio":0.0,"bold":true,"italic":false,"stroke_color":null,"stroke_width":0.0,"text_shadow":false,"text_shadow_color":null,"text_shadow_blur_ratio":0.04,"text_shadow_spread_ratio":0.0,"text_shadow_x_offset_ratio":0.0,"text_shadow_y_offset_ratio":0.01,"casing_mode":"original","font_families":["DM Sans","sans-serif"],"alignment":"center","wrapping_mode":null}
```
