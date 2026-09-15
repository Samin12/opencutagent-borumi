# Captions Templates

Use these built-in templates as starting points when styling Captions. Copy the selected template's fields into the captions `properties`, then adjust only the fields needed for the user's request.

When applying a template to existing Captions, the `null` values clear conflicting optional styling.

## Boxed

Use for readable, understated Captions with a translucent background and dimmed upcoming words.

```json
{"position":null,"paragraph_mode":null,"text_size":48.0,"text_color":{"r":255,"g":255,"b":255,"a":255},"future_color":{"r":255,"g":255,"b":255,"a":120},"background_color":{"r":0,"g":0,"b":0,"a":160},"background_horizontal_padding_ratio":0.7,"background_vertical_padding_ratio":0.42,"border_radius":18.0,"accent_color":null,"highlight_color":null,"highlight_horizontal_padding_ratio":null,"highlight_vertical_padding_ratio":null,"casing_mode":null,"font_families":["DM Sans","sans-serif"],"bold":null,"italic":null,"stroke_color":null,"stroke_width":null}
```

## Highlight

Use for bold Captions that emphasize the active word with a blue background.

```json
{"position":null,"paragraph_mode":null,"text_size":56.0,"text_color":{"r":255,"g":255,"b":255,"a":255},"future_color":null,"background_color":null,"background_horizontal_padding_ratio":null,"background_vertical_padding_ratio":null,"border_radius":null,"accent_color":null,"highlight_color":{"r":0,"g":153,"b":255,"a":255},"highlight_horizontal_padding_ratio":0.22,"highlight_vertical_padding_ratio":0.13,"casing_mode":null,"font_families":["DM Sans","sans-serif"],"bold":true,"italic":null,"stroke_color":null,"stroke_width":null}
```

## Accent

Use for bold uppercase Captions that emphasize the active word in yellow.

```json
{"position":null,"paragraph_mode":null,"text_size":56.0,"text_color":{"r":255,"g":255,"b":255,"a":255},"future_color":null,"background_color":null,"background_horizontal_padding_ratio":null,"background_vertical_padding_ratio":null,"border_radius":null,"accent_color":{"r":255,"g":212,"b":0,"a":255},"highlight_color":null,"highlight_horizontal_padding_ratio":null,"highlight_vertical_padding_ratio":null,"casing_mode":"uppercase","font_families":["Poppins","sans-serif"],"bold":true,"italic":null,"stroke_color":null,"stroke_width":null}
```

## Impact

Use for large, high-impact, single-word Captions with a strong black outline.

```json
{"position":null,"paragraph_mode":"single_word","text_size":120.0,"text_color":{"r":255,"g":255,"b":255,"a":255},"future_color":null,"background_color":null,"background_horizontal_padding_ratio":null,"background_vertical_padding_ratio":null,"border_radius":null,"accent_color":null,"highlight_color":null,"highlight_horizontal_padding_ratio":null,"highlight_vertical_padding_ratio":null,"casing_mode":"uppercase","font_families":["Poppins","sans-serif"],"bold":true,"italic":false,"stroke_color":{"r":0,"g":0,"b":0,"a":255},"stroke_width":20.0}
```

## Card

Use for bold uppercase Captions on a white rounded background with a blue active-word accent.

```json
{"position":null,"paragraph_mode":null,"text_size":60.0,"text_color":{"r":0,"g":0,"b":0,"a":255},"future_color":null,"background_color":{"r":255,"g":255,"b":255,"a":255},"background_horizontal_padding_ratio":0.5,"background_vertical_padding_ratio":0.14,"border_radius":20.0,"accent_color":{"r":0,"g":166,"b":255,"a":255},"highlight_color":null,"highlight_horizontal_padding_ratio":null,"highlight_vertical_padding_ratio":null,"casing_mode":"uppercase","font_families":["Poppins","sans-serif"],"bold":true,"italic":null,"stroke_color":null,"stroke_width":null}
```

## Outline

Use for clean white Captions with a black outline that remains readable over varied footage.

```json
{"position":null,"paragraph_mode":null,"text_size":56.0,"text_color":{"r":255,"g":255,"b":255,"a":255},"future_color":null,"background_color":null,"background_horizontal_padding_ratio":null,"background_vertical_padding_ratio":null,"border_radius":null,"accent_color":null,"highlight_color":null,"highlight_horizontal_padding_ratio":null,"highlight_vertical_padding_ratio":null,"casing_mode":null,"font_families":["DM Sans","sans-serif"],"bold":null,"italic":null,"stroke_color":{"r":0,"g":0,"b":0,"a":255},"stroke_width":10.0}
```
