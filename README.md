# Leaf · 轻页

一个专注本地文本与 Markdown 的轻量桌面编辑器。

基于 **Rust + Tauri 2 + Vue 3 + CodeMirror 6**，目前主要在 Windows x64 上开发和验证。采用 Apache-2.0 开源许可证。

## 为什么做 Leaf

起点很简单：只是想打开一个文本文件，却觉得编辑器启动等待太久，甚至需要靠后台预热来改善体验。

我们希望编辑器回到最朴素的用途：**需要时打开，打开后编辑，保存时可靠。** 不为了一个本地文本文件加载数据库、AI、插件市场或更新服务，也不依赖托盘常驻、开机启动和后台预热。

Leaf 最初在 DBX 源码目录中探索实现，借鉴其 CodeMirror 标签状态、编码读写、保存冲突和外部变化处理实践，随后拆分为独立应用。它不是精简版数据库客户端，也不是 DBX 官方发行版。

另一个重要原则是：**内容安全比功能数量重要。** 不静默覆盖冲突文件，不把浏览器导出伪装成原位保存，不为了 Markdown 预览把整个文档重新序列化。

> 轻量冷启动是设计目标，不是已经证明的性能优势。尚未完成与 EditPlus 等编辑器的同机冷启动基准，不宣称 Leaf 比它们更快。

## 当前能力

- 多标签文本编辑，每个标签独立保留撤销历史、选区和滚动位置。
- 应用内文件/目录选择器：路径输入、面包屑、文件多选、目录导航。
- 目录树按需展开，左键单击打开文件；符号链接显示但不递归进入。
- 文件 / 大纲双视图，点击标题或符号跳转。
- 查找替换、跳行、软换行、浅深主题与清晰的局部选区高亮。
- UTF-8、UTF-8 BOM、UTF-16 LE/BE、GBK；LF、CRLF、CR。
- 未保存关闭保护、外部修改/删除提示、保存冲突检查。
- Markdown 源码 / 可编辑预览共用同一 CodeMirror 文档，不做 HTML→Markdown 全文转换。
- GFM 表格预览、列对齐、行内格式；点击表格后编辑对应源码。
- Mermaid 围栏图表按需本地渲染，支持时序图等 Mermaid 语法；点击图表后编辑原始定义。
- Markdown 格式工具栏：标题、强调、列表、引用、链接、图片语法、代码与表格模板。
- 独立 `---` 行的分隔线预览；光标进入时保留源码编辑。

### 常用快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl+N / Ctrl+O | 新建 / 打开文件 |
| Ctrl+Shift+O | 打开目录（桌面版） |
| Ctrl+S / Ctrl+Shift+S | 保存 / 另存为 |
| Ctrl+F / Ctrl+G | 查找替换 / 跳行 |
| Ctrl+Z / Ctrl+Y | 撤销 / 重做 |
| Ctrl+1 / Ctrl+2 | Markdown 一级 / 二级标题 |
| Ctrl+B / Ctrl+I / Ctrl+K | Markdown 加粗 / 斜体 / 链接 |

Markdown 快捷键在编辑器获得焦点、语言为 Markdown 时生效。标题操作作用于当前行或选中行，不必选中整行。工具栏与快捷键使用同一编辑事务。

## 使用与版本

当前源码版本为 **0.7.0**。本版包含 Mermaid、细线工具栏图标、光标闪烁修复和 Windows 路径显示优化。历史版本的原生验收与包哈希见 [VERIFICATION.md](VERIFICATION.md)，不作为本版原生验收结论。

本仓库不提交 EXE、测试 artifact 或用户数据。若 Releases 页面尚无附件，请按下节从源码构建，不要把仓库源码 ZIP 当作可运行程序。

使用便携包时：

1. 将整个 ZIP 解压到可写目录，不要直接在 ZIP 内运行。
2. 保存并退出旧版 Leaf，再双击 `Leaf.exe`。
3. 需要系统已有 Microsoft Edge WebView2 Runtime；包不内置 Runtime。
4. `portable.flag` 启用包旁 `data/webview` 存储主题与 WebView 数据。

程序目前未签名；不要为运行 Leaf 关闭 Windows 安全保护。

## 从源码运行

前置条件：Node.js 22.13+、pnpm 10；桌面构建另外需要 Rust MSVC 工具链、Visual Studio C++ Build Tools、Windows SDK 和系统 WebView2。

```bash
git clone https://github.com/luonianxin/leaf-editor.git
cd leaf-editor
pnpm install --frozen-lockfile
pnpm dev:web          # 浏览器预览
pnpm dev              # Tauri 桌面开发版
```

```bash
pnpm build            # 类型检查 + 前端生产构建
pnpm build:desktop    # Windows x64 Release EXE
pnpm package:portable # 构建 + 许可收集 + 便携 ZIP
```

生成物在 `releases/`，包含 EXE、使用说明、许可证、来源声明、所需第三方源码材料、文件清单及 SHA-256 校验文件。独立仓库不依赖父目录的 DBX 工程。

正式 Release 使用内嵌前端协议，不启动 Vite/HTTP 服务。开发端口默认从 1430 起、浏览器测试从 1470 起实际绑定可用端口；占用时跳过，**不会停止其他服务**。可以用 `LEAF_PORT` 或 `--port` 指定开发起始端口。

## 内容安全与边界

- Markdown 原始 HTML 不执行、图片仅占位、链接不导航；图片按钮只插入语法，不上传或读取图片。
- Mermaid 在本地按需加载并以严格安全模式渲染，不把图表源码发送到外部服务；语法错误时显示可读源码回退。
- 保存使用同目录临时文件、flush/sync 与原子发布；Windows 现有文件使用 `ReplaceFileW`，新目标禁止未经确认覆盖。
- 保存前校验已知磁盘 hash，但不是跨进程原子 CAS，不能阻止所有外部写入竞态。
- 最大单文件 16 MiB；超过 2 MiB 跳过语法和大纲解析。
- 混合换行保存前要求明确选择统一格式，不支持逐行保留混合换行；UTF-16 保存带 BOM。
- 超过 524,288 个 UTF-16 代码单元的文档回落源码式编辑；超大或嵌套表格保留源码。单个 Mermaid 定义最多 65,536 个代码单元、400 行，超限后同样保留源码。
- 浏览器预览只能导出副本，不能覆盖原路径或监听磁盘，也不能安全写出 GBK。
- 正常关闭保护不等于崩溃恢复。重要编辑请及时保存。

### 已知限制

- 表格不是直接富文本单元格编辑；不提供可视增删行列、图表拖拽编辑、公式或插件系统。
- Frontmatter 是保守的文首配对分隔符与键值行识别，不是完整 YAML 解析器。
- 真实中文输入法组合场景尚未完成专项人工验收。
- 历史测试中 WebView 子进程偶有超过 15 秒才退出；最近验收通过不代表根因已修复。
- 未验证没有 WebView2 的干净 Windows 虚拟机，也未进行系统冷缓存启动性能对比。

## 验证与贡献

```bash
pnpm test
pnpm test:ports
pnpm test:packaging
pnpm test:e2e
pnpm test:native
pnpm test:native:profile /absolute/path/to/extracted/Leaf.exe
pnpm test:native:ui /absolute/path/to/extracted/Leaf.exe
```

原生 UI 测试会拒绝在已有 Leaf 窗口运行时启动，不主动关闭你的编辑窗口。测试截图和临时文件位于被 Git 忽略的 `artifacts/`。

欢迎提交问题与改进。报告文件读写问题时，请尽可能使用脱敏的最小样本，说明编码、换行符、系统版本和复现步骤；不要上传真实凭据、私人文档或 WebView 用户数据。涉及保存机制的改动，请同时提供字节保真和失败不丢内容的测试。

## 项目结构

```text
src/core/             文档模型、目录树、大纲与保存状态
src/editor/           CodeMirror、Markdown 视觉模式与格式事务
src/components/       文件选择器与界面组件
src/platform/         桌面 / 浏览器文件适配
src-tauri/file-core/  独立 Rust 文件读写核心
src-tauri/src/        Tauri 命令、窗口、单实例与监听
scripts/              构建、打包、许可与验收工具
docs/                 研究记录与版本规格
```

## 许可与致谢

Leaf 使用 [Apache License 2.0](LICENSE)。感谢 [DBX](https://github.com/t8y2/dbx) 提供的编辑器实践参考，以及 Tauri、Vue、CodeMirror、Marked、Tailwind CSS 和 daisyUI 等项目。

来源和适用声明见 [NOTICE](NOTICE)。第三方依赖分别遵循其自身许可证，收集方式及限制见 [licenses/README.md](licenses/README.md)。
