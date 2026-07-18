"use strict";

const { describe, it, after, before } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const tls = require("node:tls");
const { startShare, mrgForBytes, earningsReport, DEFAULT_MRG_PER_GB } = require("../src/share");
const { generateDevCerts } = require("./generate-dev-certs");

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

  it("advertises every configured logical region with weights", async () => {
    const regionalHandle = await startShare({
      host: "127.0.0.1",
      port: 18010,
      socksPort: 18020,
      region: "vn",
      city: "Ho Chi Minh",
      exitId: "share-primary",
      workerId: "test:share",
      regions: "vn:Ho Chi Minh:70,sg:Singapore:30"
    });

    try {
      const exits = await fetch("http://127.0.0.1:18010/v1/exits").then((r) => r.json());
      assert.equal(exits.exits.length, 4);
      assert.deepEqual(
        exits.exits.map((exit) => [exit.id, exit.region, exit.city, exit.weight, exit.protocol]),
        [
          ["share-primary-vn-1", "vn", "Ho Chi Minh", 70, "socks5"],
          ["share-primary-vn-1-http", "vn", "Ho Chi Minh", 70, "http-connect"],
          ["share-primary-sg-2", "sg", "Singapore", 30, "socks5"],
          ["share-primary-sg-2-http", "sg", "Singapore", 30, "http-connect"]
        ]
      );
      assert.deepEqual(
        regionalHandle.getStats().advertised_regions.map((exit) => [exit.exit_id, exit.region, exit.weight]),
        [
          ["share-primary-vn-1", "vn", 70],
          ["share-primary-sg-2", "sg", 30]
        ]
      );
    } finally {
      await regionalHandle.stop();
    }
  });

  it("earnings report shape", () => {
    const r = earningsReport();
    assert.equal(r.stream, "bandwidth-share");
    assert.ok("mrg_earned_total" in r);
  });

  it("relays SOCKS5 through share server to a TCP echo", async () => {
    const echoPort = 18101;
    const controlPort = 18102;
    const socksPort = 18103;

    // 1. Start a TCP echo server
    const echoServer = net.createServer((sock) => {
      sock.on("data", (data) => sock.write(data));
    });
    await new Promise((resolve) => echoServer.listen(echoPort, "127.0.0.1", resolve));

    // 2. Start the share server (SOCKS5 proxy)
    const share = await startShare({
      host: "127.0.0.1",
      port: controlPort,
      socksPort,
      region: "vn",
      city: "Test City",
      workerId: "test:socks-relay"
    });

    try {
      // 3. Connect SOCKS5 client → share server → echo server
      const data = await new Promise((resolve, reject) => {
        const client = net.connect({ host: "127.0.0.1", port: socksPort }, () => {
          // SOCKS5 greeting: version=5, 1 auth method (no auth)
          client.write(Buffer.from([0x05, 0x01, 0x00]));
        });

        let buf = Buffer.alloc(0);
        client.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length === 2 && buf[0] === 0x05 && buf[1] === 0x00) {
            // Greeting accepted — send connect request
            // ATYP=0x01 (IPv4), 127.0.0.1, port=echoPort
            const req = Buffer.alloc(10);
            req[0] = 0x05; req[1] = 0x01; req[2] = 0x00;
            req[3] = 0x01;
            req[4] = 127; req[5] = 0; req[6] = 0; req[7] = 1;
            req.writeUInt16BE(echoPort, 8);
            client.write(req);
            buf = Buffer.alloc(0);
            return;
          }
          if (buf.length >= 10 && buf[0] === 0x05 && buf[1] === 0x00) {
            // Connect succeeded — send test payload
            const payload = Buffer.from("hello socks5 relay");
            client.write(payload);
            buf = Buffer.alloc(0);
            return;
          }
          if (buf.length > 0) {
            // Echo response received
            client.end();
            resolve(buf.toString("utf8"));
          }
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("SOCKS5 relay timeout")), 5000);
      });

      assert.equal(data, "hello socks5 relay");
    } finally {
      await share.stop();
      echoServer.close();
    }
  });

  it("falls back to plain SOCKS when no tls options provided", async () => {
    const h = await startShare({
      host: "127.0.0.1",
      port: 18200,
      socksPort: 18201,
      region: "us",
      city: "Test",
      workerId: "test:plain"
    });
    try {
      const stats = h.getStats();
      assert.equal(stats.socks_tls, false);
      assert.equal(stats.auth_token, false);
    } finally {
      await h.stop();
    }
  });

  it("creates TLS SOCKS server when tls options provided", async () => {
    const certs = generateDevCerts();
    let h;
    try {
      h = await startShare({
        host: "127.0.0.1",
        port: 18210,
        socksPort: 18211,
        region: "us",
        city: "TlsCity",
        workerId: "test:tls",
        tls: { key: certs.key, cert: certs.cert }
      });

      const echoPort = 18212;
      const echoServer = net.createServer((sock) => {
        sock.on("data", (data) => sock.write(data));
      });
      await new Promise((resolve) => echoServer.listen(echoPort, "127.0.0.1", resolve));

      try {
        const stats = h.getStats();
        assert.equal(stats.socks_tls, true);

        const data = await new Promise((resolve, reject) => {
          const client = tls.connect(
            { host: "127.0.0.1", port: 18211, rejectUnauthorized: false },
            () => {
              client.write(Buffer.from([0x05, 0x01, 0x00]));
            }
          );

          let buf = Buffer.alloc(0);
          client.on("data", (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (buf.length === 2 && buf[0] === 0x05 && buf[1] === 0x00) {
              const req = Buffer.alloc(10);
              req[0] = 0x05; req[1] = 0x01; req[2] = 0x00;
              req[3] = 0x01;
              req[4] = 127; req[5] = 0; req[6] = 0; req[7] = 1;
              req.writeUInt16BE(echoPort, 8);
              client.write(req);
              buf = Buffer.alloc(0);
              return;
            }
            if (buf.length >= 10 && buf[0] === 0x05 && buf[1] === 0x00) {
              const payload = Buffer.from("tls socks5 works");
              client.write(payload);
              buf = Buffer.alloc(0);
              return;
            }
            if (buf.length > 0) {
              client.end();
              resolve(buf.toString("utf8"));
            }
          });
          client.on("error", reject);
          setTimeout(() => reject(new Error("TLS SOCKS5 relay timeout")), 5000);
        });

        assert.equal(data, "tls socks5 works");
      } finally {
        echoServer.close();
      }
    } finally {
      if (h) await h.stop();
      certs.cleanup();
    }
  });

  it("allows anonymous SOCKS5 when no token configured", async () => {
    const h = await startShare({
      host: "127.0.0.1",
      port: 18220,
      socksPort: 18221,
      region: "us",
      city: "Anon",
      workerId: "test:anon"
    });
    try {
      const echoPort = 18222;
      const echoServer = net.createServer((sock) => {
        sock.on("data", (data) => sock.write(data));
      });
      await new Promise((resolve) => echoServer.listen(echoPort, "127.0.0.1", resolve));

      try {
        const data = await new Promise((resolve, reject) => {
          const client = net.connect({ host: "127.0.0.1", port: 18221 }, () => {
            client.write(Buffer.from([0x05, 0x01, 0x00]));
          });

          let buf = Buffer.alloc(0);
          client.on("data", (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            if (buf.length === 2 && buf[0] === 0x05 && buf[1] === 0x00) {
              const req = Buffer.alloc(10);
              req[0] = 0x05; req[1] = 0x01; req[2] = 0x00;
              req[3] = 0x01;
              req[4] = 127; req[5] = 0; req[6] = 0; req[7] = 1;
              req.writeUInt16BE(echoPort, 8);
              client.write(req);
              buf = Buffer.alloc(0);
              return;
            }
            if (buf.length >= 10 && buf[0] === 0x05 && buf[1] === 0x00) {
              const payload = Buffer.from("anonymous works");
              client.write(payload);
              buf = Buffer.alloc(0);
              return;
            }
            if (buf.length > 0) {
              client.end();
              resolve(buf.toString("utf8"));
            }
          });
          client.on("error", reject);
          setTimeout(() => reject(new Error("anonymous SOCKS5 timeout")), 5000);
        });

        assert.equal(data, "anonymous works");
      } finally {
        echoServer.close();
      }
    } finally {
      await h.stop();
    }
  });

  it("rejects SOCKS5 connections without token when token configured", async () => {
    const h = await startShare({
      host: "127.0.0.1",
      port: 18230,
      socksPort: 18231,
      region: "us",
      city: "TokenTest",
      workerId: "test:token",
      shareToken: "my-secret-token"
    });
    try {
      const rejected = await new Promise((resolve, reject) => {
        const client = net.connect({ host: "127.0.0.1", port: 18231 }, () => {
          client.write(Buffer.from([0x05, 0x01, 0x00]));
        });

        let buf = Buffer.alloc(0);
        client.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length === 2 && buf[0] === 0x05 && buf[1] === 0xFF) {
            resolve(true);
            client.end();
          }
        });
        client.on("error", () => resolve(true));
        client.on("close", () => resolve(true));
        setTimeout(() => reject(new Error("token rejection timeout")), 5000);
      });

      assert.equal(rejected, true);

      const authed = await new Promise((resolve, reject) => {
        const client = net.connect({ host: "127.0.0.1", port: 18231 }, () => {
          client.write(Buffer.from([0x05, 0x01, 0x02]));
        });

        let buf = Buffer.alloc(0);
        let stage = "greeting";
        client.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (stage === "greeting" && buf.length === 2 && buf[0] === 0x05 && buf[1] === 0x02) {
            const username = "user";
            const password = "my-secret-token";
            const auth = Buffer.alloc(3 + username.length + password.length);
            auth[0] = 0x01;
            auth[1] = username.length;
            auth.write(username, 2, "utf8");
            auth[2 + username.length] = password.length;
            auth.write(password, 3 + username.length, "utf8");
            client.write(auth);
            buf = Buffer.alloc(0);
            stage = "authed";
            return;
          }
          if (stage === "authed" && buf.length === 2 && buf[0] === 0x01 && buf[1] === 0x00) {
            resolve(true);
            client.end();
          }
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("token auth timeout")), 5000);
      });

      assert.equal(authed, true);
    } finally {
      await h.stop();
    }
  });
});
