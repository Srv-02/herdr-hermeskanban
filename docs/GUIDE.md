# Hermes Kanban guide

Everything Hermes Kanban does, in detail. For the overview, see the [README](../README.md).

## Contents

- [Requirements](#requirements)
- [Install](#install): [Manual install](#manual-install)
- [Keys](#keys)
- [Settings](#settings)
- [Updates](#updates)
- [What it runs and touches](#what-it-runs-and-touches)
- [Removing](#removing)
- [Development](#development)

## Requirements

- Herdr app 0.1.18 or newer on macOS.
- Hermes Agent 0.23.4 or newer on a Linux machine that you reach over SSH from Herdr, with its dashboard on `127.0.0.1:9120`.
- `curl` 7.55 or newer on that machine.

## Install

In Herdr, ask your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/Srv-02/herdr-hermeskanban/tree/main
```

Then click `Kanban` in the tab bar.

### Manual install

1. Copy the mod folder. The folder must be named `hermes-kanban`.

   ```sh
   cp -R mods/hermes-kanban ~/.config/herdr-app/mods/hermes-kanban
   herdr-app check ~/.config/herdr-app/mods/hermes-kanban
   ```

2. Clone a layout (`herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`) and in `~/.config/herdr-app/layouts/my-layout.json` replace the `tabs` block with:

   ```json
   { "id": "tab-bar", "type": "row", "size": { "px": 42 }, "resizable": false, "children": [
     { "id": "tabs", "type": "block", "content": { "mod": "tabs" }, "window_drag": true },
     { "id": "hermes-kanban-button", "type": "block", "content": { "mod": "hermes-kanban", "props": { "button": true } }, "size": { "px": 92 }, "window_drag": true }
   ] }
   ```

   Add the panel as a child of `panel` > `panel-body`:

   ```json
   { "id": "hermes-kanban", "type": "block", "content": { "mod": "hermes-kanban" }, "size": { "weight": 1 }, "min": 120 }
   ```

   The button finds the panel by its mod, whatever its `id`. In a `panel-body` of type `stack` it shows the panel alone; in a `column` it switches the panel on and off beside the others.

## Keys

Filled in with the panel.

## Settings

Filled in with the Settings dialog.

## Updates

Filled in with the update check.

## What it runs and touches

Filled in with the panel.

## Removing

Delete `~/.config/herdr-app/mods/hermes-kanban`, the two blocks from your layout, and, if you like, `~/.config/herdr-app/hermes-kanban.json`.

## Development

```sh
npm test      # node --test, no network (test/no-network.js)
npm run lint  # parse checks, no Intl, no unused imports, exports or icons
```

- **Pure logic** lives in `mods/hermes-kanban/lib/` and is tested in `test/`.
- Test changes in a separate Herdr instance with its own `HERDR_APP_HOME` and `HC_SESSION`, never in the Herdr you work in.
