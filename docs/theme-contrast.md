# Theme contrast checks

Contrast ratios use WCAG relative luminance for the foreground and its immediate background. Values were calculated for the theme colors introduced in Issue #12.

| Component | Light foreground / background | Light ratio | Dark foreground / background | Dark ratio |
| --- | --- | ---: | --- | ---: |
| Search mark | `#352700` / `#ffdb6d` | 10.83:1 | `#fff5d6` / `#69501a` | 6.98:1 |
| Image icon | `#7650ad` / `#f6f8fa` | 5.60:1 | `#bf9df3` / `#141c26` | 7.63:1 |
| Code icon | `#946018` / `#f6f8fa` | 5.00:1 | `#e4b764` / `#141c26` | 9.20:1 |
| Added badge | `#176b39` / `#daf5e4` | 5.68:1 | `#7de2a0` / `#163928` | 8.04:1 |

The preview iframe uses a white background in both themes. Documents with no background or a transparent background remain readable with their default text color, while a document's explicit background still paints inside the iframe.
