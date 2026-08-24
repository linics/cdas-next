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
- 第一阶段一个发布实例只面向一个班级。
- 可设置截止时间。超过截止时间但仍处于 active 时允许迟交并明确标记；只有显式关闭才停止提交。

### Submission（学生提交）

- 是一个发布实例和一个学生之间唯一的稳定容器。
- 可编辑内容保存在工作修订中；正式提交时产生不可变的 SubmissionRevision。
- 重新提交必须显式开始新修订；旧修订及其证据、反馈均保留。

### Evidence（学习证据）

- 是提交中的可核验内容。
- 非空文本证据正文直接固化在不可变 SubmissionRevision，且仍是正式提交的必要条件。
- D-025/D-026 增加 SubmissionAttachment：业务记录保存所属 Submission 与学生、类型、文件名、媒体类型、大小、私有 storage key、上传/验证时间和状态；文件内容保存在 Vercel Private Blob，storage key 不构成读取权限。
- 工作草稿通过 SubmissionWorkingCopyAttachment 维护最多 5 个可调整关联；正式提交只复制 `READY` 资产到 append-only SubmissionRevisionAttachment。重交复制上一正式修订的附件关联，不覆盖旧版。
- 首个附件切片接受 JPEG、PNG、WebP、PDF、DOC 与 DOCX，单文件最大 20 MiB。类型、大小、所有权、对象元数据和文件头格式全部通过后才能进入正式修订；这项验证不声称是恶意文件扫描。

### TeacherFeedback（教师反馈）

- 归属于一个具体的 SubmissionRevision 和一名有权教师。
- 第一阶段只保存非空文字反馈，不建模评分维度。
- 反馈正文统一为 NFC 与 `\n` 换行，最多 10,000 个 Unicode code point；纯空白、格式控制字符或独立变体选择符不构成反馈。
- AI 可以生成建议，但最终反馈必须由教师确认保存。
- 修改反馈时追加不可变的 TeacherFeedbackRevision，不覆盖旧内容。

### AgentRun / ActionAudit（助手运行与动作审计）

- AgentRun 记录一次助手会话的业务上下文、模型与结果状态。
- ActionAudit 记录由助手提出或触发的业务工具、调用者、目标资源、确认人和执行结果。
- Agent 成功保存草稿或发布 Release 时，业务结果、成功审计与对应 AgentRun 的 `RUNNING → SUCCEEDED` 必须在同一数据库事务提交；已经成功的运行只能精确重放同一幂等结果，已经失败、取消或属于其他教师的运行不能提交新结果。
- 对话记录不能代替业务审计记录。

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
                   │
                   └──receives──> Submission ──contains──> Evidence
                                         │
                                         └──receives──> TeacherFeedback
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
- 每个 Submission 的学生在提交时必须属于目标班级。
- 学生名单码在非空时必须全局唯一、规范化且只属于 STUDENT；教师成员页不得提供全局学生目录或按姓名模糊搜索。
- 同一学生在同一班级的成员有效区间不能重叠；同一时刻至多有一个当前区间。成员结束与重新加入保留全部历史，成功变更必须与已执行确认意图、幂等结果和动作审计在同一事务提交，并使班级版本前进一版。
- 每个发布实例与学生至多有一个 Submission；每次正式提交产生递增且不可变的 SubmissionRevision。
- 正式提交必须包含非空文本证据。
- 每个工作草稿与正式修订最多关联 5 个附件；附件声明大小为 1 至 20 MiB，类型与媒体类型必须属于 D-025/D-026 白名单。
- Attachment 的学生必须与所属 Submission 学生一致；工作副本和正式修订附件必须属于同一 Submission。
- 正式修订只能关联同一工作副本中已经 `READY` 的附件；正式附件关联不可更新或删除，工作副本被正式修订消费前必须完整复制其附件关联。
- Private Blob 的 OIDC 签名、对象元数据、文件头与下载流必须在数据库事务外处理；永久 Blob URL 不返回浏览器，每次下载仍按学生所有权或发布教师与班级管理关系重新授权并强制作为附件响应。
- 文本证据统一为 NFC 与 `\n` 换行，最多 20,000 个 Unicode code point；只含 Unicode White_Space、格式控制字符（Cf）或独立变体选择符的内容视为无证据。
- 每个 TeacherFeedback 的教师必须有权管理目标班级和发布实例。
- TeacherFeedback 必须指向该 Submission 当前的正式修订；若学生在确认后已产生新修订，保存反馈必须失败并要求重新确认。
- AI 不是任何业务实体的所有者、发布者或最终评价者。
- 权限在服务端业务命令执行时重新验证，不能相信前端页面状态或 Agent 提供的上下文。
- actor、调用来源、追踪号和当前时间来自服务端可信 CommandContext，不属于表单或工具的业务输入。
- 高影响写入必须在单个事务中完成确认消费、资源写入、幂等结果和动作审计。
- Release 从 active 关闭时必须同时固化唯一、已执行且参数精确的关闭 ActionIntent；不能用直接状态更新绕过确认事实。
- 同一幂等 key 不能跨 UI/AGENT 来源重放会改变 provenance 的草稿结果。
- Agent 写入的幂等摘要必须绑定调用来源；跨 UI/AGENT 重放不能把既有结果伪装成另一种 provenance。
- AgentRun 身份、模型与开始时间不可修改，只能从 RUNNING 单向进入一个形状完整的终态；运行及其审计关联不可删除或置空。

## 第一阶段时间与历史规则

- 所有业务时间由服务端以 UTC 生成和保存，界面按用户时区展示。
- 发布截止时间的确认参数必须是带 offset 的 ISO 时间点，且不得包含 `TIMESTAMPTZ(3)` 无法精确保存的亚毫秒精度。
- Release 超过可选截止时间后仍可迟交；`late` 在每次正式提交时计算并固化。
- Release 只能 `active → closed → archived`，不支持重新打开；第一阶段仅实现 UI 驱动的 `active → closed`，关闭后仍允许有权教师反馈。
- 当前班级成员可以查看 active Release 并提交。历史成员可以继续读取其成员有效期内可见的 Release、自己的提交和反馈，但不能继续写入。
- Release 关闭后，原本可见的学生可以继续读取该 Release、自己的提交和反馈，但不能保存工作副本、开始重交或正式提交。
- Release 关闭后才加入班级的学生看不到该历史 Release，除非该学生已经拥有其中的提交。

## 暂不建模

- 小组
- 教材版本、课程标准映射与跨学科质量自动诊断
- 阶段依赖/回溯与检查点多次正式提交
- 差异化方案与阶段反馈
- 互评、自评
- 评价维度与具体提交证据的绑定、自动评价建议
- 知识库与向量索引
- 自动评分
- 过程诊断、案例库与复用目录
- 跨校组织和多租户管理

这些方向已在 `ROADMAP.md` 中作为长期候选能力记录，但尚不是领域实体、字段、枚举或状态机。它们只有在新的用户场景、权限与历史规则、验收场景和决策记录被确认后才能进入领域模型；不得为了未来路线预建空表或通用 JSON。
