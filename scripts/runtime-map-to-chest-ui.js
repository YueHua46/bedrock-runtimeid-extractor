/**
 * 将 runtime_map.js / runtime_map.json 转为 Chest-UI 可用的 typeIdToID 格式。
 * 用法: node scripts/runtime-map-to-chest-ui.js [runtime_map.js]
 * 输出: 可粘贴到 Chest-UI 的 typeIds.js 中替换 typeIdToID 的 Map 数组。
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2] || join(__dirname, "..", "runtime_map.js");

const raw = readFileSync(inputPath, "utf8");
const runtimeMap =
  inputPath.endsWith(".js")
    ? (() => {
        const match = raw.match(/export\s+const\s+runtimeMap\s*=\s*(\{[\s\S]*\})\s*;/);
        if (!match) throw new Error("runtime_map.js 中未找到 export const runtimeMap = {...};");
        return JSON.parse(match[1]);
      })()
    : JSON.parse(raw);

// 只保留带 "minecraft:" 的 key，避免重复；值必须是整数（Chest-UI typeIdToID 用整数）
const entries = Object.entries(runtimeMap)
  .filter(([k, v]) => typeof v === "number" && Number.isInteger(v) && k.startsWith("minecraft:"))
  .sort((a, b) => a[0].localeCompare(b[0]));

const lines = [
  "// 由 runtime_map.js 自动生成，供 Chest-UI typeIdToID 使用",
  "export const typeIdToID = new Map([",
  ...entries.map(([k, v]) => `  ['${k}', ${v}]`),
  "]);",
];

const out = join(__dirname, "..", "chest_ui_typeIdToID.js");
writeFileSync(out, lines.join("\n") + "\n", "utf8");
console.log(`已写入 ${out}，共 ${entries.length} 条（仅 minecraft: 且整数）`);
console.log("可将该文件内容合并到 Chest-UI 的 BP/scripts/extensions/typeIds.js 中替换 typeIdToID。");
