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
 * They also differ in subject and stage — water and physics, plants and
 * biology, family objects and history, a primary-school library corner, and a
 * grade-8 daylight study — so that copying, adapting and the assistant's
 * curriculum search have more than one topic to work on.
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
      support: "1. 选一处用水点，先写下时间和地点\n2. 只描述看到的现象，比如水流多久、有没有人用\n3. 写下它可能造成的影响，最后再判断算不算浪费\n可以这样写：「我在……看到……」「持续了大约……，这时没有人在用」",
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
      support: "1. 在同一点位取至少三个时间点的读数，填进一张表：时间 / 读数 / 间隔\n2. 用两次读数之差算出每段时间的用水量，单位统一成升\n3. 按一周的天数推算浪费量，写清每一步怎么算的\n可以这样写：「两次读数相差……升，说明……」「按每天……推算，一周约……升」",
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
      support: "1. 用一句话说清问题在哪里\n2. 摆出你们的读数和估算作为证据\n3. 写出具体措施和预期能省多少\n4. 想一个可能的反对意见，并回应它\n可以这样写：「我们建议……，因为……」「有人可能会说……，但我们的数据显示……」",
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

/** Phased, still open, with a group. A different subject trio from the flagship. */
export const campusPlantsDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "校园植物身份证",
  topic: "校园植物识别与科普",
  summary:
    "你们是七年级植物调查员：给校园里一棵还没有名牌的植物做一张「身份证」——说清它是谁、怎么认出来、为什么长在这里，扫码就能读到。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "biology",
  integratedDisciplineCodes: ["infoTech", "chinese"],
  disciplineContributions: [
    {
      disciplineCode: "biology",
      contribution: "用叶、花、果、茎的特征把植物认准，并说明它和校园环境的关系。",
      necessity: "认不准就会把错的名字挂上去，全校跟着认错。",
    },
    {
      disciplineCode: "infoTech",
      contribution: "把档案做成扫码可读的页面，标注每张照片和每份资料的来源。",
      necessity: "纸牌写不下也改不了；不标来源，别人无法核对你们的鉴定。",
    },
    {
      disciplineCode: "chinese",
      contribution: "把鉴定依据写成路过的同学一分钟能读完的说明文字。",
      necessity: "写成术语堆砌就没人读，名牌上只剩一个名字。",
    },
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "intermediate",
  submissionMode: "phased",
  durationWeeks: 3,
  backgroundSetting:
    "学校要把校园改成「植物课堂」。总务处清点出 40 多棵树和灌木还没有名牌，有两块名牌还挂错了。生物组请七年级各小组认领一棵，做一张经得起核对的植物身份证。",
  taskInstructions:
    "分三步完成：先实地观察认领的植物，记下能用来辨认的特征；再对照检索表和资料确定它的名称，写清鉴定依据；最后做成一张带二维码的名牌和一页扫码可读的说明。",
  learningGoals: [
    {
      id: "goal-identify",
      description: "能依据叶、花、果等可观察的特征鉴定一种校园植物，并写出鉴定依据。",
      competencyReferences: [
        { disciplineCode: "biology", competencyCode: "inquiry_practice" },
      ],
    },
    {
      id: "goal-habitat",
      description: "能说明这种植物的形态特征与校园里的光照、水分或土壤有什么关系。",
      competencyReferences: [
        { disciplineCode: "biology", competencyCode: "life_concept" },
        { disciplineCode: "biology", competencyCode: "scientific_thinking" },
      ],
    },
    {
      id: "goal-publish",
      description: "能把鉴定结果做成扫码可读、来源清楚的科普页面。",
      competencyReferences: [
        { disciplineCode: "infoTech", competencyCode: "digital_learning_innovation" },
        { disciplineCode: "infoTech", competencyCode: "information_social_responsibility" },
      ],
    },
    {
      id: "goal-explain",
      description: "能写出一段同学读得懂、又准确的植物说明。",
      competencyReferences: [
        { disciplineCode: "chinese", competencyCode: "language_application" },
      ],
    },
  ],
  phases: [
    {
      name: "实地观察",
      action: "到认领的植物旁观察并记录叶、茎、花或果的特征，拍下能用来鉴定的照片。",
      context:
        "先别急着上网搜名字。那两块挂错的名牌，就是有人只看了一眼叶子。把你看到的写下来，下一步才能对照检索表。",
      support: "1. 写下植物的位置和观察时间\n2. 依次记录叶的形状、边缘、叶脉和排列方式\n3. 如果有花或果，记下颜色、大小和气味\n4. 拍一张叶片特写、一张全株照片\n可以这样写：「叶子是……形，边缘……」「我在……位置观察，这时……」",
      learningGoalIds: ["goal-identify"],
      evidence: [
        { type: "text", description: "带位置与时间的特征观察记录" },
        { type: "image", description: "叶片特写与全株照片" },
      ],
      evaluationFocus: "特征描述具体到能拿去对照检索表。",
      suggestedLessons: 1,
    },
    {
      name: "鉴定与依据",
      action: "对照检索表和至少两份资料确定植物名称，写出每一步的鉴定依据，并说明它为什么适合长在这里。",
      context:
        "生物组老师会逐条核对你们的依据。只写「网上查到是桂花」不算数，要说清是哪几个特征让你排除了别的可能。",
      support: "1. 按检索表一步步走，记下每一步选了哪一项\n2. 找一种容易混淆的相似植物，写出区分它们的特征\n3. 结合它所在位置的光照和水分，说明它长得好或不好的原因\n可以这样写：「因为……，所以排除了……」「它和……很像，但……不同」",
      learningGoalIds: ["goal-identify", "goal-habitat"],
      evidence: [
        { type: "document", description: "鉴定过程记录（检索步骤与资料来源）" },
      ],
      evaluationFocus: "鉴定依据可以复核，能排除相似种。",
      suggestedLessons: 2,
    },
    {
      name: "身份证上墙",
      action: "完成一张带二维码的名牌和一页扫码可读的说明，并请一位没参与的同学试读。",
      context:
        "名牌会挂在植物旁边，路过的同学平均只停一分钟。扫码页面要在手机上看得清，照片和资料来源都要标明。",
      support: "1. 名牌上只放名称、科属和一句最有趣的特征\n2. 说明页分三段：怎么认、为什么长在这里、一个小知识\n3. 每张照片、每份资料都写明来源\n4. 请一位同学试读，记下他没看懂的地方再改\n可以这样写：「认出它的秘诀是……」「它喜欢……，所以长在……」",
      learningGoalIds: ["goal-habitat", "goal-publish", "goal-explain"],
      evidence: [
        { type: "image", description: "扫码说明页面在手机上的截图" },
        { type: "text", description: "试读意见与修改说明" },
      ],
      evaluationFocus: "说明准确好读，来源标注完整。",
      suggestedLessons: 1,
    },
  ],
  rubricDimensions: [
    {
      name: "鉴定依据",
      excellent: "依据多个特征逐步鉴定，并能排除相似种。",
      good: "依据主要特征鉴定，结论正确。",
      pass: "给出了名称和至少一条依据。",
      improve: "只有名称，没有可以核对的依据。",
      learningGoalIds: ["goal-identify"],
    },
    {
      name: "环境联系",
      excellent: "用具体特征解释它与光照、水分或土壤的关系。",
      good: "能说出它适应环境的一个特点。",
      pass: "提到了它的生长位置。",
      improve: "没有联系环境，或解释与观察不符。",
      learningGoalIds: ["goal-habitat"],
    },
    {
      name: "来源与发布",
      excellent: "页面扫码可读，每张照片和每份资料都标明来源。",
      good: "页面可读，主要资料标明了来源。",
      pass: "做出了页面。",
      improve: "页面打不开，或来源缺失。",
      learningGoalIds: ["goal-publish"],
    },
    {
      name: "说明表达",
      excellent: "一分钟能读完，准确又有趣，并采纳了试读意见。",
      good: "表达清楚准确。",
      pass: "能看懂。",
      improve: "术语堆砌，或有明显错误。",
      learningGoalIds: ["goal-explain"],
    },
  ],
};

/** One-shot, already closed. History leads, so the subject mix changes again. */
export const oldObjectsDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "家乡老物件展",
  topic: "物件里的家乡变迁",
  summary:
    "你们是七年级小策展人：从家里找一件有年头的老物件，查清它的来历，为学校「家乡记忆」展写一张展签、做一张展示卡。",
  schoolStage: "MIDDLE",
  grade: 7,
  mainDisciplineCode: "history",
  integratedDisciplineCodes: ["chinese", "arts"],
  disciplineContributions: [
    {
      disciplineCode: "history",
      contribution: "把老物件放回它所在的年代，用口述和资料互相印证它的来历。",
      necessity: "没有史料核对，展签只是家里人的回忆，年份可能记错，也说不清它反映了什么变化。",
    },
    {
      disciplineCode: "chinese",
      contribution: "把访谈和考证写成观众读得进去的展签。",
      necessity: "展签写成流水账，观众看不出这件物件为什么值得停下来看。",
    },
    {
      disciplineCode: "arts",
      contribution: "设计展示卡的拍摄角度与版面，让物件的特征被看见。",
      necessity: "照片拍不清、版面杂乱，再好的故事也没人读。",
    },
  ],
  assignmentType: "practical",
  assignmentSubtype: "visit",
  inquiryDepth: null,
  submissionMode: "once",
  durationWeeks: 2,
  backgroundSetting:
    "学校图书馆要在校庆周办一场「家乡记忆」小展览，展品全部来自同学们家里。馆长只提了一个要求：每件展品的展签都要经得起追问——它是什么年代的、谁用过、说明了家乡哪些变化。",
  taskInstructions:
    "选一件家里的老物件，访谈家人记下它的来历，再用老照片、地方志或博物馆资料核对年代，最后一次性提交一张展签和一张展示卡。",
  learningGoals: [
    {
      id: "goal-source",
      description: "能把口述与至少一份文字或实物资料相互印证，判断物件的大致年代。",
      competencyReferences: [
        { disciplineCode: "history", competencyCode: "historical_evidence" },
        { disciplineCode: "history", competencyCode: "temporal_spatial_concept" },
      ],
    },
    {
      id: "goal-change",
      description: "能借这件物件说明家乡生活的一处具体变化。",
      competencyReferences: [
        { disciplineCode: "history", competencyCode: "historical_interpretation" },
      ],
    },
    {
      id: "goal-label",
      description: "能写出准确、简洁、让人愿意读完的展签。",
      competencyReferences: [
        { disciplineCode: "chinese", competencyCode: "language_application" },
      ],
    },
    {
      id: "goal-display",
      description: "能用拍摄和版面突出物件的关键特征。",
      competencyReferences: [
        { disciplineCode: "arts", competencyCode: "artistic_expression" },
      ],
    },
  ],
  phases: [
    {
      name: "访谈与来历",
      action: "访谈一位家人，记下物件的用途、使用年代和一段相关的故事。",
      context:
        "长辈的记忆很珍贵，但年份常常记混。把原话记下来，标明是谁说的，下一步才能去核对。",
      support: "1. 提前准备三个问题：它是做什么用的、什么时候开始用、后来为什么不用了\n2. 尽量记下原话，写明是谁说的\n3. 拍一张物件的全貌照片\n可以这样写：「奶奶说：『……』」「据爸爸回忆，大约在……年」",
      learningGoalIds: ["goal-source"],
      evidence: [{ type: "text", description: "访谈记录（标明讲述人）" }],
      evaluationFocus: "记录忠实，讲述人清楚。",
      suggestedLessons: 1,
    },
    {
      name: "考证年代",
      action: "找到至少一份资料与口述对照，判断物件的大致年代，并说明它反映了家乡的什么变化。",
      context:
        "馆长会追问「你怎么知道是那个年代的」。家里的说法和资料对不上时，要写出你更相信哪一个、为什么。",
      support: "1. 找一份能对照的资料：老照片、地方志、博物馆说明，或物件上的商标和字样\n2. 把口述和资料并排比较，写出一致和不一致的地方\n3. 用一句话说出它反映的家乡变化\n可以这样写：「口述说……，资料显示……，所以……」「从……到……，说明……」",
      learningGoalIds: ["goal-source", "goal-change"],
      evidence: [{ type: "document", description: "口述与资料对照表" }],
      evaluationFocus: "年代判断有依据，变化说得具体。",
      suggestedLessons: 1,
    },
    {
      name: "展签与展示卡",
      action: "写一张不超过 150 字的展签，配一张展示卡版面。",
      context:
        "观众在每件展品前平均只停半分钟。展签要让人一眼知道它是什么、为什么值得看。",
      support: "1. 第一句写它是什么、什么年代\n2. 第二句写它背后的一个故事或细节\n3. 最后一句点出它反映的变化\n4. 拍一张突出关键特征的特写，排进展示卡\n可以这样写：「这台……是……年代的……」「它见证了……」",
      learningGoalIds: ["goal-change", "goal-label", "goal-display"],
      evidence: [
        { type: "text", description: "展签定稿" },
        { type: "image", description: "展示卡版面" },
      ],
      evaluationFocus: "展签准确简洁，版面突出重点。",
      suggestedLessons: 1,
    },
  ],
  rubricDimensions: [
    {
      name: "史料互证",
      excellent: "口述与资料互相印证，不一致的地方有判断理由。",
      good: "有资料支持年代判断。",
      pass: "给出了年代和来源。",
      improve: "年代只凭猜测，没有依据。",
      learningGoalIds: ["goal-source"],
    },
    {
      name: "变迁解释",
      excellent: "借物件说清一处具体变化及其原因。",
      good: "说出了一处变化。",
      pass: "提到了过去和现在不一样。",
      improve: "没有联系家乡的变化。",
      learningGoalIds: ["goal-change"],
    },
    {
      name: "展签表达",
      excellent: "简洁准确，有细节，观众愿意读完。",
      good: "准确清楚。",
      pass: "信息基本完整。",
      improve: "冗长，或有事实错误。",
      learningGoalIds: ["goal-label"],
    },
    {
      name: "展示设计",
      excellent: "拍摄与版面突出关键特征，一眼可读。",
      good: "照片清楚，版面整齐。",
      pass: "有照片和文字。",
      improve: "照片不清，或版面杂乱。",
      learningGoalIds: ["goal-display"],
    },
  ],
};

/** An editing draft for a primary class, so the workspace is not all grade 7. */
export const libraryCornerDemoV3: ActivityContentV3 = {
  schemaVersion: 3,
  title: "班级图书角借阅改进",
  topic: "图书角的借阅数据与管理",
  summary:
    "你们是四年级图书角管理员：用两周的借阅数据找出图书角最大的麻烦，定一条新规则，并在班里试行一周。",
  schoolStage: "PRIMARY",
  grade: 4,
  mainDisciplineCode: "math",
  integratedDisciplineCodes: ["chinese", "labor"],
  disciplineContributions: [
    {
      disciplineCode: "math",
      contribution: "把借阅登记表整理成统计表和条形统计图，找出哪类书最受欢迎、哪里最容易出问题。",
      necessity: "不看数据，只能凭感觉说「书总是乱」，改规则也说不出理由。",
    },
    {
      disciplineCode: "chinese",
      contribution: "写出全班读得懂、记得住的新规则。",
      necessity: "规则写不清，同学们就不会照着做。",
    },
    {
      disciplineCode: "labor",
      contribution: "分工整理书架、修补破损图书，并按新规则轮值一周。",
      necessity: "规则只贴在墙上没人动手，图书角不会变好。",
    },
  ],
  assignmentType: "inquiry",
  assignmentSubtype: "survey",
  inquiryDepth: "basic",
  submissionMode: "phased",
  durationWeeks: 3,
  backgroundSetting:
    "四年级（2）班的图书角有 120 多本书，可最近总有人找不到想看的书，还有 9 本借出去一个月没还。班主任说：图书角交给你们管，先用数据说清问题在哪。",
  taskInstructions:
    "分三步完成：先把两周的借阅登记表整理成统计图，再找出最大的问题、写一条新规则，最后按新规则轮值管理一周，比较前后的变化。",
  learningGoals: [
    {
      id: "goal-data",
      description: "能整理借阅登记表，用条形统计图呈现借阅情况并读出信息。",
      competencyReferences: [
        { disciplineCode: "math", competencyCode: "data_awareness" },
      ],
    },
    {
      id: "goal-rule",
      description: "能根据数据提出一条清楚、做得到的图书角新规则。",
      competencyReferences: [
        { disciplineCode: "chinese", competencyCode: "language_application" },
        { disciplineCode: "math", competencyCode: "reasoning_awareness" },
      ],
    },
    {
      id: "goal-practice",
      description: "能按分工整理书架、修补图书，并坚持轮值。",
      competencyReferences: [
        { disciplineCode: "labor", competencyCode: "labor_ability" },
        { disciplineCode: "labor", competencyCode: "labor_habits_quality" },
      ],
    },
  ],
  phases: [
    {
      name: "数一数",
      action: "把两周的借阅登记表整理成一张统计表，再画成条形统计图。",
      context:
        "登记表上写得密密麻麻，班主任看不出名堂。先把数据理清楚，问题才会自己露出来。",
      support: "1. 按书的种类（故事、科普、漫画、其他）数一数各借了多少次\n2. 填进统计表，再画成条形统计图\n3. 写下你从图上看出的两件事\n可以这样写：「借得最多的是……，有……次」「……类几乎没人借」",
      learningGoalIds: ["goal-data"],
      evidence: [
        { type: "image", description: "条形统计图照片" },
        { type: "text", description: "从图上读出的两条信息" },
      ],
      evaluationFocus: "数据整理准确，读出的信息在图上找得到。",
      suggestedLessons: 1,
    },
    {
      name: "定规则",
      action: "找出图书角最大的一个问题，写一条新规则，说明它为什么能解决这个问题。",
      context:
        "规则要贴在图书角，全班都要照着做。规则太多没人记得住，只写一条最要紧的。",
      support: "1. 从统计图和逾期记录里选出最大的问题\n2. 写一条规则：谁、什么时候、怎么做\n3. 用一个数据说明为什么需要这条规则\n可以这样写：「因为……，所以我们规定……」",
      learningGoalIds: ["goal-rule"],
      evidence: [{ type: "text", description: "新规则与理由" }],
      evaluationFocus: "规则对准数据里的问题，写得清楚、做得到。",
      suggestedLessons: 1,
    },
    {
      name: "试行一周",
      action: "按新规则分工轮值一周，整理书架、修补破损图书，再比较试行前后的借阅和归还情况。",
      context: "试行结束后，你们要向全班汇报：新规则到底有没有用。",
      support: "1. 排一张轮值表，写清每天谁负责\n2. 每天记下借出和归还的本数\n3. 一周后和试行前比一比，写出变化\n可以这样写：「试行前……，试行后……」「我负责……，做到了……」",
      learningGoalIds: ["goal-data", "goal-practice"],
      evidence: [
        { type: "document", description: "轮值表与一周记录" },
        { type: "confirm", description: "教师确认已完成轮值" },
      ],
      evaluationFocus: "坚持轮值，前后对比有数据。",
      suggestedLessons: 2,
    },
  ],
  rubricDimensions: [
    {
      name: "数据整理",
      excellent: "统计表和条形统计图准确，能读出有用的信息。",
      good: "统计图基本准确。",
      pass: "完成了统计表。",
      improve: "数据有明显错误，或没有整理。",
      learningGoalIds: ["goal-data"],
    },
    {
      name: "规则设计",
      excellent: "规则对准问题，清楚做得到，有数据作理由。",
      good: "规则清楚，有理由。",
      pass: "写出了一条规则。",
      improve: "规则含糊，或与问题无关。",
      learningGoalIds: ["goal-rule"],
    },
    {
      name: "动手管理",
      excellent: "按分工坚持轮值，书架整洁，破损图书得到修补。",
      good: "完成了大部分轮值。",
      pass: "参与了轮值。",
      improve: "很少参与轮值。",
      learningGoalIds: ["goal-practice"],
    },
    {
      name: "前后对比",
      excellent: "用数据清楚说明新规则带来的变化。",
      good: "能说出一处变化。",
      pass: "记录了试行情况。",
      improve: "没有比较前后的变化。",
      learningGoalIds: ["goal-data", "goal-practice"],
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
      support: "1. 确定测点：每个座位测哪个位置\n2. 规定时段和天气条件\n3. 写明仪器离桌面多高、朝向哪里\n可以这样写：「我们在……时段测量，仪器距桌面……厘米，朝向……」",
      learningGoalIds: ["goal-optics", "goal-toolchain"],
      evidence: [{ type: "text", description: "带控制条件的测量方案" }],
      evaluationFocus: "条件写清楚，重测能得到可比结果。",
      suggestedLessons: 1,
    },
    {
      name: "实测与分布",
      action: "按方案实测全部座位并绘制照度分布图。",
      context: "四十多个座位要在同一节课内测完，否则光照已经变了。",
      support: "1. 按座位编号图逐个测量\n2. 把读数填进数据录入表\n3. 用不同颜色把照度画成分布图\n可以这样写：「照度最低的区域在……，只有……勒克斯」",
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
      support: "1. 从分布图里圈出不达标的区域\n2. 给每个区域写一条措施，标明施工位置\n3. 写出预期照度和大致造价\n可以这样写：「……区域照度只有……，建议在……加装……」",
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
  campusPlantsDemoV3,
  oldObjectsDemoV3,
  libraryCornerDemoV3,
  classroomDaylightDemoV3,
] as const;
