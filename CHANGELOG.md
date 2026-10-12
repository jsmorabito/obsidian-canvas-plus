# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0]

### Added

- Minimap in the lower left of the canvas, showing every node and the part
  in view. Select or drag on it to move the view. It can be hidden, and
  starts hidden on phones.

### Changed

- Jumping to a node from the relations panel or the note picker now keeps it
  clear of the layers panel and the minimap, as the layers panel already did
  for itself.

## [1.1.0]

### Added

- Anchor tool (`A`), next to Group in the bottom bar. Click the canvas to drop
  an anchor icon, named in a label above it that keeps its size at any zoom.
  Double-click to rename. Anchors are listed in the layers panel; select one
  to jump to it.

### Changed

- Free text and drawings are stored under `ffcKind` and `ffcInk` (were
  `athensKind` and `athensInk`). Canvases saved by 1.0.x lose free text and
  ink styling.

## [1.0.2]

### Added

- Collapse groups in the layers panel with the triangle beside each group.
  A collapsed group's name is highlighted when the selection is inside it.
  Search and filter always show every result.

## [1.0.1]

### Fixed

- Build setup now matches the APIs the code uses, clearing the type-safety
  warnings from the plugin review. No change in how the plugin works.

### Changed

- Dropped the `builtin-modules` dev dependency in favour of Node's built-in
  module list.

## [1.0.0]

### Added

- First release as its own plugin. The canvas tools, note cards, relations on
  edges, key images, ink and layers panel move here from Note Types 1.11.2,
  unchanged. Canvas files made with Note Types open as before.
- Works without Note Types: the tools, free text, ink and layers panel are
  always on, and the typed-note features turn on when Note Types is enabled.
