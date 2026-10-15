# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Focus a canvas: select the focus button in the view header, next to the
  presentation button (or run **Toggle canvas focus**), to hide the
  ribbons, sidebars, tab bars, status bar and any other tabs, so the canvas
  fills the window. Select it again (or press `Esc` with nothing selected)
  to bring them back. The window itself stays as it is; it isn't full
  screen. A canvas in a sidebar can't be focused.
- Tray: a holding strip over the canvas, opening to the left of its button
  at the top of the canvas controls (settings moves down above help). Drag anything
  on the canvas and the strip appears; drop it there and it becomes a small
  card (a group goes in with everything inside it). Tab panels go in the
  same way, dragged by their header. Drag a card back onto the canvas to
  put it back. Select the tray button to keep the strip open and see what it holds, and again to close
  it. What the tray holds is saved in the canvas file, and undo puts things
  back.

## [1.4.0]

### Added

- Present a canvas: select the presentation button in the view header (or
  run **Toggle presentation**) to step through its anchors like slides.
  Each stop shows the smallest group around its anchor, or centres an anchor
  outside any group, and the view eases there; with reduced motion it moves
  at once. Use the arrow keys, Space or Page Up/Down, or the bar at the
  bottom; select the count (or press `G`) for a menu of every stop. `Esc`
  or the header button ends it. While presenting, the canvas is read-only
  and the panels and menus are hidden. **Next presentation stop** and
  **Previous presentation stop** can be given hotkeys, for a clicker.
- Anchor frames: drag with the Anchor tool to draw a frame, the area a
  presentation shows at that stop. Like a core group it lets clicks through
  until selected, but it holds nothing: moving it moves only the frame.
- Presentation order: filter the layers panel to **Anchors** to list them
  numbered in presentation order, and drag a row to reorder (on touch, hold
  the row first). Canvases never reordered keep reading order; once one has
  an order, new anchors go last. Locked canvases can't be reordered.

### Changed

- Tool shortcuts work whenever the canvas is the active tab, through the
  view's own key scope, as core's shortcuts do.
- New anchors are named Anchor 1, Anchor 2 and so on.
- An anchor's name works like a group's label: it shows the grab hand,
  pressing it selects and drags the anchor, and double-clicking renames it.

### Fixed

- A new anchor could stay looking as if it was being renamed after clicking
  away. Renaming now always ends on a click elsewhere, and when the canvas
  closes or the plugin unloads.

## [1.3.0]

### Added

- Tab panels: select **Add panel** in the canvas controls on the right to
  open a new tab floating over the canvas. It starts on the new tab screen
  and works like any tab, plus **Open widget**: a searchable list of the views core
  and community plugins add (outline, graph, bookmarks and so on). Drag
  its header to move it and its edges to resize it; the canvas moves
  underneath. Panels, their positions and what they
  show come back when the canvas is opened again.

## [1.2.1]

### Added

- Links and groups can be renamed from the layers panel: hover the row and
  select the pencil. A link gets a readable name in place of its URL; leave
  it empty to show the URL again. Search still finds a renamed link by its
  URL.

### Changed

- The layers panel uses Obsidian's own tree styles, as in the file explorer
  and outline: hover, selection, indentation guides and the collapse triangle
  now follow your theme.
- Escape in a field you're typing in, such as the layers search box, now goes
  to that field instead of switching a canvas tool back to Select.

### Fixed

- The arrow keys move the cursor while renaming an anchor, instead of
  nudging the selected nodes on the canvas.

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
