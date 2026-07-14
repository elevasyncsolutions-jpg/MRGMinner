"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readPackageInfo, versionCommand } = require("../src/cli");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "package.json");
const cliBin = path.join(root, "bin", "mrgminner.js");

test("readPackageInfo matches package.json version", () => {
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const info = readPackageInfo();
  assert.equal(info.name, "mrgminner");
  assert.equal(info.displayName, "MRGMinner");
  assert.equal(info.version, pkg.version);
  assert.match(info.version, /^\d+\.\d+\.\d+$/);
});

test("versionCommand returns structured payload", () => {
  const payload = versionCommand({ json: true });
  assert.equal(payload.displayName, "MRGMinner");
  assert.match(payload.version, /^\d+\.\d+\.\d+$/);
  assert.equal(payload.node, process.version);
  assert.equal(payload.platform, process.platform);
  assert.equal(payload.arch, process.arch);
});

test("CLI version --json prints package version", () => {
  const result = spawnSync(process.execPath, [cliBin, "version", "--json"], {
    encoding: "utf8",
    cwd: root
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  assert.equal(payload.version, pkg.version);
  assert.equal(payload.name, "mrgminner");
});
