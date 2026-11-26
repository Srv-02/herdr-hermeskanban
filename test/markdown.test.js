// Task text comes from anyone who can reach an instance (an agent can take tasks from outside people). The overlay's
// Markdown never loads a remote image or renders raw HTML, and a link opens only on a click and only for https.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeMarkdown, safeLink } from "../mods/hermes-kanban/lib/markdown.js";

test("safeMarkdown: images become their alt text, never a picture or a link", () => {
  assert.equal(safeMarkdown("see ![x](http://example.com/t.png) here"), "see [image: x] here");
  assert.equal(safeMarkdown("![](https://example.com/t.png \"t\")"), "[image]");
  assert.equal(safeMarkdown("[![logo](https://example.com/l.png)](https://example.com)"), "[[image: logo]](https://example.com)");
  assert.equal(safeMarkdown("![ref][img]\n\n[img]: http://example.com/t.png"), "[image: ref]\n\n");
  assert.doesNotMatch(safeMarkdown("a ![x](http://example.com/t.png) b"), /example\.com/);
});

test("safeMarkdown: raw HTML goes, its text stays", () => {
  assert.equal(safeMarkdown("a <img src=\"http://example.com/t.png\" onerror=\"x()\"> b"), "a  b");
  assert.equal(safeMarkdown("<b>bold</b> and <script>alert(1)</script>"), "bold and alert(1)");
  assert.equal(safeMarkdown("<!-- hidden -->text"), "text");
  assert.doesNotMatch(safeMarkdown("<IMG SRC=x><iframe src='http://example.com'></iframe>"), /<|example/);
});

test("safeMarkdown: only https links stay links; others become their text", () => {
  assert.equal(safeMarkdown("[a](javascript:alert(1))"), "a");
  assert.equal(safeMarkdown("[b](http://example.com)"), "b");
  assert.equal(safeMarkdown("[c](https://example.com/x)"), "[c](https://example.com/x)");
  assert.equal(safeMarkdown("[d](  data:text/html,hi )"), "d");
  assert.equal(safeMarkdown("[e][r]\n[r]: javascript:alert(1)"), "e\n");
  assert.equal(safeMarkdown("<http://example.com>"), "http://example.com");
});

test("safeMarkdown: code stays as written (it is drawn as text)", () => {
  assert.equal(safeMarkdown("`<img src=x>` and\n```\n![x](http://example.com/t.png)\n```"), "`<img src=x>` and\n```\n![x](http://example.com/t.png)\n```");
  assert.equal(safeMarkdown(null), "");
});

test("safeLink: https only", () => {
  assert.equal(safeLink("https://example.com/a"), "https://example.com/a");
  for (const u of ["http://example.com", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", " https://x", "", null]) assert.equal(safeLink(u), null, String(u));
});
