# AI 功能缺口与整改指令

状态：待执行。本文来自 2026-08-29 对 `codex/ai-features` 分支（D-044 ~ D-053）的第一性原理审阅。
每一条都写成可独立执行的指令：读到本文件的会话不需要那次审阅的上下文即可动手。

关联：`PLAN-AI-DEEPENING.md`（原始计划）、`DECISIONS.md`（D-044 ~ D-053）、`AGENT.md`（工具边界）。

审阅结论先行：授权边界、AgentRun 生命周期、历史重算、修复重试的实现纪律都是好的，
`pnpm check` 全绿，文档与代码几乎没有脱节。最大的短板是**验证面**，其次是四个尚未做的产品决策。

---

## 一、立即整改（工程缺口，不需要新决策）

### 指令 1：把两个起草器与过程诊断加进真实模型冒烟【最高优先级】

**现状**：`pnpm e2e:real-model`（`scripts/e2e/run-closed-loop.py --real-model-smoke` +
`scripts/e2e/verify-real-model-smoke.ts`）只覆盖 D-033 提案 → 建草稿 → D-047 读草稿 → D-048 改写这条链。
D-044 评价建议（`src/server/assistant/teacher-evaluation-suggestion.ts`）、
D-052 反馈建议（`src/server/assistant/teacher-feedback-suggestion.ts`）、
D-051 `get_process_insights` 三者**没有任何自动化真实模型覆盖**——它们的单测把
`generateSuggestion` 整个 mock 掉。

**为什么必须做**：D-053 的历史就是教训——正因为单测 mock 掉模型，起草器对真实模型成功率为 0
这件事长期没被发现。D-053 修完字段名后只做过一次性手工验证；下次改提示词、改 schema 或换模型，
同样的回归没有任何东西拦。DeepSeek `json_object` 不按 schema 约束字段名（见 D-053 与
memory 中的 deepseek-json-object-mode），这层合同天然脆，必须有自动化防线。

**做法**：
- 在闭环脚本里，教师评阅步骤先点「让助手起草」按钮，断言建议回填表单且可通过既有确认链保存，
  落库修订 `source = AI_ASSISTED` 且绑定成功的 AgentRun；再在 verify 脚本里断言该 AgentRun
  为 `SUCCEEDED`、对应 ActionAudit 存在且不含建议正文。评价与反馈两侧都要。
- `get_process_insights` 至少覆盖一次：助手对已发布 release 返回与过程诊断页一致的计数。
- 失败即冒烟 `NO_GO`，与既有真实模型验收同一标准。
- 运行所需 env 见 memory：local-real-model-smoke；linics 对这类花费有长期授权。

**验收**：同一套合成数据上连续通过；把任一起草提示词中的字段名删掉后冒烟必须失败。

### 指令 2：给两个起草提示词的字段名合同补上反馈侧遗漏检查

**现状**：字段名合同测试已存在（`teacher-evaluation-suggestion.test.ts` 的
"names every output field" 与反馈侧对应测试）。执行指令 1 时顺带核对两份测试列出的字段
与各自 zod schema 的字段是否**自动**保持同步（当前是手抄清单）；若不同步，改为从 schema 键名派生断言，
防止将来给 schema 加字段时忘改提示词。

### 指令 3：历史重算补标题一致性（低风险，可延后）

**现状**：`canonicalizeActivityAssistantReadOnlyHistory`
（`src/server/assistant/activity-assistant-request.ts`）对 `get_activity_draft` 与
`get_process_insights` 完全重查，但对 `list_my_*` 列表工具只按 ID 重算存在性。
草稿在两轮之间被改名时，模型可能拿旧标题配新内容。链接是服务端规范生成的，无授权风险，
只是模型上下文可能混淆。修法：列表工具重算时连标题/状态一起以当前查询结果覆盖历史值。

### 指令 4：部署红线写进部署文档

`src/server/auth/clickthrough-auth.ts` 是本地演示用认证绕过，门禁正确
（要求 `NODE_ENV=development`、非 Vercel、非 E2E/staging、显式配置 `DEV_TEST_*_CLERK_ID`）。
需要落成一行部署检查：**任何部署环境（含 staging）不得设置 `DEV_TEST_TEACHER_CLERK_ID` /
`DEV_TEST_STUDENT_CLERK_ID`**，staging 必须走真实 Clerk。

---

## 二、需要新决策才能动的产品缺口（按 D-0xx 流程立项，不得顺手实现）

以下四条每条都要先在 `DECISIONS.md` 立一条决策（用户场景、授权、数据合同、非目标、验收），
再进开发。列在这里是为了让缺口有名字，不是授权开工。

### 缺口 A：附件是评价建议实用性的硬天花板

模型读不到附件，凡依赖附件的维度一律 `INSUFFICIENT_EVIDENCE`（D-044 有意边界）。
真实课堂证据大量是照片、文档、作品；若一个班的提交多半靠附件，起草对教师近乎没用。
两条路需要决策：附件解析/多模态进入模型输入（需要独立的安全与成本决策），
或先用真实数据验证「纯文字证据够判的维度比例」，证明天花板碰不到再搁置。

### 缺口 B：全局助手看不到学生层（档 2 收尾）

`get_release_summary`、`list_release_submissions` 未开放（`AGENT.md` 明言等数据最小化决策）。
教师最常问的「哪几个学生需要我优先看」现在答不了。要做的决策核心是数据合同：
返回哪些字段、学生姓名要不要进模型、与 D-051 队列层计数的边界如何衔接。

### 缺口 C：两个 AI 表面割裂（B 档 3）

切片 A 的起草是评阅页按钮，切片 B 是聊天面板，互不知晓。教师在助手里看完过程诊断，
想落到「给这个学生起草反馈」得自己跳出去找页面。`PLAN-AI-DEEPENING.md` 已预留方向：
把 A 的起草动作包成全局助手工具，沿用签名 approval 边界。依赖缺口 B（助手先要能定位到学生）。
`suggest_activity_structure` 同属此档，仍未开放。

### 缺口 D：产品主张缺证据回路

Prompt、模型原文、教师修改差异都不留存（D-044/D-052 有意决策），因此「AI 起草有没有用」
（采纳率、修改幅度、哪类维度总判错）永远测不了。ROADMAP 已把人机差异历史列为延后的研究设计。
在立项之前，所有对外表述只能说「提供起草」，不得声称效率或质量提升。
何时立项由项目所有者定；立项时注意与「不新增表或字段」的既有决策冲突，需要显式推翻或修订。

### 缺口 E：会话不持久（记录在案，暂不动）

D-023 内存会话是有意边界：刷新即丢，演示够用。真实使用中长对话丢失很伤。
这条什么时候松动需要独立决策；在那之前不得以任何「顺手加个 localStorage」的方式绕过。

---

## 三、明确不做（本文不推翻的既有边界）

- 教师放弃建议后 AgentRun 留 `SUCCEEDED`——D-044 明文设计（记录「起草发生过」），不是 bug，不改。
- 不引入通用 Agent 运行时、持久 checkpoint、多 Agent（D-033 已拒绝）。
- 不放宽任何 schema、授权或一致性校验去迁就模型（D-053 明文）。
- 模型调用不进数据库事务（D-018 边界）。
