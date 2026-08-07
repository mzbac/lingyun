import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

import {
  applyAssistantReplayForPrompt,
  applyCopilotImageInputPattern,
  applyCopilotReasoningFields,
  applyOpenAICompatibleReasoningField,
  cloneAgentHistoryMessages,
  createHistoryForModel,
  extractPlanFromReasoning,
  formatBuiltinSubagentsForToolDescription,
  getMessageText as getCoreMessageText,
  getUserHistoryInputText,
  MISSING_TOOL_RESULT_PLACEHOLDER,
  stripSkillInjectedMessages,
  TOOL_ERROR_CODES,
  validateToolArgs,
} from '@kooka/core';
import {
  FileHandleRegistry,
  createLingyunAgent,
  createThreadGoalToolResponse,
  getBuiltinTools,
  getSkillIndex,
  loadSkillFile,
  LingyunAgent,
  LingyunSession,
  PluginManager,
  restoreSession,
  snapshotSession,
  ToolRegistry,
  type AgentHistoryMessage,
  type LLMProvider,
  type ToolDefinition,
  type ToolResult,
} from '../../index.js';
import { TaskSubagentRunner } from '../../agent/taskSubagentRunner.js';
import { SemanticHandleRegistry } from '../../agent/semanticHandles.js';
import { createProviderBehavior } from '../../agent/providerBehavior.js';
import { PromptComposer } from '../../agent/promptComposer.js';
import {
  normalizeSyntheticContextMessageRoles,
  snapshotSyntheticContextsForCompaction,
  stripCompactionRestoredSyntheticMessages,
  stripTransientSyntheticMessages,
} from '../../agent/transientSyntheticContext.js';

function getMessageText(message: AgentHistoryMessage): string {
  return message.parts
    .filter((p: any): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p: { type: 'text'; text: string }) => p.text)
    .join('');
}

function getPromptMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('');
}

function isSymlinkUnsupportedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS' || code === 'UNKNOWN';
}

const bashTool = getBuiltinTools().find((t) => t.tool.id === 'bash')!.tool;

function registerTaskTool(registry: ToolRegistry): void {
  const task = getBuiltinTools({ skills: { enabled: false } }).find((t) => t.tool.id === 'task');
  assert.ok(task, 'expected builtin task tool to exist');
  registry.registerTool(task.tool, task.handler);
}

type ScriptedResponse =
  | { kind: 'text'; content: string; usage?: UsageOverride }
  | {
      kind: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
      usage?: UsageOverride;
      finishReason?: 'tool-calls' | 'stop' | 'other';
    }
  | { kind: 'stream'; chunks: LanguageModelV3StreamPart[] };

type UsageOverride = {
  inputTotal?: number;
  inputNoCache?: number;
  cacheRead?: number;
  cacheWrite?: number;
  outputTotal?: number;
};

function usage(override?: UsageOverride): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
    raw: {},
    ...(override
      ? {
          inputTokens: {
            total: override.inputTotal ?? ((override.inputNoCache ?? 0) + (override.cacheRead ?? 0)),
            noCache: override.inputNoCache ?? 0,
            cacheRead: override.cacheRead ?? 0,
            cacheWrite: override.cacheWrite ?? 0,
          },
          outputTokens: { total: override.outputTotal ?? 0, text: 0, reasoning: 0 },
        }
      : {}),
  };
}

function streamPartsForText(text: string, override?: UsageOverride): LanguageModelV3StreamPart[] {
  const id = 'text_0';
  return [
    { type: 'text-start' as const, id },
    ...Array.from(text).map((ch) => ({ type: 'text-delta' as const, id, delta: ch })),
    { type: 'text-end' as const, id },
    { type: 'finish' as const, usage: usage(override), finishReason: { unified: 'stop', raw: 'stop' } },
  ];
}

function streamPartsForToolCall(call: Extract<ScriptedResponse, { kind: 'tool-call' }>): LanguageModelV3StreamPart[] {
  const finish = call.finishReason ?? 'tool-calls';
  return [
    { type: 'tool-call' as const, toolCallId: call.toolCallId, toolName: call.toolName, input: JSON.stringify(call.input) },
    { type: 'finish' as const, usage: usage(call.usage), finishReason: { unified: finish as any, raw: finish as any } },
  ];
}

function generateResultForResponse(response: ScriptedResponse): LanguageModelV3GenerateResult {
  if (response.kind === 'stream') {
    return {
      content: [{ type: 'text', text: '' } as any],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: usage(),
      warnings: [],
      providerMetadata: {},
      response: { id: 'resp', modelId: 'mock', timestamp: new Date() },
    };
  }

  if (response.kind === 'tool-call') {
    return {
      content: [{ type: 'tool-call', toolCallId: response.toolCallId, toolName: response.toolName, input: JSON.stringify(response.input) } as any],
      finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
      usage: usage(),
      warnings: [],
      providerMetadata: {},
      response: { id: 'resp', modelId: 'mock', timestamp: new Date() },
    };
  }

  return {
    content: [{ type: 'text', text: response.content } as any],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: usage(),
    warnings: [],
    providerMetadata: {},
    response: { id: 'resp', modelId: 'mock', timestamp: new Date() },
  };
}

function getToolNamesFromOptions(tools: unknown): string[] {
  if (Array.isArray(tools)) {
    return tools
      .map((tool: any) => {
        if (typeof tool?.name === 'string' && tool.name) return tool.name;
        if (typeof tool?.id === 'string' && tool.id) return tool.id;
        if (typeof tool?.toolName === 'string' && tool.toolName) return tool.toolName;
        return '';
      })
      .filter(Boolean);
  }

  if (tools && typeof tools === 'object') {
    return Object.keys(tools as Record<string, unknown>);
  }

  return [];
}

function normalizePromptForCache(prompt: unknown): unknown[] {
  return Array.isArray(prompt) ? prompt : prompt === undefined ? [] : [prompt];
}

function hasPromptCachePrefix(previousPrompt: unknown, currentPrompt: unknown): boolean {
  const previous = normalizePromptForCache(previousPrompt);
  const current = normalizePromptForCache(currentPrompt);
  if (previous.length > current.length) return false;
  for (let i = 0; i < previous.length; i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(current[i])) {
      return false;
    }
  }
  return true;
}

function estimatePromptCacheFootprint(prompt: unknown, tools: unknown): number {
  return estimateTokenCount(
    JSON.stringify({
      prompt: normalizePromptForCache(prompt),
      toolNames: getToolNamesFromOptions(tools),
    }),
  );
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function getAssistantTokenHistoryFromSession(
  session: LingyunSession,
): Array<{ input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number; raw?: unknown }> {
  return session
    .getHistory()
    .filter((message) => message.role === 'assistant')
    .map((message) => message.metadata?.tokens)
    .filter((tokens): tokens is NonNullable<typeof tokens> => !!tokens && typeof tokens.total === 'number');
}

function getModeReminderMessages(session: LingyunSession): AgentHistoryMessage[] {
  return session
    .getHistory()
    .filter(
      (message) =>
        message.role === 'system' &&
        message.metadata?.synthetic === true &&
        !!message.metadata?.modeReminder,
    );
}

function getBestPriorCacheCandidate(
  llm: CacheAwareMockLLMProvider,
  turnIndex: number,
): { sourceTurnIndex: number; footprint: number } | undefined {
  const currentPrompt = llm.promptHistory[turnIndex];
  const currentTools = llm.toolNameHistory[turnIndex] ?? [];
  let best: { sourceTurnIndex: number; footprint: number } | undefined;

  for (let idx = 0; idx < turnIndex; idx++) {
    const priorPrompt = llm.promptHistory[idx];
    const priorTools = llm.toolNameHistory[idx] ?? [];
    if (JSON.stringify(priorTools) !== JSON.stringify(currentTools)) {
      continue;
    }
    if (!hasPromptCachePrefix(priorPrompt, currentPrompt)) {
      continue;
    }

    const footprint = estimatePromptCacheFootprint(priorPrompt, priorTools);
    if (!best || footprint >= best.footprint) {
      best = { sourceTurnIndex: idx, footprint };
    }
  }

  return best;
}

function assertCacheReuseAgainstTurn(
  llm: CacheAwareMockLLMProvider,
  session: LingyunSession,
  turnIndex: number,
  sourceTurnIndex: number,
  message: string,
  options?: { expectPositiveSuffix?: boolean },
): void {
  const tokenHistory = getAssistantTokenHistoryFromSession(session);
  assert.ok(turnIndex > sourceTurnIndex, `${message}: source turn must precede the current turn`);
  assert.ok(turnIndex < tokenHistory.length, `${message}: missing assistant token record for turn ${turnIndex}`);

  const currentTokens = tokenHistory[turnIndex]!;
  const sourcePrompt = llm.promptHistory[sourceTurnIndex];
  const currentPrompt = llm.promptHistory[turnIndex];
  const sourceTools = llm.toolNameHistory[sourceTurnIndex] ?? [];
  const currentTools = llm.toolNameHistory[turnIndex] ?? [];
  const sourceFootprint = estimatePromptCacheFootprint(sourcePrompt, sourceTools);
  const currentFootprint = estimatePromptCacheFootprint(currentPrompt, currentTools);
  const expectedSuffix = currentFootprint - sourceFootprint;

  assert.ok(hasPromptCachePrefix(sourcePrompt, currentPrompt), `${message}: current prompt should extend the selected cached source prompt`);
  assert.deepStrictEqual(currentTools, sourceTools, `${message}: tool ordering should match the selected cached source prompt`);
  assert.strictEqual(
    llm.cacheReadSourceIndexHistory[turnIndex],
    sourceTurnIndex,
    `${message}: provider should reuse the expected cached source turn`,
  );
  assert.strictEqual(
    llm.cacheReadHistory[turnIndex],
    sourceFootprint,
    `${message}: provider should record a cache read equal to the selected source footprint`,
  );
  assert.strictEqual(currentTokens.cacheRead, sourceFootprint, `${message}: current turn should read the selected source footprint from cache`);
  assert.strictEqual(currentTokens.cacheWrite ?? 0, 0, `${message}: current turn should not rewrite cached prefix tokens`);
  assert.strictEqual(currentTokens.input, expectedSuffix, `${message}: uncached input should equal only the appended suffix after the cached source prompt`);
  if (options?.expectPositiveSuffix !== false) {
    assert.ok(expectedSuffix > 0, `${message}: expected a positive uncached suffix`);
  }
  assert.strictEqual(
    currentTokens.total,
    (currentTokens.input ?? 0) + (currentTokens.cacheRead ?? 0) + (currentTokens.output ?? 0),
    `${message}: total tokens should equal uncached input + cache read + output`,
  );
}

function assertCacheReuseBetweenTurns(
  llm: CacheAwareMockLLMProvider,
  session: LingyunSession,
  turnIndex: number,
  message: string,
  options?: { expectPositiveSuffix?: boolean },
): void {
  const candidate = getBestPriorCacheCandidate(llm, turnIndex);
  assert.ok(candidate, `${message}: expected at least one cached prefix candidate`);
  assert.strictEqual(
    candidate!.sourceTurnIndex,
    turnIndex - 1,
    `${message}: expected the immediately previous turn to provide the best cached prefix`,
  );
  assertCacheReuseAgainstTurn(llm, session, turnIndex, turnIndex - 1, message, options);
}

function assertCacheInvalidationBetweenTurns(
  llm: CacheAwareMockLLMProvider,
  session: LingyunSession,
  turnIndex: number,
  message: string,
  expectations?: {
    promptPrefixPreserved?: boolean;
    toolOrderingPreserved?: boolean;
  },
): void {
  const tokenHistory = getAssistantTokenHistoryFromSession(session);
  assert.ok(turnIndex > 0, `${message}: turnIndex must be greater than 0`);
  assert.ok(turnIndex < tokenHistory.length, `${message}: missing assistant token record for turn ${turnIndex}`);

  const currentTokens = tokenHistory[turnIndex]!;
  const previousPrompt = llm.promptHistory[turnIndex - 1];
  const currentPrompt = llm.promptHistory[turnIndex];
  const previousTools = llm.toolNameHistory[turnIndex - 1] ?? [];
  const currentTools = llm.toolNameHistory[turnIndex] ?? [];

  const promptPrefixPreserved = hasPromptCachePrefix(previousPrompt, currentPrompt);
  const toolOrderingPreserved = JSON.stringify(previousTools) === JSON.stringify(currentTools);

  if (typeof expectations?.promptPrefixPreserved === 'boolean') {
    assert.strictEqual(
      promptPrefixPreserved,
      expectations.promptPrefixPreserved,
      `${message}: unexpected prompt-prefix preservation state`,
    );
  }
  if (typeof expectations?.toolOrderingPreserved === 'boolean') {
    assert.strictEqual(
      toolOrderingPreserved,
      expectations.toolOrderingPreserved,
      `${message}: unexpected tool-order preservation state`,
    );
  }

  const currentFootprint = estimatePromptCacheFootprint(currentPrompt, currentTools);
  assert.strictEqual(llm.cacheReadHistory[turnIndex] ?? 0, 0, `${message}: provider should record no cache read`);
  assert.strictEqual(currentTokens.cacheRead ?? 0, 0, `${message}: current turn should not read from cache`);
  assert.strictEqual(currentTokens.cacheWrite, currentFootprint, `${message}: current turn should rewrite the full prompt footprint`);
  assert.strictEqual(currentTokens.input, currentFootprint, `${message}: current turn input should be fully uncached`);
  assert.strictEqual(
    currentTokens.total,
    (currentTokens.input ?? 0) + (currentTokens.cacheRead ?? 0) + (currentTokens.output ?? 0),
    `${message}: total tokens should equal uncached input + cache read + output`,
  );
}

function assertSecondTurnCacheReuse(
  llm: CacheAwareMockLLMProvider,
  session: LingyunSession,
  message: string,
): void {
  const tokenHistory = getAssistantTokenHistoryFromSession(session);
  assert.strictEqual(tokenHistory.length, 2, `${message}: expected exactly two assistant token records`);

  const [firstTokens, secondTokens] = tokenHistory;
  const firstPrompt = llm.promptHistory[0];
  const secondPrompt = llm.promptHistory[1];
  const firstTools = llm.toolNameHistory[0] ?? [];
  const secondTools = llm.toolNameHistory[1] ?? [];

  assert.ok(hasPromptCachePrefix(firstPrompt, secondPrompt), `${message}: second prompt should extend the first prompt`);
  assert.deepStrictEqual(secondTools, firstTools, `${message}: tool ordering should remain stable across turns`);

  const firstFootprint = estimatePromptCacheFootprint(firstPrompt, firstTools);

  assert.strictEqual(firstTokens.cacheRead ?? 0, 0, `${message}: first turn should not read from cache`);
  assert.strictEqual(firstTokens.cacheWrite, firstFootprint, `${message}: first turn should write the full prompt footprint`);
  assert.strictEqual(firstTokens.input, firstFootprint, `${message}: first turn input should be fully uncached`);
  assert.strictEqual(llm.cacheReadHistory[0] ?? 0, 0, `${message}: provider should record no cache read on first turn`);
  assertCacheReuseBetweenTurns(llm, session, 1, message);
}

function assertSecondTurnCacheInvalidation(
  llm: CacheAwareMockLLMProvider,
  session: LingyunSession,
  message: string,
  expectations?: {
    promptPrefixPreserved?: boolean;
    toolOrderingPreserved?: boolean;
  },
): void {
  const tokenHistory = getAssistantTokenHistoryFromSession(session);
  assert.strictEqual(tokenHistory.length, 2, `${message}: expected exactly two assistant token records`);

  const [firstTokens, secondTokens] = tokenHistory;
  const firstPrompt = llm.promptHistory[0];
  const secondPrompt = llm.promptHistory[1];
  const firstTools = llm.toolNameHistory[0] ?? [];
  const secondTools = llm.toolNameHistory[1] ?? [];

  const promptPrefixPreserved = hasPromptCachePrefix(firstPrompt, secondPrompt);
  const toolOrderingPreserved = JSON.stringify(firstTools) === JSON.stringify(secondTools);

  if (typeof expectations?.promptPrefixPreserved === 'boolean') {
    assert.strictEqual(
      promptPrefixPreserved,
      expectations.promptPrefixPreserved,
      `${message}: unexpected prompt-prefix preservation state`,
    );
  }
  if (typeof expectations?.toolOrderingPreserved === 'boolean') {
    assert.strictEqual(
      toolOrderingPreserved,
      expectations.toolOrderingPreserved,
      `${message}: unexpected tool-order preservation state`,
    );
  }

  const firstFootprint = estimatePromptCacheFootprint(firstPrompt, firstTools);

  assert.strictEqual(firstTokens.cacheRead ?? 0, 0, `${message}: first turn should not read from cache`);
  assert.strictEqual(firstTokens.cacheWrite, firstFootprint, `${message}: first turn should write the full prompt footprint`);
  assert.strictEqual(firstTokens.input, firstFootprint, `${message}: first turn input should be fully uncached`);
  assert.strictEqual(llm.cacheReadHistory[0] ?? 0, 0, `${message}: provider should record no cache read on first turn`);
  assertCacheInvalidationBetweenTurns(llm, session, 1, message, expectations);
}

class MockLLMProvider implements LLMProvider {
  readonly id: string = 'mock';
  readonly name: string = 'Mock LLM';

  private responses: ScriptedResponse[] = [];
  private unavailableModels = new Set<string>();
  modelCalls: string[] = [];
  callCount = 0;
  lastPrompt: unknown;
  lastOptions: any;
  promptHistory: unknown[] = [];
  lastToolNames: string[] = [];
  toolNameHistory: string[][] = [];

  queueResponse(response: ScriptedResponse): void {
    this.responses.push(response);
  }

  markModelUnavailable(modelId: string): void {
    this.unavailableModels.add(modelId);
  }

  protected nextResponse(): ScriptedResponse {
    return this.responses.shift() ?? { kind: 'text', content: 'No response configured' };
  }

  protected recordRequest(options: any): void {
    this.callCount++;
    this.lastOptions = options;
    this.lastPrompt = structuredClone(options?.prompt);
    this.promptHistory.push(structuredClone(options?.prompt));
    this.lastToolNames = getToolNamesFromOptions(options?.tools);
    this.toolNameHistory.push([...this.lastToolNames]);
  }

  protected prepareResponse(response: ScriptedResponse, _options: any): ScriptedResponse {
    return response;
  }

  async getModel(modelId: string): Promise<unknown> {
    this.modelCalls.push(modelId);
    if (this.unavailableModels.has(modelId)) {
      throw new Error(`model unavailable: ${modelId}`);
    }

    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId,
      supportedUrls: {},
      doGenerate: async (options: any) => {
        this.recordRequest(options);
        const response = this.prepareResponse(this.nextResponse(), options);
        return generateResultForResponse(response);
      },
      doStream: async (options: any): Promise<LanguageModelV3StreamResult> => {
        this.recordRequest(options);
        const response = this.prepareResponse(this.nextResponse(), options);
        const chunks =
          response.kind === 'tool-call'
            ? streamPartsForToolCall(response)
            : response.kind === 'stream'
              ? response.chunks
              : streamPartsForText(response.content, response.usage);

        return {
          stream: simulateReadableStream<LanguageModelV3StreamPart>({ chunks }),
        };
      },
    };

    return model;
  }
}

class CacheAwareMockLLMProvider extends MockLLMProvider {
  private readonly cachedRequests: Array<{ prompt: unknown; toolNames: string[]; footprint: number }> = [];
  cacheReadHistory: number[] = [];
  cacheReadSourceIndexHistory: Array<number | undefined> = [];

  protected override prepareResponse(response: ScriptedResponse, options: any): ScriptedResponse {
    const toolNames = getToolNamesFromOptions(options?.tools);
    const inputTotal = estimatePromptCacheFootprint(options?.prompt, toolNames);
    let cacheRead = 0;
    let cacheReadSourceIndex: number | undefined;

    for (let idx = 0; idx < this.cachedRequests.length; idx++) {
      const candidate = this.cachedRequests[idx]!;
      if (JSON.stringify(candidate.toolNames) !== JSON.stringify(toolNames)) {
        continue;
      }
      if (!hasPromptCachePrefix(candidate.prompt, options?.prompt)) {
        continue;
      }
      if (candidate.footprint >= cacheRead) {
        cacheRead = candidate.footprint;
        cacheReadSourceIndex = idx;
      }
    }

    this.cachedRequests.push({
      prompt: structuredClone(options?.prompt),
      toolNames: [...toolNames],
      footprint: inputTotal,
    });
    this.cacheReadHistory.push(cacheRead);
    this.cacheReadSourceIndexHistory.push(cacheReadSourceIndex);

    if (response.kind === 'stream' || response.usage) {
      return response;
    }

    if (response.kind === 'tool-call') {
      return {
        ...response,
        usage: {
          inputTotal,
          inputNoCache: Math.max(0, inputTotal - cacheRead),
          cacheRead,
          cacheWrite: cacheRead > 0 ? 0 : inputTotal,
          outputTotal: estimateTokenCount(JSON.stringify(response.input)),
        },
      };
    }

    return {
      ...response,
      usage: {
        inputTotal,
        inputNoCache: Math.max(0, inputTotal - cacheRead),
        cacheRead,
        cacheWrite: cacheRead > 0 ? 0 : inputTotal,
        outputTotal: estimateTokenCount(response.content),
      },
    };
  }
}

class MockOpenAICompatibleProvider extends MockLLMProvider {
  override readonly id = 'openaiCompatible';
  override readonly name = 'OpenAI-Compatible';
}

class MockCopilotProvider extends MockLLMProvider {
  override readonly id = 'copilot';
  override readonly name = 'Copilot';
}

class MockCodexSubscriptionProvider extends MockLLMProvider {
  override readonly id = 'codexSubscription';
  override readonly name = 'Codex Subscription';
}

class MockProviderWithModelMetadata extends MockLLMProvider {
  async getModels(): Promise<Array<{ id: string; name: string; vendor: string; family: string; maxInputTokens: number; maxOutputTokens: number }>> {
    return [
      {
        id: 'mock-model',
        name: 'Mock Model',
        vendor: 'mock',
        family: 'mock',
        maxInputTokens: 100000,
        maxOutputTokens: 64000,
      },
    ];
  }
}

class MockProviderWithOutputOnlyModelMetadata extends MockLLMProvider {
  getModelsCallCount = 0;

  async getModels(): Promise<Array<{ id: string; name: string; vendor: string; family: string; maxOutputTokens: number }>> {
    this.getModelsCallCount++;
    return [
      {
        id: 'mock-model',
        name: 'Mock Model',
        vendor: 'mock',
        family: 'mock',
        maxOutputTokens: 24000,
      },
    ];
  }
}

suite('LingYun Agent SDK', () => {
  test('runs a tool-call loop and stores tool parts', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    registry.registerTool(
      {
        id: 'test_echo',
        name: 'Echo',
        description: 'Echoes back input',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        execution: { type: 'function', handler: 'test_echo' },
      },
      async (args): Promise<ToolResult> => ({
        success: true,
        data: `Echo: ${String(args.message)}`,
      })
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'test_echo',
      input: { message: 'hi' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'say hi' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'done');
    assert.strictEqual(result.session, session);

    const history = session.getHistory();
    assert.strictEqual(history[0]?.role, 'user');
    assert.ok(history.some((m) => m.role === 'assistant'), 'expected at least one assistant message');

    const toolAssistant = history.find(
      (m) => m.role === 'assistant' && m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_1')
    )!;
    const toolPart = toolAssistant.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_1') as any;
    assert.ok(toolPart, 'expected dynamic-tool part');
    assert.strictEqual(toolPart.toolName, 'test_echo');
    assert.strictEqual(toolPart.state, 'output-available');
    assert.strictEqual(toolPart.output?.success, true);
    assert.ok(String(toolPart.output?.data).includes('Echo: hi'));
    assert.strictEqual(toolPart.compactedAt, undefined, 'default mode must not rewrite a consumed tool result');

    const preparedToolPart = createHistoryForModel(history)
      .flatMap((message) => message.parts as any[])
      .find((part) => part.type === 'dynamic-tool' && part.toolCallId === 'call_1');
    assert.strictEqual(preparedToolPart?.output?.data, toolPart.output?.data);

    const finalAssistant = [...history].reverse().find((m) => m.role === 'assistant' && getMessageText(m).trim())!;
    assert.strictEqual(getMessageText(finalAssistant).trim(), 'done');
  });

  test('uses configured maxIterations for tool-call loops', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    registry.registerTool(
      {
        id: 'test_echo',
        name: 'Echo',
        description: 'Echoes back input',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        execution: { type: 'function', handler: 'test_echo' },
      },
      async (args): Promise<ToolResult> => ({
        success: true,
        data: `Echo: ${String(args.message)}`,
      })
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'test_echo',
      input: { message: 'first' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_2',
      toolName: 'test_echo',
      input: { message: 'second' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model', maxIterations: 2 }, registry, {
      allowExternalPaths: false,
    });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'keep using tools' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(llm.callCount, 2);
    assert.strictEqual(result.text, '');
    assert.ok(
      session
        .getHistory()
        .some(
          (m) =>
            m.role === 'assistant' &&
            m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_2'),
        ),
      'expected second tool call to run before the configured cap',
    );
  });

  test('accounts budget-limited wrap-up turns without cache reads', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({
      threadGoal: {
        id: 'goal-budget-wrap',
        objective: 'Wrap up budget-limited work',
        status: 'budgetLimited',
        tokenBudget: 50,
        tokensUsed: 55,
        timeUsedSeconds: 3,
        createdAt: 1,
        updatedAt: 1,
      },
    });

    llm.queueResponse({
      kind: 'text',
      content: 'Budget wrap-up.',
      usage: { inputNoCache: 7, cacheRead: 100, outputTotal: 4 },
    });

    const run = agent.run({ session, input: 'Summarize the budget-limited goal.' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'Budget wrap-up.');
    assert.strictEqual(session.threadGoal?.status, 'budgetLimited');
    assert.strictEqual(session.threadGoal?.tokensUsed, 66);
    assert.ok((session.threadGoal?.timeUsedSeconds ?? 0) >= 3);
  });

  test('keeps blocked update_goal turn budget-limited when final accounting crosses budget', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registry.registerTool(
      {
        id: 'update_goal',
        name: 'Update Goal',
        description: 'Update the existing goal.',
        parameters: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['complete', 'blocked'] } },
          required: ['status'],
        },
        execution: { type: 'function', handler: 'update_goal' },
      },
      async (_args, context): Promise<ToolResult> => {
        const session = (context as any).session as LingyunSession;
        assert.ok(session.threadGoal);
        session.threadGoal.status = 'blocked';
        const response = createThreadGoalToolResponse(session.threadGoal);
        const outputText = JSON.stringify(response, null, 2);
        return { success: true, data: outputText, metadata: { outputText } };
      },
    );
    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({
      threadGoal: {
        id: 'goal-blocked-budget',
        objective: 'Stop if blocked or over budget',
        status: 'active',
        tokenBudget: 50,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    });

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call-blocked-goal',
      toolName: 'update_goal',
      input: { status: 'blocked' },
      usage: { inputNoCache: 45, cacheRead: 100, outputTotal: 10 },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'This should not run.' });

    const run = agent.run({ session, input: 'Mark the goal blocked.' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, '');
    assert.strictEqual(llm.callCount, 1);
    assert.strictEqual(session.threadGoal?.status, 'budgetLimited');
    assert.strictEqual(session.threadGoal?.tokensUsed, 55);

    const toolAssistant = session
      .getHistory()
      .find((m) => m.role === 'assistant' && m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call-blocked-goal'));
    const toolPart = toolAssistant?.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call-blocked-goal') as any;
    assert.ok(toolPart);
    const toolOutput = JSON.parse(String(toolPart.output?.data || '{}'));
    assert.strictEqual(toolOutput.goal.status, 'budgetLimited');
    assert.strictEqual(toolOutput.goal.tokensUsed, 55);
    assert.strictEqual(toolOutput.remainingTokens, 0);
  });

  test('treats maxIterations -1 as unlimited', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    registry.registerTool(
      {
        id: 'test_echo',
        name: 'Echo',
        description: 'Echoes back input',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        execution: { type: 'function', handler: 'test_echo' },
      },
      async (args): Promise<ToolResult> => ({
        success: true,
        data: `Echo: ${String(args.message)}`,
      })
    );

    for (let i = 1; i <= 55; i++) {
      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: `call_${i}`,
        toolName: 'test_echo',
        input: { message: `iteration ${i}` },
        finishReason: 'tool-calls',
      });
    }
    llm.queueResponse({ kind: 'text', content: 'done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model', maxIterations: -1 }, registry, {
      allowExternalPaths: false,
    });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'keep using tools past default cap' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(llm.callCount, 56);
    assert.strictEqual(result.text, 'done');
    assert.ok(
      session
        .getHistory()
        .some(
          (m) =>
            m.role === 'assistant' &&
            m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_55'),
        ),
      'expected the run to continue beyond the default 50-iteration cap',
    );
  });

  test('normalizes mentioned skills inside session state', () => {
    const session = new LingyunSession({ mentionedSkills: ['skill-1', '', '  skill-2  ', 'skill-1', '   '] as any });
    assert.deepStrictEqual(session.mentionedSkills, ['skill-1', 'skill-2']);

    session.setMentionedSkills(['  skill-3  ', '', null, 'skill-4', 'skill-3'] as any);
    assert.deepStrictEqual(session.mentionedSkills, ['skill-3', 'skill-4']);

    session.rememberMentionedSkill('  skill-4  ');
    session.rememberMentionedSkill('  skill-5  ');
    assert.deepStrictEqual(session.mentionedSkills, ['skill-3', 'skill-4', 'skill-5']);

    session.clearMentionedSkills();
    assert.deepStrictEqual(session.mentionedSkills, []);
  });

  test('uses configured maxOutputTokens when provider metadata has no output limit', async () => {
    const llm = new MockLLMProvider();
    const agent = new LingyunAgent(llm, { model: 'mock-model', maxOutputTokens: 12345 }, new ToolRegistry());
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.maxOutputTokens, 12345);
  });

  test('warns when the response reaches the configured output limit', async () => {
    const llm = new MockLLMProvider();
    const agent = new LingyunAgent(llm, { model: 'mock-model', maxOutputTokens: 321 }, new ToolRegistry());
    const session = new LingyunSession();
    llm.queueResponse({
      kind: 'stream',
      chunks: [
        { type: 'text-start', id: 'text_0' },
        { type: 'text-delta', id: 'text_0', delta: 'Partial response' },
        { type: 'text-end', id: 'text_0' },
        {
          type: 'finish',
          usage: usage({ outputTotal: 321 }),
          finishReason: { unified: 'length', raw: 'length' },
        },
      ],
    });

    const callbackNotices: Array<{ level: string; message: string }> = [];
    const eventNotices: Array<{ level: string; message: string }> = [];
    const run = agent.run({
      session,
      input: 'Write a long response',
      callbacks: {
        onNotice: notice => {
          callbackNotices.push(notice);
        },
      },
    });
    for await (const event of run.events) {
      if (event.type === 'notice') eventNotices.push(event.notice);
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'Partial response');
    assert.strictEqual(callbackNotices.length, 1);
    assert.deepStrictEqual(eventNotices, callbackNotices);
    assert.strictEqual(callbackNotices[0]?.level, 'warning');
    assert.match(callbackNotices[0]?.message ?? '', /321-token output limit/);
    assert.match(callbackNotices[0]?.message ?? '', /Fallback max output tokens/);
    assert.match(callbackNotices[0]?.message ?? '', /ask the agent to continue/);
  });

  test('passes xhigh reasoning effort for prefixed OpenAI-compatible GPT-5.5 Responses models', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const agent = new LingyunAgent(
      llm,
      { model: 'openai/gpt-5.5' },
      new ToolRegistry(),
      { reasoning: { effort: 'xhigh' } },
    );
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.openaiCompatible?.reasoningEffort, 'xhigh');
    assert.strictEqual(llm.lastOptions?.providerOptions?.openai?.reasoningEffort, 'xhigh');
  });

  test('passes reasoning effort for Codex subscription Responses models', async () => {
    const llm = new MockCodexSubscriptionProvider();
    const agent = new LingyunAgent(
      llm,
      { model: 'gpt-5.3-codex' },
      new ToolRegistry(),
      { reasoning: { effort: 'high' } },
    );
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.codexSubscription?.reasoningEffort, 'high');
    assert.strictEqual(llm.lastOptions?.providerOptions?.codexSubscription?.reasoningSummary, 'auto');
    assert.strictEqual(llm.lastOptions?.providerOptions?.openai?.reasoningEffort, 'high');
    assert.strictEqual(llm.lastOptions?.providerOptions?.openai?.reasoningSummary, 'auto');
  });

  test('passes max reasoning effort for Codex subscription Responses models', async () => {
    const llm = new MockCodexSubscriptionProvider();
    const agent = new LingyunAgent(
      llm,
      { model: 'gpt-5.3-codex' },
      new ToolRegistry(),
      { reasoning: { effort: 'max' } },
    );
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.codexSubscription?.reasoningEffort, 'max');
    assert.strictEqual(llm.lastOptions?.providerOptions?.codexSubscription?.reasoningSummary, 'auto');
    assert.strictEqual(llm.lastOptions?.providerOptions?.openai?.reasoningEffort, 'max');
    assert.strictEqual(llm.lastOptions?.providerOptions?.openai?.reasoningSummary, 'auto');
  });

  test('createLingyunAgent passes reasoning effort for custom Codex subscription providers', async () => {
    const llm = new MockCodexSubscriptionProvider();
    const { agent } = createLingyunAgent({
      llm: { provider: 'custom', instance: llm, model: 'gpt-5.3-codex' },
      reasoning: { effort: 'high' },
      tools: { builtin: false },
    });
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.codexSubscription?.reasoningEffort, 'high');
    assert.strictEqual(llm.lastOptions?.providerOptions?.codexSubscription?.reasoningSummary, 'auto');
    assert.strictEqual(llm.lastOptions?.providerOptions?.openai?.reasoningEffort, 'high');
    assert.strictEqual(llm.lastOptions?.providerOptions?.openai?.reasoningSummary, 'auto');
  });

  test('passes think:false for DeepSeek OpenAI-compatible chat models by default', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const agent = new LingyunAgent(llm, { model: 'deepseek-v4-flash' }, new ToolRegistry());
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.openaiCompatible?.think, false);
    assert.strictEqual(llm.lastOptions?.providerOptions?.openaiCompatible?.reasoningEffort, undefined);
  });

  test('leaves DeepSeek reasoner thinking enabled in auto mode', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const agent = new LingyunAgent(llm, { model: 'deepseek-reasoner' }, new ToolRegistry());
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.openaiCompatible?.think, undefined);
  });

  test('passes think:false when OpenAI-compatible thinking is explicitly disabled', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const agent = new LingyunAgent(
      llm,
      { model: 'local-chat' },
      new ToolRegistry(),
      { openaiCompatible: { thinking: 'disabled' } },
    );
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.openaiCompatible?.think, false);
  });

  test('prefers provider model metadata over configured maxOutputTokens', async () => {
    const llm = new MockProviderWithModelMetadata();
    const agent = new LingyunAgent(llm, { model: 'mock-model', maxOutputTokens: 12345 }, new ToolRegistry());
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.maxOutputTokens, 64000);
  });

  test('prefers modelLimits output over provider model metadata', async () => {
    const llm = new MockProviderWithModelMetadata();
    const agent = new LingyunAgent(
      llm,
      { model: 'mock-model', maxOutputTokens: 12345 },
      new ToolRegistry(),
      { modelLimits: { 'mock-model': { context: 100000, output: 7777 } } },
    );
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.maxOutputTokens, 7777);
  });

  test('uses provider metadata output when modelLimits only overrides context', async () => {
    const llm = new MockProviderWithModelMetadata();
    const agent = new LingyunAgent(
      llm,
      { model: 'mock-model', maxOutputTokens: 12345 },
      new ToolRegistry(),
      { modelLimits: { 'mock-model': { context: 100000 } } },
    );
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.maxOutputTokens, 64000);
  });

  test('uses provider output metadata even when context metadata is absent', async () => {
    const llm = new MockProviderWithOutputOnlyModelMetadata();
    const agent = new LingyunAgent(llm, { model: 'mock-model', maxOutputTokens: 12345 }, new ToolRegistry());
    const session = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const run = agent.run({ session, input: 'hi' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(llm.lastOptions?.maxOutputTokens, 24000);
  });

  test('caches provider output metadata even when context metadata is absent', async () => {
    const llm = new MockProviderWithOutputOnlyModelMetadata();
    const agent = new LingyunAgent(llm, { model: 'mock-model', maxOutputTokens: 12345 }, new ToolRegistry());
    const firstSession = new LingyunSession();
    const secondSession = new LingyunSession();
    llm.queueResponse({ kind: 'text', content: 'first' });
    llm.queueResponse({ kind: 'text', content: 'second' });

    const firstRun = agent.run({ session: firstSession, input: 'first' });
    for await (const _event of firstRun.events) {
      // drain
    }
    await firstRun.done;

    const secondRun = agent.run({ session: secondSession, input: 'second' });
    for await (const _event of secondRun.events) {
      // drain
    }
    await secondRun.done;

    assert.strictEqual(llm.lastOptions?.maxOutputTokens, 24000);
    assert.strictEqual(llm.getModelsCallCount, 1);
  });

  test('clearRuntimeState resets runtime session state but preserves identity metadata', () => {
    const fileHandles = { nextId: 2, byId: { F1: 'src/index.ts' } };
    const semanticHandles = {
      nextMatchId: 2,
      nextSymbolId: 2,
      nextLocId: 2,
      matches: { M1: { fileId: 'F1', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, preview: 'x' } },
      symbols: {},
      locations: {},
    };
    const session = new LingyunSession({
      history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as any],
      pendingPlan: 'keep going',
      pendingInputs: ['queued'],
      compactionSyntheticContexts: [{ transientContext: 'memoryRecall', text: 'remember me' }],
      sessionId: 'session-1',
      parentSessionId: 'parent-1',
      subagentType: 'general',
      modelId: 'mock-model',
      mentionedSkills: ['skill-1'],
      fileHandles,
      semanticHandles,
    });

    fileHandles.byId.F1 = 'mutated.ts';
    semanticHandles.matches.M1.preview = 'mutated';

    session.clearRuntimeState();

    assert.deepStrictEqual(session.history, []);
    assert.strictEqual(session.pendingPlan, undefined);
    assert.deepStrictEqual(session.getPendingInputs(), []);
    assert.deepStrictEqual(session.mentionedSkills, []);
    assert.deepStrictEqual(session.compactionSyntheticContexts, []);
    assert.deepStrictEqual(session.fileHandles, { nextId: 1, byId: {} });
    assert.deepStrictEqual(session.semanticHandles, {
      nextMatchId: 1,
      nextSymbolId: 1,
      nextLocId: 1,
      matches: {},
      symbols: {},
      locations: {},
    });
    assert.strictEqual(session.sessionId, 'session-1');
    assert.strictEqual(session.parentSessionId, 'parent-1');
    assert.strictEqual(session.subagentType, 'general');
    assert.strictEqual(session.modelId, 'mock-model');
  });

  test('LingyunSession normalizes restored runtime queues without leaking source objects', () => {
    const pendingInputParts: any[] = [
      { type: 'text', text: 'with image' },
      { type: 'file', mediaType: 'image/png', filename: 'shot.png', url: 'file:///shot.png' },
      { type: 'file', mediaType: '', url: 42 },
    ];
    const compactionContexts: any[] = [
      { transientContext: 'memoryRecall', text: 'remember me', extra: 'drop' },
      { transientContext: 'goal', text: 'finish the goal' },
      { transientContext: 'bad', text: 'drop' },
      { transientContext: 'explore' },
    ];
    const session = new LingyunSession({
      pendingInputs: ['queued', pendingInputParts, [], null] as any,
      compactionSyntheticContexts: compactionContexts as any,
      systemPromptSnapshot: ['  Base system prompt  ', '', 42, 'Plugin context'] as any,
    });

    pendingInputParts[0] = { type: 'text', text: 'mutated' };
    compactionContexts[0] = { transientContext: 'memoryRecall', text: 'mutated' };

    assert.deepStrictEqual(session.getPendingInputs(), [
      'queued',
      [
        { type: 'text', text: 'with image' },
        { type: 'file', mediaType: 'image/png', filename: 'shot.png', url: 'file:///shot.png' },
      ],
    ]);
    assert.deepStrictEqual(session.compactionSyntheticContexts, [
      { transientContext: 'memoryRecall', text: 'remember me' },
      { transientContext: 'goal', text: 'finish the goal' },
    ]);
    assert.deepStrictEqual(session.getSystemPromptSnapshot(), ['  Base system prompt  ', 'Plugin context']);
  });

  test('LingyunSession system prompt snapshot normalization avoids chained arrays', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/session.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function normalizeSystemPromptSnapshot');
    assert.ok(start >= 0, 'expected system prompt snapshot normalizer');
    const end = source.indexOf('\nexport function normalizeOptionalMentionedSkills', start);
    assert.ok(end > start, 'expected optional mentioned skills helper after system prompt snapshot normalizer');
    const section = source.slice(start, end);

    assert.match(section, /const parts: string\[\] = \[\];/);
    assert.match(section, /for \(const part of value\)/);
    assert.match(section, /if \(part\.trim\(\)\) parts\.push\(part\);/);
    assert.doesNotMatch(section, /\.map\(/);
    assert.doesNotMatch(section, /\.filter\(/);
  });

  test('core history text helpers scan parts without filter-map arrays', async () => {
    const input = [
      { type: 'text', text: 'first ' },
      { type: 'file', mediaType: 'image/png', filename: 'shot.png', url: 'file:///shot.png' },
      { type: 'text', text: 'second' },
    ] as any;
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'visible ' },
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'text' },
      ],
    } as AgentHistoryMessage;

    assert.strictEqual(getUserHistoryInputText(input), 'first second');
    assert.strictEqual(getCoreMessageText(message), 'visible text');
    const historyWithSkillMessage = [
      { id: 'u1', role: 'user', metadata: { skill: true }, parts: [{ type: 'text', text: 'skill' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'real user' }] },
    ] as AgentHistoryMessage[];
    assert.deepStrictEqual(stripSkillInjectedMessages(historyWithSkillMessage), [historyWithSkillMessage[1]]);

    const cloned = cloneAgentHistoryMessages([message]);
    assert.deepStrictEqual(cloned, [message]);
    assert.notStrictEqual(cloned[0], message);

    const source = await fs.readFile(new URL('../../../../core/src/history.ts', import.meta.url), 'utf8');
    const cloneStart = source.indexOf('export function cloneAgentHistoryMessages');
    assert.ok(cloneStart >= 0, 'expected history clone helper');
    const cloneEnd = source.indexOf('\nexport function parseUserHistoryInput', cloneStart);
    assert.ok(cloneEnd > cloneStart, 'expected parser after history clone helper');
    const cloneSection = source.slice(cloneStart, cloneEnd);

    const inputTextStart = source.indexOf('export function getUserHistoryInputText');
    assert.ok(inputTextStart >= 0, 'expected user input text helper');
    const inputTextEnd = source.indexOf('\nexport function getAgentHistoryStats', inputTextStart);
    assert.ok(inputTextEnd > inputTextStart, 'expected stats helper after user input text helper');
    const inputTextSection = source.slice(inputTextStart, inputTextEnd);

    const messageTextStart = source.indexOf('export function getMessageText');
    assert.ok(messageTextStart >= 0, 'expected message text helper');
    const messageTextEnd = source.indexOf('\nexport function appendText', messageTextStart);
    assert.ok(messageTextEnd > messageTextStart, 'expected appendText after message text helper');
    const messageTextSection = source.slice(messageTextStart, messageTextEnd);

    const stripStart = source.indexOf('export function stripSkillInjectedMessages');
    assert.ok(stripStart >= 0, 'expected skill message stripping helper');
    const stripEnd = source.indexOf('\nexport function createAssistantHistoryMessage', stripStart);
    assert.ok(stripEnd > stripStart, 'expected assistant history factory after skill message stripper');
    const stripSection = source.slice(stripStart, stripEnd);

    assert.match(cloneSection, /const cloned: AgentHistoryMessage\[\] = \[\];/);
    assert.match(cloneSection, /for \(const message of history\)/);
    assert.match(inputTextSection, /if \(typeof input === 'string'\) return input;/);
    assert.match(inputTextSection, /for \(const part of input\)/);
    assert.match(inputTextSection, /if \(isUserTextPart\(part\)\) text \+= part\.text;/);
    assert.doesNotMatch(inputTextSection, /normalizeUserHistoryInputParts\(input\)/);
    assert.match(stripSection, /const stripped: AgentHistoryMessage\[\] = \[\];/);
    assert.match(stripSection, /for \(const message of history\)/);
    assert.match(stripSection, /if \(!isSkillInjectedMessage\(message\)\) stripped\.push\(message\);/);
    assert.match(stripSection, /return stripped;/);
    assert.match(messageTextSection, /for \(const part of message\.parts\)/);
    assert.match(messageTextSection, /if \(part\.type === 'text'\) text \+= part\.text;/);
    for (const section of [cloneSection, inputTextSection, stripSection, messageTextSection]) {
      assert.doesNotMatch(section, /\.map\(/);
      assert.doesNotMatch(section, /\.filter\(/);
    }
  });

  test('core tool arg validation scans schema properties without entry arrays', async () => {
    const result = validateToolArgs(
      {
        name: 'build',
        count: '3',
        nested: { enabled: 'yes' },
      },
      {
        required: ['name'],
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
          mode: { type: 'string', default: 'safe' },
          nested: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
            },
          },
        },
      },
    );

    assert.deepStrictEqual(result, {
      valid: true,
      errors: [],
      data: {
        name: 'build',
        count: 3,
        mode: 'safe',
        nested: { enabled: true },
      },
    });

    const source = await fs.readFile(new URL('../../../../core/src/validation.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function validateToolArgs');
    assert.ok(start >= 0, 'expected tool argument validator');
    const end = source.indexOf('\nfunction validateType', start);
    assert.ok(end > start, 'expected type validator after argument validator');
    const section = source.slice(start, end);

    assert.match(section, /const properties = schema\.properties;/);
    assert.match(section, /for \(const key in properties\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(properties, key\)/);
    assert.match(section, /const propSchema = properties\[key\]!;/);
    assert.doesNotMatch(section, /Object\.entries/);
  });

  test('LingyunSession semantic handle cloning avoids entries and map arrays', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/session.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function cloneSemanticHandleEntries');
    assert.ok(start >= 0, 'expected semantic handle entry cloner');
    const end = source.indexOf('\nexport function cloneSemanticHandlesState', start);
    assert.ok(end > start, 'expected semantic handle state cloner after entry cloner');
    const section = source.slice(start, end);

    assert.match(section, /const cloned: Record<string, T> = \{\};/);
    assert.match(section, /for \(const id in entries\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(entries, id\)/);
    assert.match(section, /cloneSemanticHandleRange\(entry\.range\)/);
    assert.doesNotMatch(section, /Object\.fromEntries/);
    assert.doesNotMatch(section, /Object\.entries/);
    assert.doesNotMatch(section, /\.map\(/);
  });

  test('semantic handle registry imports and exports without entry arrays', async () => {
    const registry = new SemanticHandleRegistry();
    registry.importState({
      nextMatchId: 3,
      nextSymbolId: 4,
      nextLocId: 5,
      matches: {
        M1: {
          fileId: 'F1',
          range: { start: { line: 2.9, character: 3.8 }, end: { line: 2, character: 4 } },
          preview: 'match preview',
        },
        bad: { fileId: 'F1', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } } },
      },
      symbols: {
        S1: {
          fileId: 'F1',
          name: 'main',
          kind: 'function',
          range: { start: { line: 10, character: 1 }, end: { line: 12, character: 2 } },
          containerName: 'App',
        },
      },
      locations: {
        L1: {
          fileId: 'F1',
          label: 'definition',
          range: { start: { line: 20, character: 4 }, end: { line: 20, character: 8 } },
        },
      },
    });

    assert.deepStrictEqual(registry.exportState(), {
      nextMatchId: 3,
      nextSymbolId: 4,
      nextLocId: 5,
      matches: {
        M1: {
          fileId: 'F1',
          range: { start: { line: 2, character: 3 }, end: { line: 2, character: 4 } },
          preview: 'match preview',
        },
      },
      symbols: {
        S1: {
          fileId: 'F1',
          name: 'main',
          kind: 'function',
          range: { start: { line: 10, character: 1 }, end: { line: 12, character: 2 } },
          containerName: 'App',
        },
      },
      locations: {
        L1: {
          fileId: 'F1',
          label: 'definition',
          range: { start: { line: 20, character: 4 }, end: { line: 20, character: 8 } },
        },
      },
    });

    const source = await fs.readFile(new URL('../../../src/agent/semanticHandles.ts', import.meta.url), 'utf8');
    const exportStart = source.indexOf('function exportHandleMap');
    assert.ok(exportStart >= 0, 'expected handle map exporter');
    const importStart = source.indexOf('importState(raw: unknown)', exportStart);
    assert.ok(importStart > exportStart, 'expected importState after handle map exporter');
    const importEnd = source.indexOf('\n  createMatchHandle', importStart);
    assert.ok(importEnd > importStart, 'expected match handle creator after importState');
    const section = source.slice(exportStart, importEnd);

    assert.match(section, /const out: Record<string, T> = \{\};/);
    assert.match(section, /for \(const \[id, value\] of map\)/);
    assert.match(section, /matches: exportHandleMap\(this\.matches\)/);
    assert.match(section, /for \(const id in matchesRaw\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(matchesRaw, id\)/);
    assert.match(section, /for \(const id in symbolsRaw\)/);
    assert.match(section, /for \(const id in locationsRaw\)/);
    assert.doesNotMatch(section, /Object\.fromEntries/);
    assert.doesNotMatch(section, /Object\.entries/);
  });

  test('snapshotSession clones mutable session state', () => {
    const session = new LingyunSession({
      sessionId: 's1',
      history: [{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'hello', state: 'done' }] } as any],
      fileHandles: { nextId: 2, byId: { F1: 'src/index.ts' } },
      semanticHandles: {
        nextMatchId: 2,
        nextSymbolId: 2,
        nextLocId: 2,
        matches: { M1: { fileId: 'F1', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, preview: 'x' } },
        symbols: {
          S1: {
            fileId: 'F1',
            name: 'main',
            kind: 'function',
            range: { start: { line: 3, character: 1 }, end: { line: 5, character: 2 } },
          },
        },
        locations: {
          L1: {
            fileId: 'F1',
            label: 'definition',
            range: { start: { line: 8, character: 4 }, end: { line: 8, character: 10 } },
          },
        },
      },
    });

    const snapshot = snapshotSession(session);
    session.history[0]!.parts[0] = { type: 'text', text: 'mutated', state: 'done' } as any;
    session.fileHandles!.byId.F1 = 'mutated.ts';
    session.semanticHandles!.matches.M1!.preview = 'mutated';
    session.semanticHandles!.symbols.S1!.range.start.line = 99;
    session.semanticHandles!.locations.L1!.range.end.character = 99;

    assert.deepStrictEqual(snapshot.history, [{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'hello', state: 'done' }] }]);
    assert.deepStrictEqual(snapshot.fileHandles, { nextId: 2, byId: { F1: 'src/index.ts' } });
    assert.deepStrictEqual(snapshot.semanticHandles, {
      nextMatchId: 2,
      nextSymbolId: 2,
      nextLocId: 2,
      matches: { M1: { fileId: 'F1', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, preview: 'x' } },
      symbols: {
        S1: {
          fileId: 'F1',
          name: 'main',
          kind: 'function',
          range: { start: { line: 3, character: 1 }, end: { line: 5, character: 2 } },
        },
      },
      locations: {
        L1: {
          fileId: 'F1',
          label: 'definition',
          range: { start: { line: 8, character: 4 }, end: { line: 8, character: 10 } },
        },
      },
    });
  });

  test('session captures system prompt snapshot and derived run stats', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registry.registerTool(
      {
        id: 'echo',
        name: 'Echo',
        description: 'Echo test tool',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } as any },
          required: ['text'],
        },
        execution: { type: 'function', handler: 'test.echo' },
      },
      async (args) => ({ success: true, data: String((args as any).text || '') }),
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_echo',
      toolName: 'echo',
      input: { text: 'ok' },
      usage: { inputNoCache: 4, outputTotal: 2 },
    });
    llm.queueResponse({
      kind: 'text',
      content: 'Done',
      usage: { inputNoCache: 6, cacheRead: 3, outputTotal: 5 },
    });

    const session = new LingyunSession({ sessionId: 'stats-session' });
    const agent = new LingyunAgent(
      llm,
      { model: 'mock-model', systemPrompt: 'Base system prompt' },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );

    const run = agent.run({ session, input: 'Use echo' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    const systemPromptSnapshot = session.getSystemPromptSnapshot();
    assert.ok(systemPromptSnapshot?.some((part) => part.includes('Base system prompt')));

    assert.deepStrictEqual(session.getStats(), {
      totalMessages: 3,
      userMessages: 1,
      assistantMessages: 2,
      systemMessages: 0,
      syntheticMessages: 0,
      toolCallCount: 1,
      completedToolCallCount: 1,
      failedToolCallCount: 0,
      totalInputTokens: 10,
      totalOutputTokens: 7,
      totalCacheReadTokens: 3,
      totalCacheWriteTokens: 0,
      totalTokens: 20,
    });
  });

  test('prompt cache - restored system prompt snapshots remain exact across follow-up turns', async () => {
    const frozenSystemPrompt = '  FROZEN_SYSTEM_PROMPT_FROM_THE_FIRST_REQUEST\n';
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession({ systemPromptSnapshot: [frozenSystemPrompt] });
    const agent = new LingyunAgent(
      llm,
      { model: 'mock-model', systemPrompt: 'Newly recomposed system prompt.' },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );

    llm.queueResponse({ kind: 'text', content: 'first' });
    for await (const _event of agent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'second' });
    for await (const _event of agent.run({ session, input: 'follow up' }).events) {
      // drain
    }

    const prompts = JSON.stringify(llm.promptHistory);
    assert.ok(prompts.includes(frozenSystemPrompt), 'the persisted system prompt should be replayed exactly');
    assert.ok(!prompts.includes('Newly recomposed system prompt.'), 'follow-ups must not replace the cached system prefix');
    assert.deepStrictEqual(session.getSystemPromptSnapshot(), [frozenSystemPrompt]);
    assertSecondTurnCacheReuse(llm, session, 'restored system prompt snapshot');
  });

  test('createHistoryForModel repairs tool-call/result pair integrity for model replay', () => {
    const original: AgentHistoryMessage = {
      id: 'm-tool',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'working', state: 'done' },
        {
          type: 'dynamic-tool',
          toolName: 'read',
          toolCallId: 'call_missing_result',
          state: 'input-available',
          input: { filePath: 'src/index.ts' },
        } as any,
        {
          type: 'dynamic-tool',
          toolName: '',
          toolCallId: 'call_malformed',
          state: 'output-available',
          input: {},
          output: { success: true, data: 'bad' },
        } as any,
        {
          type: 'dynamic-tool',
          toolName: 'grep',
          toolCallId: 'call_complete',
          state: 'output-available',
          input: { pattern: 'foo' },
          output: { success: true, data: 'ok' },
        } as any,
      ],
    } as any;

    const prepared = createHistoryForModel([original]);
    const parts = prepared[0]!.parts as any[];

    assert.strictEqual(parts.some((part) => part.toolCallId === 'call_malformed'), false);

    const repaired = parts.find((part) => part.toolCallId === 'call_missing_result');
    assert.ok(repaired, 'expected missing tool result to be repaired');
    assert.strictEqual(repaired.state, 'output-available');
    assert.deepStrictEqual(repaired.output, {
      success: true,
      data: MISSING_TOOL_RESULT_PLACEHOLDER,
      metadata: { syntheticToolResult: true },
    });

    const complete = parts.find((part) => part.toolCallId === 'call_complete');
    assert.deepStrictEqual(complete?.output, { success: true, data: 'ok' });

    const originalMissing = (original.parts as any[]).find((part) => part.toolCallId === 'call_missing_result');
    assert.strictEqual(originalMissing.output, undefined, 'model preparation must not mutate session history');
  });

  test('core compaction history preparation scans messages without map flatMap arrays', async () => {
    const source = await fs.readFile(new URL('../../../../core/src/compaction.ts', import.meta.url), 'utf8');
    const modelStart = source.indexOf('export function createHistoryForModel');
    assert.ok(modelStart >= 0, 'expected model history preparation helper');
    const modelEnd = source.indexOf('\nexport function createHistoryForCompactionPrompt', modelStart);
    assert.ok(modelEnd > modelStart, 'expected compaction prompt helper after model preparation helper');
    const modelSection = source.slice(modelStart, modelEnd);

    const compactionStart = modelEnd;
    const compactionEnd = source.indexOf('\nexport function isOverflow', compactionStart);
    assert.ok(compactionEnd > compactionStart, 'expected overflow helper after compaction prompt helper');
    const compactionSection = source.slice(compactionStart, compactionEnd);

    assert.match(modelSection, /const prepared: AgentHistoryMessage\[\] = \[\];/);
    assert.match(modelSection, /for \(const msg of history\)/);
    assert.match(modelSection, /const parts: AgentHistoryMessage\['parts'\] = \[\];/);
    assert.match(modelSection, /for \(const part of msg\.parts\)/);
    assert.match(modelSection, /parts\.push\(part\);/);
    assert.match(modelSection, /parts\.push\(\{ \.\.\.anyPart, output: replacement \} as any\);/);
    assert.match(modelSection, /prepared\.push\(\{/);
    assert.match(compactionSection, /const cloned: AgentHistoryMessage\[\] = \[\];/);
    assert.match(compactionSection, /for \(const msg of history\)/);
    assert.match(compactionSection, /for \(const part of msg\.parts\)/);
    assert.match(compactionSection, /parts\.push\(\{ \.\.\.\(part as any\) \} as any\);/);
    assert.match(compactionSection, /cloned\.push\(\{/);
    assert.doesNotMatch(modelSection + compactionSection, /\.map\(/);
    assert.doesNotMatch(modelSection + compactionSection, /\.flatMap\(/);
  });

  test('drains steered input after assistant completion and continues with a follow-up iteration', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({ kind: 'text', content: 'first reply' });
    llm.queueResponse({ kind: 'text', content: 'follow-up reply' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    let injected = false;
    const run = agent.run({
      session,
      input: 'start',
      callbacks: {
        onAssistantToken: () => {
          if (injected) return;
          injected = true;
          session.enqueuePendingInput('follow-up from user');
        },
      },
    });

    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'follow-up reply');
    assert.strictEqual(llm.callCount, 2);

    const history = session.getHistory();
    const userTexts = history.filter((message) => message.role === 'user').map(getMessageText);
    assert.deepStrictEqual(userTexts, ['start', 'follow-up from user']);

    const assistantTexts = history.filter((message) => message.role === 'assistant').map(getMessageText).filter(Boolean);
    assert.deepStrictEqual(assistantTexts, ['first reply', 'follow-up reply']);
  });

  test('preserves undrained steered inputs when aborting mid-drain', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({ pendingInputs: ['first pending', 'second pending'] });
    const abortController = new AbortController();
    const execution = (agent as any).resolveExecutionContext({ model: 'mock-model' });

    const originalInject = (agent as any).injectSkillsForUserText;
    (agent as any).injectSkillsForUserText = async (
      scopedSession: LingyunSession,
      scopedExecution: unknown,
      text: string,
      callbacks: unknown,
      signal: AbortSignal | undefined,
    ) => {
      await originalInject.call(agent, scopedSession, scopedExecution, text, callbacks, signal);
      if (text === 'first pending') {
        abortController.abort();
      }
    };

    try {
      const drained = await (agent as any).drainPendingInputs(
        session,
        execution,
        undefined,
        abortController.signal,
      );
      assert.strictEqual(drained, 1);
    } finally {
      (agent as any).injectSkillsForUserText = originalInject;
    }

    const userTexts = session.getHistory().filter((message) => message.role === 'user').map(getMessageText);
    assert.deepStrictEqual(userTexts, ['first pending']);
    assert.deepStrictEqual(session.getPendingInputs(), ['second pending']);
    assert.strictEqual(llm.callCount, 0);
  });

  test('callbacks - does not emit unhandledRejection when onToolCall rejects', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    registry.registerTool(
      {
        id: 'test_echo',
        name: 'Echo',
        description: 'Echoes back input',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
        execution: { type: 'function', handler: 'test_echo' },
      },
      async (args): Promise<ToolResult> => ({
        success: true,
        data: `Echo: ${String(args.message)}`,
      })
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'test_echo',
      input: { message: 'hi' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const run = agent.run({
        session,
        input: 'say hi',
        callbacks: {
          onToolCall: async () => {
            throw new Error('boom');
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;
      assert.strictEqual(result.text, 'done');

      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.strictEqual(unhandled.length, 0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  test('prompt cache - changing allowExternalPaths preserves cache hits', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'first' });
    const firstAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of firstAgent.run({ session, input: 'hi' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'second' });
    const secondAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: true,
      skills: { enabled: false },
    });
    for await (const _event of secondAgent.run({ session, input: 'follow up' }).events) {
      // drain
    }

    assertSecondTurnCacheReuse(llm, session, 'allowExternalPaths toggle');
  });

  test('prompt cache - prepared synthetic contexts persist so follow-up turns extend the cached prefix', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    let preparedRuns = 0;

    llm.queueResponse({ kind: 'text', content: 'first' });
    llm.queueResponse({ kind: 'text', content: 'second' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
      runtimePolicy: {
        async prepareRun(ctx) {
          if (!ctx.input || preparedRuns++ > 0) return undefined;
          return {
            syntheticContexts: [
              {
                transientContext: 'memoryRecall',
                text: '<memory_recall_context>\nremember this for the first turn\n</memory_recall_context>',
                persistAfterCompaction: true,
              },
            ],
          };
        },
      },
    });

    for await (const _event of agent.run({ session, input: 'hi' }).events) {
      // drain
    }

    const firstPrompt = Array.isArray(llm.promptHistory[0]) ? (llm.promptHistory[0] as any[]) : [];
    const recallPromptMessages = firstPrompt.filter((message) =>
      JSON.stringify(message).includes('<memory_recall_context>'),
    );
    assert.ok(
      recallPromptMessages.some((message) => message.role === 'system'),
      'prepared synthetic context should be sent as system context, not assistant prefill',
    );
    assert.ok(
      !recallPromptMessages.some((message) => message.role === 'assistant'),
      'prepared synthetic context must not create an assistant prefill',
    );

    for await (const _event of agent.run({ session, input: 'follow up' }).events) {
      // drain
    }

    const synthetic = session
      .getHistory()
      .find(
        (message) =>
          message.role === 'system' &&
          message.metadata?.synthetic === true &&
          message.metadata.transientContext === 'memoryRecall',
      );
    assert.ok(synthetic, 'prepared synthetic context should be recorded in session history');
    assert.ok(
      getMessageText(synthetic).includes('remember this for the first turn'),
      'recorded synthetic context should preserve its prompt text',
    );
    assertSecondTurnCacheReuse(llm, session, 'persisted prepared synthetic context');
  });

  test('prompt - legacy assistant synthetic context is normalized before model input', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    session.history.push({
      id: 'legacy-user',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }] as any,
    });
    session.history.push({
      id: 'legacy-synthetic',
      role: 'assistant',
      metadata: { synthetic: true, transientContext: 'memoryRecall' },
      parts: [
        {
          type: 'text',
          text: '<memory_recall_context>\nlegacy assistant context\n</memory_recall_context>',
          state: 'done',
        },
      ] as any,
    });

    llm.queueResponse({ kind: 'text', content: 'done' });
    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of agent.run({ session, input: 'follow up' }).events) {
      // drain
    }

    const prompt = Array.isArray(llm.promptHistory[0]) ? (llm.promptHistory[0] as any[]) : [];
    const recallPromptMessages = prompt.filter((message) =>
      JSON.stringify(message).includes('legacy assistant context'),
    );
    assert.ok(
      recallPromptMessages.some((message) => message.role === 'system'),
      'legacy synthetic context should be converted to system context in prompts',
    );
    assert.ok(
      !recallPromptMessages.some((message) => message.role === 'assistant'),
      'legacy synthetic context must not remain an assistant prefill in prompts',
    );
  });

  test('synthetic context role normalization keeps unchanged history as a mutable copy', () => {
    const systemMessage: AgentHistoryMessage = {
      id: 'system-synthetic',
      role: 'system',
      metadata: { synthetic: true, transientContext: 'memoryRecall' },
      parts: [{ type: 'text', text: 'already system' }] as any,
    };
    const userMessage: AgentHistoryMessage = {
      id: 'user',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }] as any,
    };
    const history = [systemMessage, userMessage];

    const normalized = normalizeSyntheticContextMessageRoles(history);

    assert.notStrictEqual(normalized, history);
    assert.strictEqual(normalized[0], systemMessage);
    assert.strictEqual(normalized[1], userMessage);
    normalized.push({
      id: 'extra',
      role: 'system',
      parts: [{ type: 'text', text: 'extra' }] as any,
    });
    assert.strictEqual(history.length, 2);
  });

  test('synthetic context strip helpers preserve copy semantics and drop matching messages', () => {
    const userMessage: AgentHistoryMessage = {
      id: 'user',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }] as any,
    };
    const transientMessage: AgentHistoryMessage = {
      id: 'transient',
      role: 'system',
      metadata: { synthetic: true, transientContext: 'memoryRecall' },
      parts: [{ type: 'text', text: 'transient context' }] as any,
    };
    const restoredMessage: AgentHistoryMessage = {
      id: 'restored',
      role: 'system',
      metadata: { synthetic: true, compactionRestore: { source: 'sessionState' } },
      parts: [{ type: 'text', text: 'restored context' }] as any,
    };

    const unchangedHistory = [userMessage, restoredMessage];
    const unchanged = stripTransientSyntheticMessages(unchangedHistory);
    assert.notStrictEqual(unchanged, unchangedHistory);
    assert.deepStrictEqual(unchanged, [userMessage, restoredMessage]);
    unchanged.push({
      id: 'extra',
      role: 'system',
      parts: [{ type: 'text', text: 'extra' }] as any,
    });
    assert.strictEqual(unchanged.length, 3);
    assert.strictEqual(unchangedHistory.length, 2);

    const withoutTransient = stripTransientSyntheticMessages([userMessage, transientMessage]);
    assert.deepStrictEqual(withoutTransient, [userMessage]);
    assert.strictEqual(withoutTransient[0], userMessage);

    const withoutRestored = stripCompactionRestoredSyntheticMessages([userMessage, restoredMessage]);
    assert.deepStrictEqual(withoutRestored, [userMessage]);
    assert.strictEqual(withoutRestored[0], userMessage);
  });

  test('synthetic context role normalization clones converted legacy messages only', () => {
    const userMessage: AgentHistoryMessage = {
      id: 'user',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }] as any,
    };
    const legacyMessage: AgentHistoryMessage = {
      id: 'legacy-synthetic',
      role: 'assistant',
      metadata: { synthetic: true, transientContext: 'memoryRecall' },
      parts: [{ type: 'text', text: 'legacy assistant context', state: 'done' }] as any,
    };
    const history = [userMessage, legacyMessage];

    const normalized = normalizeSyntheticContextMessageRoles(history);

    assert.notStrictEqual(normalized, history);
    assert.strictEqual(normalized[0], userMessage);
    assert.notStrictEqual(normalized[1], legacyMessage);
    assert.strictEqual(normalized[1]?.role, 'system');
    assert.notStrictEqual(normalized[1]?.metadata, legacyMessage.metadata);
    assert.notStrictEqual(normalized[1]?.parts, legacyMessage.parts);

    (normalized[1]?.parts[0] as any).text = 'mutated prompt text';
    assert.strictEqual((legacyMessage.parts[0] as any).text, 'legacy assistant context');
  });

  test('synthetic context role normalization avoids eager map allocations', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/transientSyntheticContext.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function normalizeSyntheticContextMessageRoles');
    assert.ok(start >= 0, 'expected synthetic context role normalizer');
    const end = source.indexOf('\nexport function appendSyntheticContextMessage', start);
    assert.ok(end > start, 'expected append helper after synthetic context role normalizer');
    const section = source.slice(start, end);

    assert.match(section, /let normalized: AgentHistoryMessage\[\] \| undefined;/);
    assert.match(section, /history\.slice\(0, i\)/);
    assert.match(section, /return normalized \?\? \[\.\.\.history\];/);
    assert.doesNotMatch(section, /history\.map/);
    assert.doesNotMatch(section, /message\.parts\.map/);
  });

  test('synthetic context compaction snapshots update duplicate kinds without map spreads', async () => {
    const longText = `${'x'.repeat(260)} tail`;

    assert.deepStrictEqual(
      snapshotSyntheticContextsForCompaction([
        { transientContext: 'memoryRecall', text: 'first memory', persistAfterCompaction: true },
        { transientContext: 'goal', text: 'goal context', persistAfterCompaction: true },
        { transientContext: 'memoryRecall', text: longText, persistAfterCompaction: true, maxCharsAfterCompaction: 150 },
        { transientContext: 'explore', text: 'skip explore' },
      ]),
      [
        {
          transientContext: 'memoryRecall',
          text: `${'x'.repeat(200 - '\n\n... [TRUNCATED]'.length)}\n\n... [TRUNCATED]`,
        },
        { transientContext: 'goal', text: 'goal context' },
      ],
    );

    const source = await fs.readFile(new URL('../../../src/agent/transientSyntheticContext.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function snapshotSyntheticContextsForCompaction');
    assert.ok(start >= 0, 'expected compaction snapshot helper');
    const section = source.slice(start);

    assert.match(section, /const snapshots: LingyunCompactionSyntheticContext\[\] = \[\];/);
    assert.match(section, /for \(let i = 0; i < snapshots\.length; i\+\+\)/);
    assert.match(section, /snapshots\[i\] = \{ transientContext: context\.transientContext, text \};/);
    assert.doesNotMatch(section, /new Map/);
    assert.doesNotMatch(section, /\[\.\.\.byKind\.values\(\)\]/);
  });

  test('synthetic context strip helpers avoid eager filter allocations', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/transientSyntheticContext.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function stripSyntheticMessages');
    assert.ok(start >= 0, 'expected shared synthetic strip helper');
    const end = source.indexOf('\nexport function normalizeSyntheticContextMessageRoles', start);
    assert.ok(end > start, 'expected normalizer after synthetic strip helper');
    const section = source.slice(start, end);

    assert.match(section, /let stripped: AgentHistoryMessage\[\] \| undefined;/);
    assert.match(section, /history\.slice\(0, i\)/);
    assert.match(section, /return stripped \?\? \[\.\.\.history\];/);
    assert.doesNotMatch(section, /\.filter\(/);
  });

  test('prompt cache - restored sessions preserve prepared synthetic contexts and cacheable prefixes', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const originalSession = new LingyunSession({ sessionId: 'synthetic-cache-restore-session' });
    let preparedRuns = 0;

    const agent = new LingyunAgent(llm, { model: 'mock-model', sessionId: 'synthetic-cache-restore-session' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
      runtimePolicy: {
        async prepareRun(ctx) {
          if (!ctx.input || preparedRuns++ > 0) return undefined;
          return {
            syntheticContexts: [
              {
                transientContext: 'explore',
                text: '<subagent_explore_context>\nindexed src/cache.ts\n</subagent_explore_context>',
                persistAfterCompaction: true,
              },
            ],
          };
        },
      },
    });

    llm.queueResponse({ kind: 'text', content: 'first' });
    for await (const _event of agent.run({ session: originalSession, input: 'map the cache flow' }).events) {
      // drain
    }

    const restoredSession = restoreSession(snapshotSession(originalSession, { sessionId: 'synthetic-cache-restore-session' }));

    llm.queueResponse({ kind: 'text', content: 'second' });
    const restoredAgent = new LingyunAgent(llm, { model: 'mock-model', sessionId: 'synthetic-cache-restore-session' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
      runtimePolicy: {
        async prepareRun() {
          return undefined;
        },
      },
    });
    for await (const _event of restoredAgent.run({ session: restoredSession, input: 'continue from the cache map' }).events) {
      // drain
    }

    const restoredSynthetic = restoredSession
      .getHistory()
      .find(
        (message) =>
          message.role === 'system' &&
          message.metadata?.synthetic === true &&
          message.metadata.transientContext === 'explore',
      );
    assert.ok(restoredSynthetic, 'restored session should keep the prepared synthetic context in history');
    assert.ok(
      getMessageText(restoredSynthetic).includes('indexed src/cache.ts'),
      'restored synthetic context should preserve its prompt text',
    );
    assertSecondTurnCacheReuse(llm, restoredSession, 'restored prepared synthetic context');
  });

  test('prompt cache - compaction restores prepared synthetic context and rebuilds a cacheable baseline', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    let preparedRuns = 0;

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
      runtimePolicy: {
        async prepareRun(ctx) {
          if (!ctx.input || preparedRuns++ > 0) return undefined;
          return {
            syntheticContexts: [
              {
                transientContext: 'memoryRecall',
                text: '<memory_recall_context>\ncache policy: replay synthetic context after compaction\n</memory_recall_context>',
                persistAfterCompaction: true,
              },
            ],
          };
        },
      },
    });

    llm.queueResponse({ kind: 'text', content: 'first' });
    for await (const _event of agent.run({ session, input: 'start with recalled context' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'summary after compaction' });
    await agent.compactSession(session);

    const restored = session
      .getHistory()
      .find((message) => message.role === 'system' && message.metadata?.compactionRestore?.source === 'memoryRecall');
    assert.ok(restored, 'compaction should restore the prepared synthetic context');
    assert.ok(
      getMessageText(restored).includes('replay synthetic context after compaction'),
      'restored compaction context should preserve the synthetic prompt text',
    );

    llm.queueResponse({ kind: 'text', content: 'post-compaction one' });
    for await (const _event of agent.run({ session, input: 'continue after compaction' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'post-compaction two' });
    for await (const _event of agent.run({ session, input: 'continue after compaction again' }).events) {
      // drain
    }

    const firstPostCompactionPrompt = JSON.stringify(llm.promptHistory[2] ?? '');
    assert.ok(
      firstPostCompactionPrompt.includes('replay synthetic context after compaction'),
      'first post-compaction prompt should include restored synthetic context',
    );

    const tokenHistory = getAssistantTokenHistoryFromSession(session);
    const previousPrompt = llm.promptHistory[2];
    const currentPrompt = llm.promptHistory[3];
    const previousTools = llm.toolNameHistory[2] ?? [];
    const currentTools = llm.toolNameHistory[3] ?? [];
    const currentTokens = tokenHistory[2]!;
    const previousFootprint = estimatePromptCacheFootprint(previousPrompt, previousTools);

    assert.ok(
      hasPromptCachePrefix(previousPrompt, currentPrompt),
      'second post-compaction turn should extend the restored synthetic-context baseline',
    );
    assert.deepStrictEqual(
      currentTools,
      previousTools,
      'tool ordering should stay stable after synthetic-context compaction restore',
    );
    assert.strictEqual(
      llm.cacheReadSourceIndexHistory[3],
      2,
      'second post-compaction turn should reuse the first post-compaction prompt, not the compaction prompt',
    );
    assert.strictEqual(
      llm.cacheReadHistory[3],
      previousFootprint,
      'second post-compaction turn should read the restored synthetic-context baseline from cache',
    );
    assert.strictEqual(
      currentTokens.cacheRead,
      previousFootprint,
      'assistant token accounting should record the restored synthetic-context cache read',
    );
  });

  test('plan extraction uses numbered, bullet, and question fallbacks from reasoning', () => {
    assert.strictEqual(
      extractPlanFromReasoning([
        'Thinking through the task.',
        '2. Preserve the existing harness.',
        '3. Run focused verification.',
        '- This bullet should not win when numbered steps exist.',
      ].join('\n')),
      '2. Preserve the existing harness.\n3. Run focused verification.',
    );

    assert.strictEqual(
      extractPlanFromReasoning([
        '<think>private notes</think>',
        '- [ ] Inspect the current code path.',
        '* [x] Replace repeated scans.',
        '• Verify plan-first behavior.',
      ].join('\n')),
      '1. Inspect the current code path.\n2. Replace repeated scans.\n3. Verify plan-first behavior.',
    );

    assert.strictEqual(
      extractPlanFromReasoning([
        '1) Which provider should be used?',
        '2) Which tests should run?',
        '<tool_call>{"ignored":true}</tool_call>',
        'Does the user want a release note?',
      ].join('\n')),
      '1. Which provider should be used?\n2. Which tests should run?',
    );

    assert.strictEqual(
      extractPlanFromReasoning([
        'We need clarification before editing.',
        'Which workspace should be used?',
        'Should UI snapshots be updated?',
        'Proceed without running browser checks?',
      ].join('\n')),
      '1. Which workspace should be used?\n2. Should UI snapshots be updated?\n3. Proceed without running browser checks?',
    );
  });

  test('prompt cache - switching to plan mode appends a synthetic system reminder without invalidating the prefix', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'build reply' });
    const buildAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'build' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of buildAgent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'plan reply' });
    const planAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of planAgent.run({ session, input: 'make a plan' }).events) {
      // drain
    }

    const firstPrompt = JSON.stringify(llm.promptHistory[0] ?? '');
    const secondPrompt = JSON.stringify(llm.promptHistory[1] ?? '');
    assert.ok(!firstPrompt.includes('Plan mode is active'), 'first prompt should not contain the plan reminder');
    assert.ok(secondPrompt.includes('Plan mode is active'), 'second prompt should contain the plan reminder');
    const modeReminders = getModeReminderMessages(session);
    assert.strictEqual(modeReminders.length, 1, 'expected one persisted mode reminder after entering plan mode');
    assert.strictEqual(modeReminders[0]?.metadata?.modeReminder?.mode, 'plan');
    assert.strictEqual(modeReminders[0]?.metadata?.modeReminder?.kind, 'plan');
    assertSecondTurnCacheReuse(llm, session, 'switch to plan mode');
  });

  test('prompt cache - switching from plan to build appends a synthetic system reminder without invalidating the prefix', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'plan reply' });
    const planAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of planAgent.run({ session, input: 'make a plan' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'build reply' });
    const buildAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'build' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of buildAgent.run({ session, input: 'now execute' }).events) {
      // drain
    }

    const firstPrompt = JSON.stringify(llm.promptHistory[0] ?? '');
    const secondPrompt = JSON.stringify(llm.promptHistory[1] ?? '');
    assert.ok(firstPrompt.includes('Plan mode is active'), 'first prompt should contain the plan reminder');
    assert.ok(
      secondPrompt.includes('operational mode has changed from plan to build'),
      'second prompt should contain the build-switch reminder',
    );
    const modeReminders = getModeReminderMessages(session);
    assert.strictEqual(modeReminders.length, 2, 'expected persisted plan + build-switch reminders');
    assert.deepStrictEqual(
      modeReminders.map((message) => message.metadata?.modeReminder),
      [
        { mode: 'plan', kind: 'plan' },
        { mode: 'build', kind: 'build-switch' },
      ],
    );
    assertSecondTurnCacheReuse(llm, session, 'switch from plan to build');
  });

  test('prompt cache - repeated turns in the same mode do not append duplicate mode reminders', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'plan reply 1' });
    const firstPlanAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of firstPlanAgent.run({ session, input: 'make a plan' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'plan reply 2' });
    const secondPlanAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of secondPlanAgent.run({ session, input: 'refine the plan' }).events) {
      // drain
    }

    const prompt = JSON.stringify(llm.promptHistory[1] ?? '');
    const reminderOccurrences = prompt.split('Plan mode is active').length - 1;
    assert.strictEqual(reminderOccurrences, 1, 'expected the plan reminder text to appear once in the second prompt');

    const modeReminders = getModeReminderMessages(session);
    assert.strictEqual(modeReminders.length, 1, 'expected only one persisted plan-mode reminder');
    assertSecondTurnCacheReuse(llm, session, 'repeated plan mode turn');
  });

  test('prompt cache - multi-turn mode cycles preserve cache and append only transition reminders', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    const turns: Array<{ mode: 'build' | 'plan'; input: string; reply: string }> = [
      { mode: 'build', input: 'hello', reply: 'build-1' },
      { mode: 'plan', input: 'make a plan', reply: 'plan-1' },
      { mode: 'build', input: 'execute it', reply: 'build-2' },
      { mode: 'build', input: 'keep going', reply: 'build-3' },
      { mode: 'plan', input: 're-plan', reply: 'plan-2' },
    ];

    for (const turn of turns) {
      llm.queueResponse({ kind: 'text', content: turn.reply });
      const agent = new LingyunAgent(llm, { model: 'mock-model', mode: turn.mode }, registry, {
        allowExternalPaths: false,
        skills: { enabled: false },
      });
      for await (const _event of agent.run({ session, input: turn.input }).events) {
        // drain
      }
    }

    const tokenHistory = getAssistantTokenHistoryFromSession(session);
    assert.strictEqual(tokenHistory.length, turns.length);
    for (let turnIndex = 1; turnIndex < turns.length; turnIndex++) {
      assertCacheReuseBetweenTurns(llm, session, turnIndex, `mode cycle turn ${turnIndex}`);
    }

    const modeReminders = getModeReminderMessages(session);
    assert.deepStrictEqual(
      modeReminders.map((message) => message.metadata?.modeReminder),
      [
        { mode: 'plan', kind: 'plan' },
        { mode: 'build', kind: 'build-switch' },
        { mode: 'plan', kind: 'plan' },
      ],
      'expected only actual mode transitions to append persisted reminders',
    );

    const lastPrompt = JSON.stringify(llm.promptHistory[3] ?? '');
    assert.strictEqual(
      lastPrompt.split('operational mode has changed from plan to build').length - 1,
      1,
      'steady-state build turns should not duplicate the build-switch reminder',
    );
  });

  test('prompt cache - resume in plan mode preserves cache and does not append duplicate reminders', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'plan reply' });
    const agent = new LingyunAgent(llm, { model: 'claude-sonnet-4.5', mode: 'plan' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });

    for await (const _event of agent.run({ session, input: 'make a plan' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'continued plan reply' });
    await agent.resume({ session });

    assertCacheReuseBetweenTurns(llm, session, 1, 'plan resume');

    const prompt = JSON.stringify(llm.promptHistory[1] ?? '');
    assert.strictEqual(
      prompt.split('Plan mode is active').length - 1,
      1,
      'resume prompt should contain exactly one persisted plan reminder',
    );

    const modeReminders = getModeReminderMessages(session);
    assert.strictEqual(modeReminders.length, 1, 'resume should not append a duplicate plan reminder');
  });

  test('prompt cache - restored sessions preserve explicit mode reminders and cacheable prefixes', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({ kind: 'text', content: 'plan reply' });
    const originalAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan', sessionId: 'cache-restore-session' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    const originalSession = new LingyunSession();

    for await (const _event of originalAgent.run({ session: originalSession, input: 'make a plan' }).events) {
      // drain
    }

    const restoredSession = restoreSession(snapshotSession(originalSession, { sessionId: 'cache-restore-session' }));
    llm.queueResponse({ kind: 'text', content: 'refined plan reply' });
    const restoredAgent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan', sessionId: 'cache-restore-session' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of restoredAgent.run({ session: restoredSession, input: 'refine it' }).events) {
      // drain
    }

    assertCacheReuseBetweenTurns(llm, restoredSession, 1, 'restored plan session');

    const modeReminders = getModeReminderMessages(restoredSession);
    assert.strictEqual(modeReminders.length, 1, 'restored session should retain the original plan reminder without duplicating it');
    assert.strictEqual(modeReminders[0]?.metadata?.modeReminder?.mode, 'plan');
  });

  test('prompt cache - steered pending input preserves cache and does not duplicate mode reminders', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({ kind: 'text', content: 'first plan reply' });
    llm.queueResponse({ kind: 'text', content: 'follow-up plan reply' });

    const agent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    const session = new LingyunSession();

    let injected = false;
    const run = agent.run({
      session,
      input: 'start',
      callbacks: {
        onAssistantToken: () => {
          if (injected) return;
          injected = true;
          session.enqueuePendingInput('follow-up from user');
        },
      },
    });

    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'follow-up plan reply');
    assert.strictEqual(llm.callCount, 2);
    assertCacheReuseBetweenTurns(llm, session, 1, 'plan-mode steered input');

    const modeReminders = getModeReminderMessages(session);
    assert.strictEqual(modeReminders.length, 1, 'draining pending input should not append duplicate plan reminders');
    assert.strictEqual(modeReminders[0]?.metadata?.modeReminder?.kind, 'plan');
  });

  test('prompt cache - changing systemPrompt does not rewrite an established session prefix', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'default reply' });
    const defaultAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of defaultAgent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'custom reply' });
    const customAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', systemPrompt: 'Custom cache-sensitive system prompt.' },
      registry,
      {
        allowExternalPaths: false,
        skills: { enabled: false },
      },
    );
    for await (const _event of customAgent.run({ session, input: 'follow up' }).events) {
      // drain
    }

    const firstPrompt = JSON.stringify(llm.promptHistory[0] ?? '');
    const secondPrompt = JSON.stringify(llm.promptHistory[1] ?? '');
    assert.ok(!firstPrompt.includes('Custom cache-sensitive system prompt.'), 'first prompt should use the default system prompt');
    assert.ok(!secondPrompt.includes('Custom cache-sensitive system prompt.'), 'follow-up should retain the first system prompt');
    assertSecondTurnCacheReuse(llm, session, 'frozen systemPrompt');
  });

  test('prompt cache - repeated systemPrompt changes stay deferred for the session', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'default reply' });
    const defaultAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of defaultAgent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'custom reply' });
    const customAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', systemPrompt: 'Custom cache-sensitive system prompt.' },
      registry,
      {
        allowExternalPaths: false,
        skills: { enabled: false },
      },
    );
    for await (const _event of customAgent.run({ session, input: 'follow up with custom prompt' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'default reply again' });
    for await (const _event of defaultAgent.run({ session, input: 'back to the default prompt' }).events) {
      // drain
    }

    const prompts = JSON.stringify(llm.promptHistory);
    assert.ok(!prompts.includes('Custom cache-sensitive system prompt.'), 'the initial system prompt must remain frozen');
    assertCacheReuseBetweenTurns(llm, session, 1, 'first deferred systemPrompt change');
    assertCacheReuseBetweenTurns(llm, session, 2, 'second deferred systemPrompt change');
  });

  test('prompt cache invalidation - changing toolFilter invalidates via tool set drift', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    registry.registerTool(
      {
        id: 'z_tool',
        name: 'Z tool',
        description: 'last alphabetically',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.z_tool' },
      },
      async () => ({ success: true, data: 'z' }),
    );
    registry.registerTool(
      {
        id: 'a_tool',
        name: 'A tool',
        description: 'first alphabetically',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.a_tool' },
      },
      async () => ({ success: true, data: 'a' }),
    );

    llm.queueResponse({ kind: 'text', content: 'first' });
    const wideAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', toolFilter: ['a_tool', 'z_tool'] },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );
    for await (const _event of wideAgent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'second' });
    const narrowAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', toolFilter: ['a_tool'] },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );
    for await (const _event of narrowAgent.run({ session, input: 'follow up' }).events) {
      // drain
    }

    assert.deepStrictEqual(
      (llm.toolNameHistory[0] ?? []).filter((tool) => tool === 'a_tool' || tool === 'z_tool'),
      ['a_tool', 'z_tool'],
      'first turn should expose both filtered tools in sorted order',
    );
    assert.deepStrictEqual(
      (llm.toolNameHistory[1] ?? []).filter((tool) => tool === 'a_tool' || tool === 'z_tool'),
      ['a_tool'],
      'second turn should expose only the narrowed tool set',
    );
    assertSecondTurnCacheInvalidation(llm, session, 'toolFilter change', {
      promptPrefixPreserved: true,
      toolOrderingPreserved: false,
    });
  });

  test('toolFilter wildcard matching escapes regexp syntax before exposing tools', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    registry.registerTool(
      {
        id: 'a_tool',
        name: 'A tool',
        description: 'matches a literal wildcard pattern only',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.a_tool' },
      },
      async () => ({ success: true, data: 'a' }),
    );
    registry.registerTool(
      {
        id: 'ab_tool',
        name: 'AB tool',
        description: 'would match an unescaped regexp dot',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.ab_tool' },
      },
      async () => ({ success: true, data: 'ab' }),
    );

    llm.queueResponse({ kind: 'text', content: 'first' });
    const wildcardAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', toolFilter: ['a_*'] },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );
    for await (const _event of wildcardAgent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'second' });
    const escapedAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', toolFilter: ['a.*'] },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );
    for await (const _event of escapedAgent.run({ session, input: 'follow up' }).events) {
      // drain
    }

    assert.deepStrictEqual(llm.toolNameHistory[0], ['a_tool']);
    assert.deepStrictEqual(llm.toolNameHistory[1], []);
  });

  test('prompt cache - restoring a previous toolFilter can reuse an older cached baseline', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    registry.registerTool(
      {
        id: 'z_tool',
        name: 'Z tool',
        description: 'last alphabetically',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.z_tool' },
      },
      async () => ({ success: true, data: 'z' }),
    );
    registry.registerTool(
      {
        id: 'a_tool',
        name: 'A tool',
        description: 'first alphabetically',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.a_tool' },
      },
      async () => ({ success: true, data: 'a' }),
    );

    const wideAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', toolFilter: ['a_tool', 'z_tool'] },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );
    const narrowAgent = new LingyunAgent(
      llm,
      { model: 'mock-model', toolFilter: ['a_tool'] },
      registry,
      { allowExternalPaths: false, skills: { enabled: false } },
    );

    llm.queueResponse({ kind: 'text', content: 'wide-1' });
    for await (const _event of wideAgent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'narrow-1' });
    for await (const _event of narrowAgent.run({ session, input: 'narrow it' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'wide-2' });
    for await (const _event of wideAgent.run({ session, input: 'widen it again' }).events) {
      // drain
    }

    assertCacheInvalidationBetweenTurns(llm, session, 1, 'toolFilter narrowing still invalidates immediately', {
      promptPrefixPreserved: true,
      toolOrderingPreserved: false,
    });
    assertCacheReuseAgainstTurn(llm, session, 2, 0, 'restored wide toolFilter baseline');
  });

  test('prompt cache - allowExternalPaths does not rewrite the established skills catalog', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skill-catalog-workspace-'));
    const externalSkillRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skill-catalog-external-'));
    const skillDir = path.join(externalSkillRoot, 'ext-skill');
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: external-cache-skill',
          'description: external skill used for prompt cache invalidation tests.',
          '---',
          '',
          '# External Cache Skill',
          '',
          '- This skill exists outside the workspace.',
        ].join('\n'),
      );

      const llm = new CacheAwareMockLLMProvider();
      const registry = new ToolRegistry();
      const session = new LingyunSession();

      llm.queueResponse({ kind: 'text', content: 'first' });
      const blockedAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: false,
        skills: { enabled: true, paths: [externalSkillRoot] },
      });
      for await (const _event of blockedAgent.run({ session, input: 'hello' }).events) {
        // drain
      }

      llm.queueResponse({ kind: 'text', content: 'second' });
      const allowedAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: true,
        skills: { enabled: true, paths: [externalSkillRoot] },
      });
      for await (const _event of allowedAgent.run({ session, input: 'follow up' }).events) {
        // drain
      }

      const firstPrompt = JSON.stringify(llm.promptHistory[0] ?? '');
      const secondPrompt = JSON.stringify(llm.promptHistory[1] ?? '');
      assert.ok(
        !firstPrompt.includes('external-cache-skill'),
        'first prompt should not list the external skill when external paths are disabled',
      );
      assert.ok(
        !secondPrompt.includes('external-cache-skill'),
        'follow-up should preserve the first request skills catalog',
      );
      assertSecondTurnCacheReuse(llm, session, 'frozen skills catalog');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(externalSkillRoot, { recursive: true, force: true });
    }
  });

  test('prompt cache - toggling the external skill catalog never replaces the initial snapshot', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skill-catalog-toggle-workspace-'));
    const externalSkillRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skill-catalog-toggle-external-'));
    const skillDir = path.join(externalSkillRoot, 'ext-skill');
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: external-cache-skill',
          'description: external skill used for prompt cache toggle tests.',
          '---',
          '',
          '# External Cache Skill',
          '',
          '- This skill exists outside the workspace.',
        ].join('\n'),
      );

      const llm = new CacheAwareMockLLMProvider();
      const registry = new ToolRegistry();
      const session = new LingyunSession();

      const allowedAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: true,
        skills: { enabled: true, paths: [externalSkillRoot] },
      });
      const blockedAgent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: false,
        skills: { enabled: true, paths: [externalSkillRoot] },
      });

      llm.queueResponse({ kind: 'text', content: 'allowed-1' });
      for await (const _event of allowedAgent.run({ session, input: 'hello with external skills' }).events) {
        // drain
      }

      llm.queueResponse({ kind: 'text', content: 'allowed-2' });
      for await (const _event of allowedAgent.run({ session, input: 'follow up with external skills' }).events) {
        // drain
      }

      llm.queueResponse({ kind: 'text', content: 'blocked-1' });
      for await (const _event of blockedAgent.run({ session, input: 'hide external skills now' }).events) {
        // drain
      }

      llm.queueResponse({ kind: 'text', content: 'blocked-2' });
      for await (const _event of blockedAgent.run({ session, input: 'stay hidden' }).events) {
        // drain
      }

      llm.queueResponse({ kind: 'text', content: 'allowed-3' });
      for await (const _event of allowedAgent.run({ session, input: 'show external skills again' }).events) {
        // drain
      }

      assertCacheReuseBetweenTurns(llm, session, 1, 'steady-state external skill catalog');
      assertCacheReuseBetweenTurns(llm, session, 2, 'first deferred external skill setting change');
      assertCacheReuseBetweenTurns(llm, session, 3, 'steady-state deferred external skill setting');
      assertCacheReuseBetweenTurns(llm, session, 4, 'restored external skill setting');
      assert.ok(
        llm.promptHistory.every((prompt) => JSON.stringify(prompt).includes('external-cache-skill')),
        'every turn should retain the initial skills catalog',
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(externalSkillRoot, { recursive: true, force: true });
    }
  });

  test('prompt cache invalidation - compaction resets the prompt baseline for subsequent turns', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();

    llm.queueResponse({ kind: 'text', content: 'first reply' });
    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    for await (const _event of agent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'summary after compaction' });
    await agent.compactSession(session);

    llm.queueResponse({ kind: 'text', content: 'follow-up after compaction' });
    for await (const _event of agent.run({ session, input: 'continue' }).events) {
      // drain
    }

    const tokenHistory = getAssistantTokenHistoryFromSession(session);
    assert.strictEqual(tokenHistory.length, 2, 'expected compaction to replace earlier history with summary + follow-up reply');
    assert.strictEqual(llm.promptHistory.length, 3, 'expected one main turn, one compaction request, and one follow-up turn');
    assert.ok(session.getHistory().some((message) => message.role === 'assistant' && message.metadata?.summary), 'expected compaction summary to be retained in effective history');

    const followUpTokens = tokenHistory[1]!;
    const followUpTools = llm.toolNameHistory[2] ?? [];
    const followUpFootprint = estimatePromptCacheFootprint(llm.promptHistory[2], followUpTools);
    assert.strictEqual(llm.cacheReadHistory[2] ?? 0, 0, 'follow-up after compaction should not reuse the compaction prompt');
    assert.strictEqual(followUpTokens.cacheRead ?? 0, 0, 'follow-up after compaction should record no cache read');
    assert.strictEqual(followUpTokens.cacheWrite, followUpFootprint, 'follow-up after compaction should rewrite the full prompt footprint');
    assert.strictEqual(followUpTokens.input, followUpFootprint, 'follow-up after compaction should be fully uncached');
    assert.strictEqual(
      hasPromptCachePrefix(llm.promptHistory[1], llm.promptHistory[2]),
      false,
      'follow-up after compaction should not extend the compaction prompt as a cacheable prefix',
    );
  });

  test('prompt cache - a newly mentioned skill mid-session preserves the cached prefix', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-cache-new-skill-'));
    const skillDir = path.join(workspaceRoot, '.lingyun', 'skills', 'ask');
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: ask-questions-if-underspecified',
          'description: Clarify requirements before implementing.',
          '---',
          '',
          '# Ask Questions If Underspecified',
          '',
          '- Ask must-have questions before implementing.',
        ].join('\n'),
      );

      const llm = new CacheAwareMockLLMProvider();
      const registry = new ToolRegistry();
      const session = new LingyunSession();
      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: false,
        skills: { enabled: true, paths: ['.lingyun/skills'] },
      });

      llm.queueResponse({ kind: 'text', content: 'first reply' });
      for await (const _event of agent.run({ session, input: 'hello there' }).events) {
        // drain
      }

      llm.queueResponse({ kind: 'text', content: 'second reply' });
      for await (const _event of agent.run({ session, input: 'Please use $ask-questions-if-underspecified now' }).events) {
        // drain
      }

      assertSecondTurnCacheReuse(llm, session, 'mid-session skill activation');
      const prompt = JSON.stringify(llm.promptHistory[1] ?? '');
      assert.ok(prompt.includes('<skill>'), 'second prompt should include the newly injected skill block');
      assert.ok(prompt.includes('$ask-questions-if-underspecified') || prompt.includes('ask-questions-if-underspecified'), 'second prompt should reflect the activated skill');
      assert.strictEqual(
        session.getHistory().filter((message) => message.role === 'user' && message.metadata?.skill).length,
        1,
        'skill activation should persist a single synthetic skill message in history',
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('skill injection assembles bounded prompt text without temporary arrays', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/agent.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private async injectSkillsForUserText');
    assert.ok(start >= 0, 'expected skill injection helper');
    const end = source.indexOf('\n  run(params:', start);
    assert.ok(end > start, 'expected run method after skill injection helper');
    const section = source.slice(start, end);

    assert.match(section, /let activeLabel = '';/);
    assert.match(section, /let blocksText = '';/);
    assert.match(section, /if \(blocksText\) blocksText \+= '\\n\\n';/);
    assert.doesNotMatch(section, /selected\.slice\(0,\s*maxSkills\)/);
    assert.doesNotMatch(section, /selectedForInject/);
    assert.doesNotMatch(section, /\.filter\(Boolean\)/);
    assert.doesNotMatch(section, /\.\.\.blocks/);
    assert.doesNotMatch(section, /\.map\(\(s: SkillInfo\)/);
  });

  test('runOnce prompt assembly avoids copy reverse and spread-map arrays', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/runOnce.ts', import.meta.url), 'utf8');
    const messageStart = source.indexOf('message: getLastUserMessageText(session)');
    assert.ok(messageStart >= 0, 'expected chat params to use reverse scanner helper');

    const promptStart = source.indexOf('const promptMessages: ModelMessage[] = [];');
    assert.ok(promptStart >= 0, 'expected prompt message assembly');
    const promptEnd = source.indexOf('let assistantMessage = createAssistantHistoryMessage();', promptStart);
    assert.ok(promptEnd > promptStart, 'expected assistant message setup after prompt assembly');
    const promptSection = source.slice(promptStart, promptEnd);

    const cleanupStart = source.indexOf('let keptPartCount = 0;');
    assert.ok(cleanupStart >= 0, 'expected in-place assistant part cleanup');
    const cleanupEnd = source.indexOf('let finalText = cleanedText;', cleanupStart);
    assert.ok(cleanupEnd > cleanupStart, 'expected finalText after cleanup');
    const cleanupSection = source.slice(cleanupStart, cleanupEnd);

    assert.doesNotMatch(source, /\[\.\.\.session\.history\]\.reverse\(\)\.find/);
    assert.doesNotMatch(promptSection, /systemParts\.map/);
    assert.doesNotMatch(promptSection, /\.\.\.modelMessages/);
    assert.match(promptSection, /for \(const text of systemParts\)/);
    assert.match(promptSection, /for \(const message of modelMessages\)/);
    assert.doesNotMatch(cleanupSection, /assistantMessage\.parts\.filter/);
    assert.match(cleanupSection, /assistantMessage\.parts\.length = keptPartCount;/);
  });

  test('compaction session state keeps latest file handles without entries-map arrays', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    session.history.push({
      id: 'seed-user',
      role: 'user',
      parts: [{ type: 'text', text: 'seed before compaction' }],
    } as AgentHistoryMessage);
    session.fileHandles = { nextId: 13, byId: {} };
    for (let index = 1; index <= 12; index++) {
      session.fileHandles.byId[`F${index}`] = `src/file${index}.ts`;
    }

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });

    llm.queueResponse({ kind: 'text', content: 'summary after compaction' });
    await agent.compactSession(session);

    const restoredState = session
      .getHistory()
      .find((message) => message.role === 'system' && message.metadata?.compactionRestore?.source === 'sessionState');
    assert.ok(restoredState, 'compaction should restore file handle session state');
    const restoredText = getMessageText(restoredState);

    assert.doesNotMatch(restoredText, /- F1: src\/file1\.ts/);
    assert.doesNotMatch(restoredText, /- F2: src\/file2\.ts/);
    assert.match(restoredText, /- F3: src\/file3\.ts/);
    assert.match(restoredText, /- F12: src\/file12\.ts/);
    assert.strictEqual((restoredText.match(/- F\d+: src\/file\d+\.ts/g) || []).length, 10);

    const source = await fs.readFile(new URL('../../../src/agent/compaction.ts', import.meta.url), 'utf8');
    const helperStart = source.indexOf('function buildLatestFileHandleSection');
    assert.ok(helperStart >= 0, 'expected latest file handle section helper');
    const helperEnd = source.indexOf('function buildSessionStateRestoreText', helperStart);
    assert.ok(helperEnd > helperStart, 'expected session state restore helper after file handle helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const promptStart = source.indexOf('function buildCompactionPromptText');
    assert.ok(promptStart >= 0, 'expected compaction prompt text helper');
    const promptEnd = source.indexOf('function appendHistoryWithoutIds', promptStart);
    assert.ok(promptEnd > promptStart, 'expected ID stripping helper after prompt text helper');
    const promptSection = source.slice(promptStart, promptEnd);
    const appendEnd = source.indexOf('function buildSessionStateRestoreText', promptEnd);
    assert.ok(appendEnd > promptEnd, 'expected session state restore helper after ID stripping helper');
    const appendSection = source.slice(promptEnd, appendEnd);
    const restoreStart = helperEnd;
    const restoreEnd = source.indexOf('export async function compactSessionInternal', restoreStart);
    assert.ok(restoreEnd > restoreStart, 'expected compaction entrypoint after session state restore helper');
    const restoreSection = source.slice(restoreStart, restoreEnd);
    const compactStart = restoreEnd;
    const compactEnd = source.indexOf('const rawModel = await params.llm.getModel', compactStart);
    assert.ok(compactEnd > compactStart, 'expected model setup after compaction prompt assembly');
    const compactPromptSection = source.slice(compactStart, compactEnd);
    const preparedStart = source.indexOf('const effective = normalizeSyntheticContextMessageRoles', compactStart);
    assert.ok(preparedStart > compactStart, 'expected effective history setup in compaction');
    const preparedEnd = source.indexOf('const compactionModelMessages = params.providerBehavior.transformModelMessages', preparedStart);
    assert.ok(preparedEnd > preparedStart, 'expected provider transform after compaction history conversion');
    const preparedSection = source.slice(preparedStart, preparedEnd);

    assert.match(helperSection, /for \(const id in byId\)/);
    assert.match(helperSection, /Object\.prototype\.hasOwnProperty\.call\(byId, id\)/);
    assert.match(helperSection, /fileHandleCount % MAX_FILE_HANDLES/);
    assert.match(helperSection, /Math\.min\(fileHandleCount, MAX_FILE_HANDLES\)/);
    assert.match(promptSection, /let promptText = COMPACTION_PROMPT_TEXT;/);
    assert.match(promptSection, /for \(const item of context\)/);
    assert.match(promptSection, /promptText \+= `\\n\\n\$\{item\}`;/);
    assert.match(appendSection, /for \(const message of history\)/);
    assert.match(appendSection, /const \{ id: _id, \.\.\.rest \} = message;/);
    assert.match(appendSection, /target\.push\(rest\);/);
    assert.match(restoreSection, /const fileHandleSection = buildLatestFileHandleSection\(session\.fileHandles\);/);
    assert.match(compactPromptSection, /const promptText = buildCompactionPromptText\(compacting\);/);
    assert.match(preparedSection, /const compactionHistoryInput: any\[\] = \[\];/);
    assert.match(preparedSection, /appendHistoryWithoutIds\(compactionHistoryInput, prepared\);/);
    assert.match(preparedSection, /compactionHistoryInput\.push\(compactionUser as any\);/);
    assert.doesNotMatch(helperSection, /Object\.entries/);
    assert.doesNotMatch(helperSection, /\.slice\(/);
    assert.doesNotMatch(helperSection, /\.map\(/);
    assert.doesNotMatch(promptSection, /\.filter\(Boolean\)/);
    assert.doesNotMatch(promptSection, /\.\.\.extraContext/);
    assert.doesNotMatch(appendSection, /\.map\(/);
    assert.doesNotMatch(restoreSection, /Object\.entries\(session\.fileHandles/);
    assert.doesNotMatch(restoreSection, /fileEntries\.map/);
    assert.doesNotMatch(compactPromptSection, /\.filter\(Boolean\)/);
    assert.doesNotMatch(preparedSection, /prepared\.map/);
    assert.doesNotMatch(preparedSection, /\[\.\.\.withoutIds/);
  });

  test('prompt cache - a new baseline is cacheable again after compaction', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });

    llm.queueResponse({ kind: 'text', content: 'first reply' });
    for await (const _event of agent.run({ session, input: 'hello' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'summary after compaction' });
    await agent.compactSession(session);

    llm.queueResponse({ kind: 'text', content: 'follow-up after compaction' });
    for await (const _event of agent.run({ session, input: 'continue' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'second follow-up after compaction' });
    for await (const _event of agent.run({ session, input: 'continue again' }).events) {
      // drain
    }

    const tokenHistory = getAssistantTokenHistoryFromSession(session);
    assert.strictEqual(tokenHistory.length, 3, 'expected compaction summary plus two post-compaction assistant replies');
    assert.strictEqual(llm.promptHistory.length, 4, 'expected one normal turn, one compaction request, and two follow-up turns');

    const previousPrompt = llm.promptHistory[2];
    const currentPrompt = llm.promptHistory[3];
    const previousTools = llm.toolNameHistory[2] ?? [];
    const currentTools = llm.toolNameHistory[3] ?? [];
    const currentTokens = tokenHistory[2]!;
    const previousFootprint = estimatePromptCacheFootprint(previousPrompt, previousTools);

    assert.ok(hasPromptCachePrefix(previousPrompt, currentPrompt), 'second post-compaction turn should extend the first post-compaction prompt');
    assert.deepStrictEqual(currentTools, previousTools, 'tool ordering should stay stable after compaction baseline is re-established');
    assert.strictEqual(llm.cacheReadHistory[3], previousFootprint, 'second post-compaction turn should read the full rebuilt baseline from cache');
    assert.strictEqual(currentTokens.cacheRead, previousFootprint, 'second post-compaction assistant tokens should record a full cache read');
    assert.strictEqual(currentTokens.cacheWrite ?? 0, 0, 'second post-compaction turn should not rewrite cached prefix tokens');
  });

  test('prompt cache - plan mode survives compaction without duplicate reminders and still reuses cache', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    const agent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });

    llm.queueResponse({ kind: 'text', content: 'plan reply before compaction' });
    for await (const _event of agent.run({ session, input: 'make a plan' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'plan summary after compaction' });
    await agent.compactSession(session);

    llm.queueResponse({ kind: 'text', content: 'plan reply after compaction' });
    for await (const _event of agent.run({ session, input: 'continue planning' }).events) {
      // drain
    }

    llm.queueResponse({ kind: 'text', content: 'another plan reply after compaction' });
    for await (const _event of agent.run({ session, input: 'refine the plan again' }).events) {
      // drain
    }

    const firstPostCompactionPrompt = JSON.stringify(llm.promptHistory[2] ?? '');
    const secondPostCompactionPrompt = JSON.stringify(llm.promptHistory[3] ?? '');
    assert.strictEqual(
      firstPostCompactionPrompt.split('Plan mode is active').length - 1,
      0,
      'first post-compaction plan turn should preserve plan mode via existing history without re-emitting a reminder',
    );
    assert.strictEqual(
      secondPostCompactionPrompt.split('Plan mode is active').length - 1,
      0,
      'second post-compaction plan turn should not duplicate the plan reminder',
    );

    const modeReminders = getModeReminderMessages(session);
    assert.strictEqual(modeReminders.length, 0, 'effective post-compaction history should not need an explicit plan reminder');

    const tokenHistory = getAssistantTokenHistoryFromSession(session);
    const previousPrompt = llm.promptHistory[2];
    const currentPrompt = llm.promptHistory[3];
    const previousTools = llm.toolNameHistory[2] ?? [];
    const currentTools = llm.toolNameHistory[3] ?? [];
    const currentTokens = tokenHistory[2]!;
    const previousFootprint = estimatePromptCacheFootprint(previousPrompt, previousTools);

    assert.ok(hasPromptCachePrefix(previousPrompt, currentPrompt), 'second post-compaction plan turn should extend the re-established baseline');
    assert.deepStrictEqual(currentTools, previousTools, 'tool ordering should stay stable in plan mode after compaction');
    assert.strictEqual(llm.cacheReadHistory[3], previousFootprint, 'second post-compaction plan turn should read from cache');
    assert.strictEqual(currentTokens.cacheRead, previousFootprint, 'assistant token accounting should show a cache read on the second post-compaction plan turn');
  });

  test('compaction preserves native OpenAI-compatible content byte-for-byte', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    const literalSummary = '  lone </think> and paired <think>source</think> stay visible\n';
    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });

    llm.queueResponse({ kind: 'text', content: 'history to compact' });
    await agent.run({ session, input: 'start' }).done;

    llm.queueResponse({ kind: 'text', content: literalSummary });
    await agent.compactSession(session);

    const summary = session.getHistory().find((message) =>
      message.role === 'assistant' && message.metadata?.summary === true
    );
    assert.ok(summary, 'expected a compaction summary message');
    assert.strictEqual(
      getMessageText(summary),
      literalSummary,
      'compaction must not parse, strip, or trim native OpenAI-compatible content',
    );
  });

  test('prompt - replays native reasoning and literal assistant text for openaiCompatible providers', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({
      kind: 'stream',
      chunks: [
        { type: 'reasoning-start' as const, id: 'r1' },
        { type: 'reasoning-delta' as const, id: 'r1', delta: 'hidden reasoning ' },
        { type: 'reasoning-end' as const, id: 'r1' },
        { type: 'text-start' as const, id: 't1' },
        { type: 'text-delta' as const, id: 't1', delta: ' literal </think> and ' },
        { type: 'text-delta' as const, id: 't1', delta: '<think>source</think> stays visible\n' },
        { type: 'text-end' as const, id: 't1' },
        { type: 'finish' as const, usage: usage(), finishReason: { unified: 'stop', raw: 'stop' } },
      ],
    });
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    for await (const _event of agent.run({ session, input: 'hi' }).events) {
      // drain
    }
    await agent.run({ session, input: 'follow up' }).done;

    const prompt = llm.lastPrompt as any[];
    const assistant = prompt.find((msg) => msg?.role === 'assistant');
    assert.ok(assistant, 'expected assistant message in prompt');
    assert.strictEqual(assistant.providerOptions?.openaiCompatible?.reasoning_content, 'hidden reasoning ');
    assert.ok(Array.isArray(assistant.content), 'expected multipart assistant content');
    assert.strictEqual(
      (assistant.content as any[]).some((part) => part?.type === 'reasoning'),
      false,
      'reasoning parts should be lifted to reasoning_content',
    );
    const assistantText = (assistant.content as any[])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('');
    assert.strictEqual(assistantText, ' literal </think> and <think>source</think> stays visible\n');
  });

  test('prompt helpers preserve replay metadata while removing reasoning from provider payloads', () => {
    const toolPart = { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: {} };
    const history = [{
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'display reasoning', providerMetadata: { openai: { id: 'reasoning-meta' } } },
        { type: 'text', text: 'display text', providerMetadata: { openai: { id: 'text-meta' } } },
        toolPart,
      ],
      metadata: {
        replay: {
          text: 'raw text',
          reasoning: 'raw reasoning',
          copilot: { reasoningOpaque: 'opaque-token' },
        },
      },
    }] as AgentHistoryMessage[];

    const replayed = applyAssistantReplayForPrompt(history);
    assert.notStrictEqual(replayed, history);
    assert.deepStrictEqual(replayed[0]!.parts, [
      {
        type: 'reasoning',
        text: 'raw reasoning',
        state: 'done',
        providerMetadata: {
          openai: { id: 'reasoning-meta' },
          copilot: { reasoningOpaque: 'opaque-token' },
        },
      },
      {
        type: 'text',
        text: 'raw text',
        state: 'done',
        providerMetadata: { openai: { id: 'text-meta' } },
      },
      toolPart,
    ]);
    assert.strictEqual((history[0]!.parts[0] as any).text, 'display reasoning');

    const unchangedHistory = [{
      role: 'assistant',
      parts: [{ type: 'text', text: 'already prompt-ready' }],
    }] as AgentHistoryMessage[];
    assert.strictEqual(applyAssistantReplayForPrompt(unchangedHistory), unchangedHistory);

    const noReasoningReplay = applyAssistantReplayForPrompt([{
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'visible' },
        toolPart,
      ],
    } as AgentHistoryMessage], { includeReasoning: false });
    assert.deepStrictEqual(noReasoningReplay[0]!.parts, [
      { type: 'text', text: 'visible' },
      toolPart,
    ]);

    const modelMessages = [{
      role: 'assistant',
      content: [
        { type: 'text', text: 'shown before' },
        { type: 'reasoning', text: 'hidden ' },
        toolPart,
        { type: 'reasoning', text: 'chain' },
      ],
      providerOptions: { openaiCompatible: { keep: true }, custom: { stable: true } },
    }] as any[];
    const openaiMessages = applyOpenAICompatibleReasoningField(modelMessages as any);
    assert.deepStrictEqual(openaiMessages[0]!.content, [
      { type: 'text', text: 'shown before' },
      toolPart,
    ]);
    assert.deepStrictEqual(openaiMessages[0]!.providerOptions, {
      openaiCompatible: { keep: true, reasoning_content: 'hidden chain' },
      custom: { stable: true },
    });

    const copilotNoTextReasoning = [{
      role: 'assistant',
      content: [{ type: 'reasoning' }, { type: 'text', text: 'visible' }],
    }] as any[];
    assert.strictEqual(applyCopilotReasoningFields(copilotNoTextReasoning as any), copilotNoTextReasoning);
  });

  test('prompt helpers avoid mapped message arrays on no-op paths', async () => {
    const modelMessages = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ready' }] },
    ] as any[];
    const history = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'ready' }] },
    ] as AgentHistoryMessage[];

    assert.strictEqual(applyCopilotImageInputPattern(modelMessages as any), modelMessages);
    assert.strictEqual(applyOpenAICompatibleReasoningField(modelMessages as any), modelMessages);
    assert.strictEqual(applyCopilotReasoningFields(modelMessages as any), modelMessages);
    assert.strictEqual(applyAssistantReplayForPrompt(history), history);

    const source = await fs.readFile(new URL('../../../../core/src/modelMessages.ts', import.meta.url), 'utf8');
    const helperStart = source.indexOf('function appendChangedItem');
    assert.ok(helperStart >= 0, 'expected changed-item append helper');
    const helperEnd = source.indexOf('/**\n * Apply Codex-style image boundaries', helperStart);
    assert.ok(helperEnd > helperStart, 'expected image helper after changed-item helper');
    const helperSection = source.slice(helperStart, helperEnd);

    const imageStart = source.indexOf('export function applyCopilotImageInputPattern');
    assert.ok(imageStart >= 0, 'expected image input helper');
    const imageEnd = source.indexOf('function isString', imageStart);
    assert.ok(imageEnd > imageStart, 'expected string helper after image input helper');
    const imageSection = source.slice(imageStart, imageEnd);

    const replayStart = source.indexOf('export function applyAssistantReplayForPrompt');
    assert.ok(replayStart >= 0, 'expected assistant replay helper');
    const replayEnd = source.indexOf('type ReasoningField', replayStart);
    assert.ok(replayEnd > replayStart, 'expected reasoning field type after replay helper');
    const replaySection = source.slice(replayStart, replayEnd);

    const openaiStart = source.indexOf('export function applyOpenAICompatibleReasoningField');
    assert.ok(openaiStart >= 0, 'expected OpenAI-compatible reasoning helper');
    const openaiEnd = source.indexOf("/**\n * Copilot's chat-completions backend", openaiStart);
    assert.ok(openaiEnd > openaiStart, 'expected Copilot helper after OpenAI-compatible helper');
    const openaiSection = source.slice(openaiStart, openaiEnd);

    const copilotStart = source.indexOf('export function applyCopilotReasoningFields');
    assert.ok(copilotStart >= 0, 'expected Copilot reasoning helper');
    const copilotSection = source.slice(copilotStart);

    assert.match(helperSection, /if \(!changed\) changed = source\.slice\(0, index\);/);
    assert.match(imageSection, /let nextMessages: ModelMessage\[\] \| undefined;/);
    assert.match(imageSection, /let transformed: unknown\[\] \| undefined;/);
    assert.match(imageSection, /transformed = content\.slice\(0, index\);/);
    assert.match(replaySection, /let nextHistory: AgentHistoryMessage\[\] \| undefined;/);
    assert.match(openaiSection, /let nextMessages: ModelMessage\[\] \| undefined;/);
    assert.match(copilotSection, /let nextMessages: ModelMessage\[\] \| undefined;/);
    for (const section of [imageSection, replaySection, openaiSection, copilotSection]) {
      assert.match(section, /appendChangedItem/);
      assert.doesNotMatch(section, /\.map\(\(message\)/);
      assert.doesNotMatch(section, /\.map\(\(msg\)/);
    }
  });

  test('provider option shaping drops empty namespaces without entries arrays', async () => {
    const emptyParams = { reasoningEffort: '', textVerbosity: '', openaiCompatibleThinking: '' };
    const gpt5Params = { reasoningEffort: 'high', textVerbosity: 'medium', openaiCompatibleThinking: '' };

    const copilot = createProviderBehavior('copilot');
    assert.strictEqual(copilot.getChatProviderOptions('gpt-4o', emptyParams), undefined);
    assert.deepStrictEqual(copilot.getChatProviderOptions('gpt-5.3-codex', gpt5Params), {
      copilot: { reasoningEffort: 'high', textVerbosity: 'medium' },
      openai: { reasoningEffort: 'high', textVerbosity: 'medium' },
    });

    const openaiCompatible = createProviderBehavior('openaiCompatible');
    assert.strictEqual(openaiCompatible.getChatProviderOptions('gpt-4o', emptyParams), undefined);
    assert.deepStrictEqual(
      openaiCompatible.getChatProviderOptions('deepseek-chat', {
        ...emptyParams,
        openaiCompatibleThinking: 'disabled',
      }),
      { openaiCompatible: { think: false } },
    );
    assert.deepStrictEqual(openaiCompatible.normalizeSystemPrompts(['System A', '', 'System B']), ['System A\nSystem B']);
    assert.deepStrictEqual(openaiCompatible.normalizeSystemPrompts(['']), ['']);
    assert.deepStrictEqual(openaiCompatible.normalizeSystemPrompts(['', '']), ['']);

    const source = await fs.readFile(new URL('../../../src/agent/providerBehavior.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function omitEmptyProviderOptions');
    assert.ok(start >= 0, 'expected provider option sanitizer');
    const end = source.indexOf('\n\n  if (llmId ===', start);
    assert.ok(end > start, 'expected provider branches after option sanitizer');
    const section = source.slice(start, end);

    assert.match(section, /let next: Record<string, unknown> \| undefined;/);
    assert.match(section, /for \(const key in options\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(options, key\)/);
    assert.match(section, /for \(const optionKey in value as Record<string, unknown>\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(value, optionKey\)/);
    assert.doesNotMatch(section, /Object\.entries/);
    assert.doesNotMatch(section, /Object\.fromEntries/);
    assert.doesNotMatch(section, /Object\.keys/);
    assert.doesNotMatch(section, /\.filter\(/);

    const openaiCompatibleStart = source.indexOf("if (llmId === 'openaiCompatible')", end);
    assert.ok(openaiCompatibleStart >= 0, 'expected OpenAI-compatible provider branch');
    const normalizeStart = source.indexOf('normalizeSystemPrompts(system) {', openaiCompatibleStart);
    assert.ok(normalizeStart >= 0, 'expected OpenAI-compatible system prompt normalizer');
    const normalizeEnd = source.indexOf('\n      },\n      getSyntheticResumeUserText', normalizeStart);
    assert.ok(normalizeEnd > normalizeStart, 'expected synthetic resume helper after system prompt normalizer');
    const normalizeSection = source.slice(normalizeStart, normalizeEnd);

    assert.match(normalizeSection, /let combined = '';/);
    assert.match(normalizeSection, /for \(const part of system\)/);
    assert.match(normalizeSection, /combined = combined \? `\$\{combined\}\\n\$\{part\}` : part;/);
    assert.doesNotMatch(normalizeSection, /\.filter\(Boolean\)/);
    assert.doesNotMatch(normalizeSection, /\.join\('\\n'\)/);
  });

  test('prompt composer assembles system prompts without filter chains', async () => {
    const triggerCalls: any[] = [];
    const composer = new PromptComposer({
      plugins: {
        async trigger(name: unknown, input: unknown, output: any) {
          triggerCalls.push({ name, input, output });
          return { system: [output.system[0], '', 'Plugin guidance', null, 'Final guard'] };
        },
      } as any,
      providerBehavior: {
        normalizeSystemPrompts(system: string[]) {
          return system;
        },
      } as any,
      skills: {
        async getSkillsPromptText() {
          return 'Skills block';
        },
      } as any,
    });

    const system = await composer.composeSystemPrompts('mock-model', {
      basePrompt: 'Base prompt',
      sessionId: 'session-1',
      mode: 'plan',
    });

    assert.deepStrictEqual(system, ['Base prompt\nSkills block', 'Plugin guidance\nFinal guard']);
    assert.deepStrictEqual(triggerCalls[0], {
      name: 'experimental.chat.system.transform',
      input: { sessionId: 'session-1', mode: 'plan', modelId: 'mock-model' },
      output: { system: ['Base prompt\nSkills block'] },
    });

    const emptyComposer = new PromptComposer({
      plugins: {
        async trigger() {
          return { system: [] };
        },
      } as any,
      providerBehavior: {
        normalizeSystemPrompts(system: string[]) {
          return system;
        },
      } as any,
      skills: {
        async getSkillsPromptText() {
          return undefined;
        },
      } as any,
    });
    assert.deepStrictEqual(await emptyComposer.composeSystemPrompts('mock-model'), ['']);

    const source = await fs.readFile(new URL('../../../src/agent/promptComposer.ts', import.meta.url), 'utf8');
    const start = source.indexOf('async composeSystemPrompts');
    assert.ok(start >= 0, 'expected system prompt composer');
    const returnStart = source.indexOf('return this.params.providerBehavior.normalizeSystemPrompts(system);', start);
    assert.ok(returnStart > start, 'expected provider normalization at end of composer');
    const end = source.indexOf('\n  }\n}', returnStart);
    assert.ok(end > returnStart, 'expected end of prompt composer class');
    const section = source.slice(start, end);

    assert.match(section, /let header = basePrompt;/);
    assert.match(section, /if \(skillsPromptText\)/);
    assert.match(section, /for \(const part of \(out as any\)\.system\)/);
    assert.match(section, /if \(part\) system\.push\(part\);/);
    assert.doesNotMatch(section, /\[basePrompt, skillsPromptText\]/);
    assert.doesNotMatch(section, /\.filter\(Boolean\)/);
  });

  test('model message transform receives id-stripped history without map-spread assembly', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    const session = new LingyunSession();
    let transformedMessages: any[] | undefined;

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
      plugins: {
        async trigger(name: unknown, _input: unknown, output: any) {
          if (name === 'experimental.chat.messages.transform') {
            transformedMessages = output.messages;
          }
          return output;
        },
      },
    });

    llm.queueResponse({ kind: 'text', content: 'ok' });
    for await (const _event of agent.run({ session, input: 'hello' }).events) {
      // drain
    }

    assert.ok(Array.isArray(transformedMessages), 'expected messages transform to receive history');
    assert.ok(transformedMessages.length > 0, 'expected non-empty model history');
    assert.strictEqual(
      transformedMessages.some((message) => message && typeof message === 'object' && 'id' in message),
      false,
      'model messages transform should not receive UI message ids',
    );

    const source = await fs.readFile(new URL('../../../src/agent/agent.ts', import.meta.url), 'utf8');
    const helperStart = source.indexOf('function appendHistoryWithoutIds');
    assert.ok(helperStart >= 0, 'expected ID stripping helper');
    const helperEnd = source.indexOf('\nexport type LingyunAgentSkillsRuntimeOptions', helperStart);
    assert.ok(helperEnd > helperStart, 'expected runtime options after ID stripping helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const start = source.indexOf('private async toModelMessages');
    assert.ok(start >= 0, 'expected toModelMessages helper');
    const end = source.indexOf('\n  private createToolContext', start);
    assert.ok(end > start, 'expected tool context after toModelMessages');
    const section = source.slice(start, end);

    assert.match(helperSection, /for \(const message of history\)/);
    assert.match(helperSection, /const \{ id: _id, \.\.\.rest \} = message;/);
    assert.match(helperSection, /target\.push\(rest\);/);
    assert.match(section, /const modelHistoryInput: any\[\] = \[\];/);
    assert.match(section, /appendHistoryWithoutIds\(modelHistoryInput, prepared\);/);
    assert.match(section, /const pluginMessagesInput: any\[\] = \[\];/);
    assert.match(section, /for \(const message of modelHistoryInput\)/);
    assert.match(section, /\{ messages: pluginMessagesInput \}/);
    assert.match(section, /: modelHistoryInput;/);
    assert.doesNotMatch(helperSection, /\.map\(/);
    assert.doesNotMatch(section, /prepared\.map/);
    assert.doesNotMatch(section, /const withoutIds/);
    assert.doesNotMatch(section, /\[\.\.\.withoutIds/);
  });

  test('prompt - treats DeepSeek reasoning_content as text when thinking is disabled', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({
      kind: 'stream',
      chunks: [
        { type: 'reasoning-start' as const, id: 'r1' },
        { type: 'reasoning-delta' as const, id: 'r1', delta: 'hello' },
        { type: 'reasoning-end' as const, id: 'r1' },
        { type: 'finish' as const, usage: usage(), finishReason: { unified: 'stop', raw: 'stop' } },
      ],
    });
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const agent = new LingyunAgent(llm, { model: 'deepseek-v4-flash' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const firstRun = agent.run({ session, input: 'hi' });
    for await (const _event of firstRun.events) {
      // drain
    }
    assert.strictEqual((await firstRun.done).text, 'hello');

    const firstAssistant = session.getHistory().find((msg) => msg.role === 'assistant');
    assert.ok(firstAssistant, 'expected assistant history');
    assert.strictEqual(getMessageText(firstAssistant), 'hello');
    assert.strictEqual(
      firstAssistant.parts.some((part: any) => part?.type === 'reasoning'),
      false,
      'reasoning content should not be stored as hidden thinking when disabled',
    );
    assert.strictEqual(firstAssistant.metadata?.replay?.reasoning, '');

    await agent.run({ session, input: 'follow up' }).done;

    const prompt = llm.lastPrompt as any[];
    const assistant = prompt.find((msg) => msg?.role === 'assistant');
    assert.ok(assistant, 'expected assistant message in prompt');
    assert.strictEqual(assistant.providerOptions?.openaiCompatible?.reasoning_content, undefined);
    assert.ok(Array.isArray(assistant.content), 'expected multipart assistant content');
    assert.strictEqual(
      (assistant.content as any[]).some((part) => part?.type === 'reasoning'),
      false,
      'disabled thinking should not replay hidden reasoning parts',
    );
    const assistantText = (assistant.content as any[])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('');
    assert.strictEqual(assistantText, 'hello');
  });

  test('prompt - replays DeepSeek reasoning_content exactly when thinking is enabled', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({
      kind: 'stream',
      chunks: [
        { type: 'reasoning-start' as const, id: 'r1' },
        { type: 'reasoning-delta' as const, id: 'r1', delta: 'hidden reasoning ' },
        { type: 'reasoning-end' as const, id: 'r1' },
        { type: 'text-start' as const, id: 't1' },
        { type: 'text-delta' as const, id: 't1', delta: ' hello' },
        { type: 'text-end' as const, id: 't1' },
        { type: 'finish' as const, usage: usage(), finishReason: { unified: 'stop', raw: 'stop' } },
      ],
    });
    llm.queueResponse({ kind: 'text', content: 'ok' });

    const agent = new LingyunAgent(
      llm,
      { model: 'deepseek-v4-flash' },
      registry,
      { allowExternalPaths: false, openaiCompatible: { thinking: 'enabled' } },
    );
    const session = new LingyunSession();

    const firstRun = agent.run({ session, input: 'hi' });
    for await (const _event of firstRun.events) {
      // drain
    }
    assert.strictEqual((await firstRun.done).text, 'hello');

    const firstAssistant = session.getHistory().find((msg) => msg.role === 'assistant');
    assert.ok(firstAssistant, 'expected assistant history');
    assert.strictEqual(
      firstAssistant.parts.some((part: any) => part?.type === 'reasoning' && part.text === 'hidden reasoning '),
      true,
      'enabled thinking should still store live reasoning for display/history',
    );

    await agent.run({ session, input: 'follow up' }).done;

    assert.strictEqual(llm.lastOptions?.providerOptions?.openaiCompatible?.think, true);
    const prompt = llm.lastPrompt as any[];
    const assistant = prompt.find((msg) => msg?.role === 'assistant');
    assert.ok(assistant, 'expected assistant message in prompt');
    assert.strictEqual(assistant.providerOptions?.openaiCompatible?.reasoning_content, 'hidden reasoning ');
    assert.ok(Array.isArray(assistant.content), 'expected multipart assistant content');
    assert.strictEqual(
      (assistant.content as any[]).some((part) => part?.type === 'reasoning'),
      false,
      'DeepSeek reasoning should be lifted into reasoning_content rather than duplicated as a part',
    );
    const assistantText = (assistant.content as any[])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('');
    assert.strictEqual(assistantText, ' hello');
  });

  test('resume - copilot Claude prompts append a synthetic trailing user turn without persisting it', async () => {
    const llm = new MockCopilotProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({ kind: 'text', content: 'First reply' });
    llm.queueResponse({ kind: 'text', content: 'Resumed reply' });

    const agent = new LingyunAgent(llm, { model: 'claude-sonnet-4.5' }, registry, {
      allowExternalPaths: false,
    });
    const session = new LingyunSession();

    for await (const _event of agent.run({ session, input: 'hi' }).events) {
      // drain
    }
    await agent.resume({ session });

    const prompt = llm.lastPrompt as any[];
    const last = prompt[prompt.length - 1];
    assert.ok(last, 'expected a final prompt message');
    assert.strictEqual(last.role, 'user');
    assert.ok(
      getPromptMessageText(last.content).startsWith('Continue if you have next steps.'),
      'expected synthetic resume prompt to start with the continue text',
    );

    const history = session.getHistory();
    assert.strictEqual(history[history.length - 1]?.role, 'assistant');
    assert.strictEqual(
      history.some((message) => message.role === 'user' && getMessageText(message).startsWith('Continue if you have next steps.')),
      false,
      'synthetic resume prompt should not be persisted in session history',
    );
  });

  test('retries wrapped openai-compatible terminated stream errors after reasoning', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({
      kind: 'stream',
      chunks: [
        { type: 'reasoning-start' as const, id: 'r1' },
        { type: 'reasoning-delta' as const, id: 'r1', delta: 'some reasoning' },
        {
          type: 'error' as const,
          error: {
            name: 'AI_APICallError',
            message: 'Network error',
            cause: {
              name: 'TypeError',
              message: 'terminated',
              responseHeaders: { 'retry-after-ms': '1' },
            },
          },
        },
      ],
    });
    llm.queueResponse({ kind: 'text', content: 'Hello' });

    const agent = new LingyunAgent(llm, { model: 'mock-model', maxRetries: 1 }, registry, {
      allowExternalPaths: false,
    });
    const session = new LingyunSession();
    const originalConsoleError = console.error;
    const consoleErrors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
    };

    try {
      const run = agent.run({ session, input: 'Hi' });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'Hello');
      assert.strictEqual(llm.callCount, 2);

      const history = session.getHistory();
      assert.strictEqual(history.filter((m) => m.role === 'assistant').length, 1);
      assert.strictEqual(getMessageText(history[history.length - 1]!), 'Hello');
      assert.deepStrictEqual(consoleErrors, []);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('retries reset captured OpenAI-compatible tool argument bytes between attempts', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();
    const retryArguments = '{ "attempt" : "second", "value" : 1.0 }';
    registry.registerTool(
      {
        id: 'probe',
        name: 'Probe',
        description: 'Return a deterministic probe result.',
        parameters: {
          type: 'object',
          properties: {
            attempt: { type: 'string' },
            value: { type: 'number' },
          },
          required: ['attempt', 'value'],
        },
        execution: { type: 'function', handler: 'test.probe' },
      },
      async (input) => ({ success: true, data: input }),
    );

    llm.queueResponse({
      kind: 'stream',
      chunks: [
        {
          type: 'raw' as const,
          rawValue: {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call-probe-retry',
                  function: { name: 'probe', arguments: 'FIRST-RAW-ATTEMPT-' },
                }],
              },
            }],
          },
        },
        { type: 'tool-input-start' as const, id: 'call-probe-retry', toolName: 'probe' },
        { type: 'tool-input-delta' as const, id: 'call-probe-retry', delta: 'FIRST-ATTEMPT-' },
        {
          type: 'error' as const,
          error: Object.assign(new Error('retry tool stream'), {
            name: 'ProviderHttpError',
            status: 503,
            retryAfterMs: 1,
          }),
        },
      ],
    });
    llm.queueResponse({
      kind: 'stream',
      chunks: [
        {
          type: 'raw' as const,
          rawValue: {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call-probe-retry',
                  function: { name: 'probe', arguments: retryArguments },
                }],
              },
            }],
          },
        },
        { type: 'tool-input-start' as const, id: 'call-probe-retry', toolName: 'probe' },
        { type: 'tool-input-delta' as const, id: 'call-probe-retry', delta: retryArguments },
        { type: 'tool-input-end' as const, id: 'call-probe-retry' },
        {
          type: 'tool-call' as const,
          toolCallId: 'call-probe-retry',
          toolName: 'probe',
          input: retryArguments,
        },
        { type: 'finish' as const, usage: usage(), finishReason: { unified: 'tool-calls', raw: 'tool_calls' } },
      ],
    });
    llm.queueResponse({ kind: 'text', content: 'done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model', maxRetries: 1 }, registry, {
      allowExternalPaths: false,
      skills: { enabled: false },
    });
    const session = new LingyunSession();
    await agent.run({ session, input: 'Use the probe tool.' }).done;

    assert.strictEqual(llm.callCount, 3);
    const toolAssistant = session.getHistory().find((message) =>
      message.role === 'assistant' && message.parts.some((part: any) => part?.type === 'dynamic-tool')
    );
    assert.ok(toolAssistant, 'expected the retried tool call in assistant history');
    const toolPart = toolAssistant.parts.find((part: any) => part?.type === 'dynamic-tool') as any;
    assert.strictEqual(
      toolPart?.callProviderMetadata?.openaiCompatible?.kookaReplay?.rawArguments,
      retryArguments,
    );
  });

  test('captures exact parallel OpenAI-compatible tool arguments with and without indexes', async () => {
    const scenarios = [
      { name: 'indexed', indexed: true },
      { name: 'no-index', indexed: false },
    ] as const;

    for (const scenario of scenarios) {
      const llm = new MockOpenAICompatibleProvider();
      const registry = new ToolRegistry();
      const firstArguments = '{ "value" : 1.0 }';
      const secondArguments = '{ "value" : 2.0 }';
      registry.registerTool(
        {
          id: 'probe',
          name: 'Probe',
          description: 'Return a deterministic probe result.',
          parameters: {
            type: 'object',
            properties: { value: { type: 'number' } },
            required: ['value'],
          },
          execution: { type: 'function', handler: 'test.probe' },
        },
        async (input) => ({ success: true, data: input }),
      );

      const firstRawCall = {
        ...(scenario.indexed ? { index: 0 } : {}),
        id: `call-${scenario.name}-first`,
        function: { name: 'probe', arguments: firstArguments },
      };
      const secondRawCall = {
        ...(scenario.indexed ? { index: 1 } : {}),
        id: `call-${scenario.name}-second`,
        function: { name: 'probe', arguments: secondArguments },
      };
      const rawParts: LanguageModelV3StreamPart[] = scenario.indexed
        ? [{
            type: 'raw',
            rawValue: {
              choices: [
                { delta: { tool_calls: [firstRawCall, secondRawCall] } },
                { delta: { tool_calls: [{ ...firstRawCall, function: { name: 'probe', arguments: 'IGNORED' } }] } },
              ],
            },
          }]
        : [firstRawCall, secondRawCall].map((toolCall) => ({
            type: 'raw' as const,
            rawValue: {
              choices: [
                { delta: { tool_calls: [toolCall] } },
                { delta: { tool_calls: [{ ...toolCall, function: { name: 'probe', arguments: 'IGNORED' } }] } },
              ],
            },
          }));

      const processedParts: LanguageModelV3StreamPart[] = [];
      for (const [toolCallId, rawArguments] of [
        [`call-${scenario.name}-first`, firstArguments],
        [`call-${scenario.name}-second`, secondArguments],
      ] as const) {
        processedParts.push(
          { type: 'tool-input-start', id: toolCallId, toolName: 'probe' },
          { type: 'tool-input-delta', id: toolCallId, delta: rawArguments },
          { type: 'tool-input-end', id: toolCallId },
          {
            type: 'tool-call',
            toolCallId,
            toolName: 'probe',
            input: rawArguments,
            ...(toolCallId === 'call-no-index-first'
              ? { providerMetadata: { openaiCompatible: 'MALFORMED' } as any }
              : {}),
          },
        );
      }

      llm.queueResponse({
        kind: 'stream',
        chunks: [
          ...rawParts,
          ...processedParts,
          { type: 'finish', usage: usage(), finishReason: { unified: 'tool-calls', raw: 'tool_calls' } },
        ],
      });
      llm.queueResponse({ kind: 'text', content: 'done' });

      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        allowExternalPaths: false,
        skills: { enabled: false },
      });
      const session = new LingyunSession();
      await agent.run({ session, input: 'Use both probe calls.' }).done;

      const toolParts = session.getHistory().flatMap((message) =>
        message.role === 'assistant'
          ? message.parts.filter((part: any) => part?.type === 'dynamic-tool')
          : []
      ) as any[];
      assert.strictEqual(toolParts.length, 2, `${scenario.name}: expected two tool calls`);
      const replayById = new Map(toolParts.map((part) => [
        part.toolCallId,
        part.callProviderMetadata?.openaiCompatible?.kookaReplay?.rawArguments,
      ]));
      assert.strictEqual(replayById.get(`call-${scenario.name}-first`), firstArguments);
      assert.strictEqual(replayById.get(`call-${scenario.name}-second`), secondArguments);
      if (!scenario.indexed) {
        const firstToolPart = toolParts.find((part) => part.toolCallId === 'call-no-index-first');
        assert.deepStrictEqual(
          Object.keys(firstToolPart.callProviderMetadata?.openaiCompatible ?? {}),
          ['kookaReplay'],
          'malformed provider metadata must not be spread into replay state',
        );
      }
    }
  });

  test('aborts promptly during retry backoff without starting another request attempt', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({
      kind: 'stream',
      chunks: [
        {
          type: 'error' as const,
          error: Object.assign(new Error('rate limited'), {
            name: 'ProviderHttpError',
            status: 429,
            retryAfterMs: 60_000,
          }),
        },
      ],
    });
    llm.queueResponse({ kind: 'text', content: 'Should not run' });

    const agent = new LingyunAgent(llm, { model: 'mock-model', maxRetries: 1 }, registry, {
      allowExternalPaths: false,
    });
    const session = new LingyunSession();
    const controller = new AbortController();

    const run = agent.run({ session, input: 'Hi', signal: controller.signal });
    let sawRetryStatus = false;
    const eventsDone = (async () => {
      try {
        for await (const event of run.events) {
          if (event.type === 'status' && event.status.type === 'retry') {
            sawRetryStatus = true;
            controller.abort();
          }
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    const [eventsResult, doneResult] = await Promise.allSettled([eventsDone, run.done]);
    assert.strictEqual(sawRetryStatus, true, 'expected retry status before aborting backoff');
    assert.strictEqual(llm.callCount, 1, 'aborting during retry backoff should not start a second request attempt');
    assert.strictEqual(doneResult.status, 'rejected');
    assert.strictEqual((doneResult as PromiseRejectedResult).reason?.name, 'AbortError');
    assert.strictEqual(eventsResult.status, 'fulfilled');
    assert.strictEqual(((eventsResult as PromiseFulfilledResult<unknown>).value as Error | undefined)?.name, 'AbortError');
  });

  test('file handles - registry repairs malformed state before resolving ids', () => {
    const registry = new FileHandleRegistry({});
    const session = {
      fileHandles: {
        nextId: 2.9,
        byId: {
          F1: ' src/foo.ts ',
          F7: 'src/bar.ts',
          bad: 'drop-me.ts',
          F2: '   ',
        },
      },
    } as any;

    assert.strictEqual(registry.resolveFileId(session, 'F1'), 'src/foo.ts');
    assert.deepStrictEqual(session.fileHandles, {
      nextId: 8,
      byId: { F1: 'src/foo.ts', F7: 'src/bar.ts' },
    });
    assert.deepStrictEqual(registry.getOrCreate(session, 'src/new.ts'), {
      id: 'F8',
      filePath: 'src/new.ts',
    });
    assert.deepStrictEqual(session.fileHandles, {
      nextId: 9,
      byId: { F1: 'src/foo.ts', F7: 'src/bar.ts', F8: 'src/new.ts' },
    });
  });

  test('file handles - glob decoration trims files and notes without empty rows', () => {
    const registry = new FileHandleRegistry({});
    const session: any = {};

    const result = registry.decorateGlobResult(session, {
      success: true,
      data: {
        files: [' src/foo.ts ', '', 42, 'src/bar.ts'],
        notes: [' first note ', null, ' ', 'second note'],
        truncated: false,
      },
    } as ToolResult);

    const outputText = result.metadata?.outputText || '';
    assert.match(outputText, /^Note: first note second note\n\n/);
    assert.match(outputText, /F1  src\/foo\.ts/);
    assert.match(outputText, /F2  src\/bar\.ts/);
    assert.doesNotMatch(outputText, /42/);
    assert.deepStrictEqual(session.fileHandles?.byId, {
      F1: 'src/foo.ts',
      F2: 'src/bar.ts',
    });
  });

  test('file handles - glob and grep string list normalization scans once', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/fileHandles.ts', import.meta.url), 'utf8');
    const helperStart = source.indexOf('function normalizeNonEmptyStrings');
    assert.ok(helperStart >= 0, 'expected string normalizer helper');
    const helperEnd = source.indexOf('export class FileHandleRegistry', helperStart);
    assert.ok(helperEnd > helperStart, 'expected file handle registry after string normalizer');
    const helperSection = source.slice(helperStart, helperEnd);
    const globStart = source.indexOf('decorateGlobResult');
    assert.ok(globStart >= 0, 'expected glob decoration helper');
    const globEnd = source.indexOf('decorateGrepResult', globStart);
    assert.ok(globEnd > globStart, 'expected grep decoration helper after glob decoration');
    const globSection = source.slice(globStart, globEnd);
    const grepNotesStart = source.indexOf('const notesRaw = (data as any).notes;', globEnd);
    assert.ok(grepNotesStart > globEnd, 'expected grep notes normalization');
    const grepNotesEnd = source.indexOf('const truncated = Boolean((data as any).truncated);', grepNotesStart);
    assert.ok(grepNotesEnd > grepNotesStart, 'expected grep truncated flag after notes normalization');
    const grepNotesSection = source.slice(grepNotesStart, grepNotesEnd);

    assert.match(helperSection, /for \(const item of raw\)/);
    assert.match(helperSection, /const value = item\.trim\(\);/);
    assert.match(globSection, /const files = normalizeNonEmptyStrings\(filesRaw\);/);
    assert.match(globSection, /const notes = normalizeNonEmptyStrings\(notesRaw\);/);
    assert.match(grepNotesSection, /const notes = normalizeNonEmptyStrings\(notesRaw\);/);
    assert.doesNotMatch(helperSection, /\.filter\(/);
    assert.doesNotMatch(helperSection, /\.map\(/);
    assert.doesNotMatch(globSection, /\.filter\(/);
    assert.doesNotMatch(globSection, /\.map\(/);
    assert.doesNotMatch(grepNotesSection, /\.filter\(/);
    assert.doesNotMatch(grepNotesSection, /\.map\(/);
  });

  test('file handles - registry scans handle maps without entries arrays', async () => {
    const registry = new FileHandleRegistry({});
    const session: any = {
      fileHandles: {
        nextId: 8,
        byId: {
          F1: 'src/existing.ts',
          F7: 'src/other.ts',
        },
      },
    };
    const originalState = session.fileHandles;

    assert.strictEqual(registry.resolveFileId(session, 'F1'), 'src/existing.ts');
    assert.strictEqual(session.fileHandles, originalState, 'expected normalized file handle state to be reused');

    assert.deepStrictEqual(registry.getOrCreate(session, 'src/existing.ts'), {
      id: 'F1',
      filePath: 'src/existing.ts',
    });
    assert.deepStrictEqual(registry.getOrCreate(session, 'src/new.ts'), {
      id: 'F8',
      filePath: 'src/new.ts',
    });
    assert.strictEqual(session.fileHandles, originalState, 'expected getOrCreate to append without replacing state');

    const fileHandlesSource = await fs.readFile(new URL('../../../src/agent/fileHandles.ts', import.meta.url), 'utf8');
    const ensureStart = fileHandlesSource.indexOf('private ensureState');
    assert.ok(ensureStart >= 0, 'expected file handle state helper');
    const ensureEnd = fileHandlesSource.indexOf('resolveFileId', ensureStart);
    assert.ok(ensureEnd > ensureStart, 'expected resolver after state helper');
    const ensureSection = fileHandlesSource.slice(ensureStart, ensureEnd);
    const getOrCreateStart = fileHandlesSource.indexOf('getOrCreate(session: FileHandlesState');
    assert.ok(getOrCreateStart >= 0, 'expected getOrCreate helper');
    const getOrCreateEnd = fileHandlesSource.indexOf('decorateGlobResult', getOrCreateStart);
    assert.ok(getOrCreateEnd > getOrCreateStart, 'expected glob decoration after getOrCreate');
    const getOrCreateSection = fileHandlesSource.slice(getOrCreateStart, getOrCreateEnd);

    const sessionSource = await fs.readFile(new URL('../../../src/agent/session.ts', import.meta.url), 'utf8');
    const normalizedCheckStart = sessionSource.indexOf('export function isNormalizedFileHandlesState');
    assert.ok(normalizedCheckStart >= 0, 'expected normalized file handle state guard');
    const normalizedCheckEnd = sessionSource.indexOf('export function normalizeFileHandlesState', normalizedCheckStart);
    assert.ok(normalizedCheckEnd > normalizedCheckStart, 'expected file handle normalizer after normalized guard');
    const normalizedCheckSection = sessionSource.slice(normalizedCheckStart, normalizedCheckEnd);

    const normalizeStart = normalizedCheckEnd;
    assert.ok(normalizeStart >= 0, 'expected file handle state normalizer');
    const normalizeEnd = sessionSource.indexOf('export function createBlankSemanticHandlesState', normalizeStart);
    assert.ok(normalizeEnd > normalizeStart, 'expected semantic handle state helper after file handle normalizer');
    const normalizeSection = sessionSource.slice(normalizeStart, normalizeEnd);

    assert.match(ensureSection, /if \(isNormalizedFileHandlesState\(session\.fileHandles\)\) return session\.fileHandles;/);
    assert.match(ensureSection, /normalizeFileHandlesState\(session\.fileHandles\)/);
    assert.ok(
      ensureSection.indexOf('isNormalizedFileHandlesState(session.fileHandles)') <
        ensureSection.indexOf('normalizeFileHandlesState(session.fileHandles)'),
      'expected normalized state fast path before repair normalization',
    );
    assert.match(getOrCreateSection, /for \(const existingId in handles\.byId\)/);
    assert.match(getOrCreateSection, /Object\.prototype\.hasOwnProperty\.call\(handles\.byId, existingId\)/);
    assert.match(normalizedCheckSection, /let minimumNextId = 1;/);
    assert.match(normalizedCheckSection, /const fileHandleNumber = parseFileHandleNumber\(id\);/);
    assert.match(normalizedCheckSection, /return value\.nextId >= minimumNextId;/);
    assert.match(normalizeSection, /for \(const id in byIdRaw\)/);
    assert.match(normalizeSection, /Object\.prototype\.hasOwnProperty\.call\(byIdRaw, id\)/);
    assert.match(normalizeSection, /let minimumNextId = 1;/);
    assert.match(normalizeSection, /const fileHandleNumber = parseFileHandleNumber\(id\);/);
    assert.match(normalizeSection, /Math\.max\(minimumNextId, Math\.floor\(nextId\)\)/);
    assert.doesNotMatch(getOrCreateSection, /Object\.entries/);
    assert.doesNotMatch(normalizedCheckSection, /Object\.entries/);
    assert.doesNotMatch(normalizeSection, /Object\.entries/);
  });

  test('file handles - grep decoration groups and sorts buckets without extra match arrays', async () => {
    const registry = new FileHandleRegistry({});
    const semanticHandles = new SemanticHandleRegistry();
    const session: any = {};

    const result = registry.decorateGrepResult(
      session,
      {
        success: true,
        data: {
          matches: [
            { filePath: 'src/app.ts', line: 9, column: 3, text: 'third' },
            { filePath: 'src/app.ts', line: 2, column: 8, text: 'second' },
            { filePath: 'src/app.ts', line: 2, column: 2, text: 'first' },
          ],
          totalMatches: 3,
        },
      } as ToolResult,
      semanticHandles,
    );

    const outputText = result.metadata?.outputText || '';
    assert.ok(
      outputText.indexOf('M1  Line 2, Character 2: first') <
        outputText.indexOf('M2  Line 2, Character 8: second'),
      'expected same-line matches to be sorted by character',
    );
    assert.ok(
      outputText.indexOf('M2  Line 2, Character 8: second') <
        outputText.indexOf('M3  Line 9, Character 3: third'),
      'expected later-line matches after earlier-line matches',
    );
    assert.match(outputText, /Next: symbols_peek \{ matchId: M1 \}.*line=2 character=2/);
    assert.deepStrictEqual(session.fileHandles?.byId, { F1: 'src/app.ts' });

    const source = await fs.readFile(new URL('../../../src/agent/fileHandles.ts', import.meta.url), 'utf8');
    const start = source.indexOf('decorateGrepResult');
    assert.ok(start >= 0, 'expected grep decoration helper');
    const end = source.indexOf('\n  }\n}', start);
    assert.ok(end > start, 'expected end of grep decoration helper');
    const section = source.slice(start, end);

    assert.match(section, /const byFile = new Map<string, GrepMatch\[\]>\(\);/);
    assert.match(section, /let matchCount = 0;/);
    assert.match(section, /let entry = byFile\.get\(match\.filePath\);/);
    assert.match(section, /byFile\.set\(match\.filePath, entry\);/);
    assert.match(section, /matchCount\+\+;/);
    assert.match(section, /: matchCount;/);
    assert.match(section, /if \(matchCount === 0\)/);
    assert.match(section, /fileMatches\.sort\(/);
    assert.match(section, /for \(const match of fileMatches\)/);
    assert.match(section, /const first = fileMatches\[0\];/);
    assert.doesNotMatch(section, /const matches: GrepMatch\[\] = \[\];/);
    assert.doesNotMatch(section, /matches\.push/);
    assert.doesNotMatch(section, /for \(const match of matches\)/);
    assert.doesNotMatch(section, /matches\.length/);
    assert.doesNotMatch(section, /\[\.\.\.fileMatches\]/);
    assert.doesNotMatch(section, /const sorted =/);
    assert.doesNotMatch(section, /byFile\.get\(match\.filePath\) \?\? \[\]/);
  });

  test('file handles - glob assigns fileId and read resolves it', async () => {
    let readArgs: any;
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    registry.registerTool(
      {
        id: 'glob',
        name: 'Glob Files',
        description: 'Find files matching a glob pattern',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } },
          required: ['pattern'],
        },
        execution: { type: 'function', handler: 'test.glob' },
        metadata: { protocol: { output: { glob: true } } },
      },
      async () => ({
        success: true,
        data: {
          files: ['src/foo.ts', 'src/bar.ts'],
          truncated: false,
        },
      })
    );

    registry.registerTool(
      {
        id: 'read',
        name: 'Read File',
        description: 'Reads a file',
        parameters: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            filePath: { type: 'string' },
          },
          required: [],
        },
        execution: { type: 'function', handler: 'test.read' },
        metadata: { protocol: { input: { fileId: true } } },
      },
      async (args): Promise<ToolResult> => {
        readArgs = args;
        return { success: true, data: 'ok' };
      }
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_glob',
      toolName: 'glob',
      input: { pattern: '**/*.ts' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_read',
      toolName: 'read',
      input: { fileId: 'F1' },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'Done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    const run = agent.run({ session, input: 'Use file handles' });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.strictEqual(session.fileHandles?.byId?.F1, 'src/foo.ts');
    assert.strictEqual(readArgs?.filePath, 'src/foo.ts');
  });

  test('blocks shell tool when allowExternalPaths=false and command references /etc', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-'));
    try {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();

      let called = false;
      const bash: ToolDefinition = {
        id: 'bash',
        name: 'Run Command',
        description: 'Run a shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            workdir: { type: 'string' },
          },
          required: ['command'],
        },
        execution: { type: 'function', handler: 'test.bash' },
        metadata: {
          permission: 'bash',
          supportsExternalPaths: true,
          permissionPatterns: [
            { arg: 'command', kind: 'command' },
            { arg: 'workdir', kind: 'path' },
          ],
        },
      };

      registry.registerTool(bash, async () => {
        called = true;
        return { success: true, data: 'should-not-run' };
      });

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_etc',
        toolName: 'bash',
        input: { command: 'cat /etc/passwd' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot: tmp,
        allowExternalPaths: false,
      });
      const session = new LingyunSession();

      const run = agent.run({ session, input: 'try' });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'ok');
      assert.strictEqual(called, false, 'bash handler should not be invoked when blocked');

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');

      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_etc') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || toolPart.output?.data || '').includes('External paths are disabled'));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('blocks shell tool when allowExternalPaths=false and command references env-expanded external path', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-'));
    try {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();

      let called = false;
      const bash: ToolDefinition = {
        id: 'bash',
        name: 'Run Command',
        description: 'Run a shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            workdir: { type: 'string' },
          },
          required: ['command'],
        },
        execution: { type: 'function', handler: 'test.bash.env' },
        metadata: {
          permission: 'bash',
          supportsExternalPaths: true,
          permissionPatterns: [
            { arg: 'command', kind: 'command' },
            { arg: 'workdir', kind: 'path' },
          ],
        },
      };

      registry.registerTool(bash, async () => {
        called = true;
        return { success: true, data: 'should-not-run' };
      });

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_home_env',
        toolName: 'bash',
        input: { command: 'cat $HOME/.ssh/id_rsa' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot: tmp,
        allowExternalPaths: false,
      });
      const session = new LingyunSession();

      const run = agent.run({ session, input: 'try env path' });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'ok');
      assert.strictEqual(called, false, 'bash handler should not be invoked when blocked');

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');

      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_home_env') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || toolPart.output?.data || '').includes('External paths are disabled'));
      const blockedPaths = Array.isArray(toolPart.output?.metadata?.blockedPaths)
        ? (toolPart.output?.metadata?.blockedPaths as unknown[])
        : [];
      assert.ok(
        blockedPaths.some((p: unknown) => {
          const value = String(p || '');
          return value.includes('$HOME/.ssh/id_rsa') || value.endsWith('/.ssh/id_rsa') || value.endsWith('\\.ssh\\id_rsa');
        }),
        'blocked paths should include the env-expanded sensitive path',
      );
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('blocks read tool when allowExternalPaths=false and filePath traverses a workspace symlink', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-workspace-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-outside-'));
    const linkPath = path.join(workspaceRoot, 'linked-outside');
    try {
      await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'secret');
      try {
        await fs.symlink(outsideRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (isSymlinkUnsupportedError(error)) {
          assert.ok(true, `symlink unsupported in this environment: ${String(error)}`);
          return;
        }
        throw error;
      }

      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      const readBuiltin = getBuiltinTools().find((t) => t.tool.id === 'read');
      assert.ok(readBuiltin, 'expected builtin read tool');
      registry.registerTool(readBuiltin!.tool, readBuiltin!.handler);

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_symlink_read',
        toolName: 'read',
        input: { filePath: path.join(linkPath, 'secret.txt') },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: false,
      });
      const session = new LingyunSession();
      const run = agent.run({ session, input: 'read through symlink' });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;
      assert.strictEqual(result.text, 'ok');

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');
      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_symlink_read') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked symlink call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || toolPart.output?.data || '').includes('External paths are disabled'));
    } finally {
      await fs.rm(linkPath, { recursive: true, force: true });
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  test('plugin auto-discovery is disabled by default (opt-in)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-plugins-'));
    try {
      const pluginDir = path.join(tmp, '.lingyun', 'plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      const pluginPath = path.join(pluginDir, 'p1.js');
      await fs.writeFile(
        pluginPath,
        [
          "module.exports = {",
          "  tool: {",
          "    hello: {",
          "      description: 'hello tool',",
          "      parameters: { type: 'object', properties: {}, required: [] },",
          "      execute: async () => ({ success: true, data: 'ok' }),",
          "    }",
          "  }",
          "};",
          '',
        ].join('\n')
      );

      const pluginsDefault = new PluginManager({ workspaceRoot: tmp });
      const toolsDefault = await pluginsDefault.getPluginTools();
      assert.strictEqual(toolsDefault.length, 0);

      const pluginsEnabled = new PluginManager({ workspaceRoot: tmp, autoDiscover: true });
      const toolsEnabled = await pluginsEnabled.getPluginTools();
      assert.strictEqual(toolsEnabled.length, 1);
      assert.strictEqual(toolsEnabled[0]!.toolId, 'hello');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('plugin discovery lists plugin files without chained array transforms', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-plugin-scan-'));
    try {
      const pluginDir = path.join(tmp, '.lingyun', 'plugin');
      await fs.mkdir(path.join(pluginDir, 'directory.js'), { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'notes.txt'), 'ignored\n');
      await fs.writeFile(
        path.join(pluginDir, 'tool.mjs'),
        [
          "export default {",
          "  tool: {",
          "    discovered_scan: {",
          "      description: 'scan tool',",
          "      parameters: { type: 'object', properties: {}, required: [] },",
          "      execute: async () => ({ success: true, data: 'ok' }),",
          "    }",
          "  }",
          "};",
          "",
        ].join('\n')
      );

      const plugins = new PluginManager({ workspaceRoot: tmp, autoDiscover: true });
      const tools = await plugins.getPluginTools();
      assert.deepStrictEqual(
        tools.map((tool) => tool.toolId),
        ['discovered_scan'],
      );

      const source = await fs.readFile(new URL('../../../src/plugins/pluginManager.ts', import.meta.url), 'utf8');
      const start = source.indexOf('async function listPluginFiles');
      assert.ok(start >= 0, 'expected plugin file listing helper');
      const end = source.indexOf('\nasync function resolveWorkspacePluginPaths', start);
      assert.ok(end > start, 'expected workspace plugin resolver after file listing helper');
      const section = source.slice(start, end);

      assert.match(section, /const files: string\[\] = \[\];/);
      assert.match(section, /for \(const ent of entries\)/);
      assert.match(section, /ent\.isFile\(\)/);
      assert.match(section, /files\.push\(path\.join\(dir, ent\.name\)\);/);
      assert.doesNotMatch(section, /\.filter\(/);
      assert.doesNotMatch(section, /\.map\(/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('plugin discovery avoids pre-stat probes for missing plugin directories', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-plugin-missing-'));
    try {
      const plugins = new PluginManager({ workspaceRoot: tmp, autoDiscover: true });
      const tools = await plugins.getPluginTools();
      assert.deepStrictEqual(tools, []);

      const source = await fs.readFile(new URL('../../../src/plugins/pluginManager.ts', import.meta.url), 'utf8');
      const start = source.indexOf('async function resolveWorkspacePluginPaths');
      assert.ok(start >= 0, 'expected workspace plugin resolver');
      const end = source.indexOf('\nasync function importPluginModule', start);
      assert.ok(end > start, 'expected plugin module importer after workspace plugin resolver');
      const section = source.slice(start, end);

      assert.match(section, /return uniqueStrings\(await listPluginFiles\(pluginDir\)\);/);
      assert.doesNotMatch(source, /async function exists/);
      assert.doesNotMatch(section, /fs\.stat/);
      assert.doesNotMatch(section, /await exists/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('plugin module specifiers resolve from workspaceRoot node_modules', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-plugin-module-'));
    try {
      const pkgDir = path.join(tmp, 'node_modules', 'workspace-plugin');
      await fs.mkdir(pkgDir, { recursive: true });
      await fs.writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'workspace-plugin', version: '0.0.0', main: 'index.js' }, null, 2) + '\n'
      );
      await fs.writeFile(
        path.join(pkgDir, 'index.js'),
        [
          "module.exports = {",
          "  tool: {",
          "    workspace_hello: {",
          "      description: 'workspace hello tool',",
          "      parameters: { type: 'object', properties: {}, required: [] },",
          "      execute: async () => ({ success: true, data: 'ok' }),",
          "    }",
          "  }",
          "};",
          "",
        ].join('\n')
      );

      const plugins = new PluginManager({ workspaceRoot: tmp, plugins: ['workspace-plugin'], autoDiscover: false });
      const tools = await plugins.getPluginTools();
      assert.strictEqual(tools.length, 1);
      assert.strictEqual(tools[0]!.toolId, 'workspace_hello');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('rejects plugin tool id collisions across plugins', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-plugin-collision-'));
    try {
      const plugin1 = path.join(tmp, 'p1.js');
      const plugin2 = path.join(tmp, 'p2.js');

      const pluginBody = (label: string) =>
        [
          'module.exports = {',
          '  tool: {',
          '    collision: {',
          `      description: 'collision tool (${label})',`,
          "      parameters: { type: 'object', properties: {}, required: [] },",
          `      execute: async () => ({ success: true, data: '${label}' }),`,
          '    }',
          '  }',
          '};',
          '',
        ].join('\n');

      await fs.writeFile(plugin1, pluginBody('one'));
      await fs.writeFile(plugin2, pluginBody('two'));

      const plugins = new PluginManager({ workspaceRoot: tmp, plugins: [plugin1, plugin2], autoDiscover: false });
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { workspaceRoot: tmp, plugins });
      const session = new LingyunSession();

      const run = agent.run({ session, input: 'hi' });
      await assert.rejects(run.done, /Plugin tool id collision/);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('plugin tool registration builds existing lookup without pair arrays', async () => {
    const source = await fs.readFile(new URL('../../../src/agent/agent.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private async ensurePluginToolsRegistered');
    assert.ok(start >= 0, 'expected plugin tool registration helper');
    const end = source.indexOf('\n  private async toModelMessages', start);
    assert.ok(end > start, 'expected model-message helper after plugin registration');
    const section = source.slice(start, end);

    assert.match(section, /const existingById = new Map<string, ToolDefinition>\(\);/);
    assert.match(section, /for \(const tool of existing\)/);
    assert.match(section, /existingById\.set\(tool\.id, tool\);/);
    assert.doesNotMatch(section, /existing\.map/);
  });

  test('plugin manager scans exports and tool maps without entry arrays', async () => {
    const inheritedToolMap = {
      inherited_tool: {
        description: 'inherited tool',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => ({ success: true, data: 'inherited' }),
      },
    };
    const toolMap = Object.assign(Object.create(inheritedToolMap), {
      own_tool: {
        description: 'own tool',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => ({ success: true, data: 'own' }),
      },
    });
    const plugins = new PluginManager();
    plugins.registerHooks('manual', { tool: toolMap as any });

    const tools = await plugins.getPluginTools();
    assert.deepStrictEqual(
      tools.map((tool) => ({ pluginId: tool.pluginId, toolId: tool.toolId })),
      [{ pluginId: 'manual', toolId: 'own_tool' }],
    );

    const source = await fs.readFile(new URL('../../../src/plugins/pluginManager.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function extractHooksFromModule');
    assert.ok(start >= 0, 'expected module hook extraction helper');
    const end = source.indexOf('export class PluginManager', start);
    assert.ok(end > start, 'expected plugin manager class after helpers');
    const section = source.slice(start, end);

    assert.match(section, /for \(const name in moduleExports as Record<string, unknown>\)/);
    assert.match(section, /for \(const toolId in toolMap\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call/);
    assert.doesNotMatch(section, /Object\.entries/);
  });

  test('discovers skills under ~/.codex/skills when allowExternalPaths=true', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skills-'));
    const skillBase = `lingyun-sdk-test-skill-${Date.now()}`;
    const skillDir = path.join(os.homedir(), '.codex', 'skills', skillBase);
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        ['---', 'name: sdk-test-skill', 'description: skill for sdk tests', '---', '', '# Hello', 'From skill'].join('\n')
      );

      const searchPath = `~/.codex/skills/${skillBase}`;

      const indexBlocked = await getSkillIndex({
        workspaceRoot,
        searchPaths: [searchPath],
        allowExternalPaths: false,
      });
      assert.strictEqual(indexBlocked.byName.has('sdk-test-skill'), false);
      assert.ok(indexBlocked.scannedDirs.some((d) => d.status === 'skipped_external'));

      const indexAllowed = await getSkillIndex({
        workspaceRoot,
        searchPaths: [searchPath],
        allowExternalPaths: true,
      });
      const skill = indexAllowed.byName.get('sdk-test-skill');
      assert.ok(skill, 'expected skill to be discovered');
      assert.strictEqual(skill!.source, 'external');

      const loaded = await loadSkillFile(skill!);
      assert.ok(loaded.content.includes('From skill'));
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(skillDir, { recursive: true, force: true });
    }
  });

  test('skill index stops scanning search paths after maxSkills is reached', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skills-max-'));
    const firstRoot = path.join(workspaceRoot, 'first-skills');
    const secondRoot = path.join(workspaceRoot, 'second-skills');
    try {
      await fs.mkdir(path.join(firstRoot, 'one'), { recursive: true });
      await fs.mkdir(path.join(secondRoot, 'two'), { recursive: true });
      await fs.writeFile(
        path.join(firstRoot, 'one', 'SKILL.md'),
        ['---', 'name: skill-one', 'description: first skill', '---', '', '# One'].join('\n'),
      );
      await fs.writeFile(
        path.join(secondRoot, 'two', 'SKILL.md'),
        ['---', 'name: skill-two', 'description: second skill', '---', '', '# Two'].join('\n'),
      );

      const index = await getSkillIndex({
        workspaceRoot,
        searchPaths: ['first-skills', 'second-skills'],
        allowExternalPaths: false,
        maxSkills: 1,
      });

      assert.deepStrictEqual(index.skills.map((skill) => skill.name), ['skill-one']);
      assert.strictEqual(index.truncated, true);
      assert.deepStrictEqual(index.scannedDirs.map((dir) => path.relative(workspaceRoot, dir.absPath)), ['first-skills']);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('prompt cache - persisted skill blocks preserve cache hits on follow-up turns', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-skill-inject-'));
    const skillDir = path.join(workspaceRoot, '.lingyun', 'skills', 'ask');
    try {
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: ask-questions-if-underspecified',
          'description: Clarify requirements before implementing.',
          '---',
          '',
          '# Ask Questions If Underspecified',
          '',
          '- Ask 1-5 must-have questions first.',
        ].join('\n')
      );

      const llm = new CacheAwareMockLLMProvider();
      llm.queueResponse({ kind: 'text', content: 'ok' });

      const registry = new ToolRegistry();
      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, {
        workspaceRoot,
        allowExternalPaths: false,
        skills: { enabled: true, paths: ['.lingyun/skills'] },
      });
      const session = new LingyunSession();

      const input = `SENTINEL_${Date.now()} use $ask-questions-if-underspecified`;
      const run = agent.run({ session, input });
      for await (const _event of run.events) {
        // drain
      }
      await run.done;

      llm.queueResponse({ kind: 'text', content: 'follow-up ok' });
      const followUp = agent.run({ session, input: 'Follow up without re-mentioning the skill' });
      for await (const _event of followUp.events) {
        // drain
      }
      await followUp.done;

      const promptJson = JSON.stringify(llm.lastPrompt ?? '');
      const idxSkill = promptJson.lastIndexOf('<skill>');
      const idxInput = promptJson.lastIndexOf('Follow up without re-mentioning the skill');
      assert.ok(idxSkill >= 0, 'expected <skill> block to be present in the prompt');
      assert.ok(idxInput >= 0, 'expected user input to be present in the prompt');
      assert.ok(idxInput > idxSkill, 'expected user input to appear after the injected <skill> block');

      const history = session.getHistory();
      assert.strictEqual(history.some((m) => m.role === 'user' && m.metadata?.skill), true);
      assert.deepStrictEqual(session.mentionedSkills, ['ask-questions-if-underspecified']);
      assertSecondTurnCacheReuse(llm, session, 'persisted skill prompt cache');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('prompt cache - follow-up turns record cache reads', async () => {
    const llm = new CacheAwareMockLLMProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({ kind: 'text', content: 'first' });
    llm.queueResponse({ kind: 'text', content: 'second' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: true });
    const session = new LingyunSession();

    for await (const _event of agent.run({ session, input: 'hello' }).events) {
      // drain
    }
    await agent.run({ session, input: 'follow up' }).done;

    assertSecondTurnCacheReuse(llm, session, 'plain follow-up prompt cache');
  });

  test('tools - orders prompt tool definitions deterministically by id', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    registry.registerTool(
      {
        id: 'z_tool',
        name: 'Z tool',
        description: 'last alphabetically',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.z_tool' },
      },
      async () => ({ success: true, data: 'z' }),
    );
    registry.registerTool(
      {
        id: 'a_tool',
        name: 'A tool',
        description: 'first alphabetically',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.a_tool' },
      },
      async () => ({ success: true, data: 'a' }),
    );

    llm.queueResponse({ kind: 'text', content: 'ok' });

    const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession();

    for await (const _event of agent.run({ session, input: 'hello' }).events) {
      // drain
    }

    const toolNames = llm.lastToolNames.filter((name) => name === 'a_tool' || name === 'z_tool');
    assert.deepStrictEqual(toolNames, ['a_tool', 'z_tool']);
  });

  test('tool registry assembles provider snapshots without mapped arrays', async () => {
    const registry = new ToolRegistry();
    registry.registerTool(
      {
        id: 'first_tool',
        name: 'First tool',
        description: 'first',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.first_tool' },
      },
      async () => ({ success: true }),
    );
    registry.registerTool(
      {
        id: 'second_tool',
        name: 'Second tool',
        description: 'second',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test.second_tool' },
      },
      async () => ({ success: true }),
    );

    const tools = await registry.getTools();
    assert.deepStrictEqual(
      tools.map((tool) => tool.id),
      ['first_tool', 'second_tool'],
    );

    const source = await fs.readFile(new URL('../../../src/tools/registry.ts', import.meta.url), 'utf8');
    const simpleStart = source.indexOf('class SimpleToolProvider');
    assert.ok(simpleStart >= 0, 'expected simple tool provider');
    const simpleEnd = source.indexOf('\nexport class ToolRegistry', simpleStart);
    assert.ok(simpleEnd > simpleStart, 'expected registry class after simple provider');
    const simpleSection = source.slice(simpleStart, simpleEnd);

    const refreshStart = source.indexOf('private async refreshAllTools');
    assert.ok(refreshStart >= 0, 'expected refreshAllTools');
    const refreshEnd = source.indexOf('\n  registerTool', refreshStart);
    assert.ok(refreshEnd > refreshStart, 'expected registerTool after refreshAllTools');
    const refreshSection = source.slice(refreshStart, refreshEnd);

    assert.match(simpleSection, /const definitions: ToolDefinition\[\] = \[\];/);
    assert.match(simpleSection, /for \(const tool of this\.tools\.values\(\)\)/);
    assert.match(simpleSection, /definitions\.push\(tool\.definition\);/);
    assert.doesNotMatch(simpleSection, /Array\.from\(this\.tools\.values\(\)\)\.map/);

    assert.match(refreshSection, /const refreshTasks: Promise<void>\[\] = \[\];/);
    assert.match(refreshSection, /for \(const providerId of this\.providers\.keys\(\)\)/);
    assert.match(refreshSection, /this\.refreshProviderTools\(providerId\)\.catch/);
    assert.match(refreshSection, /await Promise\.all\(refreshTasks\);/);
    assert.doesNotMatch(refreshSection, /providerIds\.map/);
    assert.doesNotMatch(refreshSection, /\[\.\.\.this\.providers\.keys\(\)\]/);
  });

  test('requires approval for curl-like bash commands by default', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-bash-approve-'));
    try {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();

      let called = false;
      registry.registerTool(bashTool, async () => {
        called = true;
        return { success: true, data: 'should-not-run' };
      });

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_curl',
        toolName: 'bash',
        input: { command: 'curl https://example.com' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      let approvalCalls = 0;
      let approvalContext: any;
      const agent = new LingyunAgent(llm, { model: 'mock-model' }, registry, { workspaceRoot: tmp });
      const session = new LingyunSession();

      const run = agent.run({
        session,
        input: 'try',
        callbacks: {
          onRequestApproval: async (_tool, _definition, context) => {
            approvalCalls += 1;
            approvalContext = context;
            return false;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'ok');
      assert.strictEqual(approvalCalls, 1);
      assert.strictEqual(called, false, 'bash handler should not be invoked when approval is rejected');
      assert.strictEqual(approvalContext?.manual, false);
      assert.strictEqual(approvalContext?.decision, 'require_manual_approval');
      assert.ok(String(approvalContext?.reason || '').includes('curl'));

      const history = session.getHistory();
      const assistant = history.find((m) => m.role === 'assistant');
      assert.ok(assistant, 'expected assistant message');

      const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_curl') as any;
      assert.ok(toolPart, 'expected dynamic-tool part for blocked call');
      assert.strictEqual(toolPart.output?.success, false);
      assert.ok(String(toolPart.output?.error || '').includes('User rejected'));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('manual dotenv approval bypasses autoApprove and reports manual approval context', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-dotenv-approve-'));
    try {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();

      let called = false;
      const readTool: ToolDefinition = {
        id: 'read',
        name: 'Read File',
        description: 'Reads a file',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
          },
          required: ['filePath'],
        },
        execution: { type: 'function', handler: 'test.read.dotenv' },
        metadata: {
          permission: 'read',
          readOnly: true,
          permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
        },
      };

      registry.registerTool(readTool, async () => {
        called = true;
        return { success: true, data: 'dotenv-ok' };
      });

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_dotenv_read',
        toolName: 'read',
        input: { filePath: '.env' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'done' });

      let approvalCalls = 0;
      let approvalContext: any;
      const agent = new LingyunAgent(llm, { model: 'mock-model', autoApprove: true }, registry, { workspaceRoot: tmp });
      const session = new LingyunSession();

      const run = agent.run({
        session,
        input: 'read dotenv',
        callbacks: {
          onRequestApproval: async (_tool, _definition, context) => {
            approvalCalls += 1;
            approvalContext = context;
            return true;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'done');
      assert.strictEqual(approvalCalls, 1, 'manual approval should still be requested when autoApprove=true');
      assert.strictEqual(called, true);
      assert.strictEqual(approvalContext?.manual, true);
      assert.strictEqual(approvalContext?.decision, 'require_manual_approval');
      assert.ok(String(approvalContext?.reason || '').includes('Protected dotenv access requires manual approval'));
      assert.deepStrictEqual(approvalContext?.metadata?.dotEnvTargets, ['.env']);
      assert.ok(Array.isArray(approvalContext?.metadata?.riskReasons));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('host manual approval cannot be bypassed by autoApprove or permission allow hooks', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-test-manual-approval-'));
    try {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      const plugins = new PluginManager({ workspaceRoot: tmp });
      plugins.registerHooks('allow-all', {
        'permission.ask': async (_input, output) => {
          output.status = 'allow';
        },
      });

      let called = false;
      const manualTool: ToolDefinition = {
        id: 'workspace_http',
        name: 'Workspace HTTP',
        description: 'Host-controlled network tool',
        parameters: {
          type: 'object',
          properties: {},
        },
        execution: { type: 'function', handler: 'test.workspace_http' },
        metadata: {
          requiresApproval: true,
          requiresManualApproval: true,
        },
      };

      registry.registerTool(manualTool, async () => {
        called = true;
        return { success: true, data: 'manual-ok' };
      });

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_manual_host_policy',
        toolName: 'workspace_http',
        input: {},
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'done' });

      let approvalCalls = 0;
      let approvalContext: any;
      const agent = new LingyunAgent(
        llm,
        { model: 'mock-model', autoApprove: true },
        registry,
        { workspaceRoot: tmp, plugins },
      );
      const session = new LingyunSession();

      const run = agent.run({
        session,
        input: 'run host manual tool',
        callbacks: {
          onRequestApproval: async (_tool, _definition, context) => {
            approvalCalls += 1;
            approvalContext = context;
            return true;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      const result = await run.done;

      assert.strictEqual(result.text, 'done');
      assert.strictEqual(approvalCalls, 1);
      assert.strictEqual(called, true);
      assert.strictEqual(approvalContext?.manual, true);
      assert.ok(String(approvalContext?.reason || '').includes('manual approval'));
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  test('task tool description uses shared subagent list without map arrays', async () => {
    const expectedList = [
      '- general: General-purpose agent for complex, multi-step tasks. Use when you want the agent to execute a longer workflow.',
      '- explore: Fast, read-only agent specialized for exploring a workspace: list files, grep, read small snippets, and summarize findings.',
    ].join('\n');
    const task = getBuiltinTools({ skills: { enabled: false } }).find((item) => item.tool.id === 'task')?.tool;

    assert.strictEqual(formatBuiltinSubagentsForToolDescription(), expectedList);
    assert.ok(task, 'expected builtin task tool');
    assert.ok(
      task.description.includes(`Available subagent types:\n${expectedList}\n\nUsage:`),
      'expected task tool description to include shared subagent list',
    );

    const source = await fs.readFile(new URL('../../../../core/src/subagents.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export function formatBuiltinSubagentsForToolDescription');
    assert.ok(start >= 0, 'expected shared subagent formatter');
    const end = source.indexOf('\nexport function resolveBuiltinSubagent', start);
    assert.ok(end > start, 'expected resolver after shared subagent formatter');
    const section = source.slice(start, end);

    assert.match(section, /let lines = '';/);
    assert.match(section, /for \(const name in BUILTIN_SUBAGENTS\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(BUILTIN_SUBAGENTS, name\)/);
    assert.match(section, /lines = lines \? `\$\{lines\}\\n\$\{line\}` : line;/);
    assert.doesNotMatch(section, /\.map\(/);
    assert.doesNotMatch(section, /\.join\(/);
    assert.doesNotMatch(section, /Object\.values/);
  });

  test('task tool spawns a subagent and returns child session metadata (without persisting it in parent history)', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task',
      toolName: 'task',
      input: {
        description: 'Explore task',
        prompt: 'Return a short answer.',
        subagent_type: 'general',
        session_id: 'child-1',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'subagent answer' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent done' }); // parent after tool result

    let taskResult: ToolResult | undefined;

    const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const run = agent.run({
      session,
      input: 'run task',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') taskResult = result;
        },
      },
    });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'parent done');
    assert.ok(taskResult, 'expected task tool result');
    assert.strictEqual(taskResult!.success, true);

    const meta = taskResult!.metadata as any;
    assert.ok(meta?.task, 'expected metadata.task');
    assert.ok(meta?.childSession, 'expected metadata.childSession');
    assert.strictEqual(meta.task.session_id, 'child-1');
    assert.strictEqual(meta.task.parent_session_id, 'parent-1');
    assert.strictEqual(meta.task.subagent_type, 'general');
    assert.strictEqual(meta.task.model_id, 'parent-model');
    assert.strictEqual(meta.childSession.sessionId, 'child-1');
    assert.strictEqual(meta.childSession.parentSessionId, 'parent-1');
    assert.strictEqual(meta.childSession.subagentType, 'general');
    assert.strictEqual(meta.childSession.modelId, 'parent-model');

    const history = session.getHistory();
    const assistant = history.find((m) => m.role === 'assistant');
    assert.ok(assistant, 'expected assistant message');

    const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_task') as any;
    assert.ok(toolPart, 'expected task dynamic-tool part');
    assert.strictEqual(toolPart.output?.success, true);
    assert.ok(toolPart.output?.metadata, 'expected persisted tool output metadata');
    assert.ok(!('childSession' in toolPart.output.metadata), 'childSession should not be persisted in parent history');
    assert.ok(!('task' in toolPart.output.metadata), 'task metadata should not be persisted in parent history');
  });

  test('task tool unknown subagent error formats available names without map arrays', async () => {
    const runner = new TaskSubagentRunner({
      taskSessions: new Map(),
      maxTaskSessions: 4,
      createSubagentAgent: () => {
        throw new Error('subagent should not be created for invalid subagent_type');
      },
    });
    const taskDef: ToolDefinition = {
      id: 'task',
      name: 'Task',
      description: 'Task tool',
      parameters: { type: 'object', properties: {} },
      execution: { type: 'function', handler: 'test.task' },
    };

    const result = await runner.executeTaskTool({
      mode: 'build',
      def: taskDef,
      session: new LingyunSession(),
      callbacks: undefined,
      args: {
        description: 'Unknown task',
        prompt: 'noop',
        subagent_type: 'missing-subagent',
      },
      options: { toolCallId: 'call_unknown' } as any,
      prepareSubagentExecution: async () => {
        throw new Error('subagent should not be prepared for invalid subagent_type');
      },
    });

    assert.deepStrictEqual(result, {
      success: false,
      error: 'Unknown subagent_type: missing-subagent. Available: general, explore',
      metadata: { errorCode: TOOL_ERROR_CODES.unknown_subagent_type, subagentType: 'missing-subagent' },
    });

    const source = await fs.readFile(new URL('../../../src/agent/taskSubagentRunner.ts', import.meta.url), 'utf8');
    const start = source.indexOf('private resolveTaskToolSpec');
    assert.ok(start >= 0, 'expected task tool spec resolver');
    const end = source.indexOf('\n  private getOrCreateTaskChildSession', start);
    assert.ok(end > start, 'expected child session helper after task spec resolver');
    const section = source.slice(start, end);

    assert.match(section, /let names = '';/);
    assert.match(section, /for \(const item of listBuiltinSubagents\(\)\)/);
    assert.match(section, /names = names \? `\$\{names\}, \$\{name\}` : name;/);
    assert.doesNotMatch(section, /\.map\(/);
    assert.doesNotMatch(section, /\.join\(/);
  });

  test('task tool ignores invalid session_id and generates a safe id', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task',
      toolName: 'task',
      input: {
        description: 'Explore task',
        prompt: 'Return a short answer.',
        subagent_type: 'general',
        session_id: '../evil',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'subagent answer' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent done' }); // parent after tool result

    let taskResult: ToolResult | undefined;

    const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const run = agent.run({
      session,
      input: 'run task',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') taskResult = result;
        },
      },
    });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'parent done');
    assert.ok(taskResult, 'expected task tool result');
    assert.strictEqual(taskResult!.success, true);

    const meta = taskResult!.metadata as any;
    assert.ok(meta?.task, 'expected metadata.task');
    assert.ok(meta?.childSession, 'expected metadata.childSession');

    const childId = String(meta.task.session_id || '');
    assert.ok(childId, 'expected a generated child session id');
    assert.notStrictEqual(childId, '../evil');
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(childId), 'expected session_id to be filename-safe');
    assert.strictEqual(meta.childSession.sessionId, childId);
  });

  test('task tool caps the in-memory taskSessions map', async function () {
    this.timeout(10_000);

    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    const runs = 2;
    const perRun = 30; // default maxIterations is 50; keep each run under the limit.
    let counter = 0;

    for (let run = 1; run <= runs; run++) {
      for (let i = 1; i <= perRun; i++) {
        counter += 1;
        llm.queueResponse({
          kind: 'tool-call',
          toolCallId: `call_task_${counter}`,
          toolName: 'task',
          input: {
            description: `Task ${counter}`,
            prompt: 'Return ok.',
            subagent_type: 'general',
            session_id: `sess-${counter}`,
          },
          finishReason: 'tool-calls',
        });
        llm.queueResponse({ kind: 'text', content: 'ok' }); // subagent
      }
      llm.queueResponse({ kind: 'text', content: `done ${run}` }); // parent
    }

    const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry);
    for (let run = 1; run <= runs; run++) {
      const session = new LingyunSession({ sessionId: `parent-${run}` });
      const exec = agent.run({ session, input: `many tasks ${run}` });
      for await (const _event of exec.events) {
        // drain
      }
      await exec.done;
    }

    const taskSessions = (agent as any).taskSessions as Map<string, unknown>;
    assert.ok(taskSessions, 'expected taskSessions to exist');
    assert.ok(taskSessions.size <= 50, `expected taskSessions size <= 50, got ${String(taskSessions.size)}`);
    assert.ok(taskSessions.has('sess-60'), 'expected newest session to be retained');
    assert.ok(!taskSessions.has('sess-1'), 'expected oldest session to be evicted');
  });

  test('task tool uses subagentModel override and remembers model per session_id', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task_1',
      toolName: 'task',
      input: {
        description: 'Run with override',
        prompt: 'Return ok.',
        subagent_type: 'general',
        session_id: 'task-sess',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'child ok 1' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent ok 1' }); // parent
    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task_2',
      toolName: 'task',
      input: {
        description: 'Continue with same session',
        prompt: 'Return ok again.',
        subagent_type: 'general',
        session_id: 'task-sess',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'child ok 2' }); // subagent
    llm.queueResponse({ kind: 'text', content: 'parent ok 2' }); // parent

    const agent = new LingyunAgent(llm, { model: 'parent-model', subagentModel: 'child-model-a' }, registry);
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const seen: ToolResult[] = [];
    const run1 = agent.run({
      session,
      input: 'first',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') seen.push(result);
        },
      },
    });
    for await (const _event of run1.events) {
      // drain
    }
    await run1.done;

    agent.updateConfig({ subagentModel: 'child-model-b' });

    const run2 = agent.run({
      session,
      input: 'second',
      callbacks: {
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') seen.push(result);
        },
      },
    });
    for await (const _event of run2.events) {
      // drain
    }
    await run2.done;

    assert.strictEqual(seen.length, 2, 'expected two task results');
    assert.strictEqual((seen[0]!.metadata as any)?.task?.model_id, 'child-model-a');
    assert.strictEqual((seen[1]!.metadata as any)?.task?.model_id, 'child-model-a', 'should reuse persisted child model');
    assert.ok(!llm.modelCalls.includes('child-model-b'), 'should not attempt the updated override when session already has a model');
  });

  test('task tool falls back to parent model when subagentModel is unavailable', async () => {
    const llm = new MockLLMProvider();
    llm.markModelUnavailable('child-model');
    const registry = new ToolRegistry();
    registerTaskTool(registry);

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_task',
      toolName: 'task',
      input: {
        description: 'Fallback',
        prompt: 'Return ok.',
        subagent_type: 'general',
        session_id: 'fallback-sess',
      },
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'child ok' }); // subagent runs on parent model
    llm.queueResponse({ kind: 'text', content: 'parent ok' });

    const notices: any[] = [];
    let taskResult: ToolResult | undefined;
    const agent = new LingyunAgent(llm, { model: 'parent-model', subagentModel: 'child-model' }, registry);
    const session = new LingyunSession({ sessionId: 'parent-1' });

    const run = agent.run({
      session,
      input: 'go',
      callbacks: {
        onNotice: (notice) => {
          notices.push(notice);
        },
        onToolResult: (tool, result) => {
          if (tool.function.name === 'task') taskResult = result;
        },
      },
    });
    for await (const _event of run.events) {
      // drain
    }
    await run.done;

    assert.ok(taskResult, 'expected task tool result');
    const taskMeta = (taskResult!.metadata as any)?.task;
    assert.ok(taskMeta?.model_warning, 'expected model_warning');
    assert.strictEqual(taskMeta.requested_model_id, 'child-model');
    assert.strictEqual(taskMeta.model_id, 'parent-model');
    assert.ok(notices.some((n) => n.level === 'warning'), 'expected warning notice');
  });

  test('plan mode blocks non-readOnly tools even if permission is spoofed', async () => {
    const llm = new MockLLMProvider();
    const registry = new ToolRegistry();

    let called = false;
    registry.registerTool(
      {
        id: 'test_spoof_task_permission',
        name: 'Spoof Task Permission',
        description: 'Attempts to bypass plan mode by setting permission=task',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test_spoof_task_permission' },
        metadata: {
          permission: 'task',
          requiresApproval: false,
          readOnly: false,
        },
      },
      async (): Promise<ToolResult> => {
        called = true;
        return { success: true, data: 'executed' };
      },
    );

    llm.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_plan_spoof_1',
      toolName: 'test_spoof_task_permission',
      input: {},
      finishReason: 'tool-calls',
    });
    llm.queueResponse({ kind: 'text', content: 'done' });

    const agent = new LingyunAgent(llm, { model: 'mock-model', mode: 'plan' }, registry, { allowExternalPaths: false });
    const session = new LingyunSession({ sessionId: 'plan-session' });

    const run = agent.run({ session, input: 'plan mode' });
    for await (const _event of run.events) {
      // drain
    }
    const result = await run.done;

    assert.strictEqual(result.text, 'done');
    assert.strictEqual(called, false, 'tool handler should not be invoked when blocked in plan mode');

    const history = session.getHistory();
    const assistant = history.find(
      (m) => m.role === 'assistant' && m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_plan_spoof_1'),
    );
    assert.ok(assistant, 'expected assistant tool message');

    const toolPart = assistant!.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolCallId === 'call_plan_spoof_1') as any;
    assert.ok(toolPart, 'expected dynamic-tool part');
    assert.strictEqual(toolPart.output?.success, false);
    assert.ok(String(toolPart.output?.error || '').toLowerCase().includes('plan mode'));
  });

  test('task tool rejects recursion from subagent sessions and enforces plan-mode subagent restrictions', async () => {
    {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      registerTaskTool(registry);

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_task',
        toolName: 'task',
        input: { description: 'noop', prompt: 'noop', subagent_type: 'general' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      let taskResult: ToolResult | undefined;
      const agent = new LingyunAgent(llm, { model: 'parent-model' }, registry);
      const session = new LingyunSession({ sessionId: 'child', parentSessionId: 'parent', subagentType: 'general' });

      const run = agent.run({
        session,
        input: 'try recursion',
        callbacks: {
          onToolResult: (tool, result) => {
            if (tool.function.name === 'task') taskResult = result;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      await run.done;

      assert.ok(taskResult, 'expected task tool result');
      assert.strictEqual(taskResult!.success, false);
      assert.strictEqual(taskResult!.metadata?.errorCode, TOOL_ERROR_CODES.task_recursion_denied);
    }

    {
      const llm = new MockLLMProvider();
      const registry = new ToolRegistry();
      registerTaskTool(registry);

      llm.queueResponse({
        kind: 'tool-call',
        toolCallId: 'call_task',
        toolName: 'task',
        input: { description: 'noop', prompt: 'noop', subagent_type: 'general' },
        finishReason: 'tool-calls',
      });
      llm.queueResponse({ kind: 'text', content: 'ok' });

      let taskResult: ToolResult | undefined;
      const agent = new LingyunAgent(llm, { model: 'parent-model', mode: 'plan' }, registry);
      const session = new LingyunSession({ sessionId: 'parent' });

      const run = agent.run({
        session,
        input: 'plan mode',
        callbacks: {
          onToolResult: (tool, result) => {
            if (tool.function.name === 'task') taskResult = result;
          },
        },
      });
      for await (const _event of run.events) {
        // drain
      }
      await run.done;

      assert.ok(taskResult, 'expected task tool result');
      assert.strictEqual(taskResult!.success, false);
      assert.strictEqual(taskResult!.metadata?.errorCode, TOOL_ERROR_CODES.subagent_denied_in_plan);
      assert.strictEqual(taskResult!.metadata?.subagentType, 'general');
    }
  });

  test('task tool subagent inherits parent mode (plan) and disables autoApprove', async () => {
    const parentSession = new LingyunSession({ sessionId: 'parent' });

    let capturedSubagentConfig: any;
    const runner = new TaskSubagentRunner({
      taskSessions: new Map<string, LingyunSession>(),
      maxTaskSessions: 10,
      createSubagentAgent: (subagentConfig) => {
        capturedSubagentConfig = subagentConfig as any;
        return {
          run: () => ({
            events: (async function* () {})(),
            done: Promise.resolve({ text: 'ok', session: { history: [] } }),
          }),
        };
      },
    });

    const result = await runner.executeTaskTool({
      mode: 'plan',
      def: { id: 'task' } as any,
      session: parentSession,
      callbacks: undefined,
      args: { description: 'desc', prompt: 'prompt', subagent_type: 'explore' },
      options: { toolCallId: 'call_task', abortSignal: new AbortController().signal } as any,
      prepareSubagentExecution: async ({ childSessionId }) => ({
        config: {
          model: 'parent-model',
          mode: 'plan',
          autoApprove: false,
          sessionId: childSessionId,
        } as any,
        childModelId: 'parent-model',
        desiredChildModelId: 'parent-model',
        taskMaxOutputChars: 0,
      }),
    });

    assert.strictEqual(result.success, true);
    assert.ok(capturedSubagentConfig, 'expected TaskSubagentRunner to create a subagent config');
    assert.strictEqual(capturedSubagentConfig.mode, 'plan');
    assert.strictEqual(capturedSubagentConfig.autoApprove, false);
  });
});
