# CDAS Next

面向 K12 教师与学生的跨学科学习活动工作台。第一阶段完成一条可追溯闭环：教师设计并确认发布，学生提交文字或附件证据，教师确认形成性反馈与量规评价，学生查看结果，最后由发布教师确认关闭。

CDAS Next 是单一 Next.js 模块化应用。认证、教学数据和不可变业务历史保存在 PostgreSQL；UI actions 与 Agent tools 共用服务端领域命令和资源级授权。AI 默认关闭，模型不可用时完整手工闭环仍可运行。

## 快速开始

需要 Node.js 24、pnpm 11 和 Docker Desktop。

```bash
pnpm install
docker compose up -d database
cp .env.example .env
pnpm db:deploy
pnpm bootstrap:admin -- --help
pnpm bootstrap:admin \
  --admin-username operator \
  --admin-name "平台管理员" \
  --confirm-database cdas_next
pnpm dev
```

`bootstrap:admin` 会在 TTY 中两次读取不回显的密码，绝不接受命令行密码。密码为 10–128 个字符，至少包含一个字母和一个数字。命令只允许建立全平台唯一 ADMIN，写入前要求确认数据库名，并拒绝测试数据库目标。

打开 [http://localhost:3000](http://localhost:3000)，使用 `/login/admin` 登录并建立学校及教师账号。教师与学生使用学校代码加工号/学号登录；首次登录可能被要求改密。认证只识别调用者，教学操作仍在服务端检查学校状态、账号状态、资源所有权和班级成员关系。

国内小机器自托管见 [SELF-HOST.md](./SELF-HOST.md)，受保护 Preview 与合成门禁见 [STAGING.md](./STAGING.md)。

## 验证

```bash
# 官方语料、lint、类型、单测、浏览器脚本合同和生产构建
pnpm check

# 独立 PostgreSQL 上的迁移、SQL 不变量、schema drift 和命令集成测试
docker compose up -d test-database
pnpm db:test:deploy
pnpm db:test
pnpm db:test:diff
pnpm test:db

# 生产依赖漏洞审计
pnpm audit:prod
```

数据库测试只接受可丢弃的 `TEST_DATABASE_URL`，并拒绝与 `DATABASE_URL` 或 `DIRECT_URL` 指向同一目标。可以把它写入项目根目录 `.env`，也可以逐条内联：

```bash
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/cdas_next_test' \
  pnpm db:test
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/cdas_next_test' \
  pnpm db:test:diff
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/cdas_next_test' \
  pnpm test:db
```

缺少或不安全的测试库 URL 会明确失败，不会以跳过测试伪装成绿色结果。

### 本地真实浏览器闭环

浏览器门禁使用 Python Playwright 与独立的 tmpfs PostgreSQL。先建立项目虚拟环境：

```bash
python3 -m venv .venv-e2e
source .venv-e2e/bin/activate
python3 -m pip install -r scripts/e2e/requirements.txt
python3 -m playwright install chromium
pnpm e2e:closed-loop
```

runner 每轮生成教师、学生密码，经本地登录表单建立 `cdas_session`，并检查 cookie、两版草稿、发布、提交、反馈、关闭、历史只读、越权拒绝、陈旧确认和幂等重放。它只会重建 Compose 的 `e2e-database`，并拒绝非回环地址、非 3100 端口、生产目标或与开发/测试库重合的数据库。

证据写入忽略目录 `output/e2e/<run-marker>/`；密码、cookie 和 session token 不进入日志、截图或 artifact。

### 可选真实模型 smoke

真实模型 smoke 复用本地教师会话与专用 E2E 数据库，只允许固定合成数据，默认失败关闭：

```bash
AI_PROVIDER_DISABLED=0 \
E2E_REAL_MODEL_ACK=synthetic-data-cost-approved \
pnpm e2e:real-model
```

还必须通过受保护环境提供 `DEEPSEEK_API_KEY`、有效 `AI_MODEL` 和至少 32 字节的 `AI_TOOL_APPROVAL_SECRET`。该 smoke 只证明 provider transport 与草稿 provenance，不授权生产、真实学生数据或扩大模型费用。

## 技术基线

- Next.js 16 App Router、React 19、严格 TypeScript
- PostgreSQL 17、Prisma 7、可审查且 forward-only 的 SQL migration
- PostgreSQL 本地认证：Argon2id 密码、哈希 session token、HttpOnly cookie
- Vercel AI SDK 结构化工具 UI；服务端 ActionIntent 才是可信确认
- Vitest、真实 PostgreSQL 约束测试和 Playwright 闭环
- Vercel Private Blob 或自托管持久磁盘附件；未配置时纯文字流程保持可用

生产构建显式使用 Next.js 官方 `--webpack` 选项。升级 Next.js 或 AI SDK 后应重新验证默认 bundler。

## 配置

| 变量 | 用途 | 本地默认 |
| --- | --- | --- |
| `DATABASE_URL` | 应用运行时 PostgreSQL；托管环境使用 pooled URL | `postgresql://postgres:postgres@127.0.0.1:5432/cdas_next` |
| `DIRECT_URL` | migration 直连 URL；未设置时使用 `DATABASE_URL` | 空 |
| `TEST_DATABASE_URL` | SQL 不变量和集成测试专用可丢弃数据库 | `postgresql://postgres:postgres@127.0.0.1:5433/cdas_next_test` |
| `E2E_DATABASE_URL` | 本地浏览器门禁专用可丢弃数据库 | `postgresql://postgres:postgres@127.0.0.1:5434/cdas_next_e2e` |
| `AI_PROVIDER_DISABLED` | 关闭模型调用并验证手工降级 | `1` |
| `DEEPSEEK_API_KEY` | DeepSeek 服务端密钥；关闭模型时不需要 | 空 |
| `AI_MODEL` | DeepSeek 模型 ID | `deepseek-v4-flash` |
| `AI_TOOL_APPROVAL_SECRET` | 工具审批签名密钥，至少 32 字节 | 空 |
| `ATTACHMENT_STORAGE_ENABLED` | 设为 `1` 才启用附件 | 空 |
| `ATTACHMENT_STORAGE_DIR` | 自托管持久附件目录 | 空 |
| `BLOB_STORE_ID` | Vercel Private Blob store | 空 |
| `BLOB_WEBHOOK_PUBLIC_KEY` | Private Blob 上传完成协议公钥 | 空 |

本地账号密码不属于环境配置。合成 staging 的六组密码只能放在受保护 GitHub Environment secrets，不能进入 `.env*`、命令行、日志、截图、artifact 或 Git 历史。

## 可选活动助手

只有 `AI_PROVIDER_DISABLED=0` 且模型密钥、模型 ID 和审批签名密钥全部有效时，教师活动页才显示助手。助手使用只读官方课程语料工具和既有草稿/发布领域命令；模型调用、附件读取和对象存储调用都不放进数据库事务。教师仍须确认草稿提案和发布参数，AI 不是资源所有者、发布者或最终评价者。

## 项目地图

- [PRODUCT.md](./PRODUCT.md)：产品范围与完成标准
- [DOMAIN.md](./DOMAIN.md)：实体、状态与不变量
- [ACCEPTANCE.md](./ACCEPTANCE.md)：权限矩阵与端到端反例
- [AGENT.md](./AGENT.md)：嵌入式助手工具与风险边界
- [DECISIONS.md](./DECISIONS.md)：已接受的架构决策
- [ROADMAP.md](./ROADMAP.md)：后续切片与长期候选能力
- [ARCHITECTURE.md](./ARCHITECTURE.md)：代码分层和运行时边界
- [STAGING.md](./STAGING.md)：远端合成 staging 门禁
- [SELF-HOST.md](./SELF-HOST.md)：单机自托管 runbook

当前主线包含学校边界、本地认证、schema v2 任务书、阶段与小组执行、附件、官方课标检索、结构化反馈、量规评价和受约束教师助手。SSO/MFA、真实学生数据生产授权、开放式 RAG、产品运行时多 Agent、自动评分、跨校管理和旧数据库迁移仍不在第一阶段范围。
