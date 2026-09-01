import type { DisciplineCode, SchoolStage } from "../activity/activity-content";

/**
 * The only selectable catalogue of subject core competencies for a v3 task
 * book. It is a small versioned registry rather than a prompt convention: a
 * task may cite an entry only if it is published here and its official
 * standard is present in the local corpus, so every citation can be opened.
 *
 * 综合实践活动 stays selectable as an activity discipline but has no entry
 * here, because the 2022 package ships no separate standard for it. It can
 * therefore never be used to manufacture a competency reference.
 *
 * Grade ranges are the standards' own scope, not a convenience: 信息科技 runs
 * 3-8, and 数学 publishes different competencies for each school stage.
 */
export type CoreCompetencyDefinition = Readonly<{
  disciplineCode: Exclude<DisciplineCode, "integrated">;
  code: string;
  name: string;
  interpretation: string;
  schoolStages: readonly SchoolStage[];
  gradeRange: readonly [number, number];
  sourceId: string;
  sourceLocator?: string;
}>;

const bothStages = ["PRIMARY", "MIDDLE"] as const satisfies readonly SchoolStage[];
const primaryOnly = ["PRIMARY"] as const satisfies readonly SchoolStage[];
const middleOnly = ["MIDDLE"] as const satisfies readonly SchoolStage[];

type CompetencyRow = readonly [code: string, name: string, interpretation: string];

function group(
  disciplineCode: CoreCompetencyDefinition["disciplineCode"],
  schoolStages: readonly SchoolStage[],
  gradeRange: readonly [number, number],
  sourceId: string,
  rows: readonly CompetencyRow[],
): readonly CoreCompetencyDefinition[] {
  return rows.map(([code, name, interpretation]) => ({
    disciplineCode,
    code,
    name,
    interpretation,
    schoolStages,
    gradeRange,
    sourceId,
  }));
}

export const coreCompetencyRegistry: readonly CoreCompetencyDefinition[] = [
  // 道德与法治
  ...group("politics", bothStages, [1, 9], "politics-standard-2022", [
    ["political_identity", "政治认同", "形成正确价值判断与公共责任意识。"],
    ["moral_cultivation", "道德修养", "在真实生活中辨析、践行道德规范。"],
    ["rule_of_law_concept", "法治观念", "理解规则与权利义务，并能依法参与生活。"],
    ["sound_personality", "健全人格", "发展自尊自信、理性平和、积极向上的品格。"],
    ["sense_of_responsibility", "责任意识", "愿意对自我、他人、社会与国家承担责任。"],
  ]),

  // 语文
  ...group("chinese", bothStages, [1, 9], "chinese-standard-2022", [
    ["cultural_confidence", "文化自信", "认同中华文化并尊重文化多样性。"],
    ["language_application", "语言运用", "在真实语境中积累、梳理并运用语言文字。"],
    ["thinking_ability", "思维能力", "观察、比较、分析、推断并有理有据地表达。"],
    ["aesthetic_creation", "审美创造", "感受、理解、欣赏、评价并创造美。"],
  ]),

  // 数学（小学）
  ...group("math", primaryOnly, [1, 6], "math-standard-2022", [
    ["number_sense", "数感", "在真实情境中理解数量关系和数的意义。"],
    ["quantity_sense", "量感", "感知量的属性、大小与度量关系。"],
    ["symbolic_awareness", "符号意识", "理解并恰当使用数学符号表达关系。"],
    ["operation_ability", "运算能力", "选择合理方法进行准确、有依据的运算。"],
    ["geometric_intuition", "几何直观", "借助图形和空间想象理解、解决问题。"],
    ["spatial_concept", "空间观念", "认识图形位置、变化及其空间关系。"],
    ["reasoning_awareness", "推理意识", "在探索中发现规律并作出有根据的判断。"],
    ["data_awareness", "数据意识", "从数据中发现信息、提出问题和作出解释。"],
    ["model_awareness", "模型意识", "用数学关系描述现实问题并检验结果。"],
  ]),

  // 数学（初中）
  ...group("math", middleOnly, [7, 9], "math-standard-2022", [
    ["abstraction_ability", "抽象能力", "从具体情境中抽取数量、图形和关系。"],
    ["operation_ability_middle", "运算能力", "选择适切算法并解释运算过程与结果。"],
    ["geometric_intuition_middle", "几何直观", "利用图形直观、空间想象分析问题。"],
    ["spatial_concept_middle", "空间观念", "从空间形式和关系理解现实世界。"],
    ["quantitative_sense", "量感", "把握量、数量级及度量关系的合理性。"],
    ["reasoning_ability", "推理能力", "运用归纳、演绎等推理形成可信结论。"],
    ["data_concept", "数据观念", "借助数据分析问题，并评估结论的合理性。"],
    ["model_concept", "模型观念", "建立、求解和检验数学模型。"],
    ["application_awareness", "应用意识", "主动用数学知识和方法解决真实问题。"],
    ["innovation_awareness", "创新意识", "在问题解决中提出新想法并尝试改进。"],
  ]),

  // 英语
  ...group("english", bothStages, [1, 9], "english-standard-2022", [
    ["language_ability", "语言能力", "在真实语境中理解和表达意义。"],
    ["cultural_awareness", "文化意识", "理解中外文化，形成开放包容意识。"],
    ["thinking_quality", "思维品质", "比较、分析、推理并批判性地处理信息。"],
    ["learning_ability", "学习能力", "主动规划、监控、调整并反思语言学习。"],
  ]),

  // 科学
  ...group("science", bothStages, [1, 9], "science-standard-2022", [
    ["scientific_concept", "科学观念", "理解自然现象与规律，形成科学解释。"],
    ["scientific_thinking", "科学思维", "基于证据进行比较、推理、建模与论证。"],
    ["inquiry_practice", "探究实践", "提出问题、设计探究、获取证据并交流改进。"],
    ["responsible_attitude", "态度责任", "尊重证据，关注科学、技术、社会与环境。"],
  ]),

  // 历史
  ...group("history", middleOnly, [7, 9], "history-standard-2022", [
    ["historical_materialism", "唯物史观", "运用唯物史观认识历史发展。"],
    ["temporal_spatial_concept", "时空观念", "在特定时间与空间联系中理解历史。"],
    ["historical_evidence", "史料实证", "辨析、运用史料形成有依据的认识。"],
    ["historical_interpretation", "历史解释", "以史料为依据解释历史问题。"],
    ["patriotism", "家国情怀", "形成对国家、民族与人类的责任担当。"],
  ]),

  // 地理
  ...group("geography", middleOnly, [7, 9], "geography-standard-2022", [
    ["human_earth_coordination", "人地协调观", "协调人类活动与地理环境的关系。"],
    ["comprehensive_thinking", "综合思维", "综合分析地理要素及其相互作用。"],
    ["regional_cognition", "区域认知", "从区域视角认识地理环境与人地关系。"],
    ["geographical_practice", "地理实践力", "在真实情境中观察、调查、分析和行动。"],
  ]),

  // 物理
  ...group("physics", middleOnly, [7, 9], "physics-standard-2022", [
    ["physical_concept", "物理观念", "形成关于物质、运动、相互作用、能量等的观念。"],
    ["scientific_thinking", "科学思维", "运用模型、推理、论证等方式解决物理问题。"],
    ["scientific_inquiry", "科学探究", "提出问题、设计实验、收集证据并交流。"],
    ["scientific_attitude_responsibility", "科学态度与责任", "尊重事实，关注科学技术与社会。"],
  ]),

  // 化学
  ...group("chemistry", middleOnly, [7, 9], "chemistry-standard-2022", [
    ["chemical_concept", "化学观念", "形成关于物质、反应与变化的化学观念。"],
    ["scientific_thinking", "科学思维", "运用证据、模型和实验分析化学问题。"],
    ["scientific_inquiry_practice", "科学探究与实践", "经历提出问题、探究、解释与改进的过程。"],
    ["scientific_attitude_responsibility", "科学态度与责任", "遵循科学伦理，关注化学与社会环境。"],
  ]),

  // 生物学
  ...group("biology", middleOnly, [7, 9], "biology-standard-2022", [
    ["life_concept", "生命观念", "形成认识生命现象与规律的基本观念。"],
    ["scientific_thinking", "科学思维", "运用归纳、演绎、模型和系统思维分析生命问题。"],
    ["inquiry_practice", "探究实践", "开展观察、实验、调查等活动，形成证据。"],
    ["attitude_responsibility", "态度责任", "珍爱生命，关注健康、生态与社会责任。"],
  ]),

  // 信息科技
  ...group("infoTech", bothStages, [3, 8], "info-tech-standard-2022", [
    ["information_awareness", "信息意识", "敏锐感知信息价值与风险，并作出合宜判断。"],
    ["computational_thinking", "计算思维", "抽象、分解、建模并设计算法解决问题。"],
    ["digital_learning_innovation", "数字化学习与创新", "运用数字工具学习、协作、创造和表达。"],
    ["information_social_responsibility", "信息社会责任", "遵守信息伦理与法规，维护网络安全。"],
  ]),

  // 劳动
  ...group("labor", bothStages, [1, 9], "labor-standard-2022", [
    ["labor_concept", "劳动观念", "尊重劳动、崇尚劳动，理解劳动创造价值。"],
    ["labor_ability", "劳动能力", "掌握劳动知识、技能与问题解决能力。"],
    ["labor_habits_quality", "劳动习惯和品质", "形成勤俭、认真、负责、合作的劳动品质。"],
    ["labor_spirit", "劳动精神", "弘扬崇尚劳动、热爱劳动、辛勤劳动的精神。"],
  ]),

  // 艺术
  ...group("arts", bothStages, [1, 9], "arts-standard-2022", [
    ["aesthetic_perception", "审美感知", "感受、发现和理解艺术与生活中的美。"],
    ["artistic_expression", "艺术表现", "运用媒介、技法和形式表达情感与思想。"],
    ["creative_practice", "创意实践", "进行构思、设计、制作和改进。"],
    ["cultural_understanding", "文化理解", "理解艺术的文化语境与价值。"],
  ]),

  // 体育与健康
  ...group("sports", bothStages, [1, 9], "sports-standard-2022", [
    ["motor_ability", "运动能力", "掌握运动技能，并能在情境中运用。"],
    ["health_behavior", "健康行为", "形成健康意识、行为习惯与安全应对能力。"],
    ["sports_morality", "体育品德", "遵守规则、尊重他人，体现公平合作与责任。"],
  ]),
];

export function findCoreCompetency(
  disciplineCode: string,
  code: string,
): CoreCompetencyDefinition | undefined {
  return coreCompetencyRegistry.find(
    (item) => item.disciplineCode === disciplineCode && item.code === code,
  );
}

export function coreCompetenciesForDiscipline(
  disciplineCode: DisciplineCode,
  stage?: SchoolStage,
  grade?: number,
): readonly CoreCompetencyDefinition[] {
  return coreCompetencyRegistry.filter(
    (item) =>
      item.disciplineCode === disciplineCode &&
      (stage === undefined ||
        (item.schoolStages as readonly SchoolStage[]).includes(stage)) &&
      (grade === undefined ||
        (grade >= item.gradeRange[0] && grade <= item.gradeRange[1])),
  );
}

/**
 * Every first-round competency comes from its standard's course-target
 * chapter unless a more specific locator was registered.
 */
export function coreCompetencySourceLocator(
  competency: CoreCompetencyDefinition,
): string {
  return competency.sourceLocator ?? "三、课程目标";
}
