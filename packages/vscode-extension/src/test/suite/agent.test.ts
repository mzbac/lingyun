/**
 * Agent Loop Tests (AI SDK-based)
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { convertToModelMessages } from 'ai';
import { simulateReadableStream } from 'ai/test';
import type {
  LanguageModelV3,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';

import { AgentLoop } from '../../core/agent';
import { WorkspaceMemories } from '../../core/memories';
import { SessionStore } from '../../core/sessionStore';
import { ToolRegistry } from '../../core/registry';
import type { LLMProvider } from '../../core/types';
import { createAssistantHistoryMessage, getMessageText, TOOL_ERROR_CODES } from '@kooka/core';
import { COMPACTED_TOOL_PLACEHOLDER, COMPACTION_AUTO_CONTINUE_TEXT, createHistoryForModel } from '../../core/compaction';
import { PluginManager } from '../../core/hooks/pluginManager';
import { backgroundTerminalManager } from '../../core/terminal/backgroundTerminal';
import { createBlankSessionSignals, recordConstraint, recordDecision, recordProcedure, recordStructuredMemory } from '../../core/sessionSignals';
import { createCopilotResponsesModel } from '../../providers/copilotResponsesModel';
import { bashHandler, bashTool } from '../../tools/builtin/bash';
import { taskHandler, taskTool } from '../../tools/builtin/task';

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

function getPromptMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('');
}

function extractRecallBlockFromPrompt(prompt: string): string {
  const recallStart = prompt.indexOf('<memory_recall_context>');
  const recallEnd = prompt.indexOf('</memory_recall_context>');
  return recallStart >= 0 && recallEnd > recallStart ? prompt.slice(recallStart, recallEnd) : '';
}

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
    {
      type: 'finish' as const,
      usage: usage(override),
      finishReason: { unified: 'stop', raw: 'stop' },
    },
  ];
}

function streamPartsForToolCall(call: Extract<ScriptedResponse, { kind: 'tool-call' }>): LanguageModelV3StreamPart[] {
  const finish = call.finishReason ?? 'tool-calls';
  return [
    {
      type: 'tool-call' as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: JSON.stringify(call.input),
    },
    {
      type: 'finish' as const,
      usage: usage(call.usage),
      finishReason: { unified: finish as any, raw: finish as any },
    },
  ];
}

function encodeSseEvents(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
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
      content: [
        {
          type: 'tool-call',
          toolCallId: response.toolCallId,
          toolName: response.toolName,
          input: JSON.stringify(response.input),
        } as any,
      ],
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

class MockLLMProvider implements LLMProvider {
  readonly id: string = 'mock';
  readonly name: string = 'Mock LLM';

  private responses: ScriptedResponse[] = [];
  callCount = 0;
  lastPrompt: unknown;
  lastCallOptions: unknown;

  protected nextResponse(): ScriptedResponse {
    return this.responses.shift() ?? { kind: 'text', content: 'No response configured' };
  }

  setNextResponse(response: ScriptedResponse): void {
    this.responses = [response];
  }

  queueResponse(response: ScriptedResponse): void {
    this.responses.push(response);
  }

  async getModel(modelId: string): Promise<unknown> {
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId,
      supportedUrls: {},
      doGenerate: async (options: any) => {
        this.callCount++;
        this.lastPrompt = options?.prompt;
        this.lastCallOptions = options;
        const response = this.nextResponse();
        return generateResultForResponse(response);
      },
      doStream: async (options: any): Promise<LanguageModelV3StreamResult> => {
        this.callCount++;
        this.lastPrompt = options?.prompt;
        this.lastCallOptions = options;

        const response = this.nextResponse();
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

class MockCopilotProvider extends MockLLMProvider {
  override readonly id: string = 'copilot';
  override readonly name: string = 'Copilot';

  override async getModel(modelId: string): Promise<unknown> {
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'copilot',
      modelId,
      supportedUrls: {},
      doGenerate: async (options: any) => {
        this.callCount++;
        this.lastPrompt = options?.prompt;
        this.lastCallOptions = options;
        const response = this.nextResponse();
        return generateResultForResponse(response);
      },
      doStream: async (options: any): Promise<LanguageModelV3StreamResult> => {
        this.callCount++;
        this.lastPrompt = options?.prompt;
        this.lastCallOptions = options;

        const response = this.nextResponse();
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

class MockOpenAICompatibleProvider extends MockLLMProvider {
  override readonly id: string = 'openaiCompatible';
  override readonly name: string = 'OpenAI-Compatible';
}

class MockCodexSubscriptionProvider extends MockLLMProvider {
  override readonly id: string = 'codexSubscription';
  override readonly name: string = 'ChatGPT Codex Subscription';
}

class MockCopilotResponsesApiProvider implements LLMProvider {
  readonly id: string = 'copilot';
  readonly name: string = 'Copilot';

  async getModel(modelId: string): Promise<unknown> {
    return createCopilotResponsesModel({
      baseURL: 'https://example.invalid',
      apiKey: 'test',
      modelId,
      headers: {},
    });
  }
}

class MockProviderWithModelMetadata extends MockLLMProvider {
  async getModels(): Promise<
    Array<{ id: string; name: string; vendor: string; family: string; maxInputTokens: number; maxOutputTokens: number }>
  > {
    return [
      {
        id: 'mock-model',
        name: 'Mock Model',
        vendor: 'mock',
        family: 'mock',
        maxInputTokens: 10,
        maxOutputTokens: 5,
      },
    ];
  }
}

suite('AgentLoop', () => {
  let mockLLM: MockLLMProvider;
  let registry: ToolRegistry;
  let agent: AgentLoop;
  let mockContext: vscode.ExtensionContext;

  setup(() => {
    mockLLM = new MockLLMProvider();
    registry = new ToolRegistry();
    mockContext = createMockExtensionContext();
    agent = new AgentLoop(mockLLM, mockContext, { model: 'mock-model' }, registry);

    registry.registerTool(
      {
        id: 'test_echo',
        name: 'Echo',
        description: 'Echoes back input',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
        execution: { type: 'function', handler: 'test_echo' },
      },
      async (args) => ({
        success: true,
        data: `Echo: ${args.message}`,
      })
    );
  });

  teardown(() => {
    registry.dispose();
  });

  test('run - simple response without tools', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'Hello! How can I help you?' });

    const result = await agent.run('Hi there');

    assert.strictEqual(result, 'Hello! How can I help you?');
    assert.strictEqual(mockLLM.callCount, 1);
  });

  test('run - injects Copilot reasoningEffort for GPT-5 models', async () => {
    const copilotLLM = new MockCopilotProvider();
    agent = new AgentLoop(copilotLLM, mockContext, { model: 'gpt-5' }, registry);
    copilotLLM.setNextResponse({ kind: 'text', content: 'OK' });

    await agent.run('Hi');

    const options = copilotLLM.lastCallOptions as any;
    assert.strictEqual(options?.providerOptions?.copilot?.reasoningEffort, 'high');
  });

  test('run - injects OpenAI reasoningEffort for Copilot Responses-routed models', async () => {
    for (const modelId of ['gpt-5.3-codex', 'gpt-5.4', 'gpt-5.5']) {
      const copilotLLM = new MockCopilotProvider();
      agent = new AgentLoop(copilotLLM, mockContext, { model: modelId }, registry);
      copilotLLM.setNextResponse({ kind: 'text', content: 'OK' });

      await agent.run('Hi');

      const options = copilotLLM.lastCallOptions as any;
      assert.strictEqual(options?.providerOptions?.openai?.reasoningEffort, 'high');
      assert.strictEqual(options?.providerOptions?.copilot?.reasoningEffort, 'high');
    }
  });

  test('run - injects reasoningEffort for Codex Subscription GPT-5 models', async () => {
    for (const modelId of ['gpt-5.3-codex', 'gpt-5.4', 'gpt-5.5']) {
      const codexLLM = new MockCodexSubscriptionProvider();
      agent = new AgentLoop(codexLLM, mockContext, { model: modelId }, registry);
      codexLLM.setNextResponse({ kind: 'text', content: 'OK' });

      await agent.run('Hi');

      const options = codexLLM.lastCallOptions as any;
      assert.strictEqual(options?.providerOptions?.codexSubscription?.reasoningEffort, 'high');
      assert.strictEqual(options?.providerOptions?.openai?.reasoningEffort, 'high');
    }
  });

  test('run - forces temperature=1 for fixed-temperature GPT-5 models', async () => {
    for (const modelId of ['gpt-5.3-codex', 'gpt-5.4', 'gpt-5.5']) {
      const copilotLLM = new MockCopilotProvider();
      agent = new AgentLoop(copilotLLM, mockContext, { model: modelId, temperature: 0.2 }, registry);
      copilotLLM.setNextResponse({ kind: 'text', content: 'OK' });

      await agent.run('Hi');

      const options = copilotLLM.lastCallOptions as any;
      assert.strictEqual(options?.temperature, 1);
    }
  });

  test('run - forwards configured maxOutputTokens to the model request', async () => {
    const openaiCompatibleLLM = new MockOpenAICompatibleProvider();
    agent = new AgentLoop(
      openaiCompatibleLLM,
      mockContext,
      { model: 'mock-model', maxOutputTokens: 12345 },
      registry,
    );
    openaiCompatibleLLM.setNextResponse({ kind: 'text', content: 'OK' });

    await agent.run('Hi');

    const options = openaiCompatibleLLM.lastCallOptions as any;
    assert.strictEqual(options?.maxOutputTokens, 12345);
  });

  test('updateConfig - refreshes maxOutputTokens for later model requests', async () => {
    const openaiCompatibleLLM = new MockOpenAICompatibleProvider();
    agent = new AgentLoop(
      openaiCompatibleLLM,
      mockContext,
      { model: 'mock-model', maxOutputTokens: 111 },
      registry,
    );
    openaiCompatibleLLM.setNextResponse({ kind: 'text', content: 'first' });
    await agent.run('First');

    agent.updateConfig({ maxOutputTokens: 222 });
    openaiCompatibleLLM.setNextResponse({ kind: 'text', content: 'second' });
    await agent.run('Second');

    const options = openaiCompatibleLLM.lastCallOptions as any;
    assert.strictEqual(options?.maxOutputTokens, 222);
  });

  test('run - applies Codex-style image boundaries for Copilot prompts', async () => {
    const copilotLLM = new MockCopilotProvider();
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'experimental.chat.messages.transform': async (_input, output) => {
        output.messages = [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'Describe this image:' },
              {
                type: 'file',
                mediaType: 'image/png',
                filename: 'sample.png',
                url: 'data:image/png;base64,AAAA',
              },
            ],
          },
        ];
      },
    });

    agent = new AgentLoop(copilotLLM, mockContext, { model: 'gpt-4o', sessionId: 'session-1' }, registry, plugins);
    copilotLLM.setNextResponse({ kind: 'text', content: 'OK' });

    await agent.run('Describe image');

    const prompt = copilotLLM.lastPrompt as any[];
    const user = prompt.find((msg) => msg?.role === 'user');
    assert.ok(user, 'expected user message in prompt');
    assert.ok(Array.isArray(user.content), 'expected multipart user content');

    const parts = user.content as any[];
    const openIndex = parts.findIndex((part) => part?.type === 'text' && part?.text === '<image>');
    const imageIndex = parts.findIndex((part) => part?.type === 'file' && part?.mediaType === 'image/png');
    const closeIndex = parts.findIndex((part) => part?.type === 'text' && part?.text === '</image>');

    assert.ok(openIndex >= 0, 'expected <image> boundary');
    assert.ok(imageIndex > openIndex, 'expected image part after open boundary');
    assert.ok(closeIndex > imageIndex, 'expected </image> boundary');
    const imageData = parts[imageIndex]?.data;
    const imageDataText = imageData instanceof URL ? imageData.toString() : String(imageData ?? '');
    assert.ok(
      imageDataText === 'AAAA' || imageDataText === 'data:image/png;base64,AAAA',
      `unexpected serialized image payload: ${imageDataText}`,
    );
  });

  test('run - accepts image file parts from user input', async () => {
    const copilotLLM = new MockCopilotProvider();
    agent = new AgentLoop(copilotLLM, mockContext, { model: 'gpt-4o', sessionId: 'session-1' }, registry);
    copilotLLM.setNextResponse({ kind: 'text', content: 'Looks like a screenshot.' });

    await agent.run([
      { type: 'text', text: 'What does this screenshot show?' },
      { type: 'file', mediaType: 'image/png', filename: 'clip.png', url: 'data:image/png;base64,BBBB' },
    ]);

    const prompt = copilotLLM.lastPrompt as any[];
    const user = prompt.find((msg) => msg?.role === 'user');
    assert.ok(user, 'expected user message in prompt');
    assert.ok(Array.isArray(user.content), 'expected multipart user content');

    const parts = user.content as any[];
    const openIndex = parts.findIndex((part) => part?.type === 'text' && part?.text === '<image>');
    const imageIndex = parts.findIndex((part) => part?.type === 'file' && part?.mediaType === 'image/png');
    const closeIndex = parts.findIndex((part) => part?.type === 'text' && part?.text === '</image>');

    assert.ok(openIndex >= 0, 'expected <image> boundary');
    assert.ok(imageIndex > openIndex, 'expected image part after open boundary');
    assert.ok(closeIndex > imageIndex, 'expected </image> boundary');
  });

  test('run - does not add Copilot image boundaries for non-Copilot providers', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'experimental.chat.messages.transform': async (_input, output) => {
        output.messages = [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'Describe this image:' },
              {
                type: 'file',
                mediaType: 'image/png',
                filename: 'sample.png',
                url: 'data:image/png;base64,AAAA',
              },
            ],
          },
        ];
      },
    });

    agent = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);
    mockLLM.setNextResponse({ kind: 'text', content: 'OK' });

    await agent.run('Describe image');

    const prompt = mockLLM.lastPrompt as any[];
    const user = prompt.find((msg) => msg?.role === 'user');
    assert.ok(user, 'expected user message in prompt');
    assert.ok(Array.isArray(user.content), 'expected multipart user content');

    const parts = user.content as any[];
    assert.strictEqual(parts.some((part) => part?.type === 'text' && part?.text === '<image>'), false);
    assert.strictEqual(parts.some((part) => part?.type === 'text' && part?.text === '</image>'), false);

    const imagePart = parts.find((part) => part?.type === 'file' && part?.mediaType === 'image/png');
    assert.ok(imagePart, 'expected image file part');
    assert.strictEqual(typeof imagePart.data, 'string');
  });

  test('run - strips <think> blocks from assistant output', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: '<think>hidden reasoning</think>\nHello' });

    const result = await agent.run('Hi');

    assert.strictEqual(result, 'Hello');
    const history = agent.getHistory();
    const last = history[history.length - 1];
    assert.strictEqual(last.role, 'assistant');
    assert.strictEqual(getMessageText(last), 'Hello');
  });

  test('run - strips stray </think> tags from assistant output', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: '</think>\nHello' });

    const result = await agent.run('Hi');

    assert.strictEqual(result, 'Hello');
  });

  test('continue - adds to existing history', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'First' });
    await agent.run('Hello');

    mockLLM.setNextResponse({ kind: 'text', content: 'Second' });
    await agent.continue('Follow up');

    const history = agent.getHistory();
    assert.strictEqual(history[2].role, 'user');
    assert.strictEqual(getMessageText(history[2]), 'Follow up');
    assert.strictEqual(history[3].role, 'assistant');
    assert.strictEqual(getMessageText(history[3]), 'Second');
  });

  test('continue - replays reasoning_content + raw assistant text for openaiCompatible prompts', async () => {
    const openaiCompatible = new MockOpenAICompatibleProvider();
    agent = new AgentLoop(
      openaiCompatible,
      mockContext,
      { model: 'mock-model', sessionId: 'session-1' },
      registry,
    );

    openaiCompatible.setNextResponse({
      kind: 'text',
      content: '<think>hidden reasoning</think> Hello<tool_call>{}</tool_call>World',
    });
    await agent.run('Hi');

    openaiCompatible.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.continue('Follow up');

    const prompt = openaiCompatible.lastPrompt as any[];
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

  test('continue - replays reasoning_text + raw assistant text for Copilot prompts', async () => {
    const copilotLLM = new MockCopilotProvider();
    agent = new AgentLoop(
      copilotLLM,
      mockContext,
      { model: 'gpt-4o', sessionId: 'session-1' },
      registry,
    );

    copilotLLM.setNextResponse({
      kind: 'text',
      content: '<think>hidden reasoning</think> Hello<tool_call>{}</tool_call>World',
    });
    await agent.run('Hi');

    copilotLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.continue('Follow up');

    const prompt = copilotLLM.lastPrompt as any[];
    const assistant = prompt.find((msg) => msg?.role === 'assistant');
    assert.ok(assistant, 'expected assistant message in prompt');
    assert.strictEqual(assistant.providerOptions?.openaiCompatible?.reasoning_text, 'hidden reasoning');
    assert.ok(Array.isArray(assistant.content), 'expected multipart assistant content');
    assert.strictEqual(
      (assistant.content as any[]).some((part) => part?.type === 'reasoning'),
      false,
      'reasoning parts should be lifted to reasoning_text',
    );
    const assistantText = (assistant.content as any[])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('');
    assert.strictEqual(assistantText, ' Hello<tool_call>{}</tool_call>World');
  });

  test('resume - copilot Claude prompts append a synthetic trailing user turn without persisting it', async () => {
    const copilotLLM = new MockCopilotProvider();
    agent = new AgentLoop(
      copilotLLM,
      mockContext,
      { model: 'claude-sonnet-4.5', sessionId: 'session-1' },
      registry,
    );

    copilotLLM.setNextResponse({ kind: 'text', content: 'First reply' });
    await agent.run('Hi');

    copilotLLM.setNextResponse({ kind: 'text', content: 'Resumed reply' });
    await agent.resume();

    const prompt = copilotLLM.lastPrompt as any[];
    const last = prompt[prompt.length - 1];
    assert.ok(last, 'expected a final prompt message');
    assert.strictEqual(last.role, 'user');
    assert.ok(
      getPromptMessageText(last.content).startsWith('Continue if you have next steps.'),
      'expected synthetic resume prompt to start with the continue text',
    );

    const history = agent.getHistory();
    assert.strictEqual(history[history.length - 1]?.role, 'assistant');
    assert.strictEqual(
      history.some((message) => message.role === 'user' && getMessageText(message).startsWith('Continue if you have next steps.')),
      false,
      'synthetic resume prompt should not be persisted in session history',
    );
  });

  test('continue - replays Copilot /responses reasoning replay metadata in prompt parts', async () => {
    const copilotLLM = new MockCopilotProvider();
    agent = new AgentLoop(
      copilotLLM,
      mockContext,
      { model: 'gpt-5.3-codex', sessionId: 'session-1' },
      registry,
    );

    copilotLLM.setNextResponse({
      kind: 'stream',
      chunks: [
        { type: 'text-start' as const, id: 'text_0' },
        { type: 'text-delta' as const, id: 'text_0', delta: 'H' },
        { type: 'text-delta' as const, id: 'text_0', delta: 'i' },
        { type: 'text-end' as const, id: 'text_0' },
        {
          type: 'finish' as const,
          usage: usage(),
          finishReason: { unified: 'stop', raw: 'stop' },
          providerMetadata: {
            copilot: {
              reasoningOpaque: 'rsn_123',
              reasoningEncryptedContent: 'enc_abc',
            },
          },
        },
      ],
    });
    await agent.run('Hi');

    copilotLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.continue('Follow up');

    const prompt = copilotLLM.lastPrompt as any[];
    const assistant = prompt.find((msg) => msg?.role === 'assistant');
    assert.ok(assistant, 'expected assistant message in prompt');
    assert.strictEqual(assistant.providerOptions?.openaiCompatible?.reasoning_text, undefined);

    const parts = Array.isArray(assistant.content) ? (assistant.content as any[]) : [];
    const reasoningPart = parts.find((part) => part?.type === 'reasoning');
    assert.ok(reasoningPart, 'expected reasoning part for /responses replay');
    assert.strictEqual(reasoningPart.providerOptions?.copilot?.reasoningOpaque, 'rsn_123');
    assert.strictEqual(reasoningPart.providerOptions?.copilot?.reasoningEncryptedContent, 'enc_abc');
  });

  test('run - executes tool calls', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_123',
      toolName: 'test_echo',
      input: { message: 'Hello World' },
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Echo something');
    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);

    const history = agent.getHistory();
    const toolResult = findDynamicToolResult(history, 'call_123');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, true);
    assert.strictEqual(toolResult?.data, 'Echo: Hello World');
  });

  test('run - actual Copilot Responses model preserves the v2.1.10 tool-call conversation flow', async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: Array<Record<string, unknown>> = [];
    const provider = new MockCopilotResponsesApiProvider();
    agent = new AgentLoop(provider, mockContext, { model: 'gpt-5.3-codex', sessionId: 'session-1' }, registry);

    const responseEventsQueue: unknown[][] = [
      [
        {
          type: 'response.output_text.delta',
          item_id: 'item_text_1',
          output_index: 0,
          delta: 'I will use echo.',
        },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: {
            type: 'function_call',
            call_id: 'call_1',
            name: 'test_echo',
            arguments: '',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 1,
          delta: '{"message":"Hello World"}',
        },
        {
          type: 'response.output_item.done',
          output_index: 1,
          item: {
            type: 'function_call',
            call_id: 'call_1',
            name: 'test_echo',
            arguments: '{"message":"Hello World"}',
          },
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'message',
            id: 'msg_1',
            content: [{ type: 'output_text', text: 'I will use echo.' }],
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            model: 'gpt-5.3-codex',
            created_at: 0,
            usage: {
              input_tokens: 10,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 12,
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ],
      [
        {
          type: 'response.output_text.delta',
          item_id: 'item_text_2',
          output_index: 0,
          delta: 'Done',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'message',
            id: 'msg_2',
            content: [{ type: 'output_text', text: 'Done' }],
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_2',
            model: 'gpt-5.3-codex',
            created_at: 0,
            usage: {
              input_tokens: 12,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 4,
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ],
    ];

    try {
      globalThis.fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        const events = responseEventsQueue.shift();
        assert.ok(events, 'unexpected extra Copilot Responses request');
        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const result = await agent.run('Echo something');

      assert.strictEqual(result, 'Done');
      assert.strictEqual(requestBodies.length, 2);

      const secondInput = requestBodies[1]?.input as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(secondInput), 'expected second Copilot request to have input history');
      assert.ok(
        secondInput.some((entry) => entry.type === 'function_call' && entry.call_id === 'call_1' && entry.name === 'test_echo'),
        'expected second request to replay the assistant tool call',
      );
      assert.ok(
        secondInput.some(
          (entry) =>
            entry.type === 'function_call_output' &&
            entry.call_id === 'call_1' &&
            entry.output === 'Echo: Hello World',
        ),
        'expected second request to include the tool result',
      );
      assert.ok(
        secondInput.some((entry) => entry.role === 'assistant' && JSON.stringify(entry.content).includes('I will use echo.')),
        'expected second request to keep the assistant text from the tool-call turn',
      );

      const history = agent.getHistory();
      const toolAssistant = history.find(
        (message) => message.role === 'assistant' && message.parts.some((part: any) => part.type === 'dynamic-tool' && part.toolCallId === 'call_1'),
      );
      assert.ok(toolAssistant, 'expected assistant tool-call turn in history');
      assert.strictEqual(getMessageText(toolAssistant!), 'I will use echo.');

      const toolResult = findDynamicToolResult(history, 'call_1');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, true);
      assert.strictEqual(toolResult?.data, 'Echo: Hello World');

      const finalAssistant = history[history.length - 1];
      assert.strictEqual(finalAssistant.role, 'assistant');
      assert.strictEqual(getMessageText(finalAssistant), 'Done');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('run - actual Copilot Responses model retries when assistant text stream truncates before response.completed', async () => {
    const originalFetch = globalThis.fetch;
    const requestBodies: Array<Record<string, unknown>> = [];
    const provider = new MockCopilotResponsesApiProvider();
    agent = new AgentLoop(
      provider,
      mockContext,
      { model: 'gpt-5.4', sessionId: 'session-1', maxRetries: 1, retryWithPartialOutput: true },
      registry,
    );

    const responseEventsQueue: unknown[][] = [
      [
        {
          type: 'response.output_text.delta',
          item_id: 'item_text_1',
          output_index: 0,
          delta: 'partial output',
        },
      ],
      [
        {
          type: 'response.output_text.delta',
          item_id: 'item_text_2',
          output_index: 0,
          delta: 'Hello',
        },
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: {
            type: 'message',
            id: 'msg_2',
            content: [{ type: 'output_text', text: 'Hello' }],
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_2',
            model: 'gpt-5.4',
            created_at: 0,
            usage: {
              input_tokens: 4,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 5,
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ],
    ];

    try {
      globalThis.fetch = async (_input, init) => {
        requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        const events = responseEventsQueue.shift();
        assert.ok(events, 'unexpected extra Copilot Responses request');
        return new Response(encodeSseEvents(events), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const result = await agent.run('Hi');

      assert.strictEqual(result, 'Hello');
      assert.strictEqual(requestBodies.length, 2);

      const secondInput = requestBodies[1]?.input as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(secondInput), 'expected retry request to have input history');
      assert.ok(
        !JSON.stringify(secondInput).includes('partial output'),
        'expected retry request to drop truncated assistant output from history',
      );

      const history = agent.getHistory();
      assert.strictEqual(history.filter((message) => message.role === 'assistant').length, 1);
      const finalAssistant = history[history.length - 1];
      assert.strictEqual(finalAssistant.role, 'assistant');
      assert.strictEqual(getMessageText(finalAssistant), 'Hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('run - task tool returns sanitized session_id and text payload', async () => {
    registry.registerTool(taskTool, taskHandler);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_task',
      toolName: 'task',
      input: {
        description: 'Explore task',
        prompt: 'Return a short answer.',
        subagent_type: 'general',
        session_id: '../evil',
      },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'subagent answer' }); // subagent
    mockLLM.queueResponse({ kind: 'text', content: 'parent done' }); // parent after tool result

    let taskResult: any;
    const result = await agent.run('Run a task', {
      onToolResult: (tool, toolOutput) => {
        if (tool.function.name === 'task') taskResult = toolOutput;
      },
    });
    assert.strictEqual(result, 'parent done');
    assert.strictEqual(mockLLM.callCount, 3);

    assert.ok(taskResult);
    assert.strictEqual(taskResult.success, true);
    assert.ok(taskResult.data && typeof taskResult.data === 'object');
    assert.strictEqual(taskResult.data.text, 'subagent answer');
    assert.strictEqual(taskResult.data.subagent_type, 'general');
    assert.ok(typeof taskResult.data.session_id === 'string' && taskResult.data.session_id.length > 0);
    assert.notStrictEqual(taskResult.data.session_id, '../evil');
    assert.ok(/^[a-zA-Z0-9_-]+$/.test(taskResult.data.session_id));
  });

  test('run - task tool caps injected subagent outputText', async () => {
    registry.registerTool(taskTool, taskHandler);

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevMaxChars = cfg.get<unknown>('subagents.task.maxOutputChars');
    await cfg.update('subagents.task.maxOutputChars', 500, true);

    const longText = 'x'.repeat(2000);

    try {
      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_task',
        toolName: 'task',
        input: {
          description: 'Explore task',
          prompt: 'Return a long answer.',
          subagent_type: 'general',
        },
      });
      mockLLM.queueResponse({ kind: 'text', content: longText }); // subagent
      mockLLM.queueResponse({ kind: 'text', content: 'parent done' }); // parent after tool result

      let taskResult: any;
      const result = await agent.run('Run a task', {
        onToolResult: (tool, toolOutput) => {
          if (tool.function.name === 'task') taskResult = toolOutput;
        },
      });
      assert.strictEqual(result, 'parent done');
      assert.strictEqual(mockLLM.callCount, 3);

      assert.ok(taskResult);
      const outputText = String(taskResult?.metadata?.outputText ?? '');
      assert.ok(outputText.includes('<task_metadata>'));
      assert.ok(outputText.includes('session_id:'));
      assert.ok(outputText.includes('[TRUNCATED]'));
      assert.ok(outputText.length <= 500);
    } finally {
      await cfg.update('subagents.task.maxOutputChars', prevMaxChars as any, true);
    }
  });

  test('file handles - glob assigns fileId and read resolves it', async () => {
    let readArgs: any;

    registry.registerTool(
      {
        id: 'glob',
        name: 'Glob Files',
        description: 'Find files matching a glob pattern',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } as any },
          required: ['pattern'],
        },
        execution: { type: 'function', handler: 'test.glob' },
        metadata: { protocol: { output: { glob: true } } } as any,
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
            fileId: { type: 'string' } as any,
            filePath: { type: 'string' } as any,
          },
          required: [],
        },
        execution: { type: 'function', handler: 'test.read' },
        metadata: { protocol: { input: { fileId: true } } } as any,
      },
      async (args) => {
        readArgs = args;
        return { success: true, data: 'ok' };
      }
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_glob',
      toolName: 'glob',
      input: { pattern: '**/*.ts' },
    });
    mockLLM.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_read',
      toolName: 'read',
      input: { fileId: 'F1' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Use file handles');
    assert.strictEqual(result, 'Done');

    const state = agent.exportState();
    assert.strictEqual(state.fileHandles?.byId.F1, 'src/foo.ts');
    assert.strictEqual(readArgs?.filePath, 'src/foo.ts');
  });

  test('file handles - grep assigns fileId and lsp resolves it', async () => {
    let lspArgs: any;

    registry.registerTool(
      {
        id: 'grep',
        name: 'Search in Files',
        description: 'Search for a regex pattern in files',
        parameters: {
          type: 'object',
          properties: { pattern: { type: 'string' } as any },
          required: ['pattern'],
        },
        execution: { type: 'function', handler: 'test.grep' },
        metadata: { protocol: { output: { grep: true } } } as any,
      },
      async () => ({
        success: true,
        data: {
          matches: [
            { filePath: 'src/foo.ts', line: 10, column: 5, text: 'const foo = 1;' },
            { filePath: 'src/bar.ts', line: 2, column: 1, text: 'foo();' },
          ],
          totalMatches: 2,
          truncated: false,
        },
      })
    );

    registry.registerTool(
      {
        id: 'lsp',
        name: 'Language Features (VS Code)',
        description: 'LSP tool',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string' } as any,
            fileId: { type: 'string' } as any,
            filePath: { type: 'string' } as any,
            line: { type: 'number' } as any,
            character: { type: 'number' } as any,
          },
          required: ['operation'],
        },
        execution: { type: 'function', handler: 'test.lsp' },
        metadata: { protocol: { input: { fileId: true } } } as any,
      },
      async (args) => {
        lspArgs = args;
        return { success: true, data: 'ok' };
      }
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_grep',
      toolName: 'grep',
      input: { pattern: 'foo' },
    });
    mockLLM.queueResponse({
      kind: 'tool-call',
      toolCallId: 'call_lsp',
      toolName: 'lsp',
      input: { operation: 'hover', fileId: 'F1', line: 10, character: 5 },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Use grep file handles');
    assert.strictEqual(result, 'Done');

    const state = agent.exportState();
    assert.strictEqual(state.fileHandles?.byId.F1, 'src/foo.ts');
    assert.strictEqual(lspArgs?.filePath, 'src/foo.ts');

    const history = agent.getHistory();
    const grepResult = findDynamicToolResult(history, 'call_grep');
    assert.ok(grepResult);
    assert.strictEqual(grepResult?.success, true);
    assert.ok(String(grepResult?.data || '').includes('F1'));
    assert.ok(String(grepResult?.data || '').toLowerCase().includes('lsp'), 'grep output should include lsp hint');
  });

  test('state round-trips pending steers and clear resets runtime state', async () => {
    agent.syncSession({
      state: {
        history: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as any],
        pendingInputs: ['queued follow-up'],
        mentionedSkills: ['skill-1'],
        compactionSyntheticContexts: [{ transientContext: 'memoryRecall', text: 'remember me' }],
        fileHandles: {
          nextId: 2.9,
          byId: {
            F1: ' src/foo.ts ',
            bad: 'drop-me.ts',
            F2: '   ',
          },
        },
        semanticHandles: {
          nextMatchId: 2,
          nextSymbolId: 2,
          nextLocId: 2,
          matches: { M1: { fileId: 'F1', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, preview: 'x' } },
          symbols: {},
          locations: {},
        },
      },
    });

    const state = agent.exportState();
    assert.deepStrictEqual(state.pendingInputs, ['queued follow-up']);
    assert.deepStrictEqual(state.mentionedSkills, ['skill-1']);
    assert.deepStrictEqual(state.compactionSyntheticContexts, [{ transientContext: 'memoryRecall', text: 'remember me' }]);
    assert.deepStrictEqual(state.fileHandles, { nextId: 2, byId: { F1: 'src/foo.ts' } });

    state.history[0]!.parts[0] = { type: 'text', text: 'mutated', state: 'done' } as any;
    const unaffected = agent.exportState();
    assert.deepStrictEqual(unaffected.history, [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]);

    await agent.clear();

    const cleared = agent.exportState();
    assert.deepStrictEqual(cleared.history, []);
    assert.deepStrictEqual(cleared.pendingInputs, []);
    assert.deepStrictEqual(cleared.mentionedSkills, []);
    assert.deepStrictEqual(cleared.compactionSyntheticContexts, []);
    assert.deepStrictEqual(cleared.fileHandles, { nextId: 1, byId: {} });
    assert.deepStrictEqual(cleared.semanticHandles, {
      nextMatchId: 1,
      nextSymbolId: 1,
      nextLocId: 1,
      matches: {},
      symbols: {},
      locations: {},
    });
  });

  test('run - continues when tool calls are present even if finishReason is stop', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_stop',
      toolName: 'test_echo',
      input: { message: 'x' },
      finishReason: 'stop',
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Do tool then answer');

    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);
  });

  test('run - retries transient terminated stream errors even after reasoning', async () => {
    agent.updateConfig({ maxRetries: 1 });

    const err = {
      name: 'TypeError',
      message: 'terminated',
      responseHeaders: { 'retry-after-ms': '1' },
    };

    mockLLM.setNextResponse({
      kind: 'stream',
      chunks: [
        { type: 'reasoning-start' as const, id: 'r1' },
        { type: 'reasoning-delta' as const, id: 'r1', delta: 'some reasoning' },
        { type: 'error' as const, error: err },
      ],
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Hello' });

    const result = await agent.run('Hi');
    assert.strictEqual(result, 'Hello');
    assert.strictEqual(mockLLM.callCount, 2);

    const history = agent.getHistory();
    assert.strictEqual(history.filter(m => m.role === 'assistant').length, 1);
    assert.strictEqual(getMessageText(history[history.length - 1]), 'Hello');
  });

  test('run - retries transient terminated stream errors after assistant output', async () => {
    agent.updateConfig({ maxRetries: 1, retryWithPartialOutput: true });

    const err = {
      name: 'TypeError',
      message: 'terminated',
      responseHeaders: { 'retry-after-ms': '1' },
    };

    mockLLM.setNextResponse({
      kind: 'stream',
      chunks: [
        { type: 'text-start' as const, id: 't0' },
        { type: 'text-delta' as const, id: 't0', delta: 'partial output' },
        { type: 'error' as const, error: err },
      ],
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Hello' });

    const result = await agent.run('Hi');
    assert.strictEqual(result, 'Hello');
    assert.strictEqual(mockLLM.callCount, 2);

    const history = agent.getHistory();
    assert.strictEqual(history.filter(m => m.role === 'assistant').length, 1);
    assert.strictEqual(getMessageText(history[history.length - 1]), 'Hello');
  });

  test('run - retries copilot codex responses parser-state errors before finish', async () => {
    const copilotLLM = new MockCopilotProvider();
    agent = new AgentLoop(copilotLLM, mockContext, { model: 'gpt-5.3-codex', maxRetries: 1 }, registry);

    copilotLLM.setNextResponse({
      kind: 'stream',
      chunks: [
        {
          type: 'error' as const,
          error: {
            name: 'TypeError',
            message: "Cannot read properties of undefined (reading 'summaryParts')",
          },
        },
      ],
    });
    copilotLLM.queueResponse({ kind: 'text', content: 'Hello' });

    const result = await agent.run('Hi');
    assert.strictEqual(result, 'Hello');
    assert.strictEqual(copilotLLM.callCount, 2);
  });

  test('run - ignores post-finish copilot codex responses parser-state errors', async () => {
    const copilotLLM = new MockCopilotProvider();
    agent = new AgentLoop(copilotLLM, mockContext, { model: 'gpt-5.3-codex', maxRetries: 0 }, registry);

    copilotLLM.setNextResponse({
      kind: 'stream',
      chunks: [
        { type: 'text-start' as const, id: 't0' },
        { type: 'text-delta' as const, id: 't0', delta: 'Hello' },
        { type: 'text-end' as const, id: 't0' },
        {
          type: 'finish' as const,
          usage: usage(),
          finishReason: { unified: 'stop', raw: 'stop' },
        },
        {
          type: 'error' as const,
          error: {
            name: 'TypeError',
            message: "Cannot read properties of undefined (reading 'summaryParts')",
          },
        },
      ],
    });

    const result = await agent.run('Hi');
    assert.strictEqual(result, 'Hello');
    assert.strictEqual(copilotLLM.callCount, 1);
  });

  test('external paths disabled - blocks tool calls even with autoApprove', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'test_external',
          name: 'External Tool',
          description: 'Tool that accepts a filePath',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
            },
            required: ['filePath'],
          },
          execution: { type: 'function', handler: 'test_external' },
          metadata: {
            permission: 'read',
            readOnly: true,
            supportsExternalPaths: true,
            permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_ext_disabled',
        toolName: 'test_external',
        input: { filePath: externalPath },
      });
      mockLLM.queueResponse({ kind: 'text', content: '' });

      const result = await agent.run('Try external path');
      assert.strictEqual(result, '');
      assert.strictEqual(executed, false);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_ext_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.ok(String(toolResult?.error || '').includes('External paths are disabled'));
      const meta = (toolResult as any)?.metadata || {};
      assert.strictEqual(meta.errorCode, TOOL_ERROR_CODES.external_paths_disabled);
      assert.strictEqual(meta.blockedSettingKey, 'lingyun.security.allowExternalPaths');
      assert.strictEqual(meta.isOutsideWorkspace, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths disabled - blocks shell commands that reference external paths (bash)', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Test Bash',
          description: 'Simulates the bash tool',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_ext_disabled',
        toolName: 'bash',
        input: { command: `cat ${externalPath}` },
      });
      mockLLM.queueResponse({ kind: 'text', content: '' });

      const result = await agent.run('Try running a shell tool');
      assert.strictEqual(result, '');
      assert.strictEqual(executed, false);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_ext_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.ok(String(toolResult?.error || '').includes('references paths outside'));
      const meta = (toolResult as any)?.metadata || {};
      assert.strictEqual(meta.errorCode, TOOL_ERROR_CODES.external_paths_disabled);
      assert.strictEqual(meta.blockedSettingKey, 'lingyun.security.allowExternalPaths');
      assert.ok(Array.isArray(meta.blockedPaths));
      assert.ok((meta.blockedPaths as any[]).includes(externalPath));
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths disabled - blocks shell commands that reference env-expanded paths (bash)', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      let executed = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Test Bash',
          description: 'Simulates the bash tool',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash.env' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_env_disabled',
        toolName: 'bash',
        input: { command: 'cat $HOME/.ssh/id_rsa' },
      });
      mockLLM.queueResponse({ kind: 'text', content: '' });

      const result = await agent.run('Try running an env-expanded shell path');
      assert.strictEqual(result, '');
      assert.strictEqual(executed, false);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_env_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.ok(String(toolResult?.error || '').includes('references paths outside'));
      const meta = (toolResult as any)?.metadata || {};
      assert.strictEqual(meta.errorCode, TOOL_ERROR_CODES.external_paths_disabled);
      assert.strictEqual(meta.blockedSettingKey, 'lingyun.security.allowExternalPaths');
      assert.ok(Array.isArray(meta.blockedPaths));
      const blockedPaths = meta.blockedPaths as any[];
      assert.ok(
        blockedPaths.some((p: any) => {
          const value = String(p || '');
          return value.includes('$HOME/.ssh/id_rsa') || value.endsWith('/.ssh/id_rsa') || value.endsWith('\\.ssh\\id_rsa');
        })
      );
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths disabled - allows workspace-safe shell commands (bash)', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      let executed = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Test Bash',
          description: 'Simulates the bash tool',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash.safe' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_safe_disabled',
        toolName: 'bash',
        input: { command: 'mkdir -p snake_game' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Try running a safe shell tool', {
        onRequestApproval: async () => true,
      });
      assert.strictEqual(result, 'Done');
      assert.strictEqual(executed, true);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_safe_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths enabled - allows shell commands with external paths (bash)', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', true, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Test Bash',
          description: 'Simulates the bash tool',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_ext_enabled',
        toolName: 'bash',
        input: { command: `cat ${externalPath}` },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Try running a shell tool');
      assert.strictEqual(result, 'Done');
      assert.strictEqual(executed, true);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_ext_enabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('run - real bash tool forwards foreground failure outputText into the next prompt', async () => {
    registry.registerTool(bashTool, bashHandler);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_bash_real_fail',
      toolName: 'bash',
      input: { command: `node -e "console.error('boom from stderr'); process.exit(7)"` },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Run a failing shell command');
    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);

    const toolResult = findDynamicToolResult(agent.getHistory(), 'call_bash_real_fail');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.match(String((toolResult as any)?.metadata?.outputText || ''), /Command failed with exit code 7/);
    assert.match(String((toolResult as any)?.metadata?.outputText || ''), /boom from stderr/);

    const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.match(prompt, /Command failed with exit code 7/);
    assert.match(prompt, /boom from stderr/);
  });

  test('run - real bash tool forwards background startup failure outputText into the next prompt', async () => {
    registry.registerTool(bashTool, bashHandler);

    const originalRunner = process.env.LINGYUN_BASH_BACKGROUND_RUNNER;
    delete process.env.LINGYUN_BASH_BACKGROUND_RUNNER;

    const originalStart = backgroundTerminalManager.start.bind(backgroundTerminalManager);
    (backgroundTerminalManager as any).start = async () => ({
      success: false,
      error: 'Background command finished during startup with exit code 1.',
      metadata: {
        background: true,
        errorCode: TOOL_ERROR_CODES.bash_background_pid_unavailable,
        outputText: 'Background command finished during startup with exit code 1.\n\nStartup output:\nboom from startup',
      },
    });

    try {
      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_bash_real_bg_fail',
        toolName: 'bash',
        input: { command: 'node -e "process.exit(1)"', background: true },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Run a failing background shell command');
      assert.strictEqual(result, 'Done');
      assert.strictEqual(mockLLM.callCount, 2);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_bash_real_bg_fail');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.match(String((toolResult as any)?.metadata?.outputText || ''), /Background command finished during startup/);
      assert.match(String((toolResult as any)?.metadata?.outputText || ''), /boom from startup/);

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      assert.match(prompt, /Background command finished during startup/);
      assert.match(prompt, /boom from startup/);
    } finally {
      (backgroundTerminalManager as any).start = originalStart;
      if (originalRunner === undefined) {
        delete process.env.LINGYUN_BASH_BACKGROUND_RUNNER;
      } else {
        process.env.LINGYUN_BASH_BACKGROUND_RUNNER = originalRunner;
      }
    }
  });

  test('external paths disabled - blocks tools with execution.type="shell" when script references external paths', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', false, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'workspace_shell_tool',
          name: 'Workspace Shell Tool',
          description: 'Tool that executes a shell script',
          parameters: {
            type: 'object',
            properties: {},
          },
          execution: { type: 'shell', script: `cat ${externalPath}` },
          metadata: { requiresApproval: false },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_shell_type_disabled',
        toolName: 'workspace_shell_tool',
        input: {},
      });
      mockLLM.queueResponse({ kind: 'text', content: '' });

      const result = await agent.run('Try running a workspace shell tool');
      assert.strictEqual(result, '');
      assert.strictEqual(executed, false);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_shell_type_disabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, false);
      assert.ok(String(toolResult?.error || '').includes('references paths outside'));
      const meta = (toolResult as any)?.metadata || {};
      assert.strictEqual(meta.errorCode, TOOL_ERROR_CODES.external_paths_disabled);
      assert.strictEqual(meta.blockedSettingKey, 'lingyun.security.allowExternalPaths');
      assert.ok(Array.isArray(meta.blockedPaths));
      assert.ok((meta.blockedPaths as any[]).includes(externalPath));
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('external paths enabled - allows tool calls with external path', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prev = cfg.get('security.allowExternalPaths');

    await cfg.update('security.allowExternalPaths', true, true);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        assert.ok(true, 'no workspace root available for this test environment');
        return;
      }

      const externalPath = path.resolve(workspaceRoot, '..', 'outside.txt');
      let executed = false;

      registry.registerTool(
        {
          id: 'test_external2',
          name: 'External Tool 2',
          description: 'Tool that accepts a filePath',
          parameters: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
            },
            required: ['filePath'],
          },
          execution: { type: 'function', handler: 'test_external2' },
          metadata: {
            permission: 'read',
            readOnly: true,
            supportsExternalPaths: true,
            permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_ext_enabled',
        toolName: 'test_external2',
        input: { filePath: externalPath },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Try external path');
      assert.strictEqual(result, 'Done');
      assert.strictEqual(executed, true);

      const toolResult = findDynamicToolResult(agent.getHistory(), 'call_ext_enabled');
      assert.ok(toolResult);
      assert.strictEqual(toolResult?.success, true);
    } finally {
      await cfg.update('security.allowExternalPaths', prev as any, true);
    }
  });

  test('dotenv read requires manual approval even when autoApprove is enabled', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevAutoApprove = cfg.get('autoApprove');
    await cfg.update('autoApprove', true, true);

    try {
      let executed = false;
      let approvalRequested = false;

      registry.registerTool(
        {
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
          execution: { type: 'function', handler: 'test.read' },
          metadata: {
            permission: 'read',
            readOnly: true,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_dotenv_read',
        toolName: 'read',
        input: { filePath: '.env' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Read dotenv file', {
        onRequestApproval: async () => {
          approvalRequested = true;
          return true;
        },
      });

      assert.strictEqual(result, 'Done');
      assert.strictEqual(approvalRequested, true);
      assert.strictEqual(executed, true);
    } finally {
      await cfg.update('autoApprove', prevAutoApprove as any, true);
    }
  });

  test('dotenv sample files do not require manual approval', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevAutoApprove = cfg.get('autoApprove');
    await cfg.update('autoApprove', true, true);

    try {
      let executed = false;
      let approvalRequested = false;

      registry.registerTool(
        {
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
          execution: { type: 'function', handler: 'test.read.sample' },
          metadata: {
            permission: 'read',
            readOnly: true,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'filePath', kind: 'path' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_dotenv_sample',
        toolName: 'read',
        input: { filePath: '.env.example' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Read dotenv sample file', {
        onRequestApproval: async () => {
          approvalRequested = true;
          return true;
        },
      });

      assert.strictEqual(result, 'Done');
      assert.strictEqual(approvalRequested, false);
      assert.strictEqual(executed, true);
    } finally {
      await cfg.update('autoApprove', prevAutoApprove as any, true);
    }
  });

  test('dotenv shell reads require manual approval even when autoApprove is enabled', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevAutoApprove = cfg.get('autoApprove');
    await cfg.update('autoApprove', true, true);

    try {
      let executed = false;
      let approvalRequested = false;

      registry.registerTool(
        {
          id: 'bash',
          name: 'Run Command',
          description: 'Executes a shell command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execution: { type: 'function', handler: 'test.bash.dotenv' },
          metadata: {
            permission: 'bash',
            readOnly: false,
            requiresApproval: false,
            permissionPatterns: [{ arg: 'command', kind: 'command' }],
          },
        },
        async () => {
          executed = true;
          return { success: true, data: 'ok' };
        }
      );

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_dotenv_shell',
        toolName: 'bash',
        input: { command: 'python -c "print(open(\'.env\').read())"' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Read dotenv through shell', {
        onRequestApproval: async () => {
          approvalRequested = true;
          return true;
        },
      });

      assert.strictEqual(result, 'Done');
      assert.strictEqual(approvalRequested, true);
      assert.strictEqual(executed, true);
    } finally {
      await cfg.update('autoApprove', prevAutoApprove as any, true);
    }
  });

  test('auto compaction - triggers after tool-call overflow', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousLimits = cfg.get('modelLimits');

    await cfg.update(
      'modelLimits',
      {
        'mock-model': { context: 10, output: 5 },
      },
      true
    );

    try {
      const compactionEvents: Array<
        | { type: 'start'; auto: boolean; markerMessageId: string }
        | {
          type: 'end';
          auto: boolean;
          markerMessageId: string;
          summaryMessageId?: string;
          status: 'done' | 'error' | 'canceled';
          error?: string;
        }
      > = [];

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_overflow',
        toolName: 'test_echo',
        input: { message: 'Hello World' },
        usage: { inputNoCache: 10, cacheRead: 0, outputTotal: 1 },
      });

      mockLLM.queueResponse({ kind: 'text', content: 'Summary of progress' });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Do a thing', {
        onCompactionStart: (event) => {
          compactionEvents.push({ type: 'start', auto: event.auto, markerMessageId: event.markerMessageId });
        },
        onCompactionEnd: (event) => {
          compactionEvents.push({
            type: 'end',
            auto: event.auto,
            markerMessageId: event.markerMessageId,
            summaryMessageId: event.summaryMessageId,
            status: event.status,
            error: event.error,
          });
        },
      });
      assert.strictEqual(result, 'Done');
      assert.strictEqual(mockLLM.callCount, 3, 'tool call + compaction + final response');

      const history = agent.getHistory();
      assert.ok(history.some(m => m.role === 'assistant' && m.metadata?.summary === true), 'summary message exists');
      assert.ok(history.some(m => m.role === 'user' && m.metadata?.compaction), 'compaction marker exists');

      const start = compactionEvents.find(e => e.type === 'start');
      const end = compactionEvents.find(e => e.type === 'end');
      assert.ok(start && start.auto === true, 'compaction start event exists');
      assert.ok(end && end.auto === true && end.status === 'done', 'compaction end event exists');
    } finally {
      await cfg.update('modelLimits', previousLimits as any, true);
    }
  });

  test('auto compaction - prefers provider-scoped modelLimits over plain model keys', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousLimits = cfg.get('modelLimits');
    const codexLLM = new MockCodexSubscriptionProvider();
    agent = new AgentLoop(codexLLM, mockContext, { model: 'gpt-5.4' }, registry);

    await cfg.update(
      'modelLimits',
      {
        'gpt-5.4': { context: 1000, output: 5 },
        'codexSubscription:gpt-5.4': { context: 10, output: 5 },
      },
      true
    );

    try {
      const compactionEvents: Array<
        | { type: 'start'; auto: boolean; markerMessageId: string }
        | {
          type: 'end';
          auto: boolean;
          markerMessageId: string;
          summaryMessageId?: string;
          status: 'done' | 'error' | 'canceled';
          error?: string;
        }
      > = [];

      codexLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_provider_scoped_overflow',
        toolName: 'test_echo',
        input: { message: 'Hello World' },
        usage: { inputNoCache: 10, cacheRead: 0, outputTotal: 1 },
      });
      codexLLM.queueResponse({ kind: 'text', content: 'Summary of progress' });
      codexLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Do a thing', {
        onCompactionStart: (event) => {
          compactionEvents.push({ type: 'start', auto: event.auto, markerMessageId: event.markerMessageId });
        },
        onCompactionEnd: (event) => {
          compactionEvents.push({
            type: 'end',
            auto: event.auto,
            markerMessageId: event.markerMessageId,
            summaryMessageId: event.summaryMessageId,
            status: event.status,
            error: event.error,
          });
        },
      });

      assert.strictEqual(result, 'Done');
      assert.strictEqual(codexLLM.callCount, 3, 'tool call + compaction + final response');

      const start = compactionEvents.find(e => e.type === 'start');
      const end = compactionEvents.find(e => e.type === 'end');
      assert.ok(start && start.auto === true, 'compaction start event exists');
      assert.ok(end && end.auto === true && end.status === 'done', 'compaction end event exists');
    } finally {
      await cfg.update('modelLimits', previousLimits as any, true);
    }
  });

  test('continue - auto compacts before the next user turn and preserves the real follow-up input', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousLimits = cfg.get('modelLimits');
    await cfg.update('modelLimits', undefined, true);

    const metadataLLM = new MockProviderWithModelMetadata();
    agent = new AgentLoop(metadataLLM, mockContext, { model: 'mock-model' }, registry);

    try {
      metadataLLM.setNextResponse({
        kind: 'text',
        content: 'First done',
        usage: { inputNoCache: 10, cacheRead: 0, outputTotal: 1 },
      });
      await agent.run('First task');

      const compactionEvents: Array<
        | { type: 'start'; auto: boolean; markerMessageId: string }
        | {
          type: 'end';
          auto: boolean;
          markerMessageId: string;
          summaryMessageId?: string;
          status: 'done' | 'error' | 'canceled';
          error?: string;
        }
      > = [];

      metadataLLM.setNextResponse({ kind: 'text', content: 'Summary of progress' });
      metadataLLM.queueResponse({ kind: 'text', content: 'Second done' });

      const result = await agent.continue('Follow up', {
        onCompactionStart: (event) => {
          compactionEvents.push({ type: 'start', auto: event.auto, markerMessageId: event.markerMessageId });
        },
        onCompactionEnd: (event) => {
          compactionEvents.push({
            type: 'end',
            auto: event.auto,
            markerMessageId: event.markerMessageId,
            summaryMessageId: event.summaryMessageId,
            status: event.status,
            error: event.error,
          });
        },
      });

      assert.strictEqual(result, 'Second done');
      assert.strictEqual(metadataLLM.callCount, 3, 'first turn + preflight compaction + final response');

      const history = agent.getHistory();
      assert.ok(history.some(m => m.role === 'assistant' && m.metadata?.summary === true), 'summary message exists');
      assert.ok(history.some(m => m.role === 'user' && m.metadata?.compaction), 'compaction marker exists');
      assert.ok(history.some(m => getMessageText(m) === 'Follow up'), 'real follow-up input is preserved in history');
      assert.strictEqual(
        history.some(m => getMessageText(m) === COMPACTION_AUTO_CONTINUE_TEXT),
        false,
        'preflight auto compaction should not inject a synthetic continue message before the real follow-up input',
      );

      const prompt = JSON.stringify(metadataLLM.lastPrompt ?? '');
      assert.ok(prompt.includes('Follow up'), 'final prompt should include the real follow-up input');
      assert.ok(!prompt.includes(COMPACTION_AUTO_CONTINUE_TEXT), 'final prompt should not contain the synthetic continue text');

      const start = compactionEvents.find(e => e.type === 'start');
      const end = compactionEvents.find(e => e.type === 'end');
      assert.ok(start && start.auto === true, 'auto preflight compaction should emit start');
      assert.ok(end && end.auto === true && end.status === 'done', 'auto preflight compaction should emit success');
    } finally {
      await cfg.update('modelLimits', previousLimits as any, true);
    }
  });

  test('createHistoryForModel - replaces compacted tool output with placeholder', () => {
    const history = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'test_echo',
            toolCallId: 'call_1',
            state: 'output-available',
            input: { message: 'x' },
            output: { success: true, data: 'secret tool output' },
            compactedAt: Date.now(),
          } as any,
        ],
      },
    ] as any[];

    const prepared = createHistoryForModel(history as any);
    const toolPart = (prepared[1] as any).parts[0];
    assert.strictEqual(toolPart.output.data, COMPACTED_TOOL_PLACEHOLDER);
  });

  test('run - tool output compaction afterToolCall', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousMode = cfg.get<unknown>('compaction.toolOutputMode');
    await cfg.update('compaction.toolOutputMode', 'afterToolCall', true);

    try {
      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_compact_1',
        toolName: 'test_echo',
        input: { message: 'Hello' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Echo something');
      assert.strictEqual(result, 'Done');

      const history = agent.getHistory();
      const toolMessage = history.find(
        (m) =>
          m.role === 'assistant' &&
          m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test_echo' && p.state === 'output-available'),
      ) as any;
      assert.ok(toolMessage, 'tool message exists');

      const toolPart = toolMessage.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test_echo') as any;
      assert.ok(typeof toolPart.compactedAt === 'number', 'tool output is marked compacted after being consumed once');

      const prepared = createHistoryForModel(history as any);
      const preparedToolMessage = prepared.find(
        (m: any) =>
          m.role === 'assistant' &&
          m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test_echo' && p.state === 'output-available'),
      ) as any;
      const preparedToolPart = preparedToolMessage.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test_echo') as any;
      assert.strictEqual(preparedToolPart.output.data, COMPACTED_TOOL_PLACEHOLDER);
    } finally {
      await cfg.update('compaction.toolOutputMode', previousMode as any, true);
    }
  });

  test('run - tool output compaction onCompaction', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const previousMode = cfg.get<unknown>('compaction.toolOutputMode');
    await cfg.update('compaction.toolOutputMode', 'onCompaction', true);

    try {
      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_compact_2',
        toolName: 'test_echo',
        input: { message: 'Hello' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Done' });

      const result = await agent.run('Echo something');
      assert.strictEqual(result, 'Done');

      const history = agent.getHistory();
      const toolMessage = history.find(
        (m) =>
          m.role === 'assistant' &&
          m.parts.some((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test_echo' && p.state === 'output-available'),
      ) as any;
      assert.ok(toolMessage, 'tool message exists');

      const toolPart = toolMessage.parts.find((p: any) => p.type === 'dynamic-tool' && p.toolName === 'test_echo') as any;
      assert.ok(toolPart.compactedAt === undefined, 'tool output is not compacted outside of session compaction');
      assert.strictEqual(toolPart.output?.data, 'Echo: Hello');
    } finally {
      await cfg.update('compaction.toolOutputMode', previousMode as any, true);
    }
  });

  test('history conversion - tool messages always follow tool calls', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_seq',
      toolName: 'test_echo',
      input: { message: 'Hello' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    await agent.run('Echo something');

    const history = agent.getHistory();
    const withoutIds = history.map(({ id: _id, ...rest }) => rest);
    const modelMessages = await convertToModelMessages(withoutIds as any);

    let previousAssistantHadToolCall = false;
    for (const msg of modelMessages as any[]) {
      if (msg.role === 'assistant') {
        const content = Array.isArray(msg.content) ? msg.content : [];
        previousAssistantHadToolCall = content.some((p: any) => p?.type === 'tool-call');
        continue;
      }

      if (msg.role === 'tool') {
        assert.strictEqual(previousAssistantHadToolCall, true, 'tool message must follow assistant tool-call');
        previousAssistantHadToolCall = false;
      } else {
        previousAssistantHadToolCall = false;
      }
    }
  });

  test('run - plan mode blocks edit tools (write)', async () => {
    agent.updateConfig({ mode: 'plan' });

    registry.registerTool(
      {
        id: 'write',
        name: 'Write File',
        description: 'Writes a file',
        parameters: {
          type: 'object',
          properties: { filePath: { type: 'string' }, content: { type: 'string' } },
          required: ['filePath', 'content'],
        },
        execution: { type: 'function', handler: 'write' },
        metadata: { category: 'file', requiresApproval: true },
      },
      async () => ({ success: true })
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_plan_1',
      toolName: 'write',
      input: { filePath: 'README.md', content: 'hi' },
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Try tool in plan mode');
    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);

    const history = agent.getHistory();
    const toolResult = findDynamicToolResult(history, 'call_plan_1');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.ok(String(toolResult?.error).toLowerCase().includes('plan mode'));
  });

  test('run - plan mode blocks non-readOnly tools even if permission is spoofed', async () => {
    agent.updateConfig({ mode: 'plan' });

    let called = false;
    registry.registerTool(
      {
        id: 'test_spoof_task_permission',
        name: 'Spoof Task Permission',
        description: 'Attempts to bypass plan mode by setting permission=task',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test_spoof_task_permission' },
        metadata: {
          requiresApproval: false,
          permission: 'task',
          readOnly: false,
        },
      },
      async () => {
        called = true;
        return { success: true, data: 'executed' };
      },
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_plan_spoof_1',
      toolName: 'test_spoof_task_permission',
      input: {},
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Try spoof tool in plan mode');
    assert.strictEqual(result, 'Done');
    assert.strictEqual(called, false, 'tool handler should not be invoked when blocked in plan mode');

    const history = agent.getHistory();
    const toolResult = findDynamicToolResult(history, 'call_plan_spoof_1');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.ok(String(toolResult?.error).toLowerCase().includes('plan mode'));
  });

  test('run - requests approval for tools', async () => {
    registry.registerTool(
      {
        id: 'test_dangerous',
        name: 'Dangerous',
        description: 'Needs approval',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test_dangerous' },
        metadata: { requiresApproval: true },
      },
      async () => ({ success: true, data: 'executed' })
    );

    let approvalRequested = false;

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_danger',
      toolName: 'test_dangerous',
      input: {},
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    await agent.run('Do something dangerous', {
      onRequestApproval: async () => {
        approvalRequested = true;
        return true;
      },
    });

    assert.strictEqual(approvalRequested, true);
  });

  test('run - rejects tool when not approved', async () => {
    registry.registerTool(
      {
        id: 'test_reject',
        name: 'Reject',
        description: 'Will be rejected',
        parameters: { type: 'object', properties: {} },
        execution: { type: 'function', handler: 'test_reject' },
        metadata: { requiresApproval: true },
      },
      async () => ({ success: true, data: 'should not run' })
    );

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_reject',
      toolName: 'test_reject',
      input: {},
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await agent.run('Try rejected tool', {
      onRequestApproval: async () => false,
    });

    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);
    const history = agent.getHistory();
    const toolResult = findDynamicToolResult(history, 'call_reject');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.ok(String(toolResult?.error).toLowerCase().includes('rejected'));
  });

  test('abort - stops the agent', async () => {
    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_abort',
      toolName: 'test_echo',
      input: { message: 'x' },
    });

    try {
      await agent.run('Abort', {
        onToolCall: () => agent.abort(),
      });
      assert.fail('Should have thrown');
    } catch (e: unknown) {
      assert.ok(e instanceof Error && e.message.toLowerCase().includes('aborted'));
    }
  });

  test('plan + execute - runs plan first, then executes', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: '1. Do the thing\n2. Verify\n3. Report' });
    const plan = await agent.plan('Do the thing');
    assert.ok(plan.includes('1.'));

    mockLLM.setNextResponse({ kind: 'text', content: 'Done' });
    const result = await agent.execute();

    assert.strictEqual(result, 'Done');
    assert.strictEqual(mockLLM.callCount, 2);
  });

  test('plan - preserves prior conversation when invoked mid-session', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.run('Hello');

    agent.setMode('plan');
    mockLLM.setNextResponse({ kind: 'text', content: '1. Step\n2. Step' });
    await agent.plan('Make a plan');

    const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.ok(prompt.includes('Hello'), 'planning prompt should include earlier conversation history');

    const history = agent.getHistory();
    assert.ok(history.length >= 4, 'history should retain prior turns plus the new planning turn');
  });

  test('mode switch - injects plan/build reminders', async () => {
    mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.run('Hello');

    agent.setMode('plan');
    mockLLM.setNextResponse({ kind: 'text', content: '1. Step\n2. Step' });
    await agent.continue('Make a plan');

    const planPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.ok(planPrompt.includes('Plan mode is active'), 'plan reminder should be injected into prompt');

    agent.setMode('build');
    mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.continue('Now execute');

    const buildPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.ok(
      buildPrompt.includes('operational mode has changed from plan to build'),
      'build switch reminder should be injected into prompt after plan',
    );
  });

  test('prompt - does not inject external path access state into the prompt', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevAllow = cfg.get<unknown>('security.allowExternalPaths');
    await cfg.update('security.allowExternalPaths', true, true);

    try {
      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Hello');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      assert.ok(!prompt.includes('External paths are enabled'), 'external path setting should not be embedded in the prompt');
      assert.ok(!prompt.includes('External paths are disabled'), 'external path setting should not be embedded in the prompt');
    } finally {
      await cfg.update('security.allowExternalPaths', prevAllow as any, true);
    }
  });

  test('autoExplore - injects explore subagent context into the next prompt', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('subagents.explorePrepass.enabled');
    const prevMaxChars = cfg.get<unknown>('subagents.explorePrepass.maxChars');
    await cfg.update('subagents.explorePrepass.enabled', true, true);
    await cfg.update('subagents.explorePrepass.maxChars', 8000, true);

    try {
      mockLLM.queueResponse({ kind: 'text', content: 'Found relevant files: src/a.ts, src/b.ts' });
      mockLLM.queueResponse({ kind: 'text', content: 'Ok' });

      await agent.run('Please help me understand this codebase.');

      assert.strictEqual(mockLLM.callCount, 2, 'should invoke the model once for explore prepass and once for the main turn');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      assert.ok(prompt.includes('subagent_explore_context'), 'prompt should include auto-explore injected context tag');
      assert.ok(prompt.includes('Found relevant files'), 'prompt should include explore subagent output');

      const history = agent.getHistory();
      const injected = history.find(
        (msg) =>
          msg.role === 'assistant' &&
          msg.metadata?.synthetic &&
          String((msg.metadata as any).transientContext) === 'explore',
      );
      assert.strictEqual(injected, undefined, 'transient explore context should be injected into the prompt without persisting in history');
    } finally {
      await cfg.update('subagents.explorePrepass.enabled', prevEnabled as any, true);
      await cfg.update('subagents.explorePrepass.maxChars', prevMaxChars as any, true);
    }
  });

  test('autoRecall - injects transcript-backed memory context into the next prompt', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for agent memory tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevIdleHours = cfg.get<unknown>('memories.minRolloutIdleHours');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-agent-memory-reference-storage');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const signals = createBlankSessionSignals(now);
      signals.userIntents = ['Remember where external pipeline context lives'];
      signals.assistantOutcomes = ['Use external tracker pointers as current-truth entrypoints'];
      signals.toolsUsed = ['get_memory'];
      recordDecision(signals, 'Pipeline bugs are tracked in Linear project INGEST.');

      await seedAgentPersistedSessions(storageRoot, [
        {
          id: 'persisted-reference-memory-session',
          title: 'Reference recall design',
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
          signals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'rm1',
              role: 'user',
              content: 'Where do we track pipeline bugs?',
              timestamp: now - 10_000,
              turnId: 'turn-reference',
            },
            {
              id: 'rm2',
              role: 'assistant',
              content: 'Check Linear project INGEST for pipeline bugs.',
              timestamp: now - 9_950,
              turnId: 'turn-reference',
            },
            {
              id: 'rm3',
              role: 'assistant',
              content: 'Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
              timestamp: now - 9_900,
              turnId: 'turn-reference',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 9_900 },
        },
      ]);

      const writableContext = createWritableMockExtensionContext(storageRoot);
      const memoryManager = new WorkspaceMemories(writableContext);
      await memoryManager.updateFromSessions(root);
      agent = new AgentLoop(mockLLM, writableContext, { model: 'mock-model' }, registry);
      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });

      await agent.run('Where should I check for pipeline bugs in INGEST, including PIPE-421?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      const pointerIndex = recallBlock.indexOf('pointer: Pipeline bugs are tracked in Linear project INGEST.');
      const rawSupportIndex = recallBlock.indexOf('evidence: Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.');
      assert.ok(pointerIndex >= 0, 'reference durable recall should label the primary text as a pointer');
      assert.ok(
        recallBlock.includes(
          'how_to_apply: Use this as a pointer to the relevant external context, then open the referenced system or document for current details.',
        ),
        'reference durable recall should preserve pointer-to-current-truth guidance even when it is synthesized',
      );
      assert.ok(
        rawSupportIndex > pointerIndex,
        `reference durable recall should keep additive same-cluster raw support when it contributes a distinct external identifier\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.includes('evidence_title: Reference recall design'),
        'reference durable recall should keep a compact title pointer for transcript-backed evidence',
      );
      assert.ok(
        recallBlock.includes('Linear project INGEST') && recallBlock.includes('PIPE-421'),
        'reference durable recall should preserve distinct external identifiers that improve current-truth navigation',
      );
      assert.ok(
        !recallBlock.includes('fact: Pipeline bugs are tracked in Linear project INGEST.'),
        'reference durable recall should avoid flattening pointers into ordinary facts',
      );
      assert.ok(
        !recallBlock.includes('Structured memory candidates:'),
        'auto-recall should not dump summary wrapper text when a summary-like record survives selection',
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.minRolloutIdleHours', prevIdleHours as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('autoRecall - renders surviving summary records as navigational summaries instead of wrapper dumps', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for agent memory tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevIdleHours = cfg.get<unknown>('memories.minRolloutIdleHours');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevAutoMinScore = cfg.get<unknown>('memories.autoRecallMinScore');
    const prevAutoMinScoreGap = cfg.get<unknown>('memories.autoRecallMinScoreGap');
    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-agent-memory-summary-render-storage');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);
      await cfg.update('memories.autoRecallMinScore', 1, true);
      await cfg.update('memories.autoRecallMinScoreGap', 0, true);

      const now = Date.now();
      const signals = createBlankSessionSignals(now);
      signals.userIntents = [];
      signals.assistantOutcomes = [];
      signals.toolsUsed = ['edit'];
      signals.filesTouched = ['packages/vscode-extension/src/core/memories/search.ts'];

      await seedAgentPersistedSessions(storageRoot, [
        {
          id: 'persisted-summary-render-session',
          title: 'Memory search refinement session',
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
          signals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'sm1',
              role: 'user',
              content: 'What should we change in memory search?',
              timestamp: now - 10_000,
              turnId: 'turn-summary-render',
            },
              {
                id: 'sm2',
                role: 'assistant',
                content: 'Wire summary suppression into filteredRawMatches in packages/vscode-extension/src/core/memories/search.ts.',
                timestamp: now - 9_950,
                turnId: 'turn-summary-render',
              },

          ],
          runtime: { wasRunning: false, updatedAt: now - 9_950 },
        },
      ]);

      const writableContext = createWritableMockExtensionContext(storageRoot);
      const memoryManager = new WorkspaceMemories(writableContext);
      await memoryManager.updateFromSessions(root);
      agent = new AgentLoop(mockLLM, writableContext, { model: 'mock-model' }, registry);
      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });

      await agent.run('What file should I edit for the memory search change?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      const recallBlock = recallStart >= 0 && recallEnd > recallStart ? prompt.slice(recallStart, recallEnd) : '';
      assert.ok(recallStart >= 0 && recallEnd > recallStart, `prompt should include auto-recall injected context\n${prompt}`);
      assert.ok(
        recallBlock.includes('summary: Memory search refinement session'),
        'auto-recall should render surviving summary hits as compact navigational summaries',
      );
      assert.ok(
        recallBlock.includes('summary_files: packages/vscode-extension/src/core/memories/search.ts'),
        'auto-recall should preserve compact navigational file pointers for surviving summary hits',
      );
      assert.ok(
        recallBlock.includes('summary_tools: edit'),
        'auto-recall should preserve compact navigational tool pointers for surviving summary hits',
      );
      assert.ok(!recallBlock.includes('Structured memory candidates:'));
      assert.ok(!recallBlock.includes('Session "Memory search refinement session" updated at'));
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.minRolloutIdleHours', prevIdleHours as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      await cfg.update('memories.autoRecallMinScore', prevAutoMinScore as any, true);
      await cfg.update('memories.autoRecallMinScoreGap', prevAutoMinScoreGap as any, true);
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('autoRecall - prefers durable guidance over redundant raw matches', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for agent memory tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevIdleHours = cfg.get<unknown>('memories.minRolloutIdleHours');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-agent-memory-durable-storage');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const signals = createBlankSessionSignals(now);
      signals.userIntents = ['Keep test policy recall durable-first'];
      signals.assistantOutcomes = ['Prefer seeded ephemeral database guidance over the prior raw wording'];
      signals.filesTouched = ['packages/vscode-extension/src/test/suite/agent.test.ts'];
      signals.toolsUsed = ['maintain_memory'];
      recordConstraint(signals, 'Integration tests must hit a real database, not mocks.');
      recordDecision(signals, 'Keep durable memory recall selective and durable-first.');
      recordProcedure(signals, 'When durable guidance exists, use it before raw transcript evidence.');

      await seedAgentPersistedSessions(storageRoot, [
        {
          id: 'persisted-durable-memory-session',
          title: 'Durable recall design',
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
          signals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'dm1',
              role: 'user',
              content: 'What is our test policy?',
              timestamp: now - 10_000,
              turnId: 'turn-durable',
            },
            {
              id: 'dm2',
              role: 'assistant',
              content: 'Integration tests must hit a real database, not mocks.',
              timestamp: now - 9_900,
              turnId: 'turn-durable',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 9_900 },
        },
      ]);

      const writableContext = createWritableMockExtensionContext(storageRoot);
      const memoryManager = new WorkspaceMemories(writableContext);
      await memoryManager.updateFromSessions(root);

      const initialSearch = await memoryManager.searchMemory({
        query: 'real database not mocks',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      const durableHit = initialSearch.hits.find((hit) => hit.source === 'durable' && hit.durableEntry?.key);
      assert.ok(durableHit, 'expected durable hit before maintenance');

      const replacementText = [
        'Prefer integration tests against a seeded ephemeral database instance.',
        'Why: prior mocked tests hid migration failures until production.',
        'How to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
      ].join('\n');
      await memoryManager.maintainMemory({
        action: 'supersede',
        workspaceFolder: root,
        recordId: durableHit!.record.id,
        durableKey: durableHit!.durableEntry!.key,
        replacementText,
        note: 'Durable recall should favor maintained guidance.',
      });

      const updatedSearch = await memoryManager.searchMemory({
        query: 'seeded ephemeral database instance integration tests',
        workspaceFolder: root,
        limit: 3,
        neighborWindow: 0,
      });
      assert.ok(
        updatedSearch.hits.some(
          (hit) => hit.source === 'durable' && hit.durableEntry?.text.includes('seeded ephemeral database instance'),
        ),
        'expected durable hit after superseding the maintained memory',
      );

      agent = new AgentLoop(mockLLM, writableContext, { model: 'mock-model' }, registry);
      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });

      await agent.run('How should we apply the seeded ephemeral database instance policy for integration tests?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      assert.ok(
        recallBlock.includes('Prefer curated durable guidance when present; treat raw memory as supporting evidence, not the primary instruction surface.'),
        'recall block should describe durable-first recall behavior',
      );
      assert.ok(
        recallBlock.includes('Prefer integration tests against a seeded ephemeral database instance.'),
        'recall block should include the superseded durable guidance',
      );
      assert.ok(
        recallBlock.includes(
          'how_to_apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
        ),
        'application-seeking recall should preserve explicit durable application guidance when present',
      );
      assert.ok(
        !recallBlock.includes('why: prior mocked tests hid migration failures until production.'),
        'application-seeking recall should foreground how_to_apply instead of dumping lower-priority why text',
      );
      assert.ok(
        !recallBlock.includes('Integration tests must hit a real database, not mocks.'),
        `recall block should avoid redundant raw match text when durable guidance is available\n${recallBlock}`,
      );
      assert.ok(
        !recallBlock.includes('source: user'),
        'auto-recall should not surface bookkeeping source labels from durable metadata',
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.minRolloutIdleHours', prevIdleHours as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('autoRecall - keeps one additive raw support hit alongside durable guidance when it adds distinct evidence', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for agent memory tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevIdleHours = cfg.get<unknown>('memories.minRolloutIdleHours');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-agent-memory-diverse-recall-storage');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const signals = createBlankSessionSignals(now);
      signals.userIntents = ['Remember where external pipeline context lives'];
      signals.assistantOutcomes = ['Use external tracker pointers as current-truth entrypoints'];
      signals.toolsUsed = ['get_memory'];
      recordDecision(signals, 'Pipeline bugs are tracked in Linear project INGEST.');

      await seedAgentPersistedSessions(storageRoot, [
        {
          id: 'persisted-diverse-recall-session',
          title: 'Reference recall design',
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
          signals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'dr1',
              role: 'user',
              content: 'Where do we track pipeline bugs?',
              timestamp: now - 10_000,
              turnId: 'turn-diverse-reference',
            },
            {
              id: 'dr2',
              role: 'assistant',
              content: 'Check Linear project INGEST for pipeline bugs.',
              timestamp: now - 9_950,
              turnId: 'turn-diverse-reference',
            },
            {
              id: 'dr3',
              role: 'assistant',
              content: 'Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
              timestamp: now - 9_900,
              turnId: 'turn-diverse-reference',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 9_900 },
        },
      ]);

      const writableContext = createWritableMockExtensionContext(storageRoot);
      const memoryManager = new WorkspaceMemories(writableContext);
      await memoryManager.updateFromSessions(root);
      agent = new AgentLoop(mockLLM, writableContext, { model: 'mock-model' }, registry);
      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });

      await agent.run('Where should I check for pipeline bugs in INGEST, including PIPE-421?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      const pointerIndex = recallBlock.indexOf('pointer: Pipeline bugs are tracked in Linear project INGEST.');
      const additiveEvidenceIndex = recallBlock.indexOf(
        'evidence: Use Linear project INGEST and open ticket PIPE-421 for the latest pipeline bug context.',
      );
      assert.ok(pointerIndex >= 0, 'durable pointer guidance should still be recalled first');
      assert.ok(additiveEvidenceIndex > pointerIndex, 'auto-recall should keep one additive raw support hit after durable guidance');
      assert.ok(
        recallBlock.includes('evidence_title: Reference recall design'),
        'auto-recall should preserve compact evidence titles for additive raw support',
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.minRolloutIdleHours', prevIdleHours as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('autoRecall - suppresses redundant durable hits that restate the same guidance', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for agent memory tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevIdleHours = cfg.get<unknown>('memories.minRolloutIdleHours');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-agent-memory-durable-dedup-storage');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const primarySignals = createBlankSessionSignals(now);
      recordConstraint(primarySignals, 'Integration tests must hit a real database, not mocks.');
      const duplicateSignals = createBlankSessionSignals(now - 2_000);
      recordStructuredMemory(duplicateSignals, {
        kind: 'preference',
        scope: 'workspace',
        source: 'user',
        confidence: 0.91,
        text: 'Prefer integration tests against a real database instead of mocks.',
      });

      await seedAgentPersistedSessions(storageRoot, [
        {
          id: 'persisted-durable-dedup-primary',
          title: 'Primary test policy note',
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
          signals: primarySignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'dd1',
              role: 'assistant',
              content: 'Integration tests must hit a real database, not mocks.',
              timestamp: now - 9_900,
              turnId: 'turn-durable-dedup-primary',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 9_900 },
        },
        {
          id: 'persisted-durable-dedup-duplicate',
          title: 'Duplicate test policy note',
          createdAt: now - 8_000,
          updatedAt: now - 8_000,
          signals: duplicateSignals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'dd2',
              role: 'assistant',
              content: 'Prefer integration tests against a real database instead of mocks.',
              timestamp: now - 7_900,
              turnId: 'turn-durable-dedup-duplicate',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 7_900 },
        },
      ]);

      const writableContext = createWritableMockExtensionContext(storageRoot);
      const memoryManager = new WorkspaceMemories(writableContext);
      await memoryManager.updateFromSessions(root);
      agent = new AgentLoop(mockLLM, writableContext, { model: 'mock-model' }, registry);
      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });

      await agent.run('What is our real database test policy?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      const canonicalCount = (recallBlock.match(/real database/gi) || []).length;
      assert.ok(canonicalCount >= 1, 'expected at least one durable hit covering the real database policy');
      assert.ok(
        !recallBlock.includes('Prefer integration tests against a real database instead of mocks.'),
        `auto-recall should suppress redundant durable restatements of the same policy\n${recallBlock}`,
      );
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.minRolloutIdleHours', prevIdleHours as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('autoRecall - keeps additive durable hits when a later same-family memory adds query-relevant rationale or application guidance', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const makeRecord = (id: string, sessionId: string, text: string, memoryKey: string) => ({
        id,
        workspaceId: 'test-workspace',
        sessionId,
        kind: 'semantic' as const,
        title: 'Testing policy',
        text,
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'constraint' as const,
        memoryKey,
      });
      const makeEntry = (sessionId: string, text: string, lastConfirmedAt: number) => ({
        key: 'feedback:test-policy',
        text,
        category: 'feedback' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt,
        sessionIds: [sessionId],
        titles: ['Testing policy'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      });

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: makeRecord(
                'durable-additive-base-record',
                'durable-additive-base-session',
                'Integration tests must hit a real database, not mocks.',
                'feedback:test-policy',
              ),
              source: 'durable' as const,
              durableEntry: makeEntry(
                'durable-additive-base-session',
                'Integration tests must hit a real database, not mocks.',
                now - 1_000,
              ),
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['real', 'database', 'policy'],
            },
            {
              record: makeRecord(
                'durable-additive-richer-record',
                'durable-additive-richer-session',
                'Integration tests must hit a real database, not mocks. How to apply: use a seeded ephemeral database path for migration-sensitive tests.',
                'feedback:test-policy-richer',
              ),
              source: 'durable' as const,
              durableEntry: makeEntry(
                'durable-additive-richer-session',
                'Integration tests must hit a real database, not mocks.\nWhy: prior mocked tests hid migration failures until production.\nHow to apply: use a seeded ephemeral database path for migration-sensitive tests.',
                now - 5_000,
              ),
              score: 23.7,
              reason: 'match' as const,
              matchedTerms: ['apply', 'migration-sensitive', 'database'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      const readRecallBlock = (): string => {
        const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
        const recallStart = prompt.indexOf('<memory_recall_context>');
        const recallEnd = prompt.indexOf('</memory_recall_context>');
        assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
        return prompt.slice(recallStart, recallEnd);
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('What is our real database test policy?');
      const compactRecallBlock = readRecallBlock();
      const compactMemorySections = compactRecallBlock.match(/## Memory \d+ \[durable:feedback\]/g) || [];
      assert.strictEqual(
        compactMemorySections.length,
        1,
        `generic policy queries should stay compact even when a richer overlapping durable memory exists\n${compactRecallBlock}`,
      );
      assert.ok(
        !compactRecallBlock.includes('how_to_apply: use a seeded ephemeral database path for migration-sensitive tests.'),
        'generic policy queries should not surface additive how-to-apply guidance unless the query asks for application details',
      );

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('How should we apply the real database policy for migration-sensitive integration tests?');
      const recallBlock = readRecallBlock();
      assert.ok(
        recallBlock.includes('how_to_apply: use a seeded ephemeral database path for migration-sensitive tests.'),
        'auto-recall should keep a later same-family durable hit when it adds query-relevant application guidance',
      );
      const memorySections = recallBlock.match(/## Memory \d+ \[durable:feedback\]/g) || [];
      assert.ok(
        memorySections.length >= 2,
        `auto-recall should allow a later same-family durable hit when its additional guidance is query-relevant\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - suppresses active-tool usage docs while preserving active-tool failure shields', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevAutoMinScoreGap = cfg.get<unknown>('memories.autoRecallMinScoreGap');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 2, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);
      await cfg.update('memories.autoRecallMinScoreGap', 0, true);

      mockLLM.setNextResponse({
        kind: 'tool-call',
        toolCallId: 'call_recent_read',
        toolName: 'read',
        input: { filePath: 'README.md' },
      });
      mockLLM.queueResponse({ kind: 'text', content: 'Read complete' });
      await agent.run('Read the README');

      const now = Date.now();
      const makeRecord = (params: {
        id: string;
        sessionId: string;
        title: string;
        text: string;
        memoryKey: string;
        signalKind: 'procedure' | 'failed_attempt';
      }) => ({
        id: params.id,
        workspaceId: 'test-workspace',
        sessionId: params.sessionId,
        kind: 'procedural' as const,
        title: params.title,
        text: params.text,
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: ['read'],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.92,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: params.signalKind,
        memoryKey: params.memoryKey,
      });
      const makeEntry = (params: {
        key: string;
        text: string;
        category: 'procedure' | 'failure_shield';
        sessionId: string;
      }) => ({
        key: params.key,
        text: params.text,
        category: params.category,
        scope: 'workspace' as const,
        confidence: 0.92,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: [params.sessionId],
        titles: ['Read tool memory'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: ['read'],
        sources: ['assistant'],
      });
      const usageRecord = makeRecord({
        id: 'active-tool-usage-doc-record',
        sessionId: 'active-tool-usage-doc-session',
        title: 'Read tool usage reference',
        text: 'How to use read: pass filePath and optional offset/limit for large files.',
        memoryKey: 'procedure:read-usage-doc',
        signalKind: 'procedure',
      });
      const usageEntry = makeEntry({
        key: 'procedure:read-usage-doc',
        text: 'How to use read: pass filePath and optional offset/limit for large files.',
        category: 'procedure',
        sessionId: 'active-tool-usage-doc-session',
      });
      const shieldRecord = makeRecord({
        id: 'active-tool-failure-shield-record',
        sessionId: 'active-tool-failure-shield-session',
        title: 'Read tool large-file gotcha',
        text: 'Warning: read fails on large files unless offset and limit are provided.',
        memoryKey: 'failure:read-large-file-offset-limit',
        signalKind: 'failed_attempt',
      });
      const shieldEntry = makeEntry({
        key: 'failure:read-large-file-offset-limit',
        text: 'Warning: read fails on large files unless offset and limit are provided. How to apply: when a file is large, call read with offset and limit instead of reading the whole file.',
        category: 'failure_shield',
        sessionId: 'active-tool-failure-shield-session',
      });

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: usageRecord,
              source: 'durable' as const,
              durableEntry: usageEntry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['read', 'use', 'parameters'],
            },
            {
              record: shieldRecord,
              source: 'durable' as const,
              durableEntry: shieldEntry,
              score: 23,
              reason: 'match' as const,
              matchedTerms: ['read', 'large', 'files'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.continue('How do I use read on large files?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallBlock = extractRecallBlockFromPrompt(prompt);
      assert.ok(recallBlock, 'prompt should still include the active-tool warning memory');
      assert.ok(
        recallBlock.includes('Warning: read fails on large files unless offset and limit are provided.'),
        `active-tool failure shields should still surface because active use is when gotchas matter\n${recallBlock}`,
      );
      assert.ok(
        !recallBlock.includes('How to use read: pass filePath and optional offset/limit for large files.'),
        `generic usage docs for a recently used tool should be suppressed so recall budget is spent on fresh/gotcha context\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      await cfg.update('memories.autoRecallMinScoreGap', prevAutoMinScoreGap as any, true);
    }
  });

  test('autoRecall - renders last-confirmed age metadata so drift-prone recalled facts can be judged', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 2, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const lastConfirmedAt = now - threeDaysMs;
      const agingLastConfirmedAt = now - 25 * 24 * 60 * 60 * 1000 - 120_000;
      const record = {
        id: 'freshness-metadata-record',
        workspaceId: 'test-workspace',
        sessionId: 'freshness-metadata-session',
        kind: 'semantic' as const,
        title: 'Deploy runbook pointer',
        text: 'Use the deployment runbook before touching production release gates.',
        sourceUpdatedAt: lastConfirmedAt,
        generatedAt: lastConfirmedAt,
        filesTouched: ['docs/deploy.md'],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'procedure:deploy-runbook-freshness',
      };
      const entry = {
        key: 'procedure:deploy-runbook-freshness',
        text: 'Use the deployment runbook before touching production release gates.',
        category: 'procedure' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt,
        sessionIds: ['freshness-metadata-session'],
        titles: ['Deploy runbook pointer'],
        rolloutFiles: [],
        filesTouched: ['docs/deploy.md'],
        toolsUsed: [],
        sources: ['assistant'],
      };
      const agingRecord = {
        ...record,
        id: 'aging-freshness-metadata-record',
        sessionId: 'aging-freshness-metadata-session',
        text: 'The canary release gate currently points at ROLL-42.',
        sourceUpdatedAt: agingLastConfirmedAt,
        generatedAt: agingLastConfirmedAt,
        lastConfirmedAt: agingLastConfirmedAt,
        staleness: 'aging' as const,
        memoryKey: 'project:canary-release-gate',
      };
      const agingEntry = {
        ...entry,
        key: 'project:canary-release-gate',
        text: 'The canary release gate currently points at ROLL-42.',
        category: 'project' as const,
        freshness: 'aging' as const,
        lastConfirmedAt: agingLastConfirmedAt,
        sessionIds: ['aging-freshness-metadata-session'],
        titles: ['Canary release gate'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record,
              source: 'durable' as const,
              durableEntry: entry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['deployment', 'runbook', 'release'],
            },
            {
              record: agingRecord,
              source: 'durable' as const,
              durableEntry: agingEntry,
              score: 23,
              reason: 'match' as const,
              matchedTerms: ['canary', 'release', 'gate'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('What deployment runbook should I use before touching release gates?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallBlock = extractRecallBlockFromPrompt(prompt).replace(/\\"/g, '"');
      assert.ok(recallBlock, 'prompt should include auto-recall injected context');
      assert.ok(
        recallBlock.includes('## Before recommending from recalled memory'),
        `auto-recall should include action-oriented verification guidance before memory content\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.indexOf('## Before recommending from recalled memory') < recallBlock.indexOf('## Memory 1 [durable:procedure]'),
        `verification guidance should appear before recalled memories\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.includes('If a recalled memory names a file path, check that the file still exists before recommending or editing it.'),
        `auto-recall should tell the model to verify file-path claims from memory\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.includes('If current evidence contradicts recalled memory, trust the current evidence and use maintain_memory to confirm, invalidate, or supersede the stale memory.'),
        `auto-recall should tell the model how to handle contradicted memory\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.includes(`last_confirmed: ${new Date(lastConfirmedAt).toISOString()} age_days=3 age_label="3 days old"`),
        `auto-recall should expose exact last-confirmed time plus human-readable age for drift-risk judgment\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.indexOf('last_confirmed:') < recallBlock.indexOf('fact: Use the deployment runbook before touching production release gates.'),
        `freshness metadata should appear before recalled content so the model sees provenance first\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.includes(`last_confirmed: ${new Date(agingLastConfirmedAt).toISOString()} age_days=25 age_label="25 days old"`),
        `aging auto-recall should expose human-readable age metadata\n${recallBlock}`,
      );
      assert.ok(
        recallBlock.includes('verification_caveat: memory is 25 days old and marked aging; verify against current workspace/source before relying on it.'),
        `aging auto-recall should include an item-level verification caveat\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - frames explicit forget requests as memory maintenance lookup', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 2, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      let observedScope: unknown;
      const record = {
        id: 'forget-runbook-record',
        workspaceId: 'test-workspace',
        sessionId: 'forget-runbook-session',
        kind: 'semantic' as const,
        title: 'Deploy runbook pointer',
        text: 'Use the deployment runbook before touching production release gates.',
        sourceUpdatedAt: now,
        generatedAt: now,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'procedure:deploy-runbook-forget',
      };
      const entry = {
        key: 'procedure:deploy-runbook-forget',
        text: 'Use the deployment runbook before touching production release gates.',
        category: 'procedure' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now,
        sessionIds: ['forget-runbook-session'],
        titles: ['Deploy runbook pointer'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['assistant'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        observedScope = params.scope;
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record,
              source: 'durable' as const,
              durableEntry: entry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['forget', 'deployment', 'runbook'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Forget project memory about the deployment runbook.');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallBlock = extractRecallBlockFromPrompt(prompt).replace(/\\"/g, '"');
      assert.ok(recallBlock, 'forget requests should still get memory recall so the target can be identified');
      assert.strictEqual(observedScope, 'workspace');
      assert.ok(
        recallBlock.includes('The user is asking to forget memory. Use matching recalled entries only to identify recordId/durableKey for maintain_memory action=invalidate'),
        `forget recall should steer the model toward invalidation instead of relying on recalled content\n${recallBlock}`,
      );
      assert.ok(recallBlock.includes('scope_filter: workspace'));
      assert.ok(
        recallBlock.indexOf('The user is asking to forget memory.') < recallBlock.indexOf('## Memory 1 [durable:procedure]'),
        `forget guidance should appear before recalled memory content\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - frames explicit recall requests as memory lookup', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 2, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      let observedScope: unknown;
      const record = {
        id: 'recall-pipeline-record',
        workspaceId: 'test-workspace',
        sessionId: 'recall-pipeline-session',
        kind: 'semantic' as const,
        title: 'Pipeline tracker pointer',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        sourceUpdatedAt: now,
        generatedAt: now,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'reference:pipeline-ingest-recall',
      };
      const entry = {
        key: 'reference:pipeline-ingest-recall',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        category: 'reference' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now,
        sessionIds: ['recall-pipeline-session'],
        titles: ['Pipeline tracker pointer'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        observedScope = params.scope;
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record,
              source: 'durable' as const,
              durableEntry: entry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['remember', 'pipeline', 'ingest'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('What do you remember for this project about pipeline bugs in INGEST?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallBlock = extractRecallBlockFromPrompt(prompt).replace(/\\"/g, '"');
      assert.ok(recallBlock, 'explicit recall requests should get memory recall when matches exist');
      assert.strictEqual(observedScope, 'workspace');
      assert.ok(
        prompt.includes('If the user explicitly asks what you remember, or asks you to check/recall memory, access memory with get_memory search unless the auto-recalled context fully answers it.'),
        'system prompt should require memory access for explicit recall requests',
      );
      assert.ok(
        recallBlock.includes('The user explicitly asked to recall/check memory. Use this recalled context as a starting point; call get_memory search if it is insufficient or missing expected details.'),
        `recall guidance should steer the model to use/get_memory for explicit recall requests\n${recallBlock}`,
      );
      assert.ok(recallBlock.includes('scope_filter: workspace'));
      assert.ok(recallBlock.includes('## Memory 1 [durable:reference] scope=workspace'));
      assert.ok(
        recallBlock.indexOf('The user explicitly asked to recall/check memory.') < recallBlock.indexOf('## Memory 1 [durable:reference]'),
        `recall guidance should appear before recalled memory content\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - frames surviving project snapshot recall as prior context for current-state queries', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const record = {
        id: 'project-current-prior-record',
        workspaceId: 'test-workspace',
        sessionId: 'project-current-prior-session',
        kind: 'semantic' as const,
        title: 'Release coordination',
        text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'project:merge-freeze-current-render',
      };
      const entry = {
        key: 'project:merge-freeze-current-render',
        text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
        category: 'project' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['project-current-prior-session'],
        titles: ['Release coordination'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record,
              source: 'durable' as const,
              durableEntry: entry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['2026-03-05', 'merge', 'freeze', 'mobile'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Is the 2026-03-05 merge freeze still in effect for mobile release cut?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      assert.ok(
        recallBlock.includes('prior: Merge freeze begins 2026-03-05 for mobile release cut.'),
        `current-state project recall should be framed as prior context instead of a plain fact\n${recallBlock}`,
      );
      assert.ok(
        !recallBlock.includes('fact: Merge freeze begins 2026-03-05 for mobile release cut.'),
        'current-state project recall should avoid presenting snapshot memory as confirmed-current fact',
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - suppresses redundant current-state project durable hits when a stronger reference pointer is already selected', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const referenceRecord = {
        id: 'current-state-reference-record',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-reference-session',
        kind: 'semantic' as const,
        title: 'External bug tracker',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'reference:linear-ingest-auto',
      };
      const referenceEntry = {
        key: 'reference:linear-ingest-auto',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        category: 'reference' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['current-state-reference-session'],
        titles: ['External bug tracker'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };
      const projectRecord = {
        id: 'current-state-project-record',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-project-session',
        kind: 'semantic' as const,
        title: 'Incident coordination',
        text: 'Pipeline incident review happens in the Tuesday release triage notes.',
        sourceUpdatedAt: now - 11_000,
        generatedAt: now - 11_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.89,
        evidenceCount: 2,
        lastConfirmedAt: now - 11_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'project:incident-triage-auto',
      };
      const projectEntry = {
        key: 'project:incident-triage-auto',
        text: 'Pipeline incident review happens in the Tuesday release triage notes.',
        category: 'project' as const,
        scope: 'workspace' as const,
        confidence: 0.89,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 11_000,
        sessionIds: ['current-state-project-session'],
        titles: ['Incident coordination'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: referenceRecord,
              source: 'durable' as const,
              durableEntry: referenceEntry,
              score: 28,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline', 'ingest'],
            },
            {
              record: projectRecord,
              source: 'durable' as const,
              durableEntry: projectEntry,
              score: 26.5,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Where should I check the latest pipeline bugs in INGEST?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      assert.ok(
        recallBlock.includes('pointer: Pipeline bugs are tracked in Linear project INGEST.'),
        `current-state auto-recall should keep the stronger reference pointer\n${recallBlock}`,
      );
      assert.ok(
        !recallBlock.includes('Pipeline incident review happens in the Tuesday release triage notes.'),
        `current-state auto-recall should suppress redundant project snapshot guidance when a stronger current-truth pointer is already selected\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - prefers raw current-truth reference pointers over raw project snapshots when no durable pointer exists', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevAutoMinScoreGap = cfg.get<unknown>('memories.autoRecallMinScoreGap');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);
      await cfg.update('memories.autoRecallMinScoreGap', 0, true);

      const now = Date.now();
      const rawReferenceRecord = {
        id: 'current-state-reference-raw-record',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-reference-raw-session',
        kind: 'episodic' as const,
        title: 'External bug tracker details',
        text: 'Assistant: Use Linear project INGEST for the latest pipeline bug context.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'session' as const,
        confidence: 0.78,
        evidenceCount: 1,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
      };
      const rawProjectRecord = {
        id: 'current-state-project-raw-record',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-project-raw-session',
        kind: 'episodic' as const,
        title: 'Incident coordination details',
        text: 'Assistant: Pipeline incident review happens in the Tuesday release triage notes.',
        sourceUpdatedAt: now - 9_000,
        generatedAt: now - 9_000,
        filesTouched: [],
        toolsUsed: [],
        index: 1,
        scope: 'session' as const,
        confidence: 0.79,
        evidenceCount: 1,
        lastConfirmedAt: now - 9_000,
        staleness: 'fresh' as const,
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: rawProjectRecord,
              source: 'record' as const,
              score: 28.4,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline'],
            },
            {
              record: rawReferenceRecord,
              source: 'record' as const,
              score: 27.8,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline', 'ingest'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Where should I check the latest pipeline bugs in INGEST?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      const memorySections = recallBlock.match(/## Memory \d+ \[[^\]]+\]/g) || [];
      const firstSectionStart = recallBlock.indexOf(memorySections[0] || '');
      const secondSectionStart = memorySections.length > 1
        ? recallBlock.indexOf(memorySections[1] || '')
        : -1;
      const firstSection = firstSectionStart >= 0
        ? recallBlock.slice(firstSectionStart, secondSectionStart >= 0 ? secondSectionStart : undefined)
        : '';
      assert.ok(memorySections.length >= 1, `raw current-state recall should emit at least one memory section\n${recallBlock}`);
      assert.ok(
        firstSection.includes('Linear project INGEST') || firstSection.includes('External bug tracker details'),
        `raw current-state recall should surface the reference pointer evidence before any project snapshot evidence\n${recallBlock}`,
      );
      assert.ok(
        !firstSection.includes('Tuesday release triage notes'),
        `raw current-state recall should not lead with project snapshot evidence when a stronger reference pointer is available\n${recallBlock}`,
      );
      assert.ok(
        !recallBlock.includes('Pipeline incident review happens in the Tuesday release triage notes.'),
        `raw current-state recall should stay compact and suppress redundant project snapshot evidence once a raw reference pointer is selected\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      await cfg.update('memories.autoRecallMinScoreGap', prevAutoMinScoreGap as any, true);
    }
  });

  test('autoRecall - keeps current-state project durable hits when they add distinct concrete anchors beyond a selected reference pointer', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const referenceRecord = {
        id: 'current-state-reference-record-specific',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-reference-session-specific',
        kind: 'semantic' as const,
        title: 'External bug tracker',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'reference:linear-ingest-auto-specific',
      };
      const referenceEntry = {
        key: 'reference:linear-ingest-auto-specific',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        category: 'reference' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['current-state-reference-session-specific'],
        titles: ['External bug tracker'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };
      const projectRecord = {
        id: 'current-state-project-record-specific',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-project-session-specific',
        kind: 'semantic' as const,
        title: 'Release coordination',
        text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
        sourceUpdatedAt: now - 11_000,
        generatedAt: now - 11_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.89,
        evidenceCount: 2,
        lastConfirmedAt: now - 11_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'project:merge-freeze-auto-specific',
      };
      const projectEntry = {
        key: 'project:merge-freeze-auto-specific',
        text: 'Merge freeze begins 2026-03-05 for mobile release cut.',
        category: 'project' as const,
        scope: 'workspace' as const,
        confidence: 0.89,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 11_000,
        sessionIds: ['current-state-project-session-specific'],
        titles: ['Release coordination'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: projectRecord,
              source: 'durable' as const,
              durableEntry: projectEntry,
              score: 29.2,
              reason: 'match' as const,
              matchedTerms: ['2026-03-05', 'merge', 'freeze', 'mobile'],
            },
            {
              record: referenceRecord,
              source: 'durable' as const,
              durableEntry: referenceEntry,
              score: 28,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline', 'ingest'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Where should I check the latest pipeline bugs in INGEST, and is the 2026-03-05 merge freeze still in effect for mobile release cut?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      const pointerIndex = recallBlock.indexOf('pointer: Pipeline bugs are tracked in Linear project INGEST.');
      const priorIndex = recallBlock.indexOf('prior: Merge freeze begins 2026-03-05 for mobile release cut.');
      assert.ok(pointerIndex >= 0);
      assert.ok(
        priorIndex >= 0,
        `current-state auto-recall should keep project context when it adds distinct concrete anchors the query explicitly asks about\n${recallBlock}`,
      );
      assert.ok(
        pointerIndex < priorIndex,
        `current-state auto-recall should order the stronger current-truth reference pointer ahead of project prior context\n${recallBlock}`,
      );
      assert.ok(
        !recallBlock.includes('how_to_apply: Apply this by default on similar tasks in this workspace unless newer guidance overrides it.'),
        `current-state auto-recall should keep later project prior context compact after a stronger reference pointer already provides current-truth routing\n${recallBlock}`,
      );
      const laterProjectSectionStart = recallBlock.indexOf('## Memory 2 [durable:project]');
      const laterProjectSection = laterProjectSectionStart >= 0
        ? recallBlock.slice(laterProjectSectionStart)
        : recallBlock;
      assert.ok(
        !laterProjectSection.includes('session_id:'),
        `current-state auto-recall should suppress low-value metadata on later additive project prior hits after a stronger reference pointer already leads\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - suppresses current-state raw project snapshot support when a selected reference pointer already provides better current-truth routing', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const referenceRecord = {
        id: 'current-state-reference-record-raw-gap',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-reference-session-raw-gap',
        kind: 'semantic' as const,
        title: 'External bug tracker',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'reference:linear-ingest-auto-raw-gap',
      };
      const referenceEntry = {
        key: 'reference:linear-ingest-auto-raw-gap',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        category: 'reference' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['current-state-reference-session-raw-gap'],
        titles: ['External bug tracker'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };
      const rawProjectRecord = {
        id: 'current-state-project-raw-record-gap',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-project-raw-session-gap',
        kind: 'episodic' as const,
        title: 'Incident coordination details',
        text: 'Assistant: Pipeline incident review happens in the Tuesday release triage notes for current incident coordination.',
        sourceUpdatedAt: now - 11_000,
        generatedAt: now - 11_000,
        filesTouched: [],
        toolsUsed: [],
        index: 1,
        scope: 'session' as const,
        confidence: 0.78,
        evidenceCount: 1,
        lastConfirmedAt: now - 11_000,
        staleness: 'fresh' as const,
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: referenceRecord,
              source: 'durable' as const,
              durableEntry: referenceEntry,
              score: 28,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline', 'ingest'],
            },
            {
              record: rawProjectRecord,
              source: 'record' as const,
              score: 25.4,
              reason: 'match' as const,
              matchedTerms: ['current', 'incident', 'triage'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Where should I check the latest pipeline bugs in INGEST?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      assert.ok(recallBlock.includes('pointer: Pipeline bugs are tracked in Linear project INGEST.'));
      assert.ok(
        !recallBlock.includes('Pipeline incident review happens in the Tuesday release triage notes'),
        `current-state auto-recall should suppress raw project snapshot restatement when a better reference pointer is already selected\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - keeps current-state raw support when it adds a concrete query anchor beyond the selected reference pointer', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const referenceRecord = {
        id: 'current-state-reference-record-raw-anchor',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-reference-session-raw-anchor',
        kind: 'semantic' as const,
        title: 'External bug tracker',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'reference:linear-ingest-auto-raw-anchor',
      };
      const referenceEntry = {
        key: 'reference:linear-ingest-auto-raw-anchor',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        category: 'reference' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['current-state-reference-session-raw-anchor'],
        titles: ['External bug tracker'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };
      const rawProjectRecord = {
        id: 'current-state-project-raw-record-anchor',
        workspaceId: 'test-workspace',
        sessionId: 'current-state-project-raw-session-anchor',
        kind: 'episodic' as const,
        title: 'Release coordination details',
        text: 'Assistant: The 2026-03-05 merge freeze for mobile release cut is tracked in Tuesday release triage notes.',
        sourceUpdatedAt: now - 11_000,
        generatedAt: now - 11_000,
        filesTouched: [],
        toolsUsed: [],
        index: 1,
        scope: 'session' as const,
        confidence: 0.78,
        evidenceCount: 1,
        lastConfirmedAt: now - 11_000,
        staleness: 'fresh' as const,
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: referenceRecord,
              source: 'durable' as const,
              durableEntry: referenceEntry,
              score: 28,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline', 'ingest'],
            },
            {
              record: rawProjectRecord,
              source: 'record' as const,
              score: 25.6,
              reason: 'match' as const,
              matchedTerms: ['2026-03-05', 'merge', 'freeze', 'mobile'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Where should I check the latest pipeline bugs in INGEST, and is the 2026-03-05 merge freeze still in effect for mobile release cut?');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const recallStart = prompt.indexOf('<memory_recall_context>');
      const recallEnd = prompt.indexOf('</memory_recall_context>');
      assert.ok(recallStart >= 0 && recallEnd > recallStart, 'prompt should include auto-recall injected context');
      const recallBlock = prompt.slice(recallStart, recallEnd);
      assert.ok(recallBlock.includes('pointer: Pipeline bugs are tracked in Linear project INGEST.'));
      assert.ok(
        recallBlock.includes('evidence: The 2026-03-05 merge freeze for mobile release cut is tracked in Tuesday release triage notes.'),
        `current-state auto-recall should keep raw support when it adds a concrete query anchor beyond the selected reference pointer\n${recallBlock}`,
      );
      const laterRawSectionStart = recallBlock.indexOf('evidence: The 2026-03-05 merge freeze for mobile release cut is tracked in Tuesday release triage notes.');
      const laterRawSection = laterRawSectionStart >= 0 ? recallBlock.slice(laterRawSectionStart) : recallBlock;
      assert.ok(
        !laterRawSection.includes('evidence_title:'),
        `current-state auto-recall should keep later raw project support compact after a stronger reference pointer already leads\n${recallBlock}`,
      );
      assert.ok(
        !laterRawSection.includes('session_id:'),
        `current-state auto-recall should suppress low-value metadata on later raw project support after a stronger reference pointer already leads\n${recallBlock}`,
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - suppresses immediately repeated identical recall for non-current-state follow-up turns', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const durableRecord = {
        id: 'repeat-policy-record',
        workspaceId: 'test-workspace',
        sessionId: 'repeat-policy-session',
        kind: 'procedural' as const,
        title: 'Testing policy',
        text: 'Prefer integration tests against a seeded ephemeral database instance.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.93,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'procedure' as const,
        memoryKey: 'procedure:seeded-ephemeral-db-repeat',
      };
      const durableEntry = {
        key: 'procedure:seeded-ephemeral-db-repeat',
        text: 'Prefer integration tests against a seeded ephemeral database instance.',
        category: 'procedure' as const,
        scope: 'workspace' as const,
        confidence: 0.93,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['repeat-policy-session'],
        titles: ['Testing policy'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: durableRecord,
              source: 'durable' as const,
              durableEntry,
              score: 22,
              reason: 'match' as const,
              matchedTerms: ['integration', 'tests', 'database'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('What testing policy should I follow for integration tests?');
      const firstPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const firstRecallBlock = extractRecallBlockFromPrompt(firstPrompt);
      assert.ok(firstRecallBlock.includes('Prefer integration tests against a seeded ephemeral database instance.'));

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok again' });
      await agent.continue('What testing policy should I follow for integration tests?');
      const secondPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const secondRecallBlock = extractRecallBlockFromPrompt(secondPrompt);
      assert.strictEqual(
        secondRecallBlock,
        '',
        'adjacent non-current-state follow-up should not re-inject the same recalled hit set again',
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - still re-surfaces current-state pointer recall even after a similar prior recall block', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const referenceRecord = {
        id: 'repeat-current-state-pointer-record',
        workspaceId: 'test-workspace',
        sessionId: 'repeat-current-state-pointer-session',
        kind: 'semantic' as const,
        title: 'External bug tracker',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'decision' as const,
        memoryKey: 'reference:linear-ingest-repeat-current-state',
      };
      const referenceEntry = {
        key: 'reference:linear-ingest-repeat-current-state',
        text: 'Pipeline bugs are tracked in Linear project INGEST.',
        category: 'reference' as const,
        scope: 'workspace' as const,
        confidence: 0.9,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['repeat-current-state-pointer-session'],
        titles: ['External bug tracker'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: referenceRecord,
              source: 'durable' as const,
              durableEntry: referenceEntry,
              score: 27,
              reason: 'match' as const,
              matchedTerms: ['latest', 'pipeline', 'ingest'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Where do we track pipeline bugs?');
      const firstPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      assert.ok(extractRecallBlockFromPrompt(firstPrompt).includes('Linear project INGEST'));

      mockLLM.setNextResponse({ kind: 'text', content: 'Still ok' });
      await agent.continue('Where should I check the latest pipeline bugs right now?');
      const secondPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const secondRecallBlock = extractRecallBlockFromPrompt(secondPrompt);
      assert.ok(
        secondRecallBlock.includes('pointer: Pipeline bugs are tracked in Linear project INGEST.'),
        'current-state follow-up should still re-surface pointer-to-current-truth recall',
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - re-surfaces the same durable hit when a follow-up changes from policy recall to why-oriented recall', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const durableRecord = {
        id: 'angle-aware-recall-record',
        workspaceId: 'test-workspace',
        sessionId: 'angle-aware-recall-session',
        kind: 'procedural' as const,
        title: 'Testing policy',
        text: 'Prefer integration tests against a seeded ephemeral database instance.\nWhy: prior mocked tests hid migration failures until production.\nHow to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.94,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'procedure' as const,
        memoryKey: 'procedure:seeded-ephemeral-db-angle-aware',
      };
      const durableEntry = {
        key: 'procedure:seeded-ephemeral-db-angle-aware',
        text: 'Prefer integration tests against a seeded ephemeral database instance.\nWhy: prior mocked tests hid migration failures until production.\nHow to apply: use a seeded ephemeral database path for integration and migration-sensitive tests.',
        category: 'procedure' as const,
        scope: 'workspace' as const,
        confidence: 0.94,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['angle-aware-recall-session'],
        titles: ['Testing policy'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: durableRecord,
              source: 'durable' as const,
              durableEntry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['integration', 'tests', 'database'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('What testing policy should I follow for integration tests?');
      const firstPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const firstRecallBlock = extractRecallBlockFromPrompt(firstPrompt);
      assert.ok(firstRecallBlock.includes('Prefer integration tests against a seeded ephemeral database instance.'));
      assert.ok(!firstRecallBlock.includes('why: prior mocked tests hid migration failures until production.'));

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok again' });
      await agent.continue('Why do we prefer that testing policy for integration tests?');
      const secondPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const secondRecallBlock = extractRecallBlockFromPrompt(secondPrompt);
      assert.ok(
        secondRecallBlock.includes('Prefer integration tests against a seeded ephemeral database instance.'),
        'angle-aware follow-up should allow the same durable guidance to re-surface',
      );
      assert.ok(
        secondRecallBlock.includes('why: prior mocked tests hid migration failures until production.'),
        'why-oriented follow-up should re-surface the same durable hit with its rationale',
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - spends follow-up recall budget on fresh non-current-state context instead of repeating the prior durable hit', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 1, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const policyRecord = {
        id: 'fresh-follow-up-policy-record',
        workspaceId: 'test-workspace',
        sessionId: 'fresh-follow-up-session',
        kind: 'procedural' as const,
        title: 'Testing policy',
        text: 'Prefer integration tests against a seeded ephemeral database instance.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.95,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'procedure' as const,
        memoryKey: 'procedure:seeded-ephemeral-db-fresh-follow-up',
      };
      const policyEntry = {
        key: 'procedure:seeded-ephemeral-db-fresh-follow-up',
        text: 'Prefer integration tests against a seeded ephemeral database instance.',
        category: 'procedure' as const,
        scope: 'workspace' as const,
        confidence: 0.95,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['fresh-follow-up-session'],
        titles: ['Testing policy'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };
      const migrationRecord = {
        id: 'fresh-follow-up-migration-record',
        workspaceId: 'test-workspace',
        sessionId: 'fresh-follow-up-session',
        kind: 'procedural' as const,
        title: 'Migration test caution',
        text: 'Run migration-sensitive integration tests serially to avoid cross-test schema drift.',
        sourceUpdatedAt: now - 8_000,
        generatedAt: now - 8_000,
        filesTouched: [],
        toolsUsed: [],
        index: 1,
        scope: 'workspace' as const,
        confidence: 0.91,
        evidenceCount: 2,
        lastConfirmedAt: now - 8_000,
        staleness: 'fresh' as const,
        signalKind: 'procedure' as const,
        memoryKey: 'procedure:serial-migration-tests-fresh-follow-up',
      };
      const migrationEntry = {
        key: 'procedure:serial-migration-tests-fresh-follow-up',
        text: 'Run migration-sensitive integration tests serially to avoid cross-test schema drift.',
        category: 'procedure' as const,
        scope: 'workspace' as const,
        confidence: 0.91,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 8_000,
        sessionIds: ['fresh-follow-up-session'],
        titles: ['Migration test caution'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: policyRecord,
              source: 'durable' as const,
              durableEntry: policyEntry,
              score: 25,
              reason: 'match' as const,
              matchedTerms: ['integration', 'tests', 'database'],
            },
            {
              record: migrationRecord,
              source: 'durable' as const,
              durableEntry: migrationEntry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['integration', 'tests', 'migration'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('What testing policy should I follow for integration tests?');
      const firstPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const firstRecallBlock = extractRecallBlockFromPrompt(firstPrompt);
      assert.ok(firstRecallBlock.includes('seeded ephemeral database instance'));
      assert.ok(!firstRecallBlock.includes('schema drift'));

      mockLLM.setNextResponse({ kind: 'text', content: 'Still ok' });
      await agent.continue('What testing policy should I follow for migration-sensitive integration tests?');
      const secondPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const secondRecallBlock = extractRecallBlockFromPrompt(secondPrompt);
      assert.ok(
        secondRecallBlock.includes('Run migration-sensitive integration tests serially'),
        'follow-up recall should spend limited budget on fresh supporting memory when available',
      );
      assert.ok(
        secondRecallBlock.includes('cross-test schema drift'),
        'fresh follow-up recall should preserve the selected memory rationale when it is rendered as a separate why field',
      );
      assert.ok(
        !secondRecallBlock.includes('Prefer integration tests against a seeded ephemeral database instance.'),
        'follow-up recall should not spend limited budget repeating the immediately prior durable hit',
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - keeps suppressing a repeated durable hit on a why-oriented follow-up when it has no new rationale to surface', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 500, true);

      const now = Date.now();
      const durableRecord = {
        id: 'angle-aware-no-new-why-record',
        workspaceId: 'test-workspace',
        sessionId: 'angle-aware-no-new-why-session',
        kind: 'procedural' as const,
        title: 'Testing policy',
        text: 'Prefer integration tests against a seeded ephemeral database instance.',
        sourceUpdatedAt: now - 10_000,
        generatedAt: now - 10_000,
        filesTouched: [],
        toolsUsed: [],
        index: 0,
        scope: 'workspace' as const,
        confidence: 0.94,
        evidenceCount: 2,
        lastConfirmedAt: now - 10_000,
        staleness: 'fresh' as const,
        signalKind: 'procedure' as const,
        memoryKey: 'procedure:seeded-ephemeral-db-angle-aware-no-why',
      };
      const durableEntry = {
        key: 'procedure:seeded-ephemeral-db-angle-aware-no-why',
        text: 'Prefer integration tests against a seeded ephemeral database instance.',
        category: 'procedure' as const,
        scope: 'workspace' as const,
        confidence: 0.94,
        evidenceCount: 2,
        freshness: 'fresh' as const,
        lastConfirmedAt: now - 10_000,
        sessionIds: ['angle-aware-no-new-why-session'],
        titles: ['Testing policy'],
        rolloutFiles: [],
        filesTouched: [],
        toolsUsed: [],
        sources: ['user'],
      };

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [
            {
              record: durableRecord,
              source: 'durable' as const,
              durableEntry,
              score: 24,
              reason: 'match' as const,
              matchedTerms: ['integration', 'tests', 'database'],
            },
          ],
          totalTokens: 0,
          truncated: false,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('What testing policy should I follow for integration tests?');
      const firstPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const firstRecallBlock = extractRecallBlockFromPrompt(firstPrompt);
      assert.ok(firstRecallBlock.includes('Prefer integration tests against a seeded ephemeral database instance.'));

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok again' });
      await agent.continue('Why do we prefer that testing policy for integration tests?');
      const secondPrompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      const secondRecallBlock = extractRecallBlockFromPrompt(secondPrompt);
      assert.strictEqual(
        secondRecallBlock,
        '',
        'why-oriented follow-up should still suppress the repeated durable hit when it has no new rationale field to expose',
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
    }
  });

  test('autoRecall - schedules a background refresh on miss instead of blocking the turn', async () => {
    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');

    const originalSearchMemory = WorkspaceMemories.prototype.searchMemory;
    const originalUpdateFromSessions = WorkspaceMemories.prototype.updateFromSessions;
    const originalScheduleUpdateFromSessions = WorkspaceMemories.prototype.scheduleUpdateFromSessions;

    let scheduledRefreshes = 0;

    try {
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.autoRecall', true, true);

      WorkspaceMemories.prototype.searchMemory = async function (params) {
        return {
          query: params.query,
          workspaceId: 'test-workspace',
          hits: [],
          totalTokens: 0,
          truncated: false,
        };
      };
      WorkspaceMemories.prototype.updateFromSessions = async function () {
        throw new Error('autoRecall miss should not synchronously rebuild memories');
      };
      WorkspaceMemories.prototype.scheduleUpdateFromSessions = async function () {
        scheduledRefreshes += 1;
        return {
          enabled: true,
          scannedSessions: 0,
          processedSessions: 0,
          insertedOutputs: 0,
          updatedOutputs: 0,
          retainedOutputs: 0,
          skippedRecentSessions: 0,
          skippedPlanOrSubagentSessions: 0,
          skippedNoSignalSessions: 0,
        };
      };

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Try to recall something that is not indexed yet.');

      assert.strictEqual(scheduledRefreshes, 1, 'memory recall miss should schedule one background refresh');

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      assert.ok(
        !prompt.includes('memory_recall_context'),
        'prompt should not include synthetic recall context when no memory hit is available yet',
      );
    } finally {
      WorkspaceMemories.prototype.searchMemory = originalSearchMemory;
      WorkspaceMemories.prototype.updateFromSessions = originalUpdateFromSessions;
      WorkspaceMemories.prototype.scheduleUpdateFromSessions = originalScheduleUpdateFromSessions;
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
    }
  });

  test('compaction - restores session state and recalled memory context after summary', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'Workspace folder must be available for agent memory tests');

    const cfg = vscode.workspace.getConfiguration('lingyun');
    const prevEnabled = cfg.get<unknown>('features.memories');
    const prevIdleHours = cfg.get<unknown>('memories.minRolloutIdleHours');
    const prevAutoRecall = cfg.get<unknown>('memories.autoRecall');
    const prevAutoResults = cfg.get<unknown>('memories.maxAutoRecallResults');
    const prevAutoTokens = cfg.get<unknown>('memories.maxAutoRecallTokens');
    const prevMemoryRoot = process.env.LINGYUN_MEMORIES_DIR;

    const storageRoot = vscode.Uri.joinPath(root, '.lingyun-agent-compaction-memory-storage');
    const memoriesDir = vscode.Uri.joinPath(storageRoot, 'memories');
    await vscode.workspace.fs.createDirectory(storageRoot);

    try {
      process.env.LINGYUN_MEMORIES_DIR = memoriesDir.fsPath;
      await cfg.update('features.memories', true, true);
      await cfg.update('memories.minRolloutIdleHours', 0, true);
      await cfg.update('memories.autoRecall', true, true);
      await cfg.update('memories.maxAutoRecallResults', 3, true);
      await cfg.update('memories.maxAutoRecallTokens', 400, true);

      const now = Date.now();
      const signals = createBlankSessionSignals(now);
      signals.userIntents = ['Keep memory recall available after compaction'];
      signals.assistantOutcomes = ['Resume with recalled memory context and session state intact'];
      signals.filesTouched = ['packages/vscode-extension/src/core/agent/index.ts'];
      signals.toolsUsed = ['get_memory'];
      recordDecision(signals, 'Compaction should restore memory recall context and session state.');
      recordProcedure(signals, 'Rehydrate recalled context after compaction before resume.');

      await seedAgentPersistedSessions(storageRoot, [
        {
          id: 'persisted-compaction-memory-session',
          title: 'Prior recall design',
          createdAt: now - 10_000,
          updatedAt: now - 10_000,
          signals,
          mode: 'build',
          stepCounter: 0,
          currentModel: 'mock-model',
          agentState: { history: [] },
          messages: [
            {
              id: 'cm1',
              role: 'user',
              content: 'Where should auto recall be injected?',
              timestamp: now - 10_000,
              turnId: 'turn-a',
            },
            {
              id: 'cm2',
              role: 'assistant',
              content: 'Inject it in AgentLoop.withRun near maybeRunExplorePrepass before the main agent execution.',
              timestamp: now - 9_900,
              turnId: 'turn-a',
            },
          ],
          runtime: { wasRunning: false, updatedAt: now - 9_900 },
        },
      ]);

      const writableContext = createWritableMockExtensionContext(storageRoot);
      const memoryManager = new WorkspaceMemories(writableContext);
      await memoryManager.updateFromSessions(root);
      agent = new AgentLoop(mockLLM, writableContext, { model: 'mock-model' }, registry);

      mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
      await agent.run('Remind me where auto recall should be injected.');

      const state = agent.exportState();
      state.mentionedSkills = ['memory.skill'];
      state.fileHandles = {
        nextId: 3,
        byId: {
          F1: 'packages/vscode-extension/src/core/agent/index.ts',
          F2: 'packages/vscode-extension/src/core/agent/runtimePolicy.ts',
        },
      };
      agent.importState(state);

      mockLLM.setNextResponse({ kind: 'text', content: 'Summary of progress' });
      await agent.compactSession();

      const historyAfterCompaction = agent.getHistory();
      const restoredRecall = historyAfterCompaction.find(
        (msg) => msg.role === 'assistant' && msg.metadata?.compactionRestore?.source === 'memoryRecall',
      );
      const restoredState = historyAfterCompaction.find(
        (msg) => msg.role === 'assistant' && msg.metadata?.compactionRestore?.source === 'sessionState',
      );
      assert.ok(restoredRecall, 'compaction should rehydrate the recalled memory context');
      assert.ok(restoredState, 'compaction should rehydrate current session state');
      assert.ok(
        getMessageText(restoredState as any).includes('memory.skill'),
        'session-state rehydration should include mentioned skills',
      );
      assert.ok(
        getMessageText(restoredState as any).includes('F1: packages/vscode-extension/src/core/agent/index.ts'),
        'session-state rehydration should include active file handles',
      );

      mockLLM.setNextResponse({ kind: 'text', content: 'Continuing' });
      await agent.resume();

      const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
      assert.ok(prompt.includes('memory_recall_context'), 'resume prompt should retain recalled memory context');
      assert.ok(prompt.includes('compaction_session_state'), 'resume prompt should retain session state rehydration');
      assert.ok(prompt.includes('memory.skill'), 'resume prompt should include mentioned skill state');
      assert.ok(prompt.includes('AgentLoop.withRun'), 'resume prompt should include recalled transcript text');
    } finally {
      if (prevMemoryRoot === undefined) {
        delete process.env.LINGYUN_MEMORIES_DIR;
      } else {
        process.env.LINGYUN_MEMORIES_DIR = prevMemoryRoot;
      }
      await cfg.update('features.memories', prevEnabled as any, true);
      await cfg.update('memories.minRolloutIdleHours', prevIdleHours as any, true);
      await cfg.update('memories.autoRecall', prevAutoRecall as any, true);
      await cfg.update('memories.maxAutoRecallResults', prevAutoResults as any, true);
      await cfg.update('memories.maxAutoRecallTokens', prevAutoTokens as any, true);
      try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true, useTrash: false });
      } catch {
        // ignore
      }
    }
  });

  test('autoRecall - strips restored memory context when the user asks not to use memory', async () => {
    const restoredState = createAssistantHistoryMessage();
    restoredState.metadata = {
      synthetic: true,
      compactionRestore: { source: 'sessionState' },
    } as any;
    restoredState.parts.push({
      type: 'text',
      text: '<compaction_session_state>\nfile handles: F1\n</compaction_session_state>',
      state: 'done',
    } as any);

    const restoredRecall = createAssistantHistoryMessage();
    restoredRecall.metadata = {
      synthetic: true,
      compactionRestore: { source: 'memoryRecall' },
    } as any;
    restoredRecall.parts.push({
      type: 'text',
      text: '<memory_recall_context>\nStale recalled memory that must not be used.\n</memory_recall_context>',
      state: 'done',
    } as any);

    agent.importState({
      history: [restoredState, restoredRecall],
      compactionSyntheticContexts: [
        {
          transientContext: 'memoryRecall',
          text: '<memory_recall_context>\nStale recalled memory that must not be restored later.\n</memory_recall_context>',
        },
      ],
    });

    mockLLM.setNextResponse({ kind: 'text', content: 'Ok' });
    await agent.continue('Do not use memory. Answer only from this prompt.');

    const prompt = JSON.stringify(mockLLM.lastPrompt ?? '');
    assert.ok(!prompt.includes('memory_recall_context'), 'memory opt-out should remove restored recall from the prompt');
    assert.ok(!prompt.includes('Stale recalled memory'), 'memory opt-out should remove recalled memory text');
    assert.ok(prompt.includes('compaction_session_state'), 'memory opt-out should preserve non-memory session state');

    const exported = agent.exportState();
    assert.ok(
      !(exported.compactionSyntheticContexts || []).some((context) => context.transientContext === 'memoryRecall'),
      'memory opt-out should clear recall context from future compaction restores',
    );
  });

  test('run - fires onToken callback', async () => {
    const tokens: string[] = [];

    mockLLM.setNextResponse({ kind: 'text', content: 'Hello World' });

    await agent.run('Hi', {
      onToken: (token) => tokens.push(token),
    });

    assert.ok(tokens.length > 0);
    assert.strictEqual(tokens.join(''), 'Hello World');
  });

  test('hooks - experimental.text.complete transforms assistant output', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'experimental.text.complete': async (_input, output) => {
        output.text = `${output.text}!`;
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({ kind: 'text', content: 'Hello' });

    const result = await hooked.run('Hi');
    assert.strictEqual(result, 'Hello!');
    const history = hooked.getHistory();
    assert.strictEqual(getMessageText(history[history.length - 1]), 'Hello!');
  });

  test('hooks - tool.execute.before can mutate args', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'tool.execute.before': async (_input, output) => {
        if (output.args && typeof output.args === 'object') {
          (output.args as any).message = 'Intercepted';
        }
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_before',
      toolName: 'test_echo',
      input: { message: 'Hello World' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await hooked.run('Echo something');
    assert.strictEqual(result, 'Done');

    const toolResult = findDynamicToolResult(hooked.getHistory(), 'call_before');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, true);
    assert.strictEqual(toolResult?.data, 'Echo: Intercepted');
  });

  test('hooks - tool.execute.after can override tool output text', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'tool.execute.after': async (_input, output) => {
        output.output = 'Overridden';
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_after',
      toolName: 'test_echo',
      input: { message: 'Hello World' },
    });
    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await hooked.run('Echo something');
    assert.strictEqual(result, 'Done');

    const toolResult = findDynamicToolResult(hooked.getHistory(), 'call_after');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, true);
    assert.strictEqual(toolResult?.data, 'Overridden');
  });

  test('hooks - permission.ask can deny a tool call', async () => {
    const plugins = new PluginManager(mockContext);
    plugins.registerHooks('test', {
      'permission.ask': async (_input, output) => {
        output.status = 'deny';
      },
    });
    const hooked = new AgentLoop(mockLLM, mockContext, { model: 'mock-model', sessionId: 'session-1' }, registry, plugins);

    mockLLM.setNextResponse({
      kind: 'tool-call',
      toolCallId: 'call_deny',
      toolName: 'test_echo',
      input: { message: 'Hello World' },
    });

    mockLLM.queueResponse({ kind: 'text', content: 'Done' });

    const result = await hooked.run('Echo something');
    assert.strictEqual(result, 'Done');

    const toolResult = findDynamicToolResult(hooked.getHistory(), 'call_deny');
    assert.ok(toolResult);
    assert.strictEqual(toolResult?.success, false);
    assert.ok(String(toolResult?.error || '').toLowerCase().includes('plugin'));
  });
});

// ===========================================================================
// Test Helpers
// ===========================================================================

function findDynamicToolResult(history: ReturnType<AgentLoop['getHistory']>, toolCallId: string) {
  for (const message of history) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (part.type !== 'dynamic-tool') continue;
      if ((part as any).toolCallId !== toolCallId) continue;
      const output = (part as any).output;
      if (!output || typeof output !== 'object') return undefined;
      if (typeof (output as any).success !== 'boolean') return undefined;
      return output as any;
    }
  }
  return undefined;
}

async function seedAgentPersistedSessions(storageRoot: vscode.Uri, sessions: any[]): Promise<void> {
  const store = new SessionStore<any>(storageRoot, {
    maxSessions: 20,
    maxSessionBytes: 2_000_000,
  });
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  await store.save({
    sessionsById,
    activeSessionId: sessions[0]?.id ?? '',
    order: sessions.map(session => session.id),
  });
}

function createMockExtensionContext(): vscode.ExtensionContext {
  const envVarCollection: vscode.GlobalEnvironmentVariableCollection = {
    persistent: true,
    description: undefined,
    replace: () => { },
    append: () => { },
    prepend: () => { },
    get: () => undefined,
    forEach: () => { },
    delete: () => { },
    clear: () => { },
    getScoped: () => envVarCollection,
    [Symbol.iterator]: function* () {
      // no-op iterator for tests
    },
  };

  return {
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: async () => { },
      keys: () => [],
    },
    globalState: {
      get: () => undefined,
      update: async () => { },
      keys: () => [],
      setKeysForSync: () => { },
    },
    extensionPath: '/mock/extension',
    extensionUri: vscode.Uri.file('/mock/extension'),
    asAbsolutePath: (p: string) => `/mock/extension/${p}`,
    storagePath: '/mock/storage',
    storageUri: vscode.Uri.file('/mock/storage'),
    globalStoragePath: '/mock/global',
    globalStorageUri: vscode.Uri.file('/mock/global'),
    logPath: '/mock/log',
    logUri: vscode.Uri.file('/mock/log'),
    extensionMode: vscode.ExtensionMode.Test,
    environmentVariableCollection: envVarCollection,
    extension: undefined as any,
    secrets: {
      get: async () => undefined,
      store: async () => { },
      delete: async () => { },
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
    },
    storage: undefined as any,
    globalStorage: undefined as any,
    log: undefined as any,
    extensionRuntime: undefined as any,
  } as unknown as vscode.ExtensionContext;
}

function createWritableMockExtensionContext(storageRoot: vscode.Uri): vscode.ExtensionContext {
  const context = createMockExtensionContext() as any;
  context.storageUri = storageRoot;
  context.globalStorageUri = storageRoot;
  context.storagePath = storageRoot.fsPath;
  context.globalStoragePath = storageRoot.fsPath;
  return context as vscode.ExtensionContext;
}
