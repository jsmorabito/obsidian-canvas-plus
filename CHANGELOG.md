# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
