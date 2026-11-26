// Hermes Kanban: the Kanban board of the Hermes instance in the focused pane, as a side panel, and a button in the
// tab bar that tells when an agent finished or needs you.
// One mod, several roles by props, as ghchecker: the panel (none) and its button in the tab bar ({ button: true }).
// The button's block is always in the layout, so it carries the watcher (watcher.js): it polls every visible instance
// also while the panel is hidden, and runs the daily update check.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { layout, theme, props, shared, setShared, run, checking, readTextFile, appHome } from "herdr";
import { watchPass } from "./watcher.js";
import { tones, alpha, glyph } from "./ui.js";
import { dotOf, boardsOf } from "./lib/changes.js";
import { loadSettings } from "./lib/settings.js";
import { createUpdateGate, updateCheck, fetchLatest, localVersion } from "./lib/update.js";
import { leaseNext } from "./lib/lease.js";

const MOD = "hermes-kanban";
const WATCH = 5000; // the watcher's beat; each instance is polled on its own pace (poll_seconds) within it

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
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
    }
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

  // The icon with the dot over all visible instances on its top right corner (the pill keeps ghchecker's size):
  // red and glowing with the count of tasks that need you, green for something finished and not seen, yellow and
  // pulsing while an agent works, none for nothing.
  mark(t, ink) {
    const dot = dotOf(boardsOf(shared("hermes-kanban.boards")), shared("hermes-kanban.unseen") ?? {}), c = tones(t);
    const box = div().relative().size(14).flex_none().child(glyph("kanban", 14, ink));
    if (dot.tone === "red") {
      const n = dot.count > 99 ? "99+" : String(dot.count);
      return box
        .child(div().absolute().top(-7).right(-9).h(16).min_w(16).rounded(8).bg(alpha(c.red, "66")).loop("opacity", { from: 0.15, to: 1, period: 1600 }))
        .child(h_flex().absolute().top(-5).right(-7).h(12).min_w(12).px(3).items_center().justify_center().rounded(6).bg(c.red)
          .text_size(9).font_semibold().text_color(t.background).child(n));
    }
    if (dot.tone === "green") return box.child(div().absolute().top(-3).right(-3).size(7).rounded(4).bg(c.green));
    if (dot.tone === "yellow") return box.child(div().absolute().top(-3).right(-3).size(7).rounded(4).bg(c.yellow).loop("opacity", { from: 0.35, to: 1, period: 1400 }));
    return box;
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
    // The panel: its board, filters and list come in their own step.
    return v_flex().id(MOD).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13);
  }
}
