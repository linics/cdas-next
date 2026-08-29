# AI 功能缺口与整改指令

状态：**第一节（立即整改）已于 2026-08-29 全部执行完毕，见每条下的「执行结果」；第二节仍未立项，
不得开工。** 本文来自 2026-08-29 对 `codex/ai-features` 分支（D-044 ~ D-053）的第一性原理审阅。
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

**执行结果（2026-08-29）**：已完成，冒烟连续 3 次通过。

- 冒烟现在在模型提案建草稿之后，由教师经第一方 UI 发布手写草稿、学生正式提交，然后依次跑
  D-052 反馈起草 → 教师确认、D-044 评价起草 → 教师确认、D-051 过程诊断，最后核对
  `/teacher/insights` 也认得这次发布。
- verifier 从 5 个 AgentRun 扩到 8 个，并新增断言：两个起草 run 各自 `SUCCEEDED`、各自落到
  `source = AI_ASSISTED` 且 `agentRunId` 精确绑定的业务修订、各自有一条 `SUCCEEDED` 的
  `suggest_teacher_*` 审计；过程诊断那一轮一个字都没写。
- 「审计不含建议正文」用浏览器落盘的建议原文做实证：ActionAudit 与 AgentRun 行都不得包含它，
  而教师确认后的 TeacherFeedbackRevision 必须包含它（那是教师保存的反馈，本就该在）。
- 冒烟不再断言 `releaseCount === 0`（教师现在会发布），改为断言**没有任何 agent 驱动的发布
  意图**，模型仍然不能自己发布。
- 反向验收已实测：把 `body` 从反馈提示词里去掉后，起草 run 以
  `FEEDBACK_SUGGESTION_PROVIDER_FAILED` 失败、成功提示不出现、冒烟红灯。

**顺带修掉的三个真实缺陷**（都不改边界）：

1. `isStepCount(6)` 太紧。真实运行会走 3 次检索 + 3 次通读＝正好 6 步，`create_activity_draft`
   连一步都不剩，于是 run 以 `SUCCEEDED` 结束却只在文字里说「现在调用工具」。这正是过去把它当成
   「模型不听话」的那个偶发红灯的根因。已放宽到 10。
2. 「调用工具就是在请求确认」那段只点了 `create_activity_draft` 与 `publish_activity_release`，
   漏了 `update_activity_draft`，改写步因此也会只写散文不出确认卡。已补齐并加测试钉住三者。
3. `search_knowledge` 的 `query` 上限 400 字从未写进提示词，模型偶尔把整段要求当查询导致
   `..._QUERY` 校验失败。已在提示词里写明。

另外把 `NoObjectGeneratedError`（供应商答了、但 JSON 不合 schema）从 `PROVIDER_FAILED`
改判为 `INVALID_OUTPUT`：前者会让教师以为要等服务恢复，后者才提示可以重试或继续手写。

### 指令 2：给两个起草提示词的字段名合同补上反馈侧遗漏检查

**现状**：字段名合同测试已存在（`teacher-evaluation-suggestion.test.ts` 的
"names every output field" 与反馈侧对应测试）。执行指令 1 时顺带核对两份测试列出的字段
与各自 zod schema 的字段是否**自动**保持同步（当前是手抄清单）；若不同步，改为从 schema 键名派生断言，
防止将来给 schema 加字段时忘改提示词。

**执行结果（2026-08-29）**：当时确实是手抄清单。已新增 `src/test/zod-field-names.ts`
递归收集 schema 的全部属性名（含数组元素与判别联合分支），两份合同测试改为遍历派生结果断言
提示词逐个包含；手抄清单只保留为「这几个必须在里面」的下限。给 schema 加字段而忘了改提示词，
现在会在单测就红。

### 指令 3：历史重算补标题一致性（低风险，可延后）

**现状**：`canonicalizeActivityAssistantReadOnlyHistory`
（`src/server/assistant/activity-assistant-request.ts`）对 `get_activity_draft` 与
`get_process_insights` 完全重查，但对 `list_my_*` 列表工具只按 ID 重算存在性。
草稿在两轮之间被改名时，模型可能拿旧标题配新内容。链接是服务端规范生成的，无授权风险，
只是模型上下文可能混淆。修法：列表工具重算时连标题/状态一起以当前查询结果覆盖历史值。

**执行结果（2026-08-29）：这条的前提不成立，没有改代码。**
`canonicalizeActivityAssistantReadOnlyHistory` 对 `list_my_*` 并不是「只按 ID 重算存在性」——
它直接用 `mapTeacherClassroomList/DraftList/ReleaseList(workspace)` 把**整个 output 换掉**，
标题、状态、版本、href 全部来自当前已鉴权工作区。已补一条测试：草稿在两轮之间改名后，
历史里的旧标题不出现、新标题与新状态出现。行为已被钉住，不需要改动。

### 指令 4：部署红线写进部署文档

`src/server/auth/clickthrough-auth.ts` 是本地演示用认证绕过，门禁正确
（要求 `NODE_ENV=development`、非 Vercel、非 E2E/staging、显式配置 `DEV_TEST_*_CLERK_ID`）。
需要落成一行部署检查：**任何部署环境（含 staging）不得设置 `DEV_TEST_TEACHER_CLERK_ID` /
`DEV_TEST_STUDENT_CLERK_ID`**，staging 必须走真实 Clerk。

**执行结果（2026-08-29）**：没有只写成文档，落成了真正的门禁。staging preflight 新增
`NO_CLICKTHROUGH_AUTH_IDENTITIES` 检查，两个变量中任一存在即 FAIL 并给出 `NO_GO`，
`scripts/staging/contracts.test.ts` 有对应的 fail-closed 用例；`STAGING.md` 同步写明这是
配置错误而非可用回退。

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

**状态（2026-08-29）：已关闭。** 项目所有者裁定后 D-054 定稿为「已接受」，取匿名序号方案：
学生姓名与小组名一律不进模型，序号仅本次响应有效，单次上限 60 个对象，给行级 canonical
评阅链接，`get_release_summary` 不开放。`list_release_submissions` 已按定稿实现并接入真实模型
冒烟（含「学生显示名不得出现在名册结果里」的断言）。**要放开姓名必须另立决策，不得在实现里
顺手加字段。**

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
