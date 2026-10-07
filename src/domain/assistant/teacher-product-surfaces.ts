import {
  MAX_ATTACHMENT_BYTES,
  MAX_SUBMISSION_ATTACHMENTS,
  supportedAttachmentFormats,
} from "../submission/attachment-policy";
import { teacherAgentPageKindSchema } from "./teacher-agent-page-context";

/**
 * A control, heading or message the teacher will look for on a page, named
 * exactly as the page renders it. `N` stands for a number the page fills in.
 *
 * Every label passed through here is checked against the UI source by
 * `teacher-product-surfaces.test.ts`. Renaming a button without updating this
 * map then fails `pnpm test` — otherwise the assistant keeps sending teachers
 * to look for a button that no longer exists, and nothing else notices.
 */
const namedControls = new Set<string>();

function control(label: string): string {
  namedControls.add(label);
  return `「${label}」`;
}

export const productSurfaceControlLabels: ReadonlySet<string> = namedControls;

/**
 * What this product offers a teacher, and where each thing happens.
 *
 * The assistant is not only a tool caller. A teacher asks it what the product
 * can do — and the honest answer is often "not in this chat, but on that page".
 * Without this the assistant answers such questions from its tool list alone
 * and says "我不能" about features that exist, which is worse than saying
 * nothing: the teacher concludes the product cannot do it either.
 *
 * Deliberately not a retrieval corpus. It is small, closed, and changes when a
 * route changes, so it is generated into the instructions the same way the
 * activity catalogues are. A retrieval layer over richer help content can be
 * added later without moving this: these are the surfaces themselves, which any
 * such layer would still have to agree with.
 */
export type TeacherProductSurface = Readonly<{
  kind: Exclude<
    (typeof teacherAgentPageKindSchema)["options"][number],
    "UNKNOWN_TEACHER_PAGE"
  >;
  label: string;
  /** Static path, or the shape of a resource path. Never a link the model invents. */
  path: string;
  /** What the teacher does here, in the teacher's own words. */
  does: string;
}>;

export const teacherProductSurfaces: readonly TeacherProductSurface[] = [
  {
    kind: "TEACHER_DASHBOARD",
    label: "教师工作台",
    path: "/teacher",
    does:
      `先列出此刻要处理的发布：点${control("待反馈")}${control("待评价")}${control("待重交")}直接进名册里对应的评阅队列；` +
      "再看各发布的提交进度和过程诊断入口、任教班级；新建班级与新建学习活动也从这里进",
  },
  {
    kind: "ACTIVITY_STUDIO",
    label: "活动设计",
    path: "/teacher/activities",
    does:
      "管理未发布的活动草稿；从这里新建学习活动、复用已有活动，或去课程依据页检索。" +
      "写了一半、还没保存为版本的任务书也列在这里，标着还差几项",
  },
  {
    kind: "ACTIVITY_NEW",
    label: "新建学习活动",
    path: "/teacher/activities/new",
    does:
      "自己动手填一份任务书，不经过助手。输入会自动保存，可以写一半离开、回来接着写；" +
      `右侧列出${control("还差")}哪几项，补齐后才能保存为版本，之后才能预览和发布`,
  },
  {
    kind: "ACTIVITY_COPY",
    label: "复用活动",
    path: "/teacher/activities/copy",
    does:
      "从本人草稿或仍管理的本人发布中选定一个 v3 版本，确认后复制为新草稿；班级、截止时间、提交与反馈不会带过去，" +
      `也不会自动发布。草稿页上的${control("复制为新活动")}会直接带着那份草稿进入这一页`,
  },
  {
    kind: "ACTIVITY_DRAFT",
    label: "活动草稿",
    path: "/teacher/activities/{draftId}",
    does:
      "编辑这份草稿的任务书，保存为编辑中或标记可预览；每次保存都生成新版本，旧版本保留。" +
      "没保存的修改会自动保存，下次打开时恢复；版本检查、AI 适配和预览只用已保存的版本。" +
      `v3 草稿还可以：${control("打印第 N 版")}（打印页可${control("下载 Word（可编辑）")}）、${control("复制为新活动")}、` +
      `在${control("课程依据")}块记录采纳的官方章节；未封存时还有${control("版本检查")}（AI 按任务书标准指出问题，不改内容）` +
      `和${control("AI 适配")}（按目标年级、总课时或新情境生成改动，教师核对后确认写入为新版本）。` +
      `从已发布活动复制来的草稿会显示${control("上次发布的课堂信号")}，版本检查也会参考它`,
  },
  {
    kind: "ACTIVITY_PREVIEW",
    label: "活动预览",
    path: "/teacher/activities/{draftId}/preview",
    does: "按学生会看到的样子核对，然后选班级发布",
  },
  {
    kind: "RELEASE_SUBMISSIONS",
    label: "发布提交名册",
    path: "/teacher/releases/{releaseId}/submissions",
    does:
      "看谁交了谁没交，按评阅状态、阶段或评价维度筛选，配作业小组、导出评阅名册、打印任务书、关闭活动，" +
      "并从每一行进入评阅。关闭是单向的，产品里没有「重新开启」这个操作",
  },
  {
    kind: "SUBMISSION_REVIEW",
    label: "提交评阅台",
    path: "/teacher/submissions/{submissionId}",
    does:
      "看这一份提交的当前正式修订：文字证据、学生勾选的证据项和附件（图片与 PDF 可就地预览）。" +
      `写形成性反馈时先选支架层级，再按${control("保存 · 请学生修改")}或${control("保存 · 进入下一阶段")}` +
      `（最终提交上是${control("保存 · 完成")}）；四档量规评价只在最终提交上做——分阶段活动的最后一个阶段、` +
      "一次性提交的整项——中间阶段只写反馈。两个起草按钮可以让 AI 先起草反馈或评价，教师改完再确认保存。" +
      `从名册筛选后进来时可以用${control("上一份")}${control("下一份")}在队列里切换；页面底部可以打印学习成果报告`,
  },
  {
    kind: "TEACHER_INSIGHTS",
    label: "过程诊断",
    path: "/teacher/insights",
    does:
      "一次看一个发布：此刻值得留意的提醒、谁停在哪个阶段、各项证据的勾选情况、AI 按需归纳的作答共同点（附学生原文）、" +
      "每份已评提交各维度的档位、重交前后的变化和支架层级；名字与表格行都能点进对应提交的评阅台",
  },
  {
    kind: "TEACHER_KNOWLEDGE",
    label: "课程依据",
    path: "/teacher/knowledge",
    does:
      `检索教育部课程方案与课程标准的原文章节（收录范围以下文的语料说明为准）；读到合适的章节可以${control("采纳为草稿依据")}，` +
      "选本人的一份草稿并写明采用理由，记进那份草稿的课程依据",
  },
  {
    kind: "CLASSROOM_MEMBERS",
    label: "班级成员",
    path: "/teacher/classrooms/{classroomId}/members",
    does:
      `用学生名单码把学生加进班级，或${control("从 Excel 导入学生")}：先下载 Excel 模板，只填${control("学号、姓名")}两列，` +
      "一次最多 100 行，逐行预览后确认导入；新建账号的初始密码是 cdas 加学号，学生首次登录必须修改。" +
      "也可以结束成员关系、查历史成员、为当前学生重置密码（新临时密码只显示一次），" +
      "从未有成员也从未发布活动的空班级可以在这里删除",
  },
  {
    kind: "CLASSROOM_NEW",
    label: "新建班级",
    path: "/teacher/classrooms/new",
    does:
      `创建一个由自己管理的班级；创建后可进入班级成员页上传两列${control("学号、姓名")}的 Excel，逐行预览后确认导入`,
  },
];

export type StudentProductSurface = Readonly<{
  label: string;
  path: string;
  does: string;
}>;

/** Where the student half happens, so the assistant can answer "学生那边怎么做". */
export const studentProductSurfaces: readonly StudentProductSurface[] = [
  {
    label: "我的学习活动",
    path: "/student",
    does: "看待提交、待重交、已反馈的活动",
  },
  {
    label: "学习活动 / 阶段证据",
    path: "/student/releases/{releaseId}",
    does:
      `按阶段依次写记录（自动保存）、勾选要交的内容、上传附件，再点${control("提交给老师")}；` +
      `前一阶段提交后下一阶段才解锁；老师要求修改时点${control("按老师的反馈修改")}重交；已完成后在活动关闭前也可以${control("再交一版改进")}；` +
      "活动关闭后仍可查看反馈与评价但不能再写",
  },
];

/**
 * The attachment facts a teacher actually asks about, generated from the policy
 * that enforces them. Hand-writing these would keep teaching the old limit the
 * day the policy raises it.
 */
export function describeAttachmentPolicyForTeachers(): string {
  const extensions = (
    predicate: (format: (typeof supportedAttachmentFormats)[number]) => boolean,
  ) =>
    supportedAttachmentFormats
      .filter(predicate)
      .flatMap((format) => format.extensions)
      .join("、");
  const megabytes = Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024));

  return [
    `单个附件最大 ${megabytes} MB，每份提交最多 ${MAX_SUBMISSION_ATTACHMENTS} 个。`,
    `可以交：${extensions(() => true)}。`,
    `教师和学生可以在页面里就地预览：${extensions((format) => format.disposition === "inline")}；` +
      `其余只能下载后用本地软件打开：${extensions((format) => format.disposition !== "inline")}。`,
    `评阅起草器能读进内容的只有：${extensions((format) => format.assistantReading !== "NONE")}；` +
      `读不了的（${extensions((format) => format.assistantReading === "NONE")}）会如实标注，请教师自己看原件后判断。`,
    `附件功能需要运维先配置存储。没配置时学生端会显示${control("附件存储尚未启用")}，这不是学生操作错误。`,
  ].join("");
}

/**
 * Questions this chat cannot answer by calling a tool, and where the product
 * does answer them. Each one is a real thing the product does — never invent an
 * entry for something that does not exist.
 */
export type AssistantReferral = Readonly<{ ask: string; answer: string }>;

export const assistantReferrals: readonly AssistantReferral[] = [
  {
    ask: "能不能帮我评作业、打分、写评语，或者读学生交的附件内容",
    answer:
      `这个会话读不到任何提交正文、附件或评价，但产品能做：提交评阅台上有${control("让助手起草这一版反馈")}和${control("让助手起草这一版评价")}两个按钮，起草时会读当前正式修订的附件。教师逐条改完再自己确认保存，AI 不会替教师保存任何反馈或评价。请教师从名册那一行的评阅链接进去。`,
  },
  {
    ask: "某某同学怎么样、谁最差、按名字找人",
    answer:
      // Stated positively on purpose: naming the wrong advice ("go match names
      // offline") here made the model repeat it as "you don't need to go
      // offline", which still put the idea in front of the teacher.
      "看不到姓名的是你，不是教师。名册页上教师本来就看得见学生姓名；不进模型的是你这一侧的边界。所以要说「我这边只拿到匿名序号」，并请教师直接点开那一行的评阅链接看原始证据——名册本身是完整的，教师不需要做任何额外的核对。",
  },
  {
    ask: "怎么把学生加进班级、学生名单码在哪、怎么结束成员关系",
    answer: "在班级成员页用学生名单码加入；结束成员关系也在同一页，历史区间会保留。",
  },
  {
    ask: "怎么新建班级、怎么用 Excel 导入学生",
    answer:
      `在${control("新建班级")}页创建班级；创建后进入班级成员页，上传只有两列${control("学号、姓名")}的 Excel，逐行预览并确认后导入。这个操作不由助手代办。`,
  },
  {
    ask: "怎么复制或复用已有活动",
    answer:
      `在${control("复用活动")}页从本人草稿或仍管理的本人发布中选定一个 v3 版本，核对后确认复制为新草稿；不会自动复制或发布。复制后的草稿页可以做版本检查和 AI 适配，教师确认后才写入新版本。`,
  },
  {
    ask: "学生忘了密码、登录不上",
    answer:
      `在班级成员页这名当前学生那一行点${control("重置密码")}，再在弹出的确认里点${control("重置并显示新密码")}。新的临时密码只显示一次，学生登录后必须修改；不会显示或改动他的作业。`,
  },
  {
    ask: "为什么这一份提交没有量规评价、中间阶段要不要评分",
    answer:
      "量规评价只在最终提交上做：分阶段活动是最后一个阶段，一次性提交是整项。中间阶段只写形成性反馈，这是产品的设计，不是故障。",
  },
  {
    ask: "怎么打印任务书、能不能导出 Word",
    answer:
      `在活动草稿页点${control("打印第 N 版")}，或在发布提交名册页点${control("打印任务书")}；打印页上可以${control("下载 Word（可编辑）")}。学生的学习成果报告在提交评阅台底部打印。`,
  },
  {
    ask: "这份草稿写得怎么样、帮我把活动改成适合另一个年级或班级",
    answer:
      `这个会话可以读你的草稿、指出问题，并在你确认后改写成新版本。草稿页上也有${control("版本检查")}和${control("AI 适配")}：前者只指出问题，后者按目标年级、总课时或新情境生成改动，你核对后再确认写入。`,
  },
  {
    ask: "怎么把课程标准原文记成活动的依据",
    answer:
      `在课程依据页检索并打开章节后${control("采纳为草稿依据")}，或在草稿页${control("课程依据")}块点${control("从课程标准选取")}。依据只说明设计参考了什么，不是合规结论。`,
  },
  {
    ask: "怎么让几个学生共交一份、怎么分组",
    answer: "在发布提交名册页配作业小组；已经开始个人提交的学生不能再并进小组。",
  },
  {
    ask: "怎么关闭活动、关闭之后学生还能不能改",
    answer:
      "在发布提交名册页关闭。关闭后学生只能查看已有草稿与正式修订，不能再保存或提交。",
  },
  {
    ask: "怎么把成绩或评阅情况导出来",
    answer:
      `在发布提交名册页用${control("导出评阅名册")}下载 CSV。导出的是状态与计数，不含反馈或评价正文。`,
  },
  {
    ask: "学生怎么交作业、怎么传附件、为什么下一阶段打不开",
    answer:
      `学生在自己的活动页按阶段依次${control("提交给老师")}；前一阶段提交后下一阶段才解锁。附件也在同一页上传。`,
  },
  {
    ask: "AI 会不会自动给学生发反馈、会不会自动打分",
    answer:
      "不会。发布、反馈与评价都必须教师在页面上确认；AI 只提出建议，确认后的记录会标注为 AI 建议、教师已确认。",
  },
];

function renderSurface(surface: { label: string; path: string; does: string }): string {
  return `- ${surface.label}（${surface.path}）：${surface.does}`;
}

/** The block that goes into the assistant instructions. */
export function buildProductSurfaceInstructions(): string {
  return `产品职责地图（教师问「这个能不能做」「在哪做」时照此回答，不要凭印象编造页面或按钮）：

教师端
${teacherProductSurfaces.map(renderSurface).join("\n")}

学生端
${studentProductSurfaces.map(renderSurface).join("\n")}

附件规则：${describeAttachmentPolicyForTeachers()}

常见转介（这些事这个会话做不了，但产品做得到，必须把教师指过去，不要只说「我不能」）：
${assistantReferrals.map((referral) => `- 教师问「${referral.ask}」：${referral.answer}`).join("\n")}

回答产品问题时的边界：

- 只讲上面写到的能力与页面。**没写到的功能就说目前没有**，不要用「应该可以」「一般来说」搪塞。
  最容易出错的一步是替教师把话接圆：他问一个操作，你顺着页面已有的功能推出一个对称的、
  听起来很合理的入口——有「关闭」就该有「重新打开」。活动复用必须按上面写的「复用活动」流程操作；地图里没写的操作就是没有，宁可说「产品里没有这个操作」
  再给出地图里最接近的真实做法，也不要发明一个让教师去页面上白找。
- **不知道原因就说不知道。** 教师报故障时，只讲上面写明的原因；原因不在上面就如实说你判断不了，
  请他看页面上的提示或联系运维。推测出三条听起来合理的原因，比说一句不知道更耽误他。
- **路径只用于你自己定位，不要写给教师。** 上面的 /teacher/... 是给你认页面用的，
  教师要的是页面名字和怎么点进去；{draftId} 这种占位符更不能出现在回答里。
  你的文字里不写任何网址或路径，也绝不自己拼域名（例如「https://…」）——站内地址没有域名，
  拼出来的链接教师点不开。工具结果卡片下方已经带着可点的链接，说「点下方卡片里的『打开过程诊断』」
  这类话即可；没有卡片时就说清在哪个页面上。
- **本次会话告诉你的班级，是这位教师能发布的班级，不是产品支持的全部班级。** 不要把它说成
  「系统只开放了这几个班」。同理，你这一侧的任何限制都不等于产品对教师的限制。
- 教师问的是产品怎么用时，直接回答，不要反过来要求他先选一次发布。不要道歉，不写「很抱歉」
  「请理解」这类填充——直接说能做什么、在哪做。`;
}
