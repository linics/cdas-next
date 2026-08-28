import "server-only";

import { randomUUID } from "node:crypto";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  hasToolCall,
  isStepCount,
  streamText,
  toUIMessageStream,
  type LanguageModel,
} from "ai";
import type { AppUser, PrismaClient } from "../../generated/prisma/client";
import {
  AuthenticationError,
  getCurrentActor,
} from "../auth/current-actor";
import type { CommandContext } from "../commands/command-context";
import { getDatabaseClient } from "../db/client";
import {
  finishActivityAssistantRun,
  startActivityAssistantRun,
} from "./agent-run-lifecycle";
import {
  ActivityAssistantConfigError,
  getActivityAssistantConfig,
  type ActivityAssistantConfig,
} from "./assistant-config";
import {
  createDeepSeekModel,
  deepSeekActivityAssistantProviderOptions,
} from "./deepseek-provider";
import {
  createActivityAssistantTools,
  activityAssistantMessageValidationTools,
} from "./activity-assistant-tools";
import {
  type ActivityAssistantMessage,
  ActivityAssistantRequestError,
  getActivityAssistantKnowledgeLedger,
  parseActivityAssistantRequest,
} from "./activity-assistant-request";
import {
  getTeacherAssistantClassrooms,
  type AssistantClassroom,
} from "./teacher-assistant-context";

type StartedRun = Awaited<ReturnType<typeof startActivityAssistantRun>>;

export type ActivityAssistantHandlerDependencies = Readonly<{
  getDatabase: () => PrismaClient;
  authenticate: (database: PrismaClient) => Promise<AppUser>;
  getConfig: () => ActivityAssistantConfig;
  createModel: (config: ActivityAssistantConfig) => LanguageModel;
  createTools: typeof createActivityAssistantTools;
  getClassrooms: (
    database: PrismaClient,
    context: CommandContext,
  ) => Promise<AssistantClassroom[]>;
  startRun: typeof startActivityAssistantRun;
  finishRun: typeof finishActivityAssistantRun;
  createTraceId: () => string;
  clock: () => Date;
}>;

const defaultDependencies: ActivityAssistantHandlerDependencies = {
  getDatabase: getDatabaseClient,
  authenticate: getCurrentActor,
  getConfig: getActivityAssistantConfig,
  createModel: createDeepSeekModel,
  createTools: createActivityAssistantTools,
  getClassrooms: getTeacherAssistantClassrooms,
  startRun: startActivityAssistantRun,
  finishRun: finishActivityAssistantRun,
  createTraceId: randomUUID,
  clock: () => new Date(),
};

function jsonError(status: number, code: string): Response {
  return Response.json(
    { error: code },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

const AGENT_RUN_FAILURE_CODE_MAX = 120;

export function sanitizeActivityAssistantFailureCode(code: string): string {
  return code.replace(/[^A-Z0-9_]/g, "_").slice(0, AGENT_RUN_FAILURE_CODE_MAX);
}

function sdkToolErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    const cause =
      error.cause === undefined ? "" : ` ${sdkToolErrorText(error.cause)}`;
    return `${error.toString()}${cause}`;
  }
  if (error && typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return "";
    }
  }
  return "";
}

function firstZodIssuePath(value: unknown): string[] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { issues?: unknown; cause?: unknown };
  if (Array.isArray(record.issues) && record.issues.length > 0) {
    const first = record.issues[0];
    if (first && typeof first === "object" && "path" in first) {
      const path = (first as { path: unknown }).path;
      if (Array.isArray(path) && path.length > 0) {
        return path.map(String);
      }
    }
  }
  return firstZodIssuePath(record.cause);
}

function firstZodIssuePathFromText(text: string): string[] | null {
  const match = /"path"\s*:\s*\[([^\]]*)\]/.exec(text);
  if (!match) {
    return null;
  }
  const parts = [...match[1].matchAll(/"(?:\\.|[^"\\])*"|-?\d+/g)].map((item) => {
    const token = item[0];
    if (token.startsWith('"')) {
      try {
        return JSON.parse(token) as string;
      } catch {
        return token.slice(1, -1);
      }
    }
    return token;
  });
  return parts.length > 0 ? parts : null;
}

function isJsonParseToolError(text: string): boolean {
  return /AI_JSONParseError|JSON parsing failed|JSONParseError|Unexpected end of JSON|Unterminated string/i.test(
    text,
  );
}

export function activityAssistantSdkToolFailureCode(
  content: ReadonlyArray<{ type: string; error?: unknown }>,
): string | null {
  const toolError = content.find((part) => part.type === "tool-error");
  if (!toolError) {
    return null;
  }
  const text = sdkToolErrorText(toolError.error);
  const path =
    firstZodIssuePath(toolError.error) ?? firstZodIssuePathFromText(text);
  const suffix = path
    ? path.join("_").toUpperCase()
    : isJsonParseToolError(text)
      ? "JSON_PARSE"
      : "";
  const code = suffix
    ? `TOOL_INPUT_OR_EXECUTION_FAILED_${suffix}`
    : "TOOL_INPUT_OR_EXECUTION_FAILED";
  return sanitizeActivityAssistantFailureCode(code);
}

function classroomInstructions(classrooms: AssistantClassroom[]): string {
  if (classrooms.length === 0) {
    return "目前教师没有可发布的班级。可以建立草稿，但不得调用发布工具。";
  }
  const choices = classrooms
    .map((classroom) => `- ${classroom.name}（classroomId: ${classroom.id}）`)
    .join("\n");
  return `目前教师只可发布到以下班级：\n${choices}`;
}

export function buildActivityAssistantInstructions(
  classrooms: AssistantClassroom[],
): string {
  return `你是 CDAS Next 的教师活动助手。

语言：全程使用简体中文。产品界面、教育部语料与学生最终读到的任务书都是简体中文；
你写进 create_activity_draft 的每一个字都会随发布进入学生端，不得出现繁体字形。
普通对话显示在纯文本会话窗中：使用短段落和自然语言编号，不要输出 Markdown 标题、表格、
代码块、反引号或星号强调。除非教师明确询问技术实现，否则只说明教师能理解的产品职责，
不要列举 schema 字段名、工具函数名、内部代码、运行机制或审批签名细节。

设计方法（不进语料，只在这里和 schema 里）：按逆向设计推进，顺序是先定目标、再定
可核验的证据、最后倒推学生行动与阶段划分——不要先想活动好玩不好玩再补目标。三维目标、
阶段证据与四档量规必须互相咬合：每一条目标都要有对应的证据能证明它达成，每一份证据都要
在量规里有对应的评价档位。跨学科不是拼盘：每个融合学科必须承担主学科单独完不成的那部分
任务，说不出这部分就不要加这个学科。

情境叙事（这是任务书好不好用的分水岭，不是修辞）：默认写出来的东西是"纯作业"口吻——
背景当摆设、三个阶段是三道互不相干的题。不许这样。

- backgroundSetting 必须同时交代三件事，缺一不可：学生扮演什么角色（用"你们是……"
  开头）、成果最终交给谁（校内外真实受众，不是"老师"）、要回答的驱动性问题或要做出
  的最终成果物。写完自检：把学科名去掉后，这段话还能不能让一个初中生想动手。
- 每个阶段的 context 用第二人称承接上一阶段的产出，先叙事后要求，例如"你们在上一阶段
  发现了……现在××希望你们……"。三个阶段必须是同一个故事的三集，不是三道并列的题；
  第一阶段之外的 context 若读起来跟前一阶段无关，就是写错了，重写。
- action 只写这一阶段要动手做的事，不要把情境重复一遍；support 写学生卡住时可以用
  什么；evaluationFocus 写老师会看什么。三者不要互相抄。
- 证据要逐级递进：后一阶段的证据应当建立在前一阶段的产出之上，而不是各交各的。
- 在任务理解摘要里自查并说明：三个阶段是否同一个故事、证据是否逐级递进。若自查不过，
  先改任务书再提交，不要提交后再解释。

你的唯一业务范围是：
1. 根据教师自然语言，整理 schema v2 的完整跨学科任务书。必须使用原版 CTS 的学段/年级、稳定学科目录、主学科加至少一个融合学科、实践性/探究性/项目式作业及其条件子类型、探究深度、提交模式和 1–16 周周期。作业类型只能用 practical、inquiry、project。子类型必须与类型匹配且只用这些代码：practical 配 visit、simulation、observation；inquiry 配 literature、survey、experiment；project 的 assignmentSubtype 必须为 null，不得填其他字串。探究深度只用 basic、intermediate、deep。提交模式只用 phased、once、mixed；教师说过程性提交时用 phased。学科代码必须用目录中的英文 code，信息科技是 infoTech。另需具体背景、知识与技能/过程与方法/情感态度三维目标、三到四个连续阶段（每阶段一个明确行动、情境、支架、类型化证据、评价要点、课时）及四档量规。可选 0–2 个跨学科概念：物质与能量、结构与功能、系统与模型、稳定与变化。
2. 只有缺少会改变年级、学科、真实任务、成果、证据或评价结构的资料时，才每轮问一个必要问题；不要因可选润饰、措辞或补充背景而阻塞，也不得把缺失事实当成已知资料。资料足够时立刻调用 create_activity_draft，不要先在普通文字中重述完整方案。
3. 资料足够后，先调用 search_knowledge，按学段和主学科／融合学科检索教育部官方课程方案与课程标准；根据结果改写查询可以再检索。首版白名单只有课程方案、语文、数学、物理、信息科技，不包含 UbD、C-POTE、团体标准、教材、教师案例或任何 AI 生成内容。不得声称检索到了白名单之外的资料。
4. 对与当前活动相关的检索结果，调 read_source_section 阅读原文后再写目标、学科贡献、证据与评价。若活动学科命中首版白名单，提案必须引用至少两个不同官方来源；引用的 sourceId、sectionId、citationLabel 与 href 必须逐字来自工具结果。sourceReferences 的每一条都必须对应本轮 read_source_section 已返回 FOUND 的章节；引用数量不得超过已通读章节数，优先只引用 2 条已通读来源，不要把只检索到、未通读的章节写入引用。提交提案前逐条核对。引用只是可追查的设计依据，不代表活动自动符合课程标准。若确实没有相关结果，必须明确说「语料中未找到依据」，并说明首版语料边界，不能编造来源，也不能改用记忆里的课程标准原文充数。
5. create_activity_draft 的输入是待教师确认的结构化提案：任务理解摘要、教师已提供要求、明确假设、每个融合学科的必要贡献，知识/过程/情感各一条目标—任务—证据—评价链，可点开的官方来源及采用理由，最后附上完整 schema v2 内容。融合学科贡献必须精确覆盖 integratedDisciplineCodes，不得多写主学科、也不得漏写任一融合学科；三条链必须各一且只一条。提交该工具前先自检：assignmentType/assignmentSubtype 配对合法、sourceReferences 均为本轮 FOUND 通读、content.schemaVersion 为 2、学段与年级与教师说明一致（小学 1–6 对 PRIMARY，初中 7–9 对 MIDDLE）。它会暂停等待教师确认；拒绝后不得重试，也不得建立草稿。每个请求最多提出或建立一份草稿。
6. 教师确认后，工具只会把提案内同一份 schema v2 content 建立为 READY_FOR_PREVIEW 草稿。建立成功后即停止；用户端会依工具回传的精确 draftId 与 previewHref 开启预览，不要再要求一次模型回应。
7. 只有教师明确要求发布、目标班级明确且草稿版本已知时，才调用 publish_activity_release。发布工具会暂停等待教师核对精确参数。教师拒绝或工具失败后不得重试。
8. 你的产出是待教师终审的建议，不是课程质量结论，也不是合规结论。不要替教师下「本活动符合课程标准」这类判断，不要输出或索取认证 subject、密钥、资料库 URL、prompt、内部追踪 ID 或 approval 签名。

活动内容必须完全符合工具 schema；不要把正文放在普通工具之外持久化。
${classroomInstructions(classrooms)}`;
}

function explicitlyRequestsPublish(text: string): boolean {
  const normalized = text.normalize("NFKC").toLowerCase();
  if (
    /(?:不要|請勿|请勿|取消|拒絕|拒绝|do\s+not\s+publish|don't\s+publish)/u.test(
      normalized,
    )
  ) {
    return false;
  }
  // 这里匹配的是教师输入，繁简两种写法都要认；助手自己的输出一律简体。
  return /(?:publish_activity_release|發佈|发布|\bpublish\b)/u.test(normalized);
}

export function selectActivityAssistantToolChoice(
  messages: ActivityAssistantMessage[],
) {
  const latest = messages.at(-1);
  if (latest?.role !== "user") return "auto" as const;
  const latestText = latest.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const hasCreatedDraft = messages.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) =>
          part.type === "tool-create_activity_draft" &&
          part.state === "output-available",
      ),
  );
  const hasPublishCall = messages.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) => part.type === "tool-publish_activity_release",
      ),
  );
  if (
    hasCreatedDraft &&
    !hasPublishCall &&
    explicitlyRequestsPublish(latestText)
  ) {
    return {
      type: "tool" as const,
      toolName: "publish_activity_release" as const,
    };
  }
  return "auto" as const;
}

function authenticationResponse(error: AuthenticationError): Response {
  if (error.code === "UNAUTHENTICATED") {
    return jsonError(401, "UNAUTHENTICATED");
  }
  if (error.code === "USER_NOT_PROVISIONED") {
    return jsonError(403, "FORBIDDEN");
  }
  return jsonError(503, "AUTH_UNAVAILABLE");
}

function requestErrorResponse(error: ActivityAssistantRequestError): Response {
  return error.code === "REQUEST_TOO_LARGE"
    ? jsonError(413, "REQUEST_TOO_LARGE")
    : jsonError(400, "INVALID_REQUEST");
}

function configErrorResponse(): Response {
  return jsonError(503, "ASSISTANT_UNAVAILABLE");
}

export async function handleActivityAssistantRequest(
  request: Request,
  dependencies: ActivityAssistantHandlerDependencies = defaultDependencies,
): Promise<Response> {
  let database: PrismaClient;
  let actor: AppUser;
  try {
    database = dependencies.getDatabase();
    actor = await dependencies.authenticate(database);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return authenticationResponse(error);
    }
    return jsonError(503, "ASSISTANT_UNAVAILABLE");
  }

  // Authorization precedes parsing provider-facing client input.
  if (actor.role !== "TEACHER") {
    return jsonError(403, "FORBIDDEN");
  }

  let uiMessages;
  try {
    uiMessages = await parseActivityAssistantRequest(request);
  } catch (error) {
    if (error instanceof ActivityAssistantRequestError) {
      return requestErrorResponse(error);
    }
    return jsonError(400, "INVALID_REQUEST");
  }

  let config: ActivityAssistantConfig;
  let model: LanguageModel;
  try {
    config = dependencies.getConfig();
    // Configuration is complete before provider construction, and provider
    // construction is complete before any AgentRun or business write.
    model = dependencies.createModel(config);
  } catch (error) {
    if (error instanceof ActivityAssistantConfigError) {
      return configErrorResponse();
    }
    return jsonError(503, "ASSISTANT_UNAVAILABLE");
  }

  const uiContext: CommandContext = {
    actorId: actor.id,
    source: "UI",
    traceId: dependencies.createTraceId(),
    clock: dependencies.clock,
  };

  let classrooms: AssistantClassroom[];
  let modelMessages;
  try {
    classrooms = await dependencies.getClassrooms(database, uiContext);
    modelMessages = await convertToModelMessages(uiMessages, {
      tools: activityAssistantMessageValidationTools,
    });
  } catch {
    return jsonError(400, "INVALID_REQUEST");
  }

  let run: StartedRun;
  try {
    run = await dependencies.startRun(database, uiContext, {
      model: config.model,
    });
  } catch {
    return jsonError(403, "FORBIDDEN");
  }

  const agentContext: CommandContext = {
    actorId: actor.id,
    source: "AGENT",
    traceId: dependencies.createTraceId(),
    clock: dependencies.clock,
  };
  const approvalContext: CommandContext = {
    actorId: actor.id,
    source: "UI",
    traceId: dependencies.createTraceId(),
    clock: dependencies.clock,
  };

  let toolFailureCode: string | null = null;
  let businessWriteSucceeded = false;
  let postWriteStopRequested = false;
  let settlement: Promise<void> | null = null;
  const settle = (
    status: "SUCCEEDED" | "FAILED" | "CANCELLED",
    failureCode: string | null,
  ) => {
    settlement ??= dependencies
      .finishRun(database, agentContext, {
        agentRunId: run.id,
        status,
        failureCode,
      })
      .then(() => undefined)
      .catch(() => {
        // Do not print the model input, tool input, or provider error. The
        // trace is sufficient to correlate this infrastructure failure.
        console.error("Failed to finish activity assistant run", {
          traceId: agentContext.traceId,
          terminalStatus: status,
        });
      });
    return settlement;
  };

  const knowledgeLedger = getActivityAssistantKnowledgeLedger(uiMessages);
  const tools = dependencies.createTools({
    database,
    agentContext,
    approvalContext,
    agentRunId: run.id,
    initialKnowledgeSearchResults: knowledgeLedger.searchResults,
    initialKnowledgeReadSections: knowledgeLedger.readSections,
    onToolFailure: (failureCode) => {
      toolFailureCode = sanitizeActivityAssistantFailureCode(failureCode);
    },
    onBusinessWriteSuccess: () => {
      businessWriteSucceeded = true;
      // The business command and its provenance have committed. Finish the
      // run now so a lost HTTP response or later stream abort cannot rewrite
      // a successful business result as FAILED/CANCELLED.
      void settle("SUCCEEDED", null);
    },
  });
  // A teacher who chose "continue supplementing" must get a conversational
  // follow-up, not another copy of the same proposal in that approval
  // continuation. A later ordinary user turn is a new attempt and can create
  // a revised proposal from the newly supplied facts.
  const lastMessage = uiMessages.at(-1);
  let createApprovalSelected =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (part) =>
        part.type === "tool-create_activity_draft" &&
        part.state === "approval-responded" &&
        part.approval.approved === false,
    );
  let publishApprovalSelected = false;
  const postWriteStopController = new AbortController();
  const streamAbortSignal = AbortSignal.any([
    request.signal,
    postWriteStopController.signal,
  ]);

  try {
    const result = streamText({
      model,
      instructions: buildActivityAssistantInstructions(classrooms),
      messages: modelMessages,
      tools,
      toolChoice: selectActivityAssistantToolChoice(uiMessages),
      providerOptions: deepSeekActivityAssistantProviderOptions,
      toolApproval: {
        create_activity_draft: () => {
          if (createApprovalSelected) {
            return {
              type: "denied",
              reason: "每次請求只能建立一份草稿",
            };
          }
          createApprovalSelected = true;
          return "user-approval";
        },
        publish_activity_release: () => {
          if (publishApprovalSelected) {
            return {
              type: "denied",
              reason: "每次请求只能确认一次发布",
            };
          }
          publishApprovalSelected = true;
          return "user-approval";
        },
      },
      experimental_toolApprovalSecret: config.approvalSecret,
      // Normal model-generated writes stop after their tool step. Approval
      // continuations are different: AI SDK executes the approved tool before
      // preparing its first provider step. prepareStep closes that official
      // loop once the business command has committed. The provider adapter may
      // still be entered by AI SDK, but it receives an already-aborted signal
      // and cannot become a dependency of the human-confirmed business result.
      stopWhen: [
        hasToolCall("create_activity_draft"),
        hasToolCall("publish_activity_release"),
        isStepCount(6),
      ],
      prepareStep: () => {
        if (businessWriteSucceeded && !postWriteStopRequested) {
          postWriteStopRequested = true;
          postWriteStopController.abort();
        }
        return undefined;
      },
      // A successful campus-energy task_book was 4070 chars / 8534 UTF-8 bytes;
      // the create_activity_draft envelope sits on top of that. 4_000 output
      // tokens truncated that JSON (failure_code ..._JSON_PARSE). deepseek-v4-flash
      // allows far more than 8_000; cap at the slice ceiling of 8_000 (measured ×1.5).
      maxOutputTokens: 8_000,
      maxRetries: 1,
      timeout: 90_000,
      abortSignal: streamAbortSignal,
      include: {
        requestBody: false,
        requestMessages: false,
        rawChunks: false,
      },
      onError: async () => {
        await settle(
          businessWriteSucceeded ? "SUCCEEDED" : "FAILED",
          businessWriteSucceeded
            ? null
            : toolFailureCode ?? "MODEL_STREAM_FAILED",
        );
      },
      onAbort: async () => {
        await settle(
          businessWriteSucceeded ? "SUCCEEDED" : "CANCELLED",
          businessWriteSucceeded ? null : "REQUEST_ABORTED",
        );
      },
      onEnd: async ({ content }) => {
        const terminalFailureCode =
          toolFailureCode ?? activityAssistantSdkToolFailureCode(content);
        await settle(
          businessWriteSucceeded || !terminalFailureCode
            ? "SUCCEEDED"
            : "FAILED",
          businessWriteSucceeded ? null : terminalFailureCode,
        );
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        tools,
        originalMessages: uiMessages,
        sendReasoning: false,
        sendSources: false,
        onError: () => "助手請求未完成，請檢查內容後重試。",
      }),
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    await settle("FAILED", "MODEL_START_FAILED");
    return jsonError(502, "ASSISTANT_REQUEST_FAILED");
  }
}
