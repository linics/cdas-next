# 学校级组织与管理员端 MVP（学校 + 教师）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有教学历史的前提下，交付学校、教师与唯一平台管理员的学校级组织 MVP。

**Architecture:** 通过 `School`、扩展的 `AppUser` 和 `Classroom.schoolId` 形成边界；当前 actor 集中检查账号和学校状态；页面只调用领域命令/查询。Clerk 是外部认证提供方，教师 provisioning 在 PostgreSQL 与 Clerk 之间使用持久状态补偿，而非伪事务。

**Tech Stack:** Next.js 16、React 19、TypeScript、Prisma/PostgreSQL、Clerk、Zod、Vitest。

**Spec:** `docs/superpowers/specs/2026-08-30-school-identity-design.md`

## Global Constraints

- 不修改 `main`、不推送、不部署；只在 `feature/school-admin-mvp` 工作树工作。
- 不把密码、邀请码明文、Clerk 密钥、数据库连接或演示数据放入 Git、日志、审计或前端持久化存储。
- 不给 Activity、Release、Submission、Feedback、Evaluation 或快照表新增 `schoolId`。
- 外部 Clerk 调用绝不置于数据库事务中；所有新写入遵循现有幂等与追加审计模式。
- 管理员不能读取教学内容；AI Agent 只保留在教师工作区。
- 本期不实现学生自注册、学生目录、Excel 导入、学生密码重置。

---

### Task 1: 学校迁移与数据库边界

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260830150000_school_organization_admin/migration.sql`
- Create: `prisma/migrations/20260830151000_school_organization_models/migration.sql`
- Modify: `prisma/tests/invariants.sql`
- Test: `src/server/school/school-boundary.integration.test.ts`

**Interfaces:**
- Produces `School`、`TeacherProvisioning`、扩展 `AppUser`、`Classroom.schoolId` 和数据库触发器。

- [ ] 写出会在缺少学校边界时失败的数据库测试：跨学校班级负责人、跨学校成员、同校重复工号。
- [ ] 运行 `pnpm test:db` 或针对数据库测试的 Vitest 命令，确认失败原因是约束尚不存在。
- [ ] 写最小 schema 与两阶段兼容迁移：先加 ADMIN 枚举，后建 School / provisioning / 约束 / legacy 回填。
- [ ] 运行 `pnpm db:validate && pnpm db:test:deploy && pnpm db:test && pnpm test:db`，确认迁移、约束和原始不可变历史守卫均通过。

### Task 2: 身份规范化、当前 actor 与管理员 bootstrap

**Files:**
- Create: `src/domain/school/identity.ts`
- Test: `src/domain/school/identity.test.ts`
- Modify: `src/server/auth/current-actor.ts`
- Modify: `src/server/auth/clickthrough-auth.ts`
- Create: `src/server/bootstrap/bootstrap-admin.ts`
- Create: `src/server/bootstrap/bootstrap-admin-cli.ts`
- Test: `src/server/bootstrap/bootstrap-admin.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `normalizeSchoolCode`, `normalizeStaffNo`, `hashTeacherInvite`, `generateTeacherInvite`, `deriveTeacherUsername`, `getCurrentActor` 状态错误，以及 `pnpm admin:bootstrap`。

- [ ] 写失败测试：学校代码/工号规范化、邀请码哈希不泄露明文、停用账号或学校的 actor 被拒绝、第二个管理员被拒绝。
- [ ] 运行对应 Vitest 文件，确认缺少模块或旧行为导致失败。
- [ ] 实现纯领域 identity 函数和集中 actor 状态检查；保持 Proxy 无数据库访问。
- [ ] 实现仅绑定已有 Clerk subject 的管理员 bootstrap，拒绝覆盖教师/学生。
- [ ] 运行对应 Vitest、`pnpm typecheck` 与 `pnpm db:validate`。

### Task 3: 管理员学校与教师领域命令/查询

**Files:**
- Create: `src/server/school/admin-authorization.ts`
- Create: `src/server/commands/admin-school-commands.ts`
- Create: `src/server/commands/admin-teacher-commands.ts`
- Create: `src/server/queries/admin-dashboard.ts`
- Create: `src/server/queries/admin-schools.ts`
- Create: `src/server/queries/admin-teachers.ts`
- Test: `src/server/commands/admin-school-commands.integration.test.ts`
- Test: `src/server/commands/admin-teacher-commands.integration.test.ts`

**Interfaces:**
- Consumes Task 1 database models and Task 2 actor identity.
- Produces admin-only create/status/invite/reset commands and content-free aggregate queries.

- [ ] 写失败测试：非管理员不能管理学校/教师，管理员查询不读取活动，邀请码重置旧码失效。
- [ ] 运行测试，确认在命令未实现时失败。
- [ ] 实现可重放命令、追加审计和一次性结果；对 Clerk 密码重置使用事务外网关。
- [ ] 运行单元/集成测试和 `pnpm typecheck`。

### Task 4: 教师注册、登录标识、资料与班级创建

**Files:**
- Create: `src/server/identity/clerk-gateway.ts`
- Create: `src/server/commands/register-teacher.ts`
- Create: `src/server/commands/update-teacher-profile.ts`
- Create: `src/server/commands/create-classroom.ts`
- Create: `src/server/queries/teacher-profile.ts`
- Create: `src/server/queries/teacher-classrooms.ts`
- Test: `src/server/commands/register-teacher.integration.test.ts`
- Test: `src/server/commands/create-classroom.integration.test.ts`

**Interfaces:**
- Consumes Task 1 `TeacherProvisioning` and Task 2 identity utilities.
- Produces invitation verification, recoverable Clerk provisioning, profile update and same-school class creation.

- [ ] 写失败测试：错误邀请码不泄露学校、并发重试只产生一个 provisioning、Clerk 成功后数据库重试可完成、教师只能创建本校班级。
- [ ] 运行测试，确认缺少生产实现导致失败。
- [ ] 实现数据库阶段、Clerk 外部调用、最终绑定的补偿序列；密码不进入 request hash 或审计。
- [ ] 实现仅允许姓名和学科变更的教师资料命令，并接入 class-create 命令。
- [ ] 运行对应测试和 `pnpm typecheck`。

### Task 5: 管理员与教师界面

**Files:**
- Modify: `src/app/_components/workspace-shell.tsx`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/schools/page.tsx`
- Create: `src/app/admin/teachers/page.tsx`
- Create: `src/app/admin/_components/*`
- Create: `src/app/teacher/register/page.tsx`
- Create: `src/app/teacher/login/page.tsx`
- Create: `src/app/teacher/profile/page.tsx`
- Modify: `src/app/teacher/page.tsx`
- Create or modify: `src/app/teacher/classrooms/*`
- Test: route/component tests beside the new pages

**Interfaces:**
- Consumes Task 3 admin commands/queries and Task 4 teacher commands/queries only; no Prisma import in page or action files.

- [ ] 写失败组件测试：管理员路由对教师拒绝、教师注册仅在邀请码验证后显示学校名、管理员界面没有活动/作品入口。
- [ ] 运行测试，确认旧页面没有对应行为。
- [ ] 使用现有 Classical token、`WorkspaceShell` 和确认对话框实现管理员/教师页面；Agent 仅在教师 layout 出现。
- [ ] 运行页面测试、`pnpm lint` 与 `pnpm typecheck`。

### Task 6: 既有流程的学校范围收紧与文档

**Files:**
- Modify: existing classroom roster commands/queries and bootstrap/demo fixtures as typecheck identifies required `schoolId` propagation
- Modify: `PRODUCT.md`, `DOMAIN.md`, `ARCHITECTURE.md`, `ACCEPTANCE.md`, `DECISIONS.md`, `ROADMAP.md`, `README.md`, `AGENT.md`
- Test: focused legacy classroom, activity, submission, feedback and evaluation test files

**Interfaces:**
- Retains all public v1/v2/v3 activity and submission contracts while ensuring new lookups are school-scoped.

- [ ] 写或更新失败测试：A 校教师不能查询/加入 B 校成员；停用学校/教师后业务入口拒绝但历史仍可读取。
- [ ] 运行聚焦测试，确认在范围检查缺失时失败。
- [ ] 在所有受影响的创建与查询路径显式携带 actor 的 `schoolId`，不重复写入教学历史表。
- [ ] 在文档中记录管理员无教学内容权限、legacy rosterKey 兼容及本期非目标。
- [ ] 运行聚焦测试、`pnpm lint` 和 `pnpm typecheck`。

### Task 7: 回归验证与审查

**Files:**
- Modify only if verification发现 P0/P1 问题；否则不增加无关代码。

- [ ] 检查 `git diff --check`、`git status --short` 和是否误入 `.env*`、数据库转储或附件。
- [ ] 运行 `pnpm db:validate && pnpm db:test:deploy && pnpm db:test && pnpm test:db && pnpm db:test:diff && pnpm audit:prod`。
- [ ] 运行 `pnpm knowledge:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`。
- [ ] 审查资源级授权、追加式历史、幂等、外部 Clerk 调用边界和管理员无教学权限；将真实 Clerk Development E2E 列为配置完成后执行的人工验证。
