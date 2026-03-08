// 从 Bedrock 服务器提取 runtimeMap 的核心逻辑（可被 CLI 与 Web 共用）
import { createClient, ping } from "bedrock-protocol";
import Registry from "prismarine-registry";
import minecraftData from "minecraft-data";

/** 从 ping 得到的服务器公告（版本、协议号等） */
export type ServerAdvertisement = {
  version?: string;
  protocol?: number;
  motd?: string;
  levelName?: string;
};

const supportedBedrock = (
  minecraftData as { supportedVersions?: { bedrock?: string[] } }
).supportedVersions?.bedrock;

/** 若传入版本不存在，尝试用同主版本下已支持的最新版本 */
export function resolveBedrockVersion(tag: string): string {
  if (tag.startsWith("bedrock_")) {
    const ver = tag.slice("bedrock_".length);
    if (minecraftData(tag)) return tag;
    const major = ver.split(".").slice(0, 2).join(".");
    const candidates = (supportedBedrock || [])
      .filter((v) => v.startsWith(major + ".") || v === major)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const fallback = candidates[0];
    if (fallback) return "bedrock_" + fallback;
  }
  return tag;
}

/** 将 runtimeMap 对象序列化为 runtime_map.js 的完整脚本内容 */
export function runtimeMapToJsContent(
  typeToRuntime: Record<string, number>,
): string {
  return (
    "export const runtimeMap = " +
    JSON.stringify(typeToRuntime, null, 2) +
    ";\n"
  );
}

/**
 * 先 ping 获取服务器公告（游戏版本、协议号），失败返回 null。
 */
export async function fetchServerAdvertisement(
  host: string,
  port: number,
): Promise<ServerAdvertisement | null> {
  try {
    const ad = await ping({ host, port });
    return {
      version: ad.version,
      protocol: ad.protocol,
      motd: ad.motd,
      levelName: ad.levelName,
    };
  } catch {
    return null;
  }
}

/**
 * 从服务器版本字符串中提取主版本号（如 "1.21.1 ck_1.21.132" 中取 1.21.132）。
 * 协议里可能带 MOTD/levelName，只取看起来像 x.y.z 的段，多段时取第三段最大的。
 */
function parseServerVersionString(
  serverVersion: string | undefined,
): string | null {
  if (!serverVersion) return null;
  const matches = serverVersion.match(/\d+\.\d+\.\d+/g);
  if (!matches?.length) return null;
  if (matches.length === 1) return matches[0];
  const sorted = [...matches].sort((a, b) => {
    const [a1, a2, a3] = a.split(".").map(Number);
    const [b1, b2, b3] = b.split(".").map(Number);
    if (a1 !== b1) return b1 - a1;
    if (a2 !== b2) return b2 - a2;
    return (b3 ?? 0) - (a3 ?? 0);
  });
  return sorted[0];
}

/**
 * 根据服务器游戏版本得到「建议且可用」的 bedrock_ 版本标签。
 * minecraft-data 没有每个小版本（如 1.21.132），会解析为同主版本下已支持的最新版（如 bedrock_1.21.130）。
 */
export function suggestedVersionTag(
  serverVersion: string | undefined,
): string | null {
  const parsed = parseServerVersionString(serverVersion);
  if (!parsed) return null;
  return resolveBedrockVersion("bedrock_" + parsed);
}

/** 若服务器版本与解析后不一致（无精确协议数据），返回解析后的数字版本，便于提示 */
export function resolvedServerVersion(
  serverVersion: string | undefined,
): string | null {
  const parsed = parseServerVersionString(serverVersion);
  if (!parsed) return null;
  const tag = resolveBedrockVersion("bedrock_" + parsed);
  return tag ? tag.replace(/^bedrock_/, "") : null;
}

/**
 * 连接服务器并提取 itemstates，返回 物品名 -> runtime id 的映射。
 * 会先 ping 获取服务器版本并打印提示；失败时 reject 并带上可读错误信息（含目标服务器版本建议）。
 */
export async function extractRuntimeMap(
  host: string,
  port: number,
  versionTag: string,
): Promise<Record<string, number>> {
  const serverAd = await fetchServerAdvertisement(host, port);
  const suggestedTag = suggestedVersionTag(serverAd?.version);
  const resolvedServerVer = resolvedServerVersion(serverAd?.version);
  const parsedRaw = parseServerVersionString(serverAd?.version);
  const hasExact =
    parsedRaw && resolvedServerVer && parsedRaw === resolvedServerVer;

  if (serverAd?.version) {
    let msg = `目标服务器 ${host}:${port} — 游戏版本: ${serverAd.version}，协议号: ${serverAd.protocol ?? "(未知)"}。建议使用: ${suggestedTag ?? "(见下方错误提示)"}`;
    if (suggestedTag && !hasExact && resolvedServerVer)
      msg += ` （${parsedRaw ?? serverAd.version} 无精确协议数据，已解析为可用的 ${resolvedServerVer}）`;
    console.log(msg);
  } else {
    console.log(
      `目标服务器 ${host}:${port} — 无法获取版本（ping 失败或超时），将使用传入的版本尝试连接。`,
    );
  }

  const resolvedTag = resolveBedrockVersion(versionTag);
  const registry = Registry(resolvedTag);
  const connectVersion = resolvedTag.replace(/^bedrock_/, "");
  const client = createClient({
    host,
    port,
    version:
      connectVersion as import("bedrock-protocol").ClientOptions["version"],
    username: "runtime_extractor_bot",
    offline: true,
  });

  return new Promise((resolve, reject) => {
    function finishWithItemstates(
      packet: Record<string, unknown>,
      itemstates: unknown[],
    ) {
      const bedrockRegistry = registry as {
        handleStartGame: (p: Record<string, unknown>) => void;
        itemsByName: { [name: string]: { id: number } };
      };
      bedrockRegistry.handleStartGame({ ...packet, itemstates });

      const typeToRuntime: Record<string, number> = {};
      for (const [name, item] of Object.entries(registry.itemsByName)) {
        typeToRuntime[name] = item.id;
        if (!name.includes(":")) typeToRuntime["minecraft:" + name] = item.id;
      }
      client.close();
      resolve(typeToRuntime);
    }

    let pendingStartGame: Record<string, unknown> | null = null;

    client.on("start_game", (packet: Record<string, unknown>) => {
      const itemstates =
        (packet.itemstates as unknown[] | undefined) ||
        (packet.itemStates as unknown[] | undefined) ||
        (packet.itemStatesArray as unknown[] | undefined) ||
        (packet.itemstatesArray as unknown[] | undefined);

      if (itemstates && itemstates.length > 0) {
        finishWithItemstates(packet, itemstates);
        return;
      }
      pendingStartGame = packet;
    });

    client.on(
      "packet",
      (des: { data: { name: string; params?: Record<string, unknown> } }) => {
        if (des.data?.name !== "item_registry") return;
        const itemstates = des.data.params?.itemstates as unknown[] | undefined;
        if (!itemstates?.length) return;
        const packet = pendingStartGame ?? {};
        finishWithItemstates(packet, itemstates);
      },
    );

    client.on("kick", (packet: Record<string, unknown>) => {
      const reason = (packet.reason as string) || "";
      const msg = (packet.message as string) || "";
      const display = msg || reason || "服务器未提供原因";
      const hide = packet.hide_disconnect_reason === true;
      const isNotAuth =
        hide ||
        /not_authenticated|notAuthenticated|not.*authenticated|login|sign.?in/i.test(
          reason,
        ) ||
        /notAuthenticated|not.*authenticated|login|sign.?in/i.test(msg) ||
        (msg as string).includes("disconnectionScreen");
      const isOutdatedServer =
        /outdated_server/i.test(reason) || /outdated_server/i.test(msg);
      const isOutdatedClient =
        /outdated_client/i.test(reason) || /outdated_client/i.test(msg);
      let hint = "";
      if (isNotAuth)
        hint =
          " 请将 server.properties 中 online-mode 设为 false 后重启服务器。";
      else if (isOutdatedServer)
        hint =
          suggestedTag && serverAd?.version
            ? ` 目标服务器版本: ${serverAd.version}，请使用: ${suggestedTag}${!hasExact && resolvedServerVer ? `（${parsedRaw ?? ""} 无精确协议数据，已解析为可用的 ${resolvedServerVer}）` : ""}`
            : " 协议版本比服务器新，请用与服务器一致的 bedrock_ 版本重试（向服主确认版本）。";
      else if (isOutdatedClient)
        hint =
          suggestedTag && serverAd?.version
            ? ` 目标服务器版本: ${serverAd.version}，若仍报错可尝试更高版本，例如: bedrock_1.26.0。`
            : " 协议版本比服务器旧，请用更新的版本标签重试，例如: bedrock_1.26.0。";
      reject(
        new Error("服务器断开: " + (hide ? "[不显示原因]" : display) + hint),
      );
    });

    client.on("error", (e: Error) => {
      reject(new Error("连接错误: " + (e.message || String(e))));
    });
  });
}
