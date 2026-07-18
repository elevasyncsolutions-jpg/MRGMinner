"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function generateDevCerts() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrg-test-certs-"));
  const keyPath = path.join(tmpDir, "dev-key.pem");
  const certPath = path.join(tmpDir, "dev-cert.pem");

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`,
    { stdio: "pipe" }
  );

  return {
    key: fs.readFileSync(keyPath, "utf8"),
    cert: fs.readFileSync(certPath, "utf8"),
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
      }
    }
  };
}

module.exports = { generateDevCerts };
