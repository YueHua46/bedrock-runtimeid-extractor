// Web 服务：提供版本列表、提取 API，并托管前端静态页
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import minecraftData from "minecraft-data";
import { extractRuntimeMap, runtimeMapToJsContent } from "./lib/extract";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function getBedrockVersions(): string[] {
  const versions = (
    minecraftData as { supportedVersions?: { bedrock?: string[] } }
  ).supportedVersions?.bedrock;
  return versions ?? [];
}

function send(
  res: import("http").ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain; charset=utf-8",
) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function sendJson(
  res: import("http").ServerResponse,
  status: number,
  data: unknown,
) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const pathname = url.split("?")[0];

  // GET /api/versions -> 可用 Bedrock 版本列表（带 bedrock_ 前缀）
  if (pathname === "/api/versions" && req.method === "GET") {
    const versions = getBedrockVersions();
    sendJson(res, 200, { bedrock: versions.map((v) => "bedrock_" + v) });
    return;
  }

  // POST /api/extract -> 提取 runtimeMap，返回完整 JS 脚本内容
  if (pathname === "/api/extract" && req.method === "POST") {
    const body = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
    let payload: { host?: string; port?: number; versionTag?: string };
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(res, 400, { ok: false, error: "请求体必须是 JSON" });
      return;
    }
    const host = String(payload.host ?? "").trim() || "127.0.0.1";
    const port = Number(payload.port);
    const versionTag = String(payload.versionTag ?? "").trim();
    if (!port || port < 1 || port > 65535) {
      sendJson(res, 400, { ok: false, error: "端口无效（1–65535）" });
      return;
    }
    if (!versionTag) {
      sendJson(res, 400, { ok: false, error: "请选择 Bedrock 版本" });
      return;
    }
    try {
      const typeToRuntime = await extractRuntimeMap(host, port, versionTag);
      const content = runtimeMapToJsContent(typeToRuntime);
      sendJson(res, 200, {
        ok: true,
        content,
        count: Object.keys(typeToRuntime).length,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sendJson(res, 200, { ok: false, error: message });
    }
    return;
  }

  // 静态文件：默认 index.html
  let filePath = join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (
    !existsSync(filePath) ||
    (pathname !== "/" && !filePath.startsWith(PUBLIC_DIR))
  ) {
    filePath = join(PUBLIC_DIR, "index.html");
  }
  if (!existsSync(filePath)) {
    send(res, 404, "Not Found");
    return;
  }
  const content = readFileSync(filePath, "utf8");
  const mime = MIME[extname(filePath)] ?? "application/octet-stream";
  send(res, 200, content, mime);
});

const DEFAULT_PORT = 37800;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error("端口 " + PORT + " 已被占用。");
    console.error("可先关闭占用该端口的程序，或改用其他端口，例如：");
    console.error("  PowerShell: $env:PORT=3781; bun run server");
    console.error("  CMD:        set PORT=3781 && bun run server");
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log("Bedrock Runtime Extractor 已启动: http://localhost:" + PORT);
});
