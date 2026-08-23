# UI-201 至 UI-205 升级卡

### Card: UI-201
- Source: 当前首页、教师和学生 CSS 基线；产品界面审查。
- Current Behavior: 宣传页式大标题、10px 正文、教师/学生重复且漂移的样式，深层页面没有稳定导航。
- Correct Semantics: 不改变读写、ActionIntent、授权或历史；以统一工作台壳、token 与反馈组件呈现既有真实能力。
- Invariants: 不渲染无业务行为的导航；未认证/未绑定页不展示读写数据或写入入口；本机测试入口只在开发环境出现。
- Forbidden Misfix: 在客户端重建/修改数据，或以 UI 对话框替换服务端确认链。
- Acceptance: 共享 API 有语义测试；关键路由在三种尺寸无横向溢出。

### Card: UI-202
- Source: `src/app/teacher/**` 现有教师闭环。
- Correct Semantics: 清晰呈现教师草稿、发布、提交、反馈；发布、关闭、最终反馈仍经既有 ActionIntent 和 server command。
- Negative Cases: 无权限无写入口；取消确认不触发命令；错误保留输入。

### Card: UI-203
- Source: `src/app/student/**` 现有学生闭环。
- Correct Semantics: 清晰区分待完成、已提交、已有反馈与只读历史；正式提交仍以既有命令和版本约束为准。
- Negative Cases: 关闭活动时没有保存/重交入口；取消提交不触发命令；无效证据保留工作副本。

### Card: UI-204
- Source: UI-201–203 的共享契约。
- Correct Semantics: 页面更清楚但不扩大第一阶段功能和权限范围。

### Card: UI-205
- Source: 产品验收合同与界面可用性基线。
- Correct Semantics: lint、typecheck、tests、build 和真实浏览器关键路径均通过；视觉检查不能只确认页面可打开。

### Card: UI-206
- Source: 用户要求清理本分支不可用原型，并完整按本地 UI UX Pro Max 技能最新规范重做前端。
- Current Behavior: 全站使用 `design-system/uipro-max-lms` 的 LMS Flat Design：青绿主色、橙色 CTA、Plus Jakarta Sans、密度 8、2px 扁平边框、无阴影/无渐变、Phosphor 装饰图标。
- Correct Semantics: 只改呈现；读写、ActionIntent、授权、历史与文案不变。
- Motion Contract: 仅颜色/透明度过渡 150–200ms；尊重 `prefers-reduced-motion`；不引入 GSAP 或其他动效框架。
- Forbidden Misfix: 抄模板站、`?visual=` 多皮肤、玻璃拟态、渐变堆叠、布局位移悬停、或改变发布/提交/反馈语义。
- Status: 已按技能规范实施。
