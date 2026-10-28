import type { SettingDefinitionItem } from 'obsidian';

const chinese: Record<string, string> = {
 'Eraser mode': '橡皮擦模式',
 'Pixel eraser': '像素擦除', 'Whole-stroke eraser': '整笔擦除',
 'Pixel eraser removes part of a stroke. Whole-stroke eraser removes every touched stroke. Applies to PDFs and ink blocks.': '像素擦除只擦掉笔迹的一部分；整笔擦除会删除碰到的整条笔迹。对 PDF 和 Markdown 手写块均生效。',
 'Handwritten notes': '手写笔记', 'Default template': '默认模板',
 'The ruling a new handwritten note starts with.': '新建手写笔记使用的纸张底纹。',
 'Blank': '空白', 'Lined': '横线', 'Dot grid': '点阵', 'Letter': '美式信纸（Letter）',
 'Page size': '纸张尺寸', 'The paper size for new handwritten notes and for pages added to them.': '新建手写笔记及新增页面使用的纸张尺寸。',
 'Pen': '钢笔', 'Pressure sensitivity': '压感',
 'Vary a pen stroke’s width with how hard the stylus presses. Has no effect on a mouse.': '根据手写笔压力调整笔迹粗细；对鼠标无效。',
 'Stroke smoothing': '笔迹平滑', 'Fit a curve through the pen’s samples instead of joining them with straight lines.': '将采样点拟合为平滑曲线，而非逐点连接直线。',
 'Shape recognition': '图形拟合', 'Hold the pen still at the end of a stroke to snap a rough circle, box or line to a clean one.': '在一笔结束处保持笔尖不动，将手绘圆、方框或直线拟合为规则图形。',
 'Hold to snap': '停笔拟合', 'Off': '关闭', 'Reading and editing': '阅读与编辑',
 'Invert PDF pages': '反转 PDF 页面颜色',
 'Darken the PDF page, and invert the ink on it so it stays readable. Off by default: the toolbar’s contrast button flips one document without changing this.': '将 PDF 页面变暗，并反转笔迹颜色以保持可读。默认关闭；工具栏的对比度按钮只切换当前文档，不改变此设置。',
 'Never': '从不', 'Follow theme': '跟随主题', 'Always': '始终',
 'Start with the toolbar collapsed': '打开时折叠工具栏',
 'Useful on a phone, where the full tool strip covers a real slice of the page.': '适合小屏设备，减少工具栏占用的页面空间。',
 'Ink block captions': '手写块说明',
 'Adds a line under each ink block for a short description, so a page of handwriting reads as something in search results and to a screen reader. A block that already has a caption always shows it, whether or not this is on.': '允许在手写块下添加简短说明，便于搜索和屏幕阅读器读取。已有说明始终显示，不受此开关影响。',
 'Save frequency': '保存频率', 'Automatic': '自动', 'Frequent': '频繁',
 'Automatic scales how often a PDF is written to its size, so a large textbook is not rewritten every few seconds. Frequent saves every ten seconds whatever the size.': '自动模式根据 PDF 大小调整写回频率，避免频繁重写大文件。频繁模式不论文件大小，每十秒保存一次。',
 'Ink blocks': 'Markdown 手写块', 'Where new ink files go': '新手写数据文件的位置',
 'An ink block keeps its drawing in a file of its own, one per note, so the note stays text. This decides where that file is created. Changing it never moves a file that already exists.': '每篇笔记的手写块使用独立数据文件，让笔记保持为文本。此设置决定新文件的创建位置；修改后不会移动已有文件。',
 'Same folder as attachments': '使用附件文件夹', 'Same folder as the note': '与笔记同一文件夹', 'A folder of their own': '指定独立文件夹',
 'Ink file folder': '手写数据文件夹',
 'To keep ink files out of search and the graph, add this folder to Files and links, Excluded files.': '若不希望手写数据出现在搜索和关系图谱中，请将此文件夹加入 Obsidian“文件与链接”的“排除文件”。',
 'Extracted notes': '提取的笔记', 'Note path': '笔记路径',
 'Where an extracted note goes. {folder} and {name} come from the PDF. Must contain {name}.': '提取结果的保存路径。{folder} 和 {name} 来自 PDF；必须包含 {name}。',
 'Must contain {name}, or every PDF would share one note.': '必须包含 {name}，否则所有 PDF 都会写入同一篇笔记。',
 'Colour categories': '颜色分类', 'What each colour means': '各颜色的含义',
 'For the pen and the highlighter alike. These become the headings in an extracted note.': '同时用于钢笔和荧光笔；分类名称会成为提取笔记中的标题。',
 'Ink': '墨色', 'Gold': '金色',
 'Black': '黑色', 'White': '白色', 'Red': '红色', 'Orange': '橙色', 'Yellow': '黄色', 'Green': '绿色', 'Blue': '蓝色', 'Purple': '紫色', 'Pink': '粉色', 'Gray': '灰色', 'Grey': '灰色', 'Cyan': '青色', 'Teal': '蓝绿色',
};

export function settingsText(language: 'en' | 'zh-CN', text: string): string {
 return language === 'zh-CN' ? chinese[text] ?? text : text;
}

// Translate only presentation fields, never keys, stored values or user labels.
export function translateSettings(items: SettingDefinitionItem[], language: 'en' | 'zh-CN'): SettingDefinitionItem[] {
 const t = (text: string) => settingsText(language, text);
 for (const item of items) {
  if ('heading' in item && typeof item.heading === 'string') item.heading = t(item.heading);
  if ('name' in item && typeof item.name === 'string') item.name = t(item.name);
  if ('desc' in item && typeof item.desc === 'string') item.desc = t(item.desc);
  if ('items' in item && item.items) translateSettings(item.items, language);
  if ('control' in item && item.control?.type === 'dropdown') {
   item.control.options = Object.fromEntries(Object.entries(item.control.options).map(([key, value]) => [key, t(value)]));
  }
  if ('control' in item && item.control?.type === 'text' && item.control.key.startsWith('colorLabels.') && item.control.placeholder) {
   item.control.placeholder = t(item.control.placeholder);
  }
 }
 return items;
}
