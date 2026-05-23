/**
 * 可选：在 `minecraft-data` 的 `supportedVersions.bedrock` 之外再合并进下拉与 `resolveBedrockVersion` 候选。
 * 这里补充 Mojang 已发布、但当前 npm 依赖尚未包含精确协议数据的小版本。
 * 选择这些版本时会回落到同主版本下 `minecraft-data` 已支持的最新协议数据。
 */
export const EXTRA_BEDROCK_VERSIONS: string[] = ["1.26.21", "1.26.23"];
