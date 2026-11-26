// The dialog of the "+" button: a new task on the instance the panel showed when it was opened. Title (required),
// description, priority and agent (not in single agent mode, where the task goes to the instance's default agent).
// The machine comes from the props and stays, also when the focus moves on while the dialog is open.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { theme, closeOverlay, shared, setShared, exec, notify, checking, readTextFile, appHome } from "herdr";
import { tones, segmented, button } from "./ui.js";
import { createApi } from "./lib/api.js";
import { outcomeText, failureOf } from "./lib/moves.js";
import { loadSettings, isSingleAgent } from "./lib/settings.js";
import { prioChoices } from "./lib/view.js";

const CLEAR = "#00000000";
const ok = (r) => r?.code >= 200 && r?.code < 300;
const message = (e) => String(e?.message ?? e);

export class CreateDialog {
  // { machine }: the instance the panel showed.
  constructor({ machine }, overlay, cx) {
    this.machine = machine;
    this.overlay = overlay;
    this.api = createApi(exec, (m) => this.modeOf(m));
    this.priority = 0; this.assignee = undefined; this.busy = false; this.error = null; this.created = null; this.settings = null;
    this.title = InputState.new({ placeholder: "What should be done?" });
    this.title.on("change", (_e, cx) => { const any = Boolean(this.title.value().trim()); if (any !== this.typed) { this.typed = any; cx.notify(); } });
    this.title.on("submit", (_e, cx) => this.create(cx));
    this.body = TextareaState.new({ placeholder: "Description (optional)" });
    this.body.set_auto_grow(8, 14);
    this.body.on("submit", (e, cx) => { if (e.secondary) this.create(cx); });
    if (checking()) return;
    this.title.focus();
    cx.spawn(async (cx) => { this.settings = (await loadSettings(readTextFile, appHome)).values; cx.notify(); });
  }

  snap() { return shared("hermes-kanban.boards")?.[this.machine] ?? null; }
  // The access mode for createApi; the last one seen stays when the machine leaves the visible list.
  modeOf(machine) {
    const m = shared("hermes-kanban.boards")?.[machine]?.mode ?? null;
    if (machine === this.machine && m) this.mode = m;
    return m ?? (machine === this.machine ? this.mode ?? null : null);
  }
  // Until the settings are read, no agent choice: in single agent mode the task goes to the default agent.
  single() { return !this.settings || isSingleAgent(this.settings, this.machine); }

  create(cx) {
    const title = this.title.value().trim();
    if (!title || this.busy || this.created) return;
    const fields = { title, priority: this.priority };
    const body = this.body.value().trim();
    if (body) fields.body = body;
    // As Hermes' own board: never unassigned by default. Without a pick (always in single agent mode) the task goes to
    // the instance's resolved default agent, so it starts also where kanban.default_assignee is unset. `assignee`:
    // undefined = no pick, null = "None" picked (sent without agent), else the agent.
    const fallback = this.snap()?.resolvedAssignee || this.snap()?.defaultAssignee || "";
    if (!this.single() && this.assignee !== undefined) { if (this.assignee) fields.assignee = this.assignee; }
    else if (fallback) fields.assignee = fallback;
    const machine = this.machine, labels = this.snap()?.workflow?.labels ?? {};
    this.busy = true; this.error = null;
    cx.spawn(async (cx) => {
      try {
        const r = await this.api.create(this.machine, fields);
        if (!ok(r)) this.error = `Hermes refused: ${failureOf(r)}`;
        else if (!r.task) this.error = "Hermes answered without a task.";
        else {
          setShared("hermes-kanban.refresh", { machine, at: Date.now() });
          const text = `${r.task.id} · ${outcomeText(r.task.status, r.task, labels)}`;
          const warning = typeof r.json?.warning === "string" && r.json.warning.trim() ? r.json.warning.trim() : null;
          // A warning stays in the dialog until it is read; without one the dialog closes and a toast tells.
          if (warning) this.created = { text, warning };
          else {
            notify({ title: "Task created", body: `${title} · ${text} · ${machine}`, level: "success", timeout: 4000 });
            closeOverlay(this.overlay);
          }
        }
      } catch (e) {
        this.error = message(e);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
    cx.notify();
  }

  render(_cx) {
    const t = theme(), c = tones(t), busy = this.busy, snap = this.snap();
    const field = (label, body, hint = null) => v_flex().flex_none().gap(6)
      .child(div().text_size(12).text_color(t.muted).child(label))
      .child(body)
      .when(Boolean(hint), (e) => e.child(div().text_size(11).text_color(t.muted).child(hint)));
    const boxed = (id, el) => div().id(id).px(10).py(8).rounded(7).border_1().border_color(t.border).cursor_text().child(el);

    const names = snap?.board?.assignees ?? [], fallback = snap?.resolvedAssignee || snap?.defaultAssignee || "";
    const agents = h_flex().gap(6).flex_wrap().children([[null, "None"], ...names.map((n) => [n, n])].map(([value, label], i) => {
      const on = this.assignee === value;
      return h_flex().id(`agent-${i}`).h(26).px(10).items_center().rounded(7).border_1().text_size(12)
        .border_color(on ? t.accent : t.border).bg(on ? t.selected : CLEAR).text_color(on ? t.foreground : t.muted)
        .cursor_pointer().hover((s) => s.bg(on ? t.selected : t.hover))
        .on_click((_e, cx) => { this.assignee = value; cx.notify(); })
        .child(label);
    }));
    // The hint says what really happens: no pick goes to the resolved default; "None" stays without agent unless
    // kanban.default_assignee is set, which Hermes' dispatcher gives it to.
    const configured = snap?.defaultAssignee ?? "";
    const agentHint = this.assignee ? null
      : this.assignee === null ? (configured ? `Without an agent; Hermes gives it to ${configured} at the next dispatch.` : "Stays without agent: it does not start.")
        : fallback ? `Without a pick it goes to ${fallback}.` : "Without an agent the task does not start.";

    const foot = h_flex().flex_none().px(20).py(12).gap(8).items_center().border_t(1).border_color(t.border);
    const footer = this.created
      ? foot.child(v_flex().flex_1().min_w(0).gap(2).text_size(12)
        .child(div().text_color(t.foreground).child(`Created ${this.created.text}`))
        .child(div().text_color(c.orange).child(this.created.warning)))
        .child(button("close", "Close", t, () => closeOverlay(this.overlay), { primary: true }))
      : foot.child(div().flex_1().min_w(0).text_size(12).text_color(c.red).child(this.error ?? ""))
        .child(button("cancel", "Cancel", t, () => closeOverlay(this.overlay)))
        .child(button("create", busy ? "Creating…" : "Create", t, (_e, cx) => this.create(cx), { primary: true, enabled: Boolean(this.typed) && !busy }));

    return v_flex().id("create").w_full().rounded(12).overflow_hidden().border_1().border_color(t.border)
      .bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().px(20).pt(18).pb(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(16).font_semibold().child("New task"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(`on ${this.machine}`))
        .child(button("close-overlay", "", t, () => closeOverlay(this.overlay), { icon: "close", tooltip: "Close (Esc)" })))
      .child(v_flex().id("create-body").flex_none().px(20).py(16).gap(16)
        .child(field("Title", boxed("title", Input.new(this.title).w_full().text_size(13).text_color(t.foreground)), "Required."))
        .child(field("Description", boxed("body", Textarea.new(this.body).w_full().text_size(13).text_color(t.foreground)), "Ctrl+Enter creates the task."))
        .child(field("Priority", segmented("prio", prioChoices(this.priority), this.priority, t, (n, cx) => { this.priority = n; cx.notify(); }),
          "Higher starts first."))
        .when(!this.single(), (e) => e.child(field("Agent", agents, agentHint))))
      .child(footer);
  }
}
