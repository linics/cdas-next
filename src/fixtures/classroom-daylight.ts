import type { ActivityContent } from "../domain/activity/activity-content";

// 第二份演示任务书。存在的意义是让「发布确认」这一屏展示的不是节水活动的克隆，
// 同时按 SPRINT-0901 第 1.5 步的标准写：驱动性情境三件套 + 三阶段同一个故事 +
// 证据逐级递进。学科落在首版语料白名单内（物理 / 数学 / 信息科技）。
export const classroomDaylightTaskBook = {
  schemaVersion: 2,
  title: "教室采光改造提案",
  topic: "光环境、测量与用眼健康",
  summary:
    "实测本班教室各座位的采光差异，找出看不清黑板的座位，向总务处提出一份可施工的采光改造提案。",
  schoolStage: "MIDDLE",
  grade: 8,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math", "infoTech"],
  crossDisciplinaryConceptCodes: ["system_model"],
  assignmentType: "inquiry",
  assignmentSubtype: "experiment",
  inquiryDepth: "intermediate",
  submissionMode: "phased",
  durationWeeks: 3,
  backgroundSetting:
    "你们是本班的采光调查小组。开学体检后校医室发现，靠墙两列同学的视力下降人数明显更多；班主任怀疑跟座位采光有关，但拿不出数据，学校也不会仅凭一句「太暗了」就动工。请你们回答：这间教室到底哪些座位光照不足、差多少？三周后你们要交出一份《教室采光改造提案》，由班主任带去总务处例会，能施工的部分当学期就会改。",
  objectiveKnowledge:
    "理解照度的含义与量度方式，知道光照强度随距离和遮挡如何变化。",
  objectiveProcess:
    "能设计定点、定时的测量方案，用平均值与图表呈现座位间的照度差异，并据此判断问题座位。",
  objectiveEmotion:
    "愿意用数据替同学争取更好的学习条件，并把结论说成别人能执行的样子。",
  learningObjectives: [
    "理解照度的含义与量度方式。",
    "能用平均值与图表呈现座位间的照度差异。",
    "愿意用数据为同学争取更好的学习条件。",
  ],
  taskInstructions:
    "按统一时段测量全班座位的照度，用图表找出低于标准的座位，向总务处提出可施工的采光改造提案。",
  evidenceRequirements: [
    "覆盖全班座位的照度测量记录",
    "标出问题座位的图表与判读说明",
    "面向总务处的采光改造提案",
  ],
  feedbackCriteria: ["测量规范", "数据处理", "跨学科连接", "提案可行性"],
  phases: [
    {
      name: "把「太暗了」变成能测的量",
      action: "确定测量点位、时段与仪器，完成第一轮全班座位照度测量。",
      context:
        "班主任把问题交给你们时只有一句话：靠墙那几排同学说看不清。可是「看不清」没法拿去开会。这一阶段你们要先把这句话变成能测的量——决定在一天中的哪个时段、在座位的什么高度、用什么仪器去量，然后把全班座位量一遍。",
      support:
        "用手机照度计或学校的照度仪；先画一张座位平面图，把测点编号，避免漏测或重复测。同一时段测完全班，数据才能互相比较。",
      evidence: [
        { type: "document", description: "带座位平面图与测点编号的照度测量记录" },
      ],
      evaluationFocus: "测量条件是否统一，数据是否覆盖全班座位且可复核。",
      suggestedLessons: 2,
    },
    {
      name: "找出到底差在哪",
      action: "整理测量数据，用图表指出低于标准的座位，并解释差异的成因。",
      context:
        "你们手上已经有一张全班的照度表了。现在的问题变成：哪些座位真的不达标，差多少，为什么是这几个？把数字摆成图，让没到过现场的人也能一眼看出问题在哪一片。",
      support:
        "查阅教室照度的推荐值作为对照线；用平均值比较各列座位，用折线或热力图呈现分布；先描述差异，再解释成因（窗户位置、遮挡、灯具老化）。",
      evidence: [
        { type: "document", description: "标出问题座位与对照线的图表及判读说明" },
      ],
      evaluationFocus: "结论是否由自己测得的数据支撑，成因解释是否有另一种可能被排除。",
      suggestedLessons: 2,
    },
    {
      name: "把结论写成能施工的提案",
      action: "面向总务处写出一份指明位置、做法与预期效果的采光改造提案。",
      context:
        "数据已经指明了问题座位。下周班主任要带着你们的提案去总务处例会——那里的人关心的是改哪儿、怎么改、改完能好多少。这一阶段把你们的图表翻译成他们能直接派工的语言。",
      support:
        "按「问题座位—实测数据—建议做法—预期改善」四段写；建议要落到具体位置和具体做法，例如「换第三列上方两盏灯管」，不要写「加强采光」。",
      evidence: [
        { type: "text", description: "含实测数据依据的教室采光改造提案" },
      ],
      evaluationFocus: "提案是否指明位置与做法、是否与实测数据对应、是否可施工。",
      suggestedLessons: 2,
    },
  ],
  rubricDimensions: [
    {
      name: "测量规范",
      excellent: "测量条件统一、点位完整，数据可被他人复核。",
      good: "测量条件基本统一，数据基本完整。",
      pass: "完成测量但条件或点位有缺漏。",
      improve: "测量条件不清，数据无法比较。",
    },
    {
      name: "数据处理",
      excellent: "图表准确呈现差异，判读有对照线且解释成因。",
      good: "能用图表呈现差异并作出判读。",
      pass: "能整理数据但判读较弱。",
      improve: "数据未经整理或结论与数据脱节。",
    },
    {
      name: "跨学科连接",
      excellent: "能说清物理量度、数学处理与信息呈现如何共同支撑结论。",
      good: "能使用两个学科的方法。",
      pass: "能使用一种相关方法。",
      improve: "未说明学科方法如何发挥作用。",
    },
    {
      name: "提案可行性",
      excellent: "提案指明位置与做法，与数据对应且可直接施工。",
      good: "提案较具体并有数据依据。",
      pass: "提出基本建议。",
      improve: "建议笼统或无法执行。",
    },
  ],
} satisfies ActivityContent;
