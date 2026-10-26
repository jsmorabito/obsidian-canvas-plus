# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.12.2]

### Added

- **Web links on diagram nodes.** In a mindmap or flowchart, the node toolbar
  and right-click menu have a **Link to web address…** button. It turns the
  node's text into a link that opens in your browser (Cmd or Ctrl-click, or
  click a node that is already picked). Bold, italic and the other formats are
  kept, and saving an empty address removes the link.
- **Signposts.** Select any object and use the signpost button in its pop-up
  menu to choose a next and a previous object by clicking them on the canvas.
  Step-forward and step-back buttons then go there, selecting the object and
  zooming to it, even on a locked canvas. Mindmap and flowchart nodes have the
  same buttons in their toolbar and can be targets too.

### Fixed

- The wikilink button no longer shows as on for a node with a web link.

## [1.12.1]

### Fixed

- **Linear search.** Searching issues no longer fails with a "Fragment
  IssueFields cannot be spread here" error.

## [1.12.0]

### Added

- **Diagrams.** **Add diagram…** (`B`, or in the actions panel) puts a Mermaid
  diagram on the canvas: mindmap, flowchart, sequence, state, class, entity
  relationship, Gantt, timeline, kanban, pie, quadrant, XY chart or git graph.
  Pele, a small Mermaid renderer, draws it in your theme's colors. The card
  saves the Mermaid source, and its text is a `mermaid` code block, so it still
  draws in a vault without this plugin. Double-click the card's background to
  edit the source with a live preview. Diagrams are listed in the layers panel.
- **Right-click a diagram card** for **Edit source…**, **Copy as Mermaid**,
  **Copy as SVG** and **Save as SVG** (in your attachment folder, in the colors
  of the current theme). A flowchart's card menu also sets which way it runs.
- **Mindmaps can be edited on the canvas.**
  - Pick a node by clicking it. Dots round it add a child or a sibling; `Tab`
    adds a child, `Enter` a sibling, `F2` or a double-click renames it in place,
    `Delete` removes it with what is under it, and the arrow keys move between
    nodes.
  - Drag a node to put it before or after a sibling, or inside another node as
    its child. `Alt` + `↑`/`↓` moves it among its siblings, and `Cmd`/`Ctrl` +
    `]`/`[` indents or outdents it.
  - `Cmd`/`Ctrl` + `D` duplicates a node. Copying with a node picked puts it
    and its children on the clipboard as a markdown list, and pasting a list or
    an outline with a node picked adds it under that node.
  - A toolbar over the node sets its color (the six canvas colors, or any color),
    shape and icon, and turns on bold, italic, underline, code or a wikilink.
    A wikilink opens a note picker that starts from the node's text, and
    `Enter` creates the note when none has that name. Linked nodes open with
    `Cmd`/`Ctrl` + click, or a second click on the picked node, and show a
    preview on hover.
  - With Note Types, Discourse Graphs, Linear or Task App on, the toolbar can
    make a note, a discourse node or an issue from the node's text and link the
    node to it.
  - Web addresses typed into a node are links, and a right-click menu has all of
    the above.
- **Flowcharts can be edited on the canvas.**
  - Click a node or an edge to pick it. Dots round a node add a node after it,
    before it, or beside it as another branch; drag from a dot onto another node
    to join them. `Tab` / `Shift` + `Tab` add a node after or before, and a
    double-click, `Enter` or `F2` renames a node or labels an edge, in place.
  - Drag a node to rearrange the chart: onto another node to hang it from that
    node, or onto a side of a sibling to move it before or after. The side
    matches the dots: the side the chart runs out of is a child.
  - The toolbar sets a node's color, shape (14 of them) and formatting, and an
    edge's style (arrow, line, dotted, thick). `Delete` removes what is picked.
  - A flowchart that uses syntax the editor can't change safely (several nodes
    joined with `&`, edge ids, arrows with text in them) says which line, and
    stays editable as source.
- A test suite for the diagram source editing (`npm test`), run in CI.

### Changed

- Pele is bundled, which makes the plugin about three times larger. The
  production build is now minified.
- The diagram toolbar, dots and in-place field are shared by the mindmap and the
  flowchart editors, ready for more kinds of diagram.

## [1.11.0]

### Added

- **Convert to…** in the selection toolbar and the actions panel: pick a note
  type, and the selected text cards become notes of that type. The first line of
  a card is the note's title and the rest its description. Each card is swapped
  for the note's card in the same place, keeping its arrows, and undo puts it
  all back.
- Discourse Graphs integration, with no changes to that plugin and nothing to
  set up: enable it and these appear.
  - **Create discourse node**: a toolbar button (`D`), an action and a command.
    Type a title, pick the node type, and the new node's card lands on the
    canvas, made the way Discourse Graphs makes it (its folder, name format and
    template).
  - **Discourse context panel**: opens Discourse Graphs' panel as a widget and
    keeps it on the selected card's node.
  - **Convert to discourse node…** in the selection toolbar and the actions
    panel, listing the node types.

### Changed

- The actions panel opens above the tab panels, and comment pins sit under them.

## [1.10.0]

### Added

- Task App integration (beta), the same as Linear's for the self-hosted Task App
  server: add issues to a canvas (`J`), create issues from cards, a Task App
  widget, and card, embed and link views. Set the server address and API token
  under **Settings → Canvas Plus**. Needs a Task App server that accepts its API
  token on `/trpc`.
- **Connect Obsidian** in Task App's settings sets the plugin up in one click:
  Obsidian asks you to confirm, then saves the server address and API token.

### Changed

- Linear and Task App share the same issue code, so the two work alike. The
  selection toolbar and actions panel list each one that is set up.

## [1.9.0]

### Added

- Linear widget, a tab panel (**Open Linear panel** in the actions panel, or
  **Open widget**): lists the issues on the canvas, and searches Linear to add
  more.
- Actions panel: an **Actions** button in the bottom bar, and `Cmd`/`Ctrl` + `K`,
  open a searchable list of actions, with a way into the plugin's settings.
- Layers panel: a collapsible Favorites section.

### Changed

- Every canvas now opens with its tray closed. Whether the tray is open is
  kept for each canvas view, not as one saved preference shared by all
  canvases.
- Linear shows its own app icon, in the actions panel, the selection toolbar
  and the widget's header.
- The layers panel is wider (241px, as Figma's left panel is) and can be
  resized by dragging its right edge, up to 450px. Double-click the edge to
  reset it. The width is remembered.
- The Linear button moved out of the bottom bar into the actions panel. The
  `I` key still adds an issue.

## [1.8.0]

### Added

- Linear integration (beta, off by default: turn it on under
  **Settings → Canvas Plus**, then sign in with OAuth or use an API key):
  - Add a Linear issue to the canvas with the new button in the bottom bar,
    the `I` key, or the **Add Linear issue to canvas** command. Search, or
    enter an identifier or issue URL.
  - Turn cards into Linear issues from the selection toolbar.
  - Show issues as a card, the full issue or a link, switched the same way
    as note cards, and open an issue in Linear from the toolbar.

## [1.7.1]

### Fixed

- The comment, placement and ink tools keep their crosshair cursor over cards
  and groups instead of showing the drag hand.

## [1.7.0]

### Added

- Comment tool (`K`): click the canvas to drop a comment pin with a message.
  A pin is a small bubble that previews its thread on hover and opens the full
  thread on select, with replies, resolve and delete. Comments are saved in
  the canvas file. Drag a pin to move it; a pin let go over a node attaches to
  it and moves with it. A pin can be dragged into the tray and back out.

### Changed

- Several things dragged into the tray together are kept as one card, and
  come back out together, selected.

## [1.6.2]

### Changed

- Free text grows to fit what you type, so long text is no longer cut off.
  Its width stays as you set it and the text wraps there.
- The note search on the canvas no longer lists template notes.

## [1.6.1]

### Changed

- The add note button in the toolbar is hidden when Note Types isn't
  installed or enabled, since the note search needs it.

## [1.6.0]

### Added

- **Create a note from the canvas search.** When no note has the name you
  typed, the search ends with **Create note "…"**. It opens Note Types'
  **New note** window with that title, where you pick the type and fill in
  fields, then adds the new note's card to the canvas. Needs Note Types
  1.13.0 or later; older versions keep the **New <Type>: …** rows.

## [1.5.1]

### Changed

- The layers panel and the minimap now start hidden, on every device, until
  you show them with their buttons in the canvas's top left and lower left.
  Each remembers whether you last left it open. If you used either one
  before but never hid it, it will be hidden after updating: select its
  button once to bring it back.

## [1.5.0]

### Added

- Focus a canvas: select the focus button in the view header, next to the
  presentation button (or run **Toggle canvas focus**), to hide the
  ribbons, sidebars, tab bars, status bar and any other tabs, so the canvas
  fills the window. Select it again (or press `Esc` with nothing selected)
  to bring them back. The window itself stays as it is; it isn't full
  screen. A canvas in a sidebar can't be focused.
- Tray: a holding strip that opens just above the bottom toolbar, from a
  tray button after the eraser. Drag anything on the canvas and the strip
  appears as a drop zone (or, while the tray is open, drop on the tray);
  drop it there and it becomes a small card, and the tray stays open to show
  it (a group goes in with everything inside it). Tab panels go in the same
  way, dragged by their header. Drag a card back onto the canvas to put it
  back. Select the tray button to keep the strip open and see what it holds,
  and again to close it. What the tray holds is saved in the canvas file,
  and undo puts things back.

### Fixed

- Dragging a tab panel that shows a long note no longer lags: a panel's
  place and size are no longer inherited by everything it shows, and it
  moves by transform.

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
