# N1 基础复制实施卡

日期：2026-09-24；决策：D-063；分支：codex/n1-activity-reuse。

目标：从本人 v3 未封存草稿或合法发布冻结快照创建独立可编辑副本，并保留不可变来源关系。

受保护不变量：当前账号/学校/资源授权；源版本绑定；发布与修订历史不可改；原子草稿、首修订、来源、审计、幂等结果；数据库事务无外部调用。封存草稿不绕过发布管理权。

文件范围：新 copy 领域命令、共享来源解析、只读查询、第一方 copy 页面与 action、活动列表/详情入口、Prisma 来源表与追加迁移、聚焦数据库测试及相关合同文档。禁止扩大全局 Agent 工具、修改旧迁移或改写历史数据。

非目标：AI 适配、旧版转换、跨教师分享、模板市场、批量发布；这些不被本基础片完成状态替代。

验收：ACCEPTANCE.md 的 D-063 三组场景，包含正向副本独立性、旧快照 hash、越权、停用、旧 schema、陈旧源、同 key 并发/换参数、来源不可变和失败原子性。UI 走查选择→预览→确认→编辑。

验证：pnpm check；pnpm db:validate；独立 TEST_DATABASE_URL 上 db:test:deploy、db:test、test:db、db:test:diff；pnpm audit:prod。一次独立审查，只有阻断或授权/历史风险修复后追加验证。

交付证据：记录实际命令、结果、提交及推送；不把本地成功写成远端验收，不启动生产部署。升级条件：来源/授权合同矛盾、阻断验收失败或无法安全操作测试库。

## 交付证据（2026-09-26，本地）

分支 `feature/n1-activity-reuse`（基于 `design/shadcn-redesign`），功能提交 `f5a74b5`。承接 `codex/n1-activity-reuse` 上未提交的实现；补齐复制页新 UI、修正集成测试夹具（教师工号与学校角色约束）及封存草稿用例的幂等 key。

- `pnpm check`：通过（lint、typecheck、885 单测、两套浏览器脚本合同、build）。
- `pnpm db:validate`：通过。
- 独立库 `TEST_DATABASE_URL=…/cdas_next_n1_test`：`db:test:deploy` 全部迁移成功；`db:test` 通过；`db:test:diff` 无差异；`test:db` 24 文件 130 用例通过，含 D-063 全部 10 个场景。
- `pnpm audit:prod`：未通过，9 项与 `main` 相同（next <16.3.3、sharp、prisma 传递依赖 mysql2 / fast-uri），本片未新增；另行升级处理。
- UI 走查（本地开发库，演示教师）：选择发布快照「校园节水行动」→ 核对完整任务书 → 改标题「校园节水行动（八年级版）」确认 → 进入副本编辑页并显示来源。库内核对：副本 EDITING v1、MANUAL 首修订、唯一来源指向该快照、无发布关联；成功审计与幂等记录各 1 条。过期版本链接显示版本冲突提示且不新建草稿。
- 代码审查（2026-09-26）：对 `design/shadcn-redesign...feature/n1-activity-reuse` 全部改动做一次高强度审查，未发现需修复的缺陷。审查者同时参与了本片修复，不算完全独立；如需严格独立，可另行审查。
- 推送：尚未推送；未做远端验收，未启动任何部署。
