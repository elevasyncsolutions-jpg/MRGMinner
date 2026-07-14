"use strict";

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const { startShare, mrgForBytes, earningsReport, DEFAULT_MRG_PER_GB } = require("../src/share");

describe("share bandwidth stream", () => {
  let handle;

  after(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
  });

  it("computes mrg for bytes", () => {
    const oneGb = 1024 * 1024 * 1024;
    assert.equal(mrgForBytes(oneGb, 5), 5);
    assert.equal(DEFAULT_MRG_PER_GB, 5);
  });

  it("starts control plane and lists exits", async () => {
    handle = await startShare({
      host: "127.0.0.1",
      port: 17990,
      socksPort: 18000,
      region: "vn",
      city: "Test City",
      workerId: "test:share"
    });
    const health = await fetch("http://127.0.0.1:17990/v1/health").then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.role, "mrgminner-share");
    const exits = await fetch("http://127.0.0.1:17990/v1/exits").then((r) => r.json());
    assert.ok(Array.isArray(exits.exits));
    assert.ok(exits.exits.length >= 1);
    assert.equal(exits.exits[0].residential, true);
    const stats = handle.getStats();
    assert.equal(stats.stream, "bandwidth-share");
    assert.ok(typeof stats.mrg_earned_session === "number");
  });

  it("earnings report shape", () => {
    const r = earningsReport();
    assert.equal(r.stream, "bandwidth-share");
    assert.ok("mrg_earned_total" in r);
  });
});
