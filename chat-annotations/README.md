# Chat Annotations（对话批注）

在 DSH 对话里选中任意原文，直接高亮并写下批注；收集来的批注可以作为下一轮对话的基础，也可以追加导出到 Markdown 文件。

## 用法

1. 在对话里用鼠标选中一段文字（回答、提问、工具输出都行）。
2. 浮出的「高亮并批注」按钮 → 选高亮颜色（黄 / 绿 / 蓝 / 粉 / 紫 / 橙，默认黄色）→ 写批注（可留空，留空就是纯高亮）→ 保存。
3. **用鼠标右键点对话里已有的高亮即可删除它**（左键单击不会删除，照常选择/阅读）：没有批注的高亮右键即删；带批注的会先弹一个小卡片，把批注放在只读框里（已自动全选），可以点「复制批注」或直接 Ctrl+C，再点「删除高亮」才真正删除。右键命中高亮时浏览器原生菜单会被这次操作吞掉，没命中就保留原生菜单。
4. 输入框右侧的荧光笔图标显示条数；点开面板可以：
   - 逐条定位回原文、改颜色、修改批注、删除；
   - 「作为下一轮对话的基础」：把「原文 + 我的批注 + 来源」放进输入框，补充自己的问题后直接发送；
   - 「追加导出」：把全部批注写成 Markdown 追加到文件（默认 `<会话工作区>/annotations.md`），文件已有内容时在后面追加，不会覆盖。

## 导出格式

```markdown
## 对话批注 · 2026-10-25 23:51:08

### 1

> 原文：<选中的那段文字>

批注：<你写的批注>

[原文来源](dsh://session/<sessionId>?seq=<事件序号>)

---

### 2
…
```

`dsh://session/<sessionId>?seq=<seq>` 就是这条原文在 dsh 会话日志里的位置：会话 id + 该消息所处的持久事件序号。

## 实现要点

- **高亮不改 DOM**：用 CSS Custom Highlight API（`CSS.highlights` + `Range`）绘制，不往其它插件渲染的 Markdown 里塞 `<mark>`。重渲染后用「原文 + 文本偏移 + 就近搜索」重新定位。
- **右键高亮删除**：`::highlight()` 画出来的不是元素、收不到事件，所以绘制时把每条批注的 `Range` 记下来，在对话区监听 `contextmenu`，用 `getClientRects()` 做命中测试；点在链接/按钮/可编辑元素上、存在选区、或按住修饰键时都不算。命中后在处理函数里 `preventDefault()`，没命中放行原生右键菜单。
- **颜色**：Highlight API 一个注册名只能有一种样式，所以每种墨色注册一个 `dsh-chat-annotation-<color>`，同色的 range 归到同一个 Highlight；`::highlight()` 规则由调色板表生成，颜色只有一个出处。批注的 `color` 字段随批注一起存 Host，未知/缺省值回落到黄色。
- **批注锚点**：`data-chat-flow-key`（chat 节点的引擎键）→ 会话快照里的 `anchorSeq` → 事件序号。
- **持久化**：Host 侧存到 `%DSH_HOME%/chat-annotations/<sessionId>.json`（默认 `~/.dsh/...`），刷新后重新加载并重绘高亮。
- **文件写入**：浏览器写不了「追加到已有文件」，因此导出走 Host 的 `/chat-annotations/api/export`，只做这一件写盘的事。

## 打包

`package.json` 声明 `dsh.bundle.patch` 与 `dsh.client`，`index.js` 是 Host 半边（HTTP 路由），`client.js` 是浏览器半边（`window.__ModuleLoader__.load` 工厂）。安装用 `plugin_manager` 的 `install_bundle`，目标为这个包目录。
