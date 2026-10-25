# InkPDF 0.0.1 最小设备探针：iPad 安装与测试

适用本轮设备信息（用户提供，尚未实测）：iPad Air、Apple Pencil 二代、iPadOS 27.0、Obsidian 最新版、GitHub 同步仓库。iPad Air 的具体代数和 Obsidian 精确版本待报告补全。探针会记录运行中的 Obsidian API 版本、PDF.js 版本与 userAgent；userAgent 不能可靠替代 iPadOS 设置页版本。

这不是完整 InkPDF。只测试一个合成 PDF、单笔输入、工具栏缩放、独立保存重开、Blob module Worker 和基础 WASM。没有 OCR、擦除、撤销、套索、多页、手指捏合、PDF 导出。写入模式手指不会画也不滚动；需要导航请切换“浏览”。

## 1. 安装包与路径

项目 `release/InkPDF-device-probe-0.0.1.zip` 是 **vault 目录叠加包**，内含：

```text
.obsidian/plugins/inkpdf-device-probe/
  main.js
  manifest.json
  styles.css
InkPDF-Probe-安装与测试.md
InkPDF-Probe-结果模板.md
```

只添加这个新插件目录和两份说明；不含 community-plugins.json、workspace.json 或账号配置，不会替换整个 `.obsidian`。合成 PDF 已内置，无需另传 PDF 或安装 Node/npm。手工复制也可使用 `dist/inkpdf-device-probe/` 的三个文件。

使用一个独立测试 vault。不要把包含 research、node_modules、其他项目资料的整个开发目录放进测试仓库。首次开始前确保 iPad 已在同一个测试 vault 中。

## 2. 通过现有 GitHub 同步流程安装

1. 在电脑打开**测试 vault 对应的 Git 工作目录**，将安装 ZIP 解压至其根目录。确认得到 `<vault>/.obsidian/plugins/inkpdf-device-probe/main.js`，不能多套一层 ZIP 文件夹。
2. 如果测试 vault 配置了自定义配置文件夹（例如 `.obsidian-mobile`），把插件目录放入那个配置目录的 `plugins/`，下面命令也相应替换。
3. 检查 Git 是否忽略 `.obsidian`。以下命令只暂存探针三个文件和说明，不添加其他插件设置、密钥或正式笔记。命令应在你的测试仓库根目录运行：

```powershell
git status --short
git check-ignore -v .obsidian/plugins/inkpdf-device-probe/main.js
git add -f -- .obsidian/plugins/inkpdf-device-probe/main.js .obsidian/plugins/inkpdf-device-probe/manifest.json .obsidian/plugins/inkpdf-device-probe/styles.css
git add -- InkPDF-Probe-安装与测试.md InkPDF-Probe-结果模板.md
git diff --cached --stat
```

确认暂存区只有预期文件后，再使用你现有的 Git 工作流提交并推送。本文不替你执行 push；没有提供远程仓库地址，也没有上传任何测试内容。不要为安装探针执行 `git add .` 或整体同步个人 `.obsidian`。

4. 在 iPad 用现有 Git 同步工具拉取。GitHub 网页/App 能看到文件不代表 Obsidian 已收到；Git 客户端必须把上述文件写到 **Obsidian 正在打开的同一个 vault**。若你的工具排除隐藏目录，需要允许该插件目录；若无法写入该 vault，先解决客户端的文件访问，不要反复重装探针。
5. 完全退出并重新打开 iPad 上的 Obsidian。进入“设置 → 第三方插件/Community plugins”，允许社区插件后，在已安装插件列表启用 **InkPDF Device Probe**。不需要在社区商店搜索，当前没有公开上架，也无需 BRAT。
6. 打开命令面板，运行 **InkPDF Device Probe: 打开 / 继续设备探针**。首次会新建测试会话。也可使用侧栏笔形图标。

若看不到插件：先检查文件是否位于当前配置目录、manifest 是否为 0.0.1、三个文件是否齐全，再重启；不要复制整份别的设备配置来尝试修复。

安装位置和启用流程依据 [Obsidian 插件开发文档](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)；配置目录说明见 [Obsidian 数据存储文档](https://obsidian.md/help/Files%2Band%2Bfolders/How%2BObsidian%2Bstores%2Bdata)。GitHub 同步客户端尚未指定，因此没有假定它会自动同步隐藏目录。

## 3. 约 10 分钟验收步骤

| 步骤 | 操作 | 通过标准 / 要记录的内容 |
|---|---|---|
| A 打开 | 运行探针，等待初始化 | 看见英文标题 InkPDF、横线和 A/B/C/D 十字；无红字或“失败”；不是空白 canvas |
| B Worker | 查看能力栏；点击“复测 Worker” | `Blob module Worker + 基础 WASM：PASS`；若 FAIL 仍记录，不代表 PDF/笔迹一定失败 |
| C Pencil | 书写模式在十字和横线上写20笔，包含点、快线、慢线 | 数量增加且无明显断笔；手指触摸不增加笔数；用 Pencil 轻压/重压各画几笔 |
| D 掌触 | 手掌自然放屏幕上，用 Pencil 书写 | 没有手掌产生的多余笔画；系统 Scribble 若干扰，先记录，再关闭系统随手写复测 |
| E 缩放 | 点击150%/200%，切“浏览”用手指滚到下方，再切回书写 | 旧笔迹仍对齐十字；新增笔迹对齐落笔位置；不是在书写模式测试手指捏合 |
| F 保存读回 | 等“已保存并读回校验”，点“保存并重新读取” | 笔数相同、位置相同、无读取错误 |
| G 关闭重开 | 关闭这个标签页，再运行“打开 / 继续设备探针” | 原20笔保留；不要点“新建独立设备测试”来做重开测试 |
| H App 重启 | 保存完成后强制退出 Obsidian，重新打开同一 vault 并运行探针 | 原笔迹数量和对齐保留；导出诊断中 loadedFromDisk.strokeCount 正确 |
| I 横竖屏 | 分别横屏、竖屏或分屏，然后返回 | 重新适配后旧笔迹位置不漂移；旋转过程中在写的笔可能标记 interrupted，不能连到下一笔 |
| J 断网 | 飞行模式重新打开已有测试 | PDF、书写、保存和 Worker 仍工作；Git 同步暂停不影响本机保存 |
| K 导出 | 点击“导出诊断” | 在 vault 的 InkPDF-Probe/ 下出现 diagnostic-*.json |

“Worker PASS”只证明 Blob module Worker 往返通信与一个最小 WASM 模块实例化，**没有证明 SIMD、ONNX Runtime 或 OCR 模型可运行**。

诊断 pointer.pressureMin/Max 若不同，说明本次事件上报了压力变化；若相同，不能判断真实压感已通过。重启后 pointer 统计重新计数，建议在重启前后各导出一次。手掌测试、Pencil 体验、强制退出仍需在结果模板里手填，JSON 不会自动把它们标为 PASS。

## 4. 数据位置、保存保证与失败处理

```text
InkPDF-Probe/
  <run-id>/
    probe.pdf
    snapshots/000001-<id>.json
    snapshots/000002-<id>.json
  diagnostic-<time>-<id>.json
```

每个已结束笔画触发保存队列；连续快写可能合并成同一快照，revision 不必等于笔数。快照只新增、不覆盖，包含前序内容 hash；写后读回并检查快照链才显示“已保存”。每份快照包含完整当前笔迹，T1 允许200笔、单笔10,000点、总100,000点，不适合长时间课堂记录。到达上限可导出结果，再通过命令“新建独立设备测试”建立新 run。

笔迹永远不写回 PDF。JSON 未通过校验、源 PDF 变化或检测到同步分叉时停止编辑，保留文件。不会自动删除“损坏”文件，也不会把读取失败当空白测试。数据格式是 `probeFormat:1`，不是已经冻结的正式 InkPDF v1。

尚未实现 T3 的完整恢复日志、跨设备合并和正式备份策略。系统强制结束可能丢失尚未显示“已保存”的笔画；任何内存中的失败笔迹在关闭 App 后仍可能丢失。失败时先保持 App 开启、点击“保存 / 重试”并导出诊断，不删除快照、不手改 revision。

此阶段只在一台设备上写同一个 run。电脑仅安装/传输；若电脑也想做输入测试，请先运行“新建独立设备测试”，并避免两个设备同时续写一个 run。Git 拉取期间不要书写；先完成保存、关闭探针、拉取所有 JSON 后再打开。Git 同步可能出现普通文件冲突，插件不能提供跨设备事务锁。

诊断不包含笔迹坐标/PDF字节，保存在本地；但快照包含完整测试轨迹。插件本身没有网络上传代码，不过你现有的 Git 自动提交/推送可能上传 `InkPDF-Probe/`，因此只写无隐私测试内容，或先在 Git 中排除该目录。若需要核验电脑↔iPad同步，再明确允许同步测试快照。

## 5. 回传与后续

把测试前后两份 diagnostic JSON 和填写后的结果模板提供给当前对话即可；必要时附页面截图。无需提供整个 vault、账号密钥、Git Token 或正式 PDF。

如果只有 Worker 失败，先回传错误；不改为云识别。若 Pencil 完全无输入，记录 Scribble 状态和诊断 pointer 计数。若 PDF 不显示，诊断中的 pdfjsVersion 和 errors 是优先证据。

完成本轮测试后，只有 PDF/Pencil/保存重开三项真机通过才推进 T2/T3；Worker 失败时单独修复或明确识别限制。本轮不展开全部功能。

卸载：先保存并导出结果，在第三方插件中禁用探针。删除插件目录不会删除 InkPDF-Probe 数据；确认不再需要后再自行清理该测试目录。
