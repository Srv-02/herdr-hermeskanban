// Task text comes from anyone who can reach an instance. The overlay draws it as plain text: every character escaped,
// line breaks kept, and only bare https URLs as links (opened on a click, https only). No Markdown, no raw HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainHtml, linkify, safeLink } from "../mods/hermes-kanban/lib/text.js";

// The only markup plainHtml may produce: line breaks and https links it made itself.
const tags = (html) => [...html.matchAll(/<[^>]*>/g)].map((m) => m[0]);
const onlyOurTags = (html) => tags(html).every((x) => x === "<br>" || x === "</a>" || /^<a href="https:\/\/[^"<>\s]+">$/.test(x));

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

test("plainHtml: hostile Markdown and HTML stay literal text, no image, no non-https link", () => {
  for (const input of HOSTILE) {
    const html = plainHtml(input);
    assert.ok(onlyOurTags(html), `${input} -> ${html}`);
    assert.doesNotMatch(html, /<img|<script|<iframe|javascript:[^<]*">|href="http:/i, input);
  }
});

test("plainHtml: the text reads as written", () => {
  assert.equal(plainHtml("![x](http://example.com/t.png)"), "![x](http://example.com/t.png)");
  assert.equal(plainHtml("<img src=x> & \"q\" 'a'"), "&lt;img src=x&gt; &amp; &quot;q&quot; &#39;a&#39;");
  assert.equal(plainHtml("[a](javascript:alert(1))"), "[a](javascript:alert(1))");
  assert.equal(plainHtml("one\ntwo\r\n\nthree"), "one<br>two<br><br>three");
  assert.equal(plainHtml("a  b\tc"), "a &nbsp;b &nbsp;c");
  assert.equal(plainHtml(null), "");
});

test("plainHtml: bare https URLs become links, trailing punctuation stays text", () => {
  assert.equal(plainHtml("see https://example.com/a?b=1&c=2."), "see <a href=\"https://example.com/a?b=1&amp;c=2\">https://example.com/a?b=1&amp;c=2</a>.");
  assert.equal(plainHtml("(https://example.com/x)"), "(<a href=\"https://example.com/x\">https://example.com/x</a>)");
  assert.equal(plainHtml("http://example.com stays text"), "http://example.com stays text");
  assert.equal(plainHtml("\\`![x](https://e.com/t.png)\\`"), "\\`![x](<a href=\"https://e.com/t.png\">https://e.com/t.png</a>)\\`");
  assert.equal(plainHtml("![x](https://e.com/t.png)"), "![x](<a href=\"https://e.com/t.png\">https://e.com/t.png</a>)");
});

test("linkify: text and https URLs in order", () => {
  assert.deepEqual(linkify("a https://example.com/x, b"), [{ text: "a " }, { url: "https://example.com/x" }, { text: ", b" }]);
  assert.deepEqual(linkify(""), []);
});

test("safeLink: https only", () => {
  assert.equal(safeLink("https://example.com/a"), "https://example.com/a");
  for (const u of ["http://example.com", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", " https://x", "", null]) assert.equal(safeLink(u), null, String(u));
});
