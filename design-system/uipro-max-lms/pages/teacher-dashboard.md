# Teacher Dashboard Page Overrides

> Rules in this file **override** `design-system/uipro-max-lms/MASTER.md`.

---

## Page-Specific Rules

### Layout Overrides

- 产品库：LMS **Education Analytics Dashboard**，信息密度按 Design Dial 8/10。
- 内容最大宽度 1200–1400px；摘要条 + 主列表 + 班级侧栏。
- 不使用 12 栏营销栅格，不放图表缩放、筛选动画或假数据控件。

### Spacing Overrides

- 只用 MASTER `--space-xs` … `--space-3xl`（2–32px）。
- 区块间距 `--space-2xl` / `--space-3xl`，控件内边距 `--space-lg` / `--space-xl`。

### Color Overrides

- 主 CTA（新建学习活动、保存、发布准备）用 `--color-accent`。
- 次按钮用 2px `--color-primary` 描边。
- 行悬停只改 `--color-muted` 背景，无位移。

### Component Overrides

- Flat Design：2px 半径、2px 实线边框、无阴影。
- 列表按课程卡堆叠，不用细线表格。
- 装饰图标：`plus`（新建）、`arrow-right`（进入）、`sign-in`（登录）。
