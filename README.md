# InkPDF 最小设备探针

当前本地版本 0.0.4，新增仓库真实 PDF 第 1 页的只读打开、独立笔迹关联和保存重开。仍不是完整 PDF 批注或 OCR 插件。

本阶段 iPad 测试步骤：[docs/REAL_PDF_0.0.4.md](docs/REAL_PDF_0.0.4.md)。0.0.3 实机基线：[docs/IPAD_ACCEPTANCE_0.0.3.md](docs/IPAD_ACCEPTANCE_0.0.3.md)。

## 构建与检查

在本仓库根目录运行（Node.js 22）：

```sh
npm ci
npm run build
npm test
npm run test:browser
```

浏览器测试需要 Playwright Chromium，可执行 `npx playwright install chromium`，或设置 INKPDF_CHROMIUM 为已有 Chromium 可执行文件路径。测试使用本机模拟宿主，不替代 iPad 验收。

src 是可维护源码；build 直接更新根目录 main.js。PDF.js 仅为浏览器测试依赖，实际插件调用 Obsidian loadPdfJs，不打包 PDF.js。合成测试 PDF 内嵌 main.js。

## BRAT 发行

插件 ID 保持 inkpdf-device-probe。发行资产严格为 main.js、manifest.json、styles.css 三个文件；源码、测试、文档不放入 Release 资产。

现有工作流在 main 的核心文件变化时，按 manifest 版本发布 GitHub Release。发布前必须使 package.json、package-lock.json、manifest.json 版本一致并通过测试。已存在版本不覆盖，应使用新版本。

0.0.2 保留旧快照格式和旧笔迹显示，新增笔迹可带 pressureGain。安装更新前先保存并备份测试数据。探针数据在 vault 的 InkPDF-Probe 目录，源码仓库不包含用户测试数据。
