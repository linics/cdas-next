import type { ActivityContentV3 } from "../domain/activity/activity-content";

/**
 * The five task books a seeded demo instance contains. They are all schema v3,
 * and they are deliberately five different designs rather than one design with
 * five titles: the point a reader is meant to take from the workspace is that
 * a task book states which official competency each goal answers to, what each
 * discipline contributes that no other discipline could, and which phase and
 * which rubric dimension are responsible for every goal. Five clones of one
 * activity would show the form and hide the idea.
 *
 * Every competency code here exists in the versioned registry for the school
 * stage and grade the activity declares, so a seeded instance is also a
 * demonstration that the citations are real rather than decorative.
 */

/** Phased. The flagship: it carries the full submit → feedback → evaluate loop. */
export const waterConservationDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "校园节水行动",
  topic: "生态与可持续发展",
  summary:
    "你们是七年级节水观察员：查清校园哪一处用水最浪费，交出一份能贴上公示栏的《校园节水建议书》。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math", "chinese"],
  disciplineContributions: [
    {
      disciplineCode: "physics",
      contribution: "解释水从哪里流走、为什么流得快，把「漏」说成可观察的流量与装置问题。",
      necessity: "不谈机理就只能说「有点浪费」，改造方案无从设计，也无法预测省下多少。",
    },
    {
      disciplineCode: "math",
      contribution: "用连续读数和比较，把浪费量算出来而不是估出来。",
      necessity: "没有数据，「哪一处最浪费」永远只是印象，总务处也无法排优先级。",
    },
    {
      disciplineCode: "chinese",
      contribution: "把调查结论写成总务处看得懂、愿意采纳的建议书。",
      necessity: "写不清楚就传不出去，一份没人读的建议等于没做。",
    },
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "intermediate",
  submissionMode: "phased",
  durationWeeks: 3,
  backgroundSetting:
    "总务处要在月底公布一批节水措施，但手上只有一张全校总水表账单，说不清水耗在哪一处。他们把这件事交给七年级：拿证据来，说服我们改哪里。",
  taskInstructions:
    "分三步完成：先到现场确定一个真实的用水浪费点并说清现象，再用连续读数把浪费量算出来，最后写一份面向总务处的《校园节水建议书》，说明改什么、为什么有效、大约能省多少。",
  learningGoals: [
    {
      id: "goal-mechanism",
      description: "能用流量、压力或装置状态解释一处用水浪费是怎么发生的。",
      competencyReferences: [
        { disciplineCode: "physics", competencyCode: "physical_concept" },
      ],
    },
    {
      id: "goal-evidence",
      description: "能用连续读数计算浪费量，并说明这个数字为什么可信。",
      competencyReferences: [
        { disciplineCode: "math", competencyCode: "data_concept" },
        { disciplineCode: "physics", competencyCode: "scientific_inquiry" },
      ],
    },
    {
      id: "goal-proposal",
      description: "能面向总务处写出有依据、可执行的改造建议。",
      competencyReferences: [
        { disciplineCode: "chinese", competencyCode: "language_application" },
      ],
    },
  ],
  phases: [
    {
      name: "现场认定",
      action: "到一处真实用水点观察并记录，认定它确实在浪费。",
      context:
        "洗手间、饮水区、绿化浇灌，哪一处最像每天都在漏？先别下结论，把时间、地点、现象写下来，让下一步对得上。",
      support: "观察记录表按「时间 / 地点 / 现象 / 影响」四栏填写，先描述再判断。",
      learningGoalIds: ["goal-mechanism"],
      evidence: [
        { type: "text", description: "带时间、地点与现象描述的观察记录" },
      ],
      evaluationFocus: "问题来自真实现场，描述具体到能被复核。",
      suggestedLessons: 1,
    },
    {
      name: "读数与估算",
      action: "连续记录同一点位的读数，算出这处浪费一周约有多少。",
      context:
        "总务处只认数字。你们要证明的是「这一处一周浪费 X 升」，而不是「这里好像很费水」。",
      support: "提供读数记录模板与单位换算表；至少取三个时间点以便比较。",
      learningGoalIds: ["goal-mechanism", "goal-evidence"],
      evidence: [
        { type: "document", description: "读数表与浪费量估算过程" },
        { type: "image", description: "水表或漏水点的现场照片" },
      ],
      evaluationFocus: "数据可复算，估算过程与结论一致。",
      suggestedLessons: 2,
    },
    {
      name: "建议书",
      action: "写出面向总务处的改造建议，说明改什么、为什么有效、能省多少。",
      context: "这份稿子会贴上公示栏，全校都会看到，也包括提出反对意见的人。",
      support: "建议书结构：问题 → 证据 → 措施 → 预期效果 → 可能的反对与回应。",
      learningGoalIds: ["goal-evidence", "goal-proposal"],
      evidence: [{ type: "text", description: "《校园节水建议书》定稿" }],
      evaluationFocus: "建议可执行，且每一条都能回指到自己的数据。",
      suggestedLessons: 1,
    },
  ],
  rubricDimensions: [
    {
      name: "问题与机理",
      excellent: "准确指出浪费点，并用流量或装置状态解释它为何持续发生。",
      good: "指出浪费点，机理解释基本成立。",
      pass: "能说明哪里在浪费。",
      improve: "问题笼统，或把现象当成了原因。",
      learningGoalIds: ["goal-mechanism"],
    },
    {
      name: "数据与证据",
      excellent: "读数完整可复算，估算过程清楚，结论有余量说明。",
      good: "数据较完整，估算基本支持结论。",
      pass: "有读数并给出了一个数字。",
      improve: "数据不足或算不出来，结论悬空。",
      learningGoalIds: ["goal-evidence"],
    },
    {
      name: "跨学科连接",
      excellent: "机理、数据与表达互相支撑，缺任何一环建议都不成立。",
      good: "能连接其中两者。",
      pass: "能识别学科各自做了什么。",
      improve: "三部分各说各的，看不出为什么要一起做。",
      learningGoalIds: ["goal-mechanism", "goal-evidence", "goal-proposal"],
    },
    {
      name: "建议与表达",
      excellent: "措施具体到可施工，预期效果有依据，并回应了可能的反对。",
      good: "措施明确，理由清楚。",
      pass: "提出了改进方向。",
      improve: "建议无法执行，或与自己的数据对不上。",
      learningGoalIds: ["goal-proposal"],
    },
  ],
};

/** Phased, still open. The evidence-gathering half of the same story. */
export const waterSurveyDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "校园用水现场调查",
  topic: "校园用水的现场证据",
  summary:
    "总务处只剩一周就要公布节水措施。这一轮先把现场证据拿到手：哪个用水点在漏、漏了多少、谁能改。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math", "geography"],
  disciplineContributions: [
    {
      disciplineCode: "physics",
      contribution: "判断一个用水点是装置故障、使用习惯还是设计问题。",
      necessity: "分不清这三者，改造就会用错手段——换阀门解决不了习惯问题。",
    },
    {
      disciplineCode: "math",
      contribution: "把不同点位的读数放在同一口径下比较，排出优先级。",
      necessity: "不比较就只能一处一处试，而学校只有一周和一笔钱。",
    },
    {
      disciplineCode: "geography",
      contribution: "把用水点标进校园平面图，看清管线走向与人流分布的关系。",
      necessity: "脱离空间分布，就解释不了为什么偏偏是这几处出问题。",
    },
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "basic",
  submissionMode: "phased",
  durationWeeks: 2,
  backgroundSetting:
    "校园里有十一个公共用水点。总务处怀疑其中两三处占了大部分损耗，但没人实地核过。这一周你们要给出一张有依据的排序表。",
  taskInstructions:
    "分三步：先在校园平面图上标出全部用水点并分类，再挑三处做同口径读数，最后交出一张按浪费量排序、标注可改造性的调查表。",
  learningGoals: [
    {
      id: "goal-classify",
      description: "能把校园用水点按故障、习惯、设计三类归因并说明依据。",
      competencyReferences: [
        { disciplineCode: "physics", competencyCode: "scientific_thinking" },
      ],
    },
    {
      id: "goal-map",
      description: "能在校园平面图上呈现用水点分布，并解释分布与人流或管线的关系。",
      competencyReferences: [
        { disciplineCode: "geography", competencyCode: "regional_cognition" },
        { disciplineCode: "geography", competencyCode: "geographical_practice" },
      ],
    },
    {
      id: "goal-rank",
      description: "能用同口径数据对多个用水点排序，并说明排序依据。",
      competencyReferences: [
        { disciplineCode: "math", competencyCode: "data_concept" },
      ],
    },
  ],
  phases: [
    {
      name: "点位普查",
      action: "走遍校园，标出全部公共用水点并初步归类。",
      context: "总务处给了一张平面图，但上面没有用水点。这张图要由你们补完。",
      support: "提供校园平面图与三类归因的判断提示。",
      learningGoalIds: ["goal-classify", "goal-map"],
      evidence: [
        { type: "image", description: "标注了用水点与分类的校园平面图" },
      ],
      evaluationFocus: "点位无遗漏，归类有依据。",
      suggestedLessons: 1,
    },
    {
      name: "重点点位读数",
      action: "选三处疑似高损耗点位，用相同方法各取三次读数。",
      context: "口径不一样的数据没法比较，所以三处必须用同一种记法和同一个时长。",
      support: "提供统一读数表；同一时段、同一时长、同一记录人。",
      learningGoalIds: ["goal-classify", "goal-rank"],
      evidence: [{ type: "document", description: "三处点位的同口径读数表" }],
      evaluationFocus: "口径一致，数据可比较。",
      suggestedLessons: 1,
    },
    {
      name: "排序与移交",
      action: "按浪费量排序，标注每一处的可改造性，交给总务处。",
      context: "总务处拿到表就要决定先修哪一处，所以排序要经得起追问。",
      support: "排序表包含：点位 / 估算浪费量 / 归因 / 改造难度 / 建议顺序。",
      learningGoalIds: ["goal-map", "goal-rank"],
      evidence: [{ type: "document", description: "带排序依据的用水点调查表" }],
      evaluationFocus: "排序依据清楚，可改造性判断有理由。",
      suggestedLessons: 1,
    },
  ],
  rubricDimensions: [
    {
      name: "归因判断",
      excellent: "三类归因区分准确，每一处都能说出判断依据。",
      good: "多数点位归因合理。",
      pass: "能作出初步分类。",
      improve: "分类随意，或把现象直接当成原因。",
      learningGoalIds: ["goal-classify"],
    },
    {
      name: "空间呈现",
      excellent: "平面图完整清晰，并解释了分布与人流或管线的关系。",
      good: "分布呈现完整，解释基本合理。",
      pass: "能标出主要用水点。",
      improve: "图不完整或与实地对不上。",
      learningGoalIds: ["goal-map"],
    },
    {
      name: "数据可比性",
      excellent: "口径统一，重复读数一致，差异有解释。",
      good: "口径基本统一。",
      pass: "有读数记录。",
      improve: "口径混乱，数据无法比较。",
      learningGoalIds: ["goal-rank"],
    },
    {
      name: "结论可用性",
      excellent: "排序与可改造性判断可直接支持决策。",
      good: "排序清楚，理由基本充分。",
      pass: "给出了顺序。",
      improve: "排序缺依据，无法据以行动。",
      learningGoalIds: ["goal-map", "goal-rank"],
    },
  ],
};

/** One-shot, already closed. The public-communication half of the same story. */
export const waterCampaignDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "节水倡议展示",
  topic: "把证据讲给全校听",
  summary:
    "节水建议已经被采纳。这一轮你们要把调查过程讲成全校听得懂的展示，让别的班也照着做。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "chinese",
  integratedDisciplineCodes: ["arts", "infoTech"],
  disciplineContributions: [
    {
      disciplineCode: "chinese",
      contribution: "把调查过程组织成一条别人跟得上的叙述线。",
      necessity: "没有叙述线，观众只看到一堆数字，记不住也学不会。",
    },
    {
      disciplineCode: "arts",
      contribution: "用版面与图示让关键数据一眼可读。",
      necessity: "展板上没人会读大段文字；看不清就等于没讲。",
    },
    {
      disciplineCode: "infoTech",
      contribution: "把数据做成可核对的图表，并说明数据来源。",
      necessity: "不标来源的图表在公开场合站不住，别的班也无法复用你们的方法。",
    },
  ],
  assignmentType: "practical",
  assignmentSubtype: "simulation",
  inquiryDepth: null,
  submissionMode: "once",
  durationWeeks: 1,
  backgroundSetting:
    "上一轮的节水建议已经被总务处采纳并开始施工。校方希望你们在升旗仪式后做一次展示，让其他年级知道这件事是怎么做成的。",
  taskInstructions:
    "把前两轮的调查做成一次面向全校的展示：一张展板加一段三分钟讲解。要让听众明白你们怎么找到问题、怎么用数据证明、最后改了什么。",
  learningGoals: [
    {
      id: "goal-narrative",
      description: "能把一次调查组织成让非专业听众跟得上的叙述。",
      competencyReferences: [
        { disciplineCode: "chinese", competencyCode: "language_application" },
        { disciplineCode: "chinese", competencyCode: "thinking_ability" },
      ],
    },
    {
      id: "goal-visual",
      description: "能用版面与图示让关键信息在几秒内被读到。",
      competencyReferences: [
        { disciplineCode: "arts", competencyCode: "artistic_expression" },
      ],
    },
    {
      id: "goal-traceable",
      description: "能在公开材料中标明数据来源，使结论可被他人核对。",
      competencyReferences: [
        { disciplineCode: "infoTech", competencyCode: "information_social_responsibility" },
      ],
    },
  ],
  phases: [
    {
      name: "叙述线",
      action: "把两轮调查压缩成一条三分钟能讲完的线索。",
      context: "听众是其他年级的同学，他们没参与过调查，也不认识那些点位。",
      support: "提供讲稿框架：一个问题 → 一个数字 → 一个改变。",
      learningGoalIds: ["goal-narrative"],
      evidence: [{ type: "text", description: "三分钟讲稿" }],
      evaluationFocus: "外行听得懂，且没有跳步。",
      suggestedLessons: 1,
    },
    {
      name: "展板",
      action: "设计一张一米见方的展板，让人路过三秒就能抓住重点。",
      context: "展板会立在食堂门口，多数人只是路过看一眼。",
      support: "提供版面网格与图表模板；正文不超过三段。",
      learningGoalIds: ["goal-visual", "goal-traceable"],
      evidence: [{ type: "image", description: "展板设计稿" }],
      evaluationFocus: "重点突出，数据标注了来源。",
      suggestedLessons: 1,
    },
    {
      name: "现场讲解",
      action: "完成一次现场讲解并回应两个提问。",
      context: "会有老师追问「这个数字怎么来的」，要答得上。",
      support: "提前准备两个最可能被问到的问题及回应。",
      learningGoalIds: ["goal-narrative", "goal-traceable"],
      evidence: [{ type: "confirm", description: "教师现场确认已完成讲解与答问" }],
      evaluationFocus: "讲解完整，追问答得上。",
      suggestedLessons: 1,
    },
  ],
  rubricDimensions: [
    {
      name: "叙述完整",
      excellent: "问题、证据、结果三段清楚，没有跳步。",
      good: "叙述基本完整。",
      pass: "能讲清做了什么。",
      improve: "顺序混乱或缺少关键环节。",
      learningGoalIds: ["goal-narrative"],
    },
    {
      name: "可读性",
      excellent: "三秒内能抓住重点，图表自解释。",
      good: "重点清楚。",
      pass: "信息完整但需要细读。",
      improve: "文字堆叠，重点淹没。",
      learningGoalIds: ["goal-visual"],
    },
    {
      name: "可核对",
      excellent: "每个数字都能追到来源，方法可被别班复用。",
      good: "主要数据标注了来源。",
      pass: "部分数据有出处。",
      improve: "数字来路不明。",
      learningGoalIds: ["goal-traceable"],
    },
    {
      name: "现场应对",
      excellent: "讲解流畅，追问答得有依据。",
      good: "讲解完整，能回应提问。",
      pass: "完成了讲解。",
      improve: "讲解中断或答非所问。",
      learningGoalIds: ["goal-narrative", "goal-traceable"],
    },
  ],
};

/** An editing draft: deliberately a narrower, single-point measurement design. */
export const drinkingStationDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "饮水区用水记录",
  topic: "饮水区的用水记录",
  summary:
    "饮水区每天接水的人最多，也最难说清浪费在哪。先从连续一周的定点记录做起。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "math",
  integratedDisciplineCodes: ["physics"],
  disciplineContributions: [
    {
      disciplineCode: "math",
      contribution: "设计一份能持续一周、不同人记也一致的记录方法。",
      necessity: "记录方法不统一，一周下来的数据没法合并，也就白记了。",
    },
    {
      disciplineCode: "physics",
      contribution: "分辨哪些流失是接水必然带来的，哪些是可以消除的。",
      necessity: "不区分这两者，就会把正常用水也算成浪费，结论站不住。",
    },
  ],
  assignmentType: "practical",
  assignmentSubtype: "observation",
  inquiryDepth: null,
  submissionMode: "phased",
  durationWeeks: 1,
  backgroundSetting:
    "饮水区一天有六百多人次接水。有人说这里最浪费，也有人说那是接水必然的损耗。谁也拿不出记录。",
  taskInstructions:
    "用一周时间在饮水区做定点记录：先定好记录方法，再轮班记录，最后判断其中多少是可消除的浪费。",
  learningGoals: [
    {
      id: "goal-method",
      description: "能设计出不同记录人执行也一致的定点记录方法。",
      competencyReferences: [
        { disciplineCode: "math", competencyCode: "data_concept" },
      ],
    },
    {
      id: "goal-separate",
      description: "能区分必然损耗与可消除浪费，并说明区分依据。",
      competencyReferences: [
        { disciplineCode: "physics", competencyCode: "physical_concept" },
      ],
    },
  ],
  phases: [
    {
      name: "定方法",
      action: "写出一份任何人拿到都能照做的记录方法。",
      context: "一周要轮六个人记录，方法不统一就前功尽弃。",
      support: "方法需写明：记什么、多久记一次、遇到异常怎么办。",
      learningGoalIds: ["goal-method"],
      evidence: [{ type: "text", description: "定点记录方法说明" }],
      evaluationFocus: "换一个人执行也能得到同样口径的数据。",
      suggestedLessons: 1,
    },
    {
      name: "轮班记录",
      action: "按方法连续记录一周并汇总。",
      context: "中间会遇到没人接水的时段和设备被临时关闭的情况，都要如实记下。",
      support: "提供轮班表与异常情况登记栏。",
      learningGoalIds: ["goal-method", "goal-separate"],
      evidence: [{ type: "document", description: "一周汇总记录表" }],
      evaluationFocus: "记录连续，异常有说明。",
      suggestedLessons: 1,
    },
    {
      name: "分离浪费",
      action: "判断记录中哪一部分是可消除的浪费。",
      context: "接水时的滴漏和长流水不是一回事，结论要说清区别。",
      support: "先分类再计量，不要先算总数。",
      learningGoalIds: ["goal-separate"],
      evidence: [{ type: "text", description: "必然损耗与可消除浪费的分离说明" }],
      evaluationFocus: "区分有依据，没有把正常用水算成浪费。",
      suggestedLessons: 1,
    },
  ],
  rubricDimensions: [
    {
      name: "方法一致性",
      excellent: "方法明确到换人执行也不走样，异常处理有规定。",
      good: "方法清楚，多数情况可照做。",
      pass: "能说明记什么。",
      improve: "方法含糊，不同人会记出不同结果。",
      learningGoalIds: ["goal-method"],
    },
    {
      name: "记录质量",
      excellent: "一周连续无缺漏，异常均有说明。",
      good: "记录基本连续。",
      pass: "有部分记录。",
      improve: "断档多且未说明。",
      learningGoalIds: ["goal-method"],
    },
    {
      name: "区分依据",
      excellent: "必然损耗与可消除浪费分离清楚，依据充分。",
      good: "能作出区分。",
      pass: "意识到两者不同。",
      improve: "把全部用水都当成浪费。",
      learningGoalIds: ["goal-separate"],
    },
    {
      name: "结论可用",
      excellent: "结论指向具体的可改进环节。",
      good: "结论明确。",
      pass: "给出了初步判断。",
      improve: "结论与记录对不上。",
      learningGoalIds: ["goal-method", "goal-separate"],
    },
  ],
};

/** A ready-for-preview draft: a different subject pair and a different grade. */
export const classroomDaylightDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "教室采光改造提案",
  topic: "光环境、测量与用眼健康",
  summary:
    "实测本班教室各座位的采光差异，找出看不清黑板的座位，向总务处提出一份可施工的采光改造提案。",
  schoolStage: "MIDDLE",
  grade: 8,
  mainDisciplineCode: "physics",
  integratedDisciplineCodes: ["math", "infoTech"],
  disciplineContributions: [
    {
      disciplineCode: "physics",
      contribution: "用照度与光线路径解释为什么某些座位偏暗。",
      necessity: "不谈光路就只能说「那边暗」，无法判断该加灯还是换窗帘。",
    },
    {
      disciplineCode: "math",
      contribution: "把逐座位照度整理成可比较的分布，定出不达标区域。",
      necessity: "没有分布就分不清是个别座位还是整片区域，改造范围无从确定。",
    },
    {
      disciplineCode: "infoTech",
      contribution: "用测量工具采集数据并生成可核对的图表。",
      necessity: "手记数据既慢又难复核，公开提案需要可追溯的原始数据。",
    },
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "experiment",
  inquiryDepth: "intermediate",
  submissionMode: "phased",
  durationWeeks: 2,
  backgroundSetting:
    "本班后排靠墙的几个座位长期反映看不清黑板。总务处愿意改，但要求先拿出测量结果，而不是凭感觉调座位。",
  taskInstructions:
    "分三步：先设计逐座位的照度测量方案，再实测并绘制教室照度分布，最后提出一份标明施工位置与预期效果的采光改造提案。",
  learningGoals: [
    {
      id: "goal-optics",
      description: "能用光线路径与照度解释座位间的采光差异。",
      competencyReferences: [
        { disciplineCode: "physics", competencyCode: "physical_concept" },
        { disciplineCode: "physics", competencyCode: "scientific_inquiry" },
      ],
    },
    {
      id: "goal-distribution",
      description: "能把逐点测量整理成分布并判定不达标区域。",
      competencyReferences: [
        { disciplineCode: "math", competencyCode: "data_concept" },
      ],
    },
    {
      id: "goal-toolchain",
      description: "能使用测量工具采集数据并生成可核对的图表。",
      competencyReferences: [
        { disciplineCode: "infoTech", competencyCode: "digital_learning_innovation" },
      ],
    },
  ],
  phases: [
    {
      name: "测量方案",
      action: "设计逐座位照度测量方案并说明控制条件。",
      context: "阴天和晴天测出来完全不同，方案要写明在什么条件下测。",
      support: "方案需写明：测点、时段、天气条件、仪器高度与朝向。",
      learningGoalIds: ["goal-optics", "goal-toolchain"],
      evidence: [{ type: "text", description: "带控制条件的测量方案" }],
      evaluationFocus: "条件写清楚，重测能得到可比结果。",
      suggestedLessons: 1,
    },
    {
      name: "实测与分布",
      action: "按方案实测全部座位并绘制照度分布图。",
      context: "四十多个座位要在同一节课内测完，否则光照已经变了。",
      support: "提供座位编号图与数据录入表。",
      learningGoalIds: ["goal-distribution", "goal-toolchain"],
      evidence: [
        { type: "document", description: "逐座位照度数据与分布图" },
        { type: "image", description: "测量现场照片" },
      ],
      evaluationFocus: "测点齐全，分布图与数据一致。",
      suggestedLessons: 2,
    },
    {
      name: "改造提案",
      action: "提出标明施工位置与预期效果的改造提案。",
      context: "总务处按提案报预算，写不清位置就没法施工。",
      support: "提案含：不达标区域 / 措施 / 位置 / 预期照度 / 造价量级。",
      learningGoalIds: ["goal-optics", "goal-distribution"],
      evidence: [{ type: "text", description: "采光改造提案" }],
      evaluationFocus: "措施与实测结果对应，位置明确到可施工。",
      suggestedLessons: 1,
    },
  ],
  rubricDimensions: [
    {
      name: "测量设计",
      excellent: "控制条件完整，方案可被他人原样重复。",
      good: "主要条件写明。",
      pass: "能说明怎么测。",
      improve: "条件缺失，结果无法比较。",
      learningGoalIds: ["goal-optics", "goal-toolchain"],
    },
    {
      name: "数据与分布",
      excellent: "测点齐全，分布图准确，不达标区域判定有据。",
      good: "数据较完整，判定基本合理。",
      pass: "有测量数据。",
      improve: "测点缺失或分布图与数据不符。",
      learningGoalIds: ["goal-distribution"],
    },
    {
      name: "光学解释",
      excellent: "能用光路与遮挡关系解释分布成因。",
      good: "解释基本成立。",
      pass: "能描述现象。",
      improve: "只有现象没有解释。",
      learningGoalIds: ["goal-optics"],
    },
    {
      name: "提案可施工",
      excellent: "位置、措施、预期效果齐全，可直接报预算。",
      good: "措施明确，位置基本清楚。",
      pass: "提出了改造方向。",
      improve: "无法据以施工。",
      learningGoalIds: ["goal-distribution", "goal-toolchain"],
    },
  ],
};

export const demoActivitiesV3 = [
  waterConservationDemoV3,
  waterSurveyDemoV3,
  waterCampaignDemoV3,
  drinkingStationDemoV3,
  classroomDaylightDemoV3,
] as const;
