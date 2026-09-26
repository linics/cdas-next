# N1 AI 适配实施卡

日期：2026-09-27；决策：D-066；分支：feature/n1-ai-adaptation。

目标：在本人未封存 v3 草稿上，按教师给定的年级、课时、情境和允许区域生成改写建议，逐处核对后写成新的 AGENT 修订。

受保护不变量：当前账号、学校与所有权授权；只有所选区域可变，结构与对应关系不变；草稿与修订历史只追加；AGENT 修订必须在 AgentRun 为 RUNNING 时插入并在同一事务内转为 SUCCEEDED（既有数据库约束）；模型调用不在事务内；只存 hash，不存模型原文。

文件范围：
- 领域：`src/domain/activity/activity-adaptation.ts`（请求校验、输出 schema、合并、差异）。
- 服务：`src/server/assistant/activity-adaptation-suggestion.ts`；`src/server/activity/activity-adaptation-binding.ts`。
- 命令：`record-activity-adaptation-suggestion.ts`、`apply-activity-adaptation.ts`。
- 页面：`src/app/teacher/activities/[draftId]/adaptation-*.ts(x)` 与草稿页接入。
- 模型档位：`deepSeekRewriteProviderOptions`。
- 无迁移。

验证：
- `pnpm check`；
- 独立测试库上的 `db:test:deploy`、`db:test`、`test:db`、`db:test:diff`；
- 真实模型用例 `activity-adaptation.real-model.test.ts`：3 种场景重复多轮；
- 浏览器走查：生成、核对、确认、放弃。

## 交付证据（2026-09-27，本地）

- `pnpm check`：通过，包括 lint、typecheck、111 个文件 904 个单测、浏览器脚本合同和构建。
- 独立测试库 `cdas_next_n1b_test`：
  - `db:test:deploy`：26 个迁移全部成功；
  - `db:test`：通过；
  - `test:db`：25 个文件 137 个用例通过，包括新增 5 个适配场景；
  - `db:test:diff`：无差异。
- 真实模型（deepseek-v4-flash），3 种场景：新年级与情境，重新分配课时，目标与评价随年级调整。
  - 高档推理：9 次调用中 8 次成功，1 次超过 120 秒。
  - 改为低档后：12 次全部成功，均可合并且未越界。
  - 抽查改写内容，年级、情境、课时要求都已落实。
- 浏览器走查（本地开发库，演示教师）：
  - 复制「饮水区用水记录」，得到副本。
  - 按 8 年级、6 课时、社区饮水点情境生成建议，页面列出 23 处改写。确认后得到第 2 版 AGENT 修订，AgentRun 为 SUCCEEDED，页面提示成功，状态为可预览。
  - 空请求直接被拒，不调用 AI。
  - 只改背景的建议点击放弃后，AgentRun 为 CANCELLED，草稿停在第 2 版。
  - 走查中发现并修复：面板与表单使用了同一个 key，导致写入后页面不刷新。
- 未推送，未部署。
