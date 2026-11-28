# Hermes Kanban guide

Everything Hermes Kanban does, in detail. For the overview, see the [README](../README.md).

## Contents

- [Requirements](#requirements)
- [Install](#install): [Manual install](#manual-install)
- [The panel](#the-panel): [Following the pane](#following-the-pane), [Instances](#instances), [Syncing](#syncing), [Status bar](#status-bar)
- [The board](#the-board): [Groups and order](#groups-and-order), [Rows](#rows), [Filter](#filter)
- [Task overlay](#task-overlay): [New task](#new-task)
- [Notifications](#notifications)
- [Access](#access): [Set up access](#set-up-access), [Remove access](#remove-access)
- [Single agent mode](#single-agent-mode)
- [Keys](#keys)
- [Settings](#settings)
- [Updates](#updates)
- [What it runs and touches](#what-it-runs-and-touches)
- [Removing](#removing)
- [Development](#development)

## Requirements

- Herdr app 0.1.18 or newer on macOS.
- Hermes Agent 0.23.4 or newer on a Linux machine that Herdr knows as one of its machines, with its web app in the gateway on `127.0.0.1:9120` (Hermes' default).
- Hermes runs in a space on its own machine. A Hermes started with `ssh` from a pane on your Mac belongs to your Mac's space and is not found.
- Herdr runs on that machine as the same Linux user as the Hermes gateway (the one with `~/.hermes` and the gateway's `systemctl --user` unit).
- On that machine: `curl` 7.55 or newer and GNU `find`. For an instance that signs people in, also systemd user units and `python3` (only to make the key once).

## Install

In Herdr, ask your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/Srv-02/herdr-hermeskanban/tree/main
```

Then focus a pane on a machine that runs Hermes and click `Hermes` in the tab bar.

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

3. If an instance signs people in, open the panel on a pane of that machine and follow [Set up access](#set-up-access).

## The panel

### Following the pane

- The panel shows the board of the Hermes on the focused pane's machine. The machine comes from the pane's space (or, for a terminal block, from its address `devbox/t3`).
- **Per machine:** a machine runs Hermes when the button's last poll found `~/.hermes/kanban.db` there (see [Syncing](#syncing)). Then every pane on it shows its board: a shell, a Hermes pane or a terminal block alike. So a machine that runs Hermes only as a gateway service, with nothing but a shell open in Herdr, shows its board too. Before the first poll knows a machine, a pane where Herdr sees the agent `hermes` running counts as well.
- **No Hermes here:** a pane on a machine without `kanban.db`, and every pane on your Mac, shows `No Hermes on this machine`. The panel never falls back to the last board, and it never shows two boards mixed.
- **Clicking into the panel** (the search, say) keeps the board: a mod has the keyboard then, not a pane.
- **The `Hermes` button** opens and closes the panel on any pane of a machine that runs Hermes, and also while you work in the panel. On any other pane it is grey with the tooltip `No Hermes on this machine`, and a click does nothing, except that it still closes a panel that is open. While another instance has a dot (something needs you or a task finished), a click jumps there instead (see [Notifications](#notifications)).
- The panel follows a change of focus within 3 seconds at the latest.
- **The header:** `Hermes`, the instance's name on the right, then `+` (new task), refresh, the funnel (priority, grouping and sorting) and the gear (settings). Without a Hermes only the gear stays.

### Instances

- An instance is a Herdr machine with a Hermes on it; its name is the machine's name in Herdr. Each instance has exactly one board, Hermes' board `default`; every request names it (`?board=default`), so switching boards in Hermes' web app never redirects the panel.
- **Visible** are only machines with at least one open space; the number of tabs does not matter. Close the last space of a machine and its board, its dot and its toasts go. Your Mac never counts.
- Every request, every action and every board in memory carries its machine. An action goes only to the machine its task came from, also when the focus moves on while an overlay is open. Two instances may both have a task `t_a1b2`; they never mix.

### Syncing

- The tab bar button does the polling, also while the panel is hidden, so toasts arrive. If Herdr shows the button in several windows, one copy holds shared `hermes-kanban.lease` (renewed every minute, taken over after 3 minutes) and polls; the others draw what it shares.
- **Every 30 seconds** (the setting [`poll_seconds`](#settings)) each visible instance gets a cheap check: the modification time in nanoseconds and the size of `~/.hermes/kanban.db` and `kanban.db-wal`. The database is never opened. Only when that changed does the button read the board through Hermes' API; as a safety net it reads it every 5 minutes anyway.
- The gateway's status, Hermes' workflow (columns and allowed moves) and the default agent are read at the start, after an error and every 5 minutes. A machine without `kanban.db` has no Hermes; it is looked at again every 5 minutes.
- Switching to an instance shows its last board at once. The button and the panel share the last boards through Herdr's shared state (`hermes-kanban.boards`), which Herdr keeps in `shared.json` in the Herdr app folder. So the last boards of every visible instance, with titles, block summaries and failure texts, are on your Mac's disk and outlive a restart. Leave that file out of backups or dotfile repos you share.
- **The refresh button** asks for a poll now and turns until it is done. It turns red with a dot when the last poll failed, or when no poll came within 30 seconds; its tooltip says why. After every action in an overlay the machine is polled at once.
- A failed poll keeps the last board and reports nothing. The first board of a machine only sets the baseline: no toasts for what happened before. A new button copy (after a Herdr restart, a mod update or a takeover) continues from the boards the previous copy shared, if they are at most 10 minutes old, so what changed in between reports once. A machine without such a board, also one that comes back after its spaces were closed, starts with a baseline.
- After a Herdr restart or a mod update the old lease can hold for up to 3 minutes, so no copy polls meanwhile. The panel then still shows the last boards; once no poll came for three times `poll_seconds`, the status bar says `synced 2m ago`.

### Status bar

At the bottom: `3 running · 1 problem` on the left, followed by `synced 4m ago` while no poll came for a while (see [Syncing](#syncing)), the gateway's dot and version (`Gateway v0.23.4`) on the right.

- **running:** the tasks in Running.
- **problems:** the tasks with an active diagnostic of severity warning or worse, from Hermes' `/diagnostics`. Red when above 0; left out when Hermes does not say.
- **The dot:** green while the gateway runs, red when it is stopped or does not answer.
- When the last poll failed, the left side shows `Sync failed: <reason>` in red instead.

## The board

### Groups and order

- **Group `Status`** (the default): Triage, Todo, Scheduled, Ready, Running, Blocked, Review, Done, in the order and with the names of Hermes' workflow. Groups without tasks are left out. Blocked and Review carry the red alert: they need you.
- **Group `Agent`:** one group per agent in alphabetical order, `no agent` last. **Group `None`:** one list.
- **Order** in every group by the time the row shows: when a done task finished (when it was created, if Hermes has no finish time), when any other task was created. Newest first by default; the sort toggle at the end of the funnel's row turns it to oldest first. Tasks without a time go last, equal times by ID. Priority does not sort; it is a filter and the chip on the row.
- **Colors** as Hermes' own board: Triage and Done in the theme's dim grey, Todo muted, Scheduled violet, Ready blue, Running green and turning, Blocked and Review red. With [`status.color`](#settings) `mono` everything is one quiet color except what needs you. All colors come from the theme, so light and dark themes work.

### Rows

- **Left:** the status icon, the title, and `a1b2 · writer · 14m` (ID without Hermes' internal prefix `t_`, agent or `—`, age; for a done task the time since it finished).
- **The hint** after it:
  - **blocked:** why, from the run that blocked it, else the last failure; `blocked` when Hermes says nothing.
  - **ready with an agent:** `starts with next dispatch`.
  - **ready without an agent:** `goes to <agent>` when Hermes has `kanban.default_assignee`, else `no agent, will not start` in orange.
- **Right:** the number of comments and the priority chip (`P2`; none for priority 0).
- A click opens the [task overlay](#task-overlay).

### Filter

- **Always shown, one row:** `Open | Done | All`; the agent menu (`All agents`, each agent with a check box, `no agent`; the button reads `All agents`, the agent's name, or `2 agents`); and the search over the rest of the width. The search looks at ID, title and agent; the `×` clears it.
- **The funnel** in the header opens a second row below a divider: `Prio` `All | P1 | P2 | P3+` (Hermes' own numbers: `P3+` is 3 and higher) and `Group` `Status | Agent | None`, and at its end the sort toggle (the up and down arrows; the tooltip says `Newest first` or `Oldest first`, a click turns it round). A grey dot on the funnel says that a priority or grouping there differs from the default while the row is closed; the sort order never sets it.
- The filters and the open row are remembered; the search is not. An agent picked on one instance filters nothing on an instance that does not have it.

## Task overlay

A click on a row opens the task in a large dialog. Everything in it goes to the task's own machine.

- **The head:** title, ID (without Hermes' internal prefix `t_`; click it to copy it), the instance, Close (Esc); the status pill, the agent, `created 2h ago` and the number of comments.
- **Left:** for a blocked task a red box with the reason (`writer is blocked`, `needs input: …`); the description; the activity (events and comments, newest first, heartbeats left out); and the comment box.
- **Text from Hermes:** the description and the comments render as Markdown, as in Hermes' web app: headings, lists, code and links. Anyone who can reach an instance can write a task, so HTML in it shows as text, no picture is ever loaded (an image shows as `!` and a link), and only `https` links open, in your browser, on a click. Titles and reasons stay plain text.
- **Comment** (or Ctrl+Enter) adds the comment under your name: the full name of your Mac user, or the name set under [Comment author](#settings) in the settings (`herdr` only when neither is there). **Comment & unblock**, for a blocked task, adds the comment and then asks Hermes to move the task to Ready. These are two requests: when Hermes refuses the move (a parent task is not done, say), the comment stays and the line at the bottom says so.
- **Right column:**
  - **Agent (assignee):** the board's agents, each with `idle` or `1 running`, and `Unassigned`.
  - **Move to:** only the moves Hermes' workflow allows from the current status, read from Hermes, so they survive Hermes updates.
  - **Priority:** `none`, `P1` to `P4`, and a higher value the task already has.
  - **Runs:** `#7 blocked · 4m 12s`, newest first.
  - **Archive:** the first click asks, **Confirm archive** archives. The task leaves the board; it is not deleted. Hermes Kanban never deletes a task.
- **After each action** the line at the bottom says what Hermes answered, from the task in its answer: Hermes may redirect a move (`Hermes moved it to Ready`), and a ready task with an agent says `starts with next dispatch`.

### New task

The `+` in the header opens `New task` on the instance the panel shows; the dialog stays bound to it.

- **Title** (required; Enter creates), **Description** (Ctrl+Enter creates), **Priority** (`Higher starts first.`) and **Agent** (`None` and the board's agents; not in single agent mode).
- **Without a pick** the task goes to the instance's default agent, as in Hermes' own board: `kanban.default_assignee`, else Hermes' active profile. **`None`** creates it without an agent; it starts only if `kanban.default_assignee` is set, which Hermes' dispatcher then fills in. The line under the choice says which applies.
- After **Create** a toast says `Task created` with its ID and status, and the dialog closes. When Hermes answers with a warning, the dialog stays open and shows it.

## Notifications

- **Toasts**, from the button, also while the panel is hidden:
  - **needs you:** a task became Blocked or Review, or keeps cycling between blocked and unblocked: `devbox: writer needs input`.
  - **failed:** Hermes counts a new failed run of the task (crashed, timed out, gave up, could not start): `devbox: writer failed`, with the reason.
  - **done:** `devbox: writer finished`.
  - A click on a toast jumps to that instance and opens the task in its overlay. You land in the pane you focused there last (a shell pane as well, if it is still open), else the first pane that runs Hermes, else the first terminal pane, else any pane of a space on that machine; the panel opens there. Without any pane on that machine, the overlay opens all the same. The click clears the instance's dot, as the button's jump does.
- **The dot** on the `Hermes` button, over all visible instances: red and glowing for something new that needs you (needs you or failed), green for a task newly done, nothing else. It shows only what you have not seen: opening the panel on an instance clears its part at once, and so does a click on the button that jumps there; and the instance the panel shows collects nothing. A task that just stays blocked, or an agent that runs, adds nothing. No count.
- **Other instances:** in the panel, a red strip `labbox needs you` with `Go to pane →` for each other visible instance with unseen news that needs you.
- **The button jumps:** while another visible instance has unseen news, red or green, the tooltip says `Go to labbox` and a click on `Hermes` goes to that instance, as a toast does, and opens the panel there. An instance that needs you comes first, then one with a finished task; among equals the first by name. The jump clears that instance's whole dot; a green dot on a third instance stays, and the next click jumps there. This holds on any pane, on a machine with or without Hermes, so while another instance has a green dot, a click jumps instead of closing the panel. When no pane of that instance can be found, the click clears its dot and then opens or closes the panel as usual. The instance the panel shows never counts. The red strips in the panel stay for needs you only.
- **Sounds:** Herdr's `blocked` sound for needs you and failed, its `done` sound for done; at most one per poll. **Dock badge:** a dot on the Herdr icon while something that needs you is unseen; no number.
- Each has its own switch in the [settings](#settings).

## Access

Hermes Kanban reads and writes through the API of Hermes' own web app, on the machine itself (`curl` to `127.0.0.1:9120`). The web app needs a key, and Hermes runs it in one of two ways; the panel finds out which from `/api/status`:

- **Without sign-in:** the web app writes its own token to `~/.hermes/webapp/session-token`. Hermes Kanban uses it there, under the same rules as its own key. Nothing to set up, nothing to restart.
- **With sign-in** (a public URL or an auth gate is configured): the web app accepts a deployment token, `HERMES_DASHBOARD_SESSION_TOKEN=file:<path>`, which is Hermes' own way for clients without a browser. Hermes Kanban needs one of its own, and the panel shows **Set up access**.

The key opens Hermes' whole web app, not only the board. It stays on the machine, readable only by the Linux user who already owns that Hermes.

### Set up access

On an instance with sign-in and no key, the panel shows `Access not set up` and **Set up access**. The click first lists every step; only **Confirm** runs them on that machine:

1. Make a key, only if it is missing: `umask 077` and Hermes' own generator, `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`, into `~/.hermes/dashboard.token`.
2. Add a drop-in for the gateway's systemd user unit, mode 0600 (the unit, `hermes-gateway*.service`, is found on the machine):

   ```ini
   # ~/.config/systemd/user/<gateway unit>.d/herdr-kanban-token.conf
   # Written by the Herdr hermes-kanban mod. "Remove access" in its settings deletes this file.
   [Service]
   Environment="HERMES_DASHBOARD_SESSION_TOKEN=file:%h/.hermes/dashboard.token"
   ```

3. Run `systemctl --user daemon-reload`.
4. **No automatic restart.** The panel shows `Restart the gateway to finish.` and **Restart gateway**. The gateway restarts only on that click (`hermes gateway restart`, which lets running turns finish first); its messaging connections pause briefly.
5. After the restart, the panel waits up to about 100 seconds for the gateway, checks `GET /api/plugins/kanban/stats` with the key, and shows the board.

The flow stays with the machine of the first click, also when you focus another pane meanwhile. Before writing anything it checks the machine again: one gateway unit of this user, `curl` 7.55, `python3` when a key is needed, and that the instance still signs people in. If not, nothing is written and the panel says why. When Hermes later refuses the key (401), the panel shows why and, where it can, offers the setup again.

### Remove access

**Remove access** in the settings works on the instance the panel showed when you opened them, one step at a time, in this order:

1. **Remove access** asks, then deletes the drop-in and runs `systemctl --user daemon-reload`. The running gateway keeps the key.
2. **Restart gateway**, again only on your click.
3. **Delete key**, offered only once the running gateway has no `HERMES_DASHBOARD_SESSION_TOKEN` and no drop-in points at the key.

The order matters: a gateway that still points at the key would not start again without it. So Hermes Kanban never deletes the key while the drop-in exists or the running gateway still has the variable. When it cannot read the gateway's environment (`/proc/<pid>/environ`), the key stays and the settings say so; delete `~/.hermes/dashboard.token` yourself once the gateway runs without the drop-in.

## Single agent mode

For an instance with one agent. Switch it on in the settings while the panel shows that instance; it holds for that instance only.

- The agent filter, the agent picker and the grouping by agent disappear; agent names are hidden in the rows, the overlay, the activity and the toasts. Texts name the instance instead: `devbox needs you`, `devbox: task finished`.
- The search no longer looks at agent names.
- New tasks from this panel go to the instance's default agent (Hermes Kanban assigns it when it creates the task).
- **Default agent** (read only, shown under the switch): the one Hermes resolves, `kanban.default_assignee`, else its active profile. When `kanban.default_assignee` is not set, the row warns: tasks created without an agent elsewhere (from Hermes' messaging channels or its CLI) do not start. Tasks from this panel still go to the default agent.

## Keys

The panel takes these commands, for `keys.json` (`"alt-h r": "hermes-kanban.refresh"`) or `herdr-app do hermes-kanban.<command>`:

| Command | What it does |
|---|---|
| `hermes-kanban.refresh` | Polls the shown instance now |
| `hermes-kanban.filter` | Shows or hides the second filter row (priority, grouping and sorting) |
| `hermes-kanban.settings` | Opens the Settings dialog |
| `hermes-kanban.new` | Opens `New task` on the shown instance |
| `hermes-kanban.open` | Opens the first task of the list in its overlay |

## Settings

The gear at the right of the header opens the Settings dialog; **Save** writes the changed values to `hermes-kanban.json` in the Herdr app folder (`~/.config/herdr-app/hermes-kanban.json`) and the panel and the button use them right away, **Cancel** or Esc leaves everything as it was. The file can also be edited by hand: a missing file means the defaults; a value of the wrong type means the default for that value; a broken file means the defaults, and the dialog then refuses to save and says so.

| Key | Setting | Type | Default | What it does |
|---|---|---|---|---|
| `single_agent` | Single agent mode | list of machine names | `[]` | The instances in [single agent mode](#single-agent-mode). The dialog adds or removes the shown instance. |
| `status.color` | Status colors | `"color"` / `"mono"` | `"color"` | Each status in its color, or all in one quiet color. Tasks that need you stay red. |
| `toast.needs_you` | Toast when a task needs you | true / false | `true` | A toast when a task becomes blocked, waits for review or fails. |
| `toast.done` | Toast when a task is done | true / false | `true` | A toast when a task finishes. |
| `sound.needs_you` | Sound when a task needs you | true / false | `true` | Herdr's `blocked` sound with a needs-you or failed change. |
| `sound.done` | Sound when a task is done | true / false | `false` | Herdr's `done` sound when a task finishes. |
| `badge` | Dock badge | true / false | `false` | A dot (`•`) on the Herdr icon in the Dock while something that needs you is unseen. No number. |
| `poll_seconds` | Check every | `15` / `30` / `60` / `120` | `30` | Seconds between two cheap checks of each visible instance. The board is read only when it changed. |
| `update_check` | Check for updates automatically | true / false | `true` | Once a day, asks GitHub whether a new version exists. Nothing about you or your boards is sent, but GitHub sees your IP address. |
| `author.custom` | Change name | true / false | `false` | Off: your comments carry the full name of your Mac user (`id -F`, else your login, else `herdr`). On: the name in `author.name`. |
| `author.name` | Comment author | text, 1 to 64 characters | none | The name your comments carry while `author.custom` is on. Trimmed; an empty or longer name counts as none. |

```json
{
  "single_agent": ["devbox"],
  "status": { "color": "mono" },
  "toast": { "done": false },
  "poll_seconds": 60
}
```

A dotted key (`"toast.done": false`) works too. All settings are defined in one place, `mods/hermes-kanban/lib/settings.js`.

**Comment author** in the dialog, between Agents and Display: the switch **Change name**, and below it the current author. Off, it shows your Mac user's full name, read only. Switching it on turns that into a field, prefilled with that name; an empty field is never saved and shows the last name again when you leave it. Switching it off goes back to the Mac name and clears the stored one.

The dialog also shows, without a key of its own: **Default agent** of the shown instance, **Hermes instances** (every visible machine with a board) and **Remove access** (see [Remove access](#remove-access)).

## Updates

- Once a day the button copy holding the lease asks `https://api.github.com/repos/Srv-02/herdr-hermeskanban/releases/latest`, without a token and without anything about you. The answer is kept in shared `hermes-kanban.update`; `update_check` off sends nothing.
- A newer release turns the gear gold, with a gold dot and a slow shine, and `<version> available` in its tooltip. The dialog then opens with a gold box: `Hermes Kanban <version> is available`, a link to the release notes, and the line to give your agent in Herdr, with **Copy**:

  ```text
  Update this mod: https://github.com/Srv-02/herdr-hermeskanban/tree/main
  ```

- **Check now** in the dialog asks at once, also with `update_check` off.

## What it runs and touches

**On each Hermes machine**, through Herdr's `exec` on that machine, as the user Herdr runs as there. Every script is `sh -c` with fixed text; every value (the unit name, the method, the URL, a request body) reaches it as a positional parameter, never spliced into shell code.

- **The cheap check:** `find "$HOME/.hermes" -maxdepth 1 … -printf` prints name, modification time and size of `kanban.db` and `kanban.db-wal`. Nothing reads the database.
- **API calls:** `curl` to `http://127.0.0.1:9120` and nowhere else.
  - `GET /api/status` (public, without key): version, gateway state, sign-in on or off.
  - Under `/api/plugins/kanban`, always with `?board=default`: `GET /board`, `/workflow`, `/orchestration`, `/diagnostics?severity=warning`, `/tasks/<id>`, and `/stats` to check access.
  - **Writes, only on your click:** `PATCH /tasks/<id>` (status, also `archived`; agent; priority), `POST /tasks/<id>/comments` (author: your name, see [Comment author](#settings)), `POST /tasks`. Never `DELETE`. Task IDs are checked (`[A-Za-z0-9_-]`) before they reach a URL.
- **The key never leaves the machine.** The remote shell builds the header itself, `{ printf 'Authorization: Bearer '; cat "$key"; } | curl … -H @-`: `printf` is a shell builtin and `cat` reads the file, so the key is in no command line (`ps`), never comes back to your Mac, and is in no output or log. Output from the machine that the panel shows (errors, the restart's log) is masked for anything that looks like a key. The request body (a comment, a title) is an argument of `curl` and so visible in the machine's process list for the moment of the call; the board is on that machine anyway. The same holds for your name as a comment's author: it goes to each Hermes machine you comment on in the request body, and is visible there in `ps` for the moment of the call.
- **The probe**, only when the board answers 401 or the gateway is down, when the settings open for an instance with sign-in, and right before a setup: `systemctl --user list-unit-files 'hermes-gateway*.service'` and `systemctl --user show -p MainPID`, `curl --version`, `command -v python3`, whether `~/.hermes`, the key and the drop-in exist, and whether the gateway's `/proc/<pid>/environ` holds the name `HERMES_DASHBOARD_SESSION_TOKEN` (`grep -q`: yes or no, never the value).
- **Set up access**, on **Confirm**: `python3` makes the key only if `~/.hermes/dashboard.token` is missing (mode 0600); the drop-in `~/.config/systemd/user/<gateway unit>.d/herdr-kanban-token.conf` is written through a temporary file (mode 0600); then `systemctl --user daemon-reload`.
- **Restart gateway**, on your click only: `hermes gateway restart`. It is the only `hermes` command the mod ever runs. Then `GET /api/status` every 2 seconds for up to about 100 seconds, and `GET /stats` with the key.
- **Remove access:** deletes the drop-in (and its folder when empty) and runs `systemctl --user daemon-reload`; **Delete key** deletes `~/.hermes/dashboard.token`, and refuses while the drop-in exists or the running gateway still has the variable.
- **Read, never changed:** `~/.hermes/webapp/session-token` on an instance without sign-in, read by `cat` on the machine, as above.

**On your Mac:**

- **Files:** `hermes-kanban.json` in the Herdr app folder, written only by the Settings dialog. The filters and whether the second filter row is open are kept in the mod's own storage. The mod writes no cache file of its own, but Herdr keeps every shared value below in `shared.json` in the Herdr app folder, the last boards (`hermes-kanban.boards`) included.
- **Network:** the daily update check (see [Updates](#updates)). Nothing else: every Hermes call runs on its machine.
- **Programs:** `open` for an `https` link you click in a task; `id -F` (else `id -un`) once per start of the polling copy, for the name your comments carry.
- **Shared values:** `workspace.panels` (adds `hermes-kanban` so the tab bar restores the panel), `hermes-kanban.boards` (the boards), `hermes-kanban.unseen` and `hermes-kanban.seen` (the dot), `hermes-kanban.shown` (which instance each panel shows), `hermes-kanban.lastPanes` (where a jump lands), `hermes-kanban.refresh` (poll a machine now), `hermes-kanban.restarting` (one gateway restart per machine at a time), `hermes-kanban.pick` (the agent menu), `hermes-kanban.config` (the dialog saved), `hermes-kanban.osName` (your Mac user's name, the comments' default author), `hermes-kanban.update` and `hermes-kanban.lease` (the update check and the polling copy).

## Removing

Remove access first, on each instance where you set it up, while the mod is still installed: open the panel on a pane of that machine, then **Settings** > **Remove access**, and follow its steps in their order: the drop-in, then **Restart gateway**, then **Delete key**.

Then delete `~/.config/herdr-app/mods/hermes-kanban`, the two blocks from your layout, and, if you like, `~/.config/herdr-app/hermes-kanban.json`.

If the mod is already gone, do the same by hand on the Hermes machine, in this order:

1. Delete `~/.config/systemd/user/<gateway unit>.d/herdr-kanban-token.conf` and run `systemctl --user daemon-reload`.
2. Restart the gateway (`hermes gateway restart`).
3. Only then delete `~/.hermes/dashboard.token`. A gateway that still points at the key does not start again without it.

## Development

```sh
npm test      # node --test, no network (test/no-network.js)
npm run lint  # parse checks, no Intl, no unused imports, exports or icons, an .id() on every .hover()
```

- **Pure logic** lives in `mods/hermes-kanban/lib/` (requests, setup scripts, board shapes, changes, filters, instances, settings, update check) and is tested in `test/` with made-up API answers in `test/fixtures/`. `test/fake/` stands in for Herdr in the flow tests.
- **`scripts/instance.mjs`** runs the setup steps against one instance from the command line, with the mod's own scripts, through `hc exec --on <machine>`. It never prints the key, and `restart` needs `--confirm`.
- **A local word list:** with `tmp/denylist.txt` (one word per line, ignored by git), `npm run lint` fails on any tracked file that contains one of the words.
- Test changes in a separate Herdr instance with its own `HERDR_APP_HOME` and `HC_SESSION`, never in the Herdr you work in.
