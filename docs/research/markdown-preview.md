# Leaf 下一功能版 Markdown 渲染预览：原 DBX 复用调研

日期：2026-11-26。性质：只读源码调研及方案建议，非实现、非发布承诺；0.3.0 仅候选版本号。

## 1. 范围、方法与结论

原 DBX 根目录为 `D:/workspace/dsh/dbx-main`。下文除特别标注 Leaf 外，文件引用均相对此根，行号来自本次实际读取。重点检查 `apps/desktop/src`、根 `package.json` / `pnpm-lock.yaml` / `Cargo.lock`、`src-tauri`，并补查 `docs` 官网展示。原仓库广域检索排除 `file-editor/`、`node_modules/`、`target/`、`dist/`、`artifacts/`、`releases/`、`.git/`（另排除 vendor）；Leaf 仅在本隔离工作树单独检查相关现状。未安装依赖、未运行应用或构建、未外传源码。原 DBX `graphify-out` 未找到 `graph.json`，因此直接追源码，没有重做构图。隔离工作树未见既有研究笔记目录，采用 `docs/research/`。

**结论：DBX 有值得参考的 Markdown 渲染、安全策略、排版和懒加载片段，但本次未发现“打开本地 .md 文件 → 编辑/预览切换或 Markdown 分屏 → 按文档路径解析图片”的完整功能。最适合 Leaf 的是新建一个很小的、按需加载的本地文档预览边界，而不是迁入 AI 聊天或数据库文档系统。**

此“未发现”是本次检索范围内的结果，不是穷尽所有历史分支的证明。检索包含 MarkdownPreview、markdown-preview、markdown preview、Markdown 预览、marked、markdown-it、Mermaid、KaTeX、convertFileSrc、assetProtocol 等，并追到以下实际调用方。聊天渲染、数据库说明文字渲染、HTML iframe 预览、SQL 变更预览均不得冒充本地 Markdown 文件预览。

## 2. 实际存在的能力与调用链

| 能力 | 已核实调用链/证据 | 对 Leaf 的价值与界限 |
| --- | --- | --- |
| 聊天 Markdown 正文 | `apps/desktop/src/components/editor/AiAssistant.vue:6713-6728` 把 `formatAiInlineMarkdown` 注入消息 renderer；`:7165-7170` 按 text/chart/html 分段，text 用 `v-html`。解析在 `apps/desktop/src/lib/ai/aiMarkdown.ts:14-56` | 支持 GFM、换行、表格包装、原始 HTML 转义；函数虽叫 Inline，`formatAiInlineMarkdown` 实际调用整块 `parse`。不是文件预览。 |
| 数据库文档备注 | `apps/desktop/src/components/docs/DatabaseDocsDialog.vue:237` → `apps/desktop/src/docs/DocsApp.vue:188` → `apps/desktop/src/docs/components/NoteEditor.vue:54-60` → `apps/desktop/src/docs/renderNote.ts:44-77`；表/列分别在 `apps/desktop/src/docs/components/TablePage.vue:53-60`、`ColumnTable.vue:98-101` | 有真正“Markdown 源码 textarea 与渲染结果切换”：点击进入编辑，blur 提交，Escape 放弃（NoteEditor `:22-48`）。但对象是数据库备注，不是本地文件；不是 CodeMirror，也不是实时双栏。 |
| 只读文档导出 | `apps/desktop/src/docs-export/ExportApp.vue:95` 使用同一 DocsApp，readonly=true；`apps/desktop/src/docs/components/NoteEditor.vue:9-14,26-29` 禁止进入编辑；`apps/desktop/src/docs/components/WikiIndex.vue:26,41` 也调用 renderNote | 可参考共享只读 renderer 的边界，不迁入数据库 snapshot、annotations、导出 bundle。 |
| 更新说明 | `apps/desktop/src/components/layout/UpdateDialog.vue:326-350` 动态 import marked，覆盖 HTML/link/image renderer；`:318-323` 拦截外链 | **最适合参考的最小入口**：按需加载、禁图片、HTML 转义、只允许 http(s) 链接。并非本地文档功能。 |
| 官网更新日志 | `apps/desktop/src/docs/components/landing/ChangelogList.tsx:3,123-133,193` 使用 marked、HTML 转义及 React HTML 插入 | 这是官网 React 展示，不迁入 Vue/Tauri 产品；不能用作任意本地文件的安全背书。 |
| AI HTML 预览 | `apps/desktop/src/lib/ai/richContent/aiRichContent.ts:70-90` 仅注册 chart-json/html；`apps/desktop/src/components/ai/rich/AiHtmlPreview.vue:120,137` 使用 sandbox 空权限 iframe | 与普通 Markdown HTML 转义是**另一条链路**。不要把 fenced html 的可执行富内容语义带进 Leaf。 |
| 泛用分栏 | `apps/desktop/src/components/layout/SqlEditorWorkspace.vue:439-441`、`ContentArea.vue:2377` 使用 Splitpanes | 是 SQL 工作区/结果区，不是 Markdown 分屏。Leaf 的简单两列不必新增 splitpanes。 |
| 名称含 preview 的工具栏 | `apps/desktop/src/components/layout/EditorToolbar.vue:79-82,384,717-723` | 实际是 SQL DML 变更预览，不能据此声称已有 Markdown preview。 |

Leaf 现有 Markdown 是语法语言：本工作树 `src/editor/languages.ts:16,28` 根据 md/markdown 识别并动态加载 `@codemirror/lang-markdown`；`src/editor/TextEditor.vue:84-89` 加载语言扩展并做 generation 防过期；`src/App.vue:488` 仍是 TextEditor。**CodeMirror 语言解析/高亮以及 `src/core/outline.ts:20,92-97` 的标题大纲不等于渲染预览。**

## 3. 解析与安全链：能借什么，不能直接照搬什么

### 3.1 聊天 renderer

`apps/desktop/src/lib/ai/aiMarkdown.ts:14-49`：Marked 开启 gfm、breaks；html token 转义；link token 先递归 parseInline label，再经 `new URL` + http/https 协议白名单（`:67-74`），title/href 转义，带 noopener/noreferrer。`:85-92` 提供事件委托，调用方 `AiAssistant.vue:6730-6740` 通过 shell open 或浏览器打开。

安全优点是“禁止作者 HTML + 明确协议白名单 + 点击时再核验”；测试 `apps/desktop/src/lib/__tests__/ai/aiMarkdown.spec.ts:5-25` 检查外链、javascript 和 script 转义。**局限：没有 image renderer 覆盖，不能将其 link 白名单当成 image 策略；也没有最终 HTML 通用消毒器调用。** 结合 DBX `src-tauri/tauri.conf.json:32-34` 的 csp=null，不能宣称聊天 Markdown 默认无网络图片请求或全面消毒。本次未在目标源码和根 pnpm 锁中发现 DOMPurify/sanitize-html，未运行恶意输入验证，不宣称已证明具体可利用漏洞。

### 3.2 数据库文档 renderer

`apps/desktop/src/docs/renderNote.ts:24-42` 同时为链接和图片使用 safeUrl：允许 http(s)、mailto、#、/、./、../；拒绝双分隔符开头（包含 Windows UNC / 混合斜杠）；`:44-68` 转义原始 HTML、href/title/alt，并用 parser.parseInline 保留链接文本格式。`:73-77` 调用 parse，产物直接进入 `NoteEditor.vue:60` 的 v-html。

它是**自定义安全渲染规则**，不是独立 DOM 消毒链；NoteEditor 注释称 sanitiser 不意味着采用了通用 HTML sanitizer。测试 `apps/desktop/src/docs/__tests__/renderNote.spec.ts:19-39,49-70,88-98` 很值得借鉴：原始 script/onerror、大小写/实体编码协议、data/vbscript、UNC 混合分隔符、链接嵌套 HTML。

不能照搬的策略：
- `renderNote.ts:61-67` 直接输出允许的远程图片 src；渲染即可请求，隐私边界不同于用户点击链接。允许 mailto 给 image 也不是专用图片策略。
- `./foo.png` / `../foo.png` 仅原样进入 DOM；**未实现按本地 Markdown 文件父目录解析**。普通 `foo.png` 不命中该 allowlist。允许相对 URL 不等于支持本地图片。
- `NoteEditor.vue:60` 点击正文同时承担“开始编辑”，没有 AI 链路那样独立的安全外链拦截；不能直接作为 Leaf 只读预览交互。

### 3.3 更新说明与 HTML iframe 边界

`UpdateDialog.vue:333-348` 对 image 返回转义后的替代文字，最接近 Leaf 第一版“无自动联网图片”的保守策略。它没有最终 DOM sanitizer，也不宜原封不动复制异步 watch：Leaf 必须加文档/revision 令牌，防止异步加载后写回旧文档。

`apps/desktop/src/lib/common/safeHtmlPreview.ts:1-9` 提供 default-src none、base-uri none、form-action none、仅 data/blob 图片的 CSP 壳，并去 meta refresh；`:13-21` 的另一入口还移除 meta/base/iframe/object/embed 与链接目标。`apps/desktop/src/lib/ai/richContent/aiHtmlPreview.ts:8-31` 明确提醒 iframe 自导航不由 fetch CSP 全面管理，`:34-41` 有 512 Ki 字符上限。可借鉴“多层约束及上限”思想，**不可将这个正则包装器当通用消毒器，亦不建议本期接入原始 HTML iframe**。

### 3.4 本地图片、Tauri asset 权限

本次在 DBX desktop 源码未发现 convertFileSrc，在 `src-tauri` 未发现 assetProtocol/protocol-asset 配置。原 `src-tauri/tauri.conf.json:32-34` 仅 csp=null，不能提供 Leaf 所需的本地文档图片沙箱样板。

Leaf 本工作树 `src-tauri/tauri.conf.json:14` 已允许 img-src self/asset/data，但 `src-tauri/Cargo.toml:24` 的 tauri features=[]，配置未声明 assetProtocol scope。**CSP 允许某协议并不等于已授权任意磁盘图片读取**，不能仅把路径塞进 img 标签就声称功能完整。

建议本期所有图片显示 alt/占位，不请求远程、不读磁盘。若以后加入本地图片：后端以“用户明确打开文档的目录”为授权边界，解析与规范化路径，处理符号链接/junction、Windows 盘符、UNC、百分号编码、路径穿越；默认拒绝越界、网络共享、SVG/HTML、超大或伪 MIME 文件。不要接受 Markdown 直接给出的 asset/file/任意绝对路径。可选择受控字节读取后生成 blob（关闭时 revoke），或最小范围 asset scope；两者都必须单独审计权限、CSP、尺寸及生命周期。不能放开全盘 scope 或默认启动 HTTP 图片服务。

补充官方核对入口（本次未联网抓取，配置行为应在实施时按目标 Tauri 版本复核；另尝试读取 Marked 官网 `https://marked.js.org/`，工具无法验证域名安全，未取得页面，未将该页面作为已核实证据）：
- https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc
- https://v2.tauri.app/reference/config/#assetprotocolconfig
- https://v2.tauri.app/security/csp/

## 4. 实际锁版本与扩展成本

| 项目 | 声明与实际锁证据 | 判断 |
| --- | --- | --- |
| marked | 根 `package.json:109` ^18.0.4；根 `pnpm-lock.yaml:181-183` 实际 **18.1.3**，包记录 `:2999`，snapshot `:6390` | 可选择同一解析器以便移植 renderer/test 思路，但锁版本不是安全认证，Leaf 后续需独立审批依赖。 |
| shiki | `package.json:115` ^4.2.0；`pnpm-lock.yaml:199-201` 实际 **4.6.0**，包记录 `:3488` | 不把声明范围当实际安装版本。 |
| splitpanes | `pnpm-lock.yaml:205-207` 实际 **4.1.2** | DBX SQL 分栏依赖，不建议为一个预览开关迁入。 |
| Tauri（原 DBX） | `Cargo.lock:9601-9604` **2.11.5** | 这是原 DBX 锁版本，不冒称 Leaf 版本。 |
| Mermaid / KaTeX / DOMPurify / markdown-it | 根 package/锁及目标渲染链未发现对应依赖或调用 | 不存在可核实的本仓库锁版本，不杜撰。Cargo.lock 未见 pulldown-cmark/comrak/ammonia 包名；当前证据指向前端 marked 链路。 |

**Mermaid：** `apps/desktop/src/lib/export/diagramFormats.ts:144-163` 构造 Mermaid ER 文本；`apps/desktop/src/components/diagram/SchemaDiagramDialog.vue:2284` 保存 Mermaid 导出。这是文本导出，不是 Mermaid 渲染引擎；`apps/desktop/src/lib/ai/richContent/aiRichContent.ts:8-9,88-90` 将 mermaid 明确留作 future，当前只注册 chart-json/html。未发现 Markdown Mermaid 渲染。未来引入会增加解析、布局、SVG 安全和大图 CPU 成本，应该显式启用、按需加载、限制规模，不能凭本次源码报出具体 KB/ms。

**KaTeX：** 未发现数学公式渲染实现及锁定依赖。未来会增加 JS/CSS/字体与宏输入边界，本期公式保持文字；不启用 HTML 信任扩展或 CDN。

**代码高亮：** `apps/desktop/src/lib/ai/aiCodeHighlighter.ts:94-135` 缓存一个加载 Promise，动态 import shiki core、引擎、2 主题及 19 种语言；仅当 `supportsRegExpLookbehind()` 检测不支持所需正则能力时才加载 Oniguruma WASM（`:103-108`），不能仅凭 WebView 的版本或名称推断是否走回退。`:138-139` 未知语言回落 text。可借其懒加载/回落设计，但“懒加载”不等于“轻”：第一次使用会并发加载整组语言。Leaf 最小版围栏代码只转义和排版，不引入 Shiki；以后若需要再逐语言加载或评估复用已有 CodeMirror/Lezer 能力。

**消息缓存：** `apps/desktop/src/lib/ai/aiMessageRender.ts:45-50,92-106,121-126,184-216` 有条目/字符预算、流式尾部策略、未闭合代码不高亮、clear。可借预算思想，不搬其 SQL/action、rich registry、聊天分段缓存。任意文件的引用链接、嵌套列表与跨段语法要求全文一致性，不应直接套聊天流式块切分。

本次无打包/启动/内存实测，无法承诺体积、启动耗时或某个文档大小必然流畅。

## 5. 推荐唯一最小方案（建议，不是已实现）

**方案：按需加载的安全 Markdown 只读预览；一个开关在编辑/预览间切换，保留原 CodeMirror 状态；首版不强求可拖拽分屏。** 若确认必须双栏，仍使用同一只读 renderer 和现有布局容器，窄窗退回切换；不要为此导入 DBX 工作区系统。

1. 范围：md/markdown 文件和手动选择 Markdown 语言的未命名文档；渲染当前内存草稿，不要求保存，不从磁盘另读旧文本。支持标题、段落、强调、列表、引用、链接、分隔线、围栏代码、GFM 表格/删除线/只读任务列表。明确 breaks=false（普通文档语义），不照搬聊天 breaks=true；该差异用测试固定。
2. 依赖与加载：后续实现时仅在第一次打开预览动态加载独立 renderer/Marked；编辑、普通文件、冷启动路径不导入它。参考 `UpdateDialog.vue:333`，不要通过 aiMarkdown 的静态 import 间接拉入。首次加载失败显示可重试状态，编辑永远可用；隐藏时取消计时器、释放大 HTML/cache 引用，不继续渲染。
3. 输入节流：建议 200ms trailing debounce，中文输入法组合输入完成后再渲染；只处理可见且活动的预览。以 documentId+revision+generation 丢弃过期异步结果（借 Leaf `TextEditor.vue:84-89` 模式），切页/关闭清理 timer。不要按字符建立无界历史 HTML cache。
4. 规模预算：建议先以 512 Ki 字符为自动实时预览上限，超限保留编辑并给出手动预览/暂不可预览提示；这只是初始工程预算，需通过含超长单行、深嵌套、巨表的基准调整。后续若单次同步解析仍阻塞，采用可终止 worker，而不是认为 setTimeout 能取消已开始的 parse。
5. 安全输出：单独 renderer，原始 HTML 始终显示为文字；不运行脚本、iframe、表单、style、事件属性、原始 SVG；fenced html/mermaid 保持代码，不委托 AI rich handlers。链接仅认可经规范化的 http(s)，点击时再校验并走已有/待审计的系统浏览器打开通路；禁止预览 WebView 导航。首版相对文档链接、mailto、自定义 scheme 保持文本（若增加 #anchor 需独立锚点规则）。
6. 图片：所有 Markdown image 变 alt/占位，禁止自动联网、data/blob/file/asset 或相对文件载入；不因已有 CSP 允许 asset/data 就放行源文本。以后用户显式授权远程图片也应作为独立功能，而非默认行为。
7. 消毒：不要把 Marked parse 当作 sanitizer。推荐后续实现加入最终允许列表 HTML 消毒层作为纵深防御，限制标签/属性/协议，并保留“原始 HTML 先转义”的规则；消毒器选择、锁版本和体积单独评审，本次未修改依赖。若不引入通用消毒库，必须明确承认安全边界完全由自定义 renderer 与 CSP 承担并增加针对锁定解析器的输出安全测试，不能声称经过 DOMPurify。
8. 样式：参考 `AiAssistant.vue:8226-8308,8345-8357` 的局部作用域、列表、代码块和表格横向滚动；不用聊天 11px 字号、320px 表格高度、nowrap 单元格作为文档默认。跟随 Leaf 明暗主题，长 URL/代码不撑破布局；任务框只读，不改变文档。
9. 生命周期：无需 Rust Markdown 引擎、数据库服务、AI、TCP、后台进程或托盘驻留；关闭窗口维持原有退出语义。不改变当前版本号。

## 6. 最值得借鉴 / 明确不整块迁入

优先顺序：
1. `apps/desktop/src/components/layout/UpdateDialog.vue:333-345`：最小懒加载与禁图片策略。
2. `apps/desktop/src/docs/renderNote.ts:3-68` + `apps/desktop/src/docs/__tests__/renderNote.spec.ts:19-98`：转义与攻击回归案例，但收紧 URL/图片策略。
3. `apps/desktop/src/lib/ai/aiMarkdown.ts:24-46,67-92`：安全外链委托、表格容器；去聊天样式与静态依赖。
4. `apps/desktop/src/components/editor/AiAssistant.vue:8226-8357`：挑选排版规则，不复制整个组件。
5. `apps/desktop/src/lib/ai/aiMessageRender.ts:45-50,209-216`：只借缓存上限/释放原则；`aiCodeHighlighter.ts:94-108` 只借延迟加载/回落思想。

不迁入：AiAssistant 整体、SQL 执行提案/工具链、rich chart/html registry、数据库 DocsApp/snapshot/annotations/导出 runtime、SQL 多组工作区、Shiki 全语言集合、DBX 的 csp=null、官网 React 页面。理由均是上述实际调用和依赖的业务耦合，非可直接复用的文件预览模块。

## 7. 实施验收点（待下一功能版执行）

- 语法：代表性的 GFM 文档；多层列表/引用、表格、任务列表、转义、引用式链接、未闭合围栏、中文/emoji 字符、CRLF；预览确实呈现结构，不仅着色。
- 状态：未保存草稿立即可预览；切换前后内容、dirty、undo、光标、滚动保持；快速切页/关闭/异步加载不出现串文档；输入法与极快输入不丢字。
- 安全：script/onerror/iframe/base/meta refresh/form/style/SVG 都不生效；javascript/vbscript/data、大小写、HTML 实体、控制字符、UNC 与混合斜杠攻击不导航、不读盘；正文无任意事件处理；禁用的 URL 仅保留可读文本。
- 网络：真实 Tauri WebView 观察打开、输入、切换主题均无外部图片/字体/CDN/预连接请求；外链仅显式点击且核验后由系统浏览器打开；不新增 TCP listener。
- 本地资源：首版相对图片显示占位且零磁盘图片读取；未来图片功能必须新增文档目录授权、越界/junction/UNC、未命名文档、另存为换目录、删除/超大/伪格式测试，不能沿用首版结论。
- 性能：对比 0.2.0 冷启动、首开预览、连续输入延迟、关闭后内存/进程；构建产物证明 parser/扩展不在主启动链。测试 50 Ki/512 Ki/2 Mi 字符和病理文档；超限与解析失败可恢复，不冻结编辑。
- 视觉/可访问性：明暗、高 DPI、窄窗、长代码/表格、键盘打开与退出、焦点恢复、链接可辨识、任务框只读。
- 回归：现有打开/保存/另存为/编码/大文件/退出行为；关闭预览不留 watcher/timer，关闭应用无后台驻留。

## 8. 不确定项与禁止夸大的说法

未运行 DBX/Leaf、未执行测试、未测包体或安全攻击，因此这是静态调查，不是安全审计通过或性能验收。没有发现完整本地 Markdown 预览、相对本地图片授权链、Mermaid/KaTeX 渲染，不等于断言所有分支永远没有。不能说“DBX 的 Markdown 已全面消毒”“没有外部图片自动联网风险”“Tauri CSP 已允许 asset 所以本地图片可直接工作”“Shiki 懒加载不增加成本”。本笔记所有未来功能、预算和验收均是建议；当前只新增这份记录，没有实现预览、改版本/产品代码/依赖，也没有 stage/commit/push。
