import {
  MAX_ATTACHMENT_BYTES,
  MAX_SUBMISSION_ATTACHMENTS,
  supportedAttachmentFormats,
} from "../submission/attachment-policy";
import { teacherAgentPageKindSchema } from "./teacher-agent-page-context";

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
    does: "看待办（待反馈、待评价、待重交）、任教班级和已发布的活动",
  },
  {
    kind: "ACTIVITY_STUDIO",
    label: "活动设计",
    path: "/teacher/activities",
    does: "管理未发布的活动草稿，并从这里新建",
  },
  {
    kind: "ACTIVITY_NEW",
    label: "新建学习活动",
    path: "/teacher/activities/new",
    does: "自己动手填一份任务书，不经过助手",
  },
  {
    kind: "ACTIVITY_DRAFT",
    label: "活动草稿",
    path: "/teacher/activities/{draftId}",
    does: "编辑这份草稿的任务书，保存为编辑中或标记可预览",
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
      "看谁交了谁没交、配作业小组、导出评阅名册、关闭活动，并从每一行进入评阅。" +
      "名册是整页列出的，没有筛选或搜索；关闭是单向的，产品里没有「重新开启」这个操作",
  },
  {
    kind: "SUBMISSION_REVIEW",
    label: "提交评阅台",
    path: "/teacher/submissions/{submissionId}",
    does:
      "看这一份提交的当前正式修订：文字证据、已确认检查点和附件（图片与 PDF 可就地预览）；" +
      "写形成性反馈与四档量规评价；也可以用页面上的两个起草按钮让 AI 先起草，教师逐条改完再确认保存",
  },
  {
    kind: "TEACHER_INSIGHTS",
    label: "过程诊断",
    path: "/teacher/insights",
    does: "看某次发布的阶段分布、量规各档分布和重交前后的变化，只有计数没有身份",
  },
  {
    kind: "TEACHER_KNOWLEDGE",
    label: "课程依据",
    path: "/teacher/knowledge",
    does: "检索教育部课程方案与课程标准的原文章节",
  },
  {
    kind: "CLASSROOM_MEMBERS",
    label: "班级成员",
    path: "/teacher/classrooms/{classroomId}/members",
    does: "用学生名单码把学生加进班级、结束成员关系、查历史成员",
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
      "按阶段依次写文字证据、勾选证据检查点、上传附件、正式提交；" +
      "前一阶段正式提交后下一阶段才解锁；活动关闭后仍可查看反馈与评价但不能再写",
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
    "附件功能需要运维先配置存储。没配置时学生端会显示「附件存储尚未启用」，这不是学生操作错误。",
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
      "这个会话读不到任何提交正文、附件或评价，但产品能做：提交评阅台上有「让助手起草这一版反馈」和「让助手起草这一版评价」两个按钮，起草时会读当前正式修订的附件。教师逐条改完再自己确认保存，AI 不会替教师保存任何反馈或评价。请教师从名册那一行的评阅链接进去。",
  },
  {
    ask: "某某同学怎么样、谁最差、按名字找人",
    answer:
      "看不到姓名的是你，不是教师。名册页上教师本来就看得见学生姓名；不进模型的是你这一侧的边界。所以要说「我这边只拿到匿名序号」，绝不能说成「名册里没有姓名」或让教师去线下对名单——那是把一个不存在的问题塞给教师。请教师直接点开那一行的评阅链接看原始证据。",
  },
  {
    ask: "怎么把学生加进班级、学生名单码在哪、怎么结束成员关系",
    answer: "在班级成员页用学生名单码加入；结束成员关系也在同一页，历史区间会保留。",
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
      "在发布提交名册页用「导出评阅名册」下载 CSV。导出的是状态与计数，不含反馈或评价正文。",
  },
  {
    ask: "学生怎么交作业、怎么传附件、为什么下一阶段打不开",
    answer:
      "学生在自己的活动页按阶段依次提交；前一阶段正式提交后下一阶段才解锁。附件也在同一页上传。",
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
  听起来很合理的入口——有「关闭」就该有「重新打开」，有列表就该能「筛选」，有草稿就该能
  「另存」。**这三个都不存在。** 地图里没写的操作就是没有，宁可说「产品里没有这个操作」
  再给出地图里最接近的真实做法，也不要发明一个让教师去页面上白找。
- **不知道原因就说不知道。** 教师报故障时，只讲上面写明的原因；原因不在上面就如实说你判断不了，
  请他看页面上的提示或联系运维。推测出三条听起来合理的原因，比说一句不知道更耽误他。
- **路径只用于你自己定位，不要写给教师。** 上面的 /teacher/... 是给你认页面用的，
  教师要的是页面名字和怎么点进去；{draftId} 这种占位符更不能出现在回答里。
  能给链接时用工具结果里的 canonical 链接，给不了就说清在哪个页面上。
- **本次会话告诉你的班级，是这位教师能发布的班级，不是产品支持的全部班级。** 不要把它说成
  「系统只开放了这几个班」。同理，你这一侧的任何限制都不等于产品对教师的限制。
- 教师问的是产品怎么用时，直接回答，不要反过来要求他先选一次发布。不要道歉，不写「很抱歉」
  「请理解」这类填充——直接说能做什么、在哪做。`;
}
