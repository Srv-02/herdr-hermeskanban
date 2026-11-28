// Task text comes from anyone who can reach an instance. The description renders as Markdown with raw HTML as text
// (TextView .raw_html(false)) and no image: safeMarkdown breaks every image opener, so no picture is ever fetched.
// A click opens a link only through safeLink (https only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeMarkdown, safeLink, shownId } from "../mods/hermes-kanban/lib/text.js";

const HOSTILE = [
  "![x](http://example.com/t.png)",
  "<img src=\"http://example.com/t.png\" onerror=\"x()\">",
  "[a](javascript:alert(1))",
  "[b](http://example.com)",
  "![r]\n\n[r]: https://e.com/t.png",
  "![a [b] c](https://e.com/t.png)",
  "![x](https://e.com/t.png 'single') ![y](https://e.com/u.png (paren))",
  "\\`![x](https://e.com/t.png)\\`",
  "<script>alert(1)</script><iframe src='http://example.com'></iframe>",
  "<a href=\"javascript:alert(1)\">x</a> &lt;img&gt; &amp;",
];

test("safeMarkdown: no image opener survives, also in code, escapes and references", () => {
  for (const input of [...HOSTILE, "```\n![x](https://e.com/t.png)\n```", "`![x](u)`", "\\![x](u)", "!![x](u)", "![![x](u)](v)", "- ```\n![x](u)"]) {
    assert.doesNotMatch(safeMarkdown(input), /!\[/, input);
  }
});

test("safeMarkdown: everything else reads as written", () => {
  const md = "## Problem\n\n`nas-synology` on **host**\n\n- a\n- b\n\n1. one\n2. two\n\n[link](https://example.com) ! [x]";
  assert.equal(safeMarkdown(md), md);
  assert.equal(safeMarkdown("a ![x](https://e.com/t.png) b"), "a !\u200B[x](https://e.com/t.png) b");
  assert.equal(safeMarkdown("one\r\ntwo"), "one\r\ntwo");
  assert.equal(safeMarkdown(null), "");
});

// A hostile body must not freeze the overlay.
test("safeMarkdown: a 200k-char input finishes in under 200 ms", () => {
  for (const input of ["![".repeat(100000), "!".repeat(200000), "`".repeat(200000)]) {
    const t0 = performance.now();
    safeMarkdown(input);
    assert.ok(performance.now() - t0 < 200, input.slice(0, 10));
  }
});

test("safeLink: https only", () => {
  assert.equal(safeLink("https://example.com/a"), "https://example.com/a");
  for (const u of ["http://example.com", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", " https://x", "", null]) assert.equal(safeLink(u), null, String(u));
});

test("shownId drops Hermes' t_ prefix only", () => {
  assert.equal(shownId("t_f070b12c"), "f070b12c");
  assert.equal(shownId("f070b12c"), "f070b12c");
  assert.equal(shownId("t_"), "t_");
  assert.equal(shownId("at_x"), "at_x");
  assert.equal(shownId(null), "");
});
