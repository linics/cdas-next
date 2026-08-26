# CDAS Next 实现架构

状态：第一阶段 v0.1 已完成外部验收；D-025–D-040 已完成开发期远程验收
日期：2026-08-26

## 运行时边界

```mermaid
flowchart LR
  UI[普通教师/学生 UI] --> Entry[Next.js Server Actions]
  Agent[AI SDK useChat UI] --> AgentRoute[Next.js Route Handler]
  Clerk[Clerk 身份会话] --> Entry
  Clerk --> AgentRoute
  Entry --> Commands[服务端领域命令]
  AgentRoute --> AI[AI SDK OpenAI-compatible provider / DeepSeek API]
  AgentRoute --> Tools[严格 Agent 工具]
  Tools --> Commands
  AgentRoute --> Run[AgentRun provenance]
  Commands --> Prisma[Prisma transaction]
  Run --> Prisma
  Prisma --> PG[(PostgreSQL)]
```

普通 UI 和 Agent 的入口不同，但最终调用相同的领域命令。Agent 不拥有独立权限，也不能导入 Prisma 或直接执行存储操作。

入口把表单或工具参数与可信 `CommandContext` 分开。业务输入不能包含 actor、调用来源、追踪号或当前时间；UI context 由 Clerk 会话、服务端 trace 和服务端时钟构造。测试只能通过不可序列化的 `clock()` 依赖固定时间，不能给生产表单增加 `now` 参数。

## 模块职责

| 位置 | 职责 | 禁止 |
| --- | --- | --- |
| `src/app/` | 页面、表单、结构化确认和导航 | 直接访问 Prisma、相信客户端角色或确认参数 |
| `src/domain/` | Zod 合同、纯不变量、内容快照和可确定测试 | 框架会话、数据库连接、模型调用 |
| `src/server/commands/` | 重新授权、乐观并发、事务、幂等和审计 | 将外部网络调用放进数据库事务 |
| `src/server/db/` | Prisma 连接生命周期 | 业务规则 |
| `prisma/` | 模型、migration、数据库约束和数据库测试 | 依赖页面状态或 Prompt |

## 发布事务

`publishActivityRelease` 在 Serializable 事务中执行：

1. 查询 `(actor, command, idempotency_key)`；相同请求返回首次结果，不同参数返回冲突。
2. 读取已确认 ActionIntent，校验 actor、参数摘要、有效期和未消费状态。
3. 重新读取精确草稿修订与目标班级，验证所有权、管理关系、状态和版本。
4. 原子消费确认并封存草稿。
5. 创建 ActivityRelease 与一对一不可变快照。
6. 保存成功审计与幂等结果，然后提交事务。

越权、确认过期、草稿变化或参数篡改不会产生 Release；失败结果另行写入 append-only 审计。PostgreSQL 唯一约束和 Serializable 重试处理并发重复请求。

ActionIntent 的 action、payload、hash、目标、预期版本、创建者和有效期在插入后由数据库 trigger 永久冻结；状态只能 `prepared → confirmed/rejected/expired` 或 `confirmed → executed/expired`。确认审计同时绑定 payload hash，不能把整组参数换成另一组内部一致的数据。

## 活动草稿保存与发布预备

- `saveActivityDraft` 同时服务普通教师 UI 与 Agent 工具。新建从版本 1 开始；每次保存以 `draftId + expectedVersion` 做 CAS，更新可变 head 并追加内容完全一致的 ActivityDraftRevision。
- UI 保存记录为 `MANUAL` 且不能携带 AgentRun；新的 Agent 保存必须绑定同一教师、状态为 RUNNING 的 AgentRun。SUCCEEDED 运行只可精确重放原幂等结果，FAILED/CANCELLED 不可继续写入。
- 幂等摘要包含可信调用来源，UI 的成功结果不能被 AGENT 用同一 key 伪装成 Agent 写入，反之亦然。
- `preparePublishActivityIntent` 只在教师拥有草稿、仍管理目标班级、版本精确且状态为 READY_FOR_PREVIEW 时创建十分钟 ActionIntent。它不封存草稿，也不创建 Release。
- 第一方 `decideActionIntent` 确认后，既有 `publishActivityRelease` 才重新授权、消费意图、封存同一版本并创建同源快照。

数据库在提交时要求草稿版本从 1 连续、head 内容等于当前不可变修订；只允许 READY 草稿在正文和版本不变时由发布事务变为 SEALED。每个 Release 还必须以唯一外键绑定已执行的发布 ActionIntent；ActionIntent、SEALED 草稿、Release 与精确快照由双向延迟约束要求在同一事务完整出现。快照 JSON 必须等于绑定版本的完整修订，摘要由 PostgreSQL 17 核心 SHA-256 按 schema 分支复算，不信任调用方传入的 64 位字符串。v1 快照继续用 canonicalize@4 对封闭七字段 UTF-8 字节计算 SHA-256，历史 v1 hash 不重写；v2 快照对完整任务书使用 v2 canonicalizer，并与 migration `20260824120000_structured_task_book_v2` 中 PostgreSQL jsonb 文本 SHA-256 对齐。新写入统一为完整 schema v2，v1 历史仍可原样读取。发布时冻结 `executionVersion`：历史发布与新的 `once` 为 0，新的 `phased`/`mixed` 为 1，发布后不可改写。

## 学生提交流程

提交容器身份是 Release ×（个人学生 XOR ReleaseGroup）× `phaseIndex`。协议 0（历史发布与新 `once`）只使用 `phaseIndex = 0`；协议 1（新 `phased`/`mixed`）按冻结快照从阶段 1 线性推进 `1..N`，学生不能跳阶段；`mixed` 在最后阶段正式提交后于同一事务幂等准备 `phaseIndex = 0` 整项终稿。这是快照索引上的顺序执行，不是通用流程引擎。

- `saveSubmissionWorkingCopy` 保存可为空的工作内容，以工作副本 UUID + version 做 CAS；工作草稿与正式修订中的 `completedEvidenceIndexes` 必须来自冻结快照当前阶段，服务端拒绝未定义、重复或越界条目。
- `submitSubmissionRevision` 不接收正文，只复制学生精确确认的已保存工作副本；正式提交至少需要非空文字、一个 `READY` 附件或一个已确认检查点。提交后删除该工作副本并追加不可变修订；协议 1 在同一事务内查找或创建下一阶段工作草稿，幂等重试返回同一结果。
- `startSubmissionResubmission` 显式从当前正式修订创建新工作副本；重复请求返回现有副本，不重置学生修改。
- 三个命令都重新验证当前班级成员关系与 active Release。超过截止时间但仍 active 时允许提交，并把 late 固化在修订上。
- 附件仍走 D-025/D-026 命令；OIDC 签名、对象元数据、文件头验证与下载流留在数据库事务外。
- 同组成员解析到同一容器并共享工作草稿、正式修订、附件和反馈；其他小组、未分组学生和非管理教师得到资源级不存在。任一阶段出现第一份 Submission 后，该 ReleaseGroup 的身份、名称、成员、角色与删除全部锁定。

数据库在事务提交时校验 Submission 最新指针、连续修订序列和可选工作副本 base 是否一致；容器身份、`phaseIndex` 与提交主体不可改，正式修订不可更新或删除。

## 发布关闭事务

`closeActivityRelease` 只在第一方 UI 使用，且仅允许发布教师仍为目标班级管理员时执行：

1. 查询 `(actor, command, idempotency_key)`；相同请求返回首次关闭结果，不同参数返回冲突。
2. 读取已确认 ActionIntent，校验 actor、Release、预期 `ACTIVE` 状态、参数摘要、有效期和未消费状态。
3. 在 Serializable 事务内重新读取 Release 与目标班级管理关系；只有仍为 `ACTIVE` 的精确 Release 可以继续。
4. 原子消费确认，将 Release 迁移为 `CLOSED`、保存其唯一关闭 ActionIntent 关联，并保存成功审计与幂等结果后提交。

数据库用 Release 更新与关闭 ActionIntent 执行的双向延迟约束，拒绝没有精确确认、actor、参数摘要和执行时间的直接状态修改。关闭后学生写命令在重新授权时拒绝，已有 Release、学生自己的提交、反馈和量规评价仍可读取，且有权教师仍可反馈或评价。第一阶段不实现 `CLOSED → ARCHIVED`，也不提供关闭的 Agent 工具。

## 教师反馈确认流程

- `prepareTeacherFeedbackIntent` 读取学生当前正式修订与反馈版本，规范化反馈正文，并创建十分钟有效、绑定精确 Submission 修订和正文摘要的 ActionIntent。D-034 起新修订还必须在同一 payload 中携带 schema v2 的 `nextStep`（`CONTINUE|REVISE`）与 `supportLevel`（`FOUNDATION|STANDARD|CHALLENGE`）。
- 第一方 UI 通过 `decideActionIntent` 记录教师本人确认；AI 建议本身不构成业务反馈。
- `saveTeacherFeedback` 锁定 Submission 后重新授权并核对当前修订。学生若已经重交，原确认失效且不会产生反馈。新修订把正文与两个结构化字段写入同一个已执行 ActionIntent；D-034 之前只有正文的历史行保持原样，不得回填。
- 每个 SubmissionRevision 对应一个稳定 TeacherFeedback 容器；首次确认创建版本 1，之后修改只追加 TeacherFeedbackRevision 并以容器版本做 CAS。
- `CONTINUE`/`REVISE` 是形成性教学建议，不是评分或阶段状态变更。`CONTINUE` 不构成终评；`REVISE` 不删除、回拨或锁住 D-031 已创建的后续阶段。学生看到 `REVISE` 时使用既有“开始重交”入口。
- 手写路径不创建 AgentRun，也不调用模型；关闭 AI provider 时仍能完成确认与保存。

数据库同时校验反馈容器身份、连续版本、确认时间、正文可见性、来源 provenance，以及不可变修订与已执行 ActionIntent 的精确对应关系；新修订的结构化字段必须与该意图 payload 一致。

## 教师量规评价确认流程

- `prepareTeacherEvaluationIntent` 在事务内读取当前正式修订、冻结 snapshot 与本版证据，校验全部量规维度后创建十分钟有效的 ActionIntent。评价 payload `schemaVersion` 为 1；v1 snapshot 返回 `RUBRIC_UNAVAILABLE`。
- 第一方 UI 通过独立确认面板调用 `decideActionIntent`；该面板不得与反馈确认合并。本切片不呼叫模型，也不新增 Agent 工具。
- `saveTeacherEvaluation` 锁定 Submission 后重新授权并核对当前修订。学生若已经重交，原确认失效且不会产生评价。每个 SubmissionRevision 对应一个稳定 TeacherEvaluation 容器；首次确认创建版本 1，之后修改只追加 TeacherEvaluationRevision。
- 教师 Release 正式提交列表只读取当前修订的评价版本号和快照是否提供量规，不把综评或维度结果带进列表。
- 学生活动列表只读取当前正式修订是否存在量规评价，不把综评、outcomes 或评价版本细节带进首页。
- LEVEL 必须引用本版文字、READY 附件或已确认检查点；`INSUFFICIENT_EVIDENCE` 必须空引用。关闭后有权教师仍可评价。
- 手写路径不创建 AgentRun；关闭 AI provider 时仍能完成确认与保存。

数据库同时校验评价容器身份、连续版本、综评可见性、outcomes 覆盖冻结量规、引用授权，以及不可变修订与已执行 ActionIntent 的精确对应关系。

## 班级成员变更

`prepareClassroomMembershipChange` / `applyClassroomMembershipChange` 只允许班级当前管理员通过第一方 UI 管理既有 STUDENT。教师按规范化名单码（`rosterKey`）批量预览后明确确认加入，或明确确认结束当前成员关系；重新加入追加新的有效区间，既有区间不得删除或改写身份、开始时间与已固化的结束时间。成员区间写入、班级版本递增、意图执行、幂等结果和成功审计在同一 Serializable 事务提交。名单码不是认证凭证；切片不向 Agent 提供成员工具，也不调用 Clerk 管理 API，因此 Clerk 中断不阻断既有 AppUser 的名单读取与成员写入。

## 发布作业小组配置

`saveReleaseGroup` / `deleteReleaseGroup` 仅允许发布教师且仍为目标班级管理员配置只属于当前 Release 的作业小组与角色标签。同一学生在同一 Release 最多属于一个小组；已有个人 Submission 的学生不能迁入。任一 Submission 出现后，组名、成员、角色与删除全部锁定；尚无提交的小组仍可调整，命令必须幂等并留下动作审计。小组不是 ClassroomMembership、长期班级分组或 Clerk 组织，也不传播到其他 Release。阶段顺序与提交流水线复用既有提交命令，不另建工作流引擎。

## 活动助手试行

- “新建学习活动”是助手会话的唯一起点。`/teacher/activities` 共享客户端 layout 持有唯一官方 `useChat` session，使草稿工具返回后的客户端导航可以在精确预览页继续同一消息与签名 approval；直接进入或刷新预览页时 session 为空，页面不伪造恢复。消息、prompt、ticket 与 approval 签名不进入 URL、localStorage 或业务数据库，导航到 Release 后 layout 卸载。Server Component 仅在 `AI_PROVIDER_DISABLED=0` 且 DeepSeek API key、模型和审批签名配置全部有效时渲染助手；这个检查不构造 provider，也不创建 AgentRun。
- Route Handler 先从 Clerk 会话解析应用教师，再严格校验消息数量、总字节、角色顺序、文本长度和 AI SDK 工具 part。学生、未配置账号和伪造历史不能进入 provider 或业务工具。
- AI SDK 官方 `useChat + streamText` 负责消息流与工具 part，不维护第二套聊天协议。模型调用始终在数据库事务之外；请求正文、Prompt、工具正文和 provider 原始 chunk 不写日志或 tracing。
- `create_activity_draft` 是 D-033 的 L1 工具。资料不足时每轮只提出一个会改变设计的必要问题，且不写入。资料充分后，签名 approval 展示理解摘要、教师已提供要求、明确假设、各融合学科贡献、知识/过程/情感三条目标—任务—证据—评价链和完整 schema v2 内容；教师批准前不执行草稿写入。批准后仍以当前教师、`AGENT` 来源和 owned RUNNING AgentRun 调用共享 `saveActivityDraft`；拒绝确认不产生草稿。该理解确认不是发布确认，也不建立 ActionIntent。成功输出包含精确 draft ID 和站内路径；客户端只在两者一致时进入预览。
- `publish_activity_release` 先由 AI SDK 签名 `toolApproval` 暂停交互；教师批准后仍依次调用发布 prepare、第一方 UI decide 与原有 publish command。ActionIntent 才是精确参数、资源版本、确认人和重新授权的业务信任边界。
- 普通模型工具写入由 AI SDK `stopWhen` 在该工具 step 后结束。`saveActivityDraft` 与 `publishActivityRelease` 的 Agent 路径会在同一领域事务提交业务结果、成功审计、幂等结果与 AgentRun 的 `RUNNING → SUCCEEDED`；若运行已经失败或取消，事务整体回滚。签名审批续传会先执行已批准工具，成功后再由官方 `prepareStep` 给后续 provider adapter 一个已中止 signal；后续流或连接失败不能把已提交业务事实改写成失败。模型在工具前中断不会创建草稿、Release 或反馈。
- 同一工具调用可由命令幂等重放。若整个 HTTP 请求在确认执行后丢失并以新的 AgentRun 原样重建，当前会安全地返回幂等冲突，而不是弱化 AgentRun provenance；跨运行恢复仍是明确的可用性缺口。
- 新 Agent 写入只接受同一教师拥有的 RUNNING run；SUCCEEDED run 只允许命中原 IdempotencyRecord 的精确重放。数据库同时禁止 AgentRun 身份改写、终态回拨、删除及审计外键置空。
- 远端首场景验收使用独立 `staging-agent-acceptance` 门禁：AI-enabled health proof 绑定源码、部署、DB、Clerk、DeepSeek API key 指纹、模型和 approval secret 指纹；runner-side ticket 只驻内存；marker namespace 只追加；浏览器后由 read-only SQL 精确验证四次 SUCCEEDED AgentRun（草稿提案、草稿执行、发布提案、发布执行）、AGENT revision、ActionIntent、Release/snapshot、audit、idempotency 和零学生历史。该门禁不部署、不迁移、不清理，也从不产生 production GO。

## 不可变历史

下列数据只允许追加：

- ActivityDraftRevision
- ActivityReleaseSnapshot
- ActivityRelease 的身份、发布时间、目标班级与截止时间
- SubmissionRevision
- TeacherFeedbackRevision（含 D-034 起冻结的 `nextStep` 与 `supportLevel`；历史正文-only 行不回填）
- TeacherEvaluationRevision
- 成功 IdempotencyRecord
- ActionAudit

ReleaseGroup 在出现第一份 Submission 后，其身份、名称、成员与角色冻结，不能再改写归属。

初始 migration 使用数据库 trigger 拒绝对已存在行的更新或删除。页面隐藏按钮、TypeScript 类型和 ORM 调用约定都不能替代数据库约束。

每个 Release 在事务提交时必须恰有一个同源 Snapshot；复合外键保证两者引用同一草稿。Release 只能 active → closed → archived，不能重新打开或跳级；第一阶段只由第一方 UI 执行 active → closed，archived 留待未来。

## 外部服务原则

- Clerk 只回答调用者身份。角色、班级成员关系和资源归属保存在 PostgreSQL。
- AI SDK 的签名 `toolApproval` 只负责交互暂停与响应验签；ActionIntent 绑定精确参数、版本和确认人。
- 模型失败不能阻止普通教师和学生流程；默认可以通过 `AI_PROVIDER_DISABLED=1` 完全关闭。
- D-025/D-026 附件切片使用 Vercel Private Blob、随机唯一 key、五分钟 OIDC 预签名上传、不可覆盖对象和声明类型/大小/文件头验证。永久对象 URL 和 storage key 都不能作为权限凭证；签名前必须按当前 Submission、学生或发布教师关系重新授权。
- OIDC 签名、对象元数据与文件头读取、私有下载流全部在 PostgreSQL 事务外；事务只提交已验证的状态转换和工作副本/不可变修订关联。当前格式验证不声称是恶意文件扫描。
- 日志与 tracing 默认不记录完整 Prompt、学生证据、反馈正文或附件内容。
