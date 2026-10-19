"use strict";

const fs = require("node:fs");
const path = require("node:path");

const userAgent = process.env.npm_config_user_agent ?? "";
if (!/^pnpm\/\d+(?:\.\d+){0,2}(?:\s|$)/i.test(userAgent)) {
  console.error("This workspace uses pnpm. Install dependencies with pnpm.");
  process.exit(1);
}

const workspaceRoot = path.resolve(__dirname, "..");
for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  fs.rmSync(path.join(workspaceRoot, lockfile), { force: true });
}
