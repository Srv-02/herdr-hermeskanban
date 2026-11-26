// The Settings dialog (an overlay of this mod, props { settings: true, machine }), laid out like ghchecker's: Updates
// on top (a gold box when a new release is out, the installed version and Check now), then Agents, Display,
// Notifications and Connection, then the links, and Cancel / Save at the bottom. Save writes the changed keys to
// hermes-kanban.json; the panel and the watcher read it again (shared "hermes-kanban.config").
// The dialog edits the instance the panel showed when it opened (props.machine), also when the focus moves on:
// single agent mode for it, its default agent (read only, from /orchestration) and "Remove access" in the spec's
// order (lib/setup.js nextRemovalStep): the drop-in first, then a restart only on a click, the key last.
// Layout and controls adapted from ghchecker by Michael Mayer (MIT), mods/ghchecker/settings.js, itself from
// filer-pro (MIT), mods/filer-pro/ui/settings.js.
import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, closeOverlay, appHome, readTextFile, writeTextFile, shared, setShared, notify, checking } from "herdr";
import { glyph, glyphOf, openUrl, alpha, tones, GOLD } from "./ui.js";
import { SETTINGS, CONFIG_FILE, parseSettings, saveSettings, changedSettings } from "./lib/settings.js";
import { fetchRelease, localVersion, updateStatus, checkedAt, GITHUB_URL, COFFEE_URL, UPDATE_PROMPT } from "./lib/update.js";
import { ACCESS_TEXT, ENV_HIDDEN_TEXT, REMOVE_SCRIPT, DELETE_TOKEN_SCRIPT, nextRemovalStep, pickUnit, restartSpec } from "./lib/setup.js";
import { TOKEN_FILES, redactSecrets } from "./lib/request.js";
import { probeMachine, runScript, restartGateway } from "./access.js";

const CLEAR = "#00000000";
const message = (e) => String(e?.message ?? e);
const help = (t, text, color = null) => div().text_size(12.5).line_height("19px").text_color(color ?? t.muted).child(text);
const heading = (t, text, first = false) => div().pt(first ? 12 : 26).pb(6).text_size(12.5).text_color(t.muted).child(text.toUpperCase());

// One setting: the label, its help line below it, the control on the right.
function row(t, id, title, about, controls, last = false) {
  return h_flex().id(id).w_full().gap(18).py(13).items_center()
    .when(!last, (el) => el.border_b(1).border_color(t.border))
    .child(v_flex().flex_1().min_w(0).gap(3).child(div().text_size(14.5).text_color(t.foreground).child(title)).child(about))
    .child(h_flex().flex_none().gap(8).items_center().children(controls));
}

// Herdr's switch, as in the design: 42x24, knob 18, accent when on.
const toggle = (t, id, on, onClick) => div().id(id).w(42).h(24).flex_none().rounded(12).p(3).flex().bg(on ? t.accent : t.hover)
  .when(on, (el) => el.justify_end()).cursor_pointer().on_click(onClick)
  .child(div().w(18).h(18).rounded(9).bg(on ? t.accent_foreground : t.muted));

// A button without its handler (face), and with it. Save is the solid one.
const face = (t, id, text, { primary = false, color = null } = {}) => h_flex().id(id).h(34).px(16).gap(6).items_center().rounded(8).cursor_pointer().text_size(13.5)
  .border_1().border_color(primary ? t.solid ?? t.foreground : color ? alpha(color, "88") : t.border)
  .bg(primary ? t.solid ?? t.foreground : CLEAR).text_color(primary ? t.solid_foreground ?? t.background : color ?? t.foreground)
  .when(primary, (el) => el.font_medium())
  .hover((s) => s.opacity(0.88)).child(text);
const button = (t, id, text, onClick, opts = {}) => face(t, id, text, opts).on_click((_e, cx) => onClick(cx));

const link = (t, id, text, icon, url) => h_flex().id(id).gap(6).items_center().cursor_pointer().text_size(12.5).text_color(t.muted)
  .hover((s) => s.text_color(t.foreground)).on_click(() => openUrl(url)).child(icon).child(text);

const value = (t, text) => div().max_w(220).truncate().text_size(13).text_color(t.foreground).child(text);
const working = (t, text) => h_flex().h(34).gap(6).items_center().text_size(13.5).text_color(t.muted).child(glyphOf("running", 13, t.muted)).child(text);

export class SettingsDialog {
  // props.machine: the instance the panel showed, or null.
  constructor({ machine = null } = {}, overlay, cx) {
    this.machine = machine;
    this.overlay = overlay; this.saved = null; this.draft = null; this.error = null; this.broken = false; this.busy = false;
    this.check = { phase: "idle" }; this.version = null;
    // "Remove access": phase idle | probing | confirm | working; step from nextRemovalStep on the last probe.
    this.removal = { phase: "idle", probe: null, unit: null, step: null, error: null, note: null };
    this.mode = shared("hermes-kanban.boards")?.[machine]?.mode ?? null;
    this.handle = cx.focus_handle();
    if (checking()) return;
    cx.spawn(async (cx) => {
      const [text, mod] = await Promise.all([readTextFile(`${appHome()}/${CONFIG_FILE}`).catch(() => null), readTextFile(`${appHome()}/mods/hermes-kanban/mod.json`).catch(() => null)]);
      const { values, problems } = parseSettings(text);
      this.saved = values; this.draft = { ...values, single_agent: [...values.single_agent] }; this.version = localVersion(mod);
      if (problems.includes(CONFIG_FILE)) { this.broken = true; this.error = `${CONFIG_FILE} has a typo: fix or delete it, then reopen Settings.`; }
      cx.notify();
    });
    // The settings probe for "Remove access" themselves: the poller probes only on trouble (R6).
    if (machine && this.mode === "gated") this.probe(cx);
    this.handle.focus();
  }

  close() { closeOverlay(this.overlay); }
  set(key, v, cx) { this.draft[key] = v; cx.notify(); }
  snap() { return shared("hermes-kanban.boards")?.[this.machine] ?? null; }

  // Save: the changed keys only, then the panel and the watcher read the file again.
  save(cx) {
    if (this.busy || this.broken || !this.draft) return;
    const edits = changedSettings(this.saved, this.draft);
    if (!Object.keys(edits).length) { this.close(); return; }
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        await saveSettings(edits, { readTextFile, writeTextFile, appHome });
        setShared("hermes-kanban.config", { at: Date.now() });
        this.close();
      } catch (e) { this.error = `Not saved: ${message(e)}`; this.busy = false; cx.notify(); }
    });
  }

  // Check now: one request from this dialog, also with the daily check off. From ghchecker's checkNow.
  checkNow(cx) {
    if (this.check.phase === "checking") return;
    this.check = { phase: "checking" }; cx.notify();
    cx.spawn(async (cx) => {
      const r = await fetchRelease(globalThis.fetch, (ms) => cx.sleep(ms));
      if (r.error) this.check = { phase: "failed" };
      else {
        const state = { at: Date.now(), local: this.version, latest: r.tag };
        if (this.version && this.saved?.update_check !== false) setShared("hermes-kanban.update", state);
        this.check = { phase: "done", state };
      }
      cx.notify();
    });
  }

  // ---- Remove access, always on this.machine ----
  probe(cx, note = null) {
    const r = this.removal;
    r.phase = "probing"; r.note = note; cx.notify();
    cx.spawn(async (cx) => {
      try {
        r.probe = await probeMachine(this.machine);
        r.unit = pickUnit(r.probe.units).unit ?? null;
        r.step = r.unit ? nextRemovalStep({ probe: r.probe, unit: r.unit }) : null;
        if (!r.unit) r.error = ACCESS_TEXT.wrong_user.body;
      } catch (e) {
        r.probe = null; r.step = null; r.error = redactSecrets(`Could not read ${this.machine}: ${message(e)}`);
      }
      r.phase = "idle";
      cx.notify();
    });
  }

  // One step that writes on the machine, then a new probe decides the next one.
  removeStep(cx, name, script, done) {
    const r = this.removal;
    if (r.phase === "working" || !r.unit) return;
    r.phase = "working"; r.error = null; cx.notify();
    cx.spawn(async (cx) => {
      let note = null;
      try {
        const why = await runScript(this.machine, name, script, r.unit);
        if (why) r.error = why; else note = done;
      } catch (e) { r.error = redactSecrets(message(e)); }
      setShared("hermes-kanban.refresh", { machine: this.machine, at: Date.now() });
      this.probe(cx, note);
    });
  }

  // `restart` comes from the click (restartSpec of this.machine); nothing else starts one.
  restart(restart, cx) {
    const r = this.removal;
    if (r.phase === "working") return;
    r.phase = "working"; r.error = null; r.restarting = true; cx.notify();
    cx.spawn(async (cx) => {
      let note = null;
      try {
        const out = await restartGateway(restart, (ms) => cx.sleep(ms));
        if (out.error) r.error = out.error; else note = "The gateway runs again.";
      } catch (e) {
        r.error = redactSecrets(message(e));
      } finally {
        r.restarting = false; r.phase = "idle";
        setShared("hermes-kanban.refresh", { machine: this.machine, at: Date.now() });
        this.probe(cx, note);
      }
    });
  }

  // The access row of the shown instance: what is set up and the one next step.
  accessRow(t, c) {
    const m = this.machine, r = this.removal, title = "Remove access";
    const about = (text, color = null) => v_flex().gap(3).child(help(t, text, color))
      .when(Boolean(r.note), (e) => e.child(help(t, r.note, c.green)))
      .when(Boolean(r.error), (e) => e.child(help(t, r.error, c.red)));
    if (!m) return row(t, "settings-access", title, help(t, "Open the settings from a Hermes pane to manage its access."), [], true);
    if (this.mode === "open") return row(t, "settings-access", title, help(t, `Hermes on ${m} runs without sign-in. Hermes Kanban uses the web app's own token there and set up nothing.`), [], true);
    if (this.mode !== "gated") return row(t, "settings-access", title, help(t, `The gateway on ${m} has not answered yet.`), [], true);
    if (r.phase === "probing") return row(t, "settings-access", title, about(`Reading ${m}…`), [working(t, "Reading…")], true);
    if (r.phase === "working") return row(t, "settings-access", title, about(r.restarting ? `Restarting the gateway on ${m}. Running turns finish first.` : `Working on ${m}…`), [working(t, "Working…")], true);
    if (!r.step) return row(t, "settings-access", title, about(`Could not read the access of ${m}.`), [button(t, "settings-access-retry", "Try again", (cx) => { r.error = null; this.probe(cx); })], true);
    if (r.step === "remove_dropin") {
      if (r.phase === "confirm") {
        return row(t, "settings-access", title, about(`Deletes the drop-in of ${r.unit} on ${m} and runs systemctl --user daemon-reload. The gateway keeps the key until you restart it; the key goes last.`), [
          button(t, "settings-access-cancel", "Cancel", (cx) => { r.phase = "idle"; cx.notify(); }),
          button(t, "settings-access-confirm", "Confirm", (cx) => this.removeStep(cx, "remove", REMOVE_SCRIPT, "The drop-in is gone."), { color: c.red })], true);
      }
      return row(t, "settings-access", title, about(`Hermes Kanban has access to ${m}: a key and a drop-in for ${r.unit}. Removing asks first.`),
        [button(t, "settings-access-remove", "Remove access", (cx) => { r.phase = "confirm"; r.note = null; cx.notify(); }, { color: c.red })], true);
    }
    if (r.step === "offer_restart") {
      // The probe cannot read the gateway's environment: a restart will not move this on, and the row says why.
      const hidden = r.probe?.envHidden?.includes(r.unit);
      return row(t, "settings-access", title, about(hidden ? ENV_HIDDEN_TEXT : `${ACCESS_TEXT.waiting_restart.body} After it, the key on ${m} can go.`), [
        face(t, "settings-access-restart", "Restart gateway").on_click((_e, cx) => this.restart(restartSpec(this.machine), cx))], true);
    }
    if (r.step === "delete_token") {
      return row(t, "settings-access", title, about(`The gateway on ${m} runs without the key. Delete ~/${TOKEN_FILES.gated} to finish.`),
        [button(t, "settings-access-delete", "Delete key", (cx) => this.removeStep(cx, "delete_token", DELETE_TOKEN_SCRIPT, "The key is gone."), { color: c.red })], true);
    }
    return row(t, "settings-access", title, about(`No access of Hermes Kanban is set up on ${m}.`), [], true);
  }

  // The gold box of a new release: what is out, the release notes, and what to ask the agent.
  available(t, status) {
    return v_flex().id("settings-update").gap(10).mt(4).mb(6).px(18).py(16).rounded(10).border_1().border_color(alpha(GOLD, "66")).bg(alpha(GOLD, "14"))
      .child(h_flex().gap(10).items_center()
        .child(glyph("settings", 18, GOLD))
        .child(div().flex_1().min_w(0).text_size(15).font_medium().text_color(GOLD).child(`Hermes Kanban ${status.version} is available`))
        .child(div().id("settings-notes").text_size(12.5).text_color(GOLD).cursor_pointer().hover((s) => s.underline()).on_click(() => openUrl(status.url)).child("Release notes")))
      .child(help(t, `You have ${this.version}. To update, ask your agent in Herdr:`, t.foreground))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().px(10).py(8).rounded(7).bg(t.background).border_1().border_color(alpha(GOLD, "44"))
          .font_family("JetBrains Mono").text_size(12).text_color(t.foreground).child(UPDATE_PROMPT))
        .child(button(t, "settings-copy-prompt", "Copy", (cx) => { cx.write_to_clipboard(UPDATE_PROMPT); notify({ title: "Copied", body: "Paste it to your agent in Herdr.", level: "success", timeout: 2500 }); }, { color: GOLD })));
  }

  updates(t, c) {
    const stored = shared("hermes-kanban.update"), status = updateStatus(this.check, stored, this.version);
    const title = this.version ? `Hermes Kanban ${this.version}` : "Hermes Kanban";
    const last = (at) => `Last checked ${checkedAt(at, Date.now())}.`;
    const shownAt = this.check.phase === "done" ? this.check.state.at : stored?.at;
    const line = {
      checking: () => help(t, "Asking GitHub for the latest version…"),
      failed: () => help(t, "Could not reach GitHub. Check your connection and try again.", c.red),
      available: () => help(t, typeof shownAt === "number" ? last(shownAt) : "Not checked yet."),
      uptodate: () => h_flex().gap(6).items_center().child(glyph("check", 13, c.green)).child(help(t, `You’re up to date. ${last(status.at)}`)),
      unchecked: () => help(t, "Not checked yet."),
    }[status.kind]();
    const control = status.kind === "checking" ? working(t, "Checking…")
      : button(t, "settings-check", status.kind === "failed" ? "Try again" : "Check now", (cx) => this.checkNow(cx));
    return [...(status.kind === "available" ? [this.available(t, status)] : []), row(t, "settings-version", title, line, [control])];
  }

  switchRow(t, key, last = false) {
    const s = SETTINGS.find((x) => x.key === key), on = this.draft[key] === true;
    return row(t, `settings-${key}`, s.label, help(t, s.about), [toggle(t, `settings-${key}-switch`, on, (_e, cx) => this.set(key, !on, cx))], last);
  }

  // A choice as Herdr's segmented picker.
  choiceRow(t, key, label, last = false) {
    const s = SETTINGS.find((x) => x.key === key), v = this.draft[key];
    const picker = h_flex().id(`settings-${key}-picker`).gap(2).p(2).rounded(8).border_1().border_color(t.border)
      .children(s.choices.map((choice) => div().id(`settings-${key}-${choice}`).px(12).py(5).rounded(6).text_size(13).cursor_pointer()
        .bg(choice === v ? t.selected : CLEAR).text_color(choice === v ? t.foreground : t.muted)
        .hover((x) => x.text_color(t.foreground))
        .on_click((_e, cx) => this.set(key, choice, cx))
        .child(label(choice))));
    return row(t, `settings-${key}`, s.label, help(t, s.about), [picker], last);
  }

  // Single agent mode holds per instance: this switch adds or removes the shown machine.
  agents(t, c) {
    const m = this.machine, list = this.draft.single_agent, on = Boolean(m) && list.includes(m);
    const single = m
      ? row(t, "settings-single_agent", "Single agent mode", help(t, `Hides the agent filter and picker on ${m}. Hermes assigns new tasks to its default agent.`),
        [toggle(t, "settings-single_agent-switch", on, (_e, cx) => this.set("single_agent", on ? list.filter((x) => x !== m) : [...list, m], cx))])
      : row(t, "settings-single_agent", "Single agent mode", help(t, "Per instance. Open the settings from a Hermes pane to set it for that instance."), []);
    // Hermes' resolved default: kanban.default_assignee, else its active profile (lib/poller.js).
    const snap = this.snap(), configured = snap?.defaultAssignee ?? "", assignee = snap?.resolvedAssignee || configured;
    const source = configured ? "Set in Hermes (kanban.default_assignee)" : "Hermes' active profile (kanban.default_assignee is not set)";
    const about = v_flex().gap(3).child(help(t, assignee ? source : "Set in Hermes (kanban.default_assignee)"))
      .when(Boolean(m) && !assignee, (e) => e.child(help(t, "Without a default agent, a new task does not start.", c.yellow)));
    const assigned = row(t, "settings-default-agent", "Default agent", about, [value(t, m ? assignee || "none" : "—")], true)
      .when(!on, (el) => el.opacity(0.45));
    return [single, assigned];
  }

  render() {
    const t = theme(), c = tones(t), ready = Boolean(this.draft);
    const instances = Object.values(shared("hermes-kanban.boards") ?? {}).filter((s) => s?.hermes).map((s) => s.machine);
    const body = !ready ? [help(t, "Reading the settings…")] : [
      heading(t, "Updates", true),
      ...this.updates(t, c),
      this.switchRow(t, "update_check", true),
      heading(t, "Agents"),
      ...this.agents(t, c),
      heading(t, "Display"),
      this.choiceRow(t, "status.color", (x) => x[0].toUpperCase() + x.slice(1), true),
      heading(t, "Notifications"),
      this.switchRow(t, "toast.needs_you"),
      this.switchRow(t, "toast.done"),
      this.switchRow(t, "sound.needs_you"),
      this.switchRow(t, "sound.done"),
      this.switchRow(t, "badge", true),
      heading(t, "Connection"),
      row(t, "settings-instances", "Hermes instances", help(t, "Every machine with an open space and a Hermes board. Close its last space and it disappears."),
        [value(t, instances.length ? instances.join(" · ") : "none")]),
      this.choiceRow(t, "poll_seconds", (x) => `${x} s`),
      this.accessRow(t, c),
      h_flex().id("settings-footer").gap(18).pt(26).pb(6).items_center().flex_wrap()
        .child(div().flex_1().text_size(12.5).text_color(t.muted).child("Hermes Kanban is free and open source."))
        .child(link(t, "settings-github", "GitHub", glyph("github", 14, t.muted), GITHUB_URL))
        .child(link(t, "settings-coffee", "Buy me a coffee", glyph("coffee", 14, t.muted), COFFEE_URL)),
    ];
    // The overlay has no frame and is only the room for the dialog: the card below is as tall as its content, centered,
    // and never taller than the room; then the body shrinks and scrolls, header and footer stay.
    const card = v_flex().id("settings").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .w_full().max_h_full().overflow_hidden().rounded(10).border_1().border_color(t.border).shadow_xl().bg(t.popover).text_color(t.foreground)
      .child(h_flex().flex_none().items_center().px(30).pt(22).pb(8)
        .child(div().flex_1().text_size(17).font_medium().child("Hermes settings"))
        .child(div().id("settings-esc").px(7).py(3).rounded(6).border_1().border_color(t.border).text_size(11.5).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Close").on_click(() => this.close()).child("Esc")))
      .child(v_flex().relative().flex_shrink(1).min_h(0)
        .child(div().id("settings-body").flex_shrink(1).min_h(0).overflow_y_scroll().child(v_flex().px(30).pb(10).children(body)))
        .child(Scrollbar.vertical("settings-body").absolute().inset_0()))
      .child(h_flex().flex_none().gap(10).px(30).py(16).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(c.red).child(this.error ?? ""))
        .child(button(t, "settings-cancel", "Cancel", () => this.close()))
        .child(button(t, "settings-save", this.busy ? "Saving…" : "Save", (cx) => this.save(cx), { primary: true })));
    return v_flex().size_full().justify_center().child(card);
  }
}
