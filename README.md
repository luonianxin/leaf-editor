# Leaf · 轻页

基于 DBX 现有编辑器实践重新划分出的独立本地文本编辑器。主工程的源码、依赖和构建脚本不需要修改；此目录有自己的 pnpm / Cargo workspace 与 lockfile。

**目标是轻量冷启动，不是已经证明比 EditPlus 更快。** 不加载数据库、插件、AI、更新器或托盘，也不设计后台预热或驻留机制。

## 已验证的免安装包

[Leaf 0.4.0 Windows x64 便携 ZIP](releases/Leaf-0.4.0-windows-x64-portable.zip)，[SHA-256 校验文件](releases/Leaf-0.4.0-windows-x64-portable.zip.sha256)。正式包已从全新目录解压并完成 manifest、便携 profile、真实 EXE 文件安全与 Markdown 表格交互验收；详情见 [VERIFICATION.md](VERIFICATION.md)。

0.2.0 历史包与 0.3.0 候选记录仍保留，不覆盖既有产物。已知限制：Leaf 主进程正常退出后，WebView 子进程曾间歇超过 15 秒才退出；0.4.0 正式验收本轮两次清理均在 1 秒内完成，但不据此宣称该间歇问题已根治。

## 版本记录

当前正式版本为 **0.4.0**；增加应用内文件/目录选择器、同一 CodeMirror 文档上的 Markdown 源码/预览编辑，以及安全的 GFM 表格渲染与对应源码定位。具体变更与限制见 [CHANGELOG.md](CHANGELOG.md)。

## 运行

在这个目录内：

```bash
pnpm install
pnpm dev:web       # 浏览器预览；优先 1430，被占用时自动换端口
pnpm dev           # Tauri 桌面开发版；实际绑定后传入 devUrl
pnpm build         # 类型检查 + 前端生产构建
pnpm build:desktop # Windows x64 Release，不安装/不注册文件关联
pnpm package:portable # 构建并生成带校验码的 ZIP
```

从 DBX 根目录也可以直接使用：

```bash
pnpm --dir file-editor dev:web
pnpm --dir file-editor dev
```

Windows 桌面构建需要 Rust MSVC、Visual Studio C++ Build Tools（含 Windows 10/11 SDK）以及 WebView2 Runtime。2026-11-25 已安装官方 Build Tools 2022 与 Windows SDK 10.0.26100.0，构建脚本自动获取 x64 开发环境；原生测试和 Release 构建结果见 `VERIFICATION.md`。仅使用便携包时不需要 Rust、Node 或 Build Tools。

## 端口与便携模式

- **正式 Release 不启动 Vite 或 HTTP 服务。** `tauri.localhost` 是 WebView2 内嵌协议地址，不是本地 TCP 监听器。
- `pnpm dev:web` / `pnpm dev` / `pnpm preview` 从 `1430` 开始选择可用端口，先实际绑定，再把 URL 交给桌面窗口。**不会停止占用端口的其他程序。** 用 `LEAF_PORT` 或 `--port` 指定起点：

  ```bash
  LEAF_PORT=32000 pnpm dev
  pnpm dev:web --port 32000
  ```

- 浏览器测试从 `1470`（`LEAF_TEST_PORT` 可修改）开始，创建并关闭自己的服务，不复用已有监听器。
- 便携包放在 `releases/`，含 `Leaf.exe`、`portable.flag`、使用说明、更新日志、LICENSE/NOTICE、第三方许可、MPL 依赖源码、文件清单和 ZIP SHA-256。打包前核对版本号、二进制、Cargo/pnpm 两份当前锁文件与构建记录；版本或哈希不一致、许可正文缺失时拒绝打包。
- 解压整个文件夹到可写目录，再运行 `Leaf.exe`。`portable.flag` 启用 `data/webview` 下的主题/浏览器配置缓存；`LEAF_DATA_DIR` 可显式指定数据根目录。不注册文件关联、不建立开机启动项。
- 包不内置系统 WebView2 Runtime；x64 GUI、导入 DLL 与静态 CRT 标志会在打包前交叉检查。Windows 11 通常已有 WebView2；缺失时请从微软官方安装 Runtime。程序为未签名早期版本，不要关闭安全软件运行。

## 已实现的范围

- 多标签；每个标签独立 CodeMirror `EditorState`，含撤销历史、光标和滚动位置。
- 打开文件、打开目录或拖放；打开操作使用应用内选择器，支持路径、面包屑、文件多选和目录导航。目录树只读取当前层，展开文件夹时按需读取下一层，左键单击文件立即打开。
- 目录中的文件夹优先排序；符号链接显示但不递归进入；关闭工作区目录不会关闭已打开标签。
- 保存 / 另存为；未保存关闭确认。
- 查找与替换、撤销重做、跳行、行号、折叠、自动缩进、软换行。
- 左侧“文件 / 大纲”双视图；大纲支持 Markdown 标题、JS/TS 类与函数、JSON/YAML 键、HTML/XML 标题或带 id 元素、SQL 对象，单击跳转到对应行。
- 右下角编码、换行和语法语言使用统一的向上弹出菜单；键盘方向键/Enter/Escape 可操作。
- 编辑器聚焦和失焦时都保留可辨认的文本选区，状态栏显示选中字符数。
- 浅/深主题；TXT / JS / TS / JSON / Markdown / HTML / XML / YAML / SQL 按需加载语法。
- 简化后的“纸页 + 叶片”矢量标识同步用于界面和多尺寸 Windows 可执行文件图标。
- Markdown 文件可在左下角切换源码/预览模式；两种模式使用同一文档和撤销历史。预览模式仍可编辑，GFM 表格显示为真实表格，点击后定位并编辑对应源码。
- UTF-8、UTF-8 BOM、UTF-16 LE/BE、GBK；LF / CRLF / CR。
- 外部修改 / 删除提示；重新载入、保留、另存；保存时校验已知磁盘 hash。
- 同目录临时文件 + flush/sync + 原子发布，避免直接截断原文件；新目标使用 no-clobber。
- Tauri 单实例、argv 文件/目录打开队列、打开文件所在目录的监听。
- 编辑核心就绪埋点；未做系统冷启动基准。

**浏览器预览限制：** 可以选择文件并编辑、导出副本，但不能覆盖原路径或监听磁盘。因此导出后不把文档标记为已保存，关闭时仍保护未保存内容。GBK 可以读取，但浏览器不能安全写出 GBK；使用桌面版，或明确选择 UTF-8 后导出。

## 安全与首版限制

- 首版最大单文件 16 MiB，超过 2 MiB 的文本不启用语法或大纲解析；不是超大日志编辑器。
- 检测到 NUL / 无效编码会拒绝打开。不是完善的二进制格式检测器。
- 混合换行只记录为 `mixed`，内部统一为 LF；保存前必须明确选择统一换行。**首版不支持逐行保留混合换行。**
- UTF-16 两种保存格式都带 BOM；没有 BOM-less UTF-16 保存模式。
- 编码菜单控制保存编码，不是“重新按此编码解码磁盘文件”。
- hash 的最终复查不是跨进程原子 CAS：另一个程序仍可能在最终检查和替换间写入。原子发布防止半文件，不保证阻止所有外部竞态；无断电后目录级持久化保证。
- 不做崩溃/强制结束后的未保存恢复、历史工作区恢复、全目录搜索、LSP/插件。目录树仅在用户展开时逐层读取，不预扫描整个目录；正常关闭保护不能代替崩溃恢复，请先用副本验证。
- Markdown 预览不执行原始 HTML、不加载图片且链接不导航；不支持 Mermaid、公式或直接编辑渲染后的表格单元格。超大文档、超大表格及嵌套表格回落为源码。
- 已知 WebView2 子进程偶有延迟退出；本版不把一次通过视为根因修复。若关闭后短时间内仍看到 `msedgewebview2.exe`，请先确认其命令行 profile 是否属于 Leaf，避免误判其他应用的 WebView 进程。
- Windows 的 `ReplaceFileW` 已通过临时目录原生测试（含连续覆盖），不是只写了代码；监听和单实例的窗口验证状态见 `VERIFICATION.md`。

## 测试

```bash
pnpm test           # 文档操作公开接口
pnpm test:ports     # 占用端口跳过；不结束原服务
pnpm test:packaging # PE 架构/依赖和许可收集器
pnpm test:e2e       # 浏览器交互；独占测试服务
pnpm test:native    # Rust 文件模块，含 Windows 原子替换
pnpm test:native:ui /absolute/path/to/extracted/Leaf.exe # 实际便携 Release 窗口
pnpm test:native:profile /absolute/path/to/extracted/Leaf.exe # 真实 WebView 配置路径与无监听
```

浏览器测试使用临时上传/下载，不会覆盖用户磁盘文件；截图输出到 `artifacts/`（已忽略）。原生测试只操作系统临时目录。

## 模块

```text
src/core/             文档模型、保存版本与内容安全
src/editor/           CodeMirror 宿主、独立标签状态、按需语言
src/platform/         桌面/浏览器文件 adapter
src/App.vue           操作、标签、对话框、原生事件
src-tauri/file-core/  不依赖 Tauri / DBX 的 Rust 文件模块
src-tauri/src/        最小 Tauri 窗口、命令、单实例、监听
```

## 冷启动测量（下一阶段）

使用 Release 包，与 EditPlus 在同一机器、电源模式与安全软件状态下打开相同文件。分别记录系统重启后的第一次启动、完全退出后重开、已运行时打开文件；后两者不能称为真正的系统冷缓存。

主指标是“启动进程 → 文件显示 → 可输入”，不是窗口可见或 gzip 大小。现有 `report_editor_ready` 输出 `nativeMs/frontendMs`，只记录编辑核心挂载和双帧等待，**不是首次真实键盘输入延迟**。不要用浏览器/Vite 开发版时间推断桌面冷启动。

## 来源与许可

本工程参照 DBX 的 CodeMirror 标签状态、编码读写、保存冲突和外部变化处理实践，但没有依赖 `dbx-core`、`QueryTab` 或 `queryStore`。DBX 与本工程采用 Apache-2.0；再分发时保留来源、适用许可和 NOTICE（见本目录）。
