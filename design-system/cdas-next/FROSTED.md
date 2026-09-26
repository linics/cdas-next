# 雾面玻璃视觉合同（现行）

状态：绑定，自 2026-09-26 起取代 `CLASSICAL.md`（D-065）。任何教师端、学生端、管理员端、门页、对话框与悬浮助手面板的可见改动都必须遵守本文。

实现只有一个来源：`src/app/globals.css`。组件库是 shadcn/ui（radix-nova 预设），源码在 `src/components/ui/`，归本仓库所有，可以按本文修改。

## 命题

安静、耐看、带一点空气感的 K12 教学工作台。底是缓慢漂移的极光色雾，内容浮在半透明的玻璃面上；颜色用来区分层级和状态，不做装饰。

组合来源：配色取自 tweakcn 社区主题 Midnight Bloom 的淡紫 / 雾蓝 / 橄榄三色过渡，常规蓝紫主色换成深海青；材质参考苹果 Liquid Glass 的网页实现；动效取自 Magic UI（MIT）与 Motion（MIT）。Aceternity UI 的代码不是开源许可，只借鉴思路，不复制。

## 颜色

- 页面与组件只写语义类：`bg-primary`、`text-muted-foreground`、`border-border`、`bg-status-*` 等。**禁止**写死 `#hex`、`bg-zinc-900` 一类具体色值。
- 换主题 = 改 `globals.css` 里 `:root`（浅色）与 `.dark`（深色）两块变量；页面代码不动。
- 业务状态只用四档 `--status-*`，同一视觉重量（浅底 + 深字），状态文字写在标签里，颜色只做辅助：

| token | 含义 |
|---|---|
| `pending` | 等教师处理：待反馈、待评价 |
| `resubmit` | 等学生重交 |
| `done` | 已反馈、已评价、开放中 |
| `closed` | 已关闭、已封存、只读 |

- 极光色 `--aurora-1…4` 只作氛围，不承载信息。

## 材质

- 卡片、侧栏、主内容区、弹层统一用 `glass` 工具类（半透明底 + 背景模糊 + 顶部高光 + 柔和投影），圆角 `rounded-2xl`。
- 手写卡片也必须用 `glass`，不要再写 `rounded-xl border bg-card` 的平面盒子。
- 长时间阅读的内容（学生原文、任务书正文）放在较实的面上，不直接压在极光上。
- 系统开启「减少透明度」时玻璃自动退回不透明表面；强度只改 `--glass-*`。

## 字体与字号

- 全站只用思源黑体（Noto Sans SC），它自带匹配的拉丁字母与数字；等宽字体只给代码和参数摘要。字重只用 400 / 500 / 600。
- 字号阶按中文抬过：`text-xs` 13、`text-sm` 15（正文、按钮、表格、导航）、`text-base` 16、`text-lg` 18、`text-2xl` 26、`text-3xl` 32（统计数字）。
- 标题只用五个语义工具类：`type-page-title`、`type-section-title`、`type-card-title`、`type-body`、`type-caption`。禁止 `text-[15px]` 这类散值，数字用 `tabular-nums`，不用等宽字体。

## 组件与页面

- 优先用 `src/components/ui/` 的 shadcn 组件和 `src/app/_components/` 的共享件（`PageHeader`、`StatusBadge`、`EmptyState`、`InlineAlert`、`ConfirmDialog`、`AccessGateLayout`）。
- 大页面的原生元素通过「样式映射」统一外观：`teacher/teacher-ui.ts`、`student/releases/[releaseId]/submission-ui.ts`、`admin/admin-ui.ts`、`teacher/_components/assistant-ui.ts`。新增类名加进对应映射；映射里的按钮类必须经过 `cn()` 合并，否则描边会被透明边框盖掉。
- 不再新建 `*.module.css`。
- 页面标题区不放和面包屑重复的小字路径；说明文字只保留会改变操作结果的规则（确认后才保存、重交使确认失效、迟交标记等），不写复述标题的介绍。

## 导航

侧栏是浮动的圆角玻璃面板（收起为图标栏时同样圆角）。导航项三级：平时透明 → 悬停极淡中性底 → 选中主色浅底 + 主色字 + 加粗 + 左侧主色竖线，选中必须比悬停更显眼。选中底块在各项之间滑动（Motion 共享布局）。

## 动效

- 页面进场用纯 CSS 的 `Reveal` / `revealChildren`（上移、淡入、去模糊，依次 60ms），服务端渲染后立即播放，**不依赖脚本**；不要用需要脚本才显示内容的淡入组件。
- 统计数字用 `NumberTicker`：服务端先渲染真实值，动画卡住时 1.5 秒后直接落到真实值。
- 重点卡片可用 `BorderBeam` 流光，一页最多一处。
- 可点击卡片悬停轻微上浮。所有动效在「减少动态效果」下停止。
