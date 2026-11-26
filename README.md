# Hermes Kanban

**A Kanban panel for the [Herdr app](https://herdr.dev): it follows the focused pane and shows the board of the Hermes agent running there.**

- **Follows your pane:** switch panes and the panel shows the board of the Hermes agent on that machine, from its cache at once, while it syncs in the background.
- **Steer tasks:** move a task, set its priority, comment, unblock or archive it, and create new ones, right from the panel.
- **Hears back:** a toast tells you when a task finishes, blocks or fails, and a click jumps to the pane.
- **Stays on the machine:** the access key never leaves the Hermes machine, never shows up in a command line and never reaches your Mac.
- **Quiet:** syncs only while the panel is shown, and a gateway restart never floods you with toasts.

<br>

<p align="center"><a href="https://www.buymeacoffee.com/michaelmayer"><img src="screenshots/bmc-button.png" alt="Buy me a coffee" height="64"></a></p>

<br>

## Install

In Herdr, ask your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/Srv-02/herdr-hermeskanban/tree/main
```

Then click `Kanban` in the tab bar.

- **Needs** Herdr on macOS, Hermes Agent 0.23.4 or newer on a Linux machine you reach over SSH, and `curl` 7.55 or newer there.
- **Update:** the gear turns gold when a new release is out; ask your agent the same way.
- **By hand, removing, keys:** see the [guide](docs/GUIDE.md#install).

## Features

- **The board:** tasks grouped by status, sorted by priority, with a filter and a status bar.
- **Task overlay:** the task with its comments, runs and events, and the actions that apply to it.
- **New tasks:** create a task for an agent of the instance you are looking at.
- **Alerts:** toasts and a dot on the tab bar button for finished, blocked and failed tasks.
- **Setup:** a guided "Set up access" flow that prepares the Hermes machine, with a restart only after your click.
- **Settings:** updates, alerts and access in one dialog.

## Documentation

- **[Guide](docs/GUIDE.md):** every feature, setting and key in detail, and what it runs.
- **[RECIPE.md](RECIPE.md):** the mod as a brief to build it from scratch.
- **[Development](docs/GUIDE.md#development):** tests and lint.

## Credits

- The panel, its tab bar button and the tooling follow [GitHub Checker](https://github.com/Srv-02/herdr-ghchecker) (MIT).
- Icons from [Lucide](https://lucide.dev) (ISC).

Details in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Hermes Kanban is not affiliated with Nous Research.

## License

MIT, see [LICENSE](LICENSE). Third party parts keep their own licenses.
