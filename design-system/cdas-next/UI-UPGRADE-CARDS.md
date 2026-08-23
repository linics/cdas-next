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
- Source: 用户对当前“规范但老派”的视觉反馈。
- Current Behavior: UI-201–205 已建立清晰、克制的工作台基线，但尚未经人工选定更具现代感的视觉方向。
- Correct Semantics: 先制作 2–3 个可比较的现代单页模板/原型，人工选型后再全站吸收；探索圆角层级、柔和表面、统一图标、微交互与页面过渡。
- Motion Contract: 仅选择 2–3 个有意义动效（确认打开、状态变化、列表或页面切换），150–300ms，支持 `prefers-reduced-motion`。
- Forbidden Misfix: 大量滚动动画、弹跳、玻璃拟态、渐变堆叠、为动效引入重型框架，或以视觉改动改变业务命令、权限、ActionIntent 与历史语义。
- Status: 待人工选型；本轮明确不实施，避免未选定风格扩散全站。
