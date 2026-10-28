# 完整 Inkling 基线切换记录

日期：2026-10-28。用户明确选择完整 Inkling 源码作为基础，并同意沿用其 PDF 写回方式。这替代此前局部移植和原文件只读的方案。

## 来源与改动

上游：https://github.com/Bluewolf135/Inkling

固定提交：80708d841457683abb58831b2a17ab97a7b201d4，版本 1.0.1，MIT（William DeStefano）。src、tests、styles.css 和上游文档从该提交整体复制；源码哈希清单见根目录 UPSTREAM.json。本次没有保留自写探针的批注／保存／拟合实现。

针对本仓库仅修改：

- manifest、package/lock 和 versions：本地版本 0.0.10、保持旧插件 ID，包名 inkpdf-inkling，显示名 InkPDF (Inkling base)。最低 Obsidian 1.13.0。
- esbuild：发布包内保留 Inkling MIT 和 PDF 依赖许可证。上游两个内联 Worker 与业务逻辑不变。
- vitest：URL 转本机路径用 fileURLToPath，修正 Windows 盘符路径；不修改业务测试断言。
- README、来源记录、验证摘要和 iPad 验收说明。
- 保留本仓库三资产 Release 工作流，改正发布说明中的保存语义。main 推送会自动发布 manifest 对应版本，本次用户已授权推送 main 并公开发布 0.0.10，仅附三个安装文件。
- 忽略本地归档和临时测试输出；src 的 Git 属性保留原始字节，便于核对来源哈希。

构建已通过，main.js 2,520,067 字节。767 项测试通过，2 项外部 PDF 样本库测试跳过，无失败。原探针的 62 项／23 组检查不适用于新基线，不能冒充新版本设备验证。完整测试输出在本地 .test/inkling-full-results.json，便携摘要在 BASELINE_VALIDATION.json。

## 保存与兼容性

沿用 src/pdfView.ts 的 saveDirtyPages、PDF writer Worker 和 vaultWrite；批注以 PDF 标准注释写回文件。界面和保存节奏均为上游行为。不要继续按旧探针的独立快照规则理解此版本。

旧 InkPDF-Probe 侧车数据未读取、删除或迁移。升级后旧探针笔迹不会自动显示；保留原数据，需查看时可恢复旧版本。不要同时启用原版 Inkling 与本分支，避免重复注册视图和 inkling 代码块。

## 可恢复归档

切换前完整工作目录（含尚未提交的局部移植 0.0.10、文档、根目录安装文件）已移入：

`.local-backup/pre-inkling-full-20261028/`

该目录在当前仓库内，已加入 gitignore，不会发布；不含 node_modules、.git、.test 和 .github。它保存了此前尚未提交的内容，不能只用 Git 标签替代它。历史已发布版本仍在 Git 中；切换前 HEAD 为 8ee0dd91af07c948795419d9cb6913dc22025f83（0.0.9）。本次未操作任何 Obsidian vault 或真实 PDF。

如需恢复：先停用插件并保留当前工作，再从归档复制旧代码及三安装文件。不要删除用户 vault 的 InkPDF-Probe 目录。旧插件不会理解新 PDF 内全部 Inkling 编辑语义，恢复仅是查看旧探针数据的方法。
