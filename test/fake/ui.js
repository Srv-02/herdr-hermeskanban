// A stand-in for gpui-kit and gpui-base in node --test (test/flows.test.js): every element is a chainable proxy that
// keeps its id, its text children and its click handler, so a test can draw a view, read it and click by element id.
const ui = globalThis.__hkUI ??= { clicks: new Map() };

function el() {
  const node = { id: null, click: null, children: [] };
  const proxy = new Proxy(node, {
    get(_target, prop) {
      if (prop === "__node") return node;
      if (prop === "then") return undefined;
      return (...args) => {
        if (prop === "id") { node.id = args[0]; if (node.click) ui.clicks.set(node.id, node.click); }
        else if (prop === "on_click") { node.click = args[0]; if (node.id) ui.clicks.set(node.id, node.click); }
        else if (prop === "child") node.children.push(args[0]);
        else if (prop === "children") node.children.push(...args[0]);
        else if (prop === "when" && args[0]) return args[1](proxy);
        return proxy;
      };
    },
  });
  return proxy;
}

// All text of a drawn tree, in order.
export function textOf(tree) {
  if (tree == null || tree === false) return [];
  if (typeof tree === "string") return [tree];
  return (tree.__node?.children ?? []).flatMap(textOf);
}

export const div = () => el();
export const svg = () => el();
export const v_flex = () => el();
export const h_flex = () => el();
export const Scrollbar = { vertical: () => el() };
export class View {}

// Text fields: a value the test sets, handlers it can fire.
class FieldState {
  static new() { return new this(); }
  constructor() { this.text = ""; this.handlers = {}; }
  value() { return this.text; }
  set_value(v) { this.text = v; }
  on(name, fn) { this.handlers[name] = fn; }
  focus() {} blur() {} set_auto_grow() {}
}
export class InputState extends FieldState {}
export class TextareaState extends FieldState {}
export const Input = { new: () => el() };
export const Textarea = { new: () => el() };
