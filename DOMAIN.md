# CDAS Next 领域模型

状态：启动基线（v0.1）  
日期：2026-08-18

本文只定义第一条产品闭环需要的业务概念。没有明确用户场景支撑的实体和字段不进入第一阶段。

## 核心实体

### User（用户）

- 表示经过认证的教师或学生。
- 角色只决定能力范围，不代替具体资源归属检查。

### Classroom（班级）

- 由一名教师管理。
- 是活动发布和学生可见性的边界。

### ClassroomMembership（班级成员关系）

- 明确记录学生属于哪个班级。
- 学生是否能查看活动，由成员关系和活动发布记录共同决定，不能只按年级推断。

### ActivityDraft（学习活动草稿）

- 教师可编辑的设计版本。
- 包含标题、说明、学习目标、任务要求、证据要求和反馈标准。
- 草稿永远不对学生可见。
- AI 可以创建或修改草稿建议，但修改必须归属于当前教师并留下来源记录。

### ActivityRelease（学习活动发布实例）

- 表示某份草稿在某一时间发布给某个班级的冻结快照。
- 发布实例与草稿分离；学生提交始终引用发布实例，不引用可变草稿。
- 发布后不可原位修改核心内容。
- 第一阶段一个发布实例只面向一个班级。

### Submission（学生提交）

- 归属于一个发布实例和一个学生。
- 第一阶段支持草稿与正式提交两种主要状态。
- 正式提交后内容不可被静默覆盖；如需修改，应形成明确的新修订。

### Evidence（学习证据）

- 是提交中的可核验内容。
- 第一阶段只支持文本和附件两类。
- 附件存储与业务记录分离，业务记录保存所有者、类型、存储引用和时间。

### TeacherFeedback（教师反馈）

- 归属于一次学生提交和一名有权教师。
- 第一阶段以文字反馈为主，可选少量结构化维度。
- AI 可以生成建议，但最终反馈必须由教师确认保存。

### AgentRun / ActionAudit（助手运行与动作审计）

- AgentRun 记录一次助手会话的业务上下文、模型与结果状态。
- ActionAudit 记录由助手提出或触发的业务工具、调用者、目标资源、确认人和执行结果。
- 对话记录不能代替业务审计记录。

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
editing → ready_for_preview → published_as_release
```

发布不会把草稿本身变成学生读取对象，而是创建 ActivityRelease。

### ActivityRelease

```text
active → closed → archived
```

第一阶段不支持已发布内容原位修改。

### Submission

```text
draft → submitted → feedback_available
```

状态变化必须由业务命令完成，不允许页面或 Agent 直接改数据库字段。

## 不变量

- 每个 ActivityRelease 必须有明确的发布教师、目标班级和内容快照。
- 每个 Submission 的学生在提交时必须属于目标班级。
- 每个 TeacherFeedback 的教师必须有权管理目标班级和发布实例。
- AI 不是任何业务实体的所有者、发布者或最终评价者。
- 权限在服务端业务命令执行时重新验证，不能相信前端页面状态或 Agent 提供的上下文。

## 暂不建模

- 小组
- 多阶段活动
- 互评、自评
- 知识库与向量索引
- 自动评分
- 跨校组织和多租户管理

这些概念只有在新的用户场景和权限规则被确认后才能进入领域模型。
