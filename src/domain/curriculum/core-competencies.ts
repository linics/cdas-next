import type { DisciplineCode, SchoolStage } from "../activity/activity-content";

/**
 * The only selectable catalogue of subject core competencies for a v3 task
 * book.  This is deliberately a small, versioned registry rather than a
 * model prompt convention: a task can cite only an entry that is published
 * here and whose official source is present in the local corpus.
 *
 * 综合实践活动 remains selectable as an activity discipline, but has no entry
 * here until an official standard is added to the corpus.  It must therefore
 * never be used to manufacture a competency reference.
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

export const coreCompetencyRegistry = [
  { disciplineCode: "politics", code: "political_identity", name: "政治认同", interpretation: "形成正确价值判断与公共责任意识。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "politics-standard-2022", sourceLocator: "三、课程目标" },
  { disciplineCode: "politics", code: "moral_cultivation", name: "道德修养", interpretation: "在真实生活中辨析、践行道德规范。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "politics-standard-2022" },
  { disciplineCode: "politics", code: "rule_of_law_concept", name: "法治观念", interpretation: "理解规则与权利义务，并能依法参与生活。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "politics-standard-2022" },
  { disciplineCode: "politics", code: "sound_personality", name: "健全人格", interpretation: "发展自尊自信、理性平和、积极向上的品格。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "politics-standard-2022" },
  { disciplineCode: "politics", code: "sense_of_responsibility", name: "责任意识", interpretation: "愿意对自我、他人、社会与国家承担责任。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "politics-standard-2022" },

  { disciplineCode: "chinese", code: "cultural_confidence", name: "文化自信", interpretation: "认同中华文化并尊重文化多样性。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "chinese-standard-2022" },
  { disciplineCode: "chinese", code: "language_application", name: "语言运用", interpretation: "在真实语境中积累、梳理并运用语言文字。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "chinese-standard-2022" },
  { disciplineCode: "chinese", code: "thinking_ability", name: "思维能力", interpretation: "观察、比较、分析、推断并有理有据地表达。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "chinese-standard-2022" },
  { disciplineCode: "chinese", code: "aesthetic_creation", name: "审美创造", interpretation: "感受、理解、欣赏、评价并创造美。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "chinese-standard-2022" },

  // 数学按学段采用课程标准列出的不同核心素养，不以三句总述替代。
  { disciplineCode: "math", code: "number_sense", name: "数感", interpretation: "在真实情境中理解数量关系和数的意义。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "quantity_sense", name: "量感", interpretation: "感知量的属性、大小与度量关系。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "symbolic_awareness", name: "符号意识", interpretation: "理解并恰当使用数学符号表达关系。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "operation_ability", name: "运算能力", interpretation: "选择合理方法进行准确、有依据的运算。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "geometric_intuition", name: "几何直观", interpretation: "借助图形和空间想象理解、解决问题。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "spatial_concept", name: "空间观念", interpretation: "认识图形位置、变化及其空间关系。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "reasoning_awareness", name: "推理意识", interpretation: "在探索中发现规律并作出有根据的判断。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "data_awareness", name: "数据意识", interpretation: "从数据中发现信息、提出问题和作出解释。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "model_awareness", name: "模型意识", interpretation: "用数学关系描述现实问题并检验结果。", schoolStages: primaryOnly, gradeRange: [1, 6], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "abstraction_ability", name: "抽象能力", interpretation: "从具体情境中抽取数量、图形和关系。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "operation_ability_middle", name: "运算能力", interpretation: "选择适切算法并解释运算过程与结果。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "geometric_intuition_middle", name: "几何直观", interpretation: "利用图形直观、空间想象分析问题。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "spatial_concept_middle", name: "空间观念", interpretation: "从空间形式和关系理解现实世界。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "quantitative_sense", name: "量感", interpretation: "把握量、数量级及度量关系的合理性。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "reasoning_ability", name: "推理能力", interpretation: "运用归纳、演绎等推理形成可信结论。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "data_concept", name: "数据观念", interpretation: "借助数据分析问题，并评估结论的合理性。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "model_concept", name: "模型观念", interpretation: "建立、求解和检验数学模型。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "application_awareness", name: "应用意识", interpretation: "主动用数学知识和方法解决真实问题。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },
  { disciplineCode: "math", code: "innovation_awareness", name: "创新意识", interpretation: "在问题解决中提出新想法并尝试改进。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "math-standard-2022" },

  { disciplineCode: "english", code: "language_ability", name: "语言能力", interpretation: "在真实语境中理解和表达意义。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "english-standard-2022" },
  { disciplineCode: "english", code: "cultural_awareness", name: "文化意识", interpretation: "理解中外文化，形成开放包容意识。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "english-standard-2022" },
  { disciplineCode: "english", code: "thinking_quality", name: "思维品质", interpretation: "比较、分析、推理并批判性地处理信息。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "english-standard-2022" },
  { disciplineCode: "english", code: "learning_ability", name: "学习能力", interpretation: "主动规划、监控、调整并反思语言学习。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "english-standard-2022" },

  { disciplineCode: "science", code: "scientific_concept", name: "科学观念", interpretation: "理解自然现象与规律，形成科学解释。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "science-standard-2022" },
  { disciplineCode: "science", code: "scientific_thinking", name: "科学思维", interpretation: "基于证据进行比较、推理、建模与论证。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "science-standard-2022" },
  { disciplineCode: "science", code: "inquiry_practice", name: "探究实践", interpretation: "提出问题、设计探究、获取证据并交流改进。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "science-standard-2022" },
  { disciplineCode: "science", code: "responsible_attitude", name: "态度责任", interpretation: "尊重证据，关注科学、技术、社会与环境。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "science-standard-2022" },

  { disciplineCode: "history", code: "historical_materialism", name: "唯物史观", interpretation: "运用唯物史观认识历史发展。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "history-standard-2022" },
  { disciplineCode: "history", code: "temporal_spatial_concept", name: "时空观念", interpretation: "在特定时间与空间联系中理解历史。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "history-standard-2022" },
  { disciplineCode: "history", code: "historical_evidence", name: "史料实证", interpretation: "辨析、运用史料形成有依据的认识。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "history-standard-2022" },
  { disciplineCode: "history", code: "historical_interpretation", name: "历史解释", interpretation: "以史料为依据解释历史问题。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "history-standard-2022" },
  { disciplineCode: "history", code: "patriotism", name: "家国情怀", interpretation: "形成对国家、民族与人类的责任担当。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "history-standard-2022" },

  { disciplineCode: "geography", code: "human_earth_coordination", name: "人地协调观", interpretation: "协调人类活动与地理环境的关系。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "geography-standard-2022" },
  { disciplineCode: "geography", code: "comprehensive_thinking", name: "综合思维", interpretation: "综合分析地理要素及其相互作用。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "geography-standard-2022" },
  { disciplineCode: "geography", code: "regional_cognition", name: "区域认知", interpretation: "从区域视角认识地理环境与人地关系。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "geography-standard-2022" },
  { disciplineCode: "geography", code: "geographical_practice", name: "地理实践力", interpretation: "在真实情境中观察、调查、分析和行动。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "geography-standard-2022" },

  { disciplineCode: "physics", code: "physical_concept", name: "物理观念", interpretation: "形成关于物质、运动、相互作用、能量等的观念。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "physics-standard-2022" },
  { disciplineCode: "physics", code: "scientific_thinking", name: "科学思维", interpretation: "运用模型、推理、论证等方式解决物理问题。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "physics-standard-2022" },
  { disciplineCode: "physics", code: "scientific_inquiry", name: "科学探究", interpretation: "提出问题、设计实验、收集证据并交流。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "physics-standard-2022" },
  { disciplineCode: "physics", code: "scientific_attitude_responsibility", name: "科学态度与责任", interpretation: "尊重事实，关注科学技术与社会。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "physics-standard-2022" },

  { disciplineCode: "chemistry", code: "chemical_concept", name: "化学观念", interpretation: "形成关于物质、反应与变化的化学观念。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "chemistry-standard-2022" },
  { disciplineCode: "chemistry", code: "scientific_thinking", name: "科学思维", interpretation: "运用证据、模型和实验分析化学问题。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "chemistry-standard-2022" },
  { disciplineCode: "chemistry", code: "scientific_inquiry_practice", name: "科学探究与实践", interpretation: "经历提出问题、探究、解释与改进的过程。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "chemistry-standard-2022" },
  { disciplineCode: "chemistry", code: "scientific_attitude_responsibility", name: "科学态度与责任", interpretation: "遵循科学伦理，关注化学与社会环境。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "chemistry-standard-2022" },

  { disciplineCode: "biology", code: "life_concept", name: "生命观念", interpretation: "形成认识生命现象与规律的基本观念。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "biology-standard-2022" },
  { disciplineCode: "biology", code: "scientific_thinking", name: "科学思维", interpretation: "运用归纳、演绎、模型和系统思维分析生命问题。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "biology-standard-2022" },
  { disciplineCode: "biology", code: "inquiry_practice", name: "探究实践", interpretation: "开展观察、实验、调查等活动，形成证据。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "biology-standard-2022" },
  { disciplineCode: "biology", code: "attitude_responsibility", name: "态度责任", interpretation: "珍爱生命，关注健康、生态与社会责任。", schoolStages: middleOnly, gradeRange: [7, 9], sourceId: "biology-standard-2022" },

  { disciplineCode: "infoTech", code: "information_awareness", name: "信息意识", interpretation: "敏锐感知信息价值与风险，并作出合宜判断。", schoolStages: bothStages, gradeRange: [3, 8], sourceId: "info-tech-standard-2022" },
  { disciplineCode: "infoTech", code: "computational_thinking", name: "计算思维", interpretation: "抽象、分解、建模并设计算法解决问题。", schoolStages: bothStages, gradeRange: [3, 8], sourceId: "info-tech-standard-2022" },
  { disciplineCode: "infoTech", code: "digital_learning_innovation", name: "数字化学习与创新", interpretation: "运用数字工具学习、协作、创造和表达。", schoolStages: bothStages, gradeRange: [3, 8], sourceId: "info-tech-standard-2022" },
  { disciplineCode: "infoTech", code: "information_social_responsibility", name: "信息社会责任", interpretation: "遵守信息伦理与法规，维护网络安全。", schoolStages: bothStages, gradeRange: [3, 8], sourceId: "info-tech-standard-2022" },

  { disciplineCode: "labor", code: "labor_concept", name: "劳动观念", interpretation: "尊重劳动、崇尚劳动，理解劳动创造价值。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "labor-standard-2022" },
  { disciplineCode: "labor", code: "labor_ability", name: "劳动能力", interpretation: "掌握劳动知识、技能与问题解决能力。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "labor-standard-2022" },
  { disciplineCode: "labor", code: "labor_habits_quality", name: "劳动习惯和品质", interpretation: "形成勤俭、认真、负责、合作的劳动品质。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "labor-standard-2022" },
  { disciplineCode: "labor", code: "labor_spirit", name: "劳动精神", interpretation: "弘扬崇尚劳动、热爱劳动、辛勤劳动的精神。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "labor-standard-2022" },

  { disciplineCode: "arts", code: "aesthetic_perception", name: "审美感知", interpretation: "感受、发现和理解艺术与生活中的美。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "arts-standard-2022" },
  { disciplineCode: "arts", code: "artistic_expression", name: "艺术表现", interpretation: "运用媒介、技法和形式表达情感与思想。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "arts-standard-2022" },
  { disciplineCode: "arts", code: "creative_practice", name: "创意实践", interpretation: "进行构思、设计、制作和改进。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "arts-standard-2022" },
  { disciplineCode: "arts", code: "cultural_understanding", name: "文化理解", interpretation: "理解艺术的文化语境与价值。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "arts-standard-2022" },

  { disciplineCode: "sports", code: "motor_ability", name: "运动能力", interpretation: "掌握运动技能，并能在情境中运用。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "sports-standard-2022" },
  { disciplineCode: "sports", code: "health_behavior", name: "健康行为", interpretation: "形成健康意识、行为习惯与安全应对能力。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "sports-standard-2022" },
  { disciplineCode: "sports", code: "sports_morality", name: "体育品德", interpretation: "遵守规则、尊重他人，体现公平合作与责任。", schoolStages: bothStages, gradeRange: [1, 9], sourceId: "sports-standard-2022" },
] as const satisfies readonly CoreCompetencyDefinition[];

export function findCoreCompetency(
  disciplineCode: DisciplineCode,
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
      (stage === undefined || (item.schoolStages as readonly SchoolStage[]).includes(stage)) &&
      (grade === undefined || (grade >= item.gradeRange[0] && grade <= item.gradeRange[1])),
  );
}

/** All first-round competencies originate in the official course-target
 * chapter unless a more specific chapter was explicitly registered. */
export function coreCompetencySourceLocator(
  competency: CoreCompetencyDefinition,
): string {
  return competency.sourceLocator ?? "三、课程目标";
}
