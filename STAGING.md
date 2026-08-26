# 受保护 staging Go/No-Go

本门禁只验证一个隔离、合成数据的 staging 环境。它不会部署应用、执行 `prisma migrate deploy`、写入 fixture、创建 Clerk 用户、调用模型或把任何环境提升为生产。没有完整受保护环境时，结果应当是可审计的 `NO_GO`，不是“跳过后绿色”。

## 入口与前置条件

在 GitHub 创建需要审批者的 `staging-go-no-go` Environment，然后手动运行 `protected staging Go/No-Go` 工作流。工作流本身不创建该 Environment、不写入 secrets，也不授予 hosting 或数据库权限。

Environment secrets：

- `STAGING_DATABASE_URL`：远端 pooled PostgreSQL runtime URL；必须是公网 target、含 pooler host 或 `pgbouncer=true`，以及 `sslmode=require`、`verify-ca` 或 `verify-full`。
- `STAGING_DIRECT_URL`：同一 staging 数据库的远端 direct URL；不得是 pooler，必须同样要求 TLS，且不能与 runtime URL 指向同一 host、port、database target。
- `STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 与 `STAGING_CLERK_SECRET_KEY`：同一 Clerk test instance 的 `pk_test_` / `sk_test_` key。
- `STAGING_TEST_TEACHER_CLERK_ID` 与 `STAGING_TEST_STUDENT_CLERK_ID`：仅用于合成 staging 门禁的两个不同 `user_...` ID。
- `STAGING_HEALTH_PROOF_SECRET`：32–4096 bytes；已部署的远端应用与受保护 gate 必须持有同一值。

Environment variables：

- `STAGING_BASE_URL`：无路径、查询或 fragment 的远端 HTTPS 根地址。
- `STAGING_DATABASE_NAME`：上面两个连接共同指向的数据库名。名称必须包含独立的 `staging` segment，不得包含 `prod` 或 `production` segment，也不能是 `postgres`、template 库、`cdas_next`、`cdas_next_test` 或 `cdas_next_e2e`。
- `STAGING_SYNTHETIC_ONLY_ATTESTED`、`STAGING_CLERK_INSTANCE_ATTESTED`、`STAGING_DATABASE_ISOLATION_ATTESTED`、`STAGING_HOSTING_ACCESS_ATTESTED`、`STAGING_ROLLBACK_OWNER_ATTESTED`、`STAGING_RETENTION_ATTESTED`：每项只有精确值 `true` 才通过；任何未知、空缺或其他值都是 `NO_GO`。

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 在 Next.js 构建时会内联到客户端 bundle，所以它必须在 build step 之前存在；这个工作流不会把它写进 artifact。AI 固定为 `AI_PROVIDER_DISABLED=1`。真实 DeepSeek smoke 继续由独立的 `e2e-real` 受保护门禁负责，且只允许合成数据。

远端 hosting 必须在构建期注入 GitHub gate 的 40-hex `CDAS_DEPLOYMENT_ID`；Next 的构建配置会冻结该值，运行期覆盖不能改变 health proof。远端 runtime 还必须把受保护 Environment 中的值分别映射为 pooled + TLS `DATABASE_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY` 与 `STAGING_HEALTH_PROOF_SECRET`，并固定 `AI_PROVIDER_DISABLED=1`。若 `pg_control_system()` 无权限、缺失或两条连接的 system identifier 不同，结论为 `NO_GO`。

构建还会从实际 checkout 独立计算 `CDAS_SOURCE_FINGERPRINT`，不接受 Environment 提供的指纹。输入包括非测试、非生成的 `src` 运行时代码与样式/图标等资产、可选 `public` 静态资产、Prisma schema 与 migrations、Next/Prisma/PostCSS/TypeScript 配置、`package.json`、`pnpm-lock.yaml` 和指纹算法文件；路径与原始 bytes 采用带长度前缀的二进制 framing 后参与 SHA-256。`.env*`、secret、测试、生成目录、artifact 和 output 不参与。gate 会从自己的当前 checkout 重算同一指纹，因此旧源码即使被注入新的 `CDAS_DEPLOYMENT_ID` 也会得到 `NO_GO`。

## 自动检查与证据

工作流按下列顺序运行：preflight、生产 build、两条独立 PostgreSQL 连接的只读 metadata 检查、`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`、远端 `/api/health`，最后聚合证据。

数据库 verifier 对每条连接只执行 `BEGIN READ ONLY`、`SELECT current_database()`、服务端版本、`pg_catalog`、`public._prisma_migrations` metadata 与 `ROLLBACK`。除 migration 行以外，它还从封闭 allowlist 检查 append-only、发布/关闭、成员历史、提交、反馈与 Agent provenance 的数据库 function、trigger 和 constraint 是否存在，避免“migration 行仍在但历史保护对象被删”被误判为通过；已被后续 migration 正式替换的旧对象不属于 allowlist。它不会运行 migration、SQL invariant、bootstrap 或任何业务查询。输出不包含 URL、hostname、用户名、密码、Clerk user ID、提示词或业务正文。

`/api/health` 不连接数据库、Clerk 或 AI。受保护门禁给每次请求一个随机 challenge；只有远端应用持有同一 proof secret，且构建期 commit、源码指纹、完整 runtime `DATABASE_URL` 的 SHA-256 指纹、pooled runtime DB target、Clerk publishable key、Clerk secret key 的 SHA-256 指纹与 `AI_PROVIDER_DISABLED=1` 同时匹配时，才返回含 deployment ID、源码指纹与 HMAC 的 `ok`。数据库 URL、secret key 及其凭据指纹都不会出现在响应或 artifact 中。这证明源码和配置绑定，不替代数据库/Clerk 实际业务可用性、DPA、地区、备份或人工审批。

每次运行上传 `output/staging/<safe-run-marker>/` 下的 `preflight.json`、`database.json`、`application.json` 与 `decision.json`，保留 14 天。每个 artifact 只包含 schema、状态、检查代码和 presence/boolean 信息。

## Go/No-Go 规则

只有以下全部满足时，`decision.json` 才会给出 `decision: "GO"`：

- 所有 preflight、build、两条只读数据库 metadata、schema diff 和 health 检查通过；
- 六项人工 attestation 都是精确的 `true`；
- 全部证据存在且 schema 正确。

这个 `GO` 只表示 `stagingSyntheticDecision: "GO"`。artifact 始终固定 `realStudentDataAllowed: false` 与 `productionDecision: "NO_GO"`；它从不授权真实学生数据或生产发布。任一 FAIL、NOT_RUN、缺失 artifact、未知人工项或解析错误都会让最终 workflow 红灯并得到 `NO_GO`。

开发期受管 staging、外部 PostgreSQL、Clerk test instance 与受保护 GitHub Environment 已建立。基础 readiness 与下述 AI-disabled 合成闭环已有同 run 的远程 PASS 证据；这仍只表示 synthetic staging 可验，不改变固定的 `realStudentDataAllowed: false` 与 `productionDecision: "NO_GO"`。本地 E2E 不能替代这一门禁，也绝不能把其可清空数据库复用于 staging。构建会从 checkout 的运行时代码、Prisma schema/migrations、构建和类型配置、锁文件及 fingerprint helper 计算 `CDAS_SOURCE_FINGERPRINT`；测试、generated、output、环境文件和 secret 不参与。远端必须在构建期冻结该 fingerprint 与 gate SHA，旧源码不能靠新 ID 通过；proof 也绑定完整 runtime DB URL 的 SHA-256，但不会回显 URL 或 hash。

## 真实身份的合成闭环验收

在基础 Go/No-Go 已能运行后，创建同样需要人工审批者的独立 `staging-synthetic-acceptance` GitHub Environment，再手动触发 `protected staging synthetic acceptance`。GitHub Environment 不继承另一个 Environment 的设置，因此必须在这个新 Environment 中完整配置本页前述全部基础 secrets、`STAGING_BASE_URL`、`STAGING_DATABASE_NAME` 和六项基础 attestation，并指定 rollback/retention owner；不能只增加下面三项变量。

这个 workflow 仍然不是部署、迁移或 production 授权：同一 run 的第一个 job 会重做基础 Go/No-Go，并以 `STAGING_HEALTH_PROOF_SECRET` 对 run、attempt、部署 SHA、源码指纹、base URL、pooled/direct DB、数据库名、Clerk test key、两个预先存在的 test user、三项 acceptance attestation、固定合成显示名以及 AI 禁用状态做 HMAC 绑定。第二个 job 只接受该 HMAC、同一 run provenance 与 `GO` 均精确匹配的 artifact；换 DB、Clerk instance、base URL、审批状态或源码都会得到 `NO_GO`，但 artifact 不含上述原值或 secret。它还会在任何数据库写入前重新请求远端 `/api/health`，因此 readiness 与 acceptance 两个 job 之间发生部署或运行时配置切换也会 fail closed。

额外的受保护 Environment variables 必须精确为 `true`：`STAGING_ACCEPTANCE_WRITES_ATTESTED`、`STAGING_ACCEPTANCE_CLERK_TOKENS_ATTESTED`、`STAGING_ACCEPTANCE_RETENTION_ATTESTED`。显示名由 workflow 固定为 `CDAS Staging Synthetic Teacher` 与 `CDAS Staging Synthetic Student`，已有 AppUser 必须精确匹配；冲突不覆盖而是 `NO_GO`。工作流只使用已有 `STAGING_TEST_*_CLERK_ID`，不会创建或更新 Clerk 用户。写数据库前，runner 会先以 Clerk backend SDK 读取两个用户，再分别签发并立即撤销一个 60 秒 capability ticket；身份不存在、属于错误 instance、无法签发或无法撤销都在零数据库写入时得到 `NO_GO`。AI 始终是 `AI_PROVIDER_DISABLED=1`。

验收班级 ID 从 `cdas-staging-<run>-<attempt>` 以确定性 name-derived UUID 派生，班级、活动和合成文本均带同一 marker。bootstrap 先探测 collision；空 namespace 可以追加，只有班级已创建但尚无该 marker 业务草稿时才允许精确重入。一旦浏览器留下任何同 marker 草稿，不论流程完成或中断，重跑都会以 `STAGING_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS` 停止，必须由新的 GitHub run attempt 取得新 marker；它不会靠重复追加来“修复”旧 run。bootstrap 只复用 operator 的追加语义，绝不 migrate、reset、truncate、delete、cleanup 或结束成员关系。已产生的合成班级、发布、提交、反馈、审计和幂等历史按 append-only 原则保留；环境退休或数据保留变更须由人工 owner 另行决定。

浏览器用 runner 进程通过 Clerk backend SDK 签发 60 秒 ticket，ticket 只经 captured pipe 驻内存，不能直接运行 ticket helper、写入 URL、日志、截图或 artifact。教师和学生使用独立浏览器 context；流程验证关闭后一个已打开的学生重交页面经既有 Server Action 被拒绝，刷新后确认只读。随后 `BEGIN READ ONLY` verifier 严格按派生 classroom ID 与 marker 内容审计，最终 evidence 必含 UTC 时间、同 run provenance、检查结果和截图 SHA-256 索引。截图没有浏览器 URL 栏，只允许展示 runner 内建的固定合成显示名、marker 与固定合成活动/证据/反馈文本；禁止环境提供的自由正文、DB URL、Clerk ID/key/ticket、cookie、真实姓名或任何真实学生数据。

上述受保护 Environment 已由开发期基础设施脚本收敛，AI-disabled 远程闭环已经形成完整 PASS artifact。常见可操作代码仍包括：`STAGING_ACCEPTANCE_PREWRITE_GATE_NOT_GO`（先修基础门禁、即时 health 或配置绑定）、`STAGING_ACCEPTANCE_NAMESPACE_COLLISION`（停止并人工检查同 marker 历史）、`STAGING_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS`（保留旧历史并以新 run attempt 重试）、`STAGING_ACCEPTANCE_TICKET_ISSUE_FAILED`（只检查 test Clerk 配置与批准）、`STAGING_ACCEPTANCE_CLOSED_READONLY_FAILED`（停止，不修改远端数据），以及任何 artifact/证据缺失导致的 final `NO_GO`。

## 首个 Agent 场景的真实模型验收

首个 Agent 场景使用第三个独立且需要人工审批者的 GitHub Environment：`staging-agent-acceptance`，入口是 `protected staging Agent acceptance`。它不继承前两个 Environment，也不把 AI-enabled staging 变成 production。默认输入 `run_real_model=false` 会保留零模型调用并明确得到 `NO_GO`；只有审批者已经确认合成写入、短期 Clerk ticket 与模型费用后，才可手动选择 `run_real_model=true`。

这个 Environment 必须重新配置前述全部基础 secrets，包括 `STAGING_DATABASE_URL`、`STAGING_DIRECT_URL`、`STAGING_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、`STAGING_CLERK_SECRET_KEY`、`STAGING_TEST_TEACHER_CLERK_ID`、`STAGING_TEST_STUDENT_CLERK_ID`、`STAGING_HEALTH_PROOF_SECRET` 与 `STAGING_VERCEL_AUTOMATION_BYPASS_SECRET`。另外增加 `STAGING_DEEPSEEK_API_KEY` 和至少 32 bytes 的 `STAGING_AI_TOOL_APPROVAL_SECRET`。这些值只注入确实需要它们的 shell step；checkout、依赖安装、Chromium 安装和 artifact actions 不继承业务 secrets。不得把任何 secret 粘贴到聊天、issue、日志或 artifact。

Environment variables 必须包含精确 Vercel Preview 根地址 `STAGING_BASE_URL`、`STAGING_VERCEL_PROJECT_NAME`、`STAGING_DATABASE_NAME`、`STAGING_AI_MODEL` 和六项基础 attestation。workflow 固定 `STAGING_DEPLOYMENT_PROTECTION_REQUIRED=1`，不能通过 Environment 覆盖。以下五项 Agent attestation 也必须精确为 `true`：

- `STAGING_AGENT_WRITES_ATTESTED`：允许本次唯一 marker 的追加式合成草稿、班级与 Release 写入。
- `STAGING_AGENT_CLERK_TOKENS_ATTESTED`：允许 runner 为预留 test identity 签发 60 秒 ticket；能力探测 ticket 会立即撤销，浏览器 ticket 只驻内存。
- `STAGING_AGENT_MODEL_COST_ATTESTED`：允许本次固定合成 prompt 的计费模型请求。
- `STAGING_AGENT_RETENTION_ATTESTED`：接受本次合成业务历史与 14 天脱敏 artifact 保留；工作流不会清理业务历史。
- `STAGING_AGENT_IDENTITIES_RESERVED_ATTESTED`：确认这四个 Clerk test user 在运行期间只用于本次验收，不会发生并行交互污染四次 AgentRun 的时间窗。

第六项 `STAGING_AGENT_RUN_MODEL_ATTESTED` 只能由 `run_real_model` dispatch 输入派生，不能用 Environment variable 伪造。显示名仍固定为 `CDAS Staging Synthetic Teacher` 和 `CDAS Staging Synthetic Student`；既有 AppUser 的角色或显示名不匹配时直接 `NO_GO`，工作流不会覆盖或修改 Clerk 用户。

远端 deployment 必须在构建期冻结当前 workflow SHA 的 `CDAS_DEPLOYMENT_ID` 与当前源码指纹，并在同一隔离 staging runtime 注入 pooled `DATABASE_URL`、同一 Clerk test instance、`AI_PROVIDER_DISABLED=0`、与 `STAGING_AI_MODEL` 相同的 `AI_MODEL`、对应 DeepSeek API key、approval secret 和 health proof secret。`/api/health` 的 challenge HMAC 会同时绑定源码、部署、runtime DB URL、Clerk key、AI enabled 状态、DeepSeek API key 指纹、模型与 approval secret 指纹；响应只返回不透明 proof，不返回这些值或指纹。Vercel Deployment Protection 必须保持启用，health 与浏览器请求仅向绑定 Preview 的精确 origin 添加 automation bypass；Clerk、DeepSeek、重定向及其他 origin 不得接收该 header。

工作流不会部署应用、执行 migration、创建 Clerk 用户、reset、truncate、delete、cleanup 或结束成员关系。它先在同一 run 重做基础 Go/No-Go，再把 run、attempt、源码、部署、DB、Clerk、AI 配置、固定 identity 和全部 attestation 绑定到 Agent gate。第二个 job 下载并重新校验这份 gate 后，顺序执行 Chromium 安装、Clerk identity 与 ticket capability 探测、紧邻写入前的 health proof、marker 派生班级 bootstrap、第一方浏览器流程、只读 verifier 和最终证据聚合。任一步失败都会阻断后续写入或模型步骤，并由 final 保持 `NO_GO`。

浏览器只用预置的合成主题、人工摘要、学生证据与教师反馈。runner 先打开绑定的 staging base URL，并在任何教师 ticket 存在前检查最终页面的 scheme、host 与有效 port 精确等于该 staging origin；首次登录、进入新建页、助手导航到预览和进入 Release 后都会再次检查，跨 origin redirect 直接失败。通过该检查后才签发 60 秒 ticket，并只经 Playwright 参数通道驻留内存。教师经真实 Clerk session 打开“新建学习活动”，模型调用 `create_activity_draft` 创建满足 D-030 原版能力下限的 schema v2 `READY_FOR_PREVIEW` 版本 1；共享的 `/teacher/activities` 客户端 layout 只在内存保留这次官方 AI SDK message session，导航到精确预览后核对基本设置、背景、三维目标、任务链和评价标准。教师随后返回普通编辑页，以固定人工摘要保存 `READY_FOR_PREVIEW` 版本 2，再明确指定 marker 班级、版本 2 和无截止时间；模型提出 `publish_activity_release`，页面展示签名 approval，教师点击确认后仍由 prepare → UI decide → publish 领域命令发布唯一不可变 Release。刷新或直接打开预览不会恢复对话，也不会绕过手工发布路径。

这段正常流程应留下恰好四个同教师、同模型、同浏览器 UTC 时间窗的 `SUCCEEDED` AgentRun：第一个只记录无业务写入的草稿提案，第二个绑定版本 1 AGENT 草稿修订，版本 2 是不带 AgentRun 的 MANUAL 修订，第三个只记录无业务写入的发布提议，第四个绑定 ActionIntent、prepare/decide/publish audits 与 Release。最终 verifier 在 `BEGIN READ ONLY` 中精确检查该教师与 marker 标题下只有一份草稿、SEALED v2 head、两条不可变修订、CLOSED Release 与完整 snapshot、教师本人确认并执行的 null-due 发布 ActionIntent、主学生正式提交、教师确认反馈、关闭 ActionIntent、陈旧写拒绝、其他学生零提交历史和其他教师零目标操作；同标题的额外草稿或时间窗中的额外 AgentRun 都会失败。final 聚合器还会逐类验证 readiness、gate、identity、即时 health、bootstrap、browser 与 verifier 的精确顶层键、完整且唯一的 PASS check code、共同数据边界，以及八个固定截图键与合法且匹配文件的 SHA-256；任何畸形或部分证据保持 `NO_GO`。

这个 Environment、可临时启用 AI 的受保护 deployment 管理路径与本机忽略凭据已经建立。D-033 真实模型 run `32785815755` 已在提交 `491da4d6beaa1d0de0afa6678505f9f66e145827` 上完成固定合成流程；最终 artifact、只读 verifier、浏览器隔离检查、四次精确 AgentRun、八张截图及其 SHA-256 全部 PASS。该结论只证明 synthetic staging 的 Agent 教学闭环，不改变 artifact 固定的 `realStudentDataAllowed: false` 与 `productionDecision: "NO_GO"`。一键命令收尾时已移除临时模型/审批 secrets，并恢复和核验 AI-disabled Preview；本地下载后的复验也使用同一严格证据合同，不会重新调用模型。

## 当前脱敏验证记录

| 日期 | 提交 | 证据 | 结论 |
| --- | --- | --- | --- |
| 2026-08-26 | `6c76b2b7f6c432c572627a9f38d756184acbc9a5` | [AI-disabled 教师发布页待重交跟进标记完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32943934421) | Hobby Preview、当前正式修订「待重交 1」、覆盖计数「已反馈 1/3」与「已评价 1/3」、既有评价列表状态、小组成员共享评价、其他教师/学生资源隔离、关闭后拒写与只读、只读数据库核验及六张截图全部 PASS。`AI_PROVIDER_DISABLED=1`。 |
| 2026-08-26 | `8e902a0e233064442041a69fe449292bfd9d1cce` | [AI-disabled 教师发布页反馈/评价覆盖计数完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32937628880) | Hobby Preview、当前正式修订「已反馈 1/3」与「已评价 1/3」、既有评价列表状态、小组成员共享评价、其他教师/学生资源隔离、关闭后拒写与只读、只读数据库核验及六张截图全部 PASS。`AI_PROVIDER_DISABLED=1`。 |
| 2026-08-26 | `d1c9386fd66fbb08d29415cec4c2989dacbe6a6f` | [AI-disabled 证据绑定量规评价完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32901425620) | Hobby Preview、教师手写确认维度—证据绑定评价与证据不足、教师列表「已评价 v1」、学生列表「已有评价」且不泄露综评、小组成员共享评价、其他教师/学生资源隔离、关闭后拒写与只读、只读数据库核验及六张截图全部 PASS。`AI_PROVIDER_DISABLED=1`。 |
| 2026-08-25 | `491da4d6beaa1d0de0afa6678505f9f66e145827` | [D-033 真实 DeepSeek 受约束设计助手完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32785815755) | 结构化任务理解、教师确认后创建 schema v2 草稿、人工版本 2、独立签名发布确认、学生提交、教师反馈、学生读取、关闭后拒写与只读、其他学生/教师隔离、四个精确 `SUCCEEDED` AgentRun、13 项只读数据库核验及八张截图全部 PASS。 |
| 2026-08-25 | `b1a96a28dc789d96707d6e1b7f47317bd2a4d633` | [AI-disabled 双学生小组完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32780071107) | Hobby Preview、18 个迁移与 schema drift、教师建立两人 Release 小组及角色、两名学生接力完成三个共享阶段、Private Blob 附件、共享反馈、关闭后拒写与只读、学生/其他教师资源隔离、8 项只读小组历史核验及六张截图全部 PASS。 |
| 2026-08-25 | `b4035bba44287c298b4a3e8a1b2b05162a806c8e` | [AI-disabled 三阶段完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32763998574) | Hobby Preview、17 个迁移与 schema drift、三阶段顺序解锁、三个发布内检查点、Private Blob 附件、教师反馈、关闭后拒写与只读、其他学生/教师隔离、只读阶段索引/修订精确计数及六张截图全部 PASS。 |
| 2026-08-25 | `df1d37a3ea454418b38ef8e9a9b1d336a6b0d1a2` | [schema v2 真实 DeepSeek Agent 完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32755788543) | 原版 CTS 能力下限的结构化任务书、教师人工版本 2、签名发布确认、主学生提交、教师反馈、学生读取、教师关闭、关闭后拒写与只读、其他学生/教师隔离、三个精确 `SUCCEEDED` AgentRun、13 项只读数据库核验及七张截图全部 PASS。 |
| 2026-08-24 | `2192a2790af6a2eddf63716be47309445a3d41e9` | [真实 DeepSeek Agent 完整合成闭环](https://github.com/linics/cdas-next/actions/runs/32732773297) | 模型草稿、教师人工版本 2、签名发布确认、唯一 Release、主学生非空文本正式提交、教师确认反馈、学生读取、教师确认关闭、关闭后陈旧写拒绝与只读、其他学生/教师资源隔离、三个精确 `SUCCEEDED` AgentRun、只读数据库核验及七张截图全部 PASS。 |
| 2026-08-24 | `fe8068267e2b6d7257ddff26fb10732719af5a74` | [受保护 AI-disabled 四身份手工闭环](https://github.com/linics/cdas-next/actions/runs/32729693159) | readiness、真实 Clerk 会话、手工草稿/发布、主学生非空文本提交、教师确认反馈、学生读取、教师确认关闭、陈旧写拒绝、关闭后只读、其他学生/教师资源隔离、附件合成路径、只读数据库核验与完整 artifact 全部 PASS。 |
| 2026-08-24 | `a56586c5a899efa0959de2a3f2f3ac4367f02ba8` | [普通 CI](https://github.com/linics/cdas-next/actions/runs/32730629410) | 生产依赖审计、空库迁移、数据库不变量、数据库命令测试、schema diff、lint、类型、单测与生产构建 PASS。该提交只修复 workflow 完成后 artifact 短暂不可下载造成的一键脚本误报。 |
| 2026-08-24 | `87bf962baa0ccefa727d0ed175184bd8b9ff72c3` | [早期真实 DeepSeek 合成验收](https://github.com/linics/cdas-next/actions/runs/32727676178) | 最终 `NO_GO`，不得作为完成证据。只读账本确认模型草稿、人工版本 2、签名 approval、三个 `SUCCEEDED` AgentRun 与唯一 Release 已成功；浏览器随后因旧链接契约误报。该问题由 `fe80682` 修复，并已被上方完整 PASS run 取代。 |

以上记录只包含公开提交、GitHub run、机器结论和固定合成数据边界，不记录 URL secret、数据库连接、Clerk ID/key/ticket、Cookie、模型 key 或任何真实用户数据。

## 迁移、回滚与事故边界

本门禁只检测 schema drift；迁移必须另行审查和授权。若受保护 staging 需要修复 schema，先在隔离 staging 执行经过批准的 forward-only migration，再重新跑本门禁。append-only 的业务历史和数据库约束不允许以回滚 migration 或删除数据来“修复”结果。

代码回滚与数据库处理分开：代码版本可回滚到上一份已验证 artifact；已应用数据库 migration 采用新的、向前的修复 migration。人工 attestation 中的 rollback owner 必须明确负责这一决定、记录事故时间线并确认 hosting access。任何涉及数据驻留、DPA、保留/删除、供应商区域或真实学生数据的选择都是独立合规决策，不能由本门禁默认通过。
