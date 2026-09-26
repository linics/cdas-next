# N4b 版本诊断实施卡

日期：2026-09-27；决策：D-068；分支：feature/n4b-version-diagnosis。

目标：教师主动检查已保存的 v3 版本，得到可定位、可直接采用的质量建议。建议绑定该版本留存，改版后成为历史结果。

文件范围：
- 领域：`src/domain/activity/draft-diagnosis.ts`（字段清单、输出 schema、定位校验）。
- 服务：`src/server/assistant/activity-draft-diagnosis.ts`；命令：`record-activity-draft-diagnosis.ts`；查询：`activity-draft-diagnoses.ts`。
- 迁移：`20260927120000_activity_draft_diagnoses`（只追加，含所有权与 AgentRun 守卫）。
- 页面：草稿页「版本检查」卡片。

## 交付证据（2026-09-27，本地）

- 单测：新增字段清单、定位与提示词合同测试。
- 独立测试库：迁移成功，`db:test:diff` 无差异，新增 3 组诊断场景全部通过。
- 真实模型（deepseek-v4-flash，高档推理），分两轮，每轮 3 次，每次分别检查原任务书和预埋缺陷的任务书：
  - 12 次调用全部成功，建议均可定位，每次都找到预埋的证据与量规缺陷。
  - 第二轮改为按编号传目标后，输出里不再出现内部目标 ID。
- 浏览器走查（本地开发库）：
  - 在 AI 适配后的副本上点击「检查第 2 版」，得到 6 条建议。其中一条指出「连续一周记录」与 1 周、6 课时的安排冲突，正是适配留下的真实问题。
  - 再次检查后，页面自动刷新显示新结果。
- 走查中修复：
  - 同路径加锚点的 redirect 不会刷新页面，诊断与撤回依据两处都已改为先 `revalidatePath` 再跳转。
  - 同一版本的旧检查原来被误标为「旧版本」，已区分。
