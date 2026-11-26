# Leaf Markdown 可视编辑器选型：从 uTools 插件追到可复用内核

调研日期：2026-11-26。范围：公开官方商店、项目自己的 GitHub README / 源码 / LICENSE / Releases；仅调研，未安装依赖、执行下载代码、运行插件或改动产品。Leaf 的 Vue 3 / Tauri 2 / CodeMirror 6、内容安全优先、不后台预热等作为本次给定约束，不在本文冒充重新完成的代码审计。

## 1. 决策摘要

**建议先对 Vditor 做有时限、硬门槛的适配原型，不直接批准上线；Milkdown / ProseMirror 是备用路线。保留 CodeMirror 源码编辑器和 Leaf 自有文件/历史边界，绝不把 uTools 插件整体嵌入。**

理由：Vditor 是实际 uTools 插件明确采用的独立 MIT 内核，已经提供 WYSIWYG、即时渲染、源码分屏、表格和工具栏，最接近本次所需交互，不必再把只读预览包装成“编辑器”。但**已发现两个足以阻止原样接入的问题**：内置 Mermaid 使用 `securityLevel: "loose"`；undo 按三个编辑模式分别维护栈。它的默认 CDN 也是联网地址。[S1][S4][S5][S6]

因此选型是“Vditor 优先验证”，而不是“Vditor 已经满足内容无损、统一撤销或中文 IME”。若不能在公开扩展接口与小型适配层内隔离渲染/网络、保留源文及统一历史，就停止这条路线，换 Milkdown 的可定制节点/事务路线；不维护长期深度 fork。Milkdown 也不是无损转换的现成答案。两者都失败时，维持 CM 源码编辑，不交付伪 WYSIWYG。

## 2. 查到了哪些真实 uTools 插件

| 插件身份（官方商店本次返回） | 可核实的底层与公开源码 | 许可及复用结论 |
| --- | --- | --- |
| **iker-Markdown笔记本**，开发者 **ikiler**，1.0.9 | 商店直接写“基于 Vditor”，列出所见即所得、即时渲染、分屏预览三模式。[S1] | 本次没有找到可以与该身份确证关联的公开仓库/插件许可证。不能因为 Vditor 是 MIT 就推定整个插件可复制。可评估独立 Vditor。 |
| **Markdown 笔记**，开发者 **uTools 团队**，1.15.0 | 商店列出富文本结合、Mermaid、KaTeX、导出，明确文本和图像存在 uTools 本地数据库；未给编辑器品牌或源码地址。[S2] | 底层、插件开源许可均未确证。不能称它使用 Vditor、Milkdown 或其他内核，更不能承诺原样移植。商店允许任意 URL 协议的链接行为也不应照搬到 Leaf。 |
| **超级Markdown**，开发者 **Ziu**，1.4.10 | 商店明确 ByteMD，并给出 `ZiuChen/SuperMarkdown`；仓库 package.json 声明 `bytemd ^1.21.0`、Vue 3，`src/components/Editor.vue` 直接从 bytemd 导入 Editor。[S3][S7] | 插件仓库 **Apache-2.0**；ByteMD 内核 **MIT**，不是同一许可。可以按许可借鉴集成思路，不能把插件的 uTools 数据/窗口/截图服务当成 Tauri 服务。[S7][S8] |

另检索到 `wish5115/utools-note`，其 package.json 是 Vue 2 + vue-quill-editor，MIT；**未找到证据表明它就是上述三款之一**，不能用相似仓库名认领官方插件。[S9]

**取舍：**借鉴 iker 的三模式交互、超级Markdown 的组件边界，不复制笔记数据库、同步、上传、窗口管理与 uTools 运行时。商店包体积是插件发布包大小，不能用来推导 Leaf 的 JS 首屏、内存或压缩后依赖体积。

## 3. 独立内核比较

下表“事实”来自所列官方材料；“工作量/风险”是本次工程判断，不是跑过的结论。

| 候选 | 已核实能力 | 对 Leaf 的缺口与判断 |
| --- | --- | --- |
| **Vditor** | README 明确三模式、GFM 表格、Mermaid、可配置 toolbar（含 table/undo/redo/edit-mode）、Vue 等框架支持。官方 WYSIWYG 表格粘贴测试实际操作 `tbody td`，不是只读表格截图。MIT。[S4][S10] | 最短交互验证路径。其测试还显示单元格多行粘贴会序列化为 `<br />`，说明不能假定原文格式保持不变。原生源码模式并非 Leaf CM6，需决定只启用 WYSIWYG 并由 Leaf 切源模式，避免两套源码编辑器。Mermaid 点击进入源码的具体体验仍需原型证明，不能由“支持 Mermaid 渲染”推导。 |
| **Milkdown / ProseMirror（按需采用 Crepe 组件）** | 官方说明建立在 ProseMirror + remark 上；Crepe Table 提供增删行列、对齐、拖柄；toolbar 组件及 history 插件存在；`@milkdown/vue` peerDependency 为 Vue `^3.0.0`；代码块组件提供 `renderPreview` 与 preview/edit 切换配置。MIT。[S11][S12][S13] | 可控的节点/事务和 Mermaid 自定义代码块渲染适合长期维护，但需自己设计 CM 源码模式、跨模式历史、Markdown 映射、未知语法保护。代码块预览扩展点不是内置安全 Mermaid 编辑器的证明。Crepe 默认配置导入 language-data 等，不能把“模块化”当作最终产物足够小的证明。[S14] |
| **TOAST UI Editor** | 官方 README 明确 Markdown/WYSIWYG 切换、可增删行列的表格上下文菜单、toolbar、自定义块；MIT。官方插件列表中的 UML 不是 Mermaid。[S15] | **不作为新版本主选或备用**：本次官方 README 明确 deprecated、archived、不再发布功能或修复；GitHub API archived=true。另源码默认 `usageStatistics: true` 并说明发送 hostname 到 Google Analytics；即便试验也必须关闭。不能因有 Vue wrapper 就假设适配 Vue3。[S15][S16] |
| **ByteMD** | Svelte 实现，有 Vue3 wrapper；源码/预览 split、tab、auto；GFM、frontmatter、Mermaid 官方插件；MIT。[S8] | 很适合源码+预览，但材料没有给出本次要求的直接单元格 WYSIWYG 编辑。不是下一版主选，避免重复“只读预览不满意”。支持 frontmatter 解析也不是可视编辑后逐字无损的证明。 |

**为什么不继续纯 CM decorations 堆功能：**这是针对本次需求的工程判断：真正表格需要单元格光标、行列操作、粘贴、选区、composition 和撤销语义，不能仅靠把 Markdown 行藏掉并显示 HTML 获得这些能力。CM 继续承担安全源码模式，比重新造富文本内核更合理。

## 4. 维护状态：本次实际看到什么

查询官方 GitHub repository API 与 latest release API（访问日期同上）：

| 仓库 | 当时状态 / 发布时间 | 解释 |
| --- | --- | --- |
| Vanessa219/vditor | 未归档；latest `v4.0.1`，2026-10-18；pushed_at 2026-11-26 | 近期活动证据，不等于安全认证。[S17] |
| Milkdown/milkdown | 未归档；latest `v7.23.0`，2026-10-27；pushed_at 2026-11-25 | 近期活动证据。[S18] |
| nhn/tui.editor | **已归档**；latest API 返回 `editor-plugin-chart@3.0.2`，2026-11-15 | 这是插件 release，不得称其为编辑器 core 最新版；以官方弃用声明为决策依据。[S15][S19] |
| pd4d10/bytemd | 未归档；latest `v1.22.0`，2025-02-12；旧 bytedance 地址重定向到此仓库 | 活动较早，不据此断言弃用。[S20] |
| ZiuChen/SuperMarkdown | 未归档；pushed_at 2026-06-01；latest release API 404 | 404 仅表示未取得 latest release，不是仓库不存在；商店版本和源码发布状态分开看。[S21] |

本次源码 HEAD：Vditor `0732967e1bd16de7716399b6926bf75ad9bfc5d8`；Milkdown `0655111f3bb8393e959ce3f3d107c83edce29c3a`；SuperMarkdown `635aaf5035214351974e3ffe24b6510b4dc04f63`。源码发现对应这些分支快照，**不假定与上列 release tag 内容完全相同**。实施时先锁定候选版本，再重做安全审查和许可证/依赖清单。

## 5. 内容安全和迁移边界（建议设计，未实现）

### 5.1 源文是权威，不以富文本序列化输出覆盖整文件

Leaf 持有原始字节/编码、换行风格、Markdown 文本、文档 ID、revision、dirty 状态和文件保存权限；可视内核仅为可替换的编辑视图。不可让第三方 cache、autosave、localStorage 或插件数据库成为第二个保存源。Vditor 有 cache 配置，应禁用其持久化缓存；Leaf 负责恢复与冲突处理。[S4]

需要明确区分三种承诺：语义可读、Markdown 等价、原文字节不变。AST → 富文本 → Markdown 不自动满足最后两者。frontmatter、HTML 注释、自定义指令、未知围栏、引用定义、空白/缩进、转义、列表标记及尾部换行必须进保真语料。

迁移策略：

1. 默认仍由 CM 打开已有任意 Markdown；只有用户明确进入可视模式才懒加载内核，不在启动、hover、idle、打开非 Markdown 文件时预热。
2. **仅切模式、聚焦、渲染不得写回、置 dirty 或改变 revision。** 保留原始文本副本；不能以 `getValue()` 的规范化结果当作用户编辑。
3. 可视改动应通过带 revision 的事务写回 Leaf；目标是只替换明确修改的源范围，未修改块保留原始文本。实现这种源范围映射不是现成内核保证，必须原型验证。
4. 无法无损表示的块以保留原文的不可改 opaque 节点处理；若内核做不到可靠保留，就整篇拒绝可视编辑并解释原因，仍允许 CM 编辑。不要静默删除 frontmatter/comments/custom syntax。
5. 全文规范化只能是用户明确选择、看到 diff 后单独确认的动作，不能混进普通保存。本版不以这种确认绕过普通可视编辑的无损门槛。
6. 挂载异常、加载失败、渲染超时、版本冲突时保留文档及撤销栈，退回源码；禁止把空编辑器内容回填。切文件后异步回调需检查文档 ID + revision，旧回调无写权限。

### 5.2 历史必须跨模式，不是“两个编辑器各自有撤销”

Vditor `Undo` 明确包含 `wysiwyg` / `ir` / `sv` 三个 IUndo，并按 currentMode 操作；其 `setValue(markdown, clearStack=false)` 参数也不能证明统一历史。[S6][S4] Milkdown history 证明内部 undo/redo 存在，不证明外部 CM 编辑会自动加入同一事务链。[S13]

建议 Leaf 保留一条按文档排序的文本事务日志和选区元数据；源模式/可视模式编辑只提交一次，在活跃视图统一处理 Ctrl+Z/Redo，并重建或映射另一视图状态。不能同时让 native undo 与 Leaf undo 各退一次。模式切换不是编辑事务；composition 期间不能 setValue、切节点或提前提交。该桥接若只能靠频繁全文重建而损坏 IME/选区，判 no-go，而不是隐藏历史丢失。

### 5.3 Mermaid 的“点击源码”与 Mermaid 自带点击事件不是一回事

Leaf 应在安全图形外层提供受控“编辑源码”按钮/点击入口，打开该 fence 对应源码区域（可用 CM），提交后更新同一块，取消不改正文。不是开启图中的 `click` 指令。图渲染失败仍显示完整原文，禁止把错误 HTML 写回 Markdown。

**已验证风险：**Vditor 当前 `mermaidRender.ts` 动态加载脚本、设置 `securityLevel: "loose"` 和 `htmlLabels: true`，并将结果赋给 innerHTML。[S5] Mermaid 官方说明 strict 默认编码 HTML、禁用图内 click；loose 允许 HTML 与 click；sandbox 使用 iframe。[S22] 所以不能只写“Vditor 有 XSS 过滤”就放行。应禁用/替换其自动 Mermaid 渲染路径，使用 Leaf 控制的本地 Mermaid、strict、安全配置不可被文档覆盖、最终 SVG/DOM 检查或隔离。若公开接口无法完全替换而必须深度 fork，切备用方案。

### 5.4 网络、图片、HTML、Tauri 权限

以下是 Leaf 的要求，不是对任何内核默认安全性的背书：

- 所有 JS/CSS/字体/图标/渲染资产随应用本地打包；Vditor 默认 CDN 为 unpkg，README 明确离线配置需要处理 cdn、emojiPath、themes 以及渲染方法的 CDN 参数，单改一个地址不算完成。[S4]
- 默认远程图片不请求，保留 URL 与 alt、显示占位；禁上传/剪贴板自动上传、远程 PlantUML 等服务、遥测、后台更新。明确用户授权的外链走 Leaf 的协议白名单，不继承 uTools 任意协议行为。
- 本地图片必须通过 Leaf 受控路径解析、权限范围、大小/MIME 验证；拒绝 UNC、越界及任意 file/asset 路径，处理 Windows junction/符号链接。不要为编辑器放宽 Tauri 文件系统权限或把 CSP 设为空。SVG/HTML 图片默认不加载。
- 原始 HTML 作为安全文字/opaque 原文保存，不执行。粘贴 HTML、链接协议、Mermaid SVG 及错误信息都进恶意样本测试；“输出消毒”不意味着允许删除磁盘中的原始文字。
- Vue3 适配只负责 mount/update/dispose；Tauri bridge、文档状态、保存、剪贴板授权和图片解析都留在 Leaf。编辑器不能持有任意文件写权限。关闭文档应撤销 blob、监听器、worker，丢弃过期 render Promise。

## 6. 硬 go / no-go 原型验收

只在另行授权的隔离原型中做；本次未执行。**下面每条都是发布前必过，不能用截图或 README 替代实测。** 候选版本、Windows/WebView2 版本、输入法版本和机器配置必须记录。

| 门槛 | 必须通过的实验 | 失败处理 |
| --- | --- | --- |
| 真可编辑表格 | 点击单元格输入中文；Tab/Shift+Tab；增删行列、对齐、首/末行；空格/管道转义；多单元格及多行粘贴；保存、重开内容一致 | 只有 HTML 表格预览或编辑时整表退成源码，不能算达标。 |
| Mermaid | 点击安全外层进入**同一 fence** 源码；编辑、取消、撤销；多个图不串块；无效语法保留原文；渲染过期/超时不覆盖正文 | 只显示图、打开另一个无关联文本框或放开图内 click，失败。 |
| 两模式及 toolbar | CM 源码 ↔ WYSIWYG 连续 20 次；加粗、标题、列表、链接、代码、表格命令针对当前选区；进入/退出无 dirty；无内容编辑时保存字节不变 | 静默规范化或选区丢失致误改，失败。 |
| 保真语料 | frontmatter、注释、reference links、未知自定义语法、嵌套列表、CRLF/BOM/尾部换行、代码围栏、数学表达式；只改表格一格时其余原始范围逐字不变 | 未支持语法允许显式拒绝可视模式，但不允许损坏或悄悄丢弃；基础 GFM 必须可编辑。 |
| 统一 undo/redo | 源码 A → 可视表格 B → Mermaid C → 源码 D；跨模式逐步撤销到初始、再全部重做；切模式无额外历史；切文件不串栈；保存后仍能撤销 | 各模式分别撤销、重复提交、setValue 清历史，失败。 |
| 中文 IME | Windows 微软拼音 + 至少一种常用中文输入法；正文/表格/链接/Mermaid 中候选翻页、回车上屏、标点、组合中点击工具栏/切模式、删除再输入 | 丢字、重复字、光标跳转、半截拼音入历史，失败；不能用中文 UI/中文作者作证明。 |
| 离线和安全 | 无网络环境首次进入全部功能可用；网络抓取证明默认零外部请求；测试 img/onerror、javascript/data 链接、HTML 粘贴、恶意 SVG、Mermaid click/directive、深层大图、越界图片 | 任何默认联网、HTML 执行、越权文件访问均失败。 |
| 异常恢复 | 加载失败、关闭/快速换文件、外部修改冲突、渲染异常、退出重开；原文与已提交事务不丢失；验证保存现有安全流程不变 | 空值回写、过期回写、丢未保存文本，失败。 |
| 轻量/懒加载 | 启动和非 Markdown 编辑不加载内核、Mermaid 或语言包；首个可视请求才加载；退出/切文档重复 20 次资源回收 | 后台预热直接失败。记录压缩/未压缩 chunk、首次交互耗时、长任务、内存增长，不虚构 benchmark。 |

性能预算建议在原型开始前固定：相同参考机器、10KB / 100KB / 1MB 语料，启动与非 Markdown 路径对照原版；100KB 首次可视交互目标不超过 1 秒，输入响应 p95 不超过 50ms，20 次开关后不出现持续单调资源增长。**这是建议验收阈值，不是已测成绩，也不是用户已批准 SLA。** 超大文件可明确留在源码模式，不得冻结或丢失内容。

执行顺序建议：先验证“未修改不写回 + 跨模式历史 + IME + 安全渲染替换”，再做 UI 美化。Vditor 任一关键门槛无法通过时，拿**同一语料与门槛**验证 Milkdown；不要仅因第二个 demo 更漂亮就降低标准。

## 7. 证据与访问限制

WebSearch 用于定位官方页面。WebFetch 对 u-tools.cn / github.com 多次返回无法验证域名安全，未把失败说成看过页面；之后使用只读 HTTPS 请求直接读取官方商店 HTML、raw.githubusercontent.com、api.github.com 成功完成核心核实。官方帮助页 `https://www.u-tools.cn/docs/guide/plugin-markdown.html` 返回 404，所以没有依赖其内容。一次 raw 连接重置、一轮终端 GBK 输出失败，后续通过已取得的 README 输出和 UTF-8 请求补足。没有下载/解包 uTools 插件，没有运行第三方代码，也没有测量 bundle 或输入法行为。未知项明确保留为未知。

以下全部是第一方来源；GitHub main/master 链接会变化，关键快照 SHA 已记录于第 4 节。

- [S1 iker-Markdown笔记本官方商店](https://www.u-tools.cn/plugins/detail/iker-Markdown%E7%AC%94%E8%AE%B0%E6%9C%AC/)
- [S2 Markdown 笔记官方商店](https://www.u-tools.cn/plugins/detail/Markdown%20%E7%AC%94%E8%AE%B0/)
- [S3 超级Markdown官方商店](https://www.u-tools.cn/plugins/detail/%E8%B6%85%E7%BA%A7Markdown/)
- [S4 Vditor README：模式、API、离线部署](https://github.com/Vanessa219/vditor/blob/master/README.md)；[MIT LICENSE](https://github.com/Vanessa219/vditor/blob/master/LICENSE)
- [S5 Vditor Mermaid 实现（本次 SHA）](https://github.com/Vanessa219/vditor/blob/0732967e1bd16de7716399b6926bf75ad9bfc5d8/src/ts/markdown/mermaidRender.ts)
- [S6 Vditor Undo 实现（本次 SHA）](https://github.com/Vanessa219/vditor/blob/0732967e1bd16de7716399b6926bf75ad9bfc5d8/src/ts/undo/index.ts)
- [S7 SuperMarkdown package.json](https://github.com/ZiuChen/SuperMarkdown/blob/main/package.json)；[Editor.vue](https://github.com/ZiuChen/SuperMarkdown/blob/main/src/components/Editor.vue)；[Apache-2.0 LICENSE](https://github.com/ZiuChen/SuperMarkdown/blob/main/LICENSE)
- [S8 ByteMD 官方 README](https://github.com/pd4d10/bytemd/blob/main/README.md)；[仓库许可元数据](https://api.github.com/repos/pd4d10/bytemd)
- [S9 wish5115/utools-note package.json](https://github.com/wish5115/utools-note/blob/master/package.json)
- [S10 Vditor WYSIWYG 单元格测试](https://github.com/Vanessa219/vditor/blob/0732967e1bd16de7716399b6926bf75ad9bfc5d8/__test__/wysiwyg/pasteTableCell.test.js)
- [S11 Milkdown README](https://github.com/Milkdown/milkdown/blob/main/README.md)；[MIT LICENSE](https://github.com/Milkdown/milkdown/blob/main/LICENSE)
- [S12 Crepe Table](https://github.com/Milkdown/milkdown/blob/main/packages/crepe/src/feature/table/index.ts)；[Toolbar](https://github.com/Milkdown/milkdown/tree/main/packages/crepe/src/feature/toolbar)；[代码块 preview/edit 扩展](https://github.com/Milkdown/milkdown/blob/main/packages/crepe/src/feature/code-mirror/index.ts)
- [S13 Milkdown history 文档](https://github.com/Milkdown/milkdown/blob/main/docs/api/plugin-history.md)；[Vue3 package manifest](https://github.com/Milkdown/milkdown/blob/main/packages/integrations/vue/package.json)
- [S14 Crepe 默认配置](https://github.com/Milkdown/milkdown/blob/main/packages/crepe/src/default-config/index.ts)
- [S15 TOAST UI 官方 README：弃用、表格、模式及 MIT](https://github.com/nhn/tui.editor/blob/master/README.md)
- [S16 TOAST UI editorCore：usageStatistics 默认值](https://github.com/nhn/tui.editor/blob/master/apps/editor/src/editorCore.ts)
- [S17 Vditor 仓库状态](https://api.github.com/repos/Vanessa219/vditor)；[v4.0.1 release](https://github.com/Vanessa219/vditor/releases/tag/v4.0.1)
- [S18 Milkdown 仓库状态](https://api.github.com/repos/Milkdown/milkdown)；[v7.23.0 release](https://github.com/Milkdown/milkdown/releases/tag/v7.23.0)
- [S19 TOAST UI 仓库状态](https://api.github.com/repos/nhn/tui.editor)；[latest release API](https://api.github.com/repos/nhn/tui.editor/releases/latest)
- [S20 ByteMD v1.22.0 release](https://github.com/pd4d10/bytemd/releases/tag/v1.22.0)
- [S21 SuperMarkdown 仓库状态](https://api.github.com/repos/ZiuChen/SuperMarkdown)
- [S22 Mermaid 官方 usage/securityLevel 文档源码](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/docs/config/usage.md)
