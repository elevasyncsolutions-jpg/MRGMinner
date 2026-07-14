"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.resolve(__dirname, "../.github/workflows/ci.yml");

test("CI workflow runs tests on push and pull_request", () => {
  const workflow = fs.readFileSync(workflowPath, "utf8");

  assert.match(workflow, /name:\s*CI/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*-\s*master/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /node-version:\s*\[18,\s*20,\s*22\]/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /mrgminner\.js version/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
});
