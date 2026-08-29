# Classical 视觉合同（现行）

状态：绑定。任何教师端、学生端、门页、对话框、悬浮 Agent 面板的可见改动都必须遵守本文。

`design-system/cdas-next/MASTER.md` 是 UI-201 历史稿（海军蓝实底按钮、系统无衬线）。**不要按 MASTER 画新界面。** 现行实现与 token 以 `src/app/globals.css` 的 `:root` 为准。中文适配只允许本文写明的三处，禁止再发明第四套字号或颜色。

## 命题

安静、可信、纸面感的 K12 教学工作台。色是笔画不是填充。唯一允许填色的实底是 `--color-surface` / `--color-bg` 工作面，以及破坏性确认之外不引入调色板外的红/绿大色块。

## 必须使用的 token

禁止在组件里新写 hex、新写字号 px、新写间距 px。只引用：

| 角色 | Token |
|---|---|
| 页底 / 卡底 | `--color-bg` `#f3f2f2`、`--color-surface` `#eae9e9` |
| 正文墨 | `--color-text` `#201f1d` |
| 金赭强调 | `--color-accent` / `--color-accent-2` 及 100–900 阶 |
| 中性阶 | `--color-neutral-100` … `--color-neutral-900` |
| 分割线 | `--color-divider` |
| 间距 | `--space-1`…`--space-8`（4 / 8 / 12 / 16 / 24 / 32） |
| 圆角 | `--radius-sm` 2px、`--radius-md` 4px、`--radius-lg` 7px |
| 阴影 | `--shadow-sm/md/lg`，弹层才用 `--shadow-lg` |
| 动效 | `--motion-fast` 160ms、`--motion-medium` 240ms，曲线 `cubic-bezier(0.23, 1, 0.32, 1)`；只用于 hover 色、focus、按压缩放、确认框与 Agent 面板 |
| 层级 | `--z-nav` 20、`--z-overlay` 100 |

字号只写角色名：`--text-display` 42、`--text-title` 32、`--text-card` 25、`--text-section` 20、`--text-subhead` 16、`--text-body` 16、`--text-ui` 15、`--text-meta` 14、`--text-label` 13、`--text-kicker` 12。窄屏只把 `--text-display` 降到 `--text-title`。

字体：标题 `--font-heading`（Cormorant + Noto Serif SC），正文 `--font-body`（Lora + Noto Serif SC），按钮/标签/表头 `--font-ui`（Noto Serif SC）。不用无衬线系统栈做产品 UI。

## 中文适配（仅此三处）

1. 界面小字下限抬一档（kicker 12、label 13）；正文颜色最浅到 `--color-neutral-700`。
2. 按钮内边距按中文行盒略收；主操作仍是描边，不是海军蓝实底。
3. 计数、版本、表头与待办大数字用 `--figure-ui`（`tabular-nums lining-nums`），大号计数用 `--font-ui`。禁止用 Cormorant 默认旧式数字：其中的 `1` 像矮罗马 I，与 `3` 不同高。

禁止再把密度改回 1.15×，禁止再引入 10/11px 中文。

## 控件

- **主按钮**：`1px solid var(--color-accent)`，背景透明，字 `--color-accent-700`。Hover 只用 `--primary-tint`。每页最多一个明确主操作。
- **次按钮**：分割线描边，墨色字。危险操作加深笔画与措辞，不引入调色板外的红填充。
- **输入**：可见 label（窄面板可用视觉隐藏但须保留）、就近错误、保留用户输入。框是描边，聚焦用 accent 描边 + 全局 `focus-visible`。
- **提示 / callout**：透明底 + 分割线 + **左侧 2px accent**。禁止大色块 Alert。
- **对象卡**：只给可点击的独立对象。普通分区用标题、列表、分割线。
- **面包屑**：顶栏 `nav[aria-label="面包屑"]`。祖先是文字链（`--color-accent-700`，hover `--primary-tint`），当前页无链、`aria-current="page"`。分隔符 `›`。条目必须对应真实可返回页面：教师工作台 `/teacher`，活动设计 `/teacher/activities`，班级 `/teacher/classrooms/{id}/members`，发布评阅 `/teacher/releases/{id}/submissions`，学生活动列表 `/student`。禁止把「评阅名册」「班级与名单」「学生端」写成不存在的中间层。
- **评阅工作台**：左列只读当前正式修订证据，右列撰写。桌面两栏共用工作区全宽、各自滚动，撰写栏略宽；整页锁在顶栏下的剩余视口，禁止整页与栏内双滚动。证据短时不把整页拉成一条长带。评阅栏可收成右侧窄条，证据列占满剩余宽度；折叠用栏内开关，不卸载撰写表单。窄屏改回单列文档流、不提供收起。已确认全文与更早修订用原生 `details`，默认收起。形成性反馈与量规评价仍分两段确认，不得把左右栏内容或两条确认链合并。撰写区只留标题、必填控件与一句确认后果；量规四档分行扫描。NFC / 换行归一化不进可见帮助。AI 入口保持固定说明「这是 AI 建议，未经你确认不会保存」。
- **动效**：教学工作台保持克制。描边按钮 `:active` 用 `scale(0.97)`（160ms），不在 hover 上平移。`ConfirmDialog` 居中 `scale(0.96)` 淡入；Agent 面板从右下 FAB 长出（`transform-origin: 100% 100%`），进出同一条路径。侧栏导航、评阅栏收起、列表行不动画。`prefers-reduced-motion` 走全局把时长压到近零。
- **确认**：发布、关闭、最终反馈、正式提交只用现有 `ConfirmDialog`。不得用自定义 modal 缩短 ActionIntent。
- **状态**：点 + 文字，不靠色块。紧急度用实心深 / 实心浅 / 空心 / 浅灰，不单靠色相。

## 反模式（出现即错）

- 渐变、玻璃拟态、粘土风、emoji 图标、装饰性圆形字母头像
- 实底主按钮、第二套品牌色、MASTER.md 的 `#174ea6`
- 硬编码 hex / px / 字体名（token 未覆盖的 1px 分割线除外）
- 重量级 UI 库、自建 focus trap、`showModal` 抢 ConfirmDialog
- 装饰性入场动画、hover 平移（含 FAB `translateY`）造成布局抖动
- 悬浮 Agent 用遮罩把页面 inert
- 对话产品做成气泡聊天气泡墙；消息用分割线分区，不用胶囊气泡

## 悬浮 Agent 面板

- `position: fixed` + `--z-overlay`，不进入 `main` / grid。
- 面板底 `--color-bg`，描边 `--color-divider`，圆角 `--radius-lg`，阴影 `--shadow-lg`。
- **对话记录是主列**：占面板剩余高度；职责/标题并入顶栏；边界说明进滚动区，随记录滚走。
- 输入区贴底可见、尽量薄：输入框与提交按钮同一描边容器，按钮仍为描边。
- 320–390 / 768 / 桌面不得页面横向溢出。Esc 在原生 `dialog[open]` 存在时不得截获。
