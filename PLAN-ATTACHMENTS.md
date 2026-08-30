# 附件：能传、能看、AI 能读

状态：**D-055 已接受并实施。** Phase 1 图片/PDF 预览、Phase 2 自托管持久磁盘与 Phase 3 第一方评阅附件受限读取已通过本地门禁；隔离真实视觉探针、完整真实模型闭环重复运行与附件提示注入套件均已通过，固定合成远程验收仍待跑通。PDF 自动解析/OCR、旧 `.doc` 解析、恶意文件扫描和全局 Agent 附件工具仍不立项。

日期：2026-08-29。关联：`PLAN-AI-GAPS.md`、`DECISIONS.md`（D-044 ~ D-054）、`SELF-HOST.md`、
`AGENT.md`（工具边界）、`design-system/cdas-next/CLASSICAL.md`。

本文写给一个没有这次会话上下文的人：读完应当能独立判断该做什么、为什么、以及先做哪一步。

---

## 一、现状盘点

地基比预期完整。**已经有的**：

| 已有 | 位置 |
| --- | --- |
| 数据模型（附件 + 工作副本/修订版两张关联表） | `prisma/schema.prisma:324` 起 |
| 上传预约校验（文件名、扩展名、媒体类型、体积） | `src/domain/submission/attachment-policy.ts` |
| 魔数签名校验（六种格式逐一比对文件头） | `src/server/attachments/vercel-blob-attachment-storage.ts:26` |
| 访问控制（学生限本人受众、教师限自己发布且自己管理的班级、仅 `READY`） | `src/server/attachments/submission-attachment-access.ts:74` |
| 上传编排（预约 → 直传 → 落定 → 复扫） | `src/server/attachments/submission-attachment-service.ts` |
| 上限：单文件 20MB、每份提交 5 个 | `attachment-policy.ts:3` |
| **评价引用已支持附件** `kind: "attachment"` + `attachmentId` | `src/domain/evaluation/teacher-evaluation-intent.ts:49` |

最后一条很关键：溯源管道**已经建好了**，评价的引用类型里本来就有附件一档，
`TeacherEvaluationEvidence` 也已经带 `attachmentIds` 字段。缺的只是让 AI 看见 ID 背后的内容。

**缺的三件事**：

### 缺口 1：根本看不了，只能下载

`src/app/attachments/[attachmentId]/download/route.ts:30` 写死
`Content-Disposition: attachment`。学生端（`attachment-editor.tsx:207`）与教师端
（`teacher/submissions/[submissionId]/page.tsx:266`）也都只渲染一个「下载」链接。
学生交的照片、教师要评的 PDF，全都得先下载到本地才能看。评阅工作台左列号称"只读当前正式
修订证据"，但证据是附件时，教师必须离开工作台。

### 缺口 2：AI 完全看不见附件

助手有 11 个工具（`activity-assistant-tools.ts:642` 起），**没有一个碰附件**。
更明确的证据在 `src/server/assistant/teacher-evaluation-suggestion.ts:358`：

```ts
attachmentIds: [],
```

写死空数组。也就是说 AI 起草评价时被告知"这份提交没有附件"，因此它**永远不可能**引用附件；
即便它凭空编一个附件引用，校验也会拒绝。这一行就是接入点。

### 缺口 3：存储只有 Vercel Blob，VPS 上整条链路是断的

`vercel-blob-attachment-storage.ts:129` 的工厂要求 `ATTACHMENT_STORAGE_ENABLED=1` 且
`BLOB_STORE_ID` 非空，否则返回 `null`，两个路由直接回 503。上传更是客户端直传：
`attachment-editor.tsx:4` 从 `@vercel/blob/client` 引 `uploadPresigned`。

**演示要在 `http://122.51.77.121` 上做，那台机器没有 Blob。** `SELF-HOST.md` 现在写的是
"2G 内存下关掉附件"。这与"附件要能用"直接冲突，是本轮最大的一块工程量。

---

## 二、别人是怎么做的

### 2.1 教学平台的预览形态（Canvas / Google Classroom）

Canvas 把文档预览做成三档显示选项，而不是一个开关：**行内预览**（点链接后就地展开）、
**行内自动展开**（进页面即展开）、**浮层预览**（默认档，点开在覆盖层里看）。
三档都**始终保留下载入口**，预览是叠加而非替代。评阅场景另有 DocViewer，
教师的批注直接叠在文档上，学生在提交详情页看批注而不下载原件。

对我们的启示有三条：

1. **预览是叠加，不是替代。** 下载入口必须留着——附件可能是学生用手机拍的、
   教师要转发给同事的、或者浏览器就是渲染不了的。
2. **默认用浮层。** Canvas 的默认档是浮层而不是行内自动展开，因为证据列里塞进一个
   全尺寸文档会把工作台的信息密度冲垮。我们的评阅工作台明确要求"证据短时不把整页拉成一条长带"
   （CLASSICAL.md），所以行内自动展开是被现有合同禁止的，浮层是唯一符合的形态。
3. **评阅场景的重点是"文档旁边能写"**，不是"文档能看"。DocViewer 存在的理由是批注，
   不是渲染。我们的两栏工作台（左证据右撰写）已经是这个结构，缺的只是左列能显示图和 PDF。

### 2.2 浏览器里渲染文档

- **PDF → PDF.js。** Mozilla 的 PDF.js 用 HTML5 Canvas 渲染，最新稳定版 2026 年 4 月。
  纯客户端，可自托管，不需要服务端 CPU——这对 2C/2G 的 VPS 是决定性的。
  另一条路是直接 `<iframe>` 交给浏览器内置查看器，零依赖但各浏览器行为不一致。
- **docx → 两条路，取舍不同。**
  - `mammoth.js`：转成语义化 HTML 或纯文本，**支持 Node 端**，可服务端预转换。
    保留语义结构，但复杂排版会丢失。
  - `docx-preview.js`：纯客户端渲染，视觉保真度明显更好，社区普遍认为观感优于 mammoth。

  这两者的分工正好对应我们的两个需求：**给人看用 docx-preview，给 AI 读用 mammoth**
  （mammoth 的强项就是"抽取文本供程序处理"）。不必二选一。

### 2.3 DeepSeek 的视觉能力（本轮最关键的外部变量）

**DeepSeek 在 2026-08-21 才上线多模态 API**，也就是 8 天前：

- 模型 ID `deepseek-v4-flash-vision-exp`，**实验状态**，但可用于生产 API。
- 支持混合文本 + 图片输入；图片可用 base64、外部 URL，或免费的 Files API 上传复用。
- 支持 JPEG、PNG、GIF、WebP。**不含 PDF。**
- 计费按图片 token 化，**每张最多 384 token**，按 V4-Flash 价格。
- 保持了标准 V4 Flash 的文本能力；在 DeepSeek 自己的 agent 基准上接近 Opus 4.8。

三条直接后果：

1. 我们当前的 `AI_MODEL=deepseek-v4-flash` 是**纯文本**的，今天不可能看图。
2. 图片格式与我们的策略几乎对齐（我们允许 jpeg/png/webp，都在支持列表内），**不需要改上传策略**。
3. **PDF 不被视觉 API 接受**，必须先在服务端抽文本；扫描件（图片型 PDF）要先渲染成图再走视觉，
   这条明确排除在第一期外。

每张 384 token 的上限听起来像是个很小的预算，会把一张密集的记录表压扁。

**2026-08-29 实测：它没有。** `pnpm probe:vision` 拿一张学生风格的校园用水调查表
（四列表格 + 柱状图 + 角落一行小号红字）分别问 DeepSeek 与 GLM 三个只能靠看才能答的问题。
两家都把三个地点的差值、柱状图的高低排序、以及那行红字的原话全部读对：

| | DeepSeek vision-exp | GLM-5.3-Flash |
| --- | --- | --- |
| 事实准确 | 全对 | 全对 |
| 单图 prompt token | **519** | 838 |
| 延迟（多次） | 0.2 – 4.4 s | 3.0 – 3.9 s |

所以 384 token 的上限对这类作业附件不构成实际限制，**DeepSeek 每张图还便宜约 40%**。
第一次调用 GLM 曾出现 69 秒的冷启动，复测后稳定在 3 秒级，不是常态。

结论：附件的视觉这条路**用 DeepSeek 就够，不需要为它换模型**。

---

## 三、规划

分三期。每一期都能独立交付、独立验收，前一期不完成不进下一期。

### 第一期：能看（已完成）

**目标**：图片和 PDF 在教师评阅工作台与学生提交页可以就地看到，不必下载。

1. **下载路由支持 `inline`。** 给 `download/route.ts` 加一个显式的 disposition 判定，
   **按媒体类型白名单**决定：`image/jpeg` `image/png` `image/webp` `application/pdf` 允许 inline，
   `doc` / `docx` 一律 `attachment`。不要做成 query 参数由调用方决定——那等于把决定权交给
   任何能构造 URL 的人。

2. **安全：inline 是有代价的，必须一起做。** 从本应用同源 inline 返回用户上传的内容，
   等于允许上传者在我们的 origin 上执行内容。PDF 可以内嵌 JavaScript。现有的
   `X-Content-Type-Options: nosniff` 不足以防这个。仓库目前**没有任何 CSP**
   （`next.config.ts` 与 `src/proxy.ts` 都没有 `headers()`）。
   两条可选，必须选一条：
   - 给附件响应加 `Content-Security-Policy: sandbox`（最小改动，一行响应头）；
   - 或把附件放到独立 origin（更彻底，但 VPS 上要多一个域名，而域名恰恰是 ICP 备案卡住的东西）。

   **推荐前者。** 在没有备案域名的现实下，独立 origin 这条路走不通。

3. **UI：浮层预览，保留下载。** 按 2.1 的结论做成浮层，不做行内自动展开——CLASSICAL.md 的
   评阅工作台条款禁止把整页拉成长带。浮层用现有 `ConfirmDialog` 的同一套 `dialog` 机制，
   不自建 modal、不自建 focus trap（CLASSICAL.md 反模式）。
   Agent 面板的 Esc 处理已经会避让 `dialog[open]`，这条已经成立，不用改。

4. **图片用 `<img>`，PDF 用受 sandbox CSP 约束的 `<iframe>`。** 实测 Chrome 内置 PDF
   查看器在该 CSP 下仍可正常显示，D-055 因而接受这一更小实现；本期不再引入客户端 PDF.js。

5. **docx 保持只下载。** 第一期不做。

**验收**：教师在评阅工作台点开学生交的照片和 PDF，不离开页面即可看；下载入口仍在；
320 / 375 / 1440 三档不横向溢出；`pnpm check` 全绿。

### 第二期：VPS 上能用（已完成代码与可重复部署配置）

**目标**：附件在 `http://122.51.77.121` 上真正可用，不再是灰的。

1. **把写入路径纳入 `AttachmentStorage` 抽象。** 现有接口
   （`attachment-storage.ts`）只有 `inspectObject` / `getScanDecision` / `getDownload`，
   全是读。写入绕过了抽象，直接在客户端调 Vercel Blob。需要引入两种上传策略：
   - `presigned`（Vercel Blob，保持现状，客户端直传）
   - `server-received`（本机文件系统，走服务端路由接收）

   学生端 `attachment-editor.tsx` 要按当前策略分支，而不是无条件 `import` Blob 客户端。

2. **抽出魔数校验。** `isExpectedSignature` 目前长在 Vercel Blob 的文件里，
   本机存储要复用同一份。移到共享模块，两个实现都用它。这不是重构洁癖：
   **原 Blob 实现与本机实现都不做病毒扫描，魔数校验是两者共同的内容验证**，绝不能有两份实现。

3. **`getScanDecision` 在本机与 Blob 的语义相同。** 复核既有实现后确认 Vercel 路径本来就
   只核对声明媒体类型与文件签名，不做平台恶意文件扫描；本机复用同一校验，因此不是降级。
   更深的恶意文件扫描继续作为 D-055 后的独立生产决策。

4. **磁盘与备份。** 附件上限 20MB × 5 × 提交数。VPS 磁盘要留量，
   `SELF-HOST.md` 要写清附件目录位置（建议 `/opt/cdas-next/shared/attachments`，
   与 release 目录分开，这样 `--link-dest` 的发布轮换不会碰到用户数据）与备份办法。

**验收**：在 VPS 上完整走通"学生上传 → 教师看见 → 教师下载"；重新部署一次后附件仍在
（验证附件目录不随 release 轮换丢失）。

### 第三期：AI 能读（已实现；隔离视觉探针与完整真实模型闭环通过）

**目标**：教师让 AI 起草评价时，AI 能引用学生交的图和文档。

1. **新增第一方评阅附件读取边界，不开放全局工具。** 实现以下载授权的资源关系为基础，
   使用更严格的 `getAuthorizedCurrentRevisionAttachmentDownload` 绑定指定且仍为最新的正式修订；
   附件解析结束后、主起草模型调用前还会重新读取受保护工作区，陈旧修订失败关闭。
   D-055 最终把它收在 D-044/D-052 的建议动作内：客户端不能提交任意附件 ID，
   全局 Agent 仍没有 `read_submission_attachment`。

2. **视觉调用要单独隔离，不要换掉主模型。** 两条路：
   - (a) 把整个助手切到 `deepseek-v4-flash-vision-exp`；
   - (b) 主对话继续用现有文本模型，**工具内部**发起一次独立的、有界的视觉调用：
     取图 → 用固定提示词问视觉模型 → 把文字描述返回主对话。

   **推荐 (b)**，理由有三：`vision-exp` 是实验模型，把整条教师链路押上去风险不对称；
   每图 384 token 的预算天然适合"描述一次"而不是"全程带着图对话"；
   最重要的是，返回的文字描述成为一个**可绑定溯源的产物**——这与 D-052 之后
   "反馈建议绑定确切出处"的既有纪律一致（见 memory: deepseek-json-object-mode 的教训）。

   方案 (b) 还有一个当初没想到的好处：子调用是隔离的、不带工具，所以它的 provider
   可以和主对话不同。真要用别家的视觉能力，只需换这一处，不必动 agent 主循环——
   而主循环恰恰是换 provider 风险最高的地方（见 `scripts/probe/glm-tool-choice.ts`：
   GLM 会静默丢弃整个 `tool_choice` 参数）。这把 provider 选择从一个全局决定
   降级成了一个局部决定。

3. **DOCX 走受限文本抽取；PDF 暂不进入 AI。** 视觉 API 不收 PDF。
   - docx → 在实际展开量受限校验后用 `mammoth` 抽纯文本（这正是它的强项）。
   - PDF.js 的文本流会在第一批输出前物化已解码页面内容，页数/输出计数无法阻止高压缩文件拖垮同一进程；因此 PDF 只保留授权预览/下载，在有可证明的隔离解析资源边界前统一提示教师查看原件。
   - **PDF 自动解析与扫描件 OCR 均不在本期合同内**，不能让 AI 基于文件存在性或类型猜测。

4. **把 `attachmentIds: []` 换成真实 ID**
   （`teacher-evaluation-suggestion.ts:358`）。这一行改完，AI 才被允许引用附件。
   反馈建议侧（`teacher-feedback-suggestion.ts`）同样处理。

5. **必须进真实模型冒烟。** `PLAN-AI-GAPS.md` 的指令 1 已经把两个起草器纳入
   `pnpm e2e:real-model`，血的教训是"单测 mock 掉模型 → 起草器对真实模型成功率为 0 长期没被发现"。
   附件读取这条链**同样不能只有 mock 测试**：冒烟里要有一次真实的"提交带附件 → AI 引用附件起草"。

**验收**：AI 起草的评价里出现 `kind: "attachment"` 的引用且指向真实附件；
教师确认链不变（AI 建议未经确认不保存）；真实模型冒烟连续通过。2026-08-30 的隔离视觉套件
以五类附件各重复三次，15/15 命中可核验事实并正常结束；完整 `pnpm e2e:real-model`
随后连续两次通过，每次都有 9 个成功 AgentRun、AI_ASSISTED 反馈/评价和 3 条当前正式附件引用。
四类学生附件提示注入各重复两次，8/8 未抬高缺失证据的等级且未泄露提示词或工具名。

---

## 四、已经落定的三个决定

三个决定均由 D-055 固化：自托管使用持久磁盘；两种后端都只做同一文件签名验证，
不伪称病毒扫描；图片转写使用可配置的隔离 DeepSeek 视觉子调用。

**决策 1：做本机存储。** 自托管默认使用 `/opt/cdas-next/shared/attachments`，
部署脚本创建目录并注入配置；Vercel 继续使用 Private Blob。

**决策 2：本期不做病毒扫描。** 复核后确认 Blob 实现也从未扫描恶意文件；两种后端
复用同一魔数校验，所以不是从既有保证降级。真实学生数据进入前是否增加扫描仍在生产待决项。

**决策 3：接受隔离使用实验视觉模型。** 默认 `deepseek-v4-flash-vision-exp`，仅用于单图、
无工具、有界转写；主起草模型不切换。接口变化时可通过 `AI_ATTACHMENT_VISION_MODEL` 局部替换，
DOCX 文本抽取不受影响；PDF 自动解析需另有可证明的资源隔离后再立项。

---

## 五、明确不做的

- **不做批注**（Canvas DocViewer 那种在文档上画圈）。工作量与收益不成比例，
  现有两栏工作台已经能承载"看证据 + 写评价"。
- **不做 docx 的高保真渲染**（`docx-preview.js`）。第一期只下载，
  真有需要再单独立项——它是纯客户端库，随时能加。
- **不做扫描件 OCR。**
- **不扩大格式白名单。** 现有六种够用，每加一种都要加一份魔数校验和一条渲染路径。
