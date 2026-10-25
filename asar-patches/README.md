# asar-patches

给 `app.asar` 打的两个本地补丁，做成了**规则 + 工具**的形态，而不是一次性手改：

| 补丁 | 目标条目 | 作用 | 人类可读的 diff |
|---|---|---|---|
| `01-open-in-app-vscode-env` | `dsh/node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js` | 启动外部编辑器前丢掉外壳注入的 `ELECTRON_RUN_AS_NODE`，否则 VS Code 以 Node 模式启动、把工作区当脚本执行、Open In 失败 | [review/01…diff](review/01-open-in-app-vscode-env.diff) |
| `02-open-in-app-typora` | 同上 + `dsh/node_modules/@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js` | 目录 Open In 里加 Typora，并用新的持久化键把它设为默认 | [review/02…diff](review/02-open-in-app-typora.diff) |

为什么要做成这样：App 每次更新都会替换整个 `app.asar`，手改的字节会全部丢失；而这两个包在当前的源码 checkout（0.1.1-rc.2）里**并不存在**，没有地方可以“正经修复”。所以只能保留一份可重放的补丁。

## 用法

```sh
cd D:/MyGithub/dsh/dsh-plugins/asar-patches

node bin/asar-patch.mjs status     # 两个补丁各自 applied / pending / blocked
node bin/asar-patch.mjs apply      # 重建归档、校验、替换（旧文件留作 app.asar.bak-<时间戳>）
node bin/asar-patch.mjs apply --dry-run
node bin/asar-patch.mjs preview --out C:/tmp/asar-preview   # 导出 before/after 供 git diff 审阅
```

默认操作 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`；可用 `--asar <path>` 或环境变量 `DSH_ASAR` 指向别处（比如升级前先复制一份出来试打）。

补丁写入后**必须重启 DeepSeek Harness** 才生效——asar 只在启动时读。

## App 升级之后

```sh
node bin/asar-patch.mjs status
```

- 全是 `applied`：什么也不用做。
- `pending`：直接 `apply`（说明新版 bundle 的锚点还在）。
- `blocked`：锚点文本变了。这时：

```sh
node bin/asar-patch.mjs preview --out C:/tmp/asar-preview   # 看这一版的实际文本
# 按新文本改 patches/*.mjs 里的 find / replace / marker
node bin/gen-review.mjs 01 --baseline host=<新版原始 index.js>
node bin/gen-review.mjs 02 --baseline host=<…> --baseline client=<…>
node bin/asar-patch.mjs apply
```

`find` 是逐字匹配（含制表符）；`marker` 是“这条已经打上了”的判定串，必须只在补丁生效后出现。规则写成 `.mjs` 而不是 JSON，就是为了能直接写带制表符的字符串——可读版本交给 `review/*.diff`。

想留审阅痕迹，就在升级**之前**把两个原始条目存下来（`app.asar` 里的条目，或 App 安装目录里替换前的备份 `app.asar.bak-*`），作为下一轮的 baseline。

## 安全设计

- **不原地改写**：先在旁边生成 `app.asar.new-<时间戳>`，逐条读回校验（替换条目哈希、未改动条目抽样比对、staged 归档重新分类必须全部 `applied`），确认后才 `rename` 换入；换入失败会回滚。
- 偏移量全部重算，所以补丁改变条目长度也没问题（不用像当初那样靠缩短注释、尾部补空格凑字节数）。
- 改写前校验条目是干净 UTF-8 且 round-trip 一致，否则拒绝。
- 旧归档保留为 `app.asar.bak-<时间戳>`，回退就是把它改回 `app.asar`。
- `status` 以 1 退出表示“还有没打上的”，可以直接串进脚本。

## 本机验证记录（2026-10-26）

用 `~/.dsh/fixes` 里的两份原始条目，从线上 `app.asar` 合成了一份“未打补丁”的归档（16605 个条目、尺寸与原文件一致），跑完整链：

1. `status` → 两个补丁 6 条规则全部 `pending`
2. `apply --dry-run` → 重建 182435279 B，校验通过后删除暂存文件
3. `apply` → 备份 + 换入，`status` → 全部 `applied`
4. 与线上已打补丁的条目逐字 diff：**语义完全相同**，只差当初为对齐长度留下的痕迹（去掉的两个注释段落、行尾空格、`//# sourceMappingURL=client.js.ma` 后面补的空格和多余字符、文件开头的空行）

也就是说规则抓对了改动本身，而不是复制了那份手工痕迹。

## 不在这里的东西

- **原始条目 / baseline**：没有入库（属于第三方 bundle），留在 `~/.dsh/fixes/`。`review/*.diff` 是它们跑过规则后的产物，已入库。
- `~/.dsh/fixes/*/restore.mjs`：**已经过时**。它们用 SHA-256 白名单锁定当时那份归档，而线上 `app.asar` 现在已经不是那个哈希，所以它们会拒绝执行。要回退请用 `app.asar.bak-*`。
- 生成的 `app.asar.new-*` / `app.asar.bak-*`：不进仓库（见 `.gitignore`）。
