// Hermes Kanban: the Kanban board of the Hermes instance in the focused pane, as a side panel, and a button in the
// tab bar that tells when an agent finished or needs you.
// One mod, several roles by props, as ghchecker: the panel (none), its button in the tab bar ({ button: true }), and
// as overlays of the panel the task ({ task }), the new task ({ create }), the settings ({ settings: true }) and the
// small menus ({ menu }). The button's block is always in the layout, so it carries the watcher (watcher.js): it polls
// every visible instance also while the panel is hidden, and runs the daily update check. The panel only reads what
// the watcher shares (hermes-kanban.boards) and follows the focused pane.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list, Scrollbar } from "gpui-base";
import { spaces, panes, focused, layout, theme, openOverlay, props, shared, setShared, run, nextCommand, checking, readTextFile, appHome, window as hostWindow } from "herdr";
import { watchPass } from "./watcher.js";
import { TaskViewer } from "./viewer.js";
import { CreateDialog } from "./create.js";
import { SettingsDialog } from "./settings.js";
import { Access } from "./access.js";
import { tones, alpha, glyph, glyphOf, segmented, chip, blankslate, look, GOLD } from "./ui.js";
import { dotOf, needsYou } from "./lib/changes.js";
import { loadSettings, defaults, isSingleAgent } from "./lib/settings.js";
import { createUpdateGate, updateCheck, fetchLatest, localVersion, gearState } from "./lib/update.js";
import { leaseNext } from "./lib/lease.js";
import { focusedInstance, visibleMachines, jumpTarget, rememberPane } from "./lib/instances.js";
import { filterTasks, groupTasks, hintOf, prioLabel, agentsLabel, toggleAgent, pickedAgents } from "./lib/view.js";
import { taskKey } from "./lib/board.js";
import { ago } from "./lib/time.js";

const MOD = "hermes-kanban";
const WATCH = 5000; // the watcher's beat; each instance is polled on its own pace (poll_seconds) within it
const TICK = 3000;  // how often the panel looks at the focused pane (follow me, as ghchecker)
const ROW = 46, HEADING = 32;
const CLEAR = "#00000000";
// Hermes' column order (hermes_cli/kanban_workflow.py), for a board whose /workflow has not come yet.
const ORDER = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"];
const FILTERS = { state: "open", agents: [], prio: "all", group: "status" };

const remembered = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full: memory only */ } };

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}

// As one of the side panels, only the shown one works. The panel's block is found by its mod, whatever its id.
// Adapted from ghchecker (MIT), mods/ghchecker/main.js hidden(), itself from jankeesvw/herdr-issues (MIT).
function hidden() {
  const root = layout(), body = find(root, "panel-body"), mine = body?.children?.find((c) => c.content?.mod === MOD && !c.content?.props?.button);
  if (!mine) return false;
  if (body.type !== "stack") return Boolean(find(root, "panel")?.hidden || mine.hidden);
  return Boolean(find(root, "panel")?.hidden || body.active !== mine.id);
}

export default class HermesKanban extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.button) {
      // The tab bar restores each space's panel only if it is one of these.
      const panels = shared("workspace.panels") ?? ["files", "changes"];
      if (!panels.includes(MOD)) setShared("workspace.panels", [...panels, MOD]);
      this.button = true;
      if (checking()) return; // herdr-app check runs init: no polling, no update check there
      this.me = (Math.random().toString(36).slice(2) + "00000000").slice(0, 8);
      this.gate = createUpdateGate(Date.now);
      this.watch = {};
      this.refreshAt = shared("hermes-kanban.refresh")?.at;
      this.beat(cx);
      cx.timer.every(WATCH, (cx) => this.beat(cx));
      return;
    }
    if (p.menu) { this.menu = { ...p.menu, overlay: p.overlay }; return; }
    // The task overlay (viewer.js) and the new task (create.js) take their machine from the props, never the focus.
    if (p.task) { this.viewer = new TaskViewer(p.task, p.overlay, cx); return; }
    if (p.create) { this.creator = new CreateDialog(p.create, p.overlay, cx); return; }
    // The settings edit the instance in their props (the one the panel showed), never the focus.
    if (p.settings) { this.dialog = new SettingsDialog(p, p.overlay, cx); return; }
    this.panel(cx);
  }

  // ---- the panel ----
  panel(cx) {
    this.settings = defaults(); // hermes-kanban.json, read at start and after Save in the settings
    this.access = new Access(); // the flows of "Set up access", one per machine (access.js)
    this.f = { ...FILTERS, ...remembered("filters", {}) };
    this.filtering = remembered("filtering", false);
    this.query = "";
    this.input = InputState.new({ placeholder: "Search" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.last = null;          // the focus of the last look (focusedInstance keeps it while this panel has the keyboard)
    this.pickedAt = shared("hermes-kanban.pick")?.at;
    this.configAt = shared("hermes-kanban.config")?.at;
    if (checking()) return; // herdr-app check runs init: no timer, no reads there
    this.readSettings(cx);
    readTextFile(`${appHome()}/mods/hermes-kanban/mod.json`).then((text) => { this.version = localVersion(text); cx.notify(); }, () => null);
    cx.timer.every(TICK, (cx) => this.tick(cx));
    // keys.json: "alt-h r": "hermes-kanban:refresh", or filter (show or hide the filter bar), settings, new (a new task
    // on the shown instance), open (the first row).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const m = this.shownMachine();
        if (c === "refresh") this.refresh(m);
        else if (c === "filter") this.setFiltering(!this.filtering);
        else if (c === "settings") this.openSettings(m);
        else if (c === "new" && m) this.openCreate(m);
        else if (c === "open") this.openFirst();
        cx.notify();
      }
    });
  }

  readSettings(cx) {
    cx.spawn(async (cx) => { this.settings = (await loadSettings(readTextFile, appHome)).values; cx.notify(); });
  }

  // The focus now: the Hermes pane and its machine, or none. A click into this panel keeps the last one.
  focusNow() {
    return focusedInstance({ spaces: spaces(), panes: panes(), focused: focused() }, this.last);
  }
  tick(cx) {
    // Nothing to do while the panel is hidden or the window can't be seen (minimized, covered, another Space).
    if (hidden() || hostWindow()?.visible === false) { this.away = true; return; }
    const key = JSON.stringify(this.focusNow());
    // The focus moved, the panel came back, or the ages in the rows ("14m") move on.
    if (key !== this.focusKey || this.away || Date.now() - (this.drawnAt ?? 0) > 30000) { this.away = false; cx.notify(); }
  }
  // The machine whose board the panel shows (for the header buttons and the key commands), or null.
  shownMachine() { return this.last?.hermes ? this.last.machine : null; }

  setFiltering(on) { this.filtering = on; keep("filtering", on); }
  setFilter(patch) { this.f = { ...this.f, ...patch }; keep("filters", this.f); }
  // A refresh polls that machine now: the watcher (in the button) reads shared "hermes-kanban.refresh".
  refresh(machine) {
    if (!machine) return;
    this.refreshing = { machine, at: Date.now() };
    setShared("hermes-kanban.refresh", this.refreshing);
  }

  // ---- opening ----
  openTask(task) {
    openOverlay({ mod: MOD, kind: "dialog", width: 0.88, height: 0.9, props: { task: { machine: task.machine, id: task.id } } });
  }
  openCreate(machine) {
    openOverlay({ mod: MOD, kind: "dialog", modal: true, frame: "none", width: 560, height: 0.9, props: { create: { machine } } });
  }
  // The settings edit the instance the panel shows (null: none, only the settings of all instances).
  openSettings(machine) {
    openOverlay({ mod: MOD, kind: "dialog", modal: true, frame: "none", width: 620, height: 0.9, props: { settings: true, machine } });
  }
  openFirst() {
    const first = this.entries?.find((x) => x.open);
    if (first) first.open();
  }
  // A popup menu under the pointer; the pick comes back through shared "hermes-kanban.pick".
  openMenu(kind, items, value) {
    openOverlay({ mod: MOD, kind: "popup", width: 220, height: 12 + Math.min(items.length, 10) * 30, props: { menu: { kind, items, value } } });
  }

  // ---- the watcher and the update check, in the copy that holds the lease ----
  // Herdr can show the button in several windows and layouts: one copy holds shared "hermes-kanban.lease"
  // (lib/lease.js) and polls; the others draw what it shares. The update pass is ghchecker's watchUpdates/updatePass.
  beat(cx) {
    const next = leaseNext(shared("hermes-kanban.lease"), this.me, Date.now());
    if (!next.mine) {
      // Another copy polls now. Its boards go, so taking the lease back later starts with a new baseline instead of
      // toasting again what the other copy already reported.
      if (this.mine) this.watch = {};
      this.mine = false; this.gate.take(false);
      return;
    }
    this.mine = true;
    if (next.write) setShared("hermes-kanban.lease", { owner: next.owner, at: next.at });
    if (this.gate.take(true)) cx.spawn(async (cx) => { try { await this.updatePass(cx); } catch { /* silent: a failed check counts as one */ } finally { this.gate.done(); } });
    this.pass(cx);
  }
  pass(cx, queue = false) {
    cx.spawn(async () => { try { await watchPass(this.watch, queue); } catch { /* the next beat tries again */ } });
  }
  async updatePass(cx) {
    const enabled = (await loadSettings(readTextFile, appHome)).values.update_check;
    const local = enabled ? localVersion(await readTextFile(`${appHome()}/mods/hermes-kanban/mod.json`).catch(() => null)) : null;
    const out = await updateCheck({ enabled, state: shared("hermes-kanban.update"), local, now: Date.now(), fetch: () => fetchLatest(globalThis.fetch, (ms) => cx.sleep(ms)) });
    if (out.state !== undefined) setShared("hermes-kanban.update", out.state);
  }

  // ---- the tab bar button ----
  // Adapted from ghchecker (MIT), mods/ghchecker/main.js toolbar(), itself from jankeesvw/herdr-issues (MIT).
  toolbar(t) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    const id = body?.children?.find((c) => c.content?.mod === MOD && !c.content?.props?.button)?.id ?? MOD;
    // panel-body is a stack (one panel at a time) or a column (panels stacked, each toggled).
    const stack = body?.type === "stack", ids = stack ? [body?.active] : (body?.children ?? []).filter((c) => !c.hidden).map((c) => c.id);
    const on = Boolean(panel) && !panel.hidden && ids.includes(id);
    const ink = on ? t.foreground : t.muted;
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("panel-hermes-kanban").h(26).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(ink)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (stack) {
            if (on) run("layout.hide", { id: "panel" });
            else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
            return;
          }
          const now = panel?.hidden ? [] : ids, want = on ? now.filter((x) => x !== id) : [...now, id];
          if (!want.length) { run("layout.hide", { id: "panel" }); return; }
          for (const child of body.children) run(want.includes(child.id) ? "layout.show" : "layout.hide", { id: child.id });
          run("layout.show", { id: "panel" });
        })
        .child(this.mark(t, ink)).child("Hermes"));
  }

  // The icon with the dot over all visible instances on its top right corner (the pill keeps ghchecker's size): only
  // what is new since the panel of that instance was last opened (lib/changes.js dotOf). Red and glowing for a task
  // that needs you, green for one that finished; no count, nothing for running agents or tasks that stay blocked.
  mark(t, ink) {
    const dot = dotOf(shared("hermes-kanban.unseen")), c = tones(t);
    const box = div().relative().size(14).flex_none().child(glyph("kanban", 14, ink));
    if (dot.tone === "red") {
      return box
        .child(div().absolute().top(-5).right(-5).size(11).rounded(6).bg(alpha(c.red, "66")).loop("opacity", { from: 0.15, to: 1, period: 1600 }))
        .child(div().absolute().top(-3).right(-3).size(7).rounded(4).bg(c.red));
    }
    if (dot.tone === "green") return box.child(div().absolute().top(-3).right(-3).size(7).rounded(4).bg(c.green));
    return box;
  }

  // ---- drawing: the panel ----
  shell(t) {
    return v_flex().id(MOD).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
  }

  // The top, as ghchecker's: icon and "Hermes", the instance dim on the right, then +, refresh, filter and settings.
  // The refresh icon turns until the next poll of the machine and turns red when the last one failed.
  header(t, c, machine, snap) {
    const gear = gearState(shared("hermes-kanban.update"), this.version), r = this.refreshing;
    const busy = Boolean(machine && r?.machine === machine && (snap?.at ?? 0) < r.at && Date.now() - r.at < 30000);
    const failed = Boolean(snap?.error) && !busy;
    // As ghchecker's: a grey dot on the filter icon while the closed second row holds a value other than its default.
    const hiddenSet = !this.filtering && (this.f.prio !== "all" || this.f.group !== "status");
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(h_flex().flex_none().gap(7).items_center().font_semibold().child(glyph("kanban", 14, t.foreground)).child("Hermes"))
      .child(h_flex().flex_1().min_w(0).justify_end().text_size(12).text_color(t.dim).child(div().min_w(0).truncate().child(machine ?? "")))
      .when(Boolean(machine), (x) => x
        .child(this.headButton("new", "plus", false, "New task", () => this.openCreate(machine), t, c))
        .child(this.headButton("refresh", "refresh", false, busy ? "Refreshing…" : failed ? `Sync failed: ${snap.error}. Click to try again.` : "Refresh",
          (cx) => { this.refresh(machine); cx.notify(); }, t, c, { spin: busy, alarm: failed }))
        .child(this.headButton("filter", "filter", this.filtering, this.filtering ? "Hide priority and grouping" : "Priority and grouping",
          (cx) => { this.setFiltering(!this.filtering); cx.notify(); }, t, c, { marked: hiddenSet })))
      // Settings, also without a Hermes; gold with a slow shine while a newer release is out.
      .child(this.headButton("settings", "settings", false, gear.tip, () => this.openSettings(machine), t, c, { gold: gear.update }));
  }

  // A header button as ghchecker's: a 14 px icon in a 24 px hit area; on: the selected background. `marked`: a grey
  // dot (a hidden filter is set); `alarm`: the icon and a dot in red; `gold`: an update is out (icon, dot, shine).
  headButton(id, name, on, tip, onClick, t, c, { spin = false, alarm = false, gold = false, marked = false } = {}) {
    const icon = glyph(name, 14, alarm ? c.red : gold ? GOLD : on ? t.foreground : t.muted);
    return div().id(id).relative().w(24).h(24).flex_none().flex().items_center().justify_center().rounded(6)
      .when(on, (e) => e.bg(t.selected)).when(gold, (e) => e.bg(alpha(GOLD, "1a"))).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .cursor_pointer().hover((s) => s.bg(gold ? alpha(GOLD, "33") : on ? t.selected : t.hover)).on_click((_e, cx) => onClick(cx))
      // The shine: a gold layer that breathes every 2.4 s, natively (no render runs for it).
      .when(gold, (e) => e.child(div().absolute().top(0).left(0).size(24).rounded(6).bg(alpha(GOLD, "38")).loop("opacity", { from: 0.15, to: 1, period: 2400 })))
      .child(spin ? icon.spin(900) : icon)
      .when(marked || alarm || gold, (e) => e.child(div().absolute().top(2).right(2).size(6).rounded(3).bg(gold ? GOLD : alarm ? c.red : t.muted)));
  }

  // One red strip per other visible instance with a needs-you event not seen yet (a task that stays blocked does not
  // count). "Go to pane" reads spaces and panes at the click, so it lands where that machine's Hermes is now; the panel
  // then follows by itself and opening it there clears the event.
  strips(t, c, shown) {
    const unseen = shared("hermes-kanban.unseen");
    return visibleMachines(spaces()).filter((m) => m !== shown && needsYou(unseen, m)).map((m) =>
      h_flex().id(`needs-${m}`).h(32).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .bg(alpha(c.red, "14")).text_size(12).cursor_pointer().hover((s) => s.bg(alpha(c.red, "26")))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          const target = jumpTarget(m, { spaces: spaces(), panes: panes() }, shared("hermes-kanban.lastPanes"));
          if (target) run("pane.focus", target);
        })
        .child(div().size(7).flex_none().rounded(4).bg(c.red).loop("opacity", { from: 0.35, to: 1, period: 1600 }))
        .child(div().flex_1().min_w(0).truncate().child(`${m} needs you`))
        .child(div().flex_none().text_color(t.muted).child("Go to pane →")));
  }

  // The agent button: 24 px, the selected background while agents are picked.
  dropButton(id, label, on, t, onClick) {
    return h_flex().id(id).h(24).px(8).gap(4).flex_none().items_center().rounded(6).text_size(12)
      .bg(on ? t.selected : CLEAR).text_color(on ? t.foreground : t.muted)
      .cursor_pointer().hover((s) => s.bg(on ? t.selected : t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(onClick)
      .child(div().truncate().child(label)).child(glyph("chevron-down", 12, t.muted));
  }

  // The filter bar, always shown, one row: state, the agents (a menu that picks several: an instance can have any
  // number of profiles; not in single agent mode) and the search over the rest of the width, with a clear button
  // while it has text. The filter button adds a second row below a divider line: priority and grouping (by agent not
  // in single agent mode).
  filterBar(t, agents, picked, single) {
    const label = (text) => div().flex_none().mr(6).text_size(11).text_color(t.muted).child(text);
    const pick = (patch) => (_k, cx) => { this.setFilter(patch(_k)); cx.notify(); };
    const typed = this.query !== "";
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().gap(8).items_center().px(8).pt(8).pb(6).when(this.filtering, (e) => e.border_b(1).border_color(t.border))
        .child(segmented("state", [["open", "Open"], ["done", "Done"], ["all", "All"]], this.f.state, t, pick((k) => ({ state: k }))))
        .when(!single, (e) => e.child(this.dropButton("agent", agentsLabel(picked), picked.length > 0, t,
          () => this.openMenu("agents", [["all", "All agents"], ...agents.map((a) => [a, a]), ["none", "no agent"]], picked))))
        .child(h_flex().id("search").flex_1().min_w(0).h(24).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.border).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(glyph("search", 12, t.muted))
          .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground))
          .when(typed, (e) => e.child(div().id("search-clear").size(16).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer()
            .tooltip("Clear search").hover((s) => s.bg(t.hover))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { this.input.set_value(""); this.query = ""; cx.notify(); })
            .child(glyph("close", 12, t.muted))))))
      .when(this.filtering, (e) => e.child(h_flex().gap(2).items_center().px(8).pt(6).pb(6)
        .child(label("Prio"))
        .child(segmented("prio", [["all", "All"], ["p1", "P1"], ["p2", "P2"], ["p3+", "P3+"]], this.f.prio, t, pick((k) => ({ prio: k }))))
        .child(div().flex_1())
        .child(label("Group"))
        .child(segmented("group", [["status", "Status"], ...(single ? [] : [["agent", "Agent"]]), ["none", "None"]], single && this.f.group === "agent" ? "status" : this.f.group, t, pick((k) => ({ group: k }))))));
  }

  // ---- drawing: the list ----
  // Rows have a fixed height so the list can be virtual. A virtual list's rows take no handlers; the list reports
  // clicks by key. Each row carries its key (lib/board.js taskKey: machine and ID) as id: GPUI repaints a hover change
  // only for an element with an identity (scripts/hoverids.mjs).
  row(key, size, t) {
    return h_flex().id(key).h(size).w_full().flex_none().px(8).gap(9).items_center().rounded(7).cursor_pointer().overflow_hidden().hover((s) => s.bg(t.hover));
  }
  taskRow(task, key, size, x) {
    const { t, c, mono } = x, s = look(task.status, t, c, mono), hint = hintOf(task, x.defaultAssignee, { single: x.single }), prio = prioLabel(task.priority);
    const age = ago(task.status === "done" ? task.completedAt ?? task.createdAt : task.createdAt, Date.now() / 1000);
    const meta = [task.id, x.single ? null : task.assignee ?? "—", age].filter(Boolean).join(" · ");
    const tint = hint && (hint.tone === "red" ? c.red : mono ? t.muted : c[hint.tone] ?? t.muted);
    return this.row(key, size, t).child(glyphOf(s.icon, 15, s.color))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(div().truncate().font_medium().child(task.title))
        .child(h_flex().gap(4).items_center().overflow_hidden().text_size(11).text_color(t.muted)
          .child(div().flex_none().child(meta))
          .when(Boolean(hint), (e) => e.child(div().flex_none().child("·")).child(div().min_w(0).truncate().text_color(tint).child(hint.text)))))
      .child(h_flex().flex_none().gap(8).items_center().text_size(11).text_color(t.muted)
        .when(task.comments > 0, (e) => e.child(h_flex().gap(3).items_center().child(glyph("comment", 12, t.muted)).child(String(task.comments))))
        .when(Boolean(prio), (e) => e.child(chip(prio, t))));
  }
  // A group's heading: its status color (grouped by status), name and count, and the red alert when it needs you.
  heading(g, size, x) {
    const { t, c, mono } = x, status = x.group === "status";
    return h_flex().h(size).w_full().flex_none().px(8).pt(8).gap(7).items_center().text_size(12)
      .when(status, (e) => e.child(div().size(7).flex_none().rounded(4).bg(look(g.key, t, c, mono).color)))
      .child(div().min_w(0).truncate().font_semibold().child(g.label))
      .child(div().flex_none().text_color(t.muted).child(String(g.count)))
      .child(div().flex_1())
      .when(g.needsYou, (e) => e.child(glyph("alert", 12, c.red)));
  }

  // The rows as entries { key, size, draw, open }: what the virtual list places and what a click opens.
  entriesOf(groups, x) {
    const entry = (key, draw, open) => ({ key, size: ROW, draw: (sz) => draw(sz, key), open });
    return groups.flatMap((g, i) => [
      { key: `g:${i}:${g.key}`, size: HEADING, draw: (sz) => this.heading(g, sz, x), open: null },
      ...g.tasks.map((task) => entry(taskKey(task), (sz, key) => this.taskRow(task, key, sz, x), () => this.openTask(task))),
    ]);
  }

  list(t, c, snap, agents, machine, single) {
    // Single agent mode never groups by agent: the names stay hidden.
    const group = single && this.f.group === "agent" ? "status" : this.f.group;
    const tasks = filterTasks(snap.board.tasks, { state: this.f.state, query: this.query, agents, prio: this.f.prio });
    const box = v_flex().flex_1().min_h(0).relative().px(6).py(4);
    if (!tasks.length) {
      this.entries = [];
      const narrowed = this.query.trim() !== "" || agents.length > 0 || this.f.prio !== "all";
      const text = narrowed ? "No tasks match" : { open: "No open tasks", done: "No done tasks" }[this.f.state] ?? "No tasks";
      return box.child(div().px(16).py(28).text_size(12).text_center().text_color(t.dim).child(text));
    }
    const groups = groupTasks(tasks, group, snap.workflow?.order ?? ORDER, snap.workflow?.labels ?? {});
    const items = this.entries = this.entriesOf(groups, { t, c, mono: this.settings["status.color"] === "mono", defaultAssignee: snap.defaultAssignee, single, group });
    const byKey = new Map(items.map((x) => [x.key, x]));
    const id = `list-${machine}`;
    return box
      .child(v_virtual_list(id, items.length, items.map((x) => x.size), (n) => items[n].key,
        (range) => items.slice(range.start, range.end).map((x) => x.draw(x.size)))
        .size_full()
        .on_item_click((key) => byKey.get(key)?.open?.()))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  // One line: running tasks and problems (red above 0) on the left, or a warning when the last poll failed; the
  // gateway's dot (green running, red stopped) and the Hermes version on the right. No sync time.
  statusBar(t, c, snap) {
    const running = (snap.board?.tasks ?? []).filter((x) => x.status === "running").length, n = snap.problems;
    const gw = snap.status, up = gw?.running === true, version = gw?.version ? String(gw.version).replace(/^v/i, "") : null;
    return h_flex().id("status-bar").h(30).flex_none().px(12).gap(12).items_center().border_t(1).border_color(t.border).bg(t.chrome ?? t.background)
      .text_size(11.5).text_color(t.muted)
      .child(snap.error
        ? h_flex().id("sync-warning").min_w(0).gap(5).items_center().text_color(c.red).tooltip(snap.error)
          .child(glyph("alert", 12, c.red)).child(div().min_w(0).truncate().child(`Sync failed: ${snap.error}`))
        : h_flex().flex_none().gap(5).items_center().child(`${running} running`)
          .when(typeof n === "number", (e) => e.child("·").child(div().text_color(n > 0 ? c.red : t.muted).when(n > 0, (x) => x.font_medium())
            .child(`${n} ${n === 1 ? "problem" : "problems"}`))))
      .child(div().flex_1())
      .child(h_flex().id("gateway").flex_none().gap(5).items_center().tooltip(up ? "Gateway running" : `Gateway ${gw?.state ?? "stopped"}`)
        .child(div().size(7).flex_none().rounded(4).bg(up ? c.green : c.red)).child(version ? `Gateway v${version}` : "Gateway"));
  }

  // ---- the agent menu (a popup of this mod) ----
  // Picks several: each row toggles its agent with a checkbox and the menu stays open; "All agents" clears the picks.
  // Every change goes to the panel through shared "hermes-kanban.pick".
  renderMenu(t) {
    const m = this.menu, picked = m.value ?? [];
    const box = (on) => div().size(14).flex_none().flex().items_center().justify_center().rounded(4)
      .when(on, (e) => e.bg(t.accent).child(glyph("check", 11, t.background)))
      .when(!on, (e) => e.border_1().border_color(t.border));
    return v_flex().id("menu").size_full().p(6).gap(1).overflow_y_scroll().bg(t.popover).text_color(t.foreground).text_size(12)
      .children(m.items.map(([value, label], i) => h_flex().id(`menu-${i}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          m.value = toggleAgent(picked, value);
          setShared("hermes-kanban.pick", { kind: m.kind, value: m.value, at: Date.now() });
          cx.notify();
        })
        .when(value === "all", (e) => e.text_color(t.muted).child(div().w(14).flex_none()))
        .when(value !== "all", (e) => e.child(box(picked.includes(value))))
        .child(div().flex_1().truncate().child(label))));
  }

  // Opening the panel on an instance clears its dot: the watcher zeroes the counts of a machine marked seen. Marked
  // once per state of the counts, so the write (which re-renders every mod) does not repeat.
  markSeen(machine) {
    const unseen = shared("hermes-kanban.unseen") ?? {}, key = (m) => `${unseen[m]?.needs ?? 0}/${unseen[m]?.done ?? 0}`;
    if (this.seenFor && key(this.seenFor.machine) === "0/0") this.seenFor = null;
    const k = key(machine);
    if (k !== "0/0" && !(this.seenFor?.machine === machine && this.seenFor.k === k)) {
      this.seenFor = { machine, k };
      setShared("hermes-kanban.seen", { machine, at: Date.now() });
    }
  }

  render(cx) {
    const t = theme();
    if (this.button) {
      // A refresh after an action (panel or overlay) polls that machine now instead of at the next beat.
      const refresh = shared("hermes-kanban.refresh");
      if (this.watch && refresh?.at && refresh.at !== this.refreshAt) {
        this.refreshAt = refresh.at;
        if (this.mine) this.pass(cx, true);
      }
      return this.toolbar(t);
    }
    if (this.menu) return this.renderMenu(t);
    if (this.viewer) return this.viewer.render(cx);
    if (this.creator) return this.creator.render(cx);
    if (this.dialog) return this.dialog.render(cx);

    this.drawnAt = Date.now();
    if (hidden()) { this.away = true; return this.shell(t); }
    const c = tones(t);
    const pick = shared("hermes-kanban.pick");
    if (pick?.at && pick.at !== this.pickedAt) {
      this.pickedAt = pick.at;
      if (pick.kind === "agents" && Array.isArray(pick.value)) this.setFilter({ agents: pick.value.filter((x) => typeof x === "string") });
    }
    const config = shared("hermes-kanban.config");
    if (config?.at && config.at !== this.configAt) { this.configAt = config.at; this.readSettings(cx); }

    // Follow me: the board of the Hermes in the focused pane, and nothing else. Only a click into this panel (a mod
    // block has the keyboard) keeps the last one (lib/instances.js).
    const view = { spaces: spaces(), panes: panes() };
    const focus = this.last = focusedInstance({ ...view, focused: focused() }, this.last);
    this.focusKey = JSON.stringify(focus);
    if (!focus.hermes) {
      this.entries = [];
      return this.shell(t).child(this.header(t, c, null, null)).children(this.strips(t, c, null))
        .child(blankslate(t, { icon: "kanban", title: "No Hermes in this pane", tone: t.muted,
          body: ["The panel follows the focused pane. Focus a pane that runs Hermes to see its board.", "Hermes on machines with an open space is still watched."] }));
    }
    const before = shared("hermes-kanban.lastPanes") ?? {}, lastPanes = rememberPane(before, focus, view.panes);
    if (lastPanes !== before) setShared("hermes-kanban.lastPanes", lastPanes);
    if (hostWindow()?.visible !== false) this.markSeen(focus.machine);

    const boards = shared("hermes-kanban.boards") ?? {};
    const snap = boards?.[focus.machine];
    const shell = this.shell(t).child(this.header(t, c, focus.machine, snap)).children(this.strips(t, c, focus.machine));
    this.entries = [];
    if (!snap) return shell.child(blankslate(t, { icon: "running", title: "Reading the board…" }));
    const access = snap.access?.state ?? "unknown";
    if (snap.unsupported) {
      return shell.child(blankslate(t, { icon: "alert", title: snap.unsupported, body: "Its board answers in a shape this version of Hermes Kanban does not know." }))
        .child(this.statusBar(t, c, snap));
    }
    // Access to set up or fix, or a setup running on this machine (access.js). A gateway that went down keeps its last
    // board, unless its restart is one this panel asked for.
    if (this.access.showing(focus.machine, snap) || (access !== "ok" && access !== "unknown" && !(access === "gateway_down" && snap.board))) {
      return shell.child(this.access.draw(t, c, focus.machine, snap));
    }
    if (!snap.board) {
      return shell.child(blankslate(t, snap.error ? { icon: "alert", title: "Can't read the board", body: snap.error }
        : snap.hermes ? { icon: "running", title: "Reading the board…" }
          : { icon: "kanban", title: "No board on this machine", body: `Hermes keeps no Kanban board on ${focus.machine} yet.` }));
    }
    // Single agent mode hides the agent filter and lifts it; an agent this board does not have filters nothing.
    const single = isSingleAgent(this.settings, focus.machine), agents = snap.board.assignees;
    const picked = pickedAgents(this.f.agents, agents, single);
    return shell
      .child(this.filterBar(t, agents, picked, single))
      .child(this.list(t, c, snap, picked, focus.machine, single))
      .child(this.statusBar(t, c, snap));
  }
}
