# CDAS Next 领域模型

状态：启动基线（v0.1）  
日期：2026-08-18

本文只定义第一条产品闭环需要的业务概念。没有明确用户场景支撑的实体和字段不进入第一阶段。

## 核心实体

### User（用户）

- 表示经过认证的教师或学生。
- 角色只决定能力范围，不代替具体资源归属检查。
- 学生可由受控 operator 配置唯一、规范化的 `rosterKey`（名单码），用于教师精确导入既有账号；名单码不是认证凭证，不能代替登录、班级管理权或成员变更确认。

### Classroom（班级）

- 由一名教师管理。
- 是活动发布和学生可见性的边界。

### ClassroomMembership（班级成员关系）

- 明确记录学生属于哪个班级。
- 使用 `joined_at` 与可空的 `ended_at` 保存成员关系的有效区间，不通过删除记录抹去历史。
- 学生是否能查看活动，由成员关系和活动发布记录共同决定，不能只按年级推断。
- 教师成员管理只允许班级当前管理员通过第一方 UI 变更：加入创建新有效区间，退出只把当前区间的 `ended_at` 从空值设置为服务端当前时间，重新加入追加新区间；任何既有区间都不得删除、改写身份、开始时间或已经固化的结束时间。
- 批量加入先按名单码形成预览并绑定班级版本、精确学生集合与参数摘要；教师确认后执行时仍重新验证管理员、学生角色、名单码与班级版本。

### ActivityDraft（学习活动草稿）

- 教师可编辑的设计版本。
- 包含标题、说明、学习目标、任务要求、证据要求和反馈标准。
- D-030 的内容 schema v2 以原版 CTS/CDAS 为能力下限，包含探究主题、学段、年级、原版稳定学科目录中的主学科与至少一个融合学科、三类作业及条件子类型、探究深度、提交模式、1–16 周周期和 0–2 个原版跨学科概念。
- v2 还分开保存背景设定，知识与技能、过程与方法、情感态度三类目标，3–4 个连续任务阶段及四档评价描述。每阶段包含一个核心动作、情境承接、学习支架、类型化证据、评价要点和课时建议。
- 既有 schema v1 历史不补写结构化字段；新的保存必须形成完整 v2 修订。旧未封存草稿只有在教师补齐新字段并保存后才升级为 v2。
- 草稿永远不对学生可见。
- AI 可以创建或修改草稿建议，但修改必须归属于当前教师并留下来源记录。
- 每次保存产生递增版本；恢复旧内容也通过创建新版本完成，不回拨版本号。
- ActivityDraft 行是当前 head；它的版本和全部正文在事务提交时必须与同版本不可变 ActivityDraftRevision 精确一致。
- 普通 UI 保存产生 MANUAL 修订；新的 Agent 修订必须绑定当前教师拥有且仍在运行的 AgentRun。相同成功幂等请求可以从已成功运行重放原结果，但不能借旧运行创建另一条修订；失败或取消的运行不能写草稿。
- 一份草稿只能成功发布一次。发布后草稿封存；再次使用其内容时必须派生新草稿。

### ActivityRelease（学习活动发布实例）

- 表示某份草稿在某一时间发布给某个班级的冻结快照。
- 发布实例与草稿分离；学生提交始终引用发布实例，不引用可变草稿。
- 发布后不可原位修改核心内容。
- snapshot schema v1 与 v2 分别保持自己的精确正文和规范化 hash；旧 v1 snapshot 不因 v2 上线而回填或重算，新发布只冻结完整 v2 修订。
- D-031 通过不可变 `executionVersion` 冻结执行协议：历史 Release 与新 `once` 任务使用整项协议 0；新 v2 `phased`/`mixed` Release 使用顺序阶段协议 1。协议版本不能在发布后修改，也不能改变既有 snapshot/hash。
- 第一阶段一个发布实例只面向一个班级。
- 可设置截止时间。超过截止时间但仍处于 active 时允许迟交并明确标记；只有显式关闭才停止提交。

### ReleaseGroup（发布作业小组）

- 只属于一个 ActivityRelease，不是长期班级分组，也不会自动复用于其他 Release。
- ReleaseGroupMember 只能引用该 Release 目标班级的当前 STUDENT，并保存教师为该学生设置的角色标签；同一学生在同一 Release 最多属于一个小组。
- 只有发布教师且仍为班级管理员时可以明确确认配置。成员已有个人 Submission 时不能迁入小组；小组一旦出现任一 Submission，组名、成员、角色和删除全部锁定。
- 小组配置本身不形成实时协同会话；共享写入仍服从同一工作草稿版本和领域命令授权。

### Submission（学生提交）

- 是一个发布实例、一个提交主体和一个阶段索引之间唯一的稳定容器；提交主体必须恰好是个人学生或该 Release 的一个 ReleaseGroup。协议 0 只使用 `phaseIndex = 0`，协议 1 使用 `1..N` 阶段，`mixed` 在全部阶段完成后再使用 `0` 作为整项终稿。
- 同组成员解析到同一个“Release × Group × phaseIndex”容器并共享工作草稿、正式修订、附件和反馈；其他小组与未分组学生不能读取其存在性。个人历史继续使用“Release × Student × phaseIndex”，不回填为小组历史。
- 可编辑内容保存在工作修订中；正式提交时产生不可变的 SubmissionRevision。
- 重新提交必须显式开始新修订；旧修订及其证据、反馈均保留。
- 阶段 n 只有在 n−1 已有正式修订后才能创建；阶段正式提交在同一事务幂等准备下一阶段或 mixed 终稿，学生不能跳阶段。
- WorkingCopy 与 Revision 保存来自发布快照当前阶段的已确认证据索引；服务端拒绝任何未定义、重复或越界检查点。正式提交至少包含非空文字、一个 READY 附件或一个已确认检查点。

### Evidence（学习证据）

- 是提交中的可核验内容。
- 非空文本证据正文直接固化在不可变 SubmissionRevision，且仍是正式提交的必要条件。
- D-025/D-026 增加 SubmissionAttachment：业务记录保存所属 Submission 与学生、类型、文件名、媒体类型、大小、私有 storage key、上传/验证时间和状态；文件内容保存在 Vercel Private Blob，storage key 不构成读取权限。
- 工作草稿通过 SubmissionWorkingCopyAttachment 维护最多 5 个可调整关联；正式提交只复制 `READY` 资产到 append-only SubmissionRevisionAttachment。重交复制上一正式修订的附件关联，不覆盖旧版。
- 首个附件切片接受 JPEG、PNG、WebP、PDF、DOC 与 DOCX，单文件最大 20 MiB。类型、大小、所有权、对象元数据和文件头格式全部通过后才能进入正式修订；这项验证不声称是恶意文件扫描。
- 小组工作草稿中的附件仍归属实际上传学生；同组成员和有权教师可经授权下载，组外学生不能读取对象或元数据。

### TeacherFeedback（教师反馈）

- 归属于一个具体的 SubmissionRevision 和一名有权教师。
- 第一阶段只保存非空文字反馈，不建模评分维度。D-034 起，每条新反馈修订还冻结教师选择的形成性下一步（继续或修改重交）与支架层级（基础支持、标准任务、挑战拓展）。
- 反馈正文统一为 NFC 与 `\n` 换行，最多 10,000 个 Unicode code point；纯空白、格式控制字符或独立变体选择符不构成反馈。
- AI 可以生成建议，但最终反馈必须由教师确认保存。
- 修改反馈时追加不可变的 TeacherFeedbackRevision，不覆盖旧内容。
- 形成性下一步是学生行动建议，不是阶段状态或评分：`CONTINUE` 不构成正式评价，`REVISE` 也不回拨或锁定已经按 D-031 创建的后续阶段。学生是否能够写入仍由 Release 状态、成员关系、阶段顺序和既有提交命令决定。
- 迁移前的反馈修订保持原文字历史且不补造下一步或支架层级；所有 D-034 新修订必须同时具有这两个字段，并与已执行 ActionIntent 的 payload 精确一致。

### TeacherEvaluation（教师量规评价）

- 归属于一个具体的 SubmissionRevision 和一名有权教师，与 TeacherFeedback 分离；一对一绑定当前正式修订。
- 只对 schema v2 发布快照开放。量规来自冻结 snapshot 的 `rubricDimensions`，按 1 起始的 `dimensionIndex` 与精确 `dimensionName` 覆盖全部 4–8 个维度，不得增删或改名。不得从 v1 `feedbackCriteria` 发明维度。
- 每个维度要么给出 `excellent|good|pass|improve` 并引用本版 1–5 条不重复证据，要么标记 `INSUFFICIENT_EVIDENCE` 且引用为空。证据只能是本版有可见文字的 `{ kind: "text" }`、本版 READY 附件，或本版 `completedEvidenceIndexes` 中的检查点。
- 综评正文统一为 NFC 与 `\n` 换行，最多 10,000 个 Unicode code point；规则与反馈正文相同。
- 修改评价时追加不可变的 TeacherEvaluationRevision，不覆盖旧内容。payload `schemaVersion` 为评价合同 1，不是活动内容 schema。
- CONTINUE/REVISE 仍只存在于形成性反馈；量规评价不改变阶段状态，也不是自动评分。
- 本切片来源固定为 MANUAL，`suggestionAgentRunId` 为空；不新增 Agent 工具，也不保存 AI 建议与教师终审差异。

### AgentRun / ActionAudit（助手运行与动作审计）

- AgentRun 记录一次助手会话的业务上下文、模型与结果状态。
- ActionAudit 记录由助手提出或触发的业务工具、调用者、目标资源、确认人和执行结果。
- Agent 成功保存草稿或发布 Release 时，业务结果、成功审计与对应 AgentRun 的 `RUNNING → SUCCEEDED` 必须在同一数据库事务提交；已经成功的运行只能精确重放同一幂等结果，已经失败、取消或属于其他教师的运行不能提交新结果。
- 对话记录不能代替业务审计记录。
- D-033 的任务理解、明确假设、跨学科必要性与一致性说明是当前 AI SDK 消息中的短生命周期建议，不是新的业务实体，也不写入草稿正文之外的长期存储。只有教师批准后执行的 `create_activity_draft` 才形成既有 ActivityDraft、不可变 ActivityDraftRevision、ActionAudit 与 AgentRun provenance；拒绝确认不产生业务草稿。

### ActionIntent / IdempotencyRecord（确认意图与幂等记录）

- ActionIntent 保存高影响动作的完整规范化参数、目标版本、参数摘要、确认人和有效期。
- ActionIntent 一经创建，actor、动作、参数、摘要、目标、预期版本和有效期永久冻结；只允许合法状态向前迁移。
- 确认只代表人类同意该组精确参数，不能代替执行时的服务端授权。
- IdempotencyRecord 让创建、发布、正式提交和最终反馈在响应丢失后可以安全重试。
- 相同幂等键与相同参数返回原结果；相同键配合不同参数必须拒绝。

## 关键关系

```text
Teacher ──manages──> Classroom ──has──> ClassroomMembership ──student──> Student
   │                      │
   └──owns──> ActivityDraft
                   │ publish + confirm
                   ▼
             ActivityRelease ──targets──> Classroom
                   ├──defines──> ReleaseGroup ──has──> ReleaseGroupMember
                   │
                   └──receives──> Submission (Student XOR ReleaseGroup) ──contains──> Evidence
                                         │
                                         └──receives──> TeacherFeedback
                                         └──receives──> TeacherEvaluation
```

## 状态边界

### ActivityDraft

```text
editing ⇄ ready_for_preview → sealed
```

更新 ready 草稿会使其回到 editing。发布不会把草稿本身变成学生读取对象，而是在同一事务中创建 ActivityRelease 并封存草稿。

### ActivityRelease

```text
active → closed → archived
```

第一阶段不支持已发布内容原位修改。第一阶段只通过第一方 UI 让发布教师且仍为目标班级管理员显式确认 `ACTIVE → CLOSED`；`ARCHIVED` 留待未来能力，不提供页面或 Agent 工具。

### Submission

```text
working revision → submitted revision 1 → working revision → submitted revision 2 → …
```

`feedback_available` 是当前正式修订是否存在反馈的派生状态，不是 Submission 的可变状态字段。状态变化必须由业务命令完成，不允许页面或 Agent 直接改数据库字段。

### SubmissionAttachment

```text
upload_pending → scan_pending → ready
                              ↘ rejected
```

`ready` 与 `rejected` 是终态。数据库保留 `scan_pending` 作为既有内部状态名，但 D-026 起其语义是对象内容验证。上传、元数据读取和文件头验证都在数据库事务外完成；状态转换只记录外部边界已经验证的结果。正式修订附件关联一经创建不可更新或删除。

## 不变量

- 每个 ActivityRelease 必须有明确的发布教师、目标班级和内容快照。
- 每个 ActivityRelease 必须绑定唯一、已执行的发布 ActionIntent；发布意图执行、草稿封存、Release 与精确快照必须在同一事务形成完整事实。
- 每个 ActivityDraft 至多对应一个 ActivityRelease；发布内容、目标班级、发布教师和发布时间不可修改。
- ActivityDraft head 的内容 schema 版本和完整任务书必须与同版本不可变 revision 精确一致；v2 修订必须满足学段—年级—学科约束、主/融合学科互斥、作业类型—子类型约束、3–4 阶段证据链和评价档位约束。
- v1 与 v2 Release snapshot 必须分别等于其精确 source revision，并按对应 schema 的固定字段集合计算规范化 SHA-256；不能用 v2 字段改写 v1 历史。
- 每个 Submission 必须恰好绑定个人学生或同一 Release 的小组；个人学生及执行写入的小组成员在提交时必须属于目标班级。
- 同一学生在同一 Release 最多属于一个 ReleaseGroup；小组拥有 Submission 后，其身份、名称、成员、角色与删除均被冻结。
- 学生名单码在非空时必须全局唯一、规范化且只属于 STUDENT；教师成员页不得提供全局学生目录或按姓名模糊搜索。
- 同一学生在同一班级的成员有效区间不能重叠；同一时刻至多有一个当前区间。成员结束与重新加入保留全部历史，成功变更必须与已执行确认意图、幂等结果和动作审计在同一事务提交，并使班级版本前进一版。
- 每个发布实例、提交主体与阶段索引至多有一个 Submission；每次正式提交产生递增且不可变的 SubmissionRevision。Submission 的 `phaseIndex` 与既有资源身份字段一样不可改写。
- 正式提交必须包含非空文本证据、一个 READY 附件或一个来自冻结阶段定义的已确认检查点。
- 每个工作草稿与正式修订最多关联 5 个附件；附件声明大小为 1 至 20 MiB，类型与媒体类型必须属于 D-025/D-026 白名单。
- Attachment 的学生必须与所属 Submission 学生一致；工作副本和正式修订附件必须属于同一 Submission。
- 正式修订只能关联同一工作副本中已经 `READY` 的附件；正式附件关联不可更新或删除，工作副本被正式修订消费前必须完整复制其附件关联。
- Private Blob 的 OIDC 签名、对象元数据、文件头与下载流必须在数据库事务外处理；永久 Blob URL 不返回浏览器，每次下载仍按学生所有权或发布教师与班级管理关系重新授权并强制作为附件响应。
- 文本证据统一为 NFC 与 `\n` 换行，最多 20,000 个 Unicode code point；只含 Unicode White_Space、格式控制字符（Cf）或独立变体选择符的内容视为无证据。
- 每个 TeacherFeedback 的教师必须有权管理目标班级和发布实例。
- TeacherFeedback 必须指向该 Submission 当前的正式修订；若学生在确认后已产生新修订，保存反馈必须失败并要求重新确认。
- D-034 新增的形成性下一步、支架层级和反馈正文必须在同一个已执行 ActionIntent、TeacherFeedbackRevision、审计及幂等结果中冻结；修改只能追加下一版，不能改写旧决定。个人反馈仅本人可见，小组反馈仅该组成员共享。
- 每个 TeacherEvaluation 的教师必须同时是发布者且仍管理目标班级。评价必须指向该 Submission 当前正式修订；学生重交后原确认失效。
- D-035 的维度结果、综评、精确 SubmissionRevision、评价预期版本与 payload hash 必须在同一个已执行 ActionIntent、TeacherEvaluationRevision、审计及幂等结果中冻结；必须覆盖冻结 v2 量规的全部维度。个人评价仅本人可见，小组评价仅该组成员共享；其他调用者得到资源级不存在。
- D-036 的教师提交列表只读取当前正式修订是否存在评价及其版本号，以及快照是否提供量规；不得把综评、outcomes 或工作草稿带进列表。v1 快照在列表中标记为无量规。
- D-037 的学生活动列表只读取当前正式修订是否存在评价；不得把综评或维度结果带进列表。
- v1 snapshot 不得写入量规评价。关闭后仍允许有权教师评价，但不允许学生继续写入。
- AI 不是任何业务实体的所有者、发布者或最终评价者。
- 权限在服务端业务命令执行时重新验证，不能相信前端页面状态或 Agent 提供的上下文。
- actor、调用来源、追踪号和当前时间来自服务端可信 CommandContext，不属于表单或工具的业务输入。
- 高影响写入必须在单个事务中完成确认消费、资源写入、幂等结果和动作审计。
- Release 从 active 关闭时必须同时固化唯一、已执行且参数精确的关闭 ActionIntent；不能用直接状态更新绕过确认事实。
- 同一幂等 key 不能跨 UI/AGENT 来源重放会改变 provenance 的草稿结果。
- Agent 写入的幂等摘要必须绑定调用来源；跨 UI/AGENT 重放不能把既有结果伪装成另一种 provenance。
- AgentRun 身份、模型与开始时间不可修改，只能从 RUNNING 单向进入一个形状完整的终态；运行及其审计关联不可删除或置空。
- 设计助手的建议必须明确区分教师已提供要求、模型假设和诊断理由；缺少会改变任务结构的必要信息时不得调用草稿写工具。理解确认只批准当前签名工具参数，不是发布确认、课程质量认证或资源授权；执行时仍由共享草稿命令验证 actor、AgentRun 与幂等边界。

## 第一阶段时间与历史规则

- 所有业务时间由服务端以 UTC 生成和保存，界面按用户时区展示。
- 发布截止时间的确认参数必须是带 offset 的 ISO 时间点，且不得包含 `TIMESTAMPTZ(3)` 无法精确保存的亚毫秒精度。
- Release 超过可选截止时间后仍可迟交；`late` 在每次正式提交时计算并固化。
- Release 只能 `active → closed → archived`，不支持重新打开；第一阶段仅实现 UI 驱动的 `active → closed`，关闭后仍允许有权教师反馈和量规评价。
- 当前班级成员可以查看 active Release 并提交。历史成员可以继续读取其成员有效期内可见的 Release、自己的提交和反馈，但不能继续写入。
- Release 关闭后，原本可见的学生可以继续读取该 Release、自己的提交和反馈，但不能保存工作副本、开始重交或正式提交。
- Release 关闭后才加入班级的学生看不到该历史 Release，除非该学生已经拥有其中的提交。

## 暂不建模

- 教材版本、课程标准映射与跨学科质量自动诊断
- 通用 StageType 状态机、条件依赖、教师审批解锁与阶段退回/回溯；D-031 只接受快照索引、线性前置与多次正式阶段提交
- 自动形成性反馈、阶段审核闸门与跨提交的长期差异化方案
- 互评、自评
- 量规评价的 AI 建议、教师终审差异历史与自动评分
- 知识库与向量索引
- 过程诊断、案例库与复用目录
- 跨校组织和多租户管理

这些方向已在 `ROADMAP.md` 中作为长期候选能力记录，但尚不是领域实体、字段、枚举或状态机。它们只有在新的用户场景、权限与历史规则、验收场景和决策记录被确认后才能进入领域模型；不得为了未来路线预建空表或通用 JSON。
