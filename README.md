# dsh-plugins

DSH（DeepSeek Harness）自研插件的**本地单一事实源**，外加桌面 App `desktop` profile 装配配置的受控副本。

建立这个仓库的原因：这些插件原先只是 `D:\MyGithub\dsh\dsh-plugins` 下的裸目录，不在任何 Git 仓库里，改坏一个 `index.js` 没有回退点。

## 目录结构

```
attention-alerts/   工具调用需要审批 / 一轮结束时发 Windows 通知与提示音
chat-annotations/   会话批注
project-board/      项目板（可拖拽的项目根目录卡片）
typora-workbench/   Typora 相关工作台增强
profile/            运行中 profile 配置的镜像（package.json + cordis.patch.yml）
scripts/            profile-status.mjs —— 镜像漂移检查 / 双向同步
asar-patches/       app.asar 内部补丁的规则与工具（见 asar-patches/README.md）
```

每个插件都是一个**组合包**（bundle）：`package.json` 用 `dsh.bundle.patch` 声明自己的配置层，`cordis.patch.yml` 是那一层，`index.js` / `client.js` 是实现，`locale/*.json` 是文案。

## 插件如何被加载

App 不会从这里直接读代码，而是经过 `~/.dsh/profiles/desktop`：

```
~/.dsh/profiles/desktop/package.json
  dependencies: "@local/typora-workbench": "link:D:/MyGithub/dsh/dsh-plugins/typora-workbench"
  dsh.profile.bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
                        "@local/typora-workbench", "@local/project-board",
                        "@local/attention-alerts", "@local/chat-annotations"]

~/.dsh/profiles/desktop/node_modules/@local/typora-workbench
  └── Junction ──▶ D:\MyGithub\dsh\dsh-plugins\typora-workbench
```

因此：

- 改插件代码**就在这里改**，Junction 会让改动立刻出现在 profile 里，不需要重新 `install`；但要让运行中的 App 用上新代码，得重载/重启 App。
- **`bundles` 的顺序就是加载顺序**，后加载的层按行覆盖前面的层。
- `cordis.patch.yml` 里的行覆盖**会整体替换目标行的 `config`**，不是深合并——改一个键也必须把该行需要的键写全。

## profile 镜像与漂移检查

`profile/` 下的文件是 `~/.dsh/profiles/desktop/` 的副本，**运行时用的是后者**。改完配置记得同步，否则两边会漂移：

```sh
node scripts/profile-status.mjs            # 只比对，有漂移则退出码 1
node scripts/profile-status.mjs --push     # 仓库 → 运行中的 profile（旧文件存为 .bak）
node scripts/profile-status.mjs --pull     # 运行中的 profile → 仓库（然后用 git diff 决定是否提交）
node scripts/profile-status.mjs --profile web   # 检查别的 profile
```

## 恢复 / 换机

```sh
git clone <this-repo> D:/MyGithub/dsh/dsh-plugins
# 方式 A：让 dsh 自己写 profile（推荐，link + bundles 一起维护）
dsh plugin --profile desktop add D:/MyGithub/dsh/dsh-plugins/typora-workbench
dsh plugin --profile desktop add D:/MyGithub/dsh/dsh-plugins/project-board
dsh plugin --profile desktop add D:/MyGithub/dsh/dsh-plugins/attention-alerts
dsh plugin --profile desktop add D:/MyGithub/dsh/dsh-plugins/chat-annotations

# 方式 B：直接还原 profile 配置
node scripts/profile-status.mjs --push
```

方式 B 只还原文件，`node_modules/@local/*` 的 Junction 需要再跑一次 `pnpm install`（在 `~/.dsh/profiles/desktop` 里）。

## 有意不纳入版本管理

- **原始 bundle 条目 / baseline**：`~/.dsh/fixes/{open-in-app,open-in-app-typora}` 里的 `.orig` / `.before` 是第三方 bundle 原文，不入库；补丁规则和它们生成的 `review/*.diff` 在 `asar-patches/` 里，已入库。那里的 `restore.mjs` 已过时（哈希锁对应的是旧归档，现在会拒绝执行）。
- `node_modules/`：由 pnpm 的 `link:` 生成。
- `~/.dsh` 下的 `sessions/`、`storages/`、`cache/`、`attachments/`：运行数据，不进仓库。
- profile 的 `cordis.yml`（空根）、`pnpm-lock.yaml`、`pnpm-workspace.yaml`：可再生成；插件依赖全是 `link:`，锁文件不携带额外信息。
