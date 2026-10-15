# Canvas Plus — Obsidian Plugin

![Canvas Plus on an Obsidian canvas: the tool bar, layers panel and minimap](docs/mockups/hero.svg)

Drawing and layout tools for Obsidian's canvas. Paired with the [Note Types](https://github.com/jsmorabito/obsidian-note-types) plugin, typed notes become cards and edges between them become relations.

---

## Features

**Tools in one bar**  
Open a canvas and Obsidian's bottom menu becomes one bar: Select, then its own draggable Card, Note and Media buttons and a draggable **Add note** (`N`) button, then Text (`T`), Group (`G`), Anchor (`A`), Marker (`M`), Highlighter (`⇧M`) and Eraser (`E`). `Esc` cancels. Click Text or Group, then click or drag on the canvas to place one. Free text has no card chrome and removes itself if left empty. Click Anchor, then click on the canvas to drop an anchor icon, or drag to draw a frame: the area a presentation shows at that stop. A frame lets clicks through until it is selected, like a core group, but holds nothing. An anchor's name sits above it like a group's label and stays readable at any zoom; drag the name to move it and double-click it to rename it. New anchors are numbered (Anchor 1, Anchor 2…). The tools also work in a canvas popped out into its own window.

![The tool bar placing a group around two cards](docs/mockups/tools.svg)

**Ink**  
Marker and highlighter strokes, with a pen color row (none plus the six canvas presets). The eraser removes whole strokes.

![Marker and highlighter strokes with the pen color row](docs/mockups/ink.svg)

**Layers panel**  
A panel on the left lists groups, anchors and what they contain; select an anchor to jump to it. Hover a group or web link and select the pencil to rename it; a link's name shows in place of its URL. It has a search box and a filter by kind of layer or note type. Filtered to **Anchors**, it lists them numbered in presentation order instead; drag a row to reorder them (on touch, hold the row first).

![The layers panel listing groups, anchors and notes](docs/mockups/layers.svg)

**Minimap**  
An overview of the whole canvas in the lower left, with a box for the part in view. Select or drag on it to move the view. Hide it with the button in its corner; it starts hidden on phones.

![The minimap in the lower left with a box for the part in view](docs/mockups/minimap.svg)

**Presenting**  
Select the presentation button in the view header, next to core's view buttons, or run **Toggle presentation**, to step through the canvas's anchors like slides, in the order set in the layers panel (or top to bottom, then left to right), starting from the selected anchor or the first. Each stop shows its frame, or else the smallest group around its anchor, or centres an anchor outside any group, and the view eases there as it does for core's zoom to selection (at once if your system asks for reduced motion). Move with the arrow keys, Space and Shift+Space, or Page Up and Page Down, or with the bar at the bottom; select the count, or press `G`, for a menu of every stop. `Esc` or the header button ends it, leaving the view where it is. While presenting, the canvas is read-only (core's lock) and the panels, menus and anchors are hidden. **Next presentation stop** and **Previous presentation stop** are commands too, so they can be given hotkeys, for a presentation clicker.

![Presenting a canvas, with the menu of stops open](docs/mockups/present.svg)

**Focusing**  
Select the focus button in the view header, next to the presentation button, or run **Toggle canvas focus**, to let the canvas fill the window: the ribbons, sidebars, tab bars, status bar and any other tabs are hidden, leaving the canvas and its view header. Select it again, or press `Esc` with nothing selected, to bring them back. A canvas in a sidebar can't be focused; move it into the main area first. The window stays as it is; it isn't full screen. Opening another tab or a sidebar view brings them back too.

**Tray**  
Drag anything on the canvas and a strip appears, opening to the left of the tray button at the top of the canvas controls (settings moves down, just above help): drop it there to hold it for later as a small card. A group goes in with everything inside it, and edges between the things held come back with them. A tab panel goes in too when you drag it there by its header, and opens again where you drag its card back out. Drag a card back onto the canvas to put it back where you drop it. Select the tray button to keep the strip open and see what it holds, and again to close it. What the tray holds is saved in the canvas file, and undo puts things back.

**Tab panels**  
Select **Add panel** above the help button in the controls on the right to open a new tab floating over the canvas. It starts on the new tab screen and works like any tab: create a note, go to a file, follow links, go back and forward. Its new tab screen also has **Open widget**, a searchable list of the views core and community plugins add, such as the outline, graph view or bookmarks, to open in the panel. Drag its header to move it and drag an edge or corner to resize it. Panels float above the canvas, not on it, so the canvas pans and zooms underneath. Each canvas remembers its panels, where they sit and what they show, and brings them back when you open it again. Close one with the × at the right end of its header.

![A tab panel floating over the canvas](docs/mockups/panels.svg)

**With Note Types**  
These need the [Note Types](https://github.com/jsmorabito/obsidian-note-types) plugin enabled. Without it, the rest of Canvas Plus works as usual.

- **Note cards.** Typed notes appear as cards showing an optional key image, the title and any properties you list under **Canvas card fields** for that note type (in Note Types' settings). A button in the selection toolbar, or the **Cycle selected canvas note cards between card, embed and styled link** command, switches a card to a full embed or to a styled link, the same pill the editor shows.
- **Add note (`N`).** Add a typed note to the canvas, or create a new note of a type and its card in one step.
- **Relations on edges.** Connect two cards to choose a relation, which is written to both notes' frontmatter. Select a card to see its relations in a side panel.
- **Key images.** Drop an image on a card to set its key image.
- **Undo covers the notes too.** Undo and redo cover the note changes that relations and key images make, not only the canvas.

![Typed notes as cards, a relation on the edge between them and the relations panel](docs/mockups/notetypes.svg)

Canvas files stay standard JSON Canvas, with extra fields kept alongside, so stock Obsidian still opens them.

This relies on Obsidian's undocumented canvas internals, collected in `src/canvas/adapter.ts` (and, for tab panels, workspace internals in `src/canvas/hosted-leaf.ts`), and last checked against Obsidian 1.14.4, and may need a patch after an Obsidian update.

---

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/canvas-plus/`.
2. Reload Obsidian.
3. Enable **Canvas Plus** under **Settings → Community plugins**. Enable [**Note Types**](https://github.com/jsmorabito/obsidian-note-types) too for note cards and relations.

---

## Network use

The plugin has no telemetry, collects no data, and makes no requests of its own.

If a note's key image is a web address, Obsidian loads it from that address whenever a note card shows it. That is a request from your device to the image's host, the same as for any image embedded from the web. Dropping an image link onto a note card only writes the link into the note, and downloads nothing. Dropping an image file saves a copy in your vault's attachment folder, as Obsidian does for any attachment.

---

## For developers: the Note Types API

Canvas Plus talks to [Note Types](https://github.com/jsmorabito/obsidian-note-types) only through the API Note Types publishes on its plugin instance (`app.plugins.getPlugin('filtered-file-commands').api`, defined in Note Types' `src/api.ts`). The bridge is `src/note-types.ts`: it looks the API up on every use, checks its `version`, and falls back to a stand-in where no note has a type.

---

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # type-check + production bundle
npm run lint     # ESLint
```

Output artifacts (`main.js`) are written to the plugin root. See [AGENTS.md](AGENTS.md) for conventions.

---

## License

MIT
