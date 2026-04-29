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

import { TOOL_ERROR_CODES } from '@kooka/core';
import {
  FileHandleRegistry,
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

    const finalAssistant = [...history].reverse().find((m) => m.role === 'assistant' && getMessageText(m).trim())!;
    assert.strictEqual(getMessageText(finalAssistant).trim(), 'done');
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
        symbols: {},
        locations: {},
      },
    });

    const snapshot = snapshotSession(session);
    session.history[0]!.parts[0] = { type: 'text', text: 'mutated', state: 'done' } as any;
    session.fileHandles!.byId.F1 = 'mutated.ts';
    session.semanticHandles!.matches.M1!.preview = 'mutated';

    assert.deepStrictEqual(snapshot.history, [{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'hello', state: 'done' }] }]);
    assert.deepStrictEqual(snapshot.fileHandles, { nextId: 2, byId: { F1: 'src/index.ts' } });
    assert.deepStrictEqual(snapshot.semanticHandles, {
      nextMatchId: 2,
      nextSymbolId: 2,
      nextLocId: 2,
      matches: { M1: { fileId: 'F1', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, preview: 'x' } },
      symbols: {},
      locations: {},
    });
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

  test('prompt cache invalidation - changing systemPrompt invalidates the prompt prefix', async () => {
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
    assert.ok(secondPrompt.includes('Custom cache-sensitive system prompt.'), 'second prompt should include the custom system prompt');
    assertSecondTurnCacheInvalidation(llm, session, 'systemPrompt change', {
      promptPrefixPreserved: false,
      toolOrderingPreserved: true,
    });
  });

  test('prompt cache - restoring a previous systemPrompt can reuse an older cached baseline', async () => {
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

    assertCacheInvalidationBetweenTurns(llm, session, 1, 'systemPrompt change still invalidates immediately', {
      promptPrefixPreserved: false,
      toolOrderingPreserved: true,
    });
    assertCacheReuseAgainstTurn(llm, session, 2, 0, 'restored default systemPrompt baseline');
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

  test('prompt cache invalidation - allowExternalPaths can invalidate via the available-skills catalog', async () => {
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
        secondPrompt.includes('external-cache-skill'),
        'second prompt should list the external skill when external paths are enabled',
      );
      assertSecondTurnCacheInvalidation(llm, session, 'allowExternalPaths-driven skills catalog change', {
        promptPrefixPreserved: false,
        toolOrderingPreserved: true,
      });
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
      await fs.rm(externalSkillRoot, { recursive: true, force: true });
    }
  });

  test('prompt cache - toggling the external skill catalog back to a previous state reuses the matching cached baseline', async () => {
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
      assertCacheInvalidationBetweenTurns(llm, session, 2, 'blocking external skill catalog', {
        promptPrefixPreserved: false,
        toolOrderingPreserved: true,
      });
      assertCacheReuseBetweenTurns(llm, session, 3, 'steady-state blocked external skill catalog');
      assertCacheReuseAgainstTurn(llm, session, 4, 1, 'restored external skill catalog baseline');
      assert.strictEqual(
        llm.cacheReadSourceIndexHistory[4],
        1,
        're-enabling external skills should reuse the latest matching cached allowed baseline',
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

  test('prompt - replays reasoning_content + raw assistant text for openaiCompatible providers', async () => {
    const llm = new MockOpenAICompatibleProvider();
    const registry = new ToolRegistry();

    llm.queueResponse({
      kind: 'text',
      content: '<think>hidden reasoning</think> Hello<tool_call>{}</tool_call>World',
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
    assert.strictEqual(assistant.providerOptions?.openaiCompatible?.reasoning_content, 'hidden reasoning');
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
    assert.strictEqual(assistantText, ' Hello<tool_call>{}</tool_call>World');
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
          bad: 'drop-me.ts',
          F2: '   ',
        },
      },
    } as any;

    assert.strictEqual(registry.resolveFileId(session, 'F1'), 'src/foo.ts');
    assert.deepStrictEqual(session.fileHandles, {
      nextId: 2,
      byId: { F1: 'src/foo.ts' },
    });
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
    const perRun = 30; // maxIterations is 50; keep each run under the limit.
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
