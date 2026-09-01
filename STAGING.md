# 受保护 staging Go/No-Go

本门禁只验证隔离的合成数据 staging。它不授权生产或真实学生数据；任一配置、证据或人工声明缺失时必须得到可审计的 `NO_GO`，不能跳过后绿色。

## 三条远端门禁

1. `protected staging Go/No-Go`：只读验证 build、部署指纹、PostgreSQL metadata、schema drift 与 `/api/health`。
2. `protected staging synthetic acceptance`：使用六个本地合成账号完成 AI-disabled 教学闭环、停用边界和跨校隔离。
3. `protected staging Agent acceptance`：在相同本地身份边界上增加固定合成 DeepSeek 场景与费用确认。

三个 workflow 分别使用需要审批者的 GitHub Environment：

- `staging-go-no-go`
- `staging-synthetic-acceptance`
- `staging-agent-acceptance`

Environment 之间不继承变量或 secrets。workflow 不创建 Environment、不部署应用、不执行 migration、不重置数据库，也不创建真实账号。

## 基础配置

基础 secrets：

- `STAGING_DATABASE_URL`：TLS pooled PostgreSQL runtime URL。
- `STAGING_DIRECT_URL`：同一数据库的 TLS direct URL；必须与 pooled host/port 分离。
- `STAGING_HEALTH_PROOF_SECRET`：32–4096 bytes。
- `STAGING_VERCEL_AUTOMATION_BYPASS_SECRET`：仅发送给精确 Preview origin。

基础 variables：

- `STAGING_BASE_URL`：无 path/query/fragment 的 HTTPS Preview 根地址。
- `STAGING_VERCEL_PROJECT_NAME`：与该 Preview 对应的 Vercel project 名称。
- `STAGING_DATABASE_NAME`：明确包含独立 `staging` segment 的数据库名。
- `STAGING_TEST_PRIMARY_SCHOOL_CODE`
- `STAGING_TEST_SECONDARY_SCHOOL_CODE`
- `STAGING_TEST_TEACHER_STAFF_NO`
- `STAGING_TEST_STUDENT_NO`
- `STAGING_TEST_OTHER_STUDENT_NO`
- `STAGING_TEST_OTHER_TEACHER_STAFF_NO`
- `STAGING_SYNTHETIC_ONLY_ATTESTED=true`
- `STAGING_LOCAL_AUTH_ATTESTED=true`
- `STAGING_DATABASE_ISOLATION_ATTESTED=true`
- `STAGING_HOSTING_ACCESS_ATTESTED=true`
- `STAGING_ROLLBACK_OWNER_ATTESTED=true`
- `STAGING_RETENTION_ATTESTED=true`

Go/No-Go 只读取数据库 metadata 和迁移状态，不读取业务正文。远端 build/runtime 必须冻结当前 checkout 的 `CDAS_DEPLOYMENT_ID` 与源码指纹，并固定 `AI_PROVIDER_DISABLED=1`。health proof 绑定部署、源码和 runtime 配置，但不返回连接字符串、secret 或凭据指纹。

## Synthetic acceptance

额外 variables：

- `STAGING_ACCEPTANCE_WRITES_ATTESTED=true`
- `STAGING_ACCEPTANCE_LOCAL_AUTH_ATTESTED=true`
- `STAGING_ACCEPTANCE_RETENTION_ATTESTED=true`
- `STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO`
- `STAGING_TEST_DISABLED_SCHOOL_CODE`
- `STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO`

六个密码只存对应 Environment secrets：

- `STAGING_TEST_TEACHER_PASSWORD`
- `STAGING_TEST_STUDENT_PASSWORD`
- `STAGING_TEST_OTHER_STUDENT_PASSWORD`
- `STAGING_TEST_OTHER_TEACHER_PASSWORD`
- `STAGING_TEST_DISABLED_ACCOUNT_PASSWORD`
- `STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD`

runner 使用学校代码、工号/学号和密码提交第一方登录表单，并严格验证 `cdas_session` 的非空值、HttpOnly、SameSite=Lax、Secure、Path=/ 和有效过期时间。密码在使用后从进程环境和表单输入中清除，不进入日志、截图、artifact 或 Git。

bootstrap 只在 marker 派生 namespace 为空时追加合成学校、账号和教学数据。发现同 marker 业务历史时失败关闭，不 truncate、delete、reset 或用重复写入“修复”旧 run。浏览器与只读 verifier 共同检查完整教学闭环、关闭后拒写、其他学生/教师隔离、停用账号、停用学校和跨校拒绝。

## Agent acceptance

除上述本地账号配置外，还需要：

- `STAGING_DEEPSEEK_API_KEY`
- `STAGING_AI_TOOL_APPROVAL_SECRET`（至少 32 bytes）
- `STAGING_AI_MODEL`
- `STAGING_AGENT_WRITES_ATTESTED=true`
- `STAGING_AGENT_LOCAL_SESSIONS_ATTESTED=true`
- `STAGING_AGENT_MODEL_COST_ATTESTED=true`
- `STAGING_AGENT_RETENTION_ATTESTED=true`
- `STAGING_AGENT_IDENTITIES_RESERVED_ATTESTED=true`

`STAGING_AGENT_RUN_MODEL_ATTESTED` 只能由 workflow dispatch 的 `run_real_model` 输入派生。默认 `false` 必须保持 `NO_GO` 且零模型调用。只有审批者确认固定合成写入和模型费用后才能选择 `true`。

Agent 门禁仍使用本地登录表单和数据库 session。模型只处理固定合成主题；草稿提案、教师确认写入、发布提议和教师确认发布分别留下精确 AgentRun/provenance，后续提交、反馈、关闭和隔离检查继续走普通第一方 UI。

## 开发期收敛与当前边界

`pnpm development:infra` 只从权限为 `0600`、Git 忽略的 `.env.staging.local` 读取允许名单，并负责收敛 Vercel Preview、Neon staging 与 GitHub Environment。密码只写 GitHub Environment secrets，不写 Vercel。

旧身份供应商变量只作为远端清理名单保留在基础设施脚本中。清理仅允许精确的分支级 Preview scope；发现 production、无 branch 或 preview/production 混合 target 时抛出 `DEVELOPMENT_INFRA_VERCEL_LEGACY_ENV_SCOPE_UNSAFE` 并停止后续步骤。当前真实项目已触发该护栏，因此源码收尾不等于远端环境已清理；production/global 变量必须由 operator 明确确认范围后另行处理，禁止自动扩大删除。

所有 artifact 固定 `realStudentDataAllowed: false` 与 `productionDecision: "NO_GO"`。旧供应商时期的历史 PASS run 只证明当时提交，不代表 D-060 本地认证远端门禁已经通过；D-060 的远端结论必须来自当前分支的新 run。

## 回滚与事故边界

迁移只允许审查后的 forward-only migration。代码可回滚到已验证 artifact，已应用的数据库 schema 与 append-only 业务历史不能用回滚 migration 或删除数据“修复”。任何数据驻留、DPA、保留/删除、供应商区域或真实学生数据决定都需要独立授权。
