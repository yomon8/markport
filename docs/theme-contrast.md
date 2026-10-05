# Theme contrast checks

Contrast ratios use WCAG relative luminance for the foreground and its immediate background. Light/Dark values below were calculated for the theme colors introduced in Issue #12.

| Component | Light foreground / background | Light ratio | Dark foreground / background | Dark ratio |
| --- | --- | ---: | --- | ---: |
| Search mark | `#352700` / `#ffdb6d` | 10.83:1 | `#fff5d6` / `#69501a` | 6.98:1 |
| Image icon | `#7650ad` / `#f6f8fa` | 5.60:1 | `#bf9df3` / `#141c26` | 7.63:1 |
| Code icon | `#946018` / `#f6f8fa` | 5.00:1 | `#e4b764` / `#141c26` | 9.20:1 |
| Added badge | `#176b39` / `#daf5e4` | 5.68:1 | `#7de2a0` / `#163928` | 8.04:1 |

The preview iframe uses a white background in both themes. Documents with no background or a transparent background remain readable with their default text color, while a document's explicit background still paints inside the iframe.

## Sepia and Nord

Both presets meet a 4.5:1 minimum for body and muted text, links (including selected and hovered backgrounds), search marks, Git diff text, and syntax colors on normal and selected code lines. `web/tests/themeContrast.test.ts` checks these combinations directly from the palette definitions.

| Component | Sepia foreground / background | Sepia ratio | Nord foreground / background | Nord ratio |
| --- | --- | ---: | --- | ---: |
| Body | `#433422` / `#f4ecd8` | 10.18:1 | `#eceff4` / `#2e3440` | 10.84:1 |
| Muted text | `#6b5943` / `#eee3cc` | 5.26:1 | `#d8dee9` / `#3b4252` | 7.45:1 |
| Link | `#805321` / `#f4ecd8` | 5.61:1 | `#88c0d0` / `#2e3440` | 6.24:1 |
| Search mark | `#433422` / `#e8cc81` | 7.64:1 | `#eceff4` / `#665536` | 6.24:1 |
| Image icon | `#6e4f78` / `#eee3cc` | 5.40:1 | `#c9a8c3` / `#3b4252` | 4.73:1 |
| Code icon | `#805321` / `#eee3cc` | 5.19:1 | `#ebcb8b` / `#3b4252` | 6.44:1 |
| Added badge | `#466338` / `#dce5c8` | 5.18:1 | `#a3be8c` / `#394738` | 4.83:1 |
| Diff added text | `#433422` / `#dce5c8` | 9.18:1 | `#eceff4` / `#394738` | 8.54:1 |
| Diff deleted text | `#433422` / `#f5ded3` | 9.28:1 | `#eceff4` / `#44343e` | 10.09:1 |

- Sepia minimum syntax contrast on normal and selected code lines: **4.61:1**.
- Nord minimum syntax contrast on normal and selected code lines: **4.58:1**.

Nord is based on the [official Nord palettes](https://www.nordtheme.com/docs/colors-and-palettes/). Muted text, purple, red, and orange are brightened where needed, and highlight backgrounds are adjusted to meet the readability target. Sepia uses a warm paper palette with darker green, brown, and purple syntax colors.

Theme palettes live in `web/src/themes.css`. HTML preview backgrounds remain white in all themes; PDF and image content keeps its original appearance.

## Additional named themes

These palettes also meet the 4.5:1 text contrast target checked in `web/tests/themeContrast.test.ts`, including normal and selected code lines, hovered and selected links, search marks, and diff text.

| Theme | Body on background | Muted text on sidebar | Link on background | Minimum syntax contrast |
| --- | ---: | ---: | ---: | ---: |
| Catppuccin Mocha | 11.34:1 | 9.91:1 | 9.17:1 | 5.43:1 |
| Solarized Light | 7.15:1 | 5.02:1 | 5.66:1 | 4.57:1 |
| Rosé Pine Dawn | 6.66:1 | 4.82:1 | 5.59:1 | 4.58:1 |
| Tokyo Night | 10.59:1 | 8.52:1 | 6.79:1 | 5.30:1 |
| Tokyo Night Light | 7.97:1 | 4.78:1 | 4.92:1 | 4.53:1 |

Sources: [Catppuccin Mocha](https://catppuccin.com/palette/), [Solarized](https://ethanschoonover.com/solarized/), [Rosé Pine Dawn](https://rosepinetheme.com/palette/), and [Tokyo Night](https://github.com/folke/tokyonight.nvim) (Night and Day variants). Backgrounds and primary accents follow the source palettes; muted text, some syntax colors, and highlight/diff backgrounds are adapted for readability. Solarized Light and Rosé Pine Dawn use darker syntax accents to preserve contrast on light backgrounds. Tokyo Night comments and line numbers are brightened. Tokyo Night Light uses the Day background with darker blue, purple, green, and cyan foregrounds. HTML previews retain a white iframe background and each document's own colors.
