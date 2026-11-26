# Leaf 验证记录

日期：2026-11-25～2026-11-26。验证环境：Windows 11，Node 24.12.0，pnpm 10.34.7，Rust/Cargo 1.99.0，Microsoft C++ Build Tools 14.44.35207，Windows SDK 10.0.26100.0。

## 已通过

- `pnpm test`：17 个公开接口测试通过（11 个文档行为 + 2 个目录树行为 + 4 个大纲解析行为）。
  - 未保存关闭保护、失败保存保留文本。
  - 保存期间继续输入仍保持新内容为 dirty。
  - Windows 路径去重不替换未保存文本。
  - 另存冲突必须显式覆盖；原文件删除必须显式重建。
  - 外部变更只提示，dirty 文档不能自动重载。
  - 编码/换行变动标为未保存，混合换行拒绝静默保存。
  - 标签编号、关闭非活动标签、写入期间不能关闭。
  - 成功保存清除过期外部变更提示。
  - 目录逐层懒加载，折叠后再次展开不重复读取；文件和符号链接不作为目录展开。
  - 较慢的旧目录请求不能覆盖后来打开的新工作区。
  - Markdown 代码围栏不产生错误标题；JS/TS 符号、JSON/YAML 键层级和行号正确。
  - 不支持语言及超过 2 MiB 的文档不做大纲解析。
- `pnpm build`：严格 TypeScript 检查与 Vite 生产构建通过。
- `pnpm test:e2e`：已安装 Google Chrome 中 4 个端到端测试通过。
  - 标签独立撤销历史、取消关闭保留文本。
  - 临时文件上传与导出，逐字节验证 UTF-8 BOM + CRLF。
  - 右下状态菜单确实向上展开；编辑器失焦后选区颜色仍与活动行明显不同；大纲点击跳转到正确行。
  - 查找/替换、浅/深主题、680×460 布局无页面横向溢出。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`：通过。
- Playwright MCP 实際打开页面并完成上述交互，console 无 error/warning。

截图：`artifacts/editor-light.png`、`artifacts/editor-dark.png`。

## 原生工具与文件模块

此前编译因缺少 `kernel32.lib` / `ntdll.lib` 等 Windows SDK import libraries 失败。经用户批准，已安装官方 Microsoft C++ Build Tools 2022 与 Windows SDK 10.0.26100.0，安装器退出码 0；原生环境脚本已验证能获取 x64 SDK/CRT 路径，并保留中文用户目录环境变量。

`pnpm test:native` 当前 **7 项集成测试全部通过**，只操作临时目录：

- UTF-8、UTF-8 BOM、UTF-16 LE/BE、GBK 与换行的逐字节保存/读回。
- 旧 hash / 目标已存在拒绝覆盖；原文件被删不自动重建。
- 不可表示 GBK、NUL、混合换行、只读失败时原文件不变。
- 无效编码、超限文件拒绝打开，父目录消失正确报告 missing。
- 编码/换行检测，包括中文 GBK。
- 连续覆盖已有文件完成原子替换，不残留临时文件。
- 目录枚举只返回一层、按文件夹/文件/符号链接排序，并拒绝把普通文件当目录。

实际修复：首轮原生测试有 1 项失败（后续回归复现为 2 项），错误为 Windows sharing violation 32。`ReplaceFileW` 调用前临时文件的开放句柄阻止重新打开；现改为关闭 `NamedTempFile` 句柄、保留 `TempPath` RAII 清理，再执行原子替换。修复后 6/6 通过。

Release 0.2.0 已成功构建，并完成新 ZIP 的真实解压运行验证。便携 profile、目录树、文件/大纲双视图、向上状态菜单、失焦选区、新 EXE 图标和原有文件安全检查均通过，记录见下方“0.2.0 当前便携包”。

诊断记录：

- `expect.poll` 回调遇到待重建文件的 `ENOENT` 会立即退出。新增原生字节等待回归，先观察 2 项失败；改为仅将 `ENOENT` 返回为待重试状态（不吞其他错误），修复后 2/2 通过，真实删除后显式重建也通过。
- `test-native-profile.mjs` 独立运行复现 `data/webview` 为空，实际 WebView 命令行指向默认 `%LOCALAPPDATA%/com.leaf.editor/EBWebView`。当前锁定的 `tauri-runtime@2.11.3` 从 `WindowConfig` 转换 `WebviewAttributes` 时未传递 `data_directory`；修正为通过公开 `WebviewWindowBuilder.data_directory()` 显式设置，并保留其他窗口配置。
- 更新图标后的首次 Cargo 增量构建仍嵌入旧占位图。`src-tauri/build.rs` 现显式声明 `icons/icon.ico` 与 `icons/icon.png` 为重建输入；重新构建后，从最终 ZIP 解压出的 `Leaf.exe` 提取关联图标，确认已嵌入新的“纸页 + 叶片”标识。

## 端口与打包脚本

- `pnpm test:ports`：2/2 通过。占用端口会跳过，原服务继续响应。
- 实际 `1430` 已被 PID 23528 占用，Leaf 开发服务成功绑定 `1431`；没有停止原监听器。
- 浏览器测试独立绑定 `1470`，先构建生产前端再启动静态 preview，测试结束关闭自有服务，不复用已有 listener，也不遗留开发模式文件监视句柄。
- `pnpm test:packaging`：12/12 通过（PE 解析/畸形输入、许可图遍历/缺失失败/版本固定补充、自定义许可文件、版本号与构建记录/双锁哈希、异步文件重建等待）。版本不匹配或缺少版本字段时拒绝打包，防止旧 EXE 被重新命名为新版本。
- PowerShell 5 的 UTF-8 无 BOM 中文解析问题已通过 ASCII 辅助脚本规避；构建、ZIP、解压、窗口检查脚本语法检查通过。辅助脚本已移除 `ExecutionPolicy Bypass`，按本机现有执行策略运行。
- 严格许可收集：326 个条目，检测到的 unresolved 为 0；保留完整正文及版本固定来源证据，MPL-2.0 依赖附 unmodified Source Code Form。收集成功不是法律认证。

## 0.2.0 当前便携包

交付文件：`releases/Leaf-0.2.0-windows-x64-portable.zip`，由当前 0.2.0 源码重新构建，不是改名旧包。

- ZIP：2,722,777 字节，约 2.60 MiB。
- ZIP SHA-256：`27725156f0d88593868b7ac2d22d6464c5ecac27d04c83d97bd89750feb76dd6`。
- EXE SHA-256：`ef088bed35090c77de173c8f6cf0a57e44975bbdeb82e064fbb258d7696fbfde`。
- `package.json`、Tauri 配置、两个 Rust 包和 Cargo 锁文件版本均为 `0.2.0`；Windows EXE 的 `FileVersion` / `ProductVersion` 实际读取均为 `0.2.0`。
- 包内 `manifest.json`、`build-info.json` 和使用说明一致标明 `0.2.0`，包含 `CHANGELOG.md`。未更新第三方依赖。
- 解压到全新 `artifacts/portable-ui-0.2.0-20261126/`，逐个验证 manifest 中 **86 个文件**的长度和 SHA-256；构建记录版本、实际 EXE 和两份当前锁文件的哈希一致。
- Windows x64 GUI、静态 CRT、内嵌 `custom-protocol` 检查通过；第三方许可 326 项，unresolved 0。
- 从实际解压的 EXE 提取图标到 `artifacts/leaf-0.2.0-embedded-icon.png`，已目视确认保留新的“纸页 + 叶片”标识。
- 本版本重新运行：核心 17/17、浏览器 4/4、Rust 文件模块 7/7、打包 12/12、端口 2/2；TypeScript / Vite 生产构建、Rust 格式和脚本语法检查通过。
- 独立便携 profile 检查通过：实际 WebView 使用包旁 `data/webview/EBWebView`，默认启动无 TCP listener。
- 从新解压包运行桌面验收 **17/17 通过**，覆盖目录懒加载/单击打开/去重、符号链接禁用、文件/大纲切换、选区、向上菜单、编码逐字节保存、冲突/只读/删除重建、单实例和关闭保护。
- 桌面记录：`artifacts/native-iHmjtd/results.json`，`passed: true`，无前端 pageerror/console error。已查看 `native-directory.png` 和 `native-outline-selection.png`。
- 验收完成后 Leaf 进程列表为空，1470/1432/1530 无残留 listener，原 `127.0.0.1:1430` 服务仍为 PID 23528；未停止或替换原服务。
- Release 构建保留了已有 Cargo PDB 同名警告；构建退出码为 0，实际 EXE 验收通过。此版本仍未签名，依赖系统 WebView2，不宣称已比 EditPlus 更快。

## 0.1.0 历史便携包

历史交付文件：`releases/Leaf-0.1.0-windows-x64-portable-20261126-020829.zip`。以下哈希和验收记录属于该预览包，不代表当前源码或 0.2.0 构建。

- ZIP：2,724,087 字节，约 2.60 MiB。
- ZIP SHA-256：`2e23479d7173b258c6a96205820e40c43e8ad19822b6ecd3fb17d0d6466a5d4d`。
- EXE SHA-256：`6a25deb7ea2701d020d2cb6b55844cd4aa5f7e7b3ea56eac21b7b553c0680099`。
- Windows ICO SHA-256：`d789b89b5833992651fc48f3f222af6e9d6855cfb1f7a7b7b666941c6b8a5741`；从解压包内 `Leaf.exe` 提取关联图标后，目视确认是新的“纸页 + 叶片”标识，而非旧占位图。
- PE：Windows x64 GUI；未导入动态 VC++ CRT DLL。前端通过 `custom-protocol` 内嵌。
- 二进制、构建时的 Cargo/pnpm 锁文件与构建记录哈希一致；当前 Cargo 锁文件已因 0.2.0 版本升级而变化。
- 解压到全新 `artifacts/portable-ui-20261126-020829/` 后，逐个验证 manifest 中 85 个文件的长度和 SHA-256；许可清单 326 项、unresolved 0。
- 实际运行的是解压包内 `Leaf.exe`，不是开发服务或仅调用文件核心。
- 更早的 0.1.0 ZIP 不包含这次历史 UI 验收涉及的界面改进；该预览包记录仍保留，但不作为 0.2.0 交付。

`test-native-profile.mjs`：通过。WebView2 进程命令行实际使用解压目录 `data/webview/EBWebView`，目录生成数据；正常启动无 TCP listener。

`test-native-ui.mjs`：**17/17 检查通过**：

1. 正常 Release 和 WebView 进程树无 TCP 监听端口。
2. 内嵌前端同时接收 Unicode/空格 argv 文件与工作区目录。
3. 目录树首次只读取一层；左键单击文件夹后才读取下一层，左键单击文件立即打开且重复单击不重复建标签；当前文件高亮。
4. 右下状态菜单在真实 WebView2 中向上展开；编辑器失焦后选区颜色仍与活动行不同；文件/大纲切换后单击标题跳转到正确行。
5. Windows junction 显示为禁用符号链接且不递归；关闭工作区目录不会关闭已打开标签。
6. 原位保存逐字节保留 UTF-8 BOM + CRLF。
7. 原生 watcher 提示外部修改，不静默重载编辑内容。
8. 冲突取消保留磁盘与编辑内容，显式覆盖成功。
9. 只读保存失败，原字节不变、未保存修改仍保留。
10. 单实例重复 argv 只打开一次；UTF-16 BE 保存逐字节一致。
11. 第二实例相对路径 GBK 中文打开和保存逐字节一致。
12. 原文件删除后，取消不创建；显式重建成功。
13. 混合换行保存前明确选择 LF。
14. 真实 WM_CLOSE 取消保留未保存文档和窗口。
15. 正常关闭退出，无驻留 Leaf 进程。
16. 便携 WebView 数据写在解压目录 `data/webview`。
17. 关闭后正常重开，再次验证无 TCP listener。

桌面记录：`artifacts/native-juL4Ts/results.json`，`passed: true`，无前端 pageerror/console error。已查看 `native-outline-selection.png`、`native-directory.png`、`native-light.png`、`native-dark.png`：文件/大纲标签、大纲层级与行号、失焦选区、目录树、浅/深主题均正常显示。

历史可重复性记录（新增本轮 UI 检查之前）：加入符号链接断言后的第一次复跑，目录相关断言已通过，但脚本因便携 profile 保留了上轮深色主题而找不到“切换深色主题”按钮。验收脚本改为启动后先归一到浅色，再切换深色；当时版本的同一解压包随后 16/16 重复通过。本轮新版包含新增 UI 检查，最终结果为上方记录的 17/17。

当时的最终检查：现有 `127.0.0.1:1430` 仍归 PID 23528；未停止原服务。浏览器测试端口 1470、1432 与测试 CDP 1530 均无残留 listener，Leaf 进程列表为空。测试用 CDP 只由自动化子进程环境临时启用，不在正式默认配置中启用。

## 没有做的验证

- 系统重启后冷缓存启动、键盘可输入延迟和内存基准；自动化观测时间包含连接/检查开销，不能用来比较 EditPlus。
- EditPlus 与 Leaf 同机器启动比较。
- 强制杀进程、崩溃恢复、目录级断电持久化、任意外部写入竞态测试。
- 原生打开/另存系统对话框与 OS 拖放的完整自动化；文件与目录打开使用 argv/单实例和真实目录树交互验证。
- 没有 WebView2 Runtime 的干净 Windows 虚拟机启动验证；便携包依赖系统 Runtime，不包含 Runtime 安装器。
- 混合换行逐行保持（首版不提供）。

下一阶段可进行同机器冷启动基准；此记录没有任何“比 EditPlus 更快”的结论。
