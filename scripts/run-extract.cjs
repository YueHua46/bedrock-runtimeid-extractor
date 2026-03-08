// 设置 NODE_OPTIONS 再启动 tsx，使子进程也关闭 deprecation 警告（如 punycode）
const path = require("path");
const { spawnSync } = require("child_process");

const opts = process.env.NODE_OPTIONS || "";
process.env.NODE_OPTIONS = opts.includes("--no-deprecation") ? opts : opts + " --no-deprecation".trim();

const tsxCli = path.join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs");
const indexTs = path.join(__dirname, "..", "index.ts");
const args = [tsxCli, indexTs, ...process.argv.slice(2)];

const r = spawnSync(process.execPath, args, {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
  env: process.env,
});
process.exit(r.status ?? 1);
