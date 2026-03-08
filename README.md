# bedrock-runtime-extractor

从 Bedrock 服务器提取 `runtimeMap`（物品/方块名 → runtime id），用于箱子 UI 等映射。映射数据来自服务器下发的 **itemstates**，因此天然包含原版 + 所有 addon 物品。

## 安装

```bash
bun install
# 或
npm install
```

若在 Linux 上运行 `npm run server` 时出现 **Could not locate the bindings file**（找不到 `node-raknet.node`），是因为依赖 `bedrock-protocol` 默认使用 C++ 原生模块 `raknet-native`，而当前环境没有可用的预编译二进制（例如 Node 24 或部分 Linux 发行版）。本仓库已通过 `patches/` 做了修复：在无法加载 `raknet-native` 时会自动改用纯 JS 实现 `jsp-raknet`，无需单独安装编译工具。若你希望使用原生实现以获取更好性能，可安装构建依赖后执行 `npm rebuild raknet-native`（需 Node 18/20 等有预编译的版本或本机有 g++/make）。

## 用法

```bash
bun run index.ts <host> <port> <bedrock_version_tag>
# 示例
bun run index.ts 127.0.0.1 19132 bedrock_1.26.0
```

生成文件为项目根目录下的 `runtime_map.js`。

## 网页版（推荐）

在浏览器里配置 IP、端口、版本，在线提取并一键复制 `runtime_map.js` 内容：

```bash
bun run server
# 或
npm run server
```

浏览器打开 http://localhost:37800，填写服务器地址与 Bedrock 版本后点击「提取 runtimeMap」，在页面中预览并点击「复制全部内容」即可粘贴替换旧 map。

## 本地存档、带 addon 时怎么拿 runtimeMap？

完整 itemstates（原版 + addon）**只会在加入服务器时由服务端下发**，游戏不会把这份表写到存档或安装目录里，addon 的 runtime id 也是进游戏时动态分配的，无法从静态文件复现。

因此：若你玩的是**本地单人存档且装了很多 addon**，需要和服务器一样拿到完整映射，唯一可靠做法是：

1. 在本机起一个 **同版本** Bedrock 服务端；
2. 把和本地存档**相同的 behavior pack / addon** 放进该服务器的 `behavior_packs`（或世界配置里挂上）；
3. 启动服务器后，用本工具连本机：
   ```bash
   bun run index.ts 127.0.0.1 19132 bedrock_1.26.0
   ```
4. 得到的 `runtime_map.js` 即包含该服（亦即你 addon 组合）下的全部物品 runtime id。

不连服务器、仅用静态表（如 minecraft-data）无法兼容 addon，故本仓库不提供“离线生成”模式。
