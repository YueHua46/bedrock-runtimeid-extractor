// 从 Bedrock 服务器提取运行时物品映射（CLI 入口）
import { writeFileSync } from "fs";
import {
  extractRuntimeMap,
  resolveBedrockVersion,
  runtimeMapToJsContent,
} from "./lib/extract";

if (process.argv.length < 5) {
  console.error("用法: node index.ts <host> <port> <bedrock_version_tag>");
  console.error(
    "版本标签示例: bedrock_1.26.0、bedrock_1.20.71、bedrock_1.19.50（参见 prismarine-registry 文档）",
  );
  process.exit(1);
}

const [, , host, portStr, versionTag] = process.argv;
const port = Number(portStr);
const resolvedTag = resolveBedrockVersion(versionTag as string);

(async () => {
  try {
    const typeToRuntime = await extractRuntimeMap(
      host,
      port,
      versionTag as string,
    );
    const content = runtimeMapToJsContent(typeToRuntime);
    writeFileSync("runtime_map.js", content, "utf8");
    console.log(
      "已写入 runtime_map.js — 条目数:",
      Object.keys(typeToRuntime).length,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  }
})();
