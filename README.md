# CDAS Next

面向 K12 教师与学生的跨学科学习活动工作台。第一阶段只完成一条可追溯闭环：教师设计并确认发布，学生提交学习证据，教师确认反馈、学生查看反馈，并由发布教师兼当前班级管理员明确确认关闭发布。

当前源码已覆盖手工完整闭环：教师以原版 CTS/CDAS 为能力下限设计 schema v2 跨学科任务书，保存不可变草稿修订并冻结发布；学生读取同一份基本设置、三维目标、真实情境、3–4 阶段行动—支架—证据链和四档评价标准，再完成文字与附件证据、正式修订、教师反馈、量规评价、反馈/评价读取及明确关闭。v2 发布若采用 `phased` 或 `mixed`，学生按冻结快照的阶段顺序、检查点，以及（若已配置）ReleaseGroup 共享提交继续执行；`once` 与历史发布仍使用整项提交。新的教师反馈修订会把 `CONTINUE|REVISE` 与 `FOUNDATION|STANDARD|CHALLENGE` 连同正文一并冻结。v2 快照上的量规评价按冻结维度覆盖全部档位或标记证据不足，并引用本版证据；v1 快照不开放评价。既有 schema v1 草稿和发布原样可读，新写入统一使用完整 v2；关闭会阻止学生后续写入，但保留活动、提交、反馈和评价历史，并允许有权教师继续反馈或评价。活动助手使用 AI SDK 直连 DeepSeek 官方 API 创建同一 v2 可编辑草稿，并在教师核对精确参数后复用同一发布命令；模型关闭时全部手工路径仍可运行。发布、关闭、提交、反馈与评价命令共用资源级授权、可信服务端上下文、乐观并发、幂等、不可变历史和审计。本地真实浏览器门禁已使用 Clerk development 双账号会话和专用 PostgreSQL 重放完整任务书、两版草稿、发布、两次提交、逐版反馈、历史成员只读、关闭只读、同角色越权、陈旧确认与幂等重放，范围仍是后文所述的两版文本闭环，不把 `phaseIndex`、ReleaseGroup、反馈下一步字段或量规评价算进该门禁的成功条件；阶段、小组、结构化反馈与量规评价由 staging 合成验收覆盖。受保护 Preview 的四身份手工闭环和固定合成数据 DeepSeek Agent schema v2 闭环均已有脱敏远程 PASS 证据。

## 快速开始

需要 Node.js 24、pnpm 11 和 Docker Desktop。

```bash
pnpm install
docker compose up -d database
cp .env.example .env
pnpm db:deploy
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。本地运行 `next dev` 且没有 Clerk 密钥时，会使用 Clerk 官方临时测试登录；正式构建仍要求真实密钥。登录后还必须由初始化命令把 Clerk 用户绑定为教师或学生，未绑定账号不会读取业务数据或显示写入入口。模型默认关闭，普通教师与学生流程不依赖 AI。

## 验证

```bash
# 静态检查、纯领域测试和生产构建
pnpm check

# 数据库约束与集成测试；使用 .env 中的 TEST_DATABASE_URL
docker compose up -d test-database
pnpm db:test:deploy
pnpm db:test

# 真实数据库命令与查询集成测试
pnpm test:db

# 确认已部署测试库与当前 Prisma schema 没有漂移
pnpm db:test:diff

# 生产依赖漏洞审计
pnpm audit:prod
```

### 真实浏览器闭环

浏览器门禁使用 Python Playwright 1.58.0 与 Chromium；它不保存 storage state、cookie 或 Clerk ticket。先建立项目专用虚拟环境：

```bash
python3 -m venv .venv-e2e
source .venv-e2e/bin/activate
python3 -m pip install -r scripts/e2e/requirements.txt
python3 -m playwright install chromium
```

在同一个 Clerk development instance 中准备一名教师和一名学生，并把已有 `user_...` ID 写入不提交的 `.env.local`：

```dotenv
DEV_TEST_TEACHER_CLERK_ID=user_teacherFromClerk
DEV_TEST_STUDENT_CLERK_ID=user_studentFromClerk
E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/cdas_next_e2e
```

然后执行：

```bash
pnpm e2e:closed-loop
```

该命令只会停止、删除并重建 Compose 中名为 `e2e-database` 的 tmpfs 服务，部署全部 migration，幂等映射固定双账号与班级，在 `http://localhost:3100` 启动 `next dev`，并强制 `AI_PROVIDER_DISABLED=1`。它拒绝非本机或非 `cdas_next_e2e` 数据库、与开发库或 `TEST_DATABASE_URL` 重合的目标，以及 Clerk production keys；不会清空 5432 开发库或 5433 集成测试库。runner 每次生成一个至少 32 字节的随机 broker secret；仅持有该 secret 的本机进程能请求 60 秒 Clerk ticket，再由 Playwright 在内存中建立真实 Clerk session。产品页面不暴露测试账号切换按钮，production 中 broker 路由始终返回 404，ticket、secret、cookie 与 storage state 都不写入证据。

成功门禁同时检查页面与数据库事实：双账号必须通过 Clerk session ticket 真正切换；两版草稿、发布快照、两版正式提交、每版反馈、显式发布/反馈/关闭 ActionIntent、成功审计与幂等记录必须存在；同角色外部草稿与跨角色教师路由返回 404；结束当前成员关系后仍保留历史只读；关闭后学生只能查看两版历史；旧版本发布确认只能留下 `STALE_VERSION` 冲突审计；重放关闭幂等键不得增加历史；禁用模型时不得产生 `AgentRun`。忽略目录 `output/e2e/<run-marker>/` 保留八张阶段截图、经过 token 脱敏的 Next 日志和不含凭据的 `result.json`。

### 可选真实模型 smoke

这个门禁复用现有 `/api/assistant/activity-draft`、真实 Clerk development 教师会话与专用 E2E PostgreSQL，不新增第二套后端。它会向 DeepSeek 官方 API 发送一份明确标记的合成节水活动，只允许模型调用 `create_activity_draft`；不会请求发布，也要求数据库中不存在 Release 或 ActionIntent。它可能消耗真实模型额度，所以默认失败关闭，并且必须同时具备非 production Clerk 双账号、DeepSeek API key、有效模型、至少 32 字节的审批密钥和一次性成本确认：

```dotenv
DEEPSEEK_API_KEY=配置在本机密钥文件或受保护环境
AI_MODEL=deepseek-v4-flash
AI_TOOL_APPROVAL_SECRET=至少32字节的随机值
```

```bash
AI_PROVIDER_DISABLED=0 \
E2E_REAL_MODEL_ACK=synthetic-data-cost-approved \
pnpm e2e:real-model
```

前置检查在重建数据库或发出 provider 请求前运行；缺少成本确认、凭据、模型、审批密钥或安全数据库目标时会明确失败。成功证据先包含结构化任务理解提案截图，再包含完整 schema v2 任务书的可预览草稿截图和脱敏日志，并核对恰好两个 `SUCCEEDED` AgentRun：第一个提案运行没有业务写入，第二个草稿执行运行绑定唯一 `AGENT` 修订；成功审计与幂等记录存在，同时发布与确认计数保持为零。该 smoke 只证明真实 provider transport 与草稿 provenance；签名发布审批、拒绝、伪造签名、写后 provider 中断等确定性反例继续由现有集成测试覆盖。

仓库另提供手动 `protected real-service e2e` GitHub Actions 工作流。先创建需要审批者的 `e2e-real` GitHub Environment，配置 Clerk 四项 secrets；若要启用模型 smoke，再配置 `DEEPSEEK_API_KEY`、`AI_TOOL_APPROVAL_SECRET` secrets 与 `AI_MODEL` environment variable。普通 PR CI 永远保持 `AI_PROVIDER_DISABLED=1`，不会读取这些凭据或产生模型费用。受保护工作流只上传合成数据截图、脱敏日志和 `result.json`，保留 14 天，不上传 cookie、storage state 或 Clerk ticket。

### 受保护 staging Go/No-Go

新增的手动 `protected staging Go/No-Go` workflow 只验证已经存在的隔离 staging：它 fail-closed 检查 test Clerk、远端 pooled/runtime 与 direct PostgreSQL URL、生产 build、只读 migration metadata、schema drift 和不连数据库的 `/api/health`，再聚合为脱敏的机器可读结论。它不会部署、执行 migration、写 fixture、创建账号或调用模型。即使自动检查全部通过，结论也只允许 synthetic staging；`realStudentDataAllowed` 固定为 `false`、`productionDecision` 固定为 `NO_GO`。配置项、人工 attestations、当前脱敏证据、回滚边界和 Agent 验收状态见 [STAGING.md](./STAGING.md)。

开发期测试基础设施由 `pnpm development:infra` 从仓库根目录、Git 忽略且权限为 `0600` 的 `.env.staging.local` 自动收敛。该命令只接受文件中列出的变量名，不回显值；它核验 Vercel 仍为 Hobby、Private Blob 不含长期 token、Clerk 为 development instance、Neon 为独立 schema-only staging，并部署 AI-disabled Preview、配置合成账号与 GitHub Environment、运行完整手工闭环。Vercel 构建不会执行 `db:deploy`，迁移只由此受控命令使用 Neon direct URL 单独执行。

真实 DeepSeek Agent 验收使用另一个同样 Git 忽略、权限为 `0600` 的 `.env.model-acceptance.local`，文件只能包含变量名 `DEEPSEEK_API_KEY`。即使凭据存在，下面命令缺少精确费用确认参数时也会在任何远程变更或模型请求前退出：

```bash
pnpm development:agent-acceptance \
  --model-cost-approved=synthetic-data-cost-approved
```

该命令先重新核验 Hobby、Private Blob、Clerk、Neon、源码 SHA 与 AI-enabled health，再把费用闸门作为最后一项配置并精确派发 `staging-agent-acceptance`。工作流使用四个预留合成身份，让同一个 AI 创建并由教师确认发布的 Release 继续经过学生正式提交、教师确认反馈、学生读取反馈、教师关闭、关闭后拒写与其他师生资源隔离；后半段全部走普通第一方 UI，不产生额外 AgentRun。成功后命令会下载并重新验证脱敏 artifact；无论成功或失败，`finally` 都会先关闭 GitHub 费用闸门、删除 GitHub 与 Vercel 分支级模型/审批 secrets，然后部署并核验 AI-disabled Preview。命令参数仍是每次执行都必须提供的技术 fail-closed 门槛；项目所有者已对这组固定合成数据的开发验收给出持续授权，因此后续可在该边界内自动运行而无需逐次打断。生产资源、真实用户数据、套餐升级或付款资料，以及扩展到非固定合成模型调用，仍不在此授权内。

`db:test`、`test:db` 与 `db:test:diff` 只接受独立的 `TEST_DATABASE_URL`，并拒绝与 `DATABASE_URL`、`DIRECT_URL` 或文档默认开发库指向同一 PostgreSQL 目标；不会把 append-only fixture 写进开发库。缺少或不安全的测试库 URL 会明确失败，不会以跳过测试伪装成绿色结果。数据库测试覆盖成员关系、ActionIntent 状态机、Release 与唯一已执行发布意图的绑定、精确快照及规范化 SHA-256、显式关闭意图与前向生命周期、不可变草稿、提交和反馈修订、AgentRun 单向终态与不可擦除 provenance；命令集成测试覆盖越权、确认换参、串行与并发幂等、空证据、迟交、重交使旧反馈确认失效、关闭后学生只读且教师仍可反馈，以及 `AI_PROVIDER_DISABLED=1` 下不依赖 AgentRun 的完整手工闭环。助手测试另行覆盖严格消息合同、AgentRun 生命周期、工具来源、签名审批续传、拒绝、伪造签名、跨新运行重放、工具前模型中断零写入，以及写入后映射或 provider step 失败仍保留已提交结果的成功 provenance。

生产构建显式使用 Next.js 官方 `--webpack` 选项。当前依赖图在 Next.js 16.3.1 的默认 Turbopack build 中会无诊断停滞，而同一源码的 Webpack build 能完成编译、类型检查、静态页面生成和构建追踪；升级 Next.js 或 AI SDK 后应重新验证默认 bundler。

## 技术基线

- Next.js 16 App Router、React 19、严格 TypeScript
- Clerk 托管认证；应用数据库保存角色和资源授权事实
- PostgreSQL 17、Prisma 7 与可审查 SQL migration
- Vercel AI SDK 的结构化工具 UI；服务端 ActionIntent 才是可信确认
- Vitest；数据库约束通过真实 PostgreSQL 验证
- 附件切片使用 Vercel Private Blob、短期 OIDC 预签名上传和文件头格式验证；未配置或 Hobby 配额暂停时纯文字流程保持可用

生产候选为 Vercel、Neon、Clerk 与 Vercel Private Blob，但在真实学生数据进入前仍需完成数据驻留、DPA、保留、删除和恶意文件处理审查。

## 配置

| 变量 | 用途 | 本地默认 |
| --- | --- | --- |
| `DATABASE_URL` | 应用运行时 PostgreSQL 连接；托管环境使用 pooled URL | `postgresql://postgres:postgres@127.0.0.1:5432/cdas_next` |
| `DIRECT_URL` | Prisma migration 的直连 URL；未设置时使用 `DATABASE_URL` | 空 |
| `TEST_DATABASE_URL` | 仅供 SQL 不变量和集成测试使用的可丢弃 PostgreSQL | `postgresql://postgres:postgres@127.0.0.1:5433/cdas_next_test` |
| `E2E_DATABASE_URL` | 仅供真实浏览器门禁使用的本机可丢弃 PostgreSQL | `postgresql://postgres:postgres@127.0.0.1:5434/cdas_next_e2e` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk 浏览器端公开密钥 | 空 |
| `CLERK_SECRET_KEY` | Clerk 服务端密钥 | 空 |
| `DEV_TEST_TEACHER_CLERK_ID` | 浏览器门禁的既有 Clerk development 教师用户 ID | 空 |
| `DEV_TEST_STUDENT_CLERK_ID` | 浏览器门禁的既有 Clerk development 学生用户 ID | 空 |
| `AI_PROVIDER_DISABLED` | 关闭模型调用并验证业务降级 | `1` |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 API 的服务端密钥；关闭模型时不需要 | 空 |
| `AI_MODEL` | DeepSeek 模型 ID | `deepseek-v4-flash` |
| `AI_TOOL_APPROVAL_SECRET` | AI SDK 工具审批签名密钥，至少 32 字节 | 空 |
| `E2E_REAL_MODEL_ACK` | 单次真实模型合成数据 smoke 的显式成本确认 | 空 |
| `ATTACHMENT_STORAGE_ENABLED` | 设为 `1` 才启用附件上传与下载 | 空 |
| `BLOB_STORE_ID` | Vercel Private Blob store 连接产生的项目变量 | 空 |
| `BLOB_WEBHOOK_PUBLIC_KEY` | 验证 Private Blob 上传完成协议的项目公钥 | 空 |

密钥不得进入浏览器业务代码、migration、fixture 或 Git 历史。

附件默认关闭。启用后，学生先保存文字草稿，再从活动页直接上传最多 5 个 JPEG/PNG/WebP、PDF、DOC/DOCX 文件；单文件最大 20 MiB。上传使用 Vercel 自动轮换的短期 OIDC，不配置长期 `BLOB_READ_WRITE_TOKEN`。对象元数据和文件头格式一致后附件才能随正式提交固化；这不是恶意文件扫描，下载始终经过业务授权并强制作为附件响应。Blob 达到 Hobby 免费配额或暂不可用时，移除未完成附件即可继续纯文字提交，不升级套餐或产生超额费用。

## 连接真实 Clerk 账号

先在 Clerk 中创建一个教师账号和一个学生账号，并复制二者已有的 `user_...` ID。下面的初始化命令只在应用数据库中幂等建立用户映射、班级和当前学生成员关系；它不会创建 Clerk 账号或密码，也不会静默改写既有角色、显示名称、班级名称或班级管理员。

```bash
# 查看参数不需要 DATABASE_URL，也不会连接数据库
pnpm bootstrap:clerk -- --help

# --confirm-database 必须与 DATABASE_URL 指向的数据库名称完全一致
pnpm --silent bootstrap:clerk -- \
  --teacher-subject user_teacherFromClerk \
  --teacher-name "林老师" \
  --student-subject user_studentFromClerk \
  --student-name "陈同学" \
  --classroom-id 10000000-0000-4000-8000-000000000001 \
  --classroom-name "七年一班" \
  --confirm-database cdas_next
```

运行映射时保留示例中的 `--silent`，避免 pnpm 自己在执行前回显带 Clerk user ID 的完整命令行。该命令运行在 Next.js 进程之外，因此显式复用官方 `@next/env` 加载项目根目录的 `.env*`，顺序与 Next.js 一致；已经由 shell 注入的环境变量仍具有最高优先级。初始化程序只使用 `DATABASE_URL` 作为写入目标，并拒绝与 `TEST_DATABASE_URL` 相同的目标。成功输出只包含不带用户名、密码和查询参数的数据库目标，以及应用内部资源 ID 和 `CREATED` / `EXISTING` 状态；不会回显 Clerk user ID、连接字符串、密码或请求指纹。若任何既有映射冲突，整个事务失败且不修改数据。

## 可选活动助手

助手默认关闭。只有 `AI_PROVIDER_DISABLED=0` 且 DeepSeek API 密钥、模型 ID 和审批签名密钥全部有效时，“新建学习活动”页才会渲染助手；服务端 Route Handler 仍会再次认证教师、验证消息与配置。审批密钥可用 `openssl rand -base64 32` 生成，不得使用示例值进入生产。

助手使用 AI SDK 官方 `useChat`、`streamText` 与签名 `toolApproval`，没有自建聊天协议或审批状态机。草稿工具调用现有 `saveActivityDraft`；发布工具在 AI SDK 交互暂停之外，仍必须建立并消费绑定精确草稿版本、班级和截止时间的 ActionIntent。任何模型调用都不在数据库事务中，关闭或中断模型不会影响手工闭环。

## 项目地图

- [PRODUCT.md](./PRODUCT.md)：产品范围和完成标准
- [ROADMAP.md](./ROADMAP.md)：外部需求形成的长期功能方向、依赖顺序和进入条件
- [DOMAIN.md](./DOMAIN.md)：实体、状态与不变量
- [ACCEPTANCE.md](./ACCEPTANCE.md)：权限矩阵和端到端反例
- [AGENT.md](./AGENT.md)：嵌入式助手的工具与风险边界
- [DECISIONS.md](./DECISIONS.md)：已接受的架构决策
- [ARCHITECTURE.md](./ARCHITECTURE.md)：代码分层和运行时边界
- `prisma/schema.prisma`：类型化数据库模型
- `prisma/migrations/`：可重放 SQL migration 与数据库约束
- `src/domain/`：不依赖框架的业务合同
- `src/server/commands/`：UI 与 Agent 共用的服务端业务命令

## 当前边界

受保护 Preview、Clerk development、隔离 Neon、教师名单码成员管理、附件和合成教学闭环已经建立；当前附件能力仍只面向开发期合成数据，真实学生文件进入前还要完成保留、删除和恶意文件处理决策。schema v2 任务书、顺序阶段执行与快照检查点、按 Release 配置的作业小组、设计助手结构化提案确认、结构化形成性反馈字段，以及证据绑定量规评价、列表评价状态、发布页反馈/评价覆盖计数与待重交跟进标记，均已完成开发期远程验收。RAG、产品运行时多 Agent、自动评分、互评、自评、旧 `/api/v2` 兼容和旧数据库迁移仍不在本阶段范围。班级/项目长期小组、跨作业固定分组和实时协同也不在当前合同内；通用流程引擎、条件分支、任意依赖图、回溯，以及教师批准才解锁阶段同样未交付。原版 CTS/CDAS 的功能与中文描述是产品能力下限；新版复用其场景、目录、样例和设计思想，但不复制旧认证、API、数据库或页面实现。
