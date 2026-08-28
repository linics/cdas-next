# AI 深度融合计划：评价建议与全局助手

状态：**切片 A 已按 D-044 完成本地开发门禁，待固定合成远程验收；切片 B 仍是计划，未形成决策**。
全局侧边栏助手仍需一条 `DECISIONS.md` 记录（暂记 D-045）才能进入开发。

日期：2026-08-28
关联：`SPRINT-0901.md`（冲刺后再说 1、4）、`ROADMAP.md`（依赖顺序 8）、`DECISIONS.md`（D-018、D-023、D-024、D-033、D-035）

---

## 0. 前置：本分支先验证并落地

`codex/ai-features` 由项目所有者明确要求从 `codex/ui-redesign-kanban` 当前 HEAD 创建，完整继承视觉重做、
第 1.5 步情境叙事、3a 学生任务页重构、3b 教师端收束与演示种子重写。2026-08-28 已先完成以下基线验证；
D-044 只在这套已验证 UI 上增加次操作，不另起视觉方向：

- [x] `pnpm check`（typecheck + lint + test）
- [x] `python3 scripts/ui-audit/audit.py 1280 768 390` 无 findings
- [x] 浏览器过一遍主路径：教师工作台 → 活动设计/预览 → 评阅名册 → 反馈与评价；学生端列表 → 任务页 → 提交与反馈/评价区
- [x] `AI_PROVIDER_DISABLED=1` 下手工路径与生产构建全程可用
- [ ] 合入 `main`

`main` 合并仍留到既有演示分支交付流程处理；AI 分支固定基于上述已验证 HEAD，不回拨或重做全局视觉。

---

## 1. 切片 A：AI 评价建议（AI 起草量规评价 → 教师逐维度终审）

### 为什么这个先做

写入路径**已经建好并带测试**，当初 D-035 就是照"AI 起草 → 教师终审"设计的，只把生产者留白：

| 已存在 | 位置 |
| --- | --- |
| `source` 枚举 `MANUAL` / `AI_ASSISTED` | `teacher_evaluation_revisions.source` |
| `agent_run_id` 外键与索引 | `teacher_evaluation_revisions.agent_run_id` |
| intent 携带 `suggestionAgentRunId` | `prepare-teacher-evaluation-intent.ts` |
| 保存时校验 intent 与 payload 的 run id 一致，不一致抛 `INVALID_AGENT_RUN` | `save-teacher-evaluation.ts:196` |
| 据此写 `source = agentRunId ? "AI_ASSISTED" : "MANUAL"` | `save-teacher-evaluation.ts:298` |
| 教师端与学生端渲染「AI 建议，教师已确认」/「教师手写」 | 两处 `page.tsx` |
| AgentRun 生命周期与 provenance | `agent-run-lifecycle.ts`、`agent_runs` 表 |

唯一缺口是前端 action 里写死的一行：

```ts
suggestionAgentRunId: null,   // evaluation-actions.ts:354
```

反馈侧（`save-teacher-feedback.ts`）结构完全对称，本切片先只做评价，反馈留到之后。

### 核心约束：只起草，不写入

助手产出的是**填进表单的建议**，教师逐维度改完、走现有「确认并保存量规评价」面板才落库。
一行写入代码都不改，风险被框在一个只读起草面上。

### 范围

1. **只读起草动作**（server action，不是聊天）
   - 开 AgentRun 记 provenance → 复用现有已鉴权的 feedback workspace 查询取冻结量规与本版证据
     → 调模型 → 返回逐维度建议 + `agentRunId` → 结束 AgentRun。
   - 模型调用在数据库事务之外（沿用 D-018 边界）。
   - 授权完全复用现有查询，**不新建任何未加范围的查询**；其他教师、组外学生继续资源级不存在。
2. **提示词**
   - 每个维度必须引用**本版**真实证据（`{kind:"text"}` / `{kind:"checkpoint", evidenceIndex}`），
     引不出来必须标 `INSUFFICIENT_EVIDENCE`，不许凭空给档。
   - 附件是二进制、模型读不到，凡是要靠附件才能判的维度一律标证据不足，不得根据文件名猜内容。
   - 必须覆盖冻结快照里的全部 4–8 个维度，不得增删改名（与 D-035 的数据合同一致）。
   - 产出是待教师终审的建议，不是分数，也不是课程标准合规结论。
3. **撰写区**
   - 新增「让助手起草这一版评价」；结果填进表单，每一档、每条引用、综评都可改。
   - 顶部一条固定说明：这是 AI 建议，未经你确认不会保存。
   - 把写死的 `null` 换成隐藏字段里的 `agentRunId`；教师若把建议改得面目全非仍算 `AI_ASSISTED`——
     记录的是"这一版由 AI 起草过"，不是"AI 说了算"。
4. **降级**
   - `AI_PROVIDER_DISABLED=1` 时按钮不渲染、不构造 provider、不建 AgentRun，手写路径一个字不变。

### 非目标

自动评分、把量规档位写成阶段状态、v1 快照回填量规、AI 直接写库、把评价混进反馈确认面板、
AI 建议与教师终审的差异统计（那需要独立的研究设计，见 ROADMAP「明确不采纳的假设」最后一条）。

### 验收场景

正常起草并确认、证据不足维度、v1 快照拒绝起草、非发布教师/非班级管理者资源级不存在、
陈旧确认、重复提交幂等、模型返回非法 schema 失败关闭且零写入、`AI_PROVIDER_DISABLED=1` 全手写可用。

### 量级

0.5–1 天。

---

## 2. 切片 B：全局侧边栏助手

### 现状

`ActivityAssistantSessionProvider` 只包在 `/teacher/activities` 的 layout 上（D-023）。
session 只存在于内存，不进 URL、localStorage、cookie 或数据库；离开该子树对话即丢失。
现有工具四个：`search_knowledge`、`read_source_section`（只读）、`create_activity_draft`、
`publish_activity_release`（写，走签名 approval + ActionIntent）。

### 目标

把 provider 上提到教师工作区外层，助手在整个教师端常驻；工具注册表按三档扩充，一档一档来，
每档独立可验收：

| 档 | 内容 | 风险 | 何时做 |
| --- | --- | --- | --- |
| 1 导航 | 工具只返回 href，UI 渲染成链接由教师自己点，模型不能代跳 | 极低，零写入零读数据 | 与 provider 上提同批 |
| 2 只读查询 | 复用现有已鉴权查询（工作台、评阅名册、过程诊断、官方语料） | 中：**每个工具必须走页面同款的已鉴权查询**，绝不新建未加范围的查询 | 档 1 验收后 |
| 3 ActionIntent 写操作 | 现有草稿/发布；之后可把切片 A 的起草挂进来 | 高，维持签名 approval + ActionIntent 双重边界 | 档 2 验收后 |

### 必须守住的边界

- **D-023 的内存属性不变**：上提 provider 只扩大子树，session 仍不落任何持久介质。
  离开教师工作区、刷新、直接进入深链都不恢复对话，助手丢了不影响手工闭环。
- **不引入通用 Agent 运行时**：继续 AI SDK `useChat + streamText + signed toolApproval`，
  不加 LangGraph/Mastra/持久 checkpoint/长期记忆/多 Agent（D-033 已明确拒绝过）。
- **导航档不许模型代替教师跳转**：返回 href，由教师点。否则模型一次幻觉就能把教师带到无关资源。
- **只读档的每一个工具都要有对应的资源级不存在测试**，和页面查询同源。

### 与切片 A 的关系

A 不依赖 B，独立可交付。B 的档 3 之后可以把 A 的起草动作包成工具，但那是 B 的事，
A 自己先用一个按钮就够了。**顺序固定为 A → B**：A 小、闭环、演示价值高；B 是架构面，先做会把
A 卡在后面。

### 量级

provider 上提 + 档 1：约 1 天。档 2：1–2 天（取决于放几个查询）。档 3：另计。

---

## 3. 排期与前提

今天 8/28。冲刺硬锚点是 **8/30 进入第 4 步演示工程、8/31 录出备用视频、9/1 纯缓冲**。

`SPRINT-0901.md` 的「冲刺期内明确不做」写明包含 **AI 评价建议（除非全线提前）**；
D-035 非目标列了「Agent 评价工具」；ROADMAP 依赖顺序第 8 条写着「AI 建议与教师终审差异历史延后」。
**两个切片都是冲刺计划的明文越界项**，要做就得同时接受：冲刺纪律里"不新增 D-0xx"这条被打破，
或者把它们放到 9/1 之后。

建议排法：

| 时间 | 内容 |
| --- | --- |
| 8/28–8/29 | 本分支验证 + 合入 main；3c 视余力 |
| 8/30 | 进入第 4 步演示工程（硬锚点，不可让） |
| 8/31 | 录备用视频 + 材料初稿（硬锚点） |
| 9/1 | 缓冲、彩排、终校（硬锚点） |
| 8/28 起 | 项目所有者在 UI 基线通过后明确接受唯一例外：切片 A（D-044）进入开发；不得顺带启动切片 B |
| 9/2 起 | 切片 B 档 1（补 D-045）→ 档 2 → 档 3 |

若坚持冲刺期内做，只有切片 A 有可能塞进 8/29 一天，且必须接受 3c 不做、彩排只跑一次；
切片 B 无论如何塞不进硬锚点之前。

---

## 4. 进入开发前还欠的东西

按 ROADMAP「每个未来切片的进入条件」，两个切片各自还欠：

- [ ] 真实教师用户场景与明确非目标（本文已列，需确认）
- [ ] 资源所有权与历史可见性规则（A 复用 D-035；B 每档单列）
- [ ] UI 与 Agent 共用的服务端领域命令边界（A 不新增命令；B 档 3 需要）
- [ ] 对发布/提交/反馈/评价/审计/幂等的 append-only 影响说明
- [ ] AI 建议、Prompt 版本、检索来源的资源级读取授权与不可变保存方式
- [ ] 五类验收场景（正常、无权限、不存在或并发变化、重复操作、外部依赖失败）
- [ ] 模型调用不在数据库事务内的实现方案
- [ ] AI 不可用时的人工降级路径
- [ ] `DECISIONS.md` 记录，并同步 `PRODUCT.md` / `DOMAIN.md` / `ACCEPTANCE.md` / `AGENT.md` 中真正受影响的部分
