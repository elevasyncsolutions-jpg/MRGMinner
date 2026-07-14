"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readmePath = path.join(root, "README.md");
const packagePath = path.join(root, "package.json");

test("README is UTF-8 clean and matches package version badge", () => {
  const bytes = fs.readFileSync(readmePath);
  // reject UTF-8 BOM
  assert.notEqual(bytes[0], 0xef, "README must not start with UTF-8 BOM");
  const text = bytes.toString("utf8");
  assert.doesNotMatch(text, /â€|Â·|Ã.|â†|â†’|â€“|â€”|Â /, "README must not contain mojibake");
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assert.match(text, new RegExp(`version-${pkg.version.replace(/\./g, "\\.")}`));
  assert.match(text, /mrgminner version/);
  assert.match(text, /docs\/diagrams\/architecture\.svg/);
  assert.match(text, /docs\/diagrams\/workflow\.svg/);
  assert.match(text, /\.github\/workflows\/ci\.yml/);
  assert.ok(fs.existsSync(path.join(root, "docs/diagrams/architecture.svg")));
  assert.ok(fs.existsSync(path.join(root, "docs/diagrams/workflow.svg")));
  assert.ok(fs.existsSync(path.join(root, "docs/diagrams/architecture.html")));
  assert.ok(fs.existsSync(path.join(root, "docs/diagrams/workflow.html")));
});
