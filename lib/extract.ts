// 从 Bedrock 服务器提取 runtimeMap 的核心逻辑（可被 CLI 与 Web 共用）
import { createClient, ping } from "bedrock-protocol";
import Registry from "prismarine-registry";
import minecraftData from "minecraft-data";
import { EXTRA_BEDROCK_VERSIONS } from "./extra-bedrock-versions";

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

/**
 * 游戏内/ping 常见写法 → minecraft-data 数据目录名（mc-data 3.109+ 中 1.26.10 使用 `26.10`，协议 944）。
 */
const BEDROCK_GAME_VERSION_TO_DATA_KEY: Record<string, string> = {
  "1.26.10": "26.10",
};

function mergedBedrockVersionKeys(): string[] {
  return [...new Set([...(supportedBedrock ?? []), ...EXTRA_BEDROCK_VERSIONS])];
}

/** ping 解析的版本号是否与 resolve 后的 mc-data 版本名等价（含 1.26.10 ↔ 26.10） */
function parsedMatchesResolvedData(
  parsed: string | null,
  resolvedNoPrefix: string | null,
): boolean {
  if (!parsed || !resolvedNoPrefix) return false;
  if (parsed === resolvedNoPrefix) return true;
  return BEDROCK_GAME_VERSION_TO_DATA_KEY[parsed] === resolvedNoPrefix;
}

/** 统一成 `bedrock_x.y.z`，便于和 `resolveBedrockVersion` 的结果比较 */
export function normalizeBedrockTagInput(tag: string): string {
  const t = tag.trim();
  return t.startsWith("bedrock_") ? t : `bedrock_${t}`;
}

/** 若传入版本不存在，尝试用同主版本下已支持的最新版本 */
export function resolveBedrockVersion(tag: string): string {
  if (tag.startsWith("bedrock_")) {
    const ver = tag.slice("bedrock_".length);
    const mappedKey = BEDROCK_GAME_VERSION_TO_DATA_KEY[ver];
    if (mappedKey) {
      const mappedTag = "bedrock_" + mappedKey;
      if (minecraftData(mappedTag)) return mappedTag;
    }
    if (minecraftData(tag)) return tag;
    const major = ver.split(".").slice(0, 2).join(".");
    const candidates = mergedBedrockVersionKeys()
      .filter((v) => v.startsWith(major + ".") || v === major)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const c of candidates) {
      const t = "bedrock_" + c;
      if (minecraftData(t)) return t;
    }
  }
  return tag;
}

/** ping 到的 x.y.z 是否在手动补充列表中（用于提示语：视为已配置的兼容版本） */
export function isUserListedBedrockVersion(parsedXyz: string | null): boolean {
  return Boolean(parsedXyz && EXTRA_BEDROCK_VERSIONS.includes(parsedXyz));
}

/** Bedrock disconnect 包里 DisconnectFailReason 为数值时的常见码（与 mc-data 1.26 protocol 一致，仅用于可读性） */
const DISCONNECT_REASON_KNOWN: Record<number, string> = {
  34: "outdated_server",
  35: "outdated_client",
  46: "not_authenticated",
};

function disconnectReasonForDisplay(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (typeof reason === "number")
    return DISCONNECT_REASON_KNOWN[reason] ?? `DisconnectFailReason#${reason}`;
  if (reason == null) return "";
  return String(reason);
}

function kickMatches(
  reason: unknown,
  message: string,
  re: RegExp,
): boolean {
  const r = disconnectReasonForDisplay(reason);
  return re.test(r) || re.test(String(reason)) || re.test(message);
}

/** 组装断开连接的完整可读错误（含 disconnect 包字段与本地连接上下文） */
function formatKickError(options: {
  packet: Record<string, unknown>;
  hideDisconnectScreen: boolean;
  userFacingText: string;
  hint: string;
  versionTag: string;
  resolvedTag: string;
  connectVersion: string;
  serverAd: ServerAdvertisement | null;
}): string {
  const p = options.packet;
  const reasonRaw = p.reason;
  const message = (p.message as string) || "";
  const filtered = (p.filtered_message as string) || "";
  const hide = p.hide_disconnect_reason === true;
  const reasonLine = disconnectReasonForDisplay(reasonRaw);
  const head = options.hideDisconnectScreen
    ? "服务器断开: [hide_disconnect_reason=true，服务端未下发 message]"
    : `服务器断开: ${options.userFacingText}`;

  const packetBits: string[] = [];
  packetBits.push(
    `DisconnectFailReason(raw)=${JSON.stringify(reasonRaw)}` +
      (reasonLine && String(reasonRaw) !== reasonLine
        ? `（可读: ${reasonLine}）`
        : ""),
  );
  packetBits.push(`hide_disconnect_reason=${hide}`);
  if (message) packetBits.push(`message=${JSON.stringify(message)}`);
  if (filtered && filtered !== message)
    packetBits.push(`filtered_message=${JSON.stringify(filtered)}`);

  const unknownKeys = Object.keys(p).filter(
    (k) =>
      ![
        "reason",
        "message",
        "filtered_message",
        "hide_disconnect_reason",
      ].includes(k),
  );
  for (const k of unknownKeys) {
    try {
      packetBits.push(`${k}=${JSON.stringify(p[k])}`);
    } catch {
      packetBits.push(`${k}=(无法序列化)`);
    }
  }

  const lines = [
    head,
    "断开包: " + packetBits.join(" | "),
    `本工具: 选用标签=${options.versionTag} | 解析后 Registry/协议=${options.resolvedTag} | createClient.version=${options.connectVersion}`,
  ];
  const ad = options.serverAd;
  if (ad?.version ?? ad?.protocol != null) {
    lines.push(
      `服务器 ping: 游戏版本=${ad.version ?? "(无)"} | 协议号=${ad.protocol ?? "(无)"}`,
    );
  }
  const h = options.hint.trim();
  if (h) lines.push("处理建议: " + h);
  return lines.join("\n");
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
  const userListed = isUserListedBedrockVersion(parsedRaw);
  const hasExact =
    Boolean(parsedRaw && resolvedServerVer && parsedRaw === resolvedServerVer) ||
    parsedMatchesResolvedData(parsedRaw, resolvedServerVer) ||
    (userListed && Boolean(resolvedServerVer));

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
  const requestedTag = normalizeBedrockTagInput(versionTag);
  const connectVersion = resolvedTag.replace(/^bedrock_/, "");
  if (requestedTag !== resolvedTag) {
    const inMcData = Boolean(minecraftData(requestedTag));
    console.log(
      `版本回落: 你选择的是 ${requestedTag}，但本地 minecraft-data ${inMcData ? "未通过校验" : "没有这一档的协议/注册表数据"}，因此无法在握手时使用该标签。` +
        `resolveBedrockVersion 已改为实际用于 Registry 与 createClient 的 ${resolvedTag}（游戏版本号 ${connectVersion}）。` +
        `在「额外版本」里填写 1.26.10 只会出现在下拉候选里，不会向 npm 包装进 1.26.10 的协议定义；要消除 outdated_client 需升级 bedrock-protocol / minecraft-data 等，直至 ${requestedTag} 在库里可用。`,
    );
  }
  const registry = Registry(resolvedTag);
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
      const reason = packet.reason;
      const reasonStr = disconnectReasonForDisplay(reason);
      const msg = (packet.message as string) || "";
      const display =
        msg || reasonStr || (reason != null ? String(reason) : "") || "服务器未提供原因";
      const hide = packet.hide_disconnect_reason === true;
      const isNotAuth =
        hide ||
        kickMatches(reason, msg, /not_authenticated|notAuthenticated/i) ||
        /login|sign.?in/i.test(msg) ||
        msg.includes("disconnectionScreen");
      const isOutdatedServer = kickMatches(reason, msg, /outdated_server/i);
      const isOutdatedClient = kickMatches(reason, msg, /outdated_client/i);
      let hint = "";
      if (isNotAuth)
        hint =
          "请将 server.properties 中 online-mode 设为 false 后重启服务器。";
      else if (isOutdatedServer)
        hint =
          suggestedTag && serverAd?.version
            ? `目标服务器游戏版本 ${serverAd.version}，建议匹配协议: ${suggestedTag}${!hasExact && resolvedServerVer ? `（${parsedRaw ?? ""} 无精确 mc-data，已回落到 ${resolvedServerVer}）` : ""}。若仍断开说明当前 bedrock-protocol 与服务器协议不一致，请降级/升级依赖或换用与服主一致的版本标签。`
            : "协议版本相对服务器过新。请选择与服务器一致的 bedrock_ 版本，或向服主确认协议版本。";
      else if (isOutdatedClient) {
        const proto = serverAd?.protocol;
        const reqT = normalizeBedrockTagInput(versionTag);
        hint =
          `outdated_client：服务器认为你提交的协议版本偏旧。本工具发出的登录协议由 createClient.version=${connectVersion}（即 ${resolvedTag}）决定，不是由下拉里看到的「${reqT}」字样单独决定。`;
        if (reqT !== resolvedTag) {
          hint += ` 你选了 ${reqT}，但本地无 mc-data，已在 resolveBedrockVersion 中回落到 ${resolvedTag}，所以握手仍是旧协议；`;
        }
        if (proto != null) hint += ` 服务器 ping 协议号为 ${proto}。`;
        hint +=
          " 解决办法：升级依赖直至 `minecraft-data` 中存在可用的 `bedrock_1.26.10`（且 bedrock-protocol 支持对应 protocol_version），届时 resolve 将不再落到 1.26.0。";
      } else hint = "请根据上方 DisconnectFailReason / message 与服务器日志进一步排查。";

      reject(
        new Error(
          formatKickError({
            packet,
            hideDisconnectScreen: hide,
            userFacingText: display,
            hint,
            versionTag,
            resolvedTag,
            connectVersion,
            serverAd,
          }),
        ),
      );
    });

    client.on("error", (e: Error) => {
      reject(new Error("连接错误: " + (e.message || String(e))));
    });
  });
}
