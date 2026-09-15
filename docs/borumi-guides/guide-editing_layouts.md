# Layout editing

Prefer Borumi's automatic Layout when it already produces the intended composition. When a custom
Layout Segment is necessary, read the visual Layer IDs from `get_timeline` for the same range before
editing.

## Layout choices

- Use `fullscreen` when one visual should fill the Canvas.
- Use `corner` for a primary visual with a small secondary inset. This is the default layout when Camera and Screen are present together.
- Use `transparent_corner` for a Camera subject over the main visual. It removes the Camera
  background, aligns the subject along the bottom, and requires additional processing.
- Use `side` to show the Camera and Screen side-by-side.
- Use `custom` only when the presets cannot express the composition.

## Guidelines

- Custom coordinates and dimensions are ratios in the Canvas coordinate space. Rectangles may
  extend beyond the Canvas and are clipped by the rendered Canvas, but must have a positive size.
- Later custom sources render in front of earlier sources.
- For custom video background overrides, use only `original` or `transparent`.
- On custom sources, `overflow: false` keeps content inside the Layout rectangle; `true` renders
  the complete original source beyond it.
- Cropped Screen content follows the cursor automatically. Use Screen Zoom for deliberate
  emphasis, not to compensate for ordinary Layout cropping.
- Keep Layout ranges narrow and semantic. A Layer selected at the start may not remain active for
  the complete range.
- Inspect the composed render near the middle of the range and around every changed boundary.
