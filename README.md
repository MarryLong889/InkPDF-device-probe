# InkPDF — 基于完整 Inkling 源码

**0.0.10**：完整 Inkling 基线版本。以 [Inkling](https://github.com/Bluewolf135/Inkling) 的完整项目为基线，固定提交 `80708d841457683abb58831b2a17ab97a7b201d4`（上游 1.0.1）。61 个业务源码文件与上游逐字节一致，不再以旧 InkPDF 探针为主体。保留原作者 William DeStefano 的 MIT 许可证。

**本版本沿用 Inkling 的方式，直接把批注写回所打开的 PDF。** 原先“PDF 只读、独立 JSON 保存”的约束已按用户最新决定取消。首次测试请使用 PDF 副本。

## 当前范围

完整保留上游 PDF 批注、工具栏、套索、图形、压感、连续页面、PDF 写入 Worker 和 Markdown ink blocks 等代码；这些是源码中存在的功能，并非已经在用户 iPad 全部验收。尚未添加手写转印刷体／中英文 OCR。上游“Extract annotations to a note”不能识别手写内容。

插件 ID 保留 `inkpdf-device-probe`，方便既有 BRAT 安装后续更新；显示名称为 `InkPDF (Inkling base)`。内部命令、视图及部分界面保留 Inkling 名称，避免改变上游行为。不要同时启用本插件与原版 Inkling，两者注册相同视图／代码块。

旧 `InkPDF-Probe` 数据不会删除，也不会自动导入本版本。旧探针入口和诊断导出已随完整基线替换，不再提供。

## 构建与验证

要求 Node.js >=22.22.2：

```sh
npm ci --ignore-scripts
npm run build
npm test
```

PDF.js 与 PDF 写入 Worker 都内联在 main.js 中，安装和 Release 仍只有 `main.js`、`manifest.json`、`styles.css`。main.js 约 2.52 MB，包含上游及随包 PDF 依赖的许可文本。依赖版本沿用上游锁文件。

构建及类型检查通过，767 项测试通过、0 失败，2 项需要外部真实 PDF 样本库的测试跳过。见 [验证摘要](docs/BASELINE_VALIDATION.json)。尚未在真实 Obsidian、iPad 或 Apple Pencil 上验证本基线。

- [iPad 安装与验收](docs/IPAD_INKLING_BASELINE.md)
- [来源、修改和恢复说明](docs/FORK_BASELINE.md)
- [上游原 README](docs/UPSTREAM_README.md)

后续先根据 iPad 测试确定缺项，再基于本源码补齐。手写识别为已确认缺项，需独立验证识别引擎、模型许可、离线能力和中英混合效果，未接入任何云端识别服务。
