// The task overlay: one task of one machine in a large dialog. The head with title, ID, status, agent and age; the
// blocked box, the description, the activity and the comment box on the left; agent, moves, priority, runs and
// archive on the right. Layout after ghchecker's viewer (MIT), mods/ghchecker/viewer.js.
//
// The machine comes from the props and stays: every read goes to it, every write goes through api.act() on the task,
// which carries that machine. The focus is never read here. After each action the line at the bottom tells what
// Hermes answered (the status of the PATCH answer, not the one sent), the task is read again and the watcher polls
// the machine now (shared "hermes-kanban.refresh").
import { div } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import { theme, closeOverlay, shared, setShared, exec, checking, readTextFile, appHome } from "herdr";
import { tones, alpha, glyph, glyphOf, segmented, button, pill, look } from "./ui.js";
import { createApi } from "./lib/api.js";
import { normalizeDetail } from "./lib/board.js";
import { allowedMoves, outcomeText, commentAndUnblock, mergePatched, failureOf } from "./lib/moves.js";
import { loadSettings, isSingleAgent } from "./lib/settings.js";
import { activityOf, runLine, prioChoices, prioLabel } from "./lib/view.js";
import { ago } from "./lib/time.js";

const CLEAR = "#00000000";
const ok = (r) => r?.code >= 200 && r?.code < 300;
const message = (e) => String(e?.message ?? e);
const nowSeconds = () => Date.now() / 1000;
const since = (at) => { const a = ago(at, nowSeconds()); return a === "" ? "" : a === "now" ? "just now" : `${a} ago`; };

export class TaskViewer {
  // { machine, id }: the task's source machine and its ID.
  constructor({ machine, id }, overlay, cx) {
    this.machine = machine;
    this.id = id;
    this.overlay = overlay;
    this.api = createApi(exec, (m) => this.modeOf(m));
    this.detail = null; this.error = null; this.note = null; this.busy = null; this.archiving = false; this.settings = null;
    // The row of the board, drawn until the full task is in.
    this.task = (this.snap()?.board?.tasks ?? []).find((t) => t.id === id) ?? null;
    this.box = TextareaState.new({ placeholder: "Leave a comment (Markdown)" });
    this.box.set_auto_grow(3, 10);
    this.box.on("change", (_e, cx) => { const any = Boolean(this.box.value().trim()); if (any !== this.typed) { this.typed = any; cx.notify(); } });
    this.box.on("submit", (e, cx) => { if (e.secondary) this.comment(cx); });
    if (checking()) return;
    cx.spawn(async (cx) => { this.settings = (await loadSettings(readTextFile, appHome)).values; cx.notify(); });
    this.load(cx);
  }

  // The watcher's snapshot of this overlay's machine (workflow, assignees, access mode).
  snap() { return shared("hermes-kanban.boards")?.[this.machine] ?? null; }
  // The access mode for createApi; the last one seen stays when the machine leaves the visible list.
  modeOf(machine) {
    const m = shared("hermes-kanban.boards")?.[machine]?.mode ?? null;
    if (machine === this.machine && m) this.mode = m;
    return m ?? (machine === this.machine ? this.mode ?? null : null);
  }
  labels() { return this.snap()?.workflow?.labels ?? {}; }
  label(status) { return this.labels()[status] ?? status; }

  load(cx) {
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await this.api.task(this.machine, this.id);
        if (r.code === 200 && r.json?.task) {
          this.detail = normalizeDetail(r.json, this.machine);
          this.task = this.detail.task;
          this.error = null;
        } else {
          this.error = r.code === 404 ? "This task is no longer on the board." : `Can't read the task: ${failureOf(r)}`;
        }
      } catch (e) {
        this.error = `Can't read the task: ${message(e)}`;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // After an action: the watcher polls this machine now, and the task is read again.
  done(cx) {
    const machine = this.machine;
    setShared("hermes-kanban.refresh", { machine, at: Date.now() });
    this.load(cx);
  }

  // One PATCH through act() (the task's machine). `say(task)` makes the line from the task Hermes answered with.
  patch(fields, say, cx) {
    if (this.busy || !this.task) return;
    const before = this.task;
    this.busy = "Saving"; this.note = null; this.archiving = false;
    cx.spawn(async (cx) => {
      try {
        const r = await this.api.act(this.task, "patch", fields);
        if (!ok(r)) this.note = { text: `Hermes refused: ${failureOf(r)}`, tone: "red" };
        else if (!r.task) this.note = { text: "The task is gone from the board.", tone: "red" };
        else {
          this.task = mergePatched(before, r.task);
          this.note = { text: say(this.task, before), tone: null };
        }
      } catch (e) {
        this.note = { text: message(e), tone: "red" };
      } finally {
        this.busy = null;
        this.done(cx);
        cx.notify();
      }
    });
    cx.notify();
  }
  move(status, cx) {
    this.patch({ status }, (t) => {
      const text = outcomeText(status, t, this.labels());
      return text === this.label(t.status) ? `Moved to ${text}` : text;
    }, cx);
  }
  // null unassigns (the api sends "", the only value Hermes reads as unassign).
  assign(name, cx) {
    this.patch({ assignee: name }, (t, before) => `${name ? `Assigned to ${name}` : "Unassigned"}. ${outcomeText(before.status, t, this.labels())}`, cx);
  }
  prioritize(n, cx) {
    this.patch({ priority: n }, (t, before) => `Priority ${prioLabel(t.priority) ?? "none"}. ${outcomeText(before.status, t, this.labels())}`, cx);
  }
  // Two clicks: the first asks, the second archives (a PATCH; this mod never deletes).
  archive(cx) {
    if (!this.archiving) { this.archiving = true; cx.notify(); return; }
    this.patch({ status: "archived" }, (t) => (t.status === "archived" ? "Archived. The task leaves the board." : outcomeText("archived", t, this.labels())), cx);
  }

  typedText() { return this.box.value().trim(); }
  clearBox() { this.box.set_value(""); this.typed = false; }
  comment(cx) {
    const text = this.typedText();
    if (!text || this.busy || !this.task) return;
    this.busy = "Commenting"; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = await this.api.act(this.task, "comment", { body: text });
        if (ok(r)) { this.clearBox(); this.note = { text: "Comment added.", tone: null }; }
        else this.note = { text: `Comment not added: ${failureOf(r)}`, tone: "red" };
      } catch (e) {
        this.note = { text: `Comment not added: ${message(e)}`, tone: "red" };
      } finally {
        this.busy = null;
        this.done(cx);
        cx.notify();
      }
    });
    cx.notify();
  }
  // Comment first, then PATCH to ready; a refused PATCH keeps the comment, and the line says so.
  commentAndUnblock(cx) {
    const text = this.typedText();
    if (!text || this.busy || !this.task) return;
    this.busy = "Commenting"; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = await commentAndUnblock(this.api, this.task, text);
        if (r.commented) this.clearBox();
        if (r.moved) {
          this.task = mergePatched(this.task, r.moved);
          this.note = { text: `Comment added. ${outcomeText("ready", r.moved, this.labels())}`, tone: null };
        } else if (r.commented) {
          this.note = { text: `Comment added, but the task stays blocked: ${r.error}`, tone: "red" };
        } else {
          this.note = { text: `Comment not added: ${r.error}`, tone: "red" };
        }
      } finally {
        this.busy = null;
        this.done(cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  // ---- the top ----
  top(task, t, c) {
    const mono = this.settings?.["status.color"] === "mono";
    const meta = task ? [task.assignee ?? "unassigned", task.createdAt != null ? `created ${since(task.createdAt)}` : null,
      `${task.comments} ${task.comments === 1 ? "comment" : "comments"}`].filter(Boolean).join(" · ") : "";
    return v_flex().flex_none().gap(10).px(20).pt(18).pb(14).border_b(1).border_color(t.border)
      .child(h_flex().gap(10).items_center()
        .child(h_flex().flex_1().min_w(0).gap(8).flex_wrap().text_size(18).font_semibold()
          .child(div().child(task?.title || `Loading ${this.id}…`)).child(div().font_normal().text_color(t.muted).child(this.id)))
        .when(Boolean(this.busy) || this.loading, (e) => e.child(h_flex().flex_none().gap(6).items_center().text_size(12).text_color(t.muted)
          .child(glyphOf("running", 12, t.muted)).child(this.busy ?? "Reading")))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(this.machine))
        .child(button("close-overlay", "", t, () => closeOverlay(this.overlay), { icon: "close", tooltip: "Close (Esc)" })))
      .when(Boolean(task), (e) => e.child(h_flex().gap(10).items_center()
        .child(pill(this.label(task.status), look(task.status, t, c, mono).color))
        .child(div().min_w(0).truncate().text_size(12).text_color(t.muted).child(meta))))
      .when(Boolean(this.error), (e) => e.child(div().text_size(12).text_color(c.red).child(this.error)));
  }

  // ---- the left column ----
  blockedBox(task, t, c) {
    const reason = task.summary || task.failure || "Hermes gave no reason.";
    return v_flex().flex_none().gap(6).px(14).py(12).rounded(9).border_1().border_color(alpha(c.red, "73")).bg(alpha(c.red, "14"))
      .child(div().font_semibold().text_color(c.red).child(task.assignee ? `${task.assignee} is blocked` : "Blocked"))
      .child(div().text_color(t.foreground).child(reason))
      .child(div().text_size(11).text_color(t.muted)
        .child(`Answer as a comment, then unblock.${task.assignee ? " The agent continues with the next dispatch." : ""}`));
  }

  description(task, t) {
    const body = task?.body?.trim();
    return v_flex().flex_none().rounded(9).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().h(36).px(12).items_center().bg(t.raised).text_size(12).text_color(t.muted).child("Description"))
      .child(div().px(14).py(12).child(!this.detail ? div().text_color(t.muted).child("Loading…")
        : body ? TextView.markdown(`body-${this.id}`, body).selectable(true) : div().italic().text_color(t.muted).child("No description.")));
  }

  activity(t, c) {
    const items = this.detail ? activityOf(this.detail) : [];
    const list = v_flex().flex_none();
    if (!this.detail) return list.child(div().py(6).text_size(12).text_color(t.muted).child("Loading…"));
    if (!items.length) return list.child(div().py(6).text_size(12).text_color(t.muted).child("No activity yet."));
    return list.children(items.map((a) => h_flex().gap(10).py(7).items_start()
      .child(div().size(8).mt(5).flex_none().rounded(4).bg(a.tone ? c[a.tone] : t.muted))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().child(a.text))
        .child(div().text_size(11).text_color(t.muted).child(since(a.at))))));
  }

  composer(task, t, c) {
    const busy = Boolean(this.busy), blocked = task.status === "blocked";
    return v_flex().flex_none().mt(4).rounded(9).border_1().border_color(t.border).overflow_hidden()
      .child(h_flex().h(32).px(12).items_center().bg(t.raised).text_size(12).text_color(t.muted).child("Comment"))
      .child(div().id("box").px(12).py(10).cursor_text().child(Textarea.new(this.box).w_full().text_size(13).text_color(t.foreground)))
      .child(h_flex().px(10).py(8).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(11).text_color(t.muted).child("Ctrl+Enter to comment"))
        .child(button("comment", "Comment", t, (_e, cx) => this.comment(cx), { enabled: this.typed && !busy }))
        .when(blocked, (e) => e.child(button("comment-unblock", "Comment & unblock", t, (_e, cx) => this.commentAndUnblock(cx),
          { tone: c.blue, enabled: this.typed && !busy, tooltip: "Adds the comment, then asks Hermes to move the task to ready" }))));
  }

  // ---- the right column ----
  aside(task, t, c) {
    const busy = Boolean(this.busy), snap = this.snap(), workflow = snap?.workflow ?? null;
    const quiet = (text) => div().text_size(12).text_color(t.muted).child(text);
    const part = (title, body) => v_flex().flex_none().gap(6).child(div().text_size(12).text_color(t.muted).child(title)).child(body);
    const single = !this.settings || isSingleAgent(this.settings, this.machine);

    // Agents: the board's profiles and the current one, with what each runs now, and Unassigned.
    const tasks = snap?.board?.tasks ?? [];
    const names = [...new Set([...(snap?.board?.assignees ?? []), task.assignee].filter(Boolean))];
    const load = (n) => { const k = tasks.filter((x) => x.assignee === n && x.status === "running").length; return k ? `${k} running` : "idle"; };
    const agents = v_flex().gap(2).children([...names.map((n) => [n, n, load(n)]), [null, "Unassigned", ""]].map(([value, label, note], i) => {
      const on = (task.assignee ?? null) === value;
      return h_flex().id(`agent-${i}`).h(28).px(8).gap(6).items_center().rounded(6).text_size(12.5)
        .bg(on ? t.selected : CLEAR).cursor_pointer().hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click((_e, cx) => { if (!on && !busy) this.assign(value, cx); })
        .child(div().w(14).flex_none().child(on ? glyph("check", 13, c.blue) : div()))
        .child(div().flex_1().min_w(0).truncate().child(label))
        .child(div().flex_none().text_size(11).text_color(t.muted).child(note));
    }));

    const moves = workflow ? allowedMoves(workflow, task.status) : [];
    const moveBox = !workflow ? quiet("The moves come with the next poll.")
      : !moves.length ? quiet("Hermes allows no move from this status.")
        : v_flex().gap(6)
          .child(h_flex().gap(6).flex_wrap().children(moves.map((s) => button(`move-${s}`, this.label(s), t, (_e, cx) => this.move(s, cx),
            { small: true, enabled: !busy, ...(s === "ready" ? { tone: c.blue } : {}) }))))
          .child(div().text_size(11).text_color(t.muted).child("Only moves Hermes allows from the current status."));

    const runs = [...(this.detail?.runs ?? [])].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    const runBox = !this.detail ? quiet("Loading…") : !runs.length ? quiet("No runs yet.")
      : v_flex().gap(4).children(runs.map((r, i) => div().text_size(12).text_color(i === 0 ? t.foreground : t.muted).child(runLine(r, nowSeconds()))));

    return v_flex().id("aside").w(270).flex_none().min_h(0).overflow_y_scrollbar().border_l(1).border_color(t.border).p(16).gap(18)
      .when(!single, (e) => e.child(part("Agent (assignee)", agents)))
      .child(part("Move to", moveBox))
      .child(part("Priority", segmented("prio", prioChoices(task.priority), task.priority, t, (n, cx) => { if (n !== task.priority && !busy) this.prioritize(n, cx); })))
      .child(part("Runs", runBox))
      .child(div().flex_1())
      .when(task.status !== "archived", (e) => e.child(this.archiving
        ? h_flex().gap(6)
          .child(button("archive-cancel", "Cancel", t, (_e, cx) => { this.archiving = false; cx.notify(); }))
          .child(button("archive", "Confirm archive", t, (_e, cx) => this.archive(cx), { tone: c.red, enabled: !busy }).flex_1())
        : button("archive", "Archive", t, (_e, cx) => this.archive(cx), { outline: c.red, enabled: !busy, tooltip: "Archive the task: it leaves the board" }).w_full()));
  }

  render(_cx) {
    const t = theme(), c = tones(t), task = this.task;
    const frame = v_flex().id("viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).child(this.top(task, t, c));
    if (!task) return frame;
    return frame
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().id(`left-${this.id}`).flex_1().min_w(0).h_full().overflow_y_scrollbar().px(20).py(16).gap(12)
          .when(task.status === "blocked", (e) => e.child(this.blockedBox(task, t, c)))
          .child(this.description(task, t))
          .child(div().pt(4).text_size(12).text_color(t.muted).child("Activity"))
          .child(this.activity(t, c))
          .child(this.composer(task, t, c))
          .child(div().flex_none().h(12)))
        .child(this.aside(task, t, c).h_full()))
      .when(Boolean(this.note), (e) => e.child(h_flex().id("note").min_h(38).flex_none().px(20).py(8).gap(8).items_center()
        .border_t(1).border_color(t.border).bg(t.raised).text_size(12)
        .child(div().size(7).flex_none().rounded(4).bg(this.note.tone === "red" ? c.red : c.yellow))
        .child(div().flex_1().min_w(0).text_color(this.note.tone === "red" ? c.red : t.foreground).child(this.note.text))));
  }
}
