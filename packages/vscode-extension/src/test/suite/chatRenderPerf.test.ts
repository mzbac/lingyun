import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Chat Render Perf Guards', () => {
  test('chat queue attachment byte estimates scan without reduce callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/queueManager.ts'), 'utf8');
    const start = source.indexOf('function estimateAttachmentBytes');
    assert.ok(start >= 0, 'expected attachment byte estimator');
    const end = source.indexOf('export class ChatQueueManager', start);
    assert.ok(end > start, 'expected queue manager class after attachment byte estimator');
    const section = source.slice(start, end);

    assert.match(section, /let total = 0;/);
    assert.match(section, /for \(let index = 0; index < attachments\.length; index\+\+\)/);
    assert.match(section, /const attachment = attachments\[index\];/);
    assert.match(section, /if \(!attachment\) continue;/);
    assert.match(section, /total \+= dataUrl \+ mediaType \+ filename;/);
    assert.doesNotMatch(section, /\.reduce\(/);
  });

  test('chat queue attachment budget prunes in a single compacting pass', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/queueManager.ts'), 'utf8');
    const start = source.indexOf('private enforceAttachmentBudget');
    assert.ok(start >= 0, 'expected attachment budget helper');
    const end = source.indexOf('private armAutosendTimer', start);
    assert.ok(end > start, 'expected autosend timer helper after attachment budget helper');
    const section = source.slice(start, end);

    assert.match(section, /let writeIndex = 0;/);
    assert.match(section, /for \(let readIndex = 0; readIndex < queue\.length; readIndex\+\+\)/);
    assert.match(section, /queue\[writeIndex\+\+\] = item;/);
    assert.match(section, /queue\.length = writeIndex;/);
    assert.match(section, /postAttachmentBudgetWarning\(removed, \{ persist: false \}\)/);
    assert.doesNotMatch(section, /\.findIndex\(/);
    assert.doesNotMatch(section, /\.splice\(/);
  });

  test('chat queue max length pruning avoids repeated shifts', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/queueManager.ts'), 'utf8');
    const start = source.indexOf('enqueueActiveInput');
    assert.ok(start >= 0, 'expected enqueue helper');
    const end = source.indexOf('clearActiveSession', start);
    assert.ok(end > start, 'expected clear helper after enqueue helper');
    const section = source.slice(start, end);

    assert.match(section, /const removeCount = queue\.length - MAX_QUEUED_INPUTS;/);
    assert.match(section, /for \(let index = 0; index < removeCount; index\+\+\)/);
    assert.match(section, /const removed = queue\[index\];/);
    assert.match(section, /queue\.splice\(0, removeCount\);/);
    assert.doesNotMatch(section, /while \(queue\.length > MAX_QUEUED_INPUTS\)/);
    assert.doesNotMatch(section, /queue\.shift\(\)/);
  });

  test('chat queue clear skips already-empty queue commits', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/queueManager.ts'), 'utf8');
    const start = source.indexOf('clearSession(session');
    assert.ok(start >= 0, 'expected clearSession helper');
    const end = source.indexOf('releaseSession', start);
    assert.ok(end > start, 'expected releaseSession after clearSession');
    const section = source.slice(start, end);

    assert.match(section, /const hadQueueArray = Array\.isArray\(session\.queuedInputs\);/);
    assert.match(section, /if \(hadQueueArray && queue\.length === 0\) return;/);
    assert.ok(
      section.indexOf('if (hadQueueArray && queue.length === 0) return;') <
        section.indexOf('this.commitActiveSession(session, options);'),
      'expected empty-queue no-op guard before commit'
    );
  });

  test('chat queue targeted dequeue scans without findIndex callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/queueManager.ts'), 'utf8');
    const start = source.indexOf('takeByIdFromActiveSession');
    assert.ok(start >= 0, 'expected targeted queue lookup helper');
    const end = source.indexOf('takeNextRunnableFromActiveSession', start);
    assert.ok(end > start, 'expected next-runnable helper after targeted queue lookup');
    const section = source.slice(start, end);

    assert.match(section, /for \(let index = 0; index < queue\.length; index\+\+\)/);
    assert.match(section, /const item = queue\[index\];/);
    assert.match(section, /if \(item\?\.id === id\) \{/);
    assert.match(section, /input: this\.takeAtIndex\(session, index\)/);
    assert.match(section, /queueChanged: true/);
    assert.doesNotMatch(section, /\.findIndex\(/);
  });

  test('chat queue next runnable batches invalid prefix cleanup', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/queueManager.ts'), 'utf8');
    const start = source.indexOf('private takeNextRunnable');
    assert.ok(start >= 0, 'expected next-runnable helper');
    const end = source.indexOf('private takeAtIndex', start);
    assert.ok(end > start, 'expected targeted dequeue helper after next-runnable helper');
    const section = source.slice(start, end);

    assert.match(section, /let removeCount = 0;/);
    assert.match(section, /let unavailableAttachmentCount = 0;/);
    assert.match(section, /for \(let index = 0; index < queue\.length; index\+\+\)/);
    assert.match(section, /queue\.splice\(0, removeCount\);/);
    assert.match(section, /postUnavailableAttachmentWarning\(unavailableAttachmentCount, \{ persist: false \}\)/);
    assert.match(section, /postUnavailableAttachmentWarning\(unavailableAttachmentCount[\s\S]*this\.commitActiveSession\(session\);/);
    assert.doesNotMatch(section, /while \(this\.getQueuedInputs\(session\)\.length > 0\)/);
    assert.doesNotMatch(section, /this\.takeAtIndex\(session, 0\)/);
  });

  test('core history message factories avoid metadata key-array checks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/history.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const userFactorySection = section('export function createUserHistoryMessage', 'export function createSystemHistoryMessage');
    const systemFactorySection = section('export function createSystemHistoryMessage', 'export function isSkillInjectedMessage');

    assert.match(userFactorySection, /let hasMetadata = false;/);
    assert.match(userFactorySection, /hasMetadata = true;/);
    assert.match(userFactorySection, /\.\.\.\(hasMetadata \? \{ metadata \} : \{\}\)/);
    assert.doesNotMatch(userFactorySection, /Object\.keys/);

    assert.match(systemFactorySection, /let hasMetadata = false;/);
    assert.match(systemFactorySection, /hasMetadata = true;/);
    assert.match(systemFactorySection, /\.\.\.\(hasMetadata \? \{ metadata \} : \{\}\)/);
    assert.doesNotMatch(systemFactorySection, /Object\.keys/);
  });

  test('agent sync session guards avoid key-array checks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/agent/index.ts'), 'utf8');
    const helperStart = source.indexOf('function hasOwnEnumerableProperty');
    assert.ok(helperStart >= 0, 'expected local own-property helper');
    const helperEnd = source.indexOf('function toSdkAgentConfig', helperStart);
    assert.ok(helperEnd > helperStart, 'expected SDK config helper after own-property helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const syncStart = source.indexOf('syncSession(params:');
    assert.ok(syncStart >= 0, 'expected syncSession method');
    const syncEnd = source.indexOf('async generateSessionTitle', syncStart);
    assert.ok(syncEnd > syncStart, 'expected title generation after syncSession method');
    const syncSection = source.slice(syncStart, syncEnd);

    assert.match(helperSection, /for \(const key in value\)/);
    assert.match(helperSection, /Object\.prototype\.hasOwnProperty\.call\(value, key\)/);
    assert.match(syncSection, /params\.execution && hasOwnEnumerableProperty\(params\.execution\)/);
    assert.match(syncSection, /params\.session && hasOwnEnumerableProperty\(params\.session\)/);
    assert.doesNotMatch(syncSection, /Object\.keys/);
  });

  test('background terminal sandbox env avoids key and entry array scans', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/terminal/backgroundTerminal.ts'), 'utf8');
    const start = source.indexOf('function buildSandboxedTerminalEnv');
    assert.ok(start >= 0, 'expected sandboxed terminal env helper');
    const end = source.indexOf('function hashForLabel', start);
    assert.ok(end > start, 'expected hash helper after sandboxed env helper');
    const section = source.slice(start, end);

    assert.match(section, /for \(const key in process\.env\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(process\.env, key\)/);
    assert.match(section, /for \(const key in allow\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(allow, key\)/);
    assert.doesNotMatch(section, /Object\.keys/);
    assert.doesNotMatch(section, /Object\.entries/);
  });

  test('shared shell env fallback scans without entry arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/shellEnv.ts'), 'utf8');
    const start = source.indexOf('function getEnvValue');
    assert.ok(start >= 0, 'expected env value helper');
    const end = source.indexOf('export function buildSafeChildProcessEnv', start);
    assert.ok(end > start, 'expected safe env builder after env value helper');
    const section = source.slice(start, end);

    assert.match(section, /for \(const candidateKey in baseEnv\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(baseEnv, candidateKey\)/);
    assert.match(section, /candidateKey\.toLowerCase\(\) === lower/);
    assert.doesNotMatch(section, /Object\.entries/);
  });

  test('modal approval argument preview avoids entry map join arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/approval.ts'), 'utf8');
    const start = source.indexOf('function formatApprovalArgumentsPreview');
    assert.ok(start >= 0, 'expected approval argument preview helper');
    const end = source.indexOf('export async function requestApproval', start);
    assert.ok(end > start, 'expected requestApproval after argument preview helper');
    const section = source.slice(start, end);

    assert.match(section, /let preview = '';/);
    assert.match(section, /for \(const key in record\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(record, key\)/);
    assert.match(section, /preview = preview \? `\$\{preview\}\\n\$\{line\}` : line;/);
    assert.doesNotMatch(section, /Object\.entries/);
    assert.doesNotMatch(section, /\.map\(/);
    assert.doesNotMatch(section, /\.join\(/);
  });

  test('batch approval quick pick avoids map arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/approval.ts'), 'utf8');
    const start = source.indexOf('export async function requestBatchApproval');
    assert.ok(start >= 0, 'expected batch approval helper');
    const end = source.indexOf('export function showToolResult', start);
    assert.ok(end > start, 'expected tool result helper after batch approval');
    const section = source.slice(start, end);

    assert.match(section, /const items = new Array<BatchApprovalItem>\(toolCalls\.length\);/);
    assert.match(section, /for \(let i = 0; i < toolCalls\.length; i\+\+\)/);
    assert.match(section, /items\[i\] = \{/);
    assert.match(section, /const selectedIds = new Set<string>\(\);/);
    assert.match(section, /for \(const item of selected\)/);
    assert.match(section, /selectedIds\.add\(item\.id\);/);
    assert.doesNotMatch(section, /\.map\(/);
  });

  test('chat approval active step updates scan without find callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.approvals.ts'), 'utf8');
    const helperStart = source.indexOf('function findMessageById');
    assert.ok(helperStart >= 0, 'expected local message id lookup helper');
    const helperEnd = source.indexOf('export function createChatApprovalsService', helperStart);
    assert.ok(helperEnd > helperStart, 'expected approvals service after message id helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const methodStart = source.indexOf('markActiveStepStatus(this: ChatApprovalsDeps');
    assert.ok(methodStart >= 0, 'expected active step status helper');
    const methodEnd = source.indexOf('  });', methodStart);
    assert.ok(methodEnd > methodStart, 'expected service object close after active step status helper');
    const methodSection = source.slice(methodStart, methodEnd);

    assert.match(helperSection, /for \(let i = 0; i < messages\.length; i\+\+\)/);
    assert.match(helperSection, /const message = messages\[i\];/);
    assert.match(helperSection, /if \(message\?\.id === messageId\) return message;/);
    assert.match(methodSection, /const stepMsg = findMessageById\(this\.messages, this\.activeStepId\);/);
    assert.doesNotMatch(methodSection, /\.find\(/);
  });

  test('chat controller service binding avoids Object.entries snapshots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/controllerService.ts'), 'utf8');
    const start = source.indexOf('export function bindChatControllerService');
    assert.ok(start >= 0, 'expected chat controller service binder');
    const end = source.indexOf('return bound;', start);
    assert.ok(end > start, 'expected bound service return after binder loop');
    const section = source.slice(start, end);

    assert.match(section, /for \(const name in methods\)/);
    assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(methods, name\)/);
    assert.match(section, /const key = name as keyof T;/);
    assert.match(section, /const method = methods\[key\];/);
    assert.doesNotMatch(section, /Object\.entries/);
  });

  test('chat skills service projects skill names without map arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.skills.ts'), 'utf8');
    const start = source.indexOf('async getSkillNamesForUI');
    assert.ok(start >= 0, 'expected skill names UI method');
    const end = source.indexOf('async postUnknownSkillWarnings', start);
    assert.ok(end > start, 'expected unknown skill warning method after skill names method');
    const section = source.slice(start, end);

    assert.match(section, /const names = new Array<string>\(index\.skills\.length\);/);
    assert.match(section, /for \(let i = 0; i < index\.skills\.length; i\+\+\)/);
    assert.match(section, /names\[i\] = index\.skills\[i\]\.name;/);
    assert.doesNotMatch(section, /\.map\(/);
  });

  test('auto-approved tool replacement compares normalized ids without every callback', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/autoApprovedToolsStore.ts'), 'utf8');
    const start = source.indexOf('function replaceAutoApprovedTools');
    assert.ok(start >= 0, 'expected auto-approved tool replacement helper');
    const end = source.indexOf('function normalizeAutoApprovedToolsInPlace', start);
    assert.ok(end > start, 'expected in-place normalizer after replacement helper');
    const section = source.slice(start, end);

    assert.match(section, /let matches = true;/);
    assert.match(section, /for \(const toolId of normalized\)/);
    assert.match(section, /if \(target\.has\(toolId\)\) continue;/);
    assert.match(section, /if \(matches\) return false;/);
    assert.doesNotMatch(section, /\.every\(/);
  });

  test('runner current-turn memory helpers scan without callback arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/memoryTurn.ts'), 'utf8');

    assert.match(source, /function normalizeTurnId/);
    assert.match(source, /for \(const message of messages\)/);
    assert.match(source, /message\.toolCall\?\.memoryContextSource/);
    assert.match(source, /message\.memoryExcluded && \(message\.id === turnId \|\| message\.turnId === turnId\)/);
    assert.doesNotMatch(source, /\.some\(/);
    assert.doesNotMatch(source, /\.filter\(/);
    assert.doesNotMatch(source, /\.map\(/);
  });

  test('runtime memory recall policy avoids chained array allocations on hot selection paths', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/agent/runtimePolicy.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const turnCounterSection = section('function countCompletedUserTurns', 'function memoryRecallHitSignature');
    const signatureSection = section('function memoryRecallSelectionSignature', 'function memoryRecallAngleSignature');
    const angleSection = section('function memoryRecallAngleSignature', 'function memoryRecallRequestedFacets');
    const requestedFacetsSection = section('function memoryRecallRequestedFacets', 'function memoryRecallSurfacedFacetsForHit');
    const repeatSuppressionSection = section(
      'function getRecentlySurfacedMemoryHitSignatures',
      'function hasEquivalentRecentMemoryRecall',
    );
    const equivalentRecallSection = section('function hasEquivalentRecentMemoryRecall', 'function shouldSkipAutoRecallForQuery');
    const optOutStripSection = section('function stripMemoryRecallContextForCurrentRun', 'function hasMemoryContradictionConflicts');
    const contradictionSection = section('function hasMemoryContradictionConflicts', 'function memoryHitLastConfirmedAt');
    const recentToolSection = section('function recentToolNamesFromSession', 'function memoryHitTools');
    const toolSection = section('function memoryHitTools', 'function queryMentionsActiveToolMemory');
    const activeToolSection = section('function shouldSuppressActiveToolUsageMemory', 'function currentStateReferenceVsProjectOrder');
    const referencePointerSection = section('function selectedHasReferencePointer', 'function currentStateHitSupportOrder');
    const guidanceSection = section('function durableCoreGuidanceTokens', 'function durableAddsDistinctSupport');
    const durableAddsSection = section('function durableAddsDistinctSupport', 'function durableCanonicalPriority');
    const additiveSurfaceSection = section('function renderAdditiveDurableSurfaceLines', 'function durableSupportText');
    const rawSummarySection = section('function rawSummaryAddsDistinctSupport', 'function rawAddsDistinctReferenceSupport');
    const rawReferenceSection = section('function rawAddsDistinctReferenceSupport', 'function rawAddsDistinctCurrentStateSupport');
    const rawCurrentStateSection = section('function rawAddsDistinctCurrentStateSupport', 'function rawAddsDistinctSupport');
    const rawAddsSection = section('function rawAddsDistinctSupport', 'function selectAutoRecallHits');
    const selectSection = section('function selectAutoRecallHits', 'function dirnameUri');
    const recallPrepSection = section('const eligibleMatchHits: typeof search.hits = [];', 'const lines: string[] = [');
    const recallHeaderSection = section("const lines: string[] = [\n      '<memory_recall_context>'", 'let emitted = 0;');
    const recallRenderSection = section('let emitted = 0;', 'if (emitted === 0) return undefined;');
    const recallStateStart = source.indexOf('const surfacedFacetsByHitSignature');
    assert.ok(recallStateStart >= 0, 'expected memory recall state write');
    const recallStateEnd = source.indexOf('return {', recallStateStart);
    assert.ok(recallStateEnd > recallStateStart, 'expected prepared-run return after memory recall state write');
    const recallStateSection = source.slice(recallStateStart, recallStateEnd);

    assert.match(turnCounterSection, /let count = 0;/);
    assert.match(turnCounterSection, /for \(const message of session\.history\)/);
    assert.doesNotMatch(turnCounterSection, /\.filter\(/);

    assert.match(signatureSection, /let signature = '';/);
    assert.match(signatureSection, /function collectMemoryRecallHitSignatures/);
    assert.doesNotMatch(signatureSection, /\.map\(/);
    assert.doesNotMatch(signatureSection, /\.filter\(/);
    assert.doesNotMatch(signatureSection, /\.join\('\|'\)/);

    assert.match(angleSection, /let signature = '';/);
    assert.match(angleSection, /for \(const field of priority\)/);
    assert.doesNotMatch(angleSection, /\.join\('\|'\)/);

    assert.match(requestedFacetsSection, /const requested: MemoryRecallSurfaceFacet\[\] = \[\];/);
    assert.match(requestedFacetsSection, /for \(const field of selectiveMemoryFieldPriority\(query\)\)/);
    assert.match(requestedFacetsSection, /function facetsRevealNewSurface/);
    assert.doesNotMatch(requestedFacetsSection, /\.filter\(/);
    assert.doesNotMatch(requestedFacetsSection, /\.some\(/);

    assert.match(repeatSuppressionSection, /facetsRevealNewSurface\(newlySurfacedFacets, priorSurfacedFacets\)/);
    assert.doesNotMatch(repeatSuppressionSection, /\.some\(/);

    assert.match(equivalentRecallSection, /facetsRevealNewSurface\(newlySurfacedFacets, priorSurfacedFacets\)/);
    assert.doesNotMatch(equivalentRecallSection, /\.some\(/);

    assert.match(optOutStripSection, /const retainedHistory: typeof ctx\.session\.history = \[\];/);
    assert.match(optOutStripSection, /for \(const message of ctx\.session\.history\)/);
    assert.match(optOutStripSection, /retainedHistory\.push\(message\);/);
    assert.match(optOutStripSection, /const retainedContexts: typeof ctx\.session\.compactionSyntheticContexts = \[\];/);
    assert.match(optOutStripSection, /for \(const context of ctx\.session\.compactionSyntheticContexts\)/);
    assert.match(optOutStripSection, /retainedContexts\.push\(context\);/);
    assert.doesNotMatch(optOutStripSection, /\.filter\(/);

    assert.match(contradictionSection, /for \(const hit of hits\) \{[\s\S]*if \(invalidated\.has\(hit\.record\.id\)\) return true;/);
    assert.doesNotMatch(contradictionSection, /\.some\(/);

    assert.match(recentToolSection, /const start = Math\.max\(0, session\.history\.length - maxMessages\);/);
    assert.match(recentToolSection, /for \(let i = start; i < session\.history\.length; i\+\+\)/);
    assert.match(recentToolSection, /const message = session\.history\[i\];/);
    assert.doesNotMatch(recentToolSection, /\.slice\(/);

    assert.match(toolSection, /const tools: string\[\] = \[\];/);
    assert.match(toolSection, /for \(const value of values\)/);
    assert.doesNotMatch(toolSection, /\.map\(/);
    assert.doesNotMatch(toolSection, /\.filter\(/);

    assert.match(activeToolSection, /let hasRecentTool = false;/);
    assert.match(activeToolSection, /for \(const tool of hitTools\)/);
    assert.doesNotMatch(activeToolSection, /\.some\(/);

    assert.match(referencePointerSection, /for \(const item of selected\)/);
    assert.match(referencePointerSection, /if \(hitProvidesReferencePointer\(item\)\) return true;/);
    assert.doesNotMatch(referencePointerSection, /\.some\(/);

    assert.match(guidanceSection, /const tokens: string\[\] = \[\];/);
    assert.match(guidanceSection, /let overlapCount = 0;/);
    assert.match(guidanceSection, /let distinctSpecificity = false;/);
    assert.doesNotMatch(guidanceSection, /\.filter\(/);
    assert.doesNotMatch(guidanceSection, /\[\.\.\.hitTokens\]/);
    assert.doesNotMatch(guidanceSection, /\[\.\.\.hitSpecificity\]/);

    assert.match(durableAddsSection, /const matchedTerms = new Set<string>\(\);/);
    assert.match(durableAddsSection, /for \(const term of matchedTerms\)/);
    assert.doesNotMatch(durableAddsSection, /\.map\(/);
    assert.doesNotMatch(durableAddsSection, /\.filter\(/);
    assert.doesNotMatch(durableAddsSection, /\[\.\.\.matchedTerms\]/);

    assert.match(additiveSurfaceSection, /const compactLines = renderSelectiveMemorySurfaceLines/);
    assert.match(additiveSurfaceSection, /for \(const line of compactLines\)/);
    assert.doesNotMatch(additiveSurfaceSection, /lines\.push\(\.\.\./);

    assert.match(rawSummarySection, /const selectedFiles = new Set<string>\(\);/);
    assert.match(rawSummarySection, /const selectedTools = new Set<string>\(\);/);
    assert.match(rawSummarySection, /for \(const value of hit\.record\.filesTouched\)/);
    assert.match(rawSummarySection, /for \(const value of hit\.record\.toolsUsed\)/);
    assert.match(rawSummarySection, /for \(const token of hitReferenceTokens\)/);
    assert.doesNotMatch(rawSummarySection, /\.flatMap\(/);
    assert.doesNotMatch(rawSummarySection, /\.map\(/);
    assert.doesNotMatch(rawSummarySection, /\.filter\(/);
    assert.doesNotMatch(rawSummarySection, /\.some\(/);

    assert.match(rawReferenceSection, /for \(const selectedHit of selected\)/);
    assert.match(rawReferenceSection, /const selectedMatchedTerms = new Set<string>\(\);/);
    assert.match(rawReferenceSection, /let hasDistinctReferenceEvidence = false;/);
    assert.match(rawReferenceSection, /for \(const token of hitReferenceTokens\)/);
    assert.doesNotMatch(rawReferenceSection, /selected\.filter/);
    assert.doesNotMatch(rawReferenceSection, /\.map\(/);
    assert.doesNotMatch(rawReferenceSection, /\.some\(/);

    assert.match(rawCurrentStateSection, /for \(const term of hit\.matchedTerms \|\| \[\]\)/);
    assert.doesNotMatch(rawCurrentStateSection, /\.some\(/);

    assert.match(rawAddsSection, /let selectedText = '';/);
    assert.match(rawAddsSection, /for \(const item of selected\)/);
    assert.match(rawAddsSection, /for \(const token of hitTokens\)/);
    assert.doesNotMatch(rawAddsSection, /\.map\(/);
    assert.doesNotMatch(rawAddsSection, /\.join\('\\n'\)/);
    assert.doesNotMatch(rawAddsSection, /\.some\(/);

    assert.match(selectSection, /const matchHits: typeof hits = \[\];/);
    assert.match(selectSection, /const durableMatches: typeof hits = \[\];/);
    assert.match(selectSection, /const rawMatches: typeof hits = \[\];/);
    assert.match(selectSection, /let hasDurableReferencePointer = false;/);
    assert.match(selectSection, /for \(const hit of hits\)/);
    assert.match(selectSection, /if \(hit\.durableEntry\.category === 'reference'\) hasDurableReferencePointer = true;/);
    assert.match(selectSection, /const sortedSeedPool = matchHits;/);
    assert.match(selectSection, /const sortedSupplementalPool = usingDurablePool \? rawMatches : matchHits;/);
    assert.doesNotMatch(selectSection, /\.filter\(/);
    assert.doesNotMatch(selectSection, /\.some\(/);
    assert.doesNotMatch(selectSection, /\.slice\(/);

    assert.match(recallPrepSection, /let hasMatchHit = false;/);
    assert.match(recallPrepSection, /for \(const hit of search\.hits\)/);
    assert.match(recallPrepSection, /const toolAwareEligibleMatchHits: typeof eligibleMatchHits = \[\];/);
    assert.match(recallPrepSection, /for \(const hit of eligibleMatchHits\)/);
    assert.match(recallPrepSection, /let selectionPool: typeof toolAwareEligibleMatchHits = toolAwareEligibleMatchHits;/);
    assert.match(recallPrepSection, /for \(const hit of toolAwareEligibleMatchHits\)/);
    assert.match(recallPrepSection, /let topScore = Number\.NEGATIVE_INFINITY;/);
    assert.match(recallPrepSection, /for \(const hit of selectedHits\)/);
    assert.doesNotMatch(recallPrepSection, /\.filter\(/);
    assert.doesNotMatch(recallPrepSection, /\.some\(/);
    assert.doesNotMatch(recallPrepSection, /\[\.\.\.selectedHits\]/);

    assert.match(recallHeaderSection, /if \(hasExplicitForgetMemoryIntent\(query\)\) \{/);
    assert.match(recallHeaderSection, /if \(hasExplicitMemoryRecallIntent\(query\)\) \{/);
    assert.match(recallHeaderSection, /if \(explicitMemoryScope\) lines\.push\(`scope_filter: \$\{explicitMemoryScope\}`\);/);
    assert.match(recallHeaderSection, /lines\.push\(\s*'## Before recommending from recalled memory'/);
    assert.doesNotMatch(recallHeaderSection, /\.\.\.\(/);
    assert.doesNotMatch(recallHeaderSection, /\? \[/);

    assert.match(recallRenderSection, /const precedingHits: typeof selectedHits = \[\];/);
    assert.match(recallRenderSection, /selectedHasReferencePointer\(precedingHits\)/);
    assert.match(recallRenderSection, /renderAdditiveDurableSurfaceLines\(hit\.durableEntry, precedingHits, query\)/);
    assert.match(recallRenderSection, /for \(const line of additiveLines\)/);
    assert.match(recallRenderSection, /const surfaceLines = renderSelectiveMemorySurfaceLines/);
    assert.match(recallRenderSection, /for \(const line of surfaceLines\)/);
    assert.match(recallRenderSection, /precedingHits\.push\(hit\);/);
    assert.doesNotMatch(recallRenderSection, /selectedHits\.slice\(0, emitted\)/);
    assert.doesNotMatch(recallRenderSection, /lines\.push\(\.\.\./);

    assert.match(recallStateSection, /const surfacedFacetsByHitSignature: RecentMemoryRecallState\['surfacedFacetsByHitSignature'\] = \{\};/);
    assert.match(recallStateSection, /hitSignatures: collectMemoryRecallHitSignatures\(selectedHits\)/);
    assert.doesNotMatch(recallStateSection, /Object\.fromEntries/);
    assert.doesNotMatch(recallStateSection, /selectedHits\.map/);
  });

  test('runtime prompt and durable support text assembly avoids filter arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/agent/runtimePolicy.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const supportSection = section('function durableSupportText', 'function extractReferenceEvidenceTokens');
    const systemPromptSection = section('private composeSystemPromptText', 'private async maybeRunExplorePrepass');
    const exploreSection = section('let injected = `<subagent_explore_context>', 'return {');

    assert.match(supportSection, /const lines: string\[\] = \[\];/);
    assert.match(supportSection, /if \(fields\.guidance\) lines\.push\(fields\.guidance\);/);
    assert.match(supportSection, /for \(const rolloutFile of entry\.rolloutFiles\)/);
    assert.match(supportSection, /text = text \? `\$\{text\}\\n\$\{rolloutFile\}` : rolloutFile;/);
    assert.doesNotMatch(supportSection, /\.filter\(Boolean\)/);
    assert.doesNotMatch(supportSection, /\[durableSupportText\(entry\), \.\.\.entry\.rolloutFiles\]/);

    assert.match(systemPromptSection, /return this\.instructionsText \? `\$\{prompt\}\\n\\n\$\{this\.instructionsText\}` : prompt;/);
    assert.doesNotMatch(systemPromptSection, /\.filter\(Boolean\)/);

    assert.match(exploreSection, /if \(truncated\) injected \+= '\\n\\n\\n\.\.\. \[TRUNCATED\]';/);
    assert.match(exploreSection, /injected \+= '\\n<\/subagent_explore_context>';/);
    assert.doesNotMatch(exploreSection, /\.filter\(Boolean\)/);
  });

  test('runtime preparation avoids conditional object spread allocations', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/agent/runtimePolicy.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const prepareRunSection = section('async prepareRun', 'private async prepareRuntime');
    const prepareRuntimeSection = section('private async prepareRuntime', 'private getWorkspaceRootForContext');
    const explorePrepassSection = section('private async maybeRunExplorePrepass', 'private async maybeInjectMemoryRecall');

    assert.match(prepareRunSection, /const preparedRun: LingyunAgentPreparedRun = \{ runtime: runtime\.snapshot \};/);
    assert.match(prepareRunSection, /if \(syntheticContexts\.length > 0\) preparedRun\.syntheticContexts = syntheticContexts;/);
    assert.doesNotMatch(prepareRunSection, /\.\.\.\(syntheticContexts\.length/);

    assert.match(prepareRuntimeSection, /const snapshot: LingyunAgentRuntimeSnapshot = \{/);
    assert.match(prepareRuntimeSection, /modelLimits: undefined,/);
    assert.match(prepareRuntimeSection, /if \(modelId && modelLimit\) snapshot\.modelLimits = \{ \[modelId\]: modelLimit \};/);
    assert.doesNotMatch(prepareRuntimeSection, /\.\.\.\(modelId && modelLimit/);

    assert.match(explorePrepassSection, /const exploreRuntime: LingyunAgentRuntimeSnapshot = \{/);
    assert.match(explorePrepassSection, /if \(exploreModelLimit\) exploreRuntime\.modelLimits = \{ \[exploreModelId\]: exploreModelLimit \};/);
    assert.match(explorePrepassSection, /runtime: exploreRuntime,/);
    assert.doesNotMatch(explorePrepassSection, /\.\.\.\(exploreModelLimit/);
  });

  test('memory search support comparisons avoid chained set allocations', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const agingProjectSection = section('function hasStrongAgingProjectEvidence', 'function hasStrongAgingReferenceEvidence');
    const agingReferenceSection = section('function hasStrongAgingReferenceEvidence', 'function shouldSuppressWeakReferenceMatch');
    const weakReferenceSection = section('function shouldSuppressWeakReferenceMatch', 'function recordLooksLikeReferencePointer');
    const referenceEvidenceSection = section('function durableSupportEvidenceText', 'function rawRecordAddsDistinctReferenceEvidence');
    const supportSection = section('function collectLowercaseTermSet', 'function summaryRecordIsRedundantToRaw');

    assert.match(agingProjectSection, /for \(const term of matchedTerms\)/);
    assert.match(agingProjectSection, /if \(\/\\d\/\.test\(term\) \|\| term\.length >= 8\) return true;/);
    assert.doesNotMatch(agingProjectSection, /matchedTerms\.some/);

    assert.match(agingReferenceSection, /let specificMatchedTermCount = 0;/);
    assert.match(agingReferenceSection, /for \(const term of matchedTerms\)/);
    assert.doesNotMatch(agingReferenceSection, /matchedTerms\.filter/);

    assert.match(weakReferenceSection, /for \(const term of matchedTerms\)/);
    assert.match(weakReferenceSection, /if \(!LOW_SIGNAL_REFERENCE_TERMS\.has\(term\)\) return false;/);
    assert.doesNotMatch(weakReferenceSection, /matchedTerms\.every/);

    assert.match(referenceEvidenceSection, /return appendDelimitedSearchValues\(text, entry\.rolloutFiles, '\\n'\);/);
    assert.match(referenceEvidenceSection, /let noveltyCount = 0;/);
    assert.match(referenceEvidenceSection, /for \(const token of rawTokens\)/);
    assert.doesNotMatch(referenceEvidenceSection, /entry\.rolloutFiles\.join/);
    assert.doesNotMatch(referenceEvidenceSection, /rawTokens\.filter/);

    assert.match(supportSection, /function collectLowercaseTermSet/);
    assert.match(supportSection, /function collectNormalizedSupportSet/);
    assert.match(supportSection, /function hasDistinctNormalizedSupport/);
    assert.match(supportSection, /for \(const value of values\)/);
    assert.match(supportSection, /const durableMatchedTerms = collectLowercaseTermSet\(durableHit\.matchedTerms\);/);
    assert.match(supportSection, /for \(const term of matchedTerms\)/);
    assert.match(supportSection, /if \(durableMatchedTerms\.has\(normalized\) && !LOW_SIGNAL_REFERENCE_TERMS\.has\(normalized\)\) return true;/);
    assert.match(supportSection, /const durableFiles = collectNormalizedSupportSet\(durableEntry\.filesTouched\);/);
    assert.match(supportSection, /const otherFiles = collectNormalizedSupportSet\(otherRecord\.filesTouched\);/);
    assert.match(supportSection, /const summaryReferenceTokens = extractReferenceEvidenceTokens\(summaryRecord\.text\);/);
    assert.match(supportSection, /for \(const token of summaryReferenceTokens\)/);
    assert.doesNotMatch(supportSection, /new Set\(\([^;]+?\|\| \[\]\)\.map/);
    assert.doesNotMatch(supportSection, /\.map\([^)]*=>[^)]*toLowerCase\([^)]*\)\)\.filter\(Boolean\)/);
    assert.doesNotMatch(supportSection, /\.some\(/);
  });

  test('memory search query tokenization avoids split flatMap chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const start = source.indexOf('function splitSearchTerms');
    assert.ok(start >= 0, 'expected search term splitter');
    const end = source.indexOf('function hasNegativeRecallIntent', start);
    assert.ok(end > start, 'expected negative recall helper after term splitter');
    const splitterSection = source.slice(start, end);

    assert.match(splitterSection, /let termStart = -1;/);
    assert.match(splitterSection, /normalized\.charCodeAt\(i\)/);
    assert.match(splitterSection, /char === 32 \|\| char === 47 \|\| char === 58 \|\| char === 46 \|\| char === 95 \|\| char === 45/);
    assert.match(splitterSection, /if \(next\.length >= 24\) break;/);
    assert.doesNotMatch(splitterSection, /\.split\(/);
    assert.doesNotMatch(splitterSection, /\.flatMap\(/);
    assert.doesNotMatch(splitterSection, /\.map\(/);
    assert.doesNotMatch(splitterSection, /\.filter\(/);
  });

  test('memory search phrase boosting avoids per-score split filter slices', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const start = source.indexOf('function firstTwoLongQueryTermsPhrase');
    assert.ok(start >= 0, 'expected leading phrase helper');
    const end = source.indexOf('function queryLooksLikeWhyIntent', start);
    assert.ok(end > start, 'expected why intent helper after phrase boost helper');
    const section = source.slice(start, end);

    assert.match(section, /let termStart = -1;/);
    assert.match(section, /normalizedQuery\.charCodeAt\(i\)/);
    assert.match(section, /return first && second \? `\$\{first\} \$\{second\}` : '';/);
    assert.match(section, /const leadingPhrase = firstTwoLongQueryTermsPhrase\(normalizedQuery\);/);
    assert.doesNotMatch(section, /normalizedQuery\.split/);
    assert.doesNotMatch(section, /\.filter\(/);
    assert.doesNotMatch(section, /\.slice\(0, 2\)/);
    assert.doesNotMatch(section, /\.join\(' '\)/);
  });

  test('memory search current-state phrase extraction scans without split filter slice joins', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const start = source.indexOf('function collectCurrentStateSpecificPhraseTerms');
    assert.ok(start >= 0, 'expected current-state phrase term collector');
    const end = source.indexOf('function hasStrongCurrentStateProjectEvidence', start);
    assert.ok(end > start, 'expected strong current-state evidence helper after phrase extraction');
    const section = source.slice(start, end);

    assert.match(section, /const terms: string\[\] = \[\];/);
    assert.match(section, /normalized\.charCodeAt\(i\)/);
    assert.match(section, /terms\.push\(normalized\.slice\(termStart, i\)\);/);
    assert.match(section, /function currentStatePhraseFromTerms/);
    assert.match(section, /phrase = phrase \? `\$\{phrase\} \$\{term\}` : term;/);
    assert.match(section, /const terms = collectCurrentStateSpecificPhraseTerms\(query\);/);
    assert.match(section, /const phrase = currentStatePhraseFromTerms\(terms, index, size\);/);
    assert.doesNotMatch(section, /\.split\(/);
    assert.doesNotMatch(section, /\.filter\(/);
    assert.doesNotMatch(section, /parts\.slice/);
    assert.doesNotMatch(section, /\.join\(' '\)/);
  });

  test('memory search current-state evidence checks scan without callback arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const start = source.indexOf('function hasStrongCurrentStateProjectEvidence');
    assert.ok(start >= 0, 'expected current-state evidence helper');
    const end = source.indexOf('function shouldSuppressWeakCurrentStateProjectDurableMatch', start);
    assert.ok(end > start, 'expected durable suppression helper after current-state evidence helper');
    const section = source.slice(start, end);

    assert.match(section, /const normalizedText = normalizeSearchText\(params\.text\);/);
    assert.match(section, /if \(haystackContainsAnyTerm\(normalizedText, specificSignals\)\)/);
    assert.match(section, /return haystackContainsAnyTerm\(normalizedText, specificPhrases\);/);
    assert.doesNotMatch(section, /\.some\(/);
  });

  test('memory search haystack builders append fields without filter map joins', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
	    const start = source.indexOf('function haystackContainsAnyTerm');
    assert.ok(start >= 0, 'expected search text append helper');
    const end = source.indexOf('function supportRecordFallbackScore', start);
    assert.ok(end > start, 'expected support score helper after haystack builders');
    const section = source.slice(start, end);

	    assert.match(section, /function appendDelimitedSearchValues/);
	    assert.match(section, /function appendBasenameSearchValues/);
	    assert.match(section, /function haystackContainsAnyTerm/);
	    assert.match(section, /for \(const term of terms\)/);
	    assert.match(section, /if \(!haystackContainsAnyTerm\(normalizeSearchText\(record\.text\), queryTerms\)\) return 0;/);
	    assert.match(section, /function memoryRecordSearchHaystack/);
	    assert.match(section, /text = appendDelimitedSearchValues\(text, record\.filesTouched, ' '\);/);
	    assert.match(section, /text = appendDelimitedSearchValues\(text, record\.sourceTurnIds, ' '\);/);
	    assert.match(section, /function basenameSearchHaystack/);
	    assert.match(section, /const fileHaystack = basenameSearchHaystack\(record\.filesTouched\);/);
	    assert.match(section, /const file = haystackContainsAnyTerm\(fileHaystack, lexical\.matchedTerms\) \? 1\.8 : 0;/);
	    assert.match(section, /const tool = haystackContainsAnyTerm\(toolHaystack, lexical\.matchedTerms\) \? 1\.2 : 0;/);
	    assert.match(section, /text = appendDelimitedSearchValues\(text, entry\.titles, ' '\);/);
	    assert.match(section, /text = appendDelimitedSearchValues\(text, entry\.filesTouched, ' '\);/);
	    assert.match(section, /const fileHaystack = basenameSearchHaystack\(entry\.filesTouched\);/);
	    assert.match(section, /const file = haystackContainsAnyTerm\(fileHaystack, lexical\.matchedTerms\) \? 1\.6 : 0;/);
	    assert.match(section, /const tool = haystackContainsAnyTerm\(toolHaystack, lexical\.matchedTerms\) \? 1 : 0;/);
	    assert.doesNotMatch(section, /\.filter\(Boolean\)/);
	    assert.doesNotMatch(section, /record\.filesTouched\.map/);
	    assert.doesNotMatch(section, /entry\.filesTouched\.map/);
	    assert.doesNotMatch(section, /lexical\.matchedTerms\.some/);
	    assert.doesNotMatch(section, /queryTerms\.some/);
	    assert.doesNotMatch(section, /\.\.\.record\.filesTouched/);
	    assert.doesNotMatch(section, /\.\.\.entry\.titles/);
    assert.doesNotMatch(section, /\.join\(' '\)/);
    assert.doesNotMatch(section, /\.join\('\\n'\)/);
  });

  test('memory search ranking builds candidates without map filter spread chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const start = source.indexOf('export function searchMemoryRecords');
    assert.ok(start >= 0, 'expected memory search entry point');
    const end = source.indexOf('const selected: MemorySearchHit[] = [];', start);
    assert.ok(end > start, 'expected selected hit setup after candidate ranking');
    const rankingSection = source.slice(start, end);

    assert.match(rankingSection, /const workspaceRecords: MemoryRecord\[\] = \[\];/);
    assert.match(rankingSection, /const workspaceRecordMap = new Map<string, MemoryRecord>\(\);/);
    assert.match(rankingSection, /const rawMatches: MemoryRecordScore\[\] = \[\];/);
    assert.match(rankingSection, /for \(const record of params\.records\)/);
    assert.match(rankingSection, /const durableMatches: DurableEntryScore\[\] = \[\];/);
    assert.match(rankingSection, /for \(const entry of params\.durableEntries \|\| \[\]\)/);
    assert.match(rankingSection, /const filteredRawMatches: MemoryRecordScore\[\] = \[\];/);
    assert.match(rankingSection, /let isRedundantToDurable = false;/);
    assert.match(rankingSection, /for \(const durableCandidate of durableMatches\)/);
    assert.match(rankingSection, /let isRedundantToRaw = false;/);
    assert.match(rankingSection, /for \(const otherCandidate of rawMatches\)/);
    assert.match(rankingSection, /let hasDurableReferencePointer = false;/);
    assert.match(rankingSection, /for \(const candidate of durableMatches\)/);
    assert.match(rankingSection, /const combined: SearchCandidate\[\] = \[\];/);
    assert.match(rankingSection, /combined\.sort\(\(a, b\) =>/);
    assert.doesNotMatch(rankingSection, /params\.records\.filter/);
    assert.doesNotMatch(rankingSection, /\.map\(\(record\) => scoreMemoryRecord/);
    assert.doesNotMatch(rankingSection, /\.map\(\(entry\) => scoreDurableEntry/);
    assert.doesNotMatch(rankingSection, /\.\.\.durableMatches\.map/);
    assert.doesNotMatch(rankingSection, /\.\.\.filteredRawMatches\.map/);
    assert.doesNotMatch(rankingSection, /workspaceRecords\.map/);
    assert.doesNotMatch(rankingSection, /\.some\(/);
  });

  test('memory search durable support selection scans without filter map sort copies', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const start = source.indexOf('function compareSupportRecords');
    assert.ok(start >= 0, 'expected support record comparator');
    const end = source.indexOf('function hitText', start);
    assert.ok(end > start, 'expected hit text helper after support selection');
    const section = source.slice(start, end);

    assert.match(section, /function compareSupportRecords/);
    assert.match(section, /function selectSupportRecord/);
    assert.match(section, /let directBest: MemoryRecord \| undefined;/);
    assert.match(section, /const sameSessionCandidates = new Map<string, MemoryRecord>\(\);/);
    assert.match(section, /for \(const record of records\)/);
    assert.match(section, /sameSessionCandidates\.set\(record\.id, record\);/);
    assert.match(section, /for \(const record of sameSessionCandidates\.values\(\)\)/);
    assert.doesNotMatch(section, /records\.filter/);
    assert.doesNotMatch(section, /sameSession\.map/);
    assert.doesNotMatch(section, /\[\.\.\.new Map/);
    assert.doesNotMatch(section, /\[\.\.\.candidates\]\.sort/);
    assert.doesNotMatch(section, /sort\(\(a, b\) =>/);
  });

  test('memory search selected hit assembly tracks durable coverage without selected find callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/search.ts'), 'utf8');
    const helperStart = source.indexOf('function findSelectedDurableReferenceSupport');
    assert.ok(helperStart >= 0, 'expected selected durable reference support helper');
    const helperEnd = source.indexOf('function summaryRecordAddsDistinctSupport', helperStart);
    assert.ok(helperEnd > helperStart, 'expected summary support helper after selected durable support helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const selectedStart = source.indexOf('const selected: MemorySearchHit[] = [];');
    assert.ok(selectedStart >= 0, 'expected selected hit setup');
    const selectedEnd = source.indexOf('selected.sort((a, b) =>', selectedStart);
    assert.ok(selectedEnd > selectedStart, 'expected selected sort after hit assembly');
    const selectedSection = source.slice(selectedStart, selectedEnd);

    assert.match(helperSection, /for \(const hit of hits\)/);
    assert.match(helperSection, /rawRecordSupportsDurableReference\(record, hit, matchedTerms\)/);
    assert.match(selectedSection, /const selectedDurableByKey = new Map<string, MemorySearchHit>\(\);/);
    assert.match(selectedSection, /const selectedDurableReferenceHits: MemorySearchHit\[\] = \[\];/);
    assert.match(selectedSection, /selectedDurableByKey\.get\(durableKey\)/);
    assert.match(selectedSection, /findSelectedDurableReferenceSupport\(selectedDurableReferenceHits, record, matchedTerms\)/);
    assert.match(selectedSection, /selectedDurableByKey\.set\(candidate\.entry\.key, hit\);/);
    assert.match(selectedSection, /selectedDurableReferenceHits\.push\(hit\);/);
    assert.doesNotMatch(selectedSection, /selected\.find/);
    assert.doesNotMatch(selectedSection, /coveredDurableKeys/);
  });

	  test('memory ingest structured candidate filtering scans once with a bounded result', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/ingest.ts'), 'utf8');
    const start = source.indexOf('function collectSessionSignals');
    assert.ok(start >= 0, 'expected session signal collector');
    const end = source.indexOf('export function hasSignal', start);
    assert.ok(end > start, 'expected hasSignal export after session signal collector');
    const collectorSection = source.slice(start, end);

    assert.match(collectorSection, /const structuredMemories: Stage1Output\['structuredMemories'\] = \[\];/);
    assert.match(collectorSection, /const explicitOnly = !!options\?\.explicitOnly;/);
    assert.match(collectorSection, /for \(const item of normalized\.structuredMemories\)/);
    assert.match(collectorSection, /structuredMemories\.push\(item\);/);
    assert.match(collectorSection, /if \(structuredMemories\.length >= 16\) break;/);
    assert.doesNotMatch(collectorSection, /normalized\.structuredMemories\s*\n\s*\.filter/);
    assert.doesNotMatch(collectorSection, /\.filter\(/);
    assert.doesNotMatch(collectorSection, /\.map\(/);
    assert.doesNotMatch(collectorSection, /\.slice\(0, 16\)/);
	    assert.doesNotMatch(collectorSection, /\.flatMap\(/);
	  });

	  test('memory artifact renderers build bounded sections without flatMap filter or slice copies', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/ingest.ts'), 'utf8');
	    const uniqueStart = source.indexOf('function appendUniqueLimitedValue');
	    assert.ok(uniqueStart >= 0, 'expected shared unique memory value appender');
	    const fileStart = source.indexOf('export function renderMemoryFile');
	    assert.ok(fileStart > uniqueStart, 'expected memory file renderer after unique helpers');
	    const summaryStart = source.indexOf('export function renderMemorySummary', fileStart);
	    assert.ok(summaryStart > fileStart, 'expected memory summary renderer after memory file renderer');
	    const uniqueSection = source.slice(uniqueStart, fileStart);
	    const fileSection = source.slice(fileStart, summaryStart);
	    const summarySection = source.slice(summaryStart);

	    assert.match(uniqueSection, /function collectMemoryFocusValues\(outputs: Stage1Output\[\], maxItems: number\): string\[\]/);
	    assert.match(uniqueSection, /function collectStructuredMemoryLines\(outputs: Stage1Output\[\], maxItems: number\): string\[\]/);
	    assert.match(uniqueSection, /for \(const output of outputs\)/);
	    assert.match(uniqueSection, /for \(const item of output\.structuredMemories\)/);
	    assert.match(fileSection, /const focus = collectMemoryFocusValues\(outputs, 10\);/);
	    assert.match(fileSection, /const structured = collectStructuredMemoryLines\(outputs, 16\);/);
	    assert.match(fileSection, /let recentSessions = 0;/);
	    assert.match(fileSection, /if \(recentSessions >= 20\) break;/);
	    assert.match(summarySection, /const focus = collectMemoryFocusValues\(outputs, 8\);/);
	    assert.match(summarySection, /let latestRollouts = 0;/);
	    assert.match(summarySection, /if \(latestRollouts >= 12\) break;/);
	    assert.doesNotMatch(uniqueSection + fileSection + summarySection, /\.flatMap\(/);
	    assert.doesNotMatch(fileSection + summarySection, /\.filter\(Boolean\)/);
	    assert.doesNotMatch(fileSection + summarySection, /outputs\.slice\(0, (?:12|20)\)/);
	  });

	  test('raw memory evidence selection scans lines without sorting copies', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/consolidate.ts'), 'utf8');
	    const helperStart = source.indexOf('function findBestRecordEvidenceLine');
	    assert.ok(helperStart >= 0, 'expected best evidence line scanner');
	    const helperEnd = source.indexOf('export function renderSummaryRecordText', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected summary renderer after best evidence scanner');
	    const helperSection = source.slice(helperStart, helperEnd);
	    const renderStart = source.indexOf('export function renderRawRecordEvidence');
	    assert.ok(renderStart > helperEnd, 'expected raw evidence renderer after summary renderer');
	    const renderEnd = source.indexOf('export function shouldSurfaceSelectiveHowToApply', renderStart);
	    assert.ok(renderEnd > renderStart, 'expected selective how-to helper after raw evidence renderer');
	    const renderSection = source.slice(renderStart, renderEnd);

	    assert.match(helperSection, /let bestLine = '';/);
	    assert.match(helperSection, /let bestScore = Number\.NEGATIVE_INFINITY;/);
	    assert.match(helperSection, /for \(let i = 0; i <= value\.length; i\+\+\)/);
	    assert.match(helperSection, /value\.charCodeAt\(i\) !== 10/);
	    assert.match(helperSection, /scoreRecordEvidenceLine\(line\)/);
	    assert.match(renderSection, /const evidence = findBestRecordEvidenceLine\(text\) \|\| title \|\| summarizeText\(text, 118\) \|\| 'Transcript-backed evidence';/);
	    assert.doesNotMatch(renderSection, /\.sort\(/);
	    assert.doesNotMatch(renderSection, /\[\.\.\.lines\]/);
	    assert.doesNotMatch(renderSection, /\.split\('\\n'\)/);
	    assert.doesNotMatch(renderSection, /\.filter\(Boolean\)/);
	  });

	  test('memory maintenance anchor selection scans records without sorting copies', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/index.ts'), 'utf8');
	    const compareStart = source.indexOf('function compareAnchorRecords');
	    assert.ok(compareStart >= 0, 'expected anchor record comparator');
	    const selectStart = source.indexOf('function selectAnchorRecord', compareStart);
	    assert.ok(selectStart > compareStart, 'expected anchor selector after comparator');
	    const selectEnd = source.indexOf('function mutateStructuredMemories', selectStart);
	    assert.ok(selectEnd > selectStart, 'expected structured memory mutator after anchor selector');
	    const section = source.slice(compareStart, selectEnd);

	    assert.match(section, /function compareAnchorRecords\(a: MemoryRecord, b: MemoryRecord\): number/);
	    assert.match(section, /let best: MemoryRecord \| undefined;/);
	    assert.match(section, /for \(const record of records\)/);
	    assert.match(section, /if \(preferredRecordId && record\.id === preferredRecordId\) return record;/);
	    assert.match(section, /compareAnchorRecords\(record, best\) < 0/);
	    assert.doesNotMatch(section, /\[\.\.\.records\]/);
	    assert.doesNotMatch(section, /\.sort\(/);
	    assert.doesNotMatch(section, /\.find\(/);
	  });

	  test('consolidated memory category sections collect bounded entries without filter slice copies', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/consolidate.ts'), 'utf8');
	    const helperStart = source.indexOf('function entriesForCategory');
	    assert.ok(helperStart >= 0, 'expected category entry selector');
	    const helperEnd = source.indexOf('function appendSummarySection', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected summary section renderer after category selector');
	    const section = source.slice(helperStart, helperEnd);

	    assert.match(section, /const out: ConsolidatedMemoryEntry\[\] = \[\];/);
	    assert.match(section, /for \(const entry of entries\)/);
	    assert.match(section, /if \(entry\.category !== category\) continue;/);
	    assert.match(section, /out\.push\(entry\);/);
	    assert.match(section, /if \(out\.length >= limit\) break;/);
	    assert.doesNotMatch(section, /\.filter\(/);
	    assert.doesNotMatch(section, /\.slice\(/);
	  });

	  test('session signal memory candidate keys scan bounded tokens without split filter chains', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
	    const helperStart = source.indexOf('function memoryCandidateKeySuffix');
	    assert.ok(helperStart >= 0, 'expected memory candidate key suffix helper');
	    const keyStart = source.indexOf('export function buildMemoryCandidateKey', helperStart);
	    assert.ok(keyStart > helperStart, 'expected memory key builder after suffix helper');
	    const keyEnd = source.indexOf('function candidateDedupeKey', keyStart);
	    assert.ok(keyEnd > keyStart, 'expected candidate dedupe helper after memory key builder');
	    const helperSection = source.slice(helperStart, keyStart);
	    const keySection = source.slice(keyStart, keyEnd);

	    assert.match(source, /const MAX_MEMORY_KEY_TOKENS = 12;/);
	    assert.match(helperSection, /let tokenStart = -1;/);
	    assert.match(helperSection, /normalized\.charCodeAt\(i\)/);
	    assert.match(helperSection, /if \(tokenCount >= maxTokens\) break;/);
	    assert.match(helperSection, /return suffix \|\| 'memory';/);
	    assert.match(keySection, /memoryCandidateKeySuffix\(normalized, MAX_MEMORY_KEY_TOKENS\)/);
	    assert.doesNotMatch(helperSection + keySection, /\.split\(/);
	    assert.doesNotMatch(helperSection + keySection, /\.filter\(Boolean\)/);
	    assert.doesNotMatch(helperSection + keySection, /\.slice\(0, MAX_MEMORY_KEY_TOKENS\)/);
	  });

  test('session signal source turn id merge avoids spread snapshots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
    const helperStart = source.indexOf('function normalizeSourceTurnIds');
    assert.ok(helperStart >= 0, 'expected source turn id normalizer');
    const helperEnd = source.indexOf('function normalizeMemoryContext', helperStart);
    assert.ok(helperEnd > helperStart, 'expected memory context normalizer after source turn id helpers');
    const mergeStart = source.indexOf('function mergeMemoryCandidate');
    assert.ok(mergeStart >= 0, 'expected memory candidate merge helper');
    const mergeEnd = source.indexOf('function pushDerivedCandidate', mergeStart);
    assert.ok(mergeEnd > mergeStart, 'expected derived candidate helper after merge helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const mergeSection = source.slice(mergeStart, mergeEnd);

    assert.match(helperSection, /function mergeSourceTurnIds/);
    assert.match(helperSection, /function appendSourceTurnIds/);
    assert.match(helperSection, /appendSourceTurnIds\(merged, seen, existing\)/);
    assert.match(helperSection, /appendSourceTurnIds\(merged, seen, next\)/);
    assert.match(mergeSection, /sourceTurnIds: mergeSourceTurnIds\(existing\.sourceTurnIds, next\.sourceTurnIds\)/);
    assert.doesNotMatch(helperSection + mergeSection, /\[\.\.\./);
    assert.doesNotMatch(helperSection + mergeSection, /\.concat\(/);
    assert.doesNotMatch(mergeSection, /normalizeSourceTurnIds\(\[/);
  });

  test('session signal external memory context copies sources without spread snapshots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
    const helperStart = source.indexOf('function copyBoundedStringList');
    assert.ok(helperStart >= 0, 'expected bounded string list copy helper');
    const helperEnd = source.indexOf('function normalizeConfidence', helperStart);
    assert.ok(helperEnd > helperStart, 'expected normalizeConfidence after bounded copy helper');
    const markStart = source.indexOf('export function markExternalMemoryContext');
    assert.ok(markStart >= 0, 'expected external memory context marker');
    const markEnd = source.indexOf('export function hasExternalMemoryContext', markStart);
    assert.ok(markEnd > markStart, 'expected external memory context predicate after marker');
    const section = source.slice(helperStart, helperEnd) + source.slice(markStart, markEnd);

    assert.match(section, /function copyBoundedStringList/);
    assert.match(section, /for \(const item of value\)/);
    assert.match(section, /if \(copy\.length >= maxItems\) break;/);
    assert.match(section, /copyBoundedStringList\(existing\?\.sources, MAX_EXTERNAL_CONTEXT_SOURCES\)/);
    assert.doesNotMatch(section, /\[\.\.\./);
  });

	  test('session signal structured memory summaries scan lines without split map filter reduce chains', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
	    const start = source.indexOf('function collectStructuredMemoryLines');
	    assert.ok(start >= 0, 'expected structured memory line collector');
	    const end = source.indexOf('function trimTrailingSentencePunctuation', start);
	    assert.ok(end > start, 'expected trailing punctuation helper after structured summary');
	    const section = source.slice(start, end);

	    assert.match(section, /const lines: string\[\] = \[\];/);
	    assert.match(section, /raw\.charCodeAt\(i\)/);
	    assert.match(section, /lines\.push\(line\);/);
	    assert.match(section, /contentLength \+= line\.length;/);
	    assert.match(section, /const \{ lines, contentLength \} = collectStructuredMemoryLines\(text\);/);
	    assert.doesNotMatch(section, /\.split\('\\n'\)/);
	    assert.doesNotMatch(section, /\.map\(\(line\)/);
	    assert.doesNotMatch(section, /\.filter\(Boolean\)/);
	    assert.doesNotMatch(section, /\.reduce\(\(total, line\)/);
	  });

	  test('session signal feedback sentence extraction avoids matchAll map filter chains', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
	    const start = source.indexOf('function collectFeedbackSentences');
	    assert.ok(start >= 0, 'expected feedback sentence collector');
	    const end = source.indexOf('function extractFeedbackWhyAndHowToApply', start);
	    assert.ok(end > start, 'expected feedback why/how helper after sentence collector');
	    const section = source.slice(start, end);

	    assert.match(section, /const sentences: string\[\] = \[\];/);
	    assert.match(section, /text\.charCodeAt\(i\)/);
	    assert.match(section, /sentences\.push\(sentence\);/);
	    assert.match(section, /function joinFeedbackSentences/);
	    assert.match(section, /const sentences = collectFeedbackSentences\(compact\);/);
	    assert.match(section, /joinFeedbackSentences\(sentences, sentences\.length - 1\)/);
	    assert.doesNotMatch(section, /matchAll/);
	    assert.doesNotMatch(section, /\.map\(/);
	    assert.doesNotMatch(section, /\.filter\(Boolean\)/);
	    assert.doesNotMatch(section, /\.slice\(0, -1\)/);
	  });

  test('session signal validated feedback subject scans tokens without split filter arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
    const start = source.indexOf('function isLowSignalValidatedFeedbackSubject');
    assert.ok(start >= 0, 'expected low-signal validated feedback helper');
    const end = source.indexOf('function normalizeValidatedFeedbackGuidance', start);
    assert.ok(end > start, 'expected validated feedback guidance normalizer after helper');
    const section = source.slice(start, end);

    assert.match(section, /let tokenStart = -1;/);
    assert.match(section, /normalized\.charCodeAt\(i\)/);
    assert.match(section, /isLowSignalValidatedFeedbackStopWord\(token\)/);
    assert.match(section, /isGenericValidatedFeedbackSubjectToken\(token\)/);
    assert.doesNotMatch(section, /\.split\(/);
    assert.doesNotMatch(section, /\.filter\(/);
    assert.doesNotMatch(section, /\.every\(/);
    assert.doesNotMatch(section, /\.includes\(/);
  });

  test('session signal validated feedback extractor counts subject tokens without split arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
    const start = source.indexOf('function hasAtLeastTwoValidatedFeedbackSubjectTokens');
    assert.ok(start >= 0, 'expected validated feedback token counter');
    const end = source.indexOf('function normalizeStringList', start);
    assert.ok(end > start, 'expected string list normalizer after validated feedback extractor');
    const section = source.slice(start, end);

    assert.match(section, /function hasAtLeastTwoValidatedFeedbackSubjectTokens/);
    assert.match(section, /subject\.charCodeAt\(i\)/);
    assert.match(section, /tokenCount \+= 1;/);
    assert.match(section, /!hasAtLeastTwoValidatedFeedbackSubjectTokens\(subject\)/);
    assert.doesNotMatch(section, /\.split\(/);
    assert.doesNotMatch(section, /\.filter\(/);
  });

	  test('session signal structured memory text appends optional fields without filter arrays', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionSignals.ts'), 'utf8');
	    const start = source.indexOf('function buildStructuredMemoryText');
	    assert.ok(start >= 0, 'expected structured memory text builder');
	    const end = source.indexOf('function stripLeadingAffirmation', start);
	    assert.ok(end > start, 'expected affirmation helper after structured memory builder');
	    const section = source.slice(start, end);

	    assert.match(section, /const lines: string\[\] = \[\];/);
	    assert.match(section, /if \(guidance\) lines\.push\(guidance\);/);
	    assert.match(section, /if \(fields\?\.why\) lines\.push\(`Why: \$\{fields\.why\}`\);/);
	    assert.match(section, /if \(fields\?\.howToApply\) lines\.push\(`How to apply: \$\{fields\.howToApply\}`\);/);
	    assert.doesNotMatch(section, /\[guidance\]/);
	    assert.doesNotMatch(section, /\.filter\(Boolean\)/);
	  });

	  test('memory artifact path filtering reuses hoisted regexes', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/ingest.ts'), 'utf8');
	    const start = source.indexOf('function looksLikeGeneratedMemoryArtifactFilePath');
	    assert.ok(start >= 0, 'expected generated memory artifact path helper');
	    const end = source.indexOf('function hasMemorySecretPayload', start);
	    assert.ok(end > start, 'expected memory secret helper after artifact path helper');
	    const helperSection = source.slice(start, end);

	    assert.match(source, /const GENERATED_MEMORY_ARTIFACT_FILE_RE = new RegExp/);
	    assert.match(source, /const GENERATED_MEMORY_TOPIC_ARTIFACT_RE = new RegExp/);
	    assert.match(source, /const GENERATED_MEMORY_ROLLOUT_SUMMARY_RE = new RegExp/);
	    assert.match(helperSection, /GENERATED_MEMORY_ARTIFACT_FILE_RE\.test\(normalized\)/);
	    assert.match(helperSection, /GENERATED_MEMORY_TOPIC_ARTIFACT_RE\.test\(normalized\)/);
	    assert.match(helperSection, /GENERATED_MEMORY_ROLLOUT_SUMMARY_RE\.test\(normalized\)/);
	    assert.doesNotMatch(helperSection, /new RegExp/);
	  });

	  test('memory planner session selection avoids repeated filter map passes', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/planner.ts'), 'utf8');
    const start = source.indexOf('export function planMemoryUpdate');
    assert.ok(start >= 0, 'expected memory planner');
    const end = source.indexOf('let insertedOutputs = 0;', start);
    assert.ok(end > start, 'expected rollout processing counters after planner selection');
    const selectionSection = source.slice(start, end);

    assert.match(selectionSection, /const knownSessionIds = new Set<string>\(\);/);
    assert.match(selectionSection, /const eligible: Array<\{ session: PersistedSession; explicitOnly: boolean \}> = \[\];/);
    assert.match(selectionSection, /for \(const session of params\.sessions\)/);
    assert.match(selectionSection, /const signals = normalizeSessionSignals\(session\.signals, params\.now\);/);
    assert.match(selectionSection, /eligible\.sort\(\(a, b\) => b\.session\.updatedAt - a\.session\.updatedAt\);/);
    assert.match(selectionSection, /eligible\.length = params\.config\.maxRolloutsPerStartup;/);
    assert.match(selectionSection, /for \(const output of params\.prev\.outputs\)/);
    assert.match(selectionSection, /for \(const record of params\.prev\.records\)/);
    assert.doesNotMatch(selectionSection, /params\.sessions\s*\n\s*\.flatMap/);
    assert.doesNotMatch(selectionSection, /params\.sessions\s*\n\s*\.filter/);
    assert.doesNotMatch(selectionSection, /params\.sessions\.map/);
    assert.doesNotMatch(selectionSection, /prevOutputs\.map/);
    assert.doesNotMatch(selectionSection, /\.slice\(0, params\.config\.maxRolloutsPerStartup\)/);
  });

  test('memory planner output updates use indexed session lookup', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/memories/planner.ts'), 'utf8');
    const outputScanStart = source.indexOf('const prevOutputs: Stage1Output[] = [];');
    assert.ok(outputScanStart >= 0, 'expected previous output scan');
    const outputScanEnd = source.indexOf('const prevRecords: MemoriesState', outputScanStart);
    assert.ok(outputScanEnd > outputScanStart, 'expected record scan after output scan');
    const outputScanSection = source.slice(outputScanStart, outputScanEnd);
    const updateStart = source.indexOf('if (hasSignal(stage1))');
    assert.ok(updateStart >= 0, 'expected stage1 output update branch');
    const updateEnd = source.indexOf('const sortedOutputs = sortOutputs(outputs)', updateStart);
    assert.ok(updateEnd > updateStart, 'expected output sorting after output updates');
    const updateSection = source.slice(updateStart, updateEnd);

    assert.match(outputScanSection, /const outputIndexBySession = new Map<string, number>\(\);/);
    assert.match(outputScanSection, /const outputIndex = prevOutputs\.length;/);
    assert.match(outputScanSection, /if \(!outputIndexBySession\.has\(output\.sessionId\)\) \{/);
    assert.match(outputScanSection, /outputIndexBySession\.set\(output\.sessionId, outputIndex\);/);
    assert.match(updateSection, /const index = outputIndexBySession\.get\(session\.id\);/);
    assert.match(updateSection, /if \(index !== undefined\) \{/);
    assert.match(updateSection, /outputs\[index\] = stage1;/);
    assert.match(updateSection, /outputIndexBySession\.set\(session\.id, outputs\.length\);/);
    assert.doesNotMatch(updateSection, /\.findIndex\(/);
  });

	  test('core shell risk token normalization avoids chained array allocations', () => {
	    const bashHeuristicsSource = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/bashHeuristics.ts'), 'utf8');
	    const pathPolicySource = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/pathPolicy.ts'), 'utf8');
	    const toolRiskSource = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/toolRisk.ts'), 'utf8');
	    const validationSource = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/validation.ts'), 'utf8');
    const section = (source: string, startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const pathHelperSection = section(pathPolicySource, 'function collectShellPathTokens', 'function tokenizeShellCommand');
    const pathEvalSection = section(pathPolicySource, 'export function evaluateShellPathAccess', 'const candidates: string[] = [];');
    assert.match(pathHelperSection, /const tokens: string\[\] = \[\];/);
    assert.match(pathHelperSection, /for \(const rawToken of tokenizeShellCommand\(command\)\)/);
    assert.match(pathEvalSection, /const tokens = collectShellPathTokens\(command\);/);
    assert.doesNotMatch(pathHelperSection + pathEvalSection, /tokenizeShellCommand\(command\)\.map/);
    assert.doesNotMatch(pathHelperSection + pathEvalSection, /\.filter\(Boolean\)/);

	    const toolHelperSection = section(toolRiskSource, 'function collectShellTokens', 'function normalizePermissionPath');
	    const dotenvSection = section(toolRiskSource, 'export function collectProtectedDotEnvTargets', 'export function evaluateToolRisk');
	    assert.match(toolHelperSection, /const tokens: string\[\] = \[\];/);
	    assert.match(toolHelperSection, /let tokenStart = -1;/);
	    assert.match(toolHelperSection, /text\.charCodeAt\(i\)/);
	    assert.match(toolHelperSection, /const rawToken = text\.slice\(tokenStart, i\);/);
	    assert.doesNotMatch(toolHelperSection, /\.split\(/);
		    assert.match(dotenvSection, /for \(const token of collectShellTokens\(include\)\)/);
		    assert.match(dotenvSection, /for \(const token of collectShellTokens\(commandText\)\)/);
	    assert.doesNotMatch(dotenvSection, /\.map\(stripShellToken\)\.filter\(Boolean\)/);

	    const commandTokenSection = section(validationSource, 'function getFirstCommandToken', 'function getShellTokenBasename');
	    const commandBaseSection = section(validationSource, 'export function getShellCommandBase', 'export function isUnsandboxableShellCommand');
	    assert.match(commandTokenSection, /let tokenStart = -1;/);
	    assert.match(commandTokenSection, /command\.charCodeAt\(i\)/);
	    assert.match(commandTokenSection, /SHELL_ENV_ASSIGNMENT_RE\.test\(token\)/);
	    assert.match(commandBaseSection, /return getShellTokenBasename\(getFirstCommandToken\(command\)\);/);
		    assert.doesNotMatch(commandTokenSection + commandBaseSection, /\.split\(/);

	    const bashPatternsSection = section(
	      bashHeuristicsSource,
	      'const LONG_RUNNING_SERVER_COMMAND_PATTERNS',
	      'function normalizeCommandForHeuristics'
	    );
	    const bashGitSegmentSection = section(
	      bashHeuristicsSource,
	      'function segmentInvokesGitPush',
	      'function shellSegmentSeparatorLength'
	    );
	    const bashGitCommandSection = section(
	      bashHeuristicsSource,
	      'export function looksLikeGitPushCommand',
	      'export function computeStopHint'
	    );
	    assert.match(bashPatternsSection, /const LONG_RUNNING_SERVER_COMMAND_PATTERNS: readonly RegExp\[\] = \[/);
	    assert.match(bashPatternsSection, /const GIT_PUSH_OPTIONS_WITH_VALUE = new Set/);
	    assert.match(bashGitSegmentSection, /let index = nextTokenStart\(normalized, firstEnd\);/);
	    assert.match(bashGitSegmentSection, /while \(index < normalized\.length\)/);
	    assert.match(bashGitCommandSection, /shellSegmentSeparatorLength\(command, i\)/);
	    assert.doesNotMatch(bashGitSegmentSection + bashGitCommandSection, /\.split\(/);
	    assert.doesNotMatch(bashGitSegmentSection + bashGitCommandSection, /\.filter\(Boolean\)/);
		  });

	  test('core path prompt redaction compacts tail without full split filter chains', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/fsPath.ts'), 'utf8');
	    const start = source.indexOf('function compactPathTail');
	    assert.ok(start >= 0, 'expected compact path tail helper');
	    const end = source.indexOf('export function redactFsPathForPrompt', start);
	    assert.ok(end > start, 'expected path prompt redaction after compact tail helper');
	    const helperSection = source.slice(start, end);
	    const redactionSection = source.slice(end);

	    assert.match(helperSection, /let segmentEnd = normalized\.length;/);
	    assert.match(helperSection, /for \(let i = normalized\.length - 1; i >= -1; i -= 1\)/);
	    assert.match(helperSection, /tail\.push\(normalized\.slice\(i \+ 1, segmentEnd\)\);/);
	    assert.match(redactionSection, /return compactPathTail\(normalized, tailSegments\);/);
	    assert.doesNotMatch(helperSection + redactionSection, /\.split\('/);
	    assert.doesNotMatch(helperSection + redactionSection, /\.filter\(Boolean\)/);
	    assert.doesNotMatch(helperSection + redactionSection, /\.slice\(-tailSegments\)/);
	  });

	  test('core background job listing snapshots without temporary arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/backgroundJobs.ts'), 'utf8');
    const start = source.indexOf('export function listBackgroundJobs');
    assert.ok(start >= 0, 'expected background job list helper');
    const end = source.indexOf('export function removeBackgroundJob', start);
    assert.ok(end > start, 'expected remove helper after background job list helper');
    const listSection = source.slice(start, end);

    assert.match(listSection, /const jobs: BackgroundJob\[\] = \[\];/);
    assert.match(listSection, /for \(const job of scopeJobs\.values\(\)\)/);
    assert.match(listSection, /jobs\.push\(snapshot\(job\)\);/);
    assert.doesNotMatch(listSection, /\[\.\.\.scopeJobs\.values\(\)\]/);
    assert.doesNotMatch(listSection, /\.map\(snapshot\)/);
    assert.doesNotMatch(listSection, /jobs\.push\(\.\.\./);
  });

  test('list tools share file tree ignore normalization without spread filter chains', () => {
    const coreSource = fs.readFileSync(path.resolve(__dirname, '../../../../core/src/fileTree.ts'), 'utf8');
    const sdkListSource = fs.readFileSync(path.resolve(__dirname, '../../../../agent-sdk/src/tools/builtin/list.ts'), 'utf8');
    const extensionListSource = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/list.ts'), 'utf8');
    const helperStart = coreSource.indexOf('export function createFileTreeIgnoreDirs');
    assert.ok(helperStart >= 0, 'expected shared file tree ignore helper');
    const helperEnd = coreSource.indexOf('export function renderFileTreeOutput', helperStart);
    assert.ok(helperEnd > helperStart, 'expected render helper after ignore helper');
    const helperSection = coreSource.slice(helperStart, helperEnd);
    const listSources = sdkListSource + extensionListSource;

    assert.match(helperSection, /const ignoreDirs = new Set<string>\(\);/);
    assert.match(helperSection, /for \(const dir of DEFAULT_FILE_TREE_IGNORE_DIRS\)/);
    assert.match(helperSection, /for \(const rawDir of extra\)/);
    assert.match(sdkListSource, /createFileTreeIgnoreDirs\(/);
    assert.match(extensionListSource, /createFileTreeIgnoreDirs\(/);
    assert.doesNotMatch(listSources, /const DEFAULT_IGNORE_DIRS = \[/);
    assert.doesNotMatch(listSources, /new Set\(\[\.\.\.DEFAULT_IGNORE_DIRS/);
    assert.doesNotMatch(listSources, /\.map\(String\)/);
    assert.doesNotMatch(listSources, /\.filter\(Boolean\)/);
  });

  test('webview html script assembly avoids per-call map spread arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const constantStart = source.indexOf('const CHAT_WEBVIEW_SCRIPT_PARTS = [');
    assert.ok(constantStart >= 0, 'expected fixed webview script list to be module-scoped');

    const getHtmlStart = source.indexOf('getHtml(this: ChatWebviewRuntime');
    assert.ok(getHtmlStart >= 0, 'expected getHtml implementation');
    const getHtmlEnd = source.indexOf('const logoUri = webview.asWebviewUri', getHtmlStart);
    assert.ok(getHtmlEnd > getHtmlStart, 'expected logo URI after script assembly');
    const getHtmlSection = source.slice(getHtmlStart, getHtmlEnd);

    assert.match(getHtmlSection, /let scripts = renderBrowserChatProtocolBootstrapScript\(nonce\);/);
    assert.match(getHtmlSection, /for \(const parts of CHAT_WEBVIEW_SCRIPT_PARTS\)/);
    assert.ok(
      getHtmlSection.includes('scripts += `\\n<script nonce="${nonce}" src="${String(uri)}"></script>`;'),
      'expected script tags to be appended directly to the HTML script string'
    );
    assert.doesNotMatch(getHtmlSection, /scriptFiles/);
    assert.doesNotMatch(getHtmlSection, /\.map\(parts/);
    assert.doesNotMatch(getHtmlSection, /\.\.\.scriptFiles/);
  });

  test('assistant markdown streaming uses debounced queue instead of per-token reparse', () => {
    const mainJsPath = path.resolve(__dirname, '../../../media/chat/main.js');
    const source = fs.readFileSync(mainJsPath, 'utf8');
    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');

    const debounceMatch = source.match(/const\s+MARKDOWN_RENDER_DEBOUNCE_MS\s*=\s*(\d+)\s*;/);
    assert.ok(debounceMatch, 'expected markdown debounce constant');
    const debounceMs = Number(debounceMatch?.[1] || 0);
    assert.ok(Number.isFinite(debounceMs) && debounceMs > 0 && debounceMs <= 100, 'debounce should be bounded');

    const tokenCaseStart = source.indexOf("case 'token':");
    assert.ok(tokenCaseStart >= 0, 'expected token case in webview message handler');
    const tokenCaseEnd = source.indexOf("case 'updateTool':", tokenCaseStart);
    assert.ok(tokenCaseEnd > tokenCaseStart, 'expected end of token case block');
    const tokenCaseBody = source.slice(tokenCaseStart, tokenCaseEnd);

		    assert.ok(
		      tokenCaseBody.includes('queueAssistantMarkdownToken('),
		      'token branch should enqueue assistant markdown tokens'
		    );
		    const tokenNormalizeIndex = tokenCaseBody.indexOf('const tokenText = normalizeStreamTokenText(data.token);');
		    const emptyTokenGuardIndex = tokenCaseBody.indexOf('if (!data.messageId || !tokenText) break;');
		    const elementLookupIndex = tokenCaseBody.indexOf('const el = messageEls.get(data.messageId);');
		    const messageStateLookupIndex = tokenCaseBody.indexOf('const msg = messageDataById.get(data.messageId);');
		    const assistantRoleQueueIndex = tokenCaseBody.indexOf("if (msg && msg.role === 'assistant')");
		    const firstScrollReadIndex = tokenCaseBody.indexOf('const wasNearBottom = isNearBottom();');
		    const contentQueryIndex = tokenCaseBody.indexOf('getCachedMessageContentElement(el)');
			    assert.ok(tokenNormalizeIndex >= 0, 'token branch should normalize chunks before render work');
		    assert.ok(emptyTokenGuardIndex > tokenNormalizeIndex, 'token branch should skip empty chunks before DOM or layout reads');
		    assert.ok(elementLookupIndex > emptyTokenGuardIndex, 'token branch should look up message elements after the empty-token guard');
		    assert.ok(messageStateLookupIndex > elementLookupIndex, 'token branch should use message state after finding the target element');
		    assert.ok(firstScrollReadIndex > messageStateLookupIndex, 'token branch should defer scroll layout reads until a render path needs them');
		    assert.ok(assistantRoleQueueIndex >= 0, 'token branch should identify assistant tokens from message state');
		    assert.ok(contentQueryIndex > assistantRoleQueueIndex, 'known assistant tokens should enqueue before falling back to content DOM lookup');
		    assert.ok(
		      tokenCaseBody.includes("queueStreamTextToken(data.messageId, tokenText, wasNearBottom, 'thought')"),
		      'token branch should enqueue thought text tokens'
		    );
	    assert.doesNotMatch(
	      tokenCaseBody,
	      /querySelector\(['"]\.thinking-text['"]\)/,
	      'token branch should not query thought DOM before the batched text flush'
	    );
		    assert.ok(
		      tokenCaseBody.includes("queueStreamTextToken(data.messageId, tokenText, wasNearBottom, 'content')"),
		      'token branch should enqueue plain text tokens'
		    );
		    assert.ok(
		      tokenCaseBody.includes('appendPendingToken(data.messageId, tokenText)'),
		      'missing message elements should buffer the normalized token text'
		    );
		    assert.doesNotMatch(
		      tokenCaseBody,
		      /(?:queueAssistantMarkdownToken|queueStreamTextToken|appendPendingToken)\([^)]*data\.token/,
		      'token branch should pass normalized token text into queue/buffer helpers'
		    );
		    const tokenBeforeElementCheck = tokenCaseBody.slice(0, tokenCaseBody.indexOf('if (el)'));
		    assert.doesNotMatch(
		      tokenBeforeElementCheck,
		      /isNearBottom\(\)/,
		      'token branch should avoid scroll layout reads before an existing message element is known'
		    );
	    assert.ok(
	      !tokenCaseBody.includes('renderMarkdown('),
	      'token branch must not call renderMarkdown directly for each chunk'
	    );
	    assert.doesNotMatch(
	      tokenCaseBody,
	      /(?:thinkingEl|contentEl)\.textContent\s*=\s*\(/,
	      'token branch should avoid per-token textContent append writes'
	    );
    assert.match(source, /function normalizeStreamTokenText\(token\) \{[\s\S]*token === undefined \|\| token === null \? '' : token/);
    assert.doesNotMatch(source, /if \(!messageId \|\| !token\) return;/);
    assert.match(source, /state\.pending \+= tokenText;/);

	    const updateCaseStart = source.indexOf("case 'updateMessage':");
    assert.ok(updateCaseStart >= 0, 'expected updateMessage case in webview message handler');
    const updateCaseEnd = source.indexOf("case 'processing':", updateCaseStart);
    assert.ok(updateCaseEnd > updateCaseStart, 'expected end of updateMessage case block');
    const updateCaseBody = source.slice(updateCaseStart, updateCaseEnd);

		    assert.ok(
		      updateCaseBody.includes('flushPendingStreamRenders(updatedMessage.id);'),
		      'updateMessage branch should flush pending stream queues'
		    );
	    const replaceBranchStart = updateCaseBody.indexOf('} else if (msgEl) {');
	    assert.ok(replaceBranchStart >= 0, 'expected replacement branch in updateMessage handler');
	    const replaceBranchEnd = updateCaseBody.indexOf('} else {', replaceBranchStart);
	    assert.ok(replaceBranchEnd > replaceBranchStart, 'expected end of replacement branch');
		    const replaceBranchBody = updateCaseBody.slice(replaceBranchStart, replaceBranchEnd);
			    const pendingLookupIndex = replaceBranchBody.indexOf('const pending = pendingTokens.get(updatedMessage.id);');
			    const nearBottomIndex = replaceBranchBody.indexOf("const wasNearBottomMessageUpdate = pending && updatedMessage.role === 'assistant' ? isNearBottom() : false;");
		    const replaceWithIndex = replaceBranchBody.indexOf('msgEl.replaceWith(newEl);');
		    assert.ok(pendingLookupIndex >= 0, 'replacement branch should read pending tokens once before replacing DOM');
		    assert.ok(nearBottomIndex > pendingLookupIndex, 'replacement branch should derive pending-token scroll state after pending lookup');
		    assert.ok(replaceWithIndex > nearBottomIndex, 'replacement branch should read scroll state before replacing DOM');
			    const unchangedKeyIndex = replaceBranchBody.indexOf('const messageRenderKeyUnchanged = !!(');
			    const pendingReplayIndex = replaceBranchBody.indexOf('replayPendingTokenIntoRenderedMessage(');
			    assert.ok(unchangedKeyIndex > pendingLookupIndex, 'replacement branch should compute unchanged render keys after reading pending tokens');
			    assert.ok(pendingReplayIndex > unchangedKeyIndex, 'unchanged render-key updates should replay pending tokens before replacing DOM');
			    assert.ok(replaceWithIndex > pendingReplayIndex, 'pending-token replay should run before the replacement fallback');
			    assert.doesNotMatch(
			      replaceBranchBody,
			      /queueAssistantMarkdownToken\(updatedMessage\.id,\s*pending,\s*isNearBottom\(\)\)/,
		      'replacement branch should not read scroll position after replacing DOM for pending assistant tokens'
		    );
		    assert.ok(source.includes('const streamTextRenderQueue = new Map();'), 'expected a debounced text stream queue');
		    assert.match(source, /for \(const state of assistantMarkdownRenderQueue\.values\(\)\) \{[\s\S]*clearTimeout\(state\.timer\);/);
		    assert.match(source, /for \(const state of streamTextRenderQueue\.values\(\)\) \{[\s\S]*clearTimeout\(state\.timer\);/);
		    assert.doesNotMatch(source, /assistantMarkdownRenderQueue\.forEach/);
		    assert.doesNotMatch(source, /streamTextRenderQueue\.forEach/);
		    assert.ok(source.includes('function flushStreamTextRender(messageId)'), 'expected text stream flush helper');
	    assert.match(
	      source,
	      /const targetEl = kind === 'thought' \? getCachedMessageThinkingTextElement\(el\) : getCachedMessageContentElement\(el\);/,
	      'text stream flush should use cached targets for content and thought tokens'
	    );
	    assert.match(renderMessagesSource, /const messageContentElementCache = new WeakMap\(\);/);
		    assert.match(renderMessagesSource, /const messageThinkingTextElementCache = new WeakMap\(\);/);
		    assert.match(renderMessagesSource, /function getContainedMessageCachedElement\(messageEl, cache\)/);
		    assert.match(renderMessagesSource, /typeof messageEl\.contains !== 'function' \|\| messageEl\.contains\(cached\)/);
		    assert.match(renderMessagesSource, /cache\.delete\(messageEl\);/);
		    assert.match(renderMessagesSource, /function getCachedMessageContentElement\(messageEl\)/);
		    assert.match(renderMessagesSource, /function getCachedMessageThinkingTextElement\(messageEl\)/);
		    assert.match(renderMessagesSource, /const cached = getContainedMessageCachedElement\(messageEl, messageContentElementCache\);[\s\S]*if \(cached\) return cached;/);
		    assert.match(renderMessagesSource, /const cached = getContainedMessageCachedElement\(messageEl, messageThinkingTextElementCache\);[\s\S]*if \(cached\) return cached;/);
		    assert.match(renderMessagesSource, /function findMessageContentElementFromLayout\(messageEl\)/);
		    assert.match(renderMessagesSource, /const layoutContent = findMessageContentElementFromLayout\(messageEl\);[\s\S]*if \(layoutContent\) return layoutContent;/);
		    assert.match(renderMessagesSource, /function findMessageThinkingTextElementFromLayout\(messageEl\)/);
		    assert.match(renderMessagesSource, /const layoutThinkingText = findMessageThinkingTextElementFromLayout\(messageEl\);[\s\S]*if \(layoutThinkingText\) return layoutThinkingText;/);
		    assert.ok(source.includes('function flushPendingStreamRenders(messageId)'), 'expected shared stream flush helper');
    assert.ok(source.includes('flushAssistantMarkdownRender(messageId);'), 'shared flush should include markdown queue');
    assert.ok(source.includes('flushStreamTextRender(messageId);'), 'shared flush should include text queue');
    assert.ok(
      source.includes('function discardPendingStreamState(messageId)'),
      'expected helper that discards buffered stream state for retries'
    );
    assert.match(
      source,
      /streamTextRenderQueue\.delete\(messageId\);[\s\S]*pendingTokens\.delete\(messageId\);/,
      'discard helper should clear text queue state'
    );
			    assert.ok(
		      updateCaseBody.includes('discardPendingStreamState(updatedMessage.id);'),
		      'updateMessage branch should discard buffered stream state when a retry resets assistant/thought content'
		    );
			    assert.match(updateCaseBody, /!hasNonWhitespaceText\(getMessageTextContent\(updatedMessage\.content, ''\)\)/);
			    assert.doesNotMatch(updateCaseBody, /getMessageTextContent\(updatedMessage\.content, ''\)\.trim\(\)/);
			    assert.doesNotMatch(updateCaseBody, /String\(updatedMessage\.content \|\| ''\)/);
		    assert.match(renderMessagesSource, /const renderedText = appendStreamTextContent\(thinkingEl, pending, false\);/);
		    assert.match(renderMessagesSource, /const renderedText = appendStreamTextContent\(contentEl, pending, true\);/);
		    assert.doesNotMatch(renderMessagesSource, /appendStreamTextContent\([^;]+?\) \|\| linkifyText/);
		  });

		  test('plain text streaming appends text nodes instead of rewriting full text content', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
	    const helperStart = bootstrapSource.indexOf('function appendStreamTextContent');
	    assert.ok(helperStart >= 0, 'expected stream text append helper');
	    const helperEnd = bootstrapSource.indexOf('function setTitle', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected helper end before setTitle');
	    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
	    const setTextStart = bootstrapSource.indexOf('function setTextContent');
	    assert.ok(setTextStart >= 0, 'expected text setter helper');
	    const setTextSection = bootstrapSource.slice(setTextStart, helperStart);

	    assert.match(bootstrapSource, /const STREAM_TEXT_CACHE_KEY = '__lingyunStreamText';/);
	    assert.match(setTextSection, /const nextText = String\(text === undefined \|\| text === null \? '' : text\);/);
		    assert.match(setTextSection, /Object\.prototype\.hasOwnProperty\.call\(element, STREAM_TEXT_CACHE_KEY\)/);
		    assert.match(setTextSection, /element\[STREAM_TEXT_CACHE_KEY\] = nextText;/);
		    assert.doesNotMatch(setTextSection, /String\(text \|\| ''\)/);
		    assert.match(bootstrapSource, /function getMessageTextContent\(value, fallback\)/);
		    assert.match(helperSection, /if \(!element \|\| text === undefined \|\| text === null\) return '';/);
		    assert.match(helperSection, /const chunk = String\(text\);/);
		    assert.match(helperSection, /if \(!chunk\) return '';/);
		    assert.match(helperSection, /const hasCachedText = Object\.prototype\.hasOwnProperty\.call\(element, STREAM_TEXT_CACHE_KEY\);/);
		    assert.match(helperSection, /element\[STREAM_TEXT_CACHE_KEY\] = nextText;/);
		    assert.match(helperSection, /lastChild\.nodeType === 3/);
		    assert.match(helperSection, /lastChild\.nodeValue = String\(lastChild\.nodeValue === undefined \|\| lastChild\.nodeValue === null \? '' : lastChild\.nodeValue\) \+ chunk;/);
		    assert.match(helperSection, /element\.appendChild\(document\.createTextNode\(chunk\)\);/);
		    assert.doesNotMatch(helperSection, /element\.textContent = nextText;/);
		    assert.doesNotMatch(helperSection, /if \(!element \|\| !text\)/);
		    assert.doesNotMatch(helperSection, /const currentText = replacePlaceholder && element\.textContent/);
			    assert.doesNotMatch(renderMessagesSource, /linkifyText = .*\.textContent \|\| linkifyText;/);
		  });

	  test('shared html escaping skips replacement for already-safe text', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const helperEnd = contextSource.indexOf('let sessionSelectRenderKey');
	    assert.ok(helperEnd > 0, 'expected session selector state after escape helper');
	    const helperSection = contextSource.slice(0, helperEnd);

	    assert.match(helperSection, /const HTML_ESCAPE_TEST_RE = \/\[&<>"'\]\/;/);
	    assert.match(helperSection, /const HTML_ESCAPE_RE = \/\[&<>"'\]\/g;/);
	    assert.match(helperSection, /function\s+escapeHtmlChar\(ch\)/);
	    assert.match(helperSection, /case '&': return '&amp;';/);
	    assert.match(helperSection, /case '<': return '&lt;';/);
	    assert.match(helperSection, /case '>': return '&gt;';/);
	    assert.match(helperSection, /case '"': return '&quot;';/);
	    assert.match(helperSection, /case "'": return '&#39;';/);
	    assert.match(helperSection, /const value = String\(text === undefined \|\| text === null \? '' : text\);/);
	    assert.match(helperSection, /HTML_ESCAPE_TEST_RE\.test\(value\) \? value\.replace\(HTML_ESCAPE_RE, escapeHtmlChar\) : value/);
	    assert.doesNotMatch(helperSection, /\.replace\(\//);
	  });

		  test('assistant markdown linkification is gated before walking rendered DOM', () => {
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');

    const textFlushStart = mainSource.indexOf('function flushStreamTextRender');
    assert.ok(textFlushStart >= 0, 'expected text stream flush helper');
    const textFlushEnd = mainSource.indexOf('function flushPendingStreamRenders', textFlushStart);
    assert.ok(textFlushEnd > textFlushStart, 'expected shared stream flush helper after text flush helper');
    const textFlushSection = mainSource.slice(textFlushStart, textFlushEnd);

	    assert.match(contextSource, /function\s+scheduleFileLinkifyIfNeeded\(/);
	    assert.match(contextSource, /const fileLinkGateStateByRoot = new WeakMap\(\);/);
		    assert.match(contextSource, /const FILE_LINK_GATE_OVERLAP_CHARS = \d+;/);
		    assert.match(contextSource, /gateState\.checkedLength - FILE_LINK_GATE_OVERLAP_CHARS/);
			    assert.match(contextSource, /if \(opts && opts\.force\) \{[\s\S]*scheduleFileLinkify\(rootEl, opts\);[\s\S]*return;/);
			    assert.match(contextSource, /if \(gateState\.hasPathSignal && !\(opts && opts\.appendOnly\)\) \{[\s\S]*scheduleFileLinkify\(rootEl, opts\);[\s\S]*return;/);
			    assert.match(contextSource, /const checkText = value\.slice\(start\);/);
			    assert.match(contextSource, /if \(!looksLikeTextMayContainPath\(checkText\)\) return;/);
			    assert.match(contextSource, /gateState\.hasPathSignal = true;/);
			    assert.match(contextSource, /const value = String\(text === undefined \|\| text === null \? '' : text\);/);
			    assert.doesNotMatch(contextSource, /looksLikeTextMayContainPath\(String\(text \|\| ''\)\)/);
		    assert.match(mainSource, /if \(renderInfo\.htmlChanged && typeof scheduleFileLinkify === 'function'\) \{/);
		    assert.match(mainSource, /scheduleFileLinkifyIfNeeded\(el,\s*renderInfo\.raw\)/);
		    assert.match(textFlushSection, /const renderedText = appendStreamTextContent\(targetEl, pending, kind !== 'thought'\);/);
		    assert.match(textFlushSection, /scheduleFileLinkifyIfNeeded\(el,\s*renderedText,\s*\{ appendOnly: true \}\)/);
		    assert.match(mainSource, /scheduleFileLinkifyIfNeeded\(newEl,\s*getMessageTextContent\(updatedMessage\.content, ''\)\)/);
	    assert.doesNotMatch(mainSource, /scheduleFileLinkifyIfNeeded\(newEl,\s*data\.message\.content \|\| ''\)/);
	    assert.match(renderMessagesSource, /scheduleFileLinkifyIfNeeded\(el,\s*linkifyText\)/);
	  });

	  test('file linkification skips rendered markdown code surfaces', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const helperStart = contextSource.indexOf('function shouldSkipFileLinkify');
	    assert.ok(helperStart >= 0, 'expected file linkification skip helper');
    const helperEnd = contextSource.indexOf('function looksLikeTextMayContainPath', helperStart);
    assert.ok(helperEnd > helperStart, 'expected end of skip helper');
	    const helperSection = contextSource.slice(helperStart, helperEnd);

	    assert.match(helperSection, /tag === 'PRE'/);
	    assert.match(helperSection, /tag === 'CODE'/);
	    assert.match(helperSection, /isFileLinkTokenElement\(el\)/);
	  });

		  test('file link candidate scan retains only path-shaped text nodes before DOM replacement', () => {
		    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
			    const helperStart = contextSource.indexOf('function isFileLinkTokenElement');
	    assert.ok(helperStart >= 0, 'expected file candidate marker helper');
	    const helperEnd = contextSource.indexOf('function shouldSkipFileLinkify', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected end of file candidate marker helper');
	    const helperSection = contextSource.slice(helperStart, helperEnd);

		    assert.match(helperSection, /function isFileLinkTokenElement\(el\)/);
		    assert.doesNotMatch(helperSection, /function isInsideFileLinkToken/);
		    assert.doesNotMatch(helperSection, /if \(isInsideFileLinkToken\(parent\)\) continue;/);
		    assert.doesNotMatch(helperSection, /const parent = n\.parentElement;/);
		    assert.doesNotMatch(helperSection, /\.closest\('\.file-link-token'\)/);
			    assert.match(helperSection, /let candidates = null;/);
			    assert.match(helperSection, /if \(!candidates\) candidates = \[\];/);
			    assert.match(helperSection, /if \(!candidates\) return EMPTY_FILE_LINK_CANDIDATES;/);
			    assert.match(helperSection, /const markedCandidates = \[\];/);
			    assert.match(helperSection, /if \(!looksLikeTextMayContainPath\(text\)\) continue;/);
			    assert.match(helperSection, /candidates\.push\(n\);/);
			    assert.match(helperSection, /const textNode = candidates\[candidateIndex\];/);
			    assert.match(helperSection, /const text = String\(textNode\.nodeValue \|\| ''\);/);
			    assert.match(helperSection, /markedCandidates\.push\(span\);/);
			    assert.match(helperSection, /return markedCandidates;/);
			    assert.doesNotMatch(helperSection, /candidates\.push\(\{ textNode: n, text \}\);/);
			    assert.doesNotMatch(helperSection, /for \(const item of candidates\)/);
		  });

	  test('file link path parsing reuses hoisted regexes', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const helperStart = contextSource.indexOf('function looksLikeTextMayContainPath');
	    assert.ok(helperStart >= 0, 'expected file link signal helper');
	    const helperEnd = contextSource.indexOf('function registerFileLinkCandidate', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected file link registration helper after parser helpers');
	    const helperSection = contextSource.slice(helperStart, helperEnd);

	    assert.match(contextSource, /const FILE_LINK_TEXT_SIGNAL_RE = /);
	    assert.ok(contextSource.includes('const FILE_LINK_TOKEN_RE = /\\S+/g;'));
	    assert.match(contextSource, /const FILE_LINK_HASH_LOCATION_RE = /);
	    assert.match(contextSource, /const FILE_LINK_COLON_LOCATION_RE = /);
	    assert.match(contextSource, /const FILE_LINK_COLON_PREFIX_LOCATION_RE = /);
	    assert.match(contextSource, /const FILE_LINK_LEADING_PUNCTUATION = '\(\[\{<"\\'`';/);
	    assert.match(contextSource, /const FILE_LINK_TRAILING_PUNCTUATION = '\)\]\}>,\.;"\\'`';/);
		    assert.match(helperSection, /FILE_LINK_TEXT_SIGNAL_RE\.test\(value\)/);
		    assert.match(helperSection, /const re = FILE_LINK_TOKEN_RE;/);
		    assert.match(helperSection, /re\.lastIndex = 0;/);
		    assert.match(helperSection, /let out = null;/);
		    assert.match(helperSection, /if \(!out\) out = \[\];/);
		    assert.match(helperSection, /if \(!out\) return null;/);
		    assert.match(helperSection, /FILE_LINK_LEADING_PUNCTUATION\.includes\(raw\[start\]\)/);
	    assert.match(helperSection, /FILE_LINK_TRAILING_PUNCTUATION\.includes\(raw\[end - 1\]\)/);
	    assert.match(helperSection, /const raw = String\(word \|\| ''\);/);
	    assert.match(helperSection, /if \(!wordMayContainFileLinkSignal\(raw\)\) return null;/);
	    assert.match(helperSection, /function wordMayContainFileLinkSignal\(raw\)/);
	    assert.match(helperSection, /let firstContentCode = 0;/);
	    assert.match(helperSection, /for \(let index = 0; index < raw\.length; index\+\+\) \{/);
	    assert.match(helperSection, /const code = raw\.charCodeAt\(index\);/);
	    assert.match(helperSection, /code === 47 \|\| code === 92 \|\| code === 46 \|\| code === 35 \|\| code === 126 \|\| code === 58/);
	    assert.match(helperSection, /if \(!firstContentCode && !isFileLinkLeadingPunctuationCode\(code\)\) firstContentCode = code;/);
	    assert.match(helperSection, /return isLikelySpecialFileBasenameStartCode\(firstContentCode\);/);
	    assert.match(helperSection, /function isFileLinkLeadingPunctuationCode\(code\)/);
	    assert.match(helperSection, /function isLikelySpecialFileBasenameStartCode\(code\)/);
	    assert.match(helperSection, /let prefix = '';/);
	    assert.match(helperSection, /let core = raw;/);
	    assert.match(helperSection, /let suffix = '';/);
	    assert.match(helperSection, /if \(start > 0 \|\| end < raw\.length\) \{/);
	    assert.match(helperSection, /prefix = start > 0 \? raw\.slice\(0, start\) : '';/);
	    assert.match(helperSection, /suffix = end < raw\.length \? raw\.slice\(end\) : '';/);
	    assert.match(helperSection, /FILE_LINK_TRAILING_COLON_WITHOUT_LINE_RE\.test\(core\)/);
	    assert.match(helperSection, /FILE_LINK_VERSION_NUMBER_RE\.test\(value\)/);
	    assert.match(helperSection, /const firstCode = value\.charCodeAt\(0\);/);
	    assert.match(helperSection, /firstCode === 72 \|\| firstCode === 104 \|\| firstCode === 87 \|\| firstCode === 119/);
	    assert.match(helperSection, /const lower = value\.toLowerCase\(\);/);
	    assert.match(helperSection, /const hasDot = value\.includes\('\.'\);/);
	    assert.match(helperSection, /if \(value\.includes\('@'\) && hasDot\) return false;/);
	    const slashPathIndex = helperSection.indexOf("if (value.includes('/') || value.includes('\\\\')) return true;");
	    const versionIndex = helperSection.indexOf('FILE_LINK_VERSION_NUMBER_RE.test(value)');
	    assert.ok(slashPathIndex >= 0, 'expected slash paths to classify before extension regex checks');
	    assert.ok(versionIndex > slashPathIndex, 'expected version regex to run only after slash paths are handled');
	    assert.match(helperSection, /FILE_LINK_ALPHA_RE\.test\(value\)/);
	    assert.match(helperSection, /FILE_LINK_SPECIAL_BASENAME_RE\.test\(value\)/);
	    assert.match(helperSection, /if \(value\.includes\('#L'\)\) \{/);
	    assert.match(helperSection, /function hasPathLocationColon\(value\)/);
	    assert.match(helperSection, /let index = value\.indexOf\(':'\);/);
	    assert.match(helperSection, /const nextCode = value\.charCodeAt\(index \+ 1\);/);
	    assert.match(helperSection, /nextCode >= 48 && nextCode <= 57/);
	    assert.match(helperSection, /index = value\.indexOf\(':', index \+ 1\);/);
	    assert.match(helperSection, /if \(hasPathLocationColon\(value\)\) \{/);
	    assert.match(helperSection, /FILE_LINK_HASH_LOCATION_RE\.exec\(value\)/);
	    assert.match(helperSection, /FILE_LINK_COLON_LOCATION_RE\.exec\(value\)/);
		    assert.match(helperSection, /FILE_LINK_COLON_PREFIX_LOCATION_RE\.exec\(value\)/);
		    assert.doesNotMatch(helperSection, /const out = \[\];/);
		    assert.doesNotMatch(helperSection, /let changed = false;/);
	    assert.doesNotMatch(helperSection, /const split = splitWordPunctuation\(word\);/);
	    assert.doesNotMatch(helperSection, /raw\.includes\('/);
	    assert.doesNotMatch(helperSection, /value\.match\(/);
	    assert.doesNotMatch(helperSection, /const leading = /);
	    assert.doesNotMatch(helperSection, /const trailing = /);
	    assert.doesNotMatch(helperSection, /let prefix = raw\.slice/);
	    assert.doesNotMatch(helperSection, /let core = raw\.slice/);
	    assert.doesNotMatch(helperSection, /let suffix = raw\.slice/);
	    assert.doesNotMatch(contextSource, /FILE_LINK_WINDOWS_ABSOLUTE_RE/);
	    assert.doesNotMatch(helperSection, /if \(value\.includes\(':'\)\) \{/);
	    assert.ok(!helperSection.includes('const re = /\\S+/g;'));
	  });

	  test('copy feedback reuses per-button timers instead of stacking reset timers', () => {
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const stateStart = renderUtilsSource.indexOf('const copyFeedbackTimers');
    assert.ok(stateStart >= 0, 'expected shared copy feedback timer state');
    const helperStart = renderUtilsSource.indexOf('function showCopyFeedback');
    assert.ok(helperStart >= 0, 'expected shared copy feedback helper');
    const helperEnd = renderUtilsSource.indexOf("document.addEventListener('click'", helperStart);
    assert.ok(helperEnd > helperStart, 'expected helper before delegated click handler');
    const stateSection = renderUtilsSource.slice(stateStart, helperStart);
    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);

		    assert.match(renderUtilsSource, /const\s+copyFeedbackTimers\s*=\s*new WeakMap\(\)/);
		    assert.match(renderUtilsSource, /const\s+copyFeedbackButtonStates\s*=\s*new WeakMap\(\)/);
		    assert.match(renderUtilsSource, /const\s+copyFeedbackResetStateByButton\s*=\s*new WeakMap\(\)/);
		    assert.match(renderUtilsSource, /const\s+activeCopyFeedbackButtons\s*=\s*new Set\(\)/);
		    assert.match(stateSection, /function rememberCopyFeedbackResetState\(button, resetText, resetAriaLabel\)/);
			    assert.match(stateSection, /function getCopyFeedbackResetState\(button\)/);
		    assert.match(stateSection, /function resetCopyFeedbackButton\(button\)/);
    assert.match(stateSection, /function clearAllCopyFeedbackTimers\(\)/);
    assert.match(stateSection, /for \(const button of activeCopyFeedbackButtons\)/);
    assert.match(stateSection, /clearTimeout\(timer\)/);
    assert.match(stateSection, /resetCopyFeedbackButton\(button\)/);
    assert.match(stateSection, /activeCopyFeedbackButtons\.clear\(\)/);
	    assert.match(stateSection, /setTextContent\(button, resetText\);/);
	    assert.match(stateSection, /setAttributeValue\(button, 'aria-label', resetAriaLabel\);/);
	    assert.match(stateSection, /setClassPresence\(button, 'copied', false\);/);
	    assert.match(stateSection, /copyFeedbackButtonStates\.delete\(button\)/);
	    assert.match(helperSection, /copyFeedbackTimers\.get\(button\)/);
	    assert.match(helperSection, /if \(existing\) clearTimeout\(existing\)/);
		    assert.match(helperSection, /rememberCopyFeedbackResetState\(/);
		    assert.doesNotMatch(renderUtilsSource, /dataset\.copyResetText/);
		    assert.doesNotMatch(renderUtilsSource, /dataset\.copyResetAriaLabel/);
	    assert.match(helperSection, /const nextCopiedText = String\(copiedText === undefined \|\| copiedText === null \? '' : copiedText\);/);
	    assert.match(helperSection, /const nextAriaLabel = options\.ariaLabel \? String\(options\.ariaLabel\) : '';/);
	    assert.match(helperSection, /copyFeedbackButtonStates\.get\(button\)/);
	    assert.match(helperSection, /activeState\.text !== nextCopiedText/);
	    assert.match(helperSection, /copyFeedbackButtonStates\.set\(button, \{ text: nextCopiedText, ariaLabel: nextAriaLabel \}\);/);
	    assert.match(helperSection, /setTextContent\(button, nextCopiedText\);/);
	    assert.match(helperSection, /setAttributeValue\(button, 'aria-label', nextAriaLabel\);/);
	    assert.match(helperSection, /setClassPresence\(button, 'copied', true\);/);
	    assert.doesNotMatch(helperSection, /button\.textContent\s*=/);
	    assert.doesNotMatch(helperSection, /button\.setAttribute\('aria-label'/);
	    assert.doesNotMatch(helperSection, /button\.classList\.(?:add|remove)\('copied'\)/);
	    assert.match(helperSection, /typeof announceStatus === 'function'/);
	    assert.match(helperSection, /resetCopyFeedbackButton\(button\)/);
	    assert.match(helperSection, /copyFeedbackTimers\.delete\(button\)/);
	    assert.match(helperSection, /activeCopyFeedbackButtons\.delete\(button\)/);
	    assert.match(helperSection, /activeCopyFeedbackButtons\.add\(button\)/);
	    assert.match(helperSection, /function closestEventTarget\(event, selector\)/);
	    assert.match(helperSection, /typeof target\.closest === 'function'/);
	    assert.match(mainSource, /clearAllCopyFeedbackTimers\(\);/);
	    assert.match(renderUtilsSource, /showCopyFeedback\(copyBtn,\s*'Copied',\s*'Copy',\s*\{/);
	    assert.match(renderUtilsSource, /ariaLabel:\s*'Copied tool output'/);
			    assert.match(renderUtilsSource, /const original = getCopyFeedbackResetState\(codeCopyBtn\)\.text;/);
		    assert.match(renderUtilsSource, /showCopyFeedback\(codeCopyBtn,\s*'Copied',\s*original,\s*\{/);
		    assert.match(renderUtilsSource, /ariaLabel:\s*'Copied code block'/);
			    assert.match(renderUtilsSource, /const original = getCopyFeedbackResetState\(assistantCopyBtn\)\.text;/);
	    assert.match(renderUtilsSource, /showCopyFeedback\(assistantCopyBtn,\s*'✓',\s*original,\s*\{/);
	    assert.match(renderUtilsSource, /Copied assistant Markdown/);
	  });

	  test('operation summary action accessible name starts with visible label', () => {
	    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
    const operationStart = renderMessagesSource.indexOf("msg.role === 'operation'");
    assert.ok(operationStart >= 0, 'expected operation message renderer');
    const operationEnd = renderMessagesSource.indexOf('} else if (msg.toolCall)', operationStart);
    assert.ok(operationEnd > operationStart, 'expected tool renderer after operation renderer');
    const operationSection = renderMessagesSource.slice(operationStart, operationEnd);
    const statusHelperStart = renderMessagesSource.indexOf('function getOperationStatusLabel');
    assert.ok(statusHelperStart >= 0, 'expected operation status label helper');
    assert.ok(statusHelperStart < operationStart, 'expected operation status helper before message renderer');
    const statusHelperEnd = renderMessagesSource.indexOf('function createMessageElement', statusHelperStart);
    assert.ok(statusHelperEnd > statusHelperStart, 'expected message renderer after operation status helper');
    const statusHelperSection = renderMessagesSource.slice(statusHelperStart, statusHelperEnd);
    const operationActionStart = operationSection.indexOf("summaryBtn.className = 'operation-action-link';");
    assert.ok(operationActionStart >= 0, 'expected compaction summary action');
    const operationActionEnd = operationSection.indexOf('actionsEl.appendChild(summaryBtn);', operationActionStart);
    assert.ok(operationActionEnd > operationActionStart, 'expected complete compaction summary action button');
    const operationButtonSource = operationSection.slice(operationActionStart, operationActionEnd);

    assert.match(statusHelperSection, /switch \(status\)/);
    assert.match(statusHelperSection, /case 'running':[\s\S]*return 'Running';/);
    assert.match(statusHelperSection, /case 'done':[\s\S]*return 'Done';/);
    assert.match(statusHelperSection, /case 'canceled':[\s\S]*return 'Canceled';/);
    assert.match(statusHelperSection, /default:[\s\S]*return 'Failed';/);
    assert.match(operationSection, /const statusLabel = getOperationStatusLabel\(status\);/);
    assert.match(statusHelperSection, /function getOperationStatusClass\(status\)/);
    assert.match(statusHelperSection, /case 'running':[\s\S]*case 'done':[\s\S]*case 'canceled':[\s\S]*return status;/);
    assert.match(statusHelperSection, /default:[\s\S]*return 'error';/);
    assert.match(operationSection, /el\.className = 'operation-card ' \+ getOperationStatusClass\(status\);/);
    assert.doesNotMatch(operationSection, /el\.className = 'operation-card ' \+ status;/);
    assert.match(operationSection, /const startedAt = op\.startedAt \?\? msg\.timestamp \?\? Date\.now\(\);/);
    assert.doesNotMatch(operationSection, /op\.startedAt \|\| msg\.timestamp \|\| Date\.now\(\)/);
    assert.doesNotMatch(operationSection, /status === 'running'[\s\S]*\? 'Running'/);
	    assert.match(operationSection, /const hasSummary = hasNonWhitespaceText\(summaryText\);/);
	    assert.doesNotMatch(operationSection, /summaryText\.trim\(\)/);
	    assert.match(operationSection, /titleEl\.textContent = String\(label\);/);
	    assert.match(operationSection, /detailEl\.textContent = detail;/);
    assert.match(operationButtonSource, /summaryBtn\.type = 'button';/);
    assert.match(operationButtonSource, /summaryBtn\.setAttribute\('aria-label', 'View summary, compaction summary'\);/);
    assert.match(operationButtonSource, /summaryBtn\.textContent = 'View summary';/);
    assert.doesNotMatch(operationSection, /el\.innerHTML\s*=/);
		    assert.doesNotMatch(operationButtonSource, /summaryBtn\.setAttribute\('aria-label', 'View compaction summary'\);/);
		  });

	  test('operation summary click handler caches owning operation lookup', () => {
	    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
	    const handlerStart = renderUtilsSource.indexOf("if (action === 'viewCompactionSummary')");
	    assert.ok(handlerStart >= 0, 'expected compaction summary click handler');
	    const handlerEnd = renderUtilsSource.indexOf("if (action === 'openFullOutput')", handlerStart);
	    assert.ok(handlerEnd > handlerStart, 'expected tool output handler after compaction summary handler');
	    const handlerSection = renderUtilsSource.slice(handlerStart, handlerEnd);
	    const helperStart = renderUtilsSource.indexOf('function getCompactionSummaryMessageElement(actionEl)');
	    assert.ok(helperStart >= 0, 'expected compaction summary owner helper');
	    const helperEnd = renderUtilsSource.indexOf('function getCodeBlockCopyElement', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected code-block helper after compaction summary helper');
	    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);
	    const cachedMessageIndex = helperSection.indexOf('const cachedMessage = getContainedCachedElement(actionEl, compactionSummaryMessageByElement);');
	    const layoutMessageIndex = helperSection.indexOf('const layoutMessage = findCompactionSummaryMessageElementFromLayout(actionEl);');

	    assert.match(renderUtilsSource, /const compactionSummaryMessageByElement = new WeakMap\(\);/);
	    assert.match(renderUtilsSource, /function getCompactionSummaryMessageElement\(actionEl\)/);
	    assert.match(renderUtilsSource, /function findCompactionSummaryMessageElementFromLayout\(actionEl\)/);
	    assert.match(renderUtilsSource, /compactionSummaryMessageByElement\.set\(actionEl, messageEl\);/);
	    assert.ok(cachedMessageIndex >= 0, 'expected compaction summary helper to check the contained cached card first');
	    assert.ok(layoutMessageIndex > cachedMessageIndex, 'expected cached compaction-summary owner lookup before layout traversal');
	    assert.match(helperSection, /if \(cachedMessage\) return cachedMessage;/);
	    assert.match(helperSection, /const layoutMessage = findCompactionSummaryMessageElementFromLayout\(actionEl\);[\s\S]*if \(layoutMessage\) return layoutMessage;/);
	    assert.match(helperSection, /getCachedClosestElement\(actionEl, '\.operation-card', compactionSummaryMessageByElement\)/);
	    assert.match(handlerSection, /const msgEl = getCompactionSummaryMessageElement\(compactionBtn\);/);
	    assert.match(handlerSection, /if \(hasNonWhitespaceText\(summaryText\)\) \{/);
	    assert.doesNotMatch(handlerSection, /compactionBtn\.closest\('\.operation-card'\)/);
	    assert.doesNotMatch(handlerSection, /summaryText\.trim\(\)/);
	  });

			  test('operation render keys store summary presence instead of full summary text', () => {
			    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
		    const renderKeyStart = renderMessagesSource.indexOf('function getMessageRenderKey');
		    assert.ok(renderKeyStart >= 0, 'expected message render key helper');
	    const renderKeyEnd = renderMessagesSource.indexOf('function getOperationStatusLabel', renderKeyStart);
	    assert.ok(renderKeyEnd > renderKeyStart, 'expected operation status helper after render key helper');
	    const renderKeySection = renderMessagesSource.slice(renderKeyStart, renderKeyEnd);

	    assert.match(renderKeySection, /const summaryText = typeof op\.summaryText === 'string' \? op\.summaryText : '';/);
	    assert.match(renderKeySection, /const key = createCompactRenderKeyBuilder\(\);/);
	    assert.match(renderKeySection, /appendCompactRenderKeyPart\(key, hasNonWhitespaceText\(summaryText\) \? '1' : '0'\);/);
		    assert.match(renderKeySection, /return finishCompactRenderKey\(key\);/);
		    assert.doesNotMatch(renderKeySection, /appendRenderKeyPart\(key, typeof op\.summaryText === 'string' \? op\.summaryText : ''\)/);
		    assert.doesNotMatch(renderKeySection, /appendRenderKeyPart\(key, op\.summaryText\)/);
		  });

		  test('message render keys avoid full content in DOM dataset comparisons', () => {
		    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
		    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
		    const compactKeyStart = renderUtilsSource.indexOf('function getCompactRenderDatasetKey');
		    assert.ok(compactKeyStart >= 0, 'expected shared compact dataset render key helper');
		    const compactKeyEnd = renderUtilsSource.indexOf('function rememberOpenLocationPayload', compactKeyStart);
		    assert.ok(compactKeyEnd > compactKeyStart, 'expected open-location helper after compact dataset helper');
		    const compactKeySection = renderUtilsSource.slice(compactKeyStart, compactKeyEnd);
		    const datasetKeyStart = renderMessagesSource.indexOf('function getMessageRenderDatasetKey');
		    assert.ok(datasetKeyStart >= 0, 'expected compact dataset render key helper');
		    const datasetKeyEnd = renderMessagesSource.indexOf('function getStepRenderKey', datasetKeyStart);
		    assert.ok(datasetKeyEnd > datasetKeyStart, 'expected step render key helper after dataset helper');
	    const datasetKeySection = renderMessagesSource.slice(datasetKeyStart, datasetKeyEnd);
	    const messageKeyStart = renderMessagesSource.indexOf('function getMessageRenderKey');
	    assert.ok(messageKeyStart >= 0, 'expected message render key helper');
	    const messageKeyEnd = renderMessagesSource.indexOf('function getOperationStatusLabel', messageKeyStart);
	    assert.ok(messageKeyEnd > messageKeyStart, 'expected operation status helper after message key helper');
	    const messageKeySection = renderMessagesSource.slice(messageKeyStart, messageKeyEnd);
	    const createMessageStart = renderMessagesSource.indexOf('function createMessageElement');
	    assert.ok(createMessageStart >= 0, 'expected message element renderer');
		    const createMessageEnd = renderMessagesSource.indexOf('function getStepBody', createMessageStart);
		    assert.ok(createMessageEnd > createMessageStart, 'expected step body helper after message renderer');
		    const createMessageSection = renderMessagesSource.slice(createMessageStart, createMessageEnd);
		    const updateStart = mainSource.indexOf("case 'updateMessage':");
		    assert.ok(updateStart >= 0, 'expected updateMessage branch');
		    const updateEnd = mainSource.indexOf("case 'processing':", updateStart);
		    assert.ok(updateEnd > updateStart, 'expected processing branch after updateMessage branch');
		    const updateSection = mainSource.slice(updateStart, updateEnd);

	    assert.match(compactKeySection, /Math\.imul\(hash, 16777619\)/);
	    assert.match(compactKeySection, /function createCompactRenderKeyBuilder\(\)/);
	    assert.match(compactKeySection, /function appendCompactRenderKeyPart\(builder, value\)/);
	    assert.match(compactKeySection, /function finishCompactRenderKey\(builder\)/);
	    assert.match(messageKeySection, /const key = createCompactRenderKeyBuilder\(\);/);
	    assert.match(messageKeySection, /appendCompactRenderKeyPart\(key, getMessageTextContent\(msg\.content, ''\)\);/);
	    assert.match(messageKeySection, /return finishCompactRenderKey\(key\);/);
	    assert.doesNotMatch(messageKeySection, /appendRenderKeyPart\(key, getMessageTextContent\(msg\.content, ''\)\)/);
	    assert.doesNotMatch(renderMessagesSource, /function appendRenderKeyPart\(key, value\)/);
	    assert.match(datasetKeySection, /return getCompactRenderDatasetKey\(renderKey\);/);
		    assert.doesNotMatch(datasetKeySection, /Math\.imul\(hash, 16777619\)/);
		    assert.match(createMessageSection, /const datasetRenderKey = getMessageRenderDatasetKey\(renderKey\);/);
		    assert.match(createMessageSection, /el\.dataset\.messageRenderKey = datasetRenderKey;/);
		    assert.doesNotMatch(createMessageSection, /el\.dataset\.messageRenderKey = renderKey;/);
		    assert.match(updateSection, /const previousMessage = messageDataById\.get\(updatedMessage\.id\);/);
		    assert.match(updateSection, /const previousMessageRenderKey =/);
		    assert.match(updateSection, /previousMessageRenderKey === nextMessageRenderKey/);
		    assert.doesNotMatch(updateSection, /msgEl\.dataset\.messageRenderKey === nextMessageRenderKey/);
		  });

		  test('assistant markdown raw cache avoids DOM dataset raw storage', () => {
		    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
		    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');

		    assert.match(renderMessagesSource, /const assistantMarkdownRawByElement = new WeakMap\(\);/);
		    assert.match(renderMessagesSource, /const assistantMarkdownHtmlByElement = new WeakMap\(\);/);
		    assert.match(renderMessagesSource, /function rememberAssistantMarkdownRaw\(contentEl, raw\)/);
		    assert.match(renderMessagesSource, /function getAssistantMarkdownRaw\(contentEl\)/);
		    assert.match(renderMessagesSource, /function isAssistantMarkdownHtmlCurrent\(contentEl, html\)/);
		    assert.match(renderMessagesSource, /function renderAssistantMarkdownInto\(contentEl, raw\)/);
		    assert.match(renderMessagesSource, /const html = renderMarkdown\(text\);/);
		    assert.match(renderMessagesSource, /if \(cached !== undefined\) return cached === html;/);
		    assert.match(renderMessagesSource, /return html === '' && !contentEl\.firstChild;/);
		    assert.match(renderMessagesSource, /if \(isAssistantMarkdownHtmlCurrent\(contentEl, html\)\) \{/);
		    assert.match(renderMessagesSource, /assistantMarkdownHtmlByElement\.set\(contentEl, html\);/);
		    assert.match(renderMessagesSource, /return \{ raw: text, htmlChanged: false \};/);
		    assert.match(renderMessagesSource, /return \{ raw: text, htmlChanged: true \};/);
		    assert.match(renderMessagesSource, /renderAssistantMarkdownInto\(content, raw\);/);
		    assert.match(mainSource, /const renderInfo = renderAssistantMarkdownInto\(contentEl, getAssistantMarkdownRaw\(contentEl\) \+ pending\);/);
		    assert.match(mainSource, /updateAssistantMessageContent\(messageId, renderInfo\.raw\);/);
		    assert.match(renderMessagesSource, /const renderInfo = renderAssistantMarkdownInto\(contentEl, getAssistantMarkdownRaw\(contentEl\) \+ pending\);/);
		    assert.match(renderMessagesSource, /updateAssistantMessageContent\(msg\.id, renderInfo\.raw\);/);
		    assert.match(renderMessagesSource, /let shouldScheduleFileLinkify = true;/);
		    assert.match(renderMessagesSource, /shouldScheduleFileLinkify = renderInfo\.htmlChanged;/);
		    assert.match(renderMessagesSource, /if \(shouldScheduleFileLinkify && el && typeof scheduleFileLinkify === 'function'\) \{/);
		    assert.match(renderUtilsSource, /markdown = typeof getAssistantMarkdownRaw === 'function' \? getAssistantMarkdownRaw\(contentEl\) : '';/);
		    assert.doesNotMatch(renderMessagesSource, /content(?:El)?\.innerHTML = renderMarkdown/);
		    assert.doesNotMatch(mainSource, /contentEl\.innerHTML = renderMarkdown/);
		    assert.doesNotMatch(renderMessagesSource, /dataset\.raw/);
		    assert.doesNotMatch(mainSource, /dataset\.raw/);
		    assert.doesNotMatch(renderUtilsSource, /dataset\.raw/);
		  });

		  test('clipboard fallback cleans up temporary textarea in a finally block', () => {
		    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
    const helperStart = contextSource.indexOf('async function writeClipboard');
    assert.ok(helperStart >= 0, 'expected clipboard helper');
    const helperEnd = contextSource.indexOf('async function writeClipboardHtml', helperStart);
    assert.ok(helperEnd > helperStart, 'expected html clipboard helper after text clipboard helper');
	    const helperSection = contextSource.slice(helperStart, helperEnd);

	    assert.match(helperSection, /if \(text === undefined \|\| text === null\) return false;/);
	    assert.match(helperSection, /const textToCopy = String\(text\);/);
	    assert.match(helperSection, /if \(!textToCopy\) return false;/);
	    assert.match(helperSection, /navigator\.clipboard\.writeText\(textToCopy\)/);
	    assert.match(helperSection, /el\.value = textToCopy;/);
	    assert.doesNotMatch(helperSection, /if \(!text\) return false;/);
	    assert.match(helperSection, /let appended = false;/);
	    assert.match(helperSection, /document\.body\.appendChild\(el\);[\s\S]*appended = true;/);
    assert.match(helperSection, /el\.style\.opacity = '0';/);
    assert.match(helperSection, /el\.style\.pointerEvents = 'none';/);
    assert.match(helperSection, /finally \{[\s\S]*if \(appended\) \{[\s\S]*document\.body\.removeChild\(el\);/);
    assert.doesNotMatch(helperSection, /document\.body\.removeChild\(el\);\s*return !!/);
  });

					  test('output modal copy feedback clears stale reset timer and avoids duplicate writes', () => {
				    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
				    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
				    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
				    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
		    const modalTag = htmlSource.match(/<div\b[^>]*\bid="outputModal"[^>]*>/i)?.[0] || '';
		    const modalBodyTag = htmlSource.match(/<pre\b[^>]*\bid="outputModalBody"[^>]*>/i)?.[0] || '';
		    const stateStart = contextSource.indexOf('function setOutputModalCopyButtonState');
		    assert.ok(stateStart >= 0, 'expected output modal copy state helper');
	    const stateEnd = contextSource.indexOf('function closeOutputModal', stateStart);
	    assert.ok(stateEnd > stateStart, 'expected close helper after output modal copy state helper');
	    const stateSection = contextSource.slice(stateStart, stateEnd);
	    const closeStart = stateEnd;
	    const closeEnd = contextSource.indexOf('function openOutputModal', closeStart);
	    assert.ok(closeEnd > closeStart, 'expected open helper after close helper');
	    const closeSection = contextSource.slice(closeStart, closeEnd);
		    const openStart = closeEnd;
		    const openEnd = contextSource.indexOf('function getToolModalTitle', openStart);
	    assert.ok(openEnd > openStart, 'expected tool modal title helper after open helper');
	    const openSection = contextSource.slice(openStart, openEnd);
	    const outputContainsStart = openSection.indexOf('function elementContainsTarget');
	    assert.ok(outputContainsStart >= 0, 'expected output modal containment helper');
	    const outputContainsEnd = openSection.indexOf('function isOutputModalEventTarget', outputContainsStart);
	    assert.ok(outputContainsEnd > outputContainsStart, 'expected output modal event target helper after containment helper');
	    const outputContainsSection = openSection.slice(outputContainsStart, outputContainsEnd);
	    const helperStart = contextSource.indexOf('function showOutputModalCopyFeedback');
	    assert.ok(helperStart >= 0, 'expected output modal copy feedback helper');
	    const helperEnd = contextSource.indexOf('if (outputModalCopy)', helperStart);
		    assert.ok(helperEnd > helperStart, 'expected helper before output modal copy listener');
		    const helperSection = contextSource.slice(helperStart, helperEnd);
		    const titleWriteIndex = openSection.indexOf('setTextContent(outputModalTitle, outputModalTitleDisplayText);');
		    const bodyWriteIndex = openSection.indexOf('setTextContent(outputModalBody, outputModalText);');
		    const bodyAriaWriteIndex = openSection.indexOf("setAttributeValue(outputModalBody, 'aria-label', outputModalTitleDisplayText + ', full output');");
		    const revealIndex = openSection.indexOf("outputModal.classList.toggle('hidden', false);");

		    assert.match(modalTag, /\brole="dialog"/);
		    assert.match(modalTag, /\baria-modal="true"/);
		    assert.match(modalTag, /\baria-labelledby="outputModalTitle"/);
		    assert.doesNotMatch(modalTag, /\baria-label=/);
		    assert.match(modalBodyTag, /\btabindex="0"/);
		    assert.match(modalBodyTag, /\bdata-scrollable="true"/);
		    assert.match(modalBodyTag, /\baria-label="Full output"/);
		    assert.match(htmlSource, /\.output-modal-body\s*\{[\s\S]*?overscroll-behavior: contain;/);
		    assert.match(htmlSource, /\.output-modal-body:focus-visible\s*\{[\s\S]*?outline: 1px solid var\(--vscode-focusBorder\);/);
			    assert.match(contextSource, /let\s+outputModalCopyResetTimer\s*=\s*null/);
			    assert.match(contextSource, /let\s+outputModalOpen\s*=\s*false/);
			    assert.match(contextSource, /let\s+outputModalFocusReturnTarget\s*=\s*null/);
			    assert.match(contextSource, /let\s+outputModalCopyButtonCopied\s*=\s*null/);
			    assert.match(stateSection, /const copiedFlag = !!copied;/);
			    assert.match(stateSection, /if \(outputModalCopyButtonCopied === copiedFlag\) return;/);
			    assert.match(stateSection, /outputModalCopyButtonCopied = copiedFlag;/);
			    assert.match(stateSection, /setTextContent\(outputModalCopy, copiedFlag \? 'Copied' : 'Copy'\);/);
		    assert.match(stateSection, /function clearOutputModalCopyResetTimer\(\)/);
		    assert.match(stateSection, /clearTimeout\(outputModalCopyResetTimer\);/);
		    assert.match(stateSection, /setAttributeValue\(outputModalCopy, 'aria-label', copiedFlag \? 'Copied full output' : 'Copy full output'\);/);
		    assert.match(stateSection, /setTitle\(outputModalCopy, copiedFlag \? 'Copied full output' : 'Copy full output'\);/);
		    assert.match(closeSection, /const wasOpen = outputModalOpen;/);
				    assert.match(closeSection, /const focusReturnTarget = outputModalFocusReturnTarget;/);
			    assert.match(closeSection, /outputModalFocusReturnTarget = null;/);
				    assert.match(closeSection, /clearOutputModalCopyResetTimer\(\);/);
				    assert.match(closeSection, /setOutputModalCopyButtonState\(false\);/);
				    assert.match(closeSection, /if \(!wasOpen\) return;/);
				    assert.match(closeSection, /if \(outputModal\.classList\) \{[\s\S]*outputModal\.classList\.toggle\('hidden', true\);[\s\S]*\}/);
				    assert.match(closeSection, /outputModalOpen = false;/);
				    assert.match(closeSection, /setTitle\(outputModalTitle, ''\);/);
				    assert.match(closeSection, /setAttributeValue\(outputModalBody, 'aria-label', 'Full output'\);/);
				    assert.match(closeSection, /focusReturnTarget && typeof focusReturnTarget\.focus === 'function'/);
				    assert.match(closeSection, /focusPopoverTarget\(focusReturnTarget\);/);
			    assert.match(contextSource, /const OUTPUT_MODAL_TITLE_DISPLAY_LIMIT = 160;/);
			    assert.match(contextSource, /function getOutputModalTitleDisplayText\(title\)/);
			    assert.match(openSection, /const outputModalTitleDisplayText = getOutputModalTitleDisplayText\(nextTitleText\);/);
			    assert.match(openSection, /setTextContent\(outputModalTitle, outputModalTitleDisplayText\);/);
			    assert.match(openSection, /setTitle\(outputModalTitle, outputModalTitleDisplayText\);/);
				    assert.match(openSection, /setTextContent\(outputModalBody, outputModalText\);/);
				    assert.match(openSection, /setAttributeValue\(outputModalBody, 'aria-label', outputModalTitleDisplayText \+ ', full output'\);/);
				    assert.match(contextSource, /value\.length <= OUTPUT_MODAL_TITLE_DISPLAY_LIMIT/);
				    assert.match(contextSource, /value\.slice\(0, OUTPUT_MODAL_TITLE_DISPLAY_LIMIT\) \+ '…'/);
					    assert.match(openSection, /const nextTitleText = String\(title \|\| 'Output'\);/);
					    assert.match(openSection, /const nextModalText = String\(text === undefined \|\| text === null \? '' : text\);/);
					    assert.match(openSection, /const wasOpen = outputModalOpen;/);
					    assert.match(openSection, /if \(wasOpen && nextTitleText === outputModalTitleText && nextModalText === outputModalText\) return;/);
				    assert.match(openSection, /if \(wasOpen\) \{[\s\S]*clearOutputModalCopyResetTimer\(\);[\s\S]*setOutputModalCopyButtonState\(false\);[\s\S]*\}/);
					    assert.match(openSection, /outputModalText = nextModalText;/);
				    assert.doesNotMatch(openSection, /outputModalText = String\(text \|\| ''\);/);
			    assert.match(openSection, /if \(!wasOpen\) \{/);
			    assert.match(openSection, /const activeElement = document\.activeElement;/);
			    assert.match(openSection, /outputModalFocusReturnTarget =[\s\S]*activeElement[\s\S]*typeof activeElement\.focus === 'function'/);
				    assert.match(openSection, /if \(!wasOpen\) \{[\s\S]*if \(outputModal\.classList\) \{[\s\S]*outputModal\.classList\.toggle\('hidden', false\);[\s\S]*\}[\s\S]*outputModalOpen = true;[\s\S]*\}/);
				    assert.doesNotMatch(closeSection + openSection, /setHidden\(outputModal/);
			    assert.match(openSection, /focusPopoverTarget\(outputModalClose \|\| outputModalCopy \|\| outputModal\);/);
			    assert.match(openSection, /focusPopoverTarget\(nextFocusable\);/);
			    assert.match(openSection, /function isOutputModalOpen\(\)/);
			    assert.match(openSection, /return !!outputModal && outputModalOpen;/);
			    assert.match(openSection, /function isNodeEventTarget\(target\)/);
			    assert.match(openSection, /if \(typeof Node === 'function'\) return target instanceof Node;/);
			    assert.match(openSection, /return typeof target\.nodeType === 'number';/);
			    assert.match(openSection, /function elementContainsTarget\(element, target\)/);
			    assert.match(openSection, /if \(element === target\) return true;/);
			    assert.match(openSection, /if \(!isNodeEventTarget\(target\)\) return false;/);
			    assert.match(openSection, /if \(typeof element\.contains !== 'function'\) return false;/);
			    assert.doesNotMatch(outputContainsSection, /catch \{/);
			    assert.match(openSection, /function isOutputModalEventTarget\(target\)/);
			    assert.match(openSection, /return elementContainsTarget\(outputModal, target\);/);
			    assert.match(openSection, /function isInsideOpenOutputModal\(target\)/);
			    assert.match(openSection, /function consumeHandledEvent\(event, preventDefault\)/);
			    assert.match(openSection, /function isOutputModalFocusableControl\(el\)/);
				    assert.match(openSection, /function getFirstOutputModalFocusableControl\(\)/);
				    assert.match(openSection, /function getLastOutputModalFocusableControl\(\)/);
				    assert.match(openSection, /if \(isOutputModalFocusableControl\(outputModalCopy\)\) return outputModalCopy;/);
				    assert.match(openSection, /if \(isOutputModalFocusableControl\(outputModalClose\)\) return outputModalClose;/);
				    assert.match(openSection, /if \(isOutputModalFocusableControl\(outputModalBody\)\) return outputModalBody;/);
				    assert.match(openSection, /function getNextOutputModalFocusableControl\(activeElement, reverse\)/);
				    assert.match(openSection, /const bodyFocusable = isOutputModalFocusableControl\(outputModalBody\);/);
				    assert.doesNotMatch(openSection, /outputModal\.querySelectorAll/);
				    assert.doesNotMatch(openSection, /const focusable = \[\]/);
				    assert.match(openSection, /function handleOutputModalTabKey\(event\)/);
				    assert.match(openSection, /event\.key !== 'Tab'/);
				    assert.match(openSection, /event\.preventDefault\(\)/);
				    assert.match(openSection, /const nextFocusable = getNextOutputModalFocusableControl\(activeElement, !!event\.shiftKey\)/);
				    assert.match(openSection, /focusPopoverTarget\(nextFocusable\);/);
				    assert.doesNotMatch(openSection, /\.indexOf\(activeElement\)/);
			    assert.match(contextSource, /if \(handleOutputModalTabKey\(e\)\) return;/);
			    assert.match(contextSource, /if \(isInsideOpenOutputModal\(target\)\) return;/);
			    assert.match(contextSource, /if \(isOutputModalOpen\(\)\) \{[\s\S]*closeOutputModal\(\);[\s\S]*consumeHandledEvent\(e, true\);[\s\S]*return;/);
			    assert.match(contextSource, /outputModal\.addEventListener\('click', \(e\) => \{[\s\S]*e\.stopPropagation\(\);/);
			    assert.match(contextSource, /outputModalBackdrop\.addEventListener\('click', \(e\) => \{[\s\S]*consumeHandledEvent\(e, true\);[\s\S]*closeOutputModal\(\);/);
			    assert.match(contextSource, /outputModalClose\.addEventListener\('click', \(e\) => \{[\s\S]*consumeHandledEvent\(e, true\);[\s\S]*closeOutputModal\(\);/);
			    assert.match(bootstrapSource, /outputModal &&[\s\S]*!outputModal\.classList\.contains\('hidden'\)[\s\S]*elementContainsEventTarget\(outputModal, target\)[\s\S]*return;/);
			    assert.ok(
			      titleWriteIndex >= 0 &&
			        bodyWriteIndex > titleWriteIndex &&
			        bodyAriaWriteIndex > titleWriteIndex &&
			        revealIndex > bodyWriteIndex &&
			        revealIndex > bodyAriaWriteIndex,
			      'modal title, accessible body label, and body should be written before reveal'
			    );
			    assert.match(helperSection, /clearOutputModalCopyResetTimer\(\);/);
		    assert.match(helperSection, /setOutputModalCopyButtonState\(true\);/);
	    assert.match(helperSection, /setOutputModalCopyButtonState\(false\);/);
	    assert.match(helperSection, /outputModalCopyResetTimer\s*=\s*setTimeout/);
	    assert.match(helperSection, /outputModalCopyResetTimer\s*=\s*null/);
	    assert.doesNotMatch(stateSection + closeSection + helperSection, /outputModalCopy\.textContent\s*=/);
	    assert.doesNotMatch(stateSection + closeSection + helperSection, /outputModalCopy\.setAttribute\('aria-label'/);
			    assert.doesNotMatch(closeSection, /outputModal\.classList\.add\('hidden'\)/);
			    assert.doesNotMatch(closeSection + helperSection, /clearTimeout\(outputModalCopyResetTimer\)/);
			    assert.match(mainSource, /clearOutputModalCopyResetTimer\(\);/);
			  });

  test('invalid field feedback avoids duplicate validity, aria, and title writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const helperStart = bootstrapSource.indexOf('function markInvalidField');
	    assert.ok(helperStart >= 0, 'expected invalid field helper');
	    const helperEnd = bootstrapSource.indexOf('function clearInvalidFields', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected clearInvalidFields helper after invalid field helper');
	    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
	    const clearEnd = bootstrapSource.indexOf('function validateNumberField', helperEnd);
	    assert.ok(clearEnd > helperEnd, 'expected number field validator after invalid field clearer');
	    const clearSection = bootstrapSource.slice(helperEnd, clearEnd);
	    const fallbackStart = helperSection.indexOf('} catch {');
	    assert.ok(fallbackStart > 0, 'expected fallback catch in invalid field helper');
	    const mainSection = helperSection.slice(0, fallbackStart);

    assert.match(bootstrapSource, /const\s+invalidFieldStateByElement\s*=\s*new WeakMap\(\);/);
    assert.match(helperSection, /const previousState = invalidFieldStateByElement\.get\(el\) \|\| null;/);
    assert.match(helperSection, /if \(!hasMessage && !previousState\) return;/);
    assert.match(helperSection, /el\.setCustomValidity\(nextMessage\);/);
    assert.match(helperSection, /setAttributeValue\(el, 'aria-invalid', hasMessage \? 'true' : 'false'\);/);
    assert.match(helperSection, /const previousTitle = previousState \? previousState\.previousTitle : \(el\.getAttribute \? el\.getAttribute\('title'\) \|\| '' : ''\);/);
    assert.match(helperSection, /invalidFieldStateByElement\.set\(el, \{ previousTitle \}\);/);
    assert.match(helperSection, /setTitle\(el, nextMessage\);/);
	    assert.match(helperSection, /invalidFieldStateByElement\.delete\(el\);/);
	    assert.match(helperSection, /setTitle\(el, previousTitle\);/);
    assert.doesNotMatch(helperSection, /data-lingyun-valid-/);
		    assert.doesNotMatch(helperSection, /INVALID_FIELD_MESSAGE_ATTR/);
			    assert.match(clearSection, /if \(!Array\.isArray\(fields\)\) return;/);
		    assert.match(clearSection, /for \(let fieldIndex = 0; fieldIndex < fields\.length; fieldIndex\+\+\)/);
		    assert.match(clearSection, /const field = fields\[fieldIndex\];/);
		    assert.match(clearSection, /markInvalidField\(field, ''\);/);
		    assert.doesNotMatch(helperSection, /el\.setAttribute\('aria-invalid'/);
		    assert.doesNotMatch(mainSection, /el\.title\s*=/);
		    assert.doesNotMatch(clearSection, /forEach/);
		    assert.doesNotMatch(clearSection, /for \(const field of fields\)/);
	    assert.doesNotMatch(clearSection, /Array\.isArray\(fields\) \? fields : \[\]/);
	  });

	  test('context and todo indicator updates avoid duplicate DOM writes', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const contextStart = contextSource.indexOf('function updateContextIndicatorState');
	    assert.ok(contextStart >= 0, 'expected context indicator update helper');
	    const contextEnd = contextSource.indexOf('function renderTodoPopover', contextStart);
	    assert.ok(contextEnd > contextStart, 'expected todo popover renderer after context indicator helper');
	    const contextSection = contextSource.slice(contextStart, contextEnd);
	    const todoStart = contextSource.indexOf('function updateTodoIndicatorState');
	    assert.ok(todoStart >= 0, 'expected todo indicator update helper');
	    const todoEnd = contextSource.indexOf('function openTodoPopover', todoStart);
	    assert.ok(todoEnd > todoStart, 'expected todo popover opener after todo indicator helper');
	    const todoSection = contextSource.slice(todoStart, todoEnd);
	    const contextCaseStart = mainSource.indexOf("case 'context':");
	    assert.ok(contextCaseStart >= 0, 'expected context message branch');
	    const contextCaseEnd = mainSource.indexOf("case 'todos':", contextCaseStart);
	    assert.ok(contextCaseEnd > contextCaseStart, 'expected todos branch after context branch');
	    const contextCaseSection = mainSource.slice(contextCaseStart, contextCaseEnd);
	    const todosCaseEnd = mainSource.indexOf("case 'sessions':", contextCaseEnd);
	    assert.ok(todosCaseEnd > contextCaseEnd, 'expected sessions branch after todos branch');
	    const todosCaseSection = mainSource.slice(contextCaseEnd, todosCaseEnd);

	    assert.match(contextSource, /let\s+contextIndicatorStateKey\s*=\s*''/);
	    assert.match(contextSource, /let\s+todoIndicatorStateKey\s*=\s*''/);
	    assert.match(contextSource, /let\s+contextIndicatorVisible\s*=\s*false/);
	    assert.match(contextSource, /let\s+todoIndicatorVisible\s*=\s*false/);
	    assert.match(contextSource, /const COMPACT_NUMBER_DECIMAL_ZERO_SUFFIX_RE = \/\\\.0\$\/;/);
	    assert.match(contextSource, /replace\(COMPACT_NUMBER_DECIMAL_ZERO_SUFFIX_RE, ''\) \+ 'k'/);
	    assert.match(contextSource, /replace\(COMPACT_NUMBER_DECIMAL_ZERO_SUFFIX_RE, ''\) \+ 'm'/);
	    const compactStart = contextSource.indexOf('function formatCompact');
	    assert.ok(compactStart >= 0, 'expected compact number formatter');
	    const compactEnd = contextSource.indexOf('let contextPopoverFocusReturnTarget', compactStart);
	    assert.ok(compactEnd > compactStart, 'expected context popover state after compact formatter');
	    const compactSection = contextSource.slice(compactStart, compactEnd);
	    assert.doesNotMatch(compactSection, /\.replace\(\//);
	    assert.match(compactSection, /function setContextIndicatorVisible\(visible\)/);
	    assert.match(compactSection, /if \(contextIndicatorVisible === visibleFlag\) return;/);
	    assert.match(compactSection, /contextIndicator\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.match(compactSection, /function setTodoIndicatorVisible\(visible\)/);
	    assert.match(compactSection, /if \(todoIndicatorVisible === visibleFlag\) return;/);
	    assert.match(compactSection, /todoIndicator\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.doesNotMatch(compactSection, /setHidden\((?:contextIndicator|todoIndicator)/);
		    assert.match(contextSource, /function isContextIndicatorRenderKeyCurrent\(renderKey\)/);
		    assert.match(contextSource, /return renderKey === contextIndicatorStateKey;/);
		    assert.match(contextSource, /function isContextIndicatorStateCurrent\(ctx\)/);
		    assert.match(contextSource, /return isContextIndicatorRenderKeyCurrent\(getContextPopoverRenderKey\(ctx\)\);/);
	    assert.match(contextSource, /function getTodoRenderState\(todos\)/);
	    assert.match(contextSource, /function isTodoIndicatorStateCurrent\(todosOrRenderState\)/);
	    assert.match(contextSource, /const renderState = normalizeTodoRenderState\(todosOrRenderState\);/);
	    assert.match(contextSource, /return renderState\.key === todoIndicatorStateKey;/);
			    assert.match(contextSection, /const nextStateKey = typeof renderKey === 'string' && renderKey \? renderKey : getContextPopoverRenderKey\(latestContext\);/);
			    assert.match(contextSection, /if \(nextStateKey === contextIndicatorStateKey\) \{/);
			    assert.match(contextSection, /renderContextPopover\(latestContext, nextStateKey\);/);
			    assert.match(contextSection, /contextIndicatorStateKey = nextStateKey;/);
		    assert.ok(
		      contextSection.indexOf('if (nextStateKey === contextIndicatorStateKey)') <
		        contextSection.indexOf('const total = ctx && typeof ctx.totalTokens'),
		      'expected duplicate context indicator state to return before formatting and DOM helper reads'
		    );
		    assert.match(contextSection, /setTextContent\(contextIndicator, label\);/);
	    assert.match(contextSection, /setContextIndicatorVisible\(true\);/);
	    assert.match(contextSection, /setClassPresence\(contextIndicator, 'danger', isDanger\);/);
	    assert.match(contextSection, /setClassPresence\(contextIndicator, 'warn', isWarn\);/);
	    assert.match(contextSection, /title \+= '\\nInput: ' \+ formatInt\(input \|\| 0\) \+ ' {2}Output: ' \+ formatInt\(output \|\| 0\);/);
	    assert.match(contextSection, /title \+= '\\nOpen for memory recall and compaction controls\.';/);
	    assert.match(contextSection, /setTitle\(contextIndicator, title\);/);
	    assert.match(contextSection, /setAttributeValue\(contextIndicator, 'aria-label', label \+ ', context usage'\);/);
		    assert.match(contextCaseSection, /const nextContextRenderKey = typeof getContextPopoverRenderKey === 'function'/);
		    assert.match(contextCaseSection, /getContextPopoverRenderKey\(data\.context\)/);
		    assert.strictEqual(
		      (contextCaseSection.match(/getContextPopoverRenderKey\(data\.context\)/g) || []).length,
		      1,
		      'expected context branch to build the render key once'
		    );
		    assert.match(contextCaseSection, /isContextIndicatorRenderKeyCurrent\(nextContextRenderKey\)/);
		    assert.ok(
		      contextCaseSection.indexOf('isContextIndicatorRenderKeyCurrent(nextContextRenderKey)') <
		        contextCaseSection.indexOf('updateContextIndicatorState(data.context, nextContextRenderKey)'),
		      'expected duplicate context guard before indicator update'
		    );
		    assert.match(contextCaseSection, /updateContextIndicatorState\(data\.context, nextContextRenderKey\);/);
	    assert.doesNotMatch(contextSection, /const lines = \[\]/);
	    assert.doesNotMatch(contextSection, /lines\.push/);
	    assert.doesNotMatch(contextSection, /lines\.join/);
	    assert.doesNotMatch(contextSection, /contextIndicator\.textContent\s*=/);
	    assert.doesNotMatch(contextSection, /contextIndicator\.title\s*=/);
	    assert.doesNotMatch(contextSection, /contextIndicator\.classList\.(?:add|remove)\(/);
	    assert.match(todoSection, /setTextContent\(todoIndicator, ''\);/);
	    assert.match(todoSection, /const todoRenderState = renderState && typeof renderState\.key === 'string'/);
	    assert.match(todoSection, /: getTodoRenderState\(latestTodos\);/);
		    assert.match(todoSection, /const nextStateKey = todoRenderState\.key;/);
		    assert.match(todoSection, /if \(nextStateKey === todoIndicatorStateKey\) \{/);
		    assert.match(todoSection, /renderTodoPopover\(latestTodos, todoRenderState\);/);
		    assert.match(todoSection, /closeTodoPopover\(\);/);
		    assert.match(todoSection, /todoIndicatorStateKey = nextStateKey;/);
		    assert.ok(
		      todoSection.indexOf('if (nextStateKey === todoIndicatorStateKey)') <
		        todoSection.indexOf('const totalCount = typeof todoRenderState.total'),
		      'expected duplicate todo indicator state to return before DOM helper reads'
		    );
		    assert.match(todoSection, /setTodoIndicatorVisible\(false\);/);
	    assert.match(todoSection, /setTodoIndicatorVisible\(true\);/);
	    assert.match(todoSection, /setAttributeValue\(todoIndicator, 'aria-label', 'Todo list'\);/);
	    assert.match(todoSection, /const totalCount = typeof todoRenderState\.total === 'number' \? todoRenderState\.total : 0;/);
	    assert.match(todoSection, /if \(!totalCount\) \{/);
	    assert.match(todoSection, /const openCount = typeof todoRenderState\.open === 'number' \? todoRenderState\.open : 0;/);
	    assert.match(todoSection, /const label = 'Todo · ' \+ formatCompact\(openCount\);/);
	    assert.match(todoSection, /setTextContent\(todoIndicator, label\);/);
	    assert.match(todoSection, /setAttributeValue\(todoIndicator, 'aria-label', label \+ ', todo list'\);/);
	    assert.match(todoSection, /renderTodoPopover\(latestTodos, todoRenderState\);/);
	    assert.match(todosCaseSection, /const nextTodoRenderState = typeof getTodoRenderState === 'function'/);
	    assert.match(todosCaseSection, /getTodoRenderState\(data\.todos\)/);
	    assert.match(todosCaseSection, /isTodoIndicatorStateCurrent\(nextTodoRenderState\)/);
	    assert.match(todosCaseSection, /updateTodoIndicatorState\(data\.todos, nextTodoRenderState\)/);
	    assert.ok(
	      todosCaseSection.indexOf('getTodoRenderState(data.todos)') <
	        todosCaseSection.indexOf('isTodoIndicatorStateCurrent(nextTodoRenderState)'),
	      'expected todo render state before duplicate guard'
	    );
	    assert.ok(
	      todosCaseSection.indexOf('isTodoIndicatorStateCurrent(nextTodoRenderState)') <
	        todosCaseSection.indexOf('updateTodoIndicatorState(data.todos, nextTodoRenderState)'),
	      'expected duplicate todos guard before indicator update'
	    );
	    assert.doesNotMatch(todoSection, /todoIndicator\.textContent\s*=/);
	    assert.doesNotMatch(todoSection, /todoIndicator\.classList\.(?:add|remove)\(/);
	  });

	  test('context and todo popovers skip duplicate body rebuilds', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const contextKeyStart = contextSource.indexOf('function getContextPopoverRenderKey');
    assert.ok(contextKeyStart >= 0, 'expected context popover render key helper');
    const todoStatusStart = contextSource.indexOf('function normalizeTodoStatus', contextKeyStart);
    assert.ok(todoStatusStart > contextKeyStart, 'expected todo normalization helper after context render key helper');
    const keySection = contextSource.slice(contextKeyStart, todoStatusStart);

    const contextStart = contextSource.indexOf('function renderContextPopover');
    assert.ok(contextStart >= 0, 'expected context popover renderer');
    const contextEnd = contextSource.indexOf('function updateContextIndicatorState', contextStart);
    assert.ok(contextEnd > contextStart, 'expected context indicator helper after context renderer');
    const contextSection = contextSource.slice(contextStart, contextEnd);

    const todoKeyStart = contextSource.indexOf('function getTodoRenderContent');
    assert.ok(todoKeyStart >= 0, 'expected todo renderable-content helper');
    const sessionStart = contextSource.indexOf('function updateSessionSelect', todoKeyStart);
    assert.ok(sessionStart > todoKeyStart, 'expected session select helper after todo render key helper');
    const todoKeySection = contextSource.slice(todoKeyStart, sessionStart);

    const todoEmptyStart = contextSource.indexOf('function renderEmptyTodoPopover');
    assert.ok(todoEmptyStart >= 0, 'expected todo empty-state renderer');
    const todoStart = contextSource.indexOf('function renderTodoPopover', todoEmptyStart);
    assert.ok(todoStart >= 0, 'expected todo popover renderer');
    const todoEnd = contextSource.indexOf('function updateTodoIndicatorState', todoStart);
    assert.ok(todoEnd > todoStart, 'expected todo indicator helper after todo renderer');
    const todoEmptySection = contextSource.slice(todoEmptyStart, todoStart);
    const todoSection = contextSource.slice(todoStart, todoEnd);

	    assert.match(contextSource, /let\s+contextPopoverRenderKey\s*=\s*''/);
	    assert.match(contextSource, /let\s+todoPopoverRenderKey\s*=\s*null/);
	    assert.doesNotMatch(contextSource, /let\s+todoPopoverRenderKey\s*=\s*''/);
	    assert.doesNotMatch(contextSource, /function\s+appendPopoverRenderKeyPart\(key, value\)/);
	    assert.doesNotMatch(contextSource, /function\s+replaceElementChildren\(element, child\)/);
	    assert.match(bootstrapSource, /function\s+replaceElementChildren\(element, child\)/);
	    assert.match(bootstrapSource, /typeof element\.replaceChildren === 'function'/);
    assert.match(keySection, /const key = createCompactRenderKeyBuilder\(\);/);
    assert.match(keySection, /appendCompactContextRenderKeyPart\(key, ctx && typeof ctx\.totalTokens === 'number' \? ctx\.totalTokens : ''\)/);
    assert.match(keySection, /appendCompactContextRenderKeyPart\(key, ctx && typeof ctx\.cacheWriteTokens === 'number' \? ctx\.cacheWriteTokens : ''\)/);
    assert.match(keySection, /return finishCompactRenderKey\(key\);/);
    assert.doesNotMatch(keySection, /appendPopoverRenderKeyPart\(key,/);
	    assert.match(contextSection, /function renderContextPopover\(ctx, renderKey\)/);
	    assert.match(contextSection, /const nextRenderKey = typeof renderKey === 'string' && renderKey \? renderKey : getContextPopoverRenderKey\(ctx\);/);
	    assert.match(contextSection, /if \(nextRenderKey === contextPopoverRenderKey\) return;/);
	    assert.match(contextSection, /contextPopoverRenderKey = nextRenderKey;/);
	    assert.match(contextSection, /let fragment = null;/);
	    assert.match(contextSection, /let singleContextNode = null;/);
	    assert.match(contextSection, /const appendContextNode = \(node\) => \{/);
	    assert.match(contextSection, /fragment = document\.createDocumentFragment\(\);[\s\S]*fragment\.appendChild\(singleContextNode\);[\s\S]*fragment\.appendChild\(node\);[\s\S]*singleContextNode = null;/);
	    assert.match(contextSection, /appendContextNode\(row\);/);
	    assert.match(contextSection, /appendContextNode\(div\);/);
	    assert.match(contextSection, /replaceElementChildren\(contextPopoverBody, fragment \|\| singleContextNode\);/);
	    assert.doesNotMatch(contextSection, /const fragment = document\.createDocumentFragment\(\);/);
	    assert.doesNotMatch(contextSection, /contextPopoverBody\.innerHTML = '';/);
	    assert.ok(
	      contextSource.includes('const TODO_CONTENT_BOUNDARY_WHITESPACE_RE = /^\\s|\\s$/;'),
	      'expected todo content to detect boundary whitespace before trimming'
	    );
	    assert.ok(
	      contextSource.includes('const TODO_POPOVER_RENDER_LIMIT = 100;'),
	      'expected todo popover rendering to cap large lists'
	    );
	    assert.ok(
	      contextSource.includes('const TODO_CONTENT_DISPLAY_LIMIT = 240;'),
	      'expected long todo row content to be capped for display'
	    );
    assert.match(todoKeySection, /function getTodoRenderContent\(todo\)/);
    assert.match(todoKeySection, /if \(!content\) return '';/);
    assert.match(todoKeySection, /TODO_CONTENT_BOUNDARY_WHITESPACE_RE\.test\(content\) \? content\.trim\(\) : content/);
    assert.match(todoKeySection, /function getTodoDisplayContent\(content\)/);
    assert.match(todoKeySection, /text\.length <= TODO_CONTENT_DISPLAY_LIMIT/);
    assert.doesNotMatch(todoKeySection, /return content\.trim\(\);/);
	    assert.match(todoKeySection, /function getTodoRenderState\(todos\)/);
	    assert.match(todoKeySection, /const key = createCompactRenderKeyBuilder\(\);/);
	    assert.match(todoKeySection, /let open = 0;/);
	    assert.match(todoKeySection, /let total = 0;/);
	    assert.doesNotMatch(todoKeySection, /appendPopoverRenderKeyPart\(key, list\.length\)/);
	    assert.match(todoKeySection, /for \(let todoIndex = 0; todoIndex < list\.length; todoIndex\+\+\)/);
	    assert.match(todoKeySection, /const todo = list\[todoIndex\];/);
	    assert.doesNotMatch(todoKeySection, /for \(const todo of list\)/);
	    assert.match(todoKeySection, /const content = getTodoRenderContent\(todo\);/);
	    assert.match(todoKeySection, /if \(!content\) continue;/);
	    assert.match(todoKeySection, /total\+\+;/);
		    assert.match(todoKeySection, /if \(status !== 'completed' && status !== 'cancelled'\) open\+\+;/);
	    assert.match(todoKeySection, /appendCompactContextRenderKeyPart\(key, content\);/);
	    assert.doesNotMatch(todoKeySection, /appendPopoverRenderKeyPart\(key, content\)/);
	    assert.match(todoKeySection, /return \{ key: finishCompactRenderKey\(key\), open, total \};/);
    assert.match(todoKeySection, /normalizeTodoStatus\(typeof todo\.status === 'string' \? todo\.status : 'pending'\)/);
    assert.match(todoKeySection, /normalizeTodoPriority\(typeof todo\.priority === 'string' \? todo\.priority : 'medium'\)/);
    assert.match(todoSection, /function renderTodoPopover\(todos, renderState\)/);
    assert.match(todoSection, /const todoRenderState = renderState && typeof renderState\.key === 'string'/);
    assert.match(todoSection, /: getTodoRenderState\(todos\);/);
    assert.match(todoSection, /const nextRenderKey = todoRenderState\.key;/);
    assert.match(todoSection, /if \(nextRenderKey === todoPopoverRenderKey\) return;/);
    assert.match(todoSection, /todoPopoverRenderKey = nextRenderKey;/);
    assert.match(todoEmptySection, /setAttributeValue\(todoPopoverBody, 'role', 'note'\);/);
    assert.match(todoEmptySection, /replaceElementChildren\(todoPopoverBody, emptyEl\);/);
	    assert.match(todoSection, /renderEmptyTodoPopover\(\);/);
	    assert.match(todoSection, /setAttributeValue\(todoPopoverBody, 'role', 'list'\);/);
		    assert.match(todoSection, /const totalFromState =/);
		    assert.match(todoSection, /let fragment = null;/);
		    assert.match(todoSection, /let singleTodoRow = null;/);
		    assert.match(todoSection, /let renderedCount = 0;/);
		    assert.match(todoSection, /let scannedRenderableCount = 0;/);
	    assert.match(todoSection, /for \(let todoIndex = 0; todoIndex < list\.length; todoIndex\+\+\)/);
	    assert.match(todoSection, /const t = list\[todoIndex\];/);
	    assert.doesNotMatch(todoSection, /for \(const t of list\)/);
	    assert.match(todoSection, /const content = getTodoRenderContent\(t\);/);
	    assert.match(todoSection, /if \(!content\) continue;/);
	    assert.match(todoSection, /scannedRenderableCount\+\+;/);
	    assert.match(todoSection, /if \(renderedCount >= TODO_POPOVER_RENDER_LIMIT\) \{/);
	    assert.match(todoSection, /renderedCount\+\+;/);
	    assert.match(todoSection, /if \(!totalRenderableCount\) \{/);
	    assert.match(todoSection, /row\.setAttribute\('role', 'listitem'\);/);
	    assert.match(todoSection, /icon\.setAttribute\('aria-hidden', 'true'\);/);
	    assert.match(todoSection, /body\.textContent = getTodoDisplayContent\(content\);/);
	    assert.doesNotMatch(todoSection, /body\.textContent = content;/);
	    assert.match(todoSection, /else if \(singleTodoRow\) \{[\s\S]*fragment = document\.createDocumentFragment\(\);[\s\S]*fragment\.appendChild\(singleTodoRow\);[\s\S]*fragment\.appendChild\(row\);[\s\S]*singleTodoRow = null;[\s\S]*\}/);
	    assert.match(todoSection, /overflow\.className = 'todo-popover-overflow';/);
	    assert.match(todoSection, /overflow\.setAttribute\('role', 'listitem'\);/);
	    assert.match(todoSection, /if \(!fragment\) \{[\s\S]*fragment = document\.createDocumentFragment\(\);[\s\S]*if \(singleTodoRow\) \{[\s\S]*fragment\.appendChild\(singleTodoRow\);[\s\S]*singleTodoRow = null;[\s\S]*\}/);
	    assert.match(todoSection, /replaceElementChildren\(todoPopoverBody, fragment \|\| singleTodoRow\);/);
	    assert.doesNotMatch(todoSection, /const fragment = document\.createDocumentFragment\(\);/);
	    assert.doesNotMatch(todoSection, /todoPopoverBody\.innerHTML = '';/);
  });

	  test('context and todo popover visibility updates are idempotent', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const closeContextStart = contextSource.indexOf('function closeContextPopover');
    assert.ok(closeContextStart >= 0, 'expected context popover close helper');
    const outputStart = contextSource.indexOf('let outputModalText', closeContextStart);
    assert.ok(outputStart > closeContextStart, 'expected output modal state after popover close helpers');
    const closeSection = contextSource.slice(closeContextStart, outputStart);

    const openTodoStart = contextSource.indexOf('function openTodoPopover');
    assert.ok(openTodoStart >= 0, 'expected todo popover open helper');
    const openContextEnd = contextSource.indexOf('function toggleContextPopover', openTodoStart);
    assert.ok(openContextEnd > openTodoStart, 'expected context popover toggle helper after open helper');
    const openSection = contextSource.slice(openTodoStart, openContextEnd);
    const popoverStateStart = contextSource.indexOf('function setPopoverOpenState');
    assert.ok(popoverStateStart >= 0, 'expected popover state helper');
    const popoverStateEnd = contextSource.indexOf('function canFocusPopoverTarget', popoverStateStart);
    assert.ok(popoverStateEnd > popoverStateStart, 'expected focus helper after popover state helper');
    const popoverStateSection = contextSource.slice(popoverStateStart, popoverStateEnd);

	    assert.match(closeSection, /setAttributeValue\(contextIndicator, 'aria-expanded', 'false'\);/);
	    assert.match(closeSection, /setAttributeValue\(todoIndicator, 'aria-expanded', 'false'\);/);
	    assert.match(contextSource, /const\s+popoverOpenStates\s*=\s*new WeakMap\(\);/);
	    assert.match(contextSource, /if \(contextPopover\) popoverOpenStates\.set\(contextPopover, false\);/);
	    assert.match(contextSource, /if \(todoPopover\) popoverOpenStates\.set\(todoPopover, false\);/);
	    assert.match(contextSource, /function\s+isPopoverOpen\(popover\)/);
	    assert.match(contextSource, /popoverOpenStates\.get\(popover\)/);
	    assert.match(contextSource, /popoverOpenStates\.set\(popover, open\)/);
	    assert.match(contextSource, /function\s+setPopoverOpenState\(popover, open\)/);
	    assert.match(popoverStateSection, /const nextOpen = !!open;/);
	    assert.match(popoverStateSection, /popover\.classList\.toggle\('hidden', !nextOpen\);/);
	    assert.match(popoverStateSection, /popoverOpenStates\.set\(popover, nextOpen\);/);
	    assert.doesNotMatch(popoverStateSection, /classList\.contains\('hidden'\)/);
	    assert.match(closeSection, /const wasOpen = isPopoverOpen\(contextPopover\);/);
	    assert.match(closeSection, /const wasOpen = isPopoverOpen\(todoPopover\);/);
	    assert.match(closeSection, /if \(!wasOpen\) return;/);
	    assert.ok(
	      closeSection.indexOf('if (!wasOpen) return;') < closeSection.indexOf('setPopoverOpenState(contextPopover, false);'),
	      'expected repeated context popover closes to return before visibility writes'
	    );
	    assert.match(closeSection, /setPopoverOpenState\(contextPopover, false\);/);
	    assert.match(closeSection, /setPopoverOpenState\(todoPopover, false\);/);
	    assert.doesNotMatch(closeSection, /setHidden\((contextPopover|todoPopover), true\);/);
		    assert.match(contextSource, /let\s+contextPopoverFocusReturnTarget\s*=\s*null/);
		    assert.match(contextSource, /let\s+todoPopoverFocusReturnTarget\s*=\s*null/);
		    assert.match(contextSource, /let\s+popoverFocusRestoreTimer\s*=\s*null/);
			    assert.match(contextSource, /function\s+getPopoverFocusReturnTarget\(fallback\)/);
			    assert.match(contextSource, /function\s+restorePopoverFocus\(target\)/);
			    assert.match(contextSource, /function\s+clearPopoverFocusRestoreTimer\(\)/);
				    assert.match(contextSource, /clearTimeout\(popoverFocusRestoreTimer\);/);
				    assert.match(contextSource, /function\s+popoverContainsFocus\(popover\)/);
				    assert.match(contextSource, /function\s+restoreFocusAfterPointerDismiss\(popover, target\)/);
				    assert.match(contextSource, /clearPopoverFocusRestoreTimer\(\);[\s\S]*const timer = setTimeout/);
				    assert.match(contextSource, /if \(popoverFocusRestoreTimer !== timer\) return;[\s\S]*popoverFocusRestoreTimer = null;/);
				    assert.match(contextSource, /popoverFocusRestoreTimer = timer;/);
				    assert.match(contextSource, /element\.focus\(\{ preventScroll: true \}\);/);
				    assert.match(contextSource, /return document\.activeElement === element;/);
		    assert.match(closeSection, /const focusReturnTarget = contextPopoverFocusReturnTarget \|\| contextIndicator;/);
		    assert.match(closeSection, /const focusReturnTarget = todoPopoverFocusReturnTarget \|\| todoIndicator;/);
		    assert.match(closeSection, /restorePopoverFocus\(focusReturnTarget\);/);
	    assert.match(openSection, /const wasOpen = isPopoverOpen\(todoPopover\);/);
	    assert.match(openSection, /const wasOpen = isPopoverOpen\(contextPopover\);/);
	    assert.match(openSection, /if \(wasOpen\) return;/);
	    assert.ok(
	      openSection.indexOf('if (wasOpen) return;') < openSection.indexOf('setPopoverOpenState(todoPopover, true);'),
	      'expected repeated popover opens to return before visibility writes'
	    );
	    assert.match(openSection, /setPopoverOpenState\(todoPopover, true\);/);
	    assert.match(openSection, /setPopoverOpenState\(contextPopover, true\);/);
	    assert.doesNotMatch(openSection, /setHidden\((contextPopover|todoPopover), false\);/);
	    assert.match(openSection, /todoPopoverFocusReturnTarget = getPopoverFocusReturnTarget\(todoIndicator\);/);
	    assert.match(openSection, /contextPopoverFocusReturnTarget = getPopoverFocusReturnTarget\(contextIndicator\);/);
	    assert.match(openSection, /focusPopoverTarget\(todoPopoverClose\);/);
		    assert.match(openSection, /focusPopoverTarget\(contextPopoverClose\);/);
		    assert.match(openSection, /setAttributeValue\(todoIndicator, 'aria-expanded', 'true'\);/);
		    assert.match(openSection, /setAttributeValue\(contextIndicator, 'aria-expanded', 'true'\);/);
		    assert.match(contextSource, /function\s+dismissPopoverFromOutsidePointer\(popover, trigger, closePopover, target\)/);
		    assert.match(contextSource, /elementContainsTarget\(popover, target\) \|\| elementContainsTarget\(trigger, target\)/);
		    assert.match(contextSource, /restoreFocusAfterPointerDismiss\(popover, target\);/);
		    assert.match(contextSource, /closePopover\(\{ restoreFocus: false \}\);/);
		    assert.match(contextSource, /dismissPopoverFromOutsidePointer\(contextPopover, contextIndicator, closeContextPopover, target\);/);
		    assert.match(contextSource, /dismissPopoverFromOutsidePointer\(todoPopover, todoIndicator, closeTodoPopover, target\);/);
			    assert.match(mainSource, /clearPopoverFocusRestoreTimer\(\);/);
		    assert.doesNotMatch(contextSource, /contextPopover\.contains\(target\)/);
		    assert.doesNotMatch(contextSource, /todoPopover\.contains\(target\)/);
	    assert.doesNotMatch(closeSection + openSection, /(?:contextPopover|todoPopover)\.classList\.(?:add|remove)\('hidden'\)/);
	    assert.doesNotMatch(closeSection + openSection, /(?:contextPopover|todoPopover)\.classList\.contains\('hidden'\)/);
	    assert.doesNotMatch(closeSection + openSection, /\.setAttribute\('aria-expanded'/);
	  });

		  test('operation banner timer stays out of live announcements and avoids duplicate writes', () => {
	    const html = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const operationTag = html.match(/<div\b[^>]*\bid="operationBanner"[^>]*>/i)?.[0] || '';
		    const helperStart = bootstrapSource.indexOf('function updateOperationBanner');
		    assert.ok(helperStart >= 0, 'expected operation banner helper');
		    const helperEnd = bootstrapSource.indexOf('function updateApprovalBanner', helperStart);
		    assert.ok(helperEnd > helperStart, 'expected end of operation banner helper');
		    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
		    const lifecycleStart = bootstrapSource.indexOf('function clearOperationHideTimer');
		    assert.ok(lifecycleStart >= 0, 'expected operation hide timer cleanup helper');
		    const lifecycleEnd = bootstrapSource.indexOf('if (messages)', lifecycleStart);
		    assert.ok(lifecycleEnd > lifecycleStart, 'expected operation lifecycle section before message listeners');
		    const lifecycleSection = bootstrapSource.slice(lifecycleStart, lifecycleEnd);
		    const visibilityStart = bootstrapSource.indexOf('function setOperationBannerVisible', lifecycleStart);
		    assert.ok(visibilityStart >= 0, 'expected operation banner visibility helper');
		    const visibilityEnd = bootstrapSource.indexOf('function setApprovalBannerVisible', visibilityStart);
		    assert.ok(visibilityEnd > visibilityStart, 'expected approval banner visibility helper after operation visibility helper');
		    const visibilitySection = bootstrapSource.slice(visibilityStart, visibilityEnd);
	    const operationUpdateStart = mainSource.indexOf("case 'operationUpdate':");
	    assert.ok(operationUpdateStart >= 0, 'expected operation update branch');
	    const operationUpdateEnd = mainSource.indexOf("case 'operationEnd':", operationUpdateStart);
	    assert.ok(operationUpdateEnd > operationUpdateStart, 'expected operation end branch after operation update');
	    const operationUpdateSection = mainSource.slice(operationUpdateStart, operationUpdateEnd);

	    assert.match(operationTag, /\brole="group"/);
		    assert.match(operationTag, /\baria-label="Current operation"/);
		    assert.doesNotMatch(operationTag, /\baria-live=/);
		    assert.match(html, /id="operationSpinner" class="operation-banner-spinner" aria-hidden="true"/);
		    assert.match(html, /id="operationElapsed" class="operation-banner-elapsed" aria-hidden="true"/);
	    assert.match(bootstrapSource, /let\s+operationBannerVisible\s*=\s*false/);
	    assert.match(visibilitySection, /function setOperationBannerVisible\(visible\)/);
	    assert.match(visibilitySection, /if \(operationBannerVisible === visibleFlag\) return;/);
	    assert.match(visibilitySection, /operationBannerVisible = visibleFlag;/);
	    assert.match(visibilitySection, /operationBanner\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.doesNotMatch(visibilitySection, /setHidden\(operationBanner/);
	    assert.match(helperSection, /setOperationBannerVisible\(false\);/);
	    assert.match(helperSection, /lastOperationLabelText = '';/);
	    assert.match(helperSection, /setOperationBannerVisible\(true\);/);
	    assert.match(helperSection, /const nextLabel = currentOperation\.label \|\| 'Working…';/);
	    assert.match(helperSection, /if \(lastOperationLabelText !== nextLabel\) \{/);
	    assert.match(helperSection, /setTextContent\(operationLabelEl, nextLabel\);/);
	    assert.match(helperSection, /lastOperationLabelText = nextLabel;/);
	    assert.match(helperSection, /announceStatus\(nextLabel\);/);
	    assert.match(helperSection, /setDisplay\(operationSpinner, status === 'running' \? '' : 'none'\);/);
	    assert.match(helperSection, /const elapsed = Date\.now\(\) - \(currentOperation\.startedAt \?\? Date\.now\(\)\);/);
	    assert.match(helperSection, /const nextElapsed = status === 'running' \? formatElapsed\(elapsed\) : '';/);
	    assert.match(helperSection, /setTextContent\(operationElapsedEl, nextElapsed\);/);
	    assert.doesNotMatch(helperSection, /currentOperation\.startedAt \|\| Date\.now\(\)/);
	    assert.doesNotMatch(helperSection, /setHidden\(operationBanner,/);
	    assert.doesNotMatch(helperSection, /operationBanner\.classList\.(?:add|remove|toggle|contains)\('hidden'/);
		    assert.doesNotMatch(helperSection, /operationSpinner\.style\.display\s*=/);
		    assert.doesNotMatch(helperSection, /operationLabelEl\.textContent = currentOperation\.label \|\| 'Working…';/);
		    assert.doesNotMatch(helperSection, /operationLabelEl\.textContent \|\| ''/);
		    assert.doesNotMatch(helperSection, /operationElapsedEl\.textContent = status === 'running' \? formatElapsed\(elapsed\) : '';/);
		    assert.match(bootstrapSource, /let\s+operationHideTimer\s*=\s*null/);
		    assert.match(lifecycleSection, /clearTimeout\(operationHideTimer\);/);
			    assert.match(lifecycleSection, /function startOperation\(operation\) \{/);
			    assert.match(lifecycleSection, /const nextOperation = operation \|\| null;/);
			    assert.match(lifecycleSection, /currentOperation && nextOperation && !operationPatchHasChanges\(nextOperation\)/);
			    assert.match(lifecycleSection, /for \(const key in operation\)/);
			    assert.match(lifecycleSection, /Object\.prototype\.hasOwnProperty\.call\(operation, key\)/);
			    assert.doesNotMatch(lifecycleSection, /Object\.keys\(operation\)/);
			    assert.match(lifecycleSection, /!operationHideTimer && \(currentStatus !== 'running' \|\| operationTimer\)/);
		    assert.ok(
		      lifecycleSection.indexOf('!operationPatchHasChanges(nextOperation)') <
		        lifecycleSection.indexOf('clearOperationHideTimer();'),
		      'duplicate operation start guard should run before clearing timers or refreshing the banner'
		    );
			    assert.match(lifecycleSection, /currentOperation = nextOperation;/);
		    assert.match(lifecycleSection, /function operationPatchHasChanges\(operation\)/);
		    assert.match(lifecycleSection, /for \(const key in operation\)/);
		    assert.match(lifecycleSection, /const nextStatus = status \|\| 'done';/);
		    assert.match(lifecycleSection, /const nextLabel = typeof labelOverride === 'string' && labelOverride\.trim\(\) \? labelOverride\.trim\(\) : '';/);
		    assert.match(lifecycleSection, /operationHideTimer &&[\s\S]*\(currentOperation\.status \|\| 'running'\) === nextStatus[\s\S]*\(!nextLabel \|\| \(currentOperation\.label \|\| ''\) === nextLabel\)[\s\S]*\) return;/);
		    assert.ok(
		      lifecycleSection.indexOf('operationHideTimer &&') <
		        lifecycleSection.indexOf('clearOperationHideTimer();', lifecycleSection.indexOf('function endOperation')),
		      'duplicate operation end guard should run before clearing or rescheduling the hide timer'
		    );
		    assert.match(lifecycleSection, /stopOperationTimer\(\);\s*clearOperationHideTimer\(\);/);
		    assert.match(lifecycleSection, /if \(operationHideTimer !== hideTimer\) return;/);
	    assert.match(operationUpdateSection, /if \(typeof operationPatchHasChanges === 'function' && !operationPatchHasChanges\(data\.operation\)\) break;/);
	    assert.match(operationUpdateSection, /currentOperation = \{ \.\.\.currentOperation, \.\.\.data\.operation \};/);
		    assert.match(lifecycleSection, /operationHideTimer = hideTimer;/);
		    assert.doesNotMatch(lifecycleSection, /if \(hideTimer\) clearTimeout\(hideTimer\);/);
		  });

		  test('approval banner live-region updates avoid duplicate writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
		    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
		    const helperStart = bootstrapSource.indexOf('function updateApprovalBanner');
		    assert.ok(helperStart >= 0, 'expected approval banner helper');
		    const helperEnd = bootstrapSource.indexOf('function startOperation', helperStart);
		    assert.ok(helperEnd > helperStart, 'expected end of approval banner helper');
		    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
		    const approvalsChangedStart = mainSource.indexOf("case 'approvalsChanged':");
		    assert.ok(approvalsChangedStart >= 0, 'expected approvalsChanged branch');
		    const approvalsChangedEnd = mainSource.indexOf("case 'operationUpdate':", approvalsChangedStart);
		    assert.ok(approvalsChangedEnd > approvalsChangedStart, 'expected operation update branch after approvalsChanged');
		    const approvalsChangedSection = mainSource.slice(approvalsChangedStart, approvalsChangedEnd);
		    const approvalTag = htmlSource.match(/<div\b[^>]*\bid="approvalBanner"[^>]*>/i)?.[0] || '';
		    const allowAllTag = htmlSource.match(/<button\b[^>]*\bid="approvalAllowAll"[^>]*>/i)?.[0] || '';
		    const visibilityStart = bootstrapSource.indexOf('function setApprovalBannerVisible');
		    assert.ok(visibilityStart >= 0, 'expected approval banner visibility helper');
		    const visibilityEnd = bootstrapSource.indexOf('function updateOperationBanner', visibilityStart);
		    assert.ok(visibilityEnd > visibilityStart, 'expected operation banner update helper after approval visibility helper');
		    const visibilitySection = bootstrapSource.slice(visibilityStart, visibilityEnd);

		    assert.match(approvalTag, /\brole="group"/);
		    assert.match(approvalTag, /\baria-label="Pending approvals"/);
		    assert.doesNotMatch(approvalTag, /\baria-live=/);
		    assert.match(htmlSource, /class="approval-banner-icon" aria-hidden="true"/);
		    assert.match(allowAllTag, /\btitle="Allow all pending automatic approvals"/);
	    assert.match(allowAllTag, /\baria-label="Allow all pending automatic approvals"/);
	    assert.match(bootstrapSource, /let\s+approvalBannerVisible\s*=\s*false/);
	    assert.match(visibilitySection, /function setApprovalBannerVisible\(visible\)/);
	    assert.match(visibilitySection, /if \(approvalBannerVisible === visibleFlag\) return;/);
	    assert.match(visibilitySection, /approvalBannerVisible = visibleFlag;/);
	    assert.match(visibilitySection, /approvalBanner\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.doesNotMatch(visibilitySection, /setHidden\(approvalBanner/);
	    assert.match(helperSection, /setApprovalBannerVisible\(false\);/);
	    assert.match(helperSection, /setApprovalBannerVisible\(false\);[\s\S]*lastApprovalLabelText = '';/);
	    assert.match(helperSection, /setApprovalBannerVisible\(true\);/);
	    assert.match(helperSection, /let nextApprovalLabel =/);
	    assert.match(helperSection, /nextApprovalLabel \+= [\s\S]*manualApprovalsCount[\s\S]*' manual';/);
	    assert.match(helperSection, /let allowAllLabel = 'Allow all pending automatic approvals';/);
	    assert.match(helperSection, /if \(manualApprovalsCount > 0\) \{/);
	    assert.match(helperSection, /else if \(pendingApprovalsCount === 1\) \{/);
	    assert.match(helperSection, /setTitle\(approvalAllowAllBtn, allowAllLabel\);/);
	    assert.match(helperSection, /setAttributeValue\(approvalAllowAllBtn, 'aria-label', allowAllLabel\);/);
	    assert.match(bootstrapSource, /let\s+lastApprovalLabelText\s*=\s*''/);
	    assert.match(helperSection, /if \(lastApprovalLabelText !== nextApprovalLabel\) \{/);
	    assert.match(helperSection, /setTextContent\(approvalLabelEl, nextApprovalLabel\);/);
	    assert.match(helperSection, /lastApprovalLabelText = nextApprovalLabel;/);
	    assert.match(helperSection, /announceStatus\(nextApprovalLabel\);/);
		    assert.match(helperSection, /setDisabled\(approvalAllowAllBtn, disableAllowAll\);/);
		    assert.match(helperSection, /setDisabled\(approvalStopBtn, abortRequestPending\);/);
		    assert.match(approvalsChangedSection, /const nextPendingApprovalsCount = Number\(data\.count \|\| 0\) \|\| 0;/);
		    assert.match(approvalsChangedSection, /!approveAllPending/);
		    assert.match(approvalsChangedSection, /pendingApprovalsCount === nextPendingApprovalsCount/);
		    assert.ok(
		      approvalsChangedSection.indexOf('pendingApprovalsCount === nextPendingApprovalsCount') < approvalsChangedSection.indexOf('updateApprovalBanner();'),
		      'expected unchanged approval-state guard before banner update'
		    );
			    assert.doesNotMatch(helperSection, /setHidden\(approvalBanner,/);
			    assert.doesNotMatch(helperSection, /approvalBanner\.classList\.(?:add|remove|toggle|contains)\('hidden'/);
		    assert.doesNotMatch(helperSection, /approvalLabelEl\.textContent \+=/);
	    assert.doesNotMatch(helperSection, /approvalLabelEl\.textContent \|\| ''/);
	    assert.doesNotMatch(helperSection, /announceStatus\(approvalLabelEl\.textContent\)/);
	  });

		  test('revert bar live-region updates avoid duplicate writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
			    const html = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
	    const statusTag = html.match(/<div\b[^>]*\bid="revertStatus"[^>]*>/i)?.[0] || '';
	    const barTag = html.match(/<div\b[^>]*\bid="revertBar"[^>]*>/i)?.[0] || '';
	    const discardTag = html.match(/<button\b[^>]*\bid="revertDiscard"[^>]*>/i)?.[0] || '';
	    const revertActionButtons = [
	      { id: 'revertRedo', text: 'Redo', title: 'Redo last undone message', label: 'Redo, redo last undone message' },
	      { id: 'revertRedoAll', text: 'Redo all', title: 'Redo all undone messages', label: 'Redo all, redo all undone messages' },
	      { id: 'revertDiff', text: 'View changes', title: 'View reverted file changes', label: 'View changes, view reverted file changes' },
	    ];
		    const buttonsStart = bootstrapSource.indexOf('function syncRevertBarButtons');
		    assert.ok(buttonsStart >= 0, 'expected revert button sync helper');
		    const renderKeyStart = bootstrapSource.indexOf('function getRevertBarSummary', buttonsStart);
		    assert.ok(renderKeyStart > buttonsStart, 'expected revert render-key helper after button helper');
		    const buttonsEnd = renderKeyStart;
		    const buttonsSection = bootstrapSource.slice(buttonsStart, buttonsEnd);
			    const renderKeyEnd = bootstrapSource.indexOf('function updateRevertBar', renderKeyStart);
			    assert.ok(renderKeyEnd > renderKeyStart, 'expected updateRevertBar after render-key helper');
			    const renderKeySection = bootstrapSource.slice(renderKeyStart, renderKeyEnd);
				    const helperStart = bootstrapSource.indexOf('function setRevertBarVisible', renderKeyStart);
				    assert.ok(helperStart >= 0, 'expected revert bar helper');
			    const helperEnd = bootstrapSource.length;
			    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
			    const revertStateStart = mainSource.indexOf("case 'revertState':");
			    assert.ok(revertStateStart >= 0, 'expected revertState branch');
			    const revertStateEnd = mainSource.indexOf("case 'cleared':", revertStateStart);
			    assert.ok(revertStateEnd > revertStateStart, 'expected cleared branch after revertState');
			    const revertStateSection = mainSource.slice(revertStateStart, revertStateEnd);
		    const inputKeydownStart = bootstrapSource.indexOf("input.addEventListener('keydown'");
		    assert.ok(inputKeydownStart >= 0, 'expected composer keydown handler');
		    const inputKeydownEnd = bootstrapSource.indexOf("clearInputBtn.addEventListener('click'", inputKeydownStart);
		    assert.ok(inputKeydownEnd > inputKeydownStart, 'expected composer keydown handler before clear button');
		    const inputKeydownSection = bootstrapSource.slice(inputKeydownStart, inputKeydownEnd);
		    const composerEscapeStart = inputKeydownSection.lastIndexOf('if (isEscapeKey(e))');
		    assert.ok(composerEscapeStart >= 0, 'expected composer Escape branch');
		    const composerEscapeEnd = inputKeydownSection.indexOf("if (e.key === '.'", composerEscapeStart);
		    assert.ok(composerEscapeEnd > composerEscapeStart, 'expected abort shortcut after composer Escape branch');
		    const composerEscapeSection = inputKeydownSection.slice(composerEscapeStart, composerEscapeEnd);

	    assert.match(statusTag, /\brole="status"/);
	    assert.match(statusTag, /\baria-live="polite"/);
	    assert.match(statusTag, /\baria-atomic="true"/);
    assert.match(barTag, /\brole="group"/);
    assert.match(barTag, /\baria-label="Undo controls"/);
    assert.doesNotMatch(barTag, /\baria-live=/);
	    assert.match(discardTag, /\btitle="Discard undone history"/);
	    assert.match(discardTag, /\baria-label="Discard undone history"/);
	    for (const { id, text, title, label } of revertActionButtons) {
	      const match = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>([^<]*)<\\/button>`, 'i'));
	      const tag = match?.[0] || '';
	      assert.ok(tag, `expected ${id} button`);
	      assert.strictEqual(match?.[1], text);
	      assert.ok(label.startsWith(text), `${id} accessible label should start with visible text`);
	      assert.match(tag, new RegExp(`\\btitle="${title}"`));
	      assert.match(tag, new RegExp(`\\baria-label="${label}"`));
	    }
		    assert.match(bootstrapSource, /let\s+lastRevertBarRenderKey\s*=\s*''/);
		    assert.match(bootstrapSource, /let\s+lastRevertBarButtonsKey\s*=\s*''/);
		    assert.match(bootstrapSource, /let\s+revertBarVisible\s*=\s*false/);
		    assert.match(buttonsSection, /const redoDisabled = !enabled \|\| !canRedo;/);
		    assert.match(buttonsSection, /const actionDisabled = !enabled;/);
		    assert.match(buttonsSection, /const nextRevertBarButtonsKeyBuilder = createCompactRenderStateKeyBuilder\(\);/);
		    assert.match(buttonsSection, /appendCompactRenderStateKeyPart\(nextRevertBarButtonsKeyBuilder, redoDisabled \? 1 : 0\)/);
		    assert.match(buttonsSection, /appendCompactRenderStateKeyPart\(nextRevertBarButtonsKeyBuilder, actionDisabled \? 1 : 0\)/);
		    assert.match(buttonsSection, /const nextRevertBarButtonsKey = finishCompactRenderStateKey\(nextRevertBarButtonsKeyBuilder\);/);
		    assert.match(buttonsSection, /if \(nextRevertBarButtonsKey === lastRevertBarButtonsKey\) return;/);
		    assert.match(buttonsSection, /lastRevertBarButtonsKey = nextRevertBarButtonsKey;/);
		    assert.match(buttonsSection, /setDisabled\(revertRedoBtn, redoDisabled\);/);
		    assert.match(buttonsSection, /setDisabled\(revertDiscardConfirmRunBtn, actionDisabled\);/);
		    assert.ok(
		      buttonsSection.indexOf("setRevertDiscardConfirmPending(false, { sync: false, restoreFocus: false });") <
		        buttonsSection.indexOf('if (nextRevertBarButtonsKey === lastRevertBarButtonsKey) return;'),
		      'expected stale discard confirmation cleanup before the revert-button cache guard'
		    );
				    assert.match(renderKeySection, /function getRevertBarSummary\(revertedMessages, fileCount\)/);
				    assert.match(renderKeySection, /function normalizeRevertCount\(value\)/);
				    assert.match(bootstrapSource, /const REVERT_FILE_PATH_DISPLAY_LIMIT = 160;/);
				    assert.match(renderKeySection, /function getRevertFileDisplayPath\(path\)/);
				    assert.match(renderKeySection, /const value = formatFilePath\(path\);/);
				    assert.match(renderKeySection, /value\.length <= REVERT_FILE_PATH_DISPLAY_LIMIT/);
				    assert.match(renderKeySection, /value\.slice\(0, REVERT_FILE_PATH_DISPLAY_LIMIT\) \+ '…'/);
				    assert.match(renderKeySection, /function getRevertBarRenderKey\(state\)/);
				    assert.match(renderKeySection, /const revertedMessages = normalizeRevertCount\(value\.revertedMessages\);/);
				    assert.match(renderKeySection, /const key = createCompactRenderStateKeyBuilder\(\);/);
				    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, summary\);/);
				    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, file\.path \|\| ''\);/);
				    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, normalizeRevertCount\(file\.additions\)\);/);
				    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, normalizeRevertCount\(file\.deletions\)\);/);
				    assert.match(renderKeySection, /return finishCompactRenderStateKey\(key\);/);
				    assert.doesNotMatch(renderKeySection, /appendRenderKeyPart\(key, summary\)/);
			    assert.match(helperSection, /function setRevertBarVisible\(visible\)/);
			    assert.match(helperSection, /if \(revertBarVisible === visibleFlag\) return;/);
			    assert.match(helperSection, /revertBarVisible = visibleFlag;/);
			    assert.match(helperSection, /revertBar\.classList\.toggle\('hidden', !visibleFlag\);/);
			    assert.doesNotMatch(helperSection, /setHidden\(revertBar/);
			    assert.match(helperSection, /setRevertBarVisible\(false\);/);
			    assert.match(helperSection, /setRevertBarVisible\(true\);/);
			    assert.match(helperSection, /lastRevertBarRenderKey !== 'inactive'/);
			    assert.match(helperSection, /const revertedMessages = normalizeRevertCount\(currentRevertState\.revertedMessages\);/);
			    assert.match(helperSection, /const nextRevertBarRenderKey = getRevertBarRenderKey\(currentRevertState\);/);
		    assert.match(helperSection, /if \(nextRevertBarRenderKey === lastRevertBarRenderKey\) \{/);
		    assert.match(revertStateSection, /const nextRevertBarRenderKey = typeof getRevertBarRenderKey === 'function' \? getRevertBarRenderKey\(data\.revertState\) : '';/);
		    assert.match(revertStateSection, /!revertActionPending/);
		    assert.match(revertStateSection, /!revertDiscardConfirmPending/);
		    assert.match(revertStateSection, /canRedo === nextCanRedo/);
		    assert.ok(
		      revertStateSection.indexOf('nextRevertBarRenderKey === lastRevertBarRenderKey') < revertStateSection.indexOf('updateRevertBar(data.revertState)'),
		      'expected unchanged revert-state guard before render update'
		    );
			    assert.match(helperSection, /setTextContent\(revertSummary, summary\);/);
			    assert.match(helperSection, /setTextContent\(revertStatus, summary\);/);
			    assert.match(helperSection, /const displayPath = getRevertFileDisplayPath\(rawPath\);/);
			    assert.match(helperSection, /pathEl\.textContent = displayPath;/);
			    assert.match(helperSection, /pathEl\.title = displayPath;/);
		    assert.match(inputKeydownSection, /if \(revertBarVisible\) \{[\s\S]*setRevertBarVisible\(false\);/);
			    assert.doesNotMatch(inputKeydownSection, /revertBar\.classList\.contains\('hidden'\)/);
		    assert.match(composerEscapeSection, /consumeHandledKeyEvent\(e\);/);
		    assert.match(composerEscapeSection, /return;/);
	    assert.match(helperSection, /setTextContent\(revertStatus, 'No undone messages\.'\);/);
	    assert.match(helperSection, /const fragment = renderedFilesCount > 1 \|\| fileCount > maxFiles \? document\.createDocumentFragment\(\) : null;/);
	    assert.match(helperSection, /let singleFileRow = null;/);
	    assert.match(helperSection, /replaceElementChildren\(revertFilesList\);/);
	    assert.match(helperSection, /if \(fragment\) \{[\s\S]*fragment\.appendChild\(row\);[\s\S]*\} else \{[\s\S]*singleFileRow = row;[\s\S]*\}/);
		    assert.match(helperSection, /replaceElementChildren\(revertFilesList, fragment \|\| singleFileRow\);/);
		    assert.match(helperSection, /const additions = normalizeRevertCount\(file\.additions\);/);
		    assert.match(helperSection, /const deletions = normalizeRevertCount\(file\.deletions\);/);
		    assert.doesNotMatch(helperSection, /const fragment = document\.createDocumentFragment\(\);/);
		    assert.doesNotMatch(renderKeySection + helperSection, /Number\.isFinite\((?:value\.revertedMessages|currentRevertState\.revertedMessages|file\.additions|file\.deletions)\)/);
    assert.doesNotMatch(helperSection, /revertBar\.classList\.(?:add|remove)\('hidden'\)/);
    assert.doesNotMatch(helperSection, /revertSummary\.textContent = summary/);
	    assert.doesNotMatch(helperSection, /revertStatus\.textContent\s*=/);
	    assert.doesNotMatch(bootstrapSource, /revertBar\.hidden\s*=/);
	    assert.doesNotMatch(helperSection, /revertFilesList\.innerHTML\s*=/);
    assert.doesNotMatch(helperSection, /revertFilesList\.appendChild\(fragment\)/);
    assert.doesNotMatch(helperSection, /files\.slice\(0, maxFiles\)/);
	    assert.doesNotMatch(buttonsSection, /revertRedoBtn\.disabled =/);
	  });

	  test('revert discard confirmation updates avoid duplicate aria and visibility writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const helperStart = bootstrapSource.indexOf('function setRevertDiscardConfirmVisible');
	    assert.ok(helperStart >= 0, 'expected revert discard confirmation visibility helper');
	    const pendingStart = bootstrapSource.indexOf('function setRevertDiscardConfirmPending', helperStart);
	    assert.ok(pendingStart > helperStart, 'expected revert discard confirmation helper after visibility helper');
	    const helperEnd = bootstrapSource.indexOf('function requestRevertAction', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected revert action helper after discard confirmation helper');
		    const helperSection = bootstrapSource.slice(helperStart, helperEnd);

		    assert.match(bootstrapSource, /let\s+revertDiscardConfirmSynced\s*=\s*false/);
		    assert.match(bootstrapSource, /let\s+revertDiscardConfirmVisible\s*=\s*false/);
		    assert.match(helperSection, /function setRevertDiscardConfirmVisible\(visible\)/);
		    assert.match(helperSection, /if \(revertDiscardConfirmVisible === visibleFlag\) return;/);
		    assert.match(helperSection, /revertDiscardConfirm\.classList\.toggle\('hidden', !visibleFlag\);/);
		    assert.match(helperSection, /setRevertDiscardConfirmVisible\(revertDiscardConfirmPending\);/);
		    assert.match(helperSection, /setAttributeValue\(revertDiscardBtn, 'aria-expanded', revertDiscardConfirmPending \? 'true' : 'false'\);/);
		    assert.match(helperSection, /const wasPending = revertDiscardConfirmPending;/);
		    assert.match(helperSection, /const nextPending = !!pending;/);
		    assert.match(helperSection, /if \(revertDiscardConfirmSynced && wasPending === nextPending\) \{[\s\S]*if \(!options \|\| options\.sync !== false\) syncInputState\(\);[\s\S]*return;[\s\S]*\}/);
		    assert.match(helperSection, /revertDiscardConfirmPending = nextPending;/);
		    assert.match(helperSection, /revertDiscardConfirmSynced = true;/);
		    assert.match(helperSection, /if \(revertDiscardConfirmSynced && wasPending === nextPending\) \{[\s\S]*return;[\s\S]*\}[\s\S]*setRevertDiscardConfirmVisible\(revertDiscardConfirmPending\);/);
		    assert.match(helperSection, /focusInlineConfirmationTarget\(revertDiscardCancelBtn\);/);
	    assert.match(helperSection, /focusInlineConfirmationTarget\(revertDiscardBtn\);/);
	    assert.match(helperSection, /options\.restoreFocus !== false/);
	    assert.match(bootstrapSource, /function focusInlineConfirmationTarget\(element\)/);
	    assert.match(bootstrapSource, /element\.focus\(\{ preventScroll: true \}\);/);
	    assert.doesNotMatch(bootstrapSource, /function focusRevertDiscardConfirmationTarget\(element\)/);
	    assert.match(bootstrapSource, /setRevertDiscardConfirmPending\(false, \{ sync: false, restoreFocus: false \}\);/);
	    assert.doesNotMatch(helperSection, /setHidden\(revertDiscardConfirm, !revertDiscardConfirmPending\);/);
	    assert.doesNotMatch(helperSection, /\.setAttribute\('aria-expanded'/);
	  });

	  test('inline confirmation markup avoids live-region churn around action buttons', () => {
	    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
	    const confirmations = [
	      {
	        id: 'sessionClearConfirm',
	        labelId: 'sessionClearConfirmText',
	      },
	      {
	        id: 'memoryDropConfirm',
	        labelId: 'memoryDropConfirmText',
	      },
	      {
	        id: 'autoApprovedToolsClearConfirm',
	        labelId: 'autoApprovedToolsClearConfirmText',
	      },
	      {
	        id: 'revertDiscardConfirm',
	        labelId: 'revertDiscardConfirmText',
	      },
	    ];

	    for (const { id, labelId } of confirmations) {
	      const confirmTag = htmlSource.match(new RegExp(`<div\\b[^>]*\\bid="${id}"[^>]*>`, 'i'))?.[0] || '';

	      assert.ok(confirmTag, `expected ${id} confirmation container`);
	      assert.match(confirmTag, /\brole="group"/);
	      assert.match(confirmTag, new RegExp(`\\baria-labelledby="${labelId}"`));
	      assert.doesNotMatch(confirmTag, /\baria-label=/);
	      assert.doesNotMatch(confirmTag, /\baria-describedby=/);
	      assert.doesNotMatch(confirmTag, /\brole="alert"/);
	      assert.doesNotMatch(confirmTag, /\baria-live=/);
	      assert.match(htmlSource, new RegExp(`<div\\b[^>]*\\bid="${labelId}"[^>]*>`, 'i'));
	    }

	    const confirmationButtons = [
	      { id: 'sessionClearCancel', label: 'Cancel clear session', text: 'Cancel' },
	      { id: 'sessionClearConfirmRun', label: 'Clear current session', text: 'Clear current' },
	      { id: 'memoryDropCancel', label: 'Cancel drop memories', text: 'Cancel' },
	      { id: 'memoryDropConfirmRun', label: 'Drop memories and generated artifacts', text: 'Drop memories' },
	      { id: 'autoApprovedToolsClearCancel', label: 'Cancel clear always allowed tools', text: 'Cancel' },
	      { id: 'autoApprovedToolsClearConfirmRun', label: 'Clear always allowed tools', text: 'Clear always allowed' },
	      { id: 'revertDiscardCancel', label: 'Cancel discard undone history', text: 'Cancel' },
	      { id: 'revertDiscardConfirmRun', label: 'Discard undone history', text: 'Discard' },
	    ];
	    const confirmationTriggers = [
	      {
	        id: 'sessionClearCurrent',
	        text: 'Clear current',
	        title: 'Clear messages and runtime state for the current session',
	        label: 'Clear current, clear messages and runtime state for the current session',
	        controls: 'sessionClearConfirm',
	      },
	      {
	        id: 'sessionClearSaved',
	        text: 'Clear saved',
	        title: 'Delete all saved sessions, todos, and input history from workspace storage',
	        label: 'Clear saved, delete all saved sessions, todos, and input history from workspace storage',
	        controls: 'sessionClearConfirm',
	      },
	      {
	        id: 'autoApprovedToolsClear',
	        text: 'Clear always allowed',
	        title: 'Clear all saved always-allowed tool approvals',
	        label: 'Clear always allowed, clear all saved always-allowed tool approvals',
	        controls: 'autoApprovedToolsClearConfirm',
	      },
	    ];
	    for (const { id, label, text } of confirmationButtons) {
	      const match = htmlSource.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>([^<]*)<\\/button>`, 'i'));
	      const tag = match?.[0] || '';
	      assert.ok(tag, `expected ${id} button`);
	      assert.match(tag, new RegExp(`\\baria-label="${label}"`));
	      assert.match(tag, new RegExp(`\\btitle="${label}"`));
	      assert.strictEqual(match?.[1], text);
	      assert.ok(label.startsWith(text), `${id} accessible label should start with visible text`);
		    }
	    for (const { id, text, title, label, controls } of confirmationTriggers) {
	      const match = htmlSource.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>([^<]*)<\\/button>`, 'i'));
	      const tag = match?.[0] || '';
	      assert.ok(tag, `expected ${id} trigger`);
	      assert.strictEqual(match?.[1], text);
	      assert.ok(label.startsWith(text), `${id} accessible label should start with visible text`);
	      assert.match(tag, new RegExp(`\\btitle="${title}"`));
	      assert.match(tag, new RegExp(`\\baria-label="${label}"`));
	      assert.match(tag, new RegExp(`\\baria-controls="${controls}"`));
	      assert.match(tag, /\baria-expanded="false"/);
	    }
		  });

		  test('compact settings action buttons expose scoped labels without hiding visible text', () => {
		    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
		    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		    const actionButtons = [
		      { id: 'sessionSettingsApply', text: 'Apply', title: 'Apply session settings', label: 'Apply, apply session settings' },
		      { id: 'providerSettingsApply', text: 'Apply', title: 'Apply provider settings', label: 'Apply, apply provider settings' },
		      { id: 'modelRefreshList', text: 'Refresh models', title: 'Refresh listed provider models', label: 'Refresh models, refresh listed provider models' },
			      { id: 'modelClearRecents', text: 'Clear recents', title: 'Clear recent models', label: 'Clear recents, clear recent models' },
			      { id: 'customModelApply', text: 'Use model', title: 'Use custom model ID', label: 'Use model, use custom model ID' },
			      { id: 'modelSettingsOpenSettings', text: 'Open VS Code settings…', title: 'Open VS Code settings for more model options', label: 'Open VS Code settings…, open VS Code settings for more model options' },
		      { id: 'modelSettingsApply', text: 'Apply', title: 'Apply generation settings', label: 'Apply, apply generation settings' },
			      { id: 'instructionPatternsApply', text: 'Apply instructions', title: 'Apply instruction file settings', label: 'Apply instructions, apply instruction file settings' },
			      { id: 'memoryUpdateNow', text: 'Update memories', title: 'Rebuild memory artifacts from saved sessions', label: 'Update memories, rebuild memory artifacts from saved sessions' },
			      { id: 'memoryAdvancedLimitsApply', text: 'Apply memory limits', title: 'Apply memory limit settings', label: 'Apply memory limits, apply memory limit settings' },
			      { id: 'memoryDrop', text: 'Drop memories', title: 'Delete generated memory artifacts and extraction outputs', label: 'Drop memories, delete generated memory artifacts and extraction outputs' },
			      { id: 'modelLimitsApply', text: 'Apply model limits', title: 'Apply model token limits', label: 'Apply model limits, apply model token limits' },
			      { id: 'contextCompactNow', text: 'Compact now', title: 'Compact current context now', label: 'Compact now, compact current context' },
			      { id: 'showLogs', text: 'Show logs', title: 'Open the LingYun output channel', label: 'Show logs, open the LingYun output channel' },
			      { id: 'listTools', text: 'List tools', title: 'Browse registered tools and parameter schemas', label: 'List tools, browse registered tools and parameter schemas' },
			      { id: 'runTool', text: 'Run tool', title: 'Open the inline tool runner', label: 'Run tool, open the inline tool runner' },
			      { id: 'createToolsConfig', text: 'Create config', title: 'Create a sample .vscode/agent-tools.json workspace tools config', label: 'Create config, create a sample .vscode/agent-tools.json workspace tools config' },
		      { id: 'pluginSettingsApply', text: 'Apply', title: 'Apply plugin settings', label: 'Apply, apply plugin settings' },
		      { id: 'toolFilterApply', text: 'Apply', title: 'Apply allowed tool patterns', label: 'Apply, apply allowed tool patterns' },
			      { id: 'workspaceEnvApply', text: 'Apply env', title: 'Apply workspace tool environment variables', label: 'Apply env, apply workspace tool environment variables' },
		      { id: 'toolLimitsApply', text: 'Apply', title: 'Apply tool runtime limits', label: 'Apply, apply tool runtime limits' },
		      { id: 'skillsSettingsApply', text: 'Apply', title: 'Apply skills settings', label: 'Apply, apply skills settings' },
			      { id: 'modePlan', text: 'Plan', title: 'Plan mode (read-only)', label: 'Plan, plan mode read-only' },
			      { id: 'modeBuild', text: 'Build', title: 'Build mode (can modify workspace)', label: 'Build, build mode can modify workspace' },
			    ];

		    for (const { id, text, title, label } of actionButtons) {
		      const match = htmlSource.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>([^<]*)<\\/button>`, 'i'));
		      const tag = match?.[0] || '';
		      assert.ok(tag, `expected ${id} button`);
		      assert.strictEqual(match?.[1], text);
		      assert.ok(label.startsWith(text), `${id} accessible name should start with the visible label`);
		      assert.match(tag, new RegExp(`\\btitle="${escapeRegExp(title)}"`));
		      assert.match(tag, new RegExp(`\\baria-label="${escapeRegExp(label)}"`));
		    }
		  });

  test('session restore avoids per-message autoscroll layout reads', () => {
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
    const restoreStart = mainSource.indexOf('const restoredMessageList = Array.isArray(data.messages) ? data.messages : [];');
    assert.ok(restoreStart >= 0, 'expected session restore message list');
    const restoreEnd = mainSource.indexOf('restoredTranscriptHasMessages = renderedMessages > 0;', restoreStart);
    assert.ok(restoreEnd > restoreStart, 'expected restored transcript state after bounded restore');
    const restoreSection = mainSource.slice(restoreStart, restoreEnd);
    const renderRestoreStart = renderMessagesSource.indexOf('function restoreTranscriptMessages(list, options)');
    const renderRestoreEnd = renderMessagesSource.indexOf('function findFirstRenderedTranscriptRoot', renderRestoreStart);
    assert.ok(renderRestoreStart >= 0 && renderRestoreEnd > renderRestoreStart, 'expected transcript restore helper');
    const renderRestoreSection = renderMessagesSource.slice(renderRestoreStart, renderRestoreEnd);
    const groupRenderStart = renderMessagesSource.indexOf('function renderTranscriptGroupRange');
    const groupRenderEnd = renderMessagesSource.indexOf('function createTranscriptHistoryControl', groupRenderStart);
    assert.ok(groupRenderStart >= 0 && groupRenderEnd > groupRenderStart, 'expected grouped transcript renderer');
    const groupRenderSection = renderMessagesSource.slice(groupRenderStart, groupRenderEnd);

	    assert.match(renderMessagesSource, /let wasNearBottomValue = false;/);
	    assert.match(renderMessagesSource, /function readWasNearBottom\(\) \{/);
	    assert.match(renderMessagesSource, /wasNearBottomValue = suppressAutoScroll \? false : isNearBottom\(\);/);
	    assert.match(mainSource, /const renderedMessages = restoreTranscriptMessages\(restoredMessageList, \{/);
	    assert.match(renderRestoreSection, /if \(transcriptRestoreGroups\.length === 0\) \{[\s\S]*replaceElementChildren\(messages, empty\);/);
	    assert.match(renderRestoreSection, /const restoreFragment = document\.createDocumentFragment\(\);/);
    assert.match(renderRestoreSection, /restoreFragment\.appendChild\(empty\);/);
    assert.match(renderRestoreSection, /messageAppendTarget = restoreFragment/);
    assert.match(renderRestoreSection, /messageAppendTarget = null/);
    assert.match(renderRestoreSection, /replaceElementChildren\(messages, restoreFragment\);/);
    assert.match(groupRenderSection, /for \(let groupIndex = start; groupIndex < end; groupIndex\+\+\)/);
    assert.match(groupRenderSection, /for \(let messageIndex = 0; messageIndex < group\.messageIds\.length; messageIndex\+\+\)/);
    assert.match(renderMessagesSource, /const TRANSCRIPT_INITIAL_GROUP_LIMIT = 24;/);
    assert.match(renderMessagesSource, /Math\.max\(0, transcriptRestoreGroups\.length - TRANSCRIPT_INITIAL_GROUP_LIMIT\)/);
    assert.match(renderMessagesSource, /if \(restoredTranscript\) turnEl\.dataset\.restored = 'true';/);
    assert.match(renderMessagesSource, /if \(restoredTranscript && el\.dataset\) el\.dataset\.restored = 'true';/);
    assert.match(
      fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8'),
      /\.turn\[data-restored="true"\],[\s\S]*\.message\[data-restored="true"\]\s*\{[\s\S]*animation: none;/
    );
    assert.match(mainSource, /case 'cleared':[\s\S]*?replaceElementChildren\(messages, empty\);/);
    assert.match(renderMessagesSource, /function\s+appendMessageRoot\(/);
    assert.match(renderMessagesSource, /function addMessage\(msg, options\) \{[\s\S]*?setDisplay\(empty, 'none'\);/);
    assert.match(mainSource, /case 'cleared':[\s\S]*?setDisplay\(empty, 'flex'\);/);
    assert.doesNotMatch(renderMessagesSource, /messages\.appendChild\(turnEl\)/);
    assert.doesNotMatch(mainSource, /messages\.innerHTML\s*=/);
    assert.doesNotMatch(mainSource, /messages\.appendChild\(empty\)/);
    assert.doesNotMatch(mainSource, /messages\.appendChild\(restoreFragment\)/);
    assert.doesNotMatch(restoreSection, /addMessage\(/);
    assert.doesNotMatch(renderRestoreSection, /for \(const msg of list\)/);
    assert.doesNotMatch(renderMessagesSource, /empty\.style\.display = 'none'/);
    assert.doesNotMatch(mainSource, /empty\.style\.display = '(?:flex|none)'/);
  });

  test('turn status and step updates avoid duplicate text display and class writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');

    const statusTextHelperStart = renderMessagesSource.indexOf('function setTurnStatusText');
    assert.ok(statusTextHelperStart >= 0, 'expected turn status text helper');
    const updateTurnStateStart = renderMessagesSource.indexOf('function updateTurnState');
    assert.ok(updateTurnStateStart >= 0, 'expected turn state helper');
    assert.ok(updateTurnStateStart > statusTextHelperStart, 'expected status text helper before turn state helper');
    const statusTextHelperSection = renderMessagesSource.slice(statusTextHelperStart, updateTurnStateStart);
    const updateTurnStateEnd = renderMessagesSource.indexOf('function startRetryCountdown', updateTurnStateStart);
    assert.ok(updateTurnStateEnd > updateTurnStateStart, 'expected retry helper after turn state helper');
    const updateTurnStateSection = renderMessagesSource.slice(updateTurnStateStart, updateTurnStateEnd);
    const retryEnd = renderMessagesSource.length;
    const retrySection = renderMessagesSource.slice(updateTurnStateEnd, retryEnd);
    const updateToolStart = mainSource.indexOf("case 'updateTool':");
    assert.ok(updateToolStart >= 0, 'expected updateTool branch');
    const updateToolEnd = mainSource.indexOf("case 'resolvedFileLinks':", updateToolStart);
    assert.ok(updateToolEnd > updateToolStart, 'expected resolvedFileLinks branch after updateTool');
    const updateToolSection = mainSource.slice(updateToolStart, updateToolEnd);
    const updateMessageStart = mainSource.indexOf("case 'updateMessage':");
    assert.ok(updateMessageStart >= 0, 'expected updateMessage branch');
    const updateMessageEnd = mainSource.indexOf("case 'processing':", updateMessageStart);
    assert.ok(updateMessageEnd > updateMessageStart, 'expected processing branch after updateMessage');
    const updateMessageSection = mainSource.slice(updateMessageStart, updateMessageEnd);
    const turnStatusStart = mainSource.indexOf("case 'turnStatus':");
    assert.ok(turnStatusStart >= 0, 'expected turnStatus branch');
    const turnStatusEnd = mainSource.indexOf("case 'setInput':", turnStatusStart);
    assert.ok(turnStatusEnd > turnStatusStart, 'expected setInput branch after turnStatus');
    const turnStatusSection = mainSource.slice(turnStatusStart, turnStatusEnd);
    const initStart = mainSource.indexOf("case 'init':");
    assert.ok(initStart >= 0, 'expected init branch');
    const initEnd = mainSource.indexOf("case 'inputNotice':", initStart);
    assert.ok(initEnd > initStart, 'expected inputNotice branch after init');
    const initSection = mainSource.slice(initStart, initEnd);
	    const clearedStart = mainSource.indexOf("case 'cleared':");
	    assert.ok(clearedStart >= 0, 'expected cleared branch');
	    const clearedEnd = mainSource.indexOf("case 'modelChanged':", clearedStart);
	    assert.ok(clearedEnd > clearedStart, 'expected modelChanged branch after cleared');
	    const clearedSection = mainSource.slice(clearedStart, clearedEnd);
			    assert.match(bootstrapSource, /function\s+setClassName\(/);
			    assert.match(bootstrapSource, /function\s+setDisplay\(/);
			    assert.match(bootstrapSource, /function\s+setElementHidden\(/);
		    assert.match(statusTextHelperSection, /const nextText = String\(text === undefined \|\| text === null \? '' : text\);/);
		    assert.match(statusTextHelperSection, /const nextTitle = nextText && nextText\.length > 80 \? nextText : '';/);
		    assert.match(statusTextHelperSection, /const textChanged = turnData\.statusRenderedText !== nextText;/);
		    assert.match(statusTextHelperSection, /const titleChanged = turnData\.statusRenderedTitle !== nextTitle;/);
		    assert.match(statusTextHelperSection, /if \(!textChanged && !titleChanged\) return;/);
		    assert.ok(
		      statusTextHelperSection.indexOf('turnData.statusRenderedText = nextText;') <
		        statusTextHelperSection.indexOf('if (textChanged) turnData.statusText.textContent = nextText;'),
		      'turn status cache should update before writing text'
		    );
		    assert.match(statusTextHelperSection, /if \(textChanged\) turnData\.statusText\.textContent = nextText;/);
		    assert.match(statusTextHelperSection, /if \(titleChanged\) turnData\.statusText\.title = nextTitle;/);
		    assert.doesNotMatch(statusTextHelperSection, /setTextContent\(turnData\.statusText/);
		    assert.doesNotMatch(statusTextHelperSection, /setTitle\(turnData\.statusText/);
	    assert.match(statusTextHelperSection, /function setTurnBusyState\(turnData, busy\)/);
	    assert.match(statusTextHelperSection, /turnData\.el\.getAttribute\('aria-busy'\) === nextValue/);
	    assert.match(statusTextHelperSection, /turnData\.el\.setAttribute\('aria-busy', nextValue\);/);
	    assert.match(htmlSource, /\.turn-status-bar \{[\s\S]*min-width: 0;/);
    assert.match(htmlSource, /\.turn-status-text \{[\s\S]*min-width: 0;[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
    assert.match(updateTurnStateSection, /setDisplay\(turnData\.statusBar, 'flex'\);/);
    assert.match(updateTurnStateSection, /setTurnBusyState\(turnData, processing\);/);
    assert.match(updateTurnStateSection, /setDisplay\(turnData\.spinner, ''\);/);
	    assert.match(updateTurnStateSection, /!hasNonWhitespaceText\(turnData\.statusRenderedText\)/);
    assert.match(updateTurnStateSection, /setTurnStatusText\(turnData, 'Thinking…'\);/);
    assert.ok(
      updateTurnStateSection.indexOf("turnData.statusStateKey = '';") <
        updateTurnStateSection.indexOf("setTurnStatusText(turnData, 'Thinking…');"),
      'processing turn state should invalidate cached terminal status before setting thinking text'
    );
	    assert.match(updateTurnStateSection, /setDisplay\(turnData\.statusBar, 'none'\);/);
	    assert.match(renderMessagesSource, /statusStateKey: '',/);
	    assert.match(renderMessagesSource, /statusRenderedText: '',/);
	    assert.match(renderMessagesSource, /statusRenderedTitle: '',/);
    assert.match(updateTurnStateSection, /function clearTurnStatusTimeout\(turnData\)/);
    assert.match(updateTurnStateSection, /function clearTurnRetryCountdown\(turnData\)/);
    assert.match(updateTurnStateSection, /function clearAllTurnTimers\(\)/);
    assert.match(updateTurnStateSection, /clearTurnRetryCountdown\(turnData\);/);
    assert.match(updateTurnStateSection, /clearTurnStatusTimeout\(turnData\);/);
	    assert.match(updateTurnStateSection, /for \(const turnData of turnEls\.values\(\)\) \{[\s\S]*clearTurnRetryCountdown\(turnData\);[\s\S]*clearTurnStatusTimeout\(turnData\);/);
	    assert.doesNotMatch(updateTurnStateSection, /turnEls\.forEach\(\(turnData\) =>/);
	    assert.doesNotMatch(renderMessagesSource, /turn-activity|turnActivity|activityCountEl/);
	    assert.doesNotMatch(bootstrapSource, /activityOpenStates|persistActivityOpenState|updateTurnActivitySummary/);
	    assert.doesNotMatch(mainSource, /updateTurnActivitySummary/);
	    assert.match(initSection, /clearAllTurnTimers\(\);[\s\S]*turnEls\.clear\(\);/);
    assert.match(clearedSection, /clearAllTurnTimers\(\);[\s\S]*turnEls\.clear\(\);/);
	    assert.strictEqual(
	      (clearedSection.match(/syncInputState\(\);/g) || []).length,
	      1,
	      'cleared branch should batch reset work behind one final control sync'
	    );
	    assert.match(clearedSection, /planPending = false;/);
	    assert.doesNotMatch(clearedSection, /setPlanPending\(false\)/);
	    assert.ok(
	      clearedSection.indexOf('planPending = false;') < clearedSection.indexOf('syncInputState();'),
	      'cleared branch should update plan state before the final control sync'
	    );
    assert.match(retrySection, /setTurnStatusText\(turnData, statusText\);/);
    assert.match(retrySection, /clearTurnRetryCountdown\(turnData\);[\s\S]*return;/);
    assert.match(retrySection, /clearTurnRetryCountdown\(turnData\);[\s\S]*turnData\.retryInterval = setInterval/);
    assert.match(retrySection, /turnData\.retryCleanupTimeout = setTimeout/);
    assert.doesNotMatch(retrySection, /const timerId = setInterval/);
    assert.doesNotMatch(retrySection, /clearInterval\(timerId\)/);
    assert.match(turnStatusSection, /const currentRetryInfo = turnData\.retryInfo \|\| null;/);
    assert.match(turnStatusSection, /currentRetryInfo\.attempt === data\.status\.attempt/);
    assert.match(turnStatusSection, /currentRetryInfo\.nextRetryTime === data\.status\.nextRetryTime/);
    assert.match(turnStatusSection, /currentRetryInfo\.message === data\.status\.message/);
    assert.match(turnStatusSection, /\(turnData\.retryInterval \|\| turnData\.retryCleanupTimeout\)/);
    assert.ok(
      turnStatusSection.indexOf('currentRetryInfo.attempt === data.status.attempt') <
        turnStatusSection.indexOf('clearTurnStatusTimeout(turnData);'),
      'duplicate active retry guard should run before clearing or restarting retry timers'
    );
	    assert.match(updateToolSection, /setDisplay\(turnData\.statusBar, 'flex'\);/);
	    assert.match(updateToolSection, /setDisplay\(turnData\.spinner, 'none'\);/);
	    assert.match(mainSource, /const planActivityDetailsByToolElement = new WeakMap\(\);/);
	    assert.match(mainSource, /function getToolPlanActivityDetails\(toolEl\)/);
	    assert.match(mainSource, /function findToolPlanActivityDetailsFromLayout\(toolEl\)/);
	    assert.match(mainSource, /function getCachedToolPlanActivityDetails\(toolEl\)/);
	    assert.match(mainSource, /planActivityDetailsByToolElement\.set\(toolEl, details\);/);
	    assert.match(mainSource, /const cachedDetails = planActivityDetailsByToolElement\.get\(toolEl\);/);
	    assert.match(mainSource, /cachedDetails\.contains\(toolEl\)/);
	    assert.match(mainSource, /planActivityDetailsByToolElement\.delete\(toolEl\);/);
	    assert.match(mainSource, /const cachedDetails = getCachedToolPlanActivityDetails\(toolEl\);[\s\S]*if \(cachedDetails\) return cachedDetails;[\s\S]*const layoutDetails = findToolPlanActivityDetailsFromLayout\(toolEl\);/);
	    assert.match(mainSource, /getCachedClosestElement\(toolEl, '\.plan-activity', planActivityDetailsByToolElement\)/);
	    assert.match(updateToolSection, /const details = getToolPlanActivityDetails\(toolEl\);/);
	    assert.doesNotMatch(updateToolSection, /toolEl\.closest\('\.plan-activity'\)/);
	    assert.match(updateToolSection, /const nextStatusText = 'Waiting approval: ' \+ \(updatedToolMessage\.toolCall\.name \|\| updatedToolMessage\.toolCall\.id \|\| 'Tool'\);/);
    assert.match(updateToolSection, /const approvalStatusKey = 'approval\\n' \+ nextStatusText;/);
    assert.match(updateToolSection, /const approvalStatusAlreadyCurrent = turnData\.statusStateKey === approvalStatusKey && turnHasNoPendingStatusWork\(turnData\);/);
    assert.match(updateToolSection, /if \(!approvalStatusAlreadyCurrent\) \{/);
    assert.ok(
      updateToolSection.indexOf('const approvalStatusAlreadyCurrent') <
        updateToolSection.indexOf('const statusBarWillChange'),
      'duplicate approval status guard should run before display/text reads'
    );
	    assert.match(updateToolSection, /const statusTextWillChange = turnData\.statusText && \(turnData\.statusRenderedText \|\| ''\) !== nextStatusText;/);
    assert.match(updateToolSection, /turnData\.currentStatus = '';/);
    assert.match(updateToolSection, /turnData\.statusStateKey = '';/);
    assert.match(updateToolSection, /turnData\.statusStateKey = approvalStatusKey;/);
    assert.match(updateToolSection, /turnData\.retryInfo = null;/);
    assert.match(updateToolSection, /clearTurnRetryCountdown\(turnData\);/);
    assert.match(updateToolSection, /clearTurnStatusTimeout\(turnData\);/);
    assert.ok(
      updateToolSection.indexOf("turnData.statusStateKey = '';") <
        updateToolSection.indexOf('setTurnStatusText(turnData, nextStatusText);'),
      'approval status should invalidate cached turn status before setting waiting text'
    );
    assert.match(updateToolSection, /setTurnStatusText\(turnData, nextStatusText\);/);
	    assert.match(renderMessagesSource, /const messageStepPartsCache = new WeakMap\(\);/);
	    assert.match(renderMessagesSource, /const stepRenderKeyByElement = new WeakMap\(\);/);
	    assert.match(renderMessagesSource, /function getContainedMessageCachedParts\(messageEl, cache, keys\)/);
	    assert.match(renderMessagesSource, /for \(let i = 0; i < keys\.length; i\+\+\)/);
	    assert.match(renderMessagesSource, /if \(!part \|\| !messageEl\.contains\(part\)\) \{[\s\S]*cache\.delete\(messageEl\);/);
	    assert.match(renderMessagesSource, /function findMessageStepPartsFromLayout\(messageEl\)/);
	    assert.match(renderMessagesSource, /const body = children\[0\];/);
	    assert.match(renderMessagesSource, /const footer = children\[1\];/);
	    assert.match(renderMessagesSource, /return rememberMessageStepParts\(messageEl, \{ body, mode, sep, model \}\);/);
	    assert.match(renderMessagesSource, /function getCachedMessageStepParts\(messageEl\)/);
	    assert.match(renderMessagesSource, /const cached = getContainedMessageCachedParts\(messageEl, messageStepPartsCache, \['body', 'mode', 'sep', 'model'\]\);[\s\S]*if \(cached\) return cached;/);
	    assert.match(renderMessagesSource, /const layoutParts = findMessageStepPartsFromLayout\(messageEl\);[\s\S]*if \(layoutParts\) return layoutParts;/);
	    assert.match(renderMessagesSource, /function getStepBody\(stepId\)/);
	    assert.match(renderMessagesSource, /const stepEl = messageEls\.get\(stepId\);[\s\S]*const cached = stepBodies\.get\(stepId\);/);
	    assert.match(renderMessagesSource, /typeof stepEl\.contains !== 'function' \|\| stepEl\.contains\(cached\)/);
	    assert.match(renderMessagesSource, /stepBodies\.delete\(stepId\);/);
	    assert.match(renderMessagesSource, /const parts = \{/);
    assert.match(renderMessagesSource, /body: messageEl\.querySelector\('\.step-body'\)/);
    assert.match(renderMessagesSource, /if \(parts\.body && parts\.mode && parts\.sep && parts\.model\) return rememberMessageStepParts\(messageEl, parts\);/);
    assert.match(renderMessagesSource, /return parts\.body \|\| parts\.mode \|\| parts\.sep \|\| parts\.model \? parts : null;/);
    assert.match(renderMessagesSource, /function getStepRenderDatasetKey\(renderKey\)/);
    assert.match(renderMessagesSource, /return getCompactRenderDatasetKey\(renderKey\);/);
    assert.match(renderMessagesSource, /function rememberStepRenderKey\(messageEl, renderKey\)/);
    assert.match(renderMessagesSource, /stepRenderKeyByElement\.set\(messageEl, key\);/);
    assert.match(renderMessagesSource, /messageEl\.dataset\.stepRenderKey = datasetKey;/);
    assert.match(renderMessagesSource, /function getRememberedStepRenderKey\(messageEl\)/);
    assert.match(renderMessagesSource, /function getStepRenderKey\(msg\)/);
    assert.match(renderMessagesSource, /function getStepRenderKey\(msg\)[\s\S]*const key = createCompactRenderKeyBuilder\(\);[\s\S]*appendCompactRenderKeyPart\(key, step\.status \|\| 'running'\);[\s\S]*appendCompactRenderKeyPart\(key, step\.mode \|\| 'Build'\);[\s\S]*appendCompactRenderKeyPart\(key, step\.model \|\| ''\);[\s\S]*return finishCompactRenderKey\(key\);[\s\S]*function getMessageRenderKey\(msg\)/);
    assert.match(renderMessagesSource, /rememberStepRenderKey\(el, getStepRenderKey\(msg\)\);/);
    assert.doesNotMatch(renderMessagesSource, /el\.dataset\.stepRenderKey = getStepRenderKey\(msg\);/);
    assert.match(renderMessagesSource, /rememberMessageStepParts\(el, \{ body, mode: modeEl, sep: sepEl, model: modelEl \}\);/);
    assert.match(updateMessageSection, /const nextStepRenderKey = typeof getStepRenderKey === 'function' \? getStepRenderKey\(updatedMessage\) : '';/);
    assert.match(updateMessageSection, /getRememberedStepRenderKey\(msgEl\) === nextStepRenderKey/);
    assert.match(updateMessageSection, /rememberStepRenderKey\(msgEl, nextStepRenderKey\);/);
    assert.doesNotMatch(updateMessageSection, /msgEl\.dataset\.stepRenderKey === nextStepRenderKey/);
    assert.doesNotMatch(updateMessageSection, /msgEl\.dataset\.stepRenderKey = nextStepRenderKey/);
    assert.match(updateMessageSection, /const stepParts = typeof getCachedMessageStepParts === 'function' \? getCachedMessageStepParts\(msgEl\) : null;/);
    assert.match(updateMessageSection, /const stepWillChange =/);
    assert.match(updateMessageSection, /if \(!stepWillChange\) \{/);
    assert.match(updateMessageSection, /const wasNearBottomStepUpdate = isNearBottom\(\);/);
    assert.match(updateMessageSection, /setClassName\(msgEl, nextClassName\);/);
    assert.match(updateMessageSection, /setTextContent\(modeEl, mode\);/);
    assert.match(updateMessageSection, /setDisplay\(sepEl, nextModelDisplay\);/);
    assert.match(updateMessageSection, /setTextContent\(modelEl, model\);/);
    assert.match(updateMessageSection, /setDisplay\(modelEl, nextModelDisplay\);/);
    assert.match(turnStatusSection, /setTurnStatusText\(turnData, 'Retrying: '/);
    assert.match(turnStatusSection, /clearTurnStatusTimeout\(turnData\);[\s\S]*turnData\.statusTimeout = setTimeout/);
    assert.match(mainSource, /function turnHasNoPendingStatusWork\(turnData\)/);
    assert.match(turnStatusSection, /turnData\.statusStateKey === 'done' && turnHasNoPendingStatusWork\(turnData\)/);
    assert.match(turnStatusSection, /turnData\.statusStateKey = 'done';/);
    assert.ok(
      turnStatusSection.indexOf("turnData.statusStateKey === 'done'") <
        turnStatusSection.indexOf("setTurnStatusText(turnData, '');"),
      'duplicate done status guard should run before text/display work'
    );
    assert.match(turnStatusSection, /const pausedStatusText = 'Paused \(' \+ \(data\.status\.reason \|\| 'permission denied'\) \+ '\)';/);
    assert.match(turnStatusSection, /const pausedStatusKey = 'paused\\n' \+ pausedStatusText;/);
    assert.match(turnStatusSection, /turnData\.statusStateKey === pausedStatusKey && turnHasNoPendingStatusWork\(turnData\)/);
    assert.match(turnStatusSection, /turnData\.statusStateKey = pausedStatusKey;/);
    assert.ok(
      turnStatusSection.indexOf('turnData.statusStateKey === pausedStatusKey') <
        turnStatusSection.indexOf('setTurnStatusText(turnData, pausedStatusText);'),
      'duplicate paused status guard should run before text/display work'
    );
    assert.match(turnStatusSection, /const errorStatusText = 'Error: ' \+ \(data\.status\.message \|\| 'unknown error'\);/);
    assert.match(turnStatusSection, /const errorStatusKey = 'error\\n' \+ errorStatusText;/);
    assert.match(turnStatusSection, /turnData\.statusStateKey === errorStatusKey && turnHasNoPendingStatusWork\(turnData\)/);
    assert.match(turnStatusSection, /turnData\.statusStateKey = errorStatusKey;/);
    assert.ok(
      turnStatusSection.indexOf('turnData.statusStateKey === errorStatusKey') <
        turnStatusSection.indexOf('setTurnStatusText(turnData, errorStatusText);'),
      'duplicate error status guard should run before text/display work'
    );
    assert.match(turnStatusSection, /const newStatus = hasNonWhitespaceText\(data\.status\.message\) \? data\.status\.message : 'Thinking…';/);
    assert.doesNotMatch(turnStatusSection, /data\.status\.message\.trim\(\)/);
    assert.match(turnStatusSection, /newStatus === turnData\.currentStatus/);
    assert.match(turnStatusSection, /!turnData\.statusTimeout/);
    assert.match(turnStatusSection, /!turnData\.retryInfo/);
    assert.match(turnStatusSection, /!turnData\.retryInterval/);
    assert.match(turnStatusSection, /!turnData\.retryCleanupTimeout/);
    assert.ok(
      turnStatusSection.indexOf('newStatus === turnData.currentStatus') <
        turnStatusSection.indexOf('const now = Date.now();'),
      'duplicate active running status guard should run before timer/display work'
    );
    assert.match(turnStatusSection, /turnData\.retryInfo = null;[\s\S]*clearTurnRetryCountdown\(turnData\);/);
    assert.doesNotMatch(turnStatusSection, /clearTimeout\(turnData\.statusTimeout\)/);
    assert.match(turnStatusSection, /setDisplay\(turnData\.statusBar, 'flex'\);/);
    assert.match(turnStatusSection, /setDisplay\(turnData\.spinner, data\.status\.type === 'running'/);
	    assert.match(turnStatusSection, /hasNonWhitespaceText\(turnData\.statusRenderedText\)/);
	    assert.doesNotMatch(updateTurnStateSection + retrySection + turnStatusSection, /turnData\.(?:statusBar|spinner)\.style\.display\s*=/);
	    assert.doesNotMatch(updateTurnStateSection + retrySection + turnStatusSection, /turnData\.statusText\.textContent\s*=/);
	    assert.doesNotMatch(updateTurnStateSection + retrySection + turnStatusSection, /setTextContent\(turnData\.statusText,/);
	    assert.doesNotMatch(updateTurnStateSection + turnStatusSection, /statusText\.textContent\.trim\(\)/);
	    assert.doesNotMatch(updateToolSection, /turnData\.(?:statusBar|spinner)\.style\.display\s*=/);
    assert.doesNotMatch(updateToolSection, /turnData\.statusText\.textContent\s*=/);
    assert.doesNotMatch(updateToolSection, /setTextContent\(turnData\.statusText,/);
    assert.doesNotMatch(updateMessageSection, /msgEl\.className\s*=/);
    assert.doesNotMatch(updateMessageSection, /(?:modeEl|modelEl)\.textContent\s*=/);
    assert.doesNotMatch(updateMessageSection, /(?:sepEl|modelEl)\.style\.display\s*=/);
    assert.doesNotMatch(updateMessageSection, /const wasNearBottomStepUpdate = isNearBottom\(\);[\s\S]*const status = data\.message\.step/);
  });

  test('transcript wheel handling ignores nested scrollable output surfaces', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const helperStart = bootstrapSource.indexOf('function hasScrollableDataMarker');
    assert.ok(helperStart >= 0, 'expected nested scroll target helper');
    const helperEnd = bootstrapSource.indexOf('function formatElapsed', helperStart);
    assert.ok(helperEnd > helperStart, 'expected end of nested scroll helper section');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);

    assert.match(helperSection, /function hasScrollableDataMarker\(el\)/);
    assert.match(helperSection, /el\.getAttribute\('data-scrollable'\) === 'true'/);
    assert.match(helperSection, /target = target\.parentElement \|\| target\.parentNode \|\| null;/);
    assert.match(helperSection, /if \(target === messages\) return null;/);
    assert.match(helperSection, /if \(hasScrollableDataMarker\(target\)\) return target;/);
    assert.doesNotMatch(helperSection, /\.closest\(/);
    assert.match(helperSection, /markMessagesScrollGesture\(\);/);
    assert.match(helperSection, /stopAutoScrollSettle\(\);/);
    assert.match(helperSection, /if \(Number\(event\.deltaY \|\| 0\) >= 0\) return;/);
    assert.match(helperSection, /if \(findNestedScrollableTarget\(event\)\) return;/);
    assert.match(helperSection, /setUserScrolledAway\(true\);/);
    assert.match(bootstrapSource, /messages\.addEventListener\('wheel', handleMessagesWheel, \{ passive: true \}\)/);
  });

  test('transcript bottom lock is coalesced and gated by user gestures', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const helperStart = bootstrapSource.indexOf('function updateMessagesOverflowAnchor');
    assert.ok(helperStart >= 0, 'expected centralized transcript scroll state helpers');
    const helperEnd = bootstrapSource.indexOf('function findNestedScrollableTarget', helperStart);
    assert.ok(helperEnd > helperStart, 'expected helper section before nested scroll handling');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
    const frameHelperStart = bootstrapSource.indexOf('function requestAnimationFrameHandle');
    assert.ok(frameHelperStart >= 0, 'expected shared animation frame scheduler');
    const frameHelperEnd = bootstrapSource.indexOf('function clearQueuedAnimationFrames', frameHelperStart);
    assert.ok(frameHelperEnd > frameHelperStart, 'expected frame helpers before queued-frame cleanup');
    const frameHelperSection = bootstrapSource.slice(frameHelperStart, frameHelperEnd);

    assert.match(bootstrapSource, /let\s+autoScrollFramePending\s*=\s*false/);
    assert.match(bootstrapSource, /const\s+AUTO_SCROLL_SETTLE_FRAMES\s*=\s*12/);
    assert.match(bootstrapSource, /let\s+autoScrollSettleFramesRemaining\s*=\s*0/);
    assert.match(bootstrapSource, /let\s+scrollStateFramePending\s*=\s*false/);
    assert.match(bootstrapSource, /let\s+scrollStateObservedUserGesture\s*=\s*false/);
    assert.match(bootstrapSource, /let\s+scrollStateObservedUserScrollUp\s*=\s*false/);
    assert.match(bootstrapSource, /let\s+lastObservedMessagesScrollTop\s*=\s*0/);
    assert.match(helperSection, /const nextOverflowAnchor = userScrolledAway && !transcriptScrollAnchorLocked \? 'auto' : 'none';/);
    assert.match(helperSection, /if \(messages\.style\.overflowAnchor !== nextOverflowAnchor\) \{/);
    assert.match(helperSection, /messages\.style\.overflowAnchor = nextOverflowAnchor;/);
    assert.doesNotMatch(helperSection, /messages\.style\.overflowAnchor = userScrolledAway \? 'auto' : 'none';/);
    assert.match(helperSection, /function\s+setUserScrolledAway\(value\)/);
    assert.match(helperSection, /if \(next\) stopAutoScrollSettle\(\);/);
    assert.match(helperSection, /function\s+markMessagesScrollGesture\(\)/);
    assert.match(helperSection, /function\s+hasMessagesScrollGesture\(\)/);
    assert.match(helperSection, /function\s+scheduleScrollStateUpdate\(\)/);
    assert.match(helperSection, /if \(hasMessagesScrollGesture\(\)\) \{/);
    assert.match(helperSection, /if \(scrollStateObservedUserGesture && currentScrollTop < lastObservedMessagesScrollTop\)/);
    assert.match(helperSection, /scrollStateObservedUserScrollUp = true;/);
    assert.match(helperSection, /const observedUserGesture = scrollStateObservedUserGesture;/);
    assert.match(helperSection, /const observedUserScrollUp = scrollStateObservedUserScrollUp;/);
    assert.match(helperSection, /if \(!observedUserGesture\) return;/);
    assert.match(helperSection, /scrollStateObservedUserScrollUp = false;/);
    assert.match(helperSection, /setUserScrolledAway\(observedUserScrollUp \? true : !isNearBottom\(\)\);/);
    assert.match(helperSection, /if \(scrollStateFramePending\) return;/);
    assert.doesNotMatch(helperSection, /setUserScrolledAway\(!isNearBottom\(\)\);/);
    assert.match(bootstrapSource, /function\s+requestAnimationFrameHandle\(callback\)/);
    assert.match(frameHelperSection, /window\.requestAnimationFrame\(runCallback\)/);
    assert.match(frameHelperSection, /window\.cancelAnimationFrame\(frame\)/);
    assert.doesNotMatch(frameHelperSection, /\.bind\(window\)/);
    assert.doesNotMatch(frameHelperSection, /try \{/);
    assert.doesNotMatch(frameHelperSection, /catch \{/);
    assert.match(helperSection, /requestAnimationFrameHandle\(flushScrollStateUpdate\)/);
    assert.match(helperSection, /function\s+canAutoScroll\(wasNearBottom\)/);
    assert.match(helperSection, /function\s+stopAutoScrollSettle\(\)/);
    assert.match(helperSection, /function\s+queueAutoScrollFrame\(\)/);
    assert.match(helperSection, /if \(autoScrollFramePending \|\| autoScrollSettleFramesRemaining <= 0\) return;/);
    assert.match(helperSection, /requestAnimationFrameHandle\(flushScheduledAutoScroll\)/);
    assert.match(helperSection, /autoScrollSettleFramesRemaining = AUTO_SCROLL_SETTLE_FRAMES;/);
    assert.match(helperSection, /autoScrollSettleFramesRemaining -= 1;/);
    assert.match(helperSection, /scrollMessagesToBottom\(\);[\s\S]*scheduleAutoScrollAfterLayout\(true\);/);
    assert.doesNotMatch(helperSection, /try \{/);
    assert.doesNotMatch(helperSection, /catch \{/);
    assert.doesNotMatch(helperSection, /requestAnimationFrame\(\(\) => maybeAutoScroll\(wasNearBottom\)\)/);
    assert.match(bootstrapSource, /setUserScrolledAway\(true\)/);
    assert.match(bootstrapSource, /messages\.addEventListener\('pointerdown', handleMessagesPointerDown, \{ passive: true \}\)/);
    assert.match(bootstrapSource, /messages\.addEventListener\('touchmove', handleMessagesTouchMove, \{ passive: true \}\)/);
    assert.match(bootstrapSource, /messages\.addEventListener\('keydown', handleMessagesKeyDown\)/);
    assert.match(bootstrapSource, /messages\.addEventListener\('scroll', scheduleScrollStateUpdate, \{ passive: true \}\)/);
    assert.doesNotMatch(bootstrapSource, /messages\.addEventListener\('scroll', \(\) => \{[\s\S]*?isNearBottom\(\)/);
  });

  test('composer textarea autosize is coalesced per frame', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const helperStart = bootstrapSource.indexOf('function applyInputLayout');
    assert.ok(helperStart >= 0, 'expected centralized input layout helpers');
    const helperEnd = bootstrapSource.indexOf('function applyInputHistoryValue', helperStart);
    assert.ok(helperEnd > helperStart, 'expected input layout helpers before input history');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
    const historyValueStart = bootstrapSource.indexOf('function applyInputHistoryValue', helperEnd);
    assert.ok(historyValueStart >= 0, 'expected input history value helper');
    const historyValueEnd = bootstrapSource.indexOf('function focusComposerInput', historyValueStart);
    assert.ok(historyValueEnd > historyValueStart, 'expected composer focus helper after input history value helper');
    const historyValueSection = bootstrapSource.slice(historyValueStart, historyValueEnd);
	    const focusHelperStart = bootstrapSource.indexOf('function focusComposerInput');
	    assert.ok(focusHelperStart >= 0, 'expected centralized composer focus helper');
	    const focusHelperEnd = bootstrapSource.indexOf('function navigateInputHistory', focusHelperStart);
	    assert.ok(focusHelperEnd > focusHelperStart, 'expected composer focus helper before input history navigation');
	    const focusHelperSection = bootstrapSource.slice(focusHelperStart, focusHelperEnd);
	    const historyStart = bootstrapSource.indexOf('function setInputHistoryEntries');
	    assert.ok(historyStart >= 0, 'expected input history setter');
	    const historyEnd = bootstrapSource.indexOf('function addToInputHistory', historyStart);
	    assert.ok(historyEnd > historyStart, 'expected input history append helper after setter');
	    const historySection = bootstrapSource.slice(historyStart, historyEnd);
	    const nonFocusHelperSources =
      bootstrapSource.slice(0, focusHelperStart) +
      bootstrapSource.slice(focusHelperEnd) +
      mainSource +
      renderUtilsSource;
    const inputListenerStart = bootstrapSource.indexOf("input.addEventListener('input'");
    assert.ok(inputListenerStart >= 0, 'expected input event listener');
    const inputListenerEnd = bootstrapSource.indexOf("input.addEventListener('click'", inputListenerStart);
    assert.ok(inputListenerEnd > inputListenerStart, 'expected input listener end');
    const inputListenerSection = bootstrapSource.slice(inputListenerStart, inputListenerEnd);
    const setInputStart = mainSource.indexOf("case 'setInput':");
    assert.ok(setInputStart >= 0, 'expected setInput branch');
    const focusInputStart = mainSource.indexOf("case 'focusInput':", setInputStart);
    assert.ok(focusInputStart > setInputStart, 'expected focusInput branch after setInput');
    const setInputSection = mainSource.slice(setInputStart, focusInputStart);
    const focusInputEnd = mainSource.indexOf('break;', focusInputStart);
    assert.ok(focusInputEnd > focusInputStart, 'expected focusInput branch end');
    const focusInputSection = mainSource.slice(focusInputStart, focusInputEnd);

		    assert.match(bootstrapSource, /let\s+inputLayoutFramePending\s*=\s*false/);
		    assert.match(historySection, /for \(let itemIndex = 0; itemIndex < next\.length; itemIndex\+\+\)/);
		    assert.match(historySection, /const item = next\[itemIndex\];/);
		    assert.match(historySection, /if \(stringListsEqual\(normalized, inputHistoryEntries\)\) return false;/);
		    assert.match(historySection, /inputHistoryEntries = normalized;/);
		    assert.match(historySection, /if \(inputHistoryIndex >= 0\) \{/);
		    assert.match(historySection, /return true;/);
		    assert.doesNotMatch(historySection, /for \(const item of next\)/);
	    assert.match(helperSection, /function\s+applyInputLayout\(\)/);
    assert.match(helperSection, /inputLayoutFramePending = false;/);
    assert.match(helperSection, /input\.style\.height = 'auto';/);
    assert.match(helperSection, /input\.style\.height = Math\.min\(input\.scrollHeight, 120\) \+ 'px';/);
	    assert.match(helperSection, /function\s+scheduleInputLayout\(\)/);
	    assert.match(helperSection, /if \(inputLayoutFramePending\) return;/);
	    assert.match(helperSection, /requestAnimationFrameHandle\(applyInputLayout\)/);
	    assert.match(helperSection, /function\s+updateInputLayout\(options\)/);
	    assert.match(helperSection, /if \(!options \|\| options\.clearButton !== false\) \{/);
	    assert.match(helperSection, /setClearInputButtonDisabled\(!hasNonWhitespaceText\(input\.value\) && pendingImageAttachments\.length === 0\);/);
	    assert.match(helperSection, /scheduleInputLayout\(\);/);
	    assert.match(historyValueSection, /const nextValue = typeof value === 'string' \? value : '';/);
	    assert.match(historyValueSection, /if \(input\.value !== nextValue\) \{[\s\S]*input\.value = nextValue;[\s\S]*updateInputLayout\(\{ clearButton: false \}\);[\s\S]*\}/);
	    assert.match(historyValueSection, /const pos = position === 'start' \? 0 : nextValue\.length;/);
	    assert.doesNotMatch(historyValueSection, /const pos = position === 'start' \? 0 : input\.value\.length;/);
	    assert.match(bootstrapSource, /let\s+clearInputButtonDisabledState\s*=\s*null/);
    assert.match(bootstrapSource, /function\s+setClearInputButtonDisabled\(disabled\)/);
    assert.match(bootstrapSource, /function\s+setPlaceholder\(/);
    assert.doesNotMatch(helperSection, /try \{/);
    assert.doesNotMatch(helperSection, /catch \{/);
    assert.doesNotMatch(helperSection, /\.trim\(\)/);
    assert.doesNotMatch(inputListenerSection, /scrollHeight/);
    assert.doesNotMatch(mainSource, /input\.style\.height = 'auto';[\s\S]*?input\.scrollHeight/);
    assert.match(focusHelperSection, /input\.focus\(\{ preventScroll: true \}\);/);
    assert.match(focusHelperSection, /input\.focus\(\);/);
    assert.doesNotMatch(nonFocusHelperSources, /input\.focus\(/);
    assert.match(setInputSection, /setValue\(input, data\.value === undefined \|\| data\.value === null \? '' : data\.value\);/);
    assert.doesNotMatch(setInputSection, /String\(data\.value \|\| ''\)/);
    assert.match(setInputSection, /setPlaceholder\(input, data\.placeholder\);/);
    assert.match(setInputSection, /updateInputLayout\(\);[\s\S]*focusComposerInput\(\);/);
    assert.match(focusInputSection, /!hasNonWhitespaceText\(input\.value\)/);
    assert.match(focusInputSection, /setPlaceholder\(input, data\.placeholder\);/);
    assert.match(focusInputSection, /updateInputLayout\(\);[\s\S]*focusComposerInput\(\);/);
    assert.doesNotMatch(focusInputSection, /\.trim\(\)/);
    assert.doesNotMatch(helperSection, /clearInputBtn\.disabled =/);
    assert.doesNotMatch(setInputSection + focusInputSection, /input\.(?:value|placeholder)\s*=/);
  });

		  test('input attachment renderer skips unchanged state', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const imageNameStart = bootstrapSource.indexOf('function inferImageFileName');
		    assert.ok(imageNameStart >= 0, 'expected image filename formatter');
		    const metaStart = bootstrapSource.indexOf('function formatImageAttachmentMeta');
		    assert.ok(metaStart >= 0, 'expected input attachment metadata formatter');
		    assert.ok(metaStart > imageNameStart, 'expected image metadata formatter after filename formatter');
		    const imageNameSection = bootstrapSource.slice(imageNameStart, metaStart);
	    const metaEnd = bootstrapSource.indexOf('function getImageFileMediaType', metaStart);
	    assert.ok(metaEnd > metaStart, 'expected media-type helper after attachment metadata formatter');
	    const metaSection = bootstrapSource.slice(metaStart, metaEnd);
	    const renderKeyStart = bootstrapSource.indexOf('function getInputAttachmentsRenderKey');
	    assert.ok(renderKeyStart >= 0, 'expected input attachment render key helper');
	    const visibilityStart = bootstrapSource.indexOf('function setInputAttachmentsVisible');
	    assert.ok(visibilityStart > renderKeyStart, 'expected input attachment visibility helper after render key helper');
	    const renderKeySection = bootstrapSource.slice(renderKeyStart, visibilityStart);
	    const renderStart = bootstrapSource.indexOf('function renderInputAttachments');
	    assert.ok(renderStart >= 0, 'expected input attachment renderer');
	    assert.ok(renderStart > visibilityStart, 'expected input attachment renderer after visibility helper');
	    const visibilitySection = bootstrapSource.slice(visibilityStart, renderStart);
    const renderEnd = bootstrapSource.indexOf('function clearPendingImageAttachments', renderStart);
    assert.ok(renderEnd > renderStart, 'expected end of input attachment renderer');
    const renderSection = bootstrapSource.slice(renderStart, renderEnd);

    assert.match(bootstrapSource, /let\s+lastInputAttachmentsRenderKey\s*=\s*''/);
    assert.match(bootstrapSource, /let\s+inputAttachmentsVisible\s*=\s*false/);
    assert.match(bootstrapSource, /const\s+inputAttachmentIdByRemoveButton\s*=\s*new WeakMap\(\);/);
	    assert.match(bootstrapSource, /function\s+getInputAttachmentsRenderKey\(\)/);
	    assert.match(renderKeySection, /const key = createCompactRenderStateKeyBuilder\(\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, pendingImageAttachments\.length\);/);
	    assert.match(renderKeySection, /for \(let i = 0; i < pendingImageAttachments\.length; i\+\+\)/);
	    assert.match(renderKeySection, /const attachment = pendingImageAttachments\[i\];/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, attachment && attachment\.id\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, attachment && attachment\.mediaType\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, attachment && attachment\.filename\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, attachment && attachment\.size\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, attachment && attachment\.dataUrl \? attachment\.dataUrl\.length : 0\);/);
	    assert.match(renderKeySection, /return finishCompactRenderStateKey\(key\);/);
	    assert.doesNotMatch(renderKeySection, /appendRenderKeyPart\(key,/);
	    assert.doesNotMatch(renderKeySection, /getCompactRenderStateKey\(key\)/);
	    assert.doesNotMatch(renderKeySection, /for \(const attachment of pendingImageAttachments\)/);
		    assert.doesNotMatch(bootstrapSource, /function\s+appendRenderKeyPart\(key, value\)/);
		    assert.match(bootstrapSource, /function\s+collectImageFilesFromItems\(items\)/);
		    assert.match(bootstrapSource, /function\s+startsWithImageMediaType\(mediaType\)/);
		    const collectStart = bootstrapSource.indexOf('function collectImageFilesFromItems');
		    assert.ok(collectStart >= 0, 'expected data transfer item collector');
		    const collectEnd = bootstrapSource.indexOf('function hasImageTransfer', collectStart);
		    assert.ok(collectEnd > collectStart, 'expected transfer detector after item collector');
		    const collectSection = bootstrapSource.slice(collectStart, collectEnd);
		    assert.match(collectSection, /if \(mediaType && !startsWithImageMediaType\(mediaType\)\) continue;/);
		    assert.match(collectSection, /if \(!mediaType && !isImageFile\(file\)\) \{/);
		    assert.doesNotMatch(collectSection, /toLowerCase\(\)/);
		    const mediaTypeStart = bootstrapSource.indexOf('function startsWithImageMediaType');
		    assert.ok(mediaTypeStart >= 0, 'expected image MIME prefix helper');
		    const mediaTypeEnd = bootstrapSource.indexOf('function isImageFile', mediaTypeStart);
		    assert.ok(mediaTypeEnd > mediaTypeStart, 'expected isImageFile after image MIME prefix helper');
		    const mediaTypeSection = bootstrapSource.slice(mediaTypeStart, mediaTypeEnd);
			    assert.match(mediaTypeSection, /\(value\[0\] === 'i' \|\| value\[0\] === 'I'\)/);
			    assert.match(mediaTypeSection, /value\[5\] === '\/'/);
			    assert.doesNotMatch(mediaTypeSection, /toLowerCase\(\)/);
			    assert.match(bootstrapSource, /const IMAGE_ATTACHMENT_MEDIA_EXT_UNSAFE_RE = \/\[\^a-z0-9\.\+-\]\/g;/);
			    assert.match(bootstrapSource, /const IMAGE_ATTACHMENT_DECIMAL_ZERO_SUFFIX_RE = \/\\\.0\$\/;/);
			    assert.match(bootstrapSource, /const IMAGE_ATTACHMENT_FILENAME_DISPLAY_LIMIT = 120;/);
			    assert.match(bootstrapSource, /const IMAGE_ATTACHMENT_META_DISPLAY_LIMIT = 120;/);
			    assert.match(imageNameSection, /replace\(IMAGE_ATTACHMENT_MEDIA_EXT_UNSAFE_RE, ''\)/);
			    assert.match(imageNameSection, /replace\(IMAGE_ATTACHMENT_DECIMAL_ZERO_SUFFIX_RE, ''\)/);
			    assert.match(imageNameSection, /function\s+getImageAttachmentDisplayFileName\(filename\)/);
			    assert.match(imageNameSection, /value\.length <= IMAGE_ATTACHMENT_FILENAME_DISPLAY_LIMIT/);
			    assert.match(imageNameSection, /value\.slice\(0, IMAGE_ATTACHMENT_FILENAME_DISPLAY_LIMIT\) \+ '…'/);
			    assert.match(imageNameSection, /function\s+getImageAttachmentDisplayMeta\(meta\)/);
			    assert.match(imageNameSection, /value\.length <= IMAGE_ATTACHMENT_META_DISPLAY_LIMIT/);
			    assert.match(imageNameSection, /value\.slice\(0, IMAGE_ATTACHMENT_META_DISPLAY_LIMIT\) \+ '…'/);
			    assert.doesNotMatch(imageNameSection, /\.replace\(\//);
			    assert.match(metaSection, /const meta = mediaType && size \? mediaType \+ ' · ' \+ size : \(mediaType \|\| size\);/);
	    assert.match(metaSection, /return getImageAttachmentDisplayMeta\(meta\);/);
	    assert.doesNotMatch(metaSection, /const parts = \[\]/);
	    assert.doesNotMatch(metaSection, /parts\.push/);
	    assert.doesNotMatch(metaSection, /parts\.join/);
	    assert.match(visibilitySection, /if \(inputAttachmentsVisible === visibleFlag\) return;/);
	    assert.match(visibilitySection, /inputAttachmentsVisible = visibleFlag;/);
	    assert.match(visibilitySection, /inputAttachments\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.doesNotMatch(visibilitySection, /setHidden\(inputAttachments/);
	    assert.match(renderSection, /const nextRenderKey = getInputAttachmentsRenderKey\(\);/);
    assert.match(renderSection, /if \(nextRenderKey === lastInputAttachmentsRenderKey\) return;/);
    assert.match(renderSection, /lastInputAttachmentsRenderKey = nextRenderKey;/);
    assert.match(renderSection, /setInputAttachmentsVisible\(false\);/);
    assert.match(renderSection, /setInputAttachmentsVisible\(true\);/);
    assert.match(renderSection, /replaceElementChildren\(inputAttachments\);/);
    assert.match(renderSection, /const fragment = pendingImageAttachments\.length > 1 \? document\.createDocumentFragment\(\) : null;/);
    assert.match(renderSection, /let singleChip = null;/);
    assert.match(renderSection, /if \(fragment\) \{[\s\S]*fragment\.appendChild\(chip\);[\s\S]*\} else \{[\s\S]*singleChip = chip;[\s\S]*\}/);
    assert.match(renderSection, /replaceElementChildren\(inputAttachments, fragment \|\| singleChip\);/);
    assert.doesNotMatch(renderSection, /const fragment = document\.createDocumentFragment\(\);/);
    assert.match(renderSection, /const displayFilename = getImageAttachmentDisplayFileName\(filename\);/);
    assert.match(renderSection, /chip\.title = displayFilename \+ \(meta \? ' · ' \+ meta : ''\);/);
    assert.match(renderSection, /label\.textContent = displayFilename;/);
    assert.match(renderSection, /const removeLabel = 'Remove image attachment: ' \+ displayFilename;/);
    assert.match(renderSection, /inputAttachmentIdByRemoveButton\.set\(removeBtn, attachment\.id\);/);
    assert.match(renderSection, /removeIcon\.setAttribute\('aria-hidden', 'true'\);/);
    assert.match(renderSection, /removeIcon\.textContent = '✕';/);
	    assert.match(renderSection, /removeBtn\.appendChild\(removeIcon\);/);
	    assert.doesNotMatch(renderSection, /setHidden\(inputAttachments/);
	    assert.doesNotMatch(renderSection, /inputAttachments\.classList\.(?:add|remove|toggle)\(['"]hidden['"]/);
	    assert.doesNotMatch(renderSection, /inputAttachments\.innerHTML\s*=/);
	    assert.doesNotMatch(renderSection, /inputAttachments\.appendChild\(fragment\)/);
	    assert.doesNotMatch(renderSection, /setAttribute\('aria-label', 'Remove image attachment'\)/);
	    assert.doesNotMatch(bootstrapSource, /dataset\.attachmentId/);
	    assert.match(bootstrapSource, /function findInputAttachmentRemoveButton\(target\)/);
	    assert.match(bootstrapSource, /if \(inputAttachmentIdByRemoveButton\.has\(el\)\) return el;/);
	    assert.match(bootstrapSource, /const removeButton = findInputAttachmentRemoveButton\(e && e\.target \? e\.target : null\);/);
	    assert.match(bootstrapSource, /const attachmentId = inputAttachmentIdByRemoveButton\.get\(removeButton\) \|\| '';/);
	    assert.doesNotMatch(bootstrapSource, /\.closest\('\.input-attachment-remove'\)/);

	    const serializeStart = bootstrapSource.indexOf('function serializePendingImageAttachments');
    assert.ok(serializeStart >= 0, 'expected input attachment serializer');
    const serializeEnd = bootstrapSource.indexOf('function clearPendingImageAttachments', serializeStart);
    assert.ok(serializeEnd > serializeStart, 'expected clear helper after attachment serializer');
    const serializeSection = bootstrapSource.slice(serializeStart, serializeEnd);
    assert.match(serializeSection, /const attachments = new Array\(pendingImageAttachments\.length\);/);
    assert.match(serializeSection, /for \(let i = 0; i < pendingImageAttachments\.length; i\+\+\)/);
    assert.match(serializeSection, /attachments\[i\] = serialized;/);
    assert.doesNotMatch(serializeSection, /\.map\(/);
    assert.doesNotMatch(bootstrapSource, /pendingImageAttachments\.map\(/);

    const removeStart = bootstrapSource.indexOf('function removePendingImageAttachmentById');
    assert.ok(removeStart >= 0, 'expected input attachment removal helper');
    const removeEnd = bootstrapSource.indexOf('function readFileAsDataUrl', removeStart);
    assert.ok(removeEnd > removeStart, 'expected image read helper after removal helper');
    const removeSection = bootstrapSource.slice(removeStart, removeEnd);
    assert.match(removeSection, /for \(let i = 0; i < pendingImageAttachments\.length; i\+\+\)/);
    assert.match(removeSection, /pendingImageAttachments\.splice\(i, 1\);/);
    assert.match(removeSection, /return;/);
    assert.doesNotMatch(removeSection, /\.filter\(/);

    const attachStart = bootstrapSource.indexOf('async function attachImageFiles');
    assert.ok(attachStart >= 0, 'expected image attachment intake helper');
    const attachEnd = bootstrapSource.indexOf('async function handleClipboardPaste', attachStart);
    assert.ok(attachEnd > attachStart, 'expected clipboard paste helper after image attachment intake helper');
    const attachSection = bootstrapSource.slice(attachStart, attachEnd);
    assert.match(attachSection, /const slotsLeft = MAX_IMAGE_ATTACHMENTS - pendingImageAttachments\.length;/);
    assert.match(attachSection, /for \(let i = 0; i < fileCount; i\+\+\)/);
    assert.match(attachSection, /if \(attachedCount >= slotsLeft\) \{/);
    assert.match(attachSection, /pendingImageAttachments\.push\(\{/);
    assert.match(attachSection, /attachedCount \+= 1;/);
    assert.doesNotMatch(attachSection, /imageCount > slotsLeft/);
	    assert.doesNotMatch(attachSection, /imageFiles\.slice\(0, slotsLeft\)/);
	    assert.doesNotMatch(attachSection, /pendingImageAttachments\.concat\(/);
	  });

	  test('webview id and image formatters reuse hoisted regexes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const section = (startText: string, endText: string): string => {
	      const start = bootstrapSource.indexOf(startText);
	      assert.ok(start >= 0, 'expected section start: ' + startText);
	      const end = bootstrapSource.indexOf(endText, start);
	      assert.ok(end > start, 'expected section end after ' + startText);
	      return bootstrapSource.slice(start, end);
	    };

	    const modelSection = section('function renderModelPickerSection', 'function getModelPickerListControlsDisabled');
	    const manualConfirmationSection = section('function renderManualToolConfirmation', 'function handleManualToolConfirmationRequired');
	    const toolStateSection = section('function updateToolsCatalogState', 'function updateSafetySettingsTitle');
	    const imageSection = section('function inferImageFileName', 'function getImageFileMediaType');

	    assert.match(bootstrapSource, /const MODEL_PICKER_SECTION_ID_UNSAFE_RE = \/\[\^a-z0-9\]\+\/g;/);
	    assert.match(bootstrapSource, /const TOOLS_CATALOG_DOM_ID_UNSAFE_RE = \/\[\^a-zA-Z0-9_-\]\+\/g;/);
	    assert.match(bootstrapSource, /const IMAGE_ATTACHMENT_MEDIA_EXT_UNSAFE_RE = \/\[\^a-z0-9\.\+-\]\/g;/);
	    assert.match(bootstrapSource, /const IMAGE_ATTACHMENT_DECIMAL_ZERO_SUFFIX_RE = \/\\\.0\$\/;/);
	    assert.match(modelSection, /replace\(MODEL_PICKER_SECTION_ID_UNSAFE_RE, '-'\)/);
	    assert.match(manualConfirmationSection, /replace\(TOOLS_CATALOG_DOM_ID_UNSAFE_RE, '-'\)/);
	    assert.match(toolStateSection, /statusEl\.id = 'toolsCatalogRunStatus-' \+ index;/);
	    assert.doesNotMatch(toolStateSection, /toolId\.replace\(TOOLS_CATALOG_DOM_ID_UNSAFE_RE/);
	    assert.match(imageSection, /replace\(IMAGE_ATTACHMENT_MEDIA_EXT_UNSAFE_RE, ''\)/);
	    assert.match(imageSection, /replace\(IMAGE_ATTACHMENT_DECIMAL_ZERO_SUFFIX_RE, ''\)/);
	    assert.doesNotMatch(modelSection + manualConfirmationSection + toolStateSection + imageSection, /\.replace\(\//);
	  });

  test('image drag visual state skips duplicate class writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const dragStart = bootstrapSource.indexOf('function setInputImageDragActive');
    assert.ok(dragStart >= 0, 'expected image drag visual state helper');
    const dragEnd = bootstrapSource.indexOf('function clearInputImageDragState', dragStart);
    assert.ok(dragEnd > dragStart, 'expected clear helper after image drag visual state helper');
    const dragSection = bootstrapSource.slice(dragStart, dragEnd);
    const dragleaveStart = bootstrapSource.indexOf("inputComposer.addEventListener('dragleave'");
    assert.ok(dragleaveStart > dragEnd, 'expected image dragleave listener after image drag helpers');
    const dragleaveEnd = bootstrapSource.indexOf("inputComposer.addEventListener('drop'", dragleaveStart);
    assert.ok(dragleaveEnd > dragleaveStart, 'expected drop listener after image dragleave listener');
    const dragleaveSection = bootstrapSource.slice(dragleaveStart, dragleaveEnd);
    const dropEnd = bootstrapSource.indexOf("if (inputAttachments)", dragleaveEnd);
    assert.ok(dropEnd > dragleaveEnd, 'expected input attachments listener after image drop listener');
    const dropSection = bootstrapSource.slice(dragleaveEnd, dropEnd);

    assert.match(bootstrapSource, /let\s+inputImageDragActive\s*=\s*false/);
    assert.match(dragSection, /const activeFlag = !!active;/);
    assert.match(dragSection, /if \(inputImageDragActive === activeFlag\) return;/);
    assert.match(dragSection, /inputImageDragActive = activeFlag;/);
    assert.match(dragSection, /inputComposer\.classList\.toggle\('drag-over', activeFlag\);/);
    assert.match(dragSection, /function hasInputImageDragActiveState\(\)/);
    assert.match(dragSection, /return inputImageDragActive;/);
    assert.doesNotMatch(dragSection, /classList\.contains\('drag-over'/);
    assert.doesNotMatch(dragSection, /setClassPresence\(inputComposer, 'drag-over'/);
    assert.match(dragleaveSection, /!inputImageDragDepth && !hasInputImageDragActiveState\(\)/);
	    assert.match(dragleaveSection, /if \(!inputImageDragDepth\) \{[\s\S]*clearInputImageDragState\(\);[\s\S]*return;/);
	    assert.match(bootstrapSource, /startsWithImageMediaType\(type\)/);
    assert.match(dropSection, /if \(!initReceived \|\| !hasImageTransfer\(e\.dataTransfer\)\) \{[\s\S]*hasInputImageDragActiveState\(\)[\s\S]*clearInputImageDragState\(\);[\s\S]*return;/);
    assert.match(dropSection, /let dropFiles = e\.dataTransfer \? e\.dataTransfer\.files : null;/);
    assert.match(dropSection, /if \(e\.dataTransfer && getArrayLikeLength\(e\.dataTransfer\.items\) > 0\) \{/);
    assert.match(dropSection, /const imageItems = collectImageFilesFromItems\(e\.dataTransfer\.items\);/);
    assert.match(dropSection, /if \(imageItems\.files\.length > 0 \|\| getArrayLikeLength\(dropFiles\) === 0\) \{/);
    assert.match(dropSection, /attachImageFiles\(dropFiles, \{[\s\S]*source: 'dropped'[\s\S]*skippedUnreadable,/);
	    assert.doesNotMatch(bootstrapSource.slice(bootstrapSource.indexOf('function collectImageFilesFromItems'), bootstrapSource.indexOf('async function attachImageFiles')), /toLowerCase\(\)/);
	  });

  test('queue live banner updates are idempotent', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const html = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
    const statusTag = html.match(/<div\b[^>]*\bid="queueStatus"[^>]*>/i)?.[0] || '';
    const bannerTag = html.match(/<div\b[^>]*\bid="queueBanner"[^>]*>/i)?.[0] || '';
    const itemsTag = html.match(/<div\b[^>]*\bid="queueItems"[^>]*>/i)?.[0] || '';
	    const queueKeyHelperStart = bootstrapSource.indexOf('function getQueuedInputId');
    assert.ok(queueKeyHelperStart >= 0, 'expected queued input render helper');
    const queueVisibilityStart = bootstrapSource.indexOf('function setQueueBannerVisible', queueKeyHelperStart);
    assert.ok(queueVisibilityStart > queueKeyHelperStart, 'expected queue banner visibility helper after queue key helpers');
    const queueKeyHelperEnd = queueVisibilityStart;
    const queueKeyHelperSection = bootstrapSource.slice(queueKeyHelperStart, queueKeyHelperEnd);
    const helperStart = bootstrapSource.indexOf('function setQueueBannerState', queueVisibilityStart);
    assert.ok(helperStart >= 0, 'expected queue banner state helper');
    const visibilitySection = bootstrapSource.slice(queueVisibilityStart, helperStart);
    const helperEnd = bootstrapSource.indexOf('function setQueueState', helperStart);
    assert.ok(helperEnd > helperStart, 'expected queue banner helper before setQueueState');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
    const setQueueStart = bootstrapSource.indexOf('function setQueueState');
    assert.ok(setQueueStart >= 0, 'expected setQueueState');
    const setQueueEnd = bootstrapSource.indexOf('if (!options || options.sync !== false) syncInputState();', setQueueStart);
    assert.ok(setQueueEnd > setQueueStart, 'expected setQueueState body');
    const setQueueSection = bootstrapSource.slice(setQueueStart, setQueueEnd);
    const queueLabelStart = bootstrapSource.indexOf('function getQueueItemLabelElement');
    assert.ok(queueLabelStart >= 0, 'expected queue item label lookup helper');
    const queueLabelEnd = bootstrapSource.indexOf('function syncQueueItemControls', queueLabelStart);
    assert.ok(queueLabelEnd > queueLabelStart, 'expected queue controls sync helper after label lookup helper');
    const queueLabelSection = bootstrapSource.slice(queueLabelStart, queueLabelEnd);
    const queueSyncEnd = bootstrapSource.indexOf('function setSendButtonPresentation', queueLabelEnd);
    assert.ok(queueSyncEnd > queueLabelEnd, 'expected send button helper after queue controls sync helper');
    const queueSyncSection = bootstrapSource.slice(queueLabelEnd, queueSyncEnd);
    const queueStateCaseStart = mainSource.indexOf("case 'queueState':");
    assert.ok(queueStateCaseStart >= 0, 'expected queueState branch');
    const queueStateCaseEnd = mainSource.indexOf("case 'settingsState':", queueStateCaseStart);
    assert.ok(queueStateCaseEnd > queueStateCaseStart, 'expected settingsState branch after queueState');
    const queueStateSection = mainSource.slice(queueStateCaseStart, queueStateCaseEnd);

    assert.match(statusTag, /\brole="status"/);
    assert.match(statusTag, /\baria-live="polite"/);
    assert.match(statusTag, /\baria-atomic="true"/);
	    assert.match(bannerTag, /\brole="group"/);
	    assert.match(bannerTag, /\baria-label="Message queue"/);
	    assert.doesNotMatch(bannerTag, /\baria-live=/);
	    assert.match(itemsTag, /\brole="group"/);
	    assert.match(itemsTag, /\btabindex="0"/);
	    assert.match(itemsTag, /\bdata-scrollable="true"/);
	    assert.match(itemsTag, /\baria-label="Queued messages"/);
	    assert.doesNotMatch(itemsTag, /\brole="list"/);
	    assert.match(html, /\.queue-items\s*\{[\s\S]*?max-height:\s*min\(32vh, 260px\);[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/);
	    assert.match(html, /\.queue-items:focus-visible\s*\{[\s\S]*?outline: 1px solid var\(--vscode-focusBorder\);[\s\S]*?outline-offset:\s*-2px;/);
	    assert.match(bootstrapSource, /let\s+lastQueueBannerRenderKey\s*=\s*''/);
	    assert.match(bootstrapSource, /let\s+queueBannerVisible\s*=\s*false/);
	    assert.match(bootstrapSource, /let\s+lastQueueInputsStateKey\s*=\s*''/);
	    assert.match(bootstrapSource, /let\s+lastQueueInputsRenderState\s*=\s*null/);
	    assert.match(bootstrapSource, /const\s+queueItemIdByButton\s*=\s*new WeakMap\(\);/);
	    assert.match(bootstrapSource, /const\s+queueItemLabelElementCache\s*=\s*new WeakMap\(\);/);
		    assert.match(bootstrapSource, /const QUEUE_ITEM_PREVIEW_LIMIT = 96;/);
		    assert.match(queueKeyHelperSection, /function getQueuedInputId\(item\)/);
		    assert.doesNotMatch(queueKeyHelperSection, /function getCompactRenderStateKey\(renderKey\)/);
		    assert.doesNotMatch(queueKeyHelperSection, /typeof getCompactRenderDatasetKey === 'function'/);
		    assert.doesNotMatch(queueKeyHelperSection, /getCompactRenderDatasetKey\(key\)/);
		    assert.match(queueKeyHelperSection, /function isQueuedInputPreviewWhitespaceCode\(code\)/);
		    assert.match(queueKeyHelperSection, /\(code >= 9 && code <= 13\)/);
		    assert.match(queueKeyHelperSection, /code === 160/);
		    assert.match(queueKeyHelperSection, /code === 12288/);
		    assert.match(queueKeyHelperSection, /\(code >= 8192 && code <= 8202\)/);
		    assert.match(queueKeyHelperSection, /function getQueuedInputPreviewText\(value\)/);
		    assert.match(queueKeyHelperSection, /isQueuedInputPreviewWhitespaceCode\(text\.charCodeAt\(start\)\)/);
		    assert.match(queueKeyHelperSection, /isQueuedInputPreviewWhitespaceCode\(text\.charCodeAt\(end - 1\)\)/);
		    assert.match(queueKeyHelperSection, /trimmedLength > QUEUE_ITEM_PREVIEW_LIMIT/);
	    assert.match(queueKeyHelperSection, /text\.slice\(start, start \+ QUEUE_ITEM_PREVIEW_LIMIT - 3\) \+ '…'/);
	    assert.match(queueKeyHelperSection, /function getQueuedInputRenderInfo\(item, knownId\)/);
	    assert.match(queueKeyHelperSection, /const rawDisplayContent = item && typeof item === 'object' \? item\.displayContent : '';/);
	    assert.match(queueKeyHelperSection, /const displayContent = getQueuedInputPreviewText\(rawDisplayContent\);/);
	    assert.match(queueKeyHelperSection, /const rawMessage = item && typeof item === 'object' \? item\.message : '';/);
	    assert.match(queueKeyHelperSection, /const preview = displayContent \|\| getQueuedInputPreviewText\(rawMessage\);/);
	    assert.match(queueKeyHelperSection, /function normalizeQueuedAttachmentCount\(value\)/);
	    assert.match(queueKeyHelperSection, /return Number\.isInteger\(count\) && count > 0 \? count : 0;/);
	    assert.match(queueKeyHelperSection, /const attachmentCount = normalizeQueuedAttachmentCount\(item && typeof item === 'object' \? item\.attachmentCount : 0\);/);
	    assert.match(queueKeyHelperSection, /attachmentCount,/);
	    assert.match(queueKeyHelperSection, /function getQueueItemAriaLabel\(renderItem\)/);
	    assert.match(queueKeyHelperSection, /const label = String\(renderItem && renderItem\.label \? renderItem\.label : 'Queued message'\)\.trim\(\) \|\| 'Queued message';/);
	    assert.match(queueKeyHelperSection, /const attachmentCount = normalizeQueuedAttachmentCount\(renderItem && renderItem\.attachmentCount\);/);
	    assert.match(queueKeyHelperSection, /let ariaLabel = preview \? label \+ ': ' \+ preview : label;/);
	    assert.match(queueKeyHelperSection, /ariaLabel \+= attachmentCount === 1 \? ', 1 image attached' : ', ' \+ attachmentCount \+ ' images attached';/);
	    assert.match(queueKeyHelperSection, /function getQueueInputsRenderState\(next\)/);
	    assert.match(queueKeyHelperSection, /function getQueueInputsStateKey\(next\)/);
	    assert.match(queueKeyHelperSection, /function getCurrentRenderableQueueCount\(\)/);
	    assert.match(queueKeyHelperSection, /lastQueueInputsRenderState\.renderableCount/);
	    assert.match(queueKeyHelperSection, /let visibleCount = 0;/);
	    assert.match(queueKeyHelperSection, /let renderableCount = 0;/);
	    assert.match(queueKeyHelperSection, /const visibleRenderBases = \[\];/);
	    assert.match(queueKeyHelperSection, /for \(let queueIndex = 0; queueIndex < list\.length; queueIndex\+\+\)/);
	    assert.match(queueKeyHelperSection, /const item = list\[queueIndex\];/);
	    assert.doesNotMatch(queueKeyHelperSection, /for \(const item of list\)/);
	    assert.match(queueKeyHelperSection, /if \(visibleCount >= QUEUE_ITEMS_RENDER_LIMIT\) continue;/);
	    assert.ok(
	      queueKeyHelperSection.indexOf('if (visibleCount >= QUEUE_ITEMS_RENDER_LIMIT) continue;') <
	        queueKeyHelperSection.indexOf('const renderInfo = getQueuedInputRenderInfo(item, itemId);'),
	      'expected hidden non-pending queue rows to skip preview normalization while building render state'
	    );
	    assert.match(queueKeyHelperSection, /if \(renderInfo\) visibleRenderBases\.push\(renderInfo\);/);
		    assert.match(queueKeyHelperSection, /const key = createCompactRenderStateKeyBuilder\(\);/);
		    assert.match(queueKeyHelperSection, /appendCompactRenderStateKeyPart\(key, list\.length\);/);
		    assert.match(queueKeyHelperSection, /appendCompactRenderStateKeyPart\(key, renderInfo \? renderInfo\.id : ''\);/);
		    assert.match(queueKeyHelperSection, /appendCompactRenderStateKeyPart\(key, renderInfo \? renderInfo\.preview : ''\);/);
		    assert.match(queueKeyHelperSection, /appendCompactRenderStateKeyPart\(key, renderInfo \? renderInfo\.attachmentCount : ''\);/);
		    assert.match(queueKeyHelperSection, /appendCompactRenderStateKeyPart\(key, renderableCount\);/);
	    assert.match(queueKeyHelperSection, /const renderKey = finishCompactRenderStateKey\(key\);/);
	    assert.doesNotMatch(queueKeyHelperSection, /key = appendRenderKeyPart\(key, renderableCount\);/);
	    assert.doesNotMatch(queueKeyHelperSection, /Number\.isFinite\(attachmentCount\)/);
	    assert.doesNotMatch(queueKeyHelperSection, /Math\.floor\(attachmentCount\)/);
		    assert.doesNotMatch(queueKeyHelperSection, /key = getCompactRenderStateKey\(key\);/);
		    assert.doesNotMatch(queueKeyHelperSection, /\.charAt\([^)]*\)\.trim\(\)/);
		    assert.doesNotMatch(queueKeyHelperSection, /rawDisplayContent\.trim\(\)/);
	    assert.doesNotMatch(queueKeyHelperSection, /rawMessage\.trim\(\)/);
	    assert.doesNotMatch(queueKeyHelperSection, /previewRaw/);
	    assert.match(queueKeyHelperSection, /function isQueueInputsRenderState\(value\)/);
	    assert.match(queueKeyHelperSection, /function isQueueRenderStateCurrent\(renderState\)/);
	    assert.match(queueKeyHelperSection, /function isQueueStateCurrent\(next\)/);
	    assert.match(queueKeyHelperSection, /return getQueueInputsRenderState\(next\)\.key;/);
	    assert.match(queueKeyHelperSection, /return isQueueRenderStateCurrent\(getQueueInputsRenderState\(next\)\);/);
	    assert.match(visibilitySection, /if \(queueBannerVisible === visibleFlag\) return;/);
	    assert.match(visibilitySection, /queueBannerVisible = visibleFlag;/);
	    assert.match(visibilitySection, /queueBanner\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.doesNotMatch(visibilitySection, /setHidden\(queueBanner/);
    assert.match(helperSection, /const nextQueueBannerRenderKeyBuilder = createCompactRenderStateKeyBuilder\(\);/);
    assert.match(helperSection, /appendCompactRenderStateKeyPart\(nextQueueBannerRenderKeyBuilder, count\);/);
    assert.match(helperSection, /appendCompactRenderStateKeyPart\(nextQueueBannerRenderKeyBuilder, isProcessing \? '1' : '0'\);/);
    assert.match(helperSection, /const nextQueueBannerRenderKey = finishCompactRenderStateKey\(nextQueueBannerRenderKeyBuilder\);/);
    assert.match(helperSection, /if \(nextQueueBannerRenderKey === lastQueueBannerRenderKey\) return;/);
    assert.match(helperSection, /lastQueueBannerRenderKey = nextQueueBannerRenderKey;/);
    assert.match(helperSection, /setQueueBannerVisible\(false\);/);
    assert.match(helperSection, /setQueueBannerVisible\(true\);/);
    assert.match(helperSection, /const queueCountText = count === 1 \? '1 queued' : count \+ ' queued';/);
    assert.match(helperSection, /const queueText = isProcessing \? 'Queued for the next step' : 'Queued messages ready to run';/);
    assert.match(helperSection, /setTextContent\(queueBannerCount, queueCountText\);/);
    assert.match(helperSection, /setTextContent\(queueBannerText, queueText\);/);
	    assert.match(helperSection, /setTextContent\(queueBannerHint, queueHint\);/);
	    assert.match(helperSection, /setTextContent\(queueStatus, 'No queued messages\.'\);/);
	    assert.match(helperSection, /setTextContent\(queueStatus, queueCountText \+ '\. ' \+ queueText \+ '\.'\);/);
	    assert.match(setQueueSection, /let fragment = null;/);
	    assert.match(setQueueSection, /let singleQueueChild = null;/);
	    assert.match(setQueueSection, /function appendQueueChild\(child\)/);
	    assert.match(setQueueSection, /if \(singleQueueChild\) \{[\s\S]*fragment = document\.createDocumentFragment\(\);[\s\S]*fragment\.appendChild\(singleQueueChild\);[\s\S]*singleQueueChild = null;[\s\S]*fragment\.appendChild\(child\);[\s\S]*\}/);
	    assert.match(setQueueSection, /fragment = document\.createDocumentFragment\(\);/);
	    assert.match(setQueueSection, /appendQueueChild\(btn\);/);
	    assert.match(setQueueSection, /appendQueueChild\(moreEl\);/);
	    assert.match(setQueueSection, /replaceElementChildren\(queueItems, fragment \|\| singleQueueChild\);/);
	    assert.doesNotMatch(setQueueSection, /const fragment = document\.createDocumentFragment\(\);/);
	    assert.doesNotMatch(setQueueSection, /if \(renderItems\.length > 0 \|\| renderableCount > renderItems\.length\) \{/);
	    assert.doesNotMatch(setQueueSection, /queueItems\.innerHTML = '';/);
	    assert.doesNotMatch(setQueueSection, /queueItems\.appendChild\(fragment\);/);
	    assert.match(setQueueSection, /const queueInputsRenderState = isQueueInputsRenderState\(next\)[\s\S]*\? next[\s\S]*: getQueueInputsRenderState\(next\);/);
	    assert.match(setQueueSection, /const nextQueueInputsStateKey = queueInputsRenderState\.key;/);
	    assert.match(setQueueSection, /lastQueueInputsRenderState = queueInputsRenderState;/);
	    assert.match(setQueueSection, /queuedInputs = queueInputsRenderState\.list;/);
	    assert.match(setQueueSection, /const count = queueInputsRenderState\.renderableCount;/);
	    assert.match(setQueueSection, /setQueueBannerState\(count\);/);
	    assert.match(setQueueSection, /const renderableCount = count;/);
	    assert.match(setQueueSection, /const visibleRenderBases = queueInputsRenderState\.visibleRenderBases;/);
	    assert.match(setQueueSection, /for \(let queueRenderIndex = 0; queueRenderIndex < visibleRenderBases\.length; queueRenderIndex\+\+\)/);
	    assert.match(setQueueSection, /const renderBase = visibleRenderBases\[queueRenderIndex\];/);
	    assert.doesNotMatch(setQueueSection, /for \(const renderBase of queueInputsRenderState\.visibleRenderBases\)/);
	    assert.match(setQueueSection, /const itemPending = queueSteerPendingId === renderBase\.id;/);
	    assert.match(setQueueSection, /if \(queueSteerPendingId && !pendingItemInVisibleRows && renderItems\.length >= QUEUE_ITEMS_RENDER_LIMIT\)/);
	    assert.match(setQueueSection, /for \(let queueIndex = 0; queueIndex < queuedInputs\.length; queueIndex\+\+\)/);
	    assert.match(setQueueSection, /const item = queuedInputs\[queueIndex\];/);
	    assert.doesNotMatch(setQueueSection, /for \(const item of queuedInputs\)/);
	    assert.match(setQueueSection, /const renderBase = getQueuedInputRenderInfo\(item, itemId\);/);
    assert.match(setQueueSection, /setDisabled\(queueClearBtn, !initReceived \|\| count <= 0 \|\| queueActionBusy\);/);
	    assert.match(bootstrapSource, /const queuedCount = getCurrentRenderableQueueCount\(\);/);
	    assert.match(bootstrapSource, /getCurrentRenderableQueueCount\(\) <= 0/);
	    assert.doesNotMatch(setQueueSection, /const count = queuedInputs\.length;/);
	    assert.doesNotMatch(bootstrapSource, /const queuedCount = Array\.isArray\(queuedInputs\) \? queuedInputs\.length : 0;/);
	    assert.match(bootstrapSource, /function syncQueueItemControls\(renderItems\)/);
	    assert.match(bootstrapSource, /function requestSteerQueuedInput\(id\)/);
	    assert.match(bootstrapSource, /function findQueueItemButton\(target\)/);
	    assert.match(bootstrapSource, /function handleQueueItemsClick\(e\)/);
	    assert.match(bootstrapSource, /queueItems\.addEventListener\('click', handleQueueItemsClick\);/);
	    assert.match(bootstrapSource, /let\s+lastQueueActionStateKey\s*=\s*''/);
	    assert.match(setQueueSection, /queueItemIdByButton\.set\(btn, renderItem\.id\);/);
	    assert.match(setQueueSection, /queueItemLabelElementCache\.set\(btn, labelEl\);/);
	    assert.match(setQueueSection, /btn\.setAttribute\('aria-label', getQueueItemAriaLabel\(renderItem\)\);/);
	    assert.doesNotMatch(setQueueSection, /btn\.addEventListener\('click'/);
	    assert.match(setQueueSection, /const nextQueueItemsRenderKeyBuilder = createCompactRenderStateKeyBuilder\(\);/);
	    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueItemsRenderKeyBuilder, renderableCount\);/);
	    assert.match(setQueueSection, /for \(let renderIndex = 0; renderIndex < renderItems\.length; renderIndex\+\+\)/);
	    assert.strictEqual(
	      (setQueueSection.match(/for \(let renderIndex = 0; renderIndex < renderItems\.length; renderIndex\+\+\)/g) || []).length,
	      2,
	      'expected queue render-key and DOM build passes to use indexed render item loops'
	    );
	    assert.match(setQueueSection, /const renderItem = renderItems\[renderIndex\];/);
	    assert.doesNotMatch(setQueueSection, /for \(const renderItem of renderItems\)/);
	    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueItemsRenderKeyBuilder, renderItem\.id\);/);
	    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueItemsRenderKeyBuilder, renderItem\.preview\);/);
	    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueItemsRenderKeyBuilder, renderItem\.attachmentCount\);/);
	    assert.match(setQueueSection, /const nextQueueItemsRenderKey = finishCompactRenderStateKey\(nextQueueItemsRenderKeyBuilder\);/);
	    assert.match(setQueueSection, /const nextQueueActionStateKeyBuilder = createCompactRenderStateKeyBuilder\(\);/);
	    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueActionStateKeyBuilder, initReceived \? '1' : '0'\);/);
	    assert.doesNotMatch(setQueueSection, /nextQueueItemsRenderKey = getCompactRenderStateKey\(nextQueueItemsRenderKey\);/);
    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueActionStateKeyBuilder, queueActionBusy \? '1' : '0'\);/);
    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueActionStateKeyBuilder, queueSteerPendingId \|\| ''\);/);
    assert.match(setQueueSection, /appendCompactRenderStateKeyPart\(nextQueueActionStateKeyBuilder, isProcessing \? '1' : '0'\);/);
    assert.match(setQueueSection, /const nextQueueActionStateKey = finishCompactRenderStateKey\(nextQueueActionStateKeyBuilder\);/);
    assert.match(setQueueSection, /syncQueueItemControls\(renderItems\);/);
    assert.match(setQueueSection, /else if \(nextQueueActionStateKey !== lastQueueActionStateKey\)/);
    assert.match(setQueueSection, /lastQueueActionStateKey = nextQueueActionStateKey;/);
    assert.match(setQueueSection, /lastQueueInputsStateKey = nextQueueInputsStateKey;/);
    assert.match(queueStateSection, /const nextQueuedInputs = Array\.isArray\(data\.queuedInputs\) \? data\.queuedInputs : \[\];/);
    assert.match(queueStateSection, /const nextQueueInputsRenderState = typeof getQueueInputsRenderState === 'function'[\s\S]*\? getQueueInputsRenderState\(nextQueuedInputs\)[\s\S]*: null;/);
    assert.match(queueStateSection, /const queueActionWasPending = queueClearPending \|\| !!queueSteerPendingId;/);
    assert.match(queueStateSection, /typeof isQueueRenderStateCurrent === 'function'/);
    assert.match(queueStateSection, /isQueueRenderStateCurrent\(nextQueueInputsRenderState\)/);
    assert.ok(
      queueStateSection.indexOf('isQueueRenderStateCurrent(nextQueueInputsRenderState)') < queueStateSection.indexOf("clearPendingActionTimer('queueAction')"),
      'expected duplicate idle queueState guard before clearing action state'
    );
    assert.match(queueStateSection, /setQueueState\(nextQueueInputsRenderState \|\| nextQueuedInputs\);/);
    assert.match(bootstrapSource, /setQueueState\(queuedInputs, \{ sync: false \}\); \} catch \{\} \}\)\);/);
    assert.match(bootstrapSource, /showInputNotice\('Failed to request queue clear\.', \{ sync: false \}\);\s*try \{ setQueueState\(queuedInputs\); \} catch \{\}/);
    assert.match(bootstrapSource, /showInputNotice\('Failed to request queued message\.', \{ sync: false \}\);\s*try \{ setQueueState\(queuedInputs\); \} catch \{\}/);
    assert.doesNotMatch(bootstrapSource, /showInputNotice\((?![^\n]*\{ sync: false \})[^\n]+\);\s*try \{ setQueueState\(queuedInputs\); \} catch \{\}/);
	    assert.match(bootstrapSource, /const children = queueItems\.children \|\| \[\];/);
	    assert.match(bootstrapSource, /for \(let i = 0; i < children\.length && renderIndex < renderItems\.length; i\+\+\)/);
	    assert.match(bootstrapSource, /queueItemIdByButton\.get\(btn\) !== renderItem\.id/);
	    assert.doesNotMatch(bootstrapSource, /btn\.dataset\.id/);
	    assert.match(queueLabelSection, /const cached = queueItemLabelElementCache\.get\(button\);/);
		    assert.match(queueLabelSection, /typeof button\.contains !== 'function' \|\| button\.contains\(cached\)/);
		    assert.match(queueLabelSection, /queueItemLabelElementCache\.delete\(button\);/);
		    assert.match(queueLabelSection, /queueItemLabelElementCache\.set\(button, labelEl\);/);
		    assert.doesNotMatch(queueLabelSection, /for \(let i = 0; i < children\.length/);
		    assert.doesNotMatch(queueLabelSection, /querySelector/);
	    assert.match(queueSyncSection, /setAttributeValue\(btn, 'aria-label', getQueueItemAriaLabel\(renderItem\)\);/);
	    assert.doesNotMatch(setQueueSection, /nextQueueItemsRenderKey = appendRenderKeyPart\(nextQueueItemsRenderKey, initReceived \? '1' : '0'\);/);
    assert.doesNotMatch(setQueueSection, /nextQueueItemsRenderKey = appendRenderKeyPart\(nextQueueItemsRenderKey, queueActionBusy \? '1' : '0'\);/);
    assert.doesNotMatch(setQueueSection, /nextQueueItemsRenderKey = appendRenderKeyPart\(nextQueueItemsRenderKey, isProcessing \? '1' : '0'\);/);
    assert.doesNotMatch(setQueueSection, /nextQueueItemsRenderKey = appendRenderKeyPart\(nextQueueItemsRenderKey, queueSteerPendingId \|\| ''\);/);
	    assert.doesNotMatch(helperSection, /setHidden\(queueBanner/);
    assert.doesNotMatch(helperSection, /queueBanner(?:Count|Text|Hint)\.textContent\s*=/);
    assert.doesNotMatch(helperSection, /queueStatus\.textContent\s*=/);
    assert.doesNotMatch(setQueueSection, /queueBanner(?:Count|Text|Hint)\.textContent/);
    assert.doesNotMatch(setQueueSection, /queueClearBtn\.disabled\s*=/);
  });

  test('processing messages skip duplicate full syncs while preserving stop cleanup', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const setProcessingStart = bootstrapSource.indexOf('function setProcessing');
    assert.ok(setProcessingStart >= 0, 'expected setProcessing helper');
    const setProcessingEnd = bootstrapSource.indexOf('function setPlanPending', setProcessingStart);
    assert.ok(setProcessingEnd > setProcessingStart, 'expected setPlanPending after setProcessing');
    const setProcessingSection = bootstrapSource.slice(setProcessingStart, setProcessingEnd);
    const processingCaseStart = mainSource.indexOf("case 'processing':");
    assert.ok(processingCaseStart >= 0, 'expected processing branch');
    const processingCaseEnd = mainSource.indexOf("case 'sessionActionState':", processingCaseStart);
    assert.ok(processingCaseEnd > processingCaseStart, 'expected sessionActionState branch after processing');
    const processingSection = mainSource.slice(processingCaseStart, processingCaseEnd);

    assert.match(setProcessingSection, /const nextProcessing = !!val;/);
    assert.match(setProcessingSection, /if \(isProcessing === nextProcessing\) \{[\s\S]*syncActiveTurnProcessingState\(shouldShowActiveTurnProcessing\(\)\);[\s\S]*return;/);
    assert.ok(
      setProcessingSection.indexOf('isProcessing === nextProcessing') <
        setProcessingSection.indexOf('syncInputState();'),
      'setProcessing duplicate guard should run before full input sync'
    );
	    assert.match(setProcessingSection, /const currentQueueInputsRenderState =[\s\S]*lastQueueInputsRenderState\.list === queuedInputs[\s\S]*\? lastQueueInputsRenderState[\s\S]*: queuedInputs;/);
	    assert.match(setProcessingSection, /setQueueState\(currentQueueInputsRenderState, \{ sync: false \}\);/);
	    assert.match(setProcessingSection, /let activeSessionOption = isCachedCurrentSessionOptionValid\(currentSessionOption\) \? currentSessionOption : null;/);
	    assert.match(setProcessingSection, /if \(!activeSessionOption\) \{[\s\S]*const sessionOptions = sessionSelect \? sessionSelect\.options : null;[\s\S]*activeSessionOption = getCurrentSessionOption\(sessionOptions\);[\s\S]*\}/);
	    assert.ok(
	      setProcessingSection.indexOf('isCachedCurrentSessionOptionValid(currentSessionOption)') <
	        setProcessingSection.indexOf('sessionSelect ? sessionSelect.options : null'),
	      'expected cached session option validation before reading select options'
	    );
	    assert.match(setProcessingSection, /setTextContent\(activeSessionOption, nextProcessing \? '◉ ' \+ label : label\);/);
    assert.match(processingSection, /const nextProcessingState = !!data\.value;/);
    assert.match(processingSection, /const processingStopHadPendingAction = !nextProcessingState && \(abortRequestPending \|\| approveAllPending\);/);
    assert.match(processingSection, /if \(!processingStopHadPendingAction && isProcessing === nextProcessingState\) break;/);
    assert.ok(
      processingSection.indexOf('isProcessing === nextProcessingState') < processingSection.indexOf("clearPendingActionTimer('abort')"),
      'expected duplicate processing guard before stop cleanup'
    );
    assert.ok(
      processingSection.indexOf('if (!nextProcessingState)') < processingSection.indexOf('setProcessing(nextProcessingState);'),
      'expected stop cleanup before applying stopped state'
    );
    assert.match(processingSection, /setProcessing\(nextProcessingState\);/);
  });

  test('goal command suggestion visibility updates are idempotent', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const matchStart = bootstrapSource.indexOf('function matchesGoalCommandTextAt');
    assert.ok(matchStart >= 0, 'expected shared goal command matcher');
    const matchEnd = bootstrapSource.indexOf('function inputStartsWithGoalCommand', matchStart);
    assert.ok(matchEnd > matchStart, 'expected insertion predicate after shared matcher');
    const matchSection = bootstrapSource.slice(matchStart, matchEnd);
    const insertPredicateStart = bootstrapSource.indexOf('function inputStartsWithGoalCommand');
    assert.ok(insertPredicateStart >= 0, 'expected allocation-free goal insertion predicate');
    const insertPredicateEnd = bootstrapSource.indexOf('function shouldShowGoalCommandSuggestion', insertPredicateStart);
    assert.ok(insertPredicateEnd > insertPredicateStart, 'expected suggestion predicate after insertion predicate');
    const insertPredicateSection = bootstrapSource.slice(insertPredicateStart, insertPredicateEnd);
    const shouldShowStart = bootstrapSource.indexOf('function shouldShowGoalCommandSuggestion');
    assert.ok(shouldShowStart >= 0, 'expected shouldShowGoalCommandSuggestion helper');
    const shouldShowEnd = bootstrapSource.indexOf('function updateGoalCommandSuggestion', shouldShowStart);
    assert.ok(shouldShowEnd > shouldShowStart, 'expected update helper after suggestion predicate');
    const shouldShowSection = bootstrapSource.slice(shouldShowStart, shouldShowEnd);
    const updateStart = bootstrapSource.indexOf('function updateGoalCommandSuggestion');
    assert.ok(updateStart >= 0, 'expected updateGoalCommandSuggestion helper');
    const updateEnd = bootstrapSource.indexOf('function insertGoalCommand', updateStart);
    assert.ok(updateEnd > updateStart, 'expected end of updateGoalCommandSuggestion helper');
    const updateSection = bootstrapSource.slice(updateStart, updateEnd);
    const insertStart = bootstrapSource.indexOf('function insertGoalCommand');
    assert.ok(insertStart >= 0, 'expected insertGoalCommand helper');
    const insertEnd = bootstrapSource.indexOf('function setInputHistoryEntries', insertStart);
    assert.ok(insertEnd > insertStart, 'expected input history after goal insertion helper');
    const insertSection = bootstrapSource.slice(insertStart, insertEnd);

    assert.match(bootstrapSource, /const\s+GOAL_COMMAND_TEXT\s*=\s*'\/goal'/);
    assert.match(matchSection, /GOAL_COMMAND_TEXT\.charCodeAt\(offset\)/);
	    assert.match(insertPredicateSection, /while \(tokenStart < value\.length && isWhitespaceChar\(value\[tokenStart\]\)\) tokenStart\+\+;/);
	    assert.match(insertPredicateSection, /if \(value\.length - tokenStart < GOAL_COMMAND_TEXT\.length\) return false;/);
	    assert.match(insertPredicateSection, /return matchesGoalCommandTextAt\(value, tokenStart, GOAL_COMMAND_TEXT\.length\);/);
	    assert.match(shouldShowSection, /while \(tokenStart < value\.length && isWhitespaceChar\(value\[tokenStart\]\)\) tokenStart\+\+;/);
	    assert.match(shouldShowSection, /if \(tokenLength === 0 \|\| tokenLength > GOAL_COMMAND_TEXT\.length\) return false;/);
	    assert.match(shouldShowSection, /return matchesGoalCommandTextAt\(value, tokenStart, tokenLength\);/);
	    assert.doesNotMatch(shouldShowSection, /\.trimStart\(\)/);
	    assert.doesNotMatch(shouldShowSection, /\.toLowerCase\(\)/);
	    assert.doesNotMatch(insertPredicateSection + shouldShowSection, /WHITESPACE_CHAR_RE\.test/);
    assert.match(insertSection, /inputStartsWithGoalCommand\(current\) \? current : '\/goal '/);
    assert.match(insertSection, /if \(next !== current\) \{[\s\S]*input\.value = next;[\s\S]*updateInputLayout\(\{ clearButton: false \}\);[\s\S]*\}/);
    assert.doesNotMatch(insertPredicateSection + insertSection, /\.trimStart\(\)/);
    assert.doesNotMatch(insertPredicateSection + insertSection, /\.toLowerCase\(\)/);
    assert.match(bootstrapSource, /let\s+goalCommandSuggestionVisible\s*=\s*false/);
    assert.match(updateSection, /const nextVisible = shouldShowGoalCommandSuggestion\(\);/);
    assert.match(updateSection, /if \(nextVisible === goalCommandSuggestionVisible\) return;/);
    assert.match(updateSection, /goalCommandSuggestionVisible = nextVisible;/);
    assert.match(updateSection, /if \(goalCommandSuggestion\.classList\) \{[\s\S]*goalCommandSuggestion\.classList\.toggle\('hidden', !nextVisible\);[\s\S]*\}/);
    assert.doesNotMatch(updateSection, /setHidden\(goalCommandSuggestion/);
  });

  test('quick action clicks skip unchanged composer value writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const quickActionStart = bootstrapSource.indexOf("quickActions.addEventListener('click'");
    assert.ok(quickActionStart >= 0, 'expected quick action click handler');
    const quickActionEnd = bootstrapSource.indexOf("document.addEventListener('click'", quickActionStart);
    assert.ok(quickActionEnd > quickActionStart, 'expected document click handler after quick actions');
    const quickActionSection = bootstrapSource.slice(quickActionStart, quickActionEnd);
    const quickActionHelperStart = bootstrapSource.indexOf('function isQuickActionElement(el)');
    assert.ok(quickActionHelperStart >= 0, 'expected quick action element helper');
    const quickActionHelperEnd = bootstrapSource.indexOf('function findQuickActionButton(target)', quickActionHelperStart);
    assert.ok(quickActionHelperEnd > quickActionHelperStart, 'expected quick action finder after helper');
    const quickActionHelperSection = bootstrapSource.slice(quickActionHelperStart, quickActionHelperEnd);

	    assert.match(bootstrapSource, /const quickActionCommandByButton = new WeakMap\(\);/);
	    assert.match(bootstrapSource, /if \(quickActions\) \{[\s\S]*cacheQuickActionCommands\(\);[\s\S]*quickActions\.addEventListener\('click'/);
	    assert.match(bootstrapSource, /function findQuickActionButton\(target\)/);
	    assert.match(bootstrapSource, /function isQuickActionElement\(el\)/);
	    assert.match(quickActionHelperSection, /return !!\(el && el\.classList && el\.classList\.contains\('quick-action'\)\);/);
	    assert.match(bootstrapSource, /const buttons = quickActions && quickActions\.children \? quickActions\.children : \[\];/);
	    assert.match(bootstrapSource, /if \(quickActionCommandByButton\.has\(el\)\) return el;/);
	    assert.match(bootstrapSource, /if \(isQuickActionElement\(el\)\) return el;/);
	    assert.match(quickActionSection, /const quickAction = findQuickActionButton\(e && e\.target \? e\.target : null\);/);
	    assert.match(quickActionSection, /const cmd = getQuickActionCommand\(quickAction\);/);
    assert.match(quickActionSection, /if \(input\.value !== cmd\) \{[\s\S]*input\.value = cmd;[\s\S]*updateInputLayout\(\{ clearButton: false \}\);[\s\S]*\}/);
    assert.match(quickActionSection, /syncComposerInputState\(\);/);
	    assert.match(quickActionSection, /focusComposerInput\(\);/);
	    assert.doesNotMatch(quickActionSection, /\.closest\('\.quick-action'\)/);
	    assert.doesNotMatch(bootstrapSource, /querySelectorAll\('\.quick-action'\)/);
	    assert.doesNotMatch(quickActionHelperSection, /String\(el && el\.className \|\| ''\)/);
	    assert.doesNotMatch(quickActionHelperSection, /classes\.includes\(' quick-action '\)/);
	    assert.doesNotMatch(bootstrapSource, /dataset\.cmd/);
		  });

  test('clear input skips unchanged textarea value writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const clearStart = bootstrapSource.indexOf("clearInputBtn.addEventListener('click'");
    assert.ok(clearStart >= 0, 'expected clear input click handler');
    const clearEnd = bootstrapSource.indexOf("sendBtn.addEventListener('click'", clearStart);
    assert.ok(clearEnd > clearStart, 'expected send button handler after clear input handler');
    const clearSection = bootstrapSource.slice(clearStart, clearEnd);

    assert.match(clearSection, /const hadInputValue = input\.value !== '';/);
    assert.match(clearSection, /if \(hadInputValue\) \{[\s\S]*input\.value = '';[\s\S]*updateInputLayout\(\{ clearButton: false \}\);[\s\S]*\}/);
    assert.match(clearSection, /clearPendingImageAttachments\(\);/);
    assert.match(clearSection, /syncComposerInputState\(\);/);
  });

  test('composer assist refreshes reuse unchanged input context', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const stateStart = bootstrapSource.indexOf('function getComposerInputAssistState');
    assert.ok(stateStart >= 0, 'expected composer assist state helper');
    const stateEnd = bootstrapSource.indexOf('function composerInputAssistStatesEqual', stateStart);
    assert.ok(stateEnd > stateStart, 'expected equality helper after state helper');
    const stateSection = bootstrapSource.slice(stateStart, stateEnd);
    const equalEnd = bootstrapSource.indexOf('function rememberComposerInputAssistState', stateEnd);
    assert.ok(equalEnd > stateEnd, 'expected remember helper after equality helper');
    const equalSection = bootstrapSource.slice(stateEnd, equalEnd);
    const refreshStart = bootstrapSource.indexOf('function refreshComposerInputAssist');
    assert.ok(refreshStart >= 0, 'expected composer assist refresh helper');
    const refreshEnd = bootstrapSource.indexOf('function insertGoalCommand', refreshStart);
    assert.ok(refreshEnd > refreshStart, 'expected insertGoalCommand after refresh helper');
    const refreshSection = bootstrapSource.slice(refreshStart, refreshEnd);
    const inputListenerStart = bootstrapSource.indexOf("input.addEventListener('input'");
    assert.ok(inputListenerStart >= 0, 'expected composer input listener');
    const inputListenerEnd = bootstrapSource.indexOf("input.addEventListener('compositionstart'", inputListenerStart);
    assert.ok(inputListenerEnd > inputListenerStart, 'expected composition listener after assist listeners');
    const inputListenerSection = bootstrapSource.slice(inputListenerStart, inputListenerEnd);

    assert.match(bootstrapSource, /let\s+composerInputAssistState\s*=\s*null/);
    assert.match(stateSection, /availableSkillsVersion/);
    assert.match(stateSection, /goalCommandSuggestionVisible/);
    assert.match(stateSection, /skillDropdownOpen/);
    assert.match(stateSection, /skillDropdownTokenStart/);
    assert.match(stateSection, /skillDropdownQuery/);
    assert.match(stateSection, /skillDropdownItemsVersion/);
    assert.match(stateSection, /value: input \? String\(input\.value \|\| ''\) : ''/);
    assert.match(stateSection, /selectionStart: input \? input\.selectionStart \|\| 0 : 0/);
    assert.match(stateSection, /selectionEnd: input \? input\.selectionEnd \|\| 0 : 0/);
    assert.match(equalSection, /a\.value === b\.value/);
    assert.match(equalSection, /a\.selectionStart === b\.selectionStart/);
    assert.match(equalSection, /a\.selectionEnd === b\.selectionEnd/);
    assert.match(refreshSection, /const nextState = getComposerInputAssistState\(\);/);
    assert.match(refreshSection, /if \(composerInputAssistStatesEqual\(nextState, composerInputAssistState\)\) return;/);
    assert.match(refreshSection, /updateGoalCommandSuggestion\(\);[\s\S]*updateSkillDropdown\(\);[\s\S]*rememberComposerInputAssistState\(\);/);
    assert.match(inputListenerSection, /updateSkillDropdown\(\);[\s\S]*rememberComposerInputAssistState\(\);/);
    assert.match(inputListenerSection, /input\.addEventListener\('click', refreshComposerInputAssist\);/);
    assert.match(inputListenerSection, /input\.addEventListener\('keyup', refreshComposerInputAssist\);/);
    assert.match(inputListenerSection, /input\.addEventListener\('focus', refreshComposerInputAssist\);/);
  });

  test('input hint state updates are idempotent', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const helperStart = bootstrapSource.indexOf('function setInputHintState');
    assert.ok(helperStart >= 0, 'expected input hint state helper');
    const helperEnd = bootstrapSource.indexOf('function getComposerInputState', helperStart);
    assert.ok(helperEnd > helperStart, 'expected input hint helper before composer state helpers');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
    const composerStart = bootstrapSource.indexOf('function syncComposerInputState');
    assert.ok(composerStart >= 0, 'expected syncComposerInputState');
    const composerEnd = bootstrapSource.indexOf('function syncInputState', composerStart);
    assert.ok(composerEnd > composerStart, 'expected syncComposerInputState end');
    const composerSection = bootstrapSource.slice(composerStart, composerEnd);

    assert.match(bootstrapSource, /let\s+inputHintVisible\s*=\s*!!inputHint/);
    assert.doesNotMatch(bootstrapSource, /inputHint\.classList\.contains\('hidden'\)/);
    assert.match(bootstrapSource, /let\s+inputHintText\s*=\s*inputHint\s*\?\s*String\(inputHint\.textContent \|\| ''\)\s*:\s*''/);
    assert.match(helperSection, /const nextVisible = !!visible;/);
    assert.match(helperSection, /if \(inputHintVisible !== nextVisible\) \{/);
    assert.match(helperSection, /inputHint\.classList\.toggle\('hidden', !nextVisible\);/);
    assert.doesNotMatch(helperSection, /setHidden\(inputHint/);
    assert.match(helperSection, /const nextText = String\(text === undefined \|\| text === null \? '' : text\);/);
    assert.match(helperSection, /if \(inputHintText !== nextText\) \{/);
    assert.match(helperSection, /inputHint\.textContent = nextText;/);
    assert.match(composerSection, /setInputHintState\(state\.showHint, state\.hintText\);/);
    assert.doesNotMatch(composerSection, /inputHint\.classList\.toggle\('hidden', !showHint\);/);
    assert.doesNotMatch(composerSection, /inputHint\.textContent = showNotice/);
  });

  test('input notice updates avoid duplicate announcements and full control sweeps', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const liveRegionHelperStart = bootstrapSource.indexOf('function getLiveRegionAnnouncementText');
    assert.ok(liveRegionHelperStart >= 0, 'expected live region announcement helper');
    const liveRegionHelperEnd = bootstrapSource.indexOf('function announceStatus', liveRegionHelperStart);
    assert.ok(liveRegionHelperEnd > liveRegionHelperStart, 'expected announceStatus after live region announcement helper');
    const liveRegionHelperSection = bootstrapSource.slice(liveRegionHelperStart, liveRegionHelperEnd);
    const announceStart = liveRegionHelperEnd;
    const announceEnd = bootstrapSource.indexOf('function hasPendingSettingState', announceStart);
    assert.ok(announceEnd > announceStart, 'expected announceStatus before setting state helpers');
    const announceSection = bootstrapSource.slice(announceStart, announceEnd);
    const noticeStart = bootstrapSource.indexOf('function showInputNotice');
    assert.ok(noticeStart >= 0, 'expected input notice helper');
    const noticeEnd = bootstrapSource.indexOf('function getInputAttachmentsRenderKey', noticeStart);
    assert.ok(noticeEnd > noticeStart, 'expected attachment render key helper after input notice helper');
    const noticeSection = bootstrapSource.slice(noticeStart, noticeEnd);

    assert.match(bootstrapSource, /const LIVE_REGION_ANNOUNCEMENT_LIMIT = 240;/);
    assert.match(liveRegionHelperSection, /const text = typeof message === 'string' \? message\.trim\(\) : '';/);
    assert.match(liveRegionHelperSection, /text\.length <= LIVE_REGION_ANNOUNCEMENT_LIMIT/);
    assert.match(liveRegionHelperSection, /text\.slice\(0, LIVE_REGION_ANNOUNCEMENT_LIMIT\) \+ '…'/);
    assert.match(announceSection, /const text = getLiveRegionAnnouncementText\(message\);/);
    assert.doesNotMatch(announceSection, /const text = typeof message === 'string' \? message\.trim\(\) : '';/);
    assert.match(noticeSection, /const noticeChanged = inputNoticeMessage !== nextNoticeMessage;/);
    assert.match(noticeSection, /if \(noticeChanged\) announceStatus\(inputNoticeMessage\);/);
    assert.match(noticeSection, /if \(inputNoticeTimer !== timer\) return;/);
    assert.match(noticeSection, /function showInputNotice\(message, options\)/);
    assert.match(noticeSection, /if \(noticeChanged && \(!options \|\| options\.sync !== false\)\) syncComposerInputState\(\);/);
    assert.match(noticeSection, /function clearInputNotice\(options\)/);
    assert.match(noticeSection, /if \(hadNotice && \(!options \|\| options\.sync !== false\)\) syncComposerInputState\(\);/);
    assert.match(bootstrapSource, /showInputNotice\('Failed to request mode change\.', \{ sync: false \}\);\s*syncInputState\(\);/);
    assert.match(bootstrapSource, /clearInputNotice\(\{ sync: false \}\);/);
    assert.match(noticeSection, /syncComposerInputState\(\);/);
    assert.doesNotMatch(noticeSection, /syncInputState\(\);/);
    assert.doesNotMatch(noticeSection, /announceStatus\(inputNoticeMessage\);[\s\S]*announceStatus\(inputNoticeMessage\);/);
    assert.doesNotMatch(bootstrapSource, /showInputNotice\('[^']+'\);\s*syncInputState\(\);/);
    assert.doesNotMatch(bootstrapSource, /showInputNotice\((?![^\n]*\{ sync: false \})[^\n]+\);\s*syncInputState\(\);/);
    const bootstrapLines = bootstrapSource.split(/\r?\n/);
    for (let index = 0; index < bootstrapLines.length; index++) {
      const line = bootstrapLines[index];
      if (!line.includes('showInputNotice(') || line.includes('{ sync: false }')) continue;
      for (let nextIndex = index + 1; nextIndex < Math.min(index + 5, bootstrapLines.length); nextIndex++) {
        if (!bootstrapLines[nextIndex].includes('syncInputState();')) continue;
        assert.fail(`showInputNotice before full sync should pass { sync: false } near line ${index + 1}`);
      }
    }
  });

  test('send failure notice avoids full input state sweep', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const sendStart = bootstrapSource.indexOf('function send()');
    assert.ok(sendStart >= 0, 'expected send helper');
    const sendEnd = bootstrapSource.indexOf('function createCompactRenderStateKeyBuilder', sendStart);
    assert.ok(sendEnd > sendStart, 'expected render-key helper after send helper');
    const sendSection = bootstrapSource.slice(sendStart, sendEnd);
    const failureNoticeStart = sendSection.indexOf("showInputNotice('Failed to send message.');");
    assert.ok(failureNoticeStart >= 0, 'expected failed send notice');
    const failureReturnEnd = sendSection.indexOf('return;', failureNoticeStart);
    assert.ok(failureReturnEnd > failureNoticeStart, 'expected failed send path to return');
    const failureSection = sendSection.slice(failureNoticeStart, failureReturnEnd);
    const trimHelperStart = bootstrapSource.indexOf('function trimComposerSendText');
    assert.ok(trimHelperStart >= 0, 'expected composer send trim helper');
    const trimHelperEnd = bootstrapSource.indexOf('function send()', trimHelperStart);
    assert.ok(trimHelperEnd > trimHelperStart, 'expected send helper after composer trim helper');
    const trimHelperSection = bootstrapSource.slice(trimHelperStart, trimHelperEnd);
    const initGuardIndex = sendSection.indexOf(
      'if (!initReceived || pendingComposerSubmission || pendingImageAttachmentOperations > 0) return;'
    );
    const rawTextIndex = sendSection.indexOf("const rawText = input.value || '';");
    const trimIndex = sendSection.indexOf('const text = trimComposerSendText(rawText);');
    const hasTextIndex = sendSection.indexOf("const hasText = text !== '';");

    assert.match(failureSection, /showInputNotice\('Failed to send message\.'\);/);
    assert.doesNotMatch(failureSection, /syncInputState\(\);/);
    assert.doesNotMatch(failureSection, /syncComposerInputState\(\);/);
    assert.ok(initGuardIndex >= 0, 'send should return before reading draft text when disconnected or awaiting acceptance');
    assert.ok(rawTextIndex > initGuardIndex, 'send should read the textarea only after init is known');
    assert.ok(trimIndex > rawTextIndex, 'send should normalize draft text once after reading it');
    assert.ok(hasTextIndex > trimIndex, 'send should derive content presence from normalized text');
    assert.doesNotMatch(sendSection.slice(0, initGuardIndex), /input\.value|trim\(|serializePendingImageAttachments/);
    assert.match(trimHelperSection, /while \(start < text\.length && isWhitespaceChar\(text\[start\]\)\) start\+\+;/);
    assert.match(trimHelperSection, /while \(end > start && isWhitespaceChar\(text\[end - 1\]\)\) end--;/);
    assert.match(trimHelperSection, /return start === 0 && end === text\.length \? text : text\.slice\(start, end\);/);
    assert.doesNotMatch(trimHelperSection, /\.trim\(\)/);
    assert.match(sendSection, /if \(requiresText && !hasText\) return;/);
    assert.match(sendSection, /if \(!hasText && !hasAttachments\) return;/);
    assert.doesNotMatch(sendSection, /\.trim\(\)/);
    assert.match(sendSection, /const hadInputValue = input\.value !== '';/);
    assert.match(sendSection, /if \(hadInputValue\) \{[\s\S]*input\.value = '';[\s\S]*updateInputLayout\(\{ clearButton: false, persistDraft: false \}\);[\s\S]*\}/);
    assert.match(sendSection, /persistComposerDraftStateNow\(\);[\s\S]*pendingComposerSubmission = submission;[\s\S]*persistComposerSubmissionId\(submissionId\);[\s\S]*vscode\.postMessage\(\{/);
    assert.match(sendSection, /clearPendingImageAttachments\(\{ syncExtension: false \}\);/);
    assert.match(sendSection, /armPendingActionTimer\('composerSubmission', handleComposerSubmissionTimeout\);/);
    assert.match(sendSection, /syncInputState\(\);/);
  });

  test('composer control state updates avoid duplicate property writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const disabledHelperStart = bootstrapSource.indexOf('function setDisabled');
    assert.ok(disabledHelperStart >= 0, 'expected disabled-state helper');
    const disabledHelperEnd = bootstrapSource.indexOf('function setHidden', disabledHelperStart);
    assert.ok(disabledHelperEnd > disabledHelperStart, 'expected hidden helper after disabled helper');
    const disabledHelperSection = bootstrapSource.slice(disabledHelperStart, disabledHelperEnd);
    const hiddenHelperStart = bootstrapSource.indexOf('function setHidden');
    assert.ok(hiddenHelperStart >= 0, 'expected hidden-state helper');
    const hiddenHelperEnd = bootstrapSource.indexOf('function setInputHintState', hiddenHelperStart);
    assert.ok(hiddenHelperEnd > hiddenHelperStart, 'expected hidden helper before input hint helper');
    const hiddenHelperSection = bootstrapSource.slice(hiddenHelperStart, hiddenHelperEnd);
    const composerStart = bootstrapSource.indexOf('function syncComposerInputState');
    assert.ok(composerStart >= 0, 'expected syncComposerInputState');
    const composerEnd = bootstrapSource.indexOf('function syncInputState', composerStart);
    assert.ok(composerEnd > composerStart, 'expected syncComposerInputState end');
    const composerSection = bootstrapSource.slice(composerStart, composerEnd);
    const clearDisabledHelperStart = bootstrapSource.indexOf('function setClearInputButtonDisabled');
    assert.ok(clearDisabledHelperStart >= 0, 'expected clear input disabled helper');
    const clearDisabledHelperEnd = bootstrapSource.indexOf('function setDisabled', clearDisabledHelperStart);
    assert.ok(clearDisabledHelperEnd > clearDisabledHelperStart, 'expected generic disabled helper after clear input disabled helper');
    const clearDisabledHelperSection = bootstrapSource.slice(clearDisabledHelperStart, clearDisabledHelperEnd);
    const stopVisibleHelperStart = bootstrapSource.indexOf('function setStopButtonVisible', clearDisabledHelperStart);
    assert.ok(stopVisibleHelperStart >= 0, 'expected stop button visibility helper');
    const stopVisibleHelperEnd = bootstrapSource.indexOf('function setDisabled', stopVisibleHelperStart);
    assert.ok(stopVisibleHelperEnd > stopVisibleHelperStart, 'expected generic disabled helper after stop button visibility helper');
    const stopVisibleHelperSection = bootstrapSource.slice(stopVisibleHelperStart, stopVisibleHelperEnd);
    const stateStart = bootstrapSource.indexOf('function getComposerInputState');
    assert.ok(stateStart >= 0, 'expected getComposerInputState');
    const stateEnd = bootstrapSource.indexOf('function syncComposerInputState', stateStart);
    assert.ok(stateEnd > stateStart, 'expected composer sync after input state helper');
    const stateSection = bootstrapSource.slice(stateStart, stateEnd);

    assert.match(disabledHelperSection, /const disabledFlag = !!disabled;/);
    assert.match(disabledHelperSection, /if \(element\.disabled !== disabledFlag\) element\.disabled = disabledFlag;/);
    assert.match(hiddenHelperSection, /setClassPresence\(element, 'hidden', hidden\);/);
    assert.doesNotMatch(hiddenHelperSection, /classList\.(?:add|remove|toggle|contains)\('hidden'/);
	    assert.match(bootstrapSource, /function\s+setPlaceholder\(/);
	    assert.match(bootstrapSource, /function\s+hasNonWhitespaceText\(value\)/);
	    assert.match(bootstrapSource, /for \(let index = 0; index < text\.length; index\+\+\)/);
	    assert.match(bootstrapSource, /!isWhitespaceChar\(text\[index\]\)/);
    assert.match(clearDisabledHelperSection, /if \(!clearInputBtn\) return;/);
	    assert.match(clearDisabledHelperSection, /if \(clearInputButtonDisabledState === disabledFlag\) return;/);
	    assert.match(clearDisabledHelperSection, /clearInputButtonDisabledState = disabledFlag;/);
	    assert.match(bootstrapSource, /let\s+stopButtonVisible\s*=\s*false/);
	    assert.match(stopVisibleHelperSection, /function\s+setStopButtonVisible\(visible\)/);
	    assert.match(stopVisibleHelperSection, /if \(stopButtonVisible === visibleFlag\) return;/);
	    assert.match(stopVisibleHelperSection, /stopButtonVisible = visibleFlag;/);
	    assert.match(stopVisibleHelperSection, /stopBtn\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.doesNotMatch(stopVisibleHelperSection, /setHidden\(stopBtn/);
	    assert.ok(
	      clearDisabledHelperSection.indexOf('if (clearInputButtonDisabledState === disabledFlag) return;') <
	        clearDisabledHelperSection.indexOf('clearInputBtn.disabled !== disabledFlag'),
      'expected clear input disabled cache guard before DOM property read'
    );
    assert.match(stateSection, /const hasText = hasNonWhitespaceText\(input\.value\);/);
    assert.match(stateSection, /const submissionPending = !!pendingComposerSubmission;/);
    assert.match(stateSection, /const attachmentReadPending = pendingImageAttachmentOperations > 0;/);
    assert.doesNotMatch(stateSection, /\.trim\(\)/);
    assert.match(composerSection, /setDisabled\(input, !state\.connected\);/);
    assert.match(composerSection, /const nextPlaceholder = state\.connected/);
    assert.match(composerSection, /setPlaceholder\(input, nextPlaceholder\);/);
    assert.match(
      composerSection,
      /setClearInputButtonDisabled\([\s\S]*!state\.connected \|\|[\s\S]*state\.attachmentReadPending \|\|[\s\S]*\(!state\.hasText && pendingImageAttachments\.length === 0\)[\s\S]*\);/
    );
    assert.match(composerSection, /setDisabled\(goalCommandInsert, !state\.connected\);/);
    assert.match(composerSection, /setDisabled\(attachImageButton, !state\.connected \|\| state\.submissionPending \|\| state\.attachmentReadPending\);/);
    assert.match(composerSection, /setDisabled\(imageFileInput, !state\.connected \|\| state\.submissionPending \|\| state\.attachmentReadPending\);/);
    assert.match(composerSection, /if \(!state\.connected \|\| state\.submissionPending \|\| state\.attachmentReadPending\) clearInputImageDragState\(\);/);
	    assert.match(composerSection, /setStopButtonVisible\(false\);/);
	    assert.match(composerSection, /setStopButtonVisible\(true\);/);
	    assert.doesNotMatch(composerSection, /setHidden\(stopBtn,/);
	    assert.doesNotMatch(composerSection, /input\.disabled =/);
    assert.doesNotMatch(composerSection, /input\.placeholder =/);
    assert.doesNotMatch(composerSection, /clearInputBtn\.disabled =/);
    assert.doesNotMatch(composerSection, /stopBtn\.classList\.(?:add|remove)\('hidden'\)/);
    assert.doesNotMatch(composerSection, /stopBtn\.disabled =/);
  });

  test('send button presentation keeps accessible labels in sync', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
    const helperStart = bootstrapSource.indexOf('function setSendButtonPresentation');
    assert.ok(helperStart >= 0, 'expected send button presentation helper');
    const helperEnd = bootstrapSource.indexOf('function setSendButtonDisabled', helperStart);
    assert.ok(helperEnd > helperStart, 'expected send disabled helper after presentation helper');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
    const disabledHelperEnd = bootstrapSource.indexOf('function setDisabled', helperEnd);
    assert.ok(disabledHelperEnd > helperEnd, 'expected generic disabled helper after send disabled helper');
    const disabledHelperSection = bootstrapSource.slice(helperEnd, disabledHelperEnd);
    const composerStart = bootstrapSource.indexOf('function syncComposerInputState');
    assert.ok(composerStart >= 0, 'expected syncComposerInputState');
    const composerEnd = bootstrapSource.indexOf('function syncInputState', composerStart);
    assert.ok(composerEnd > composerStart, 'expected syncComposerInputState end');
    const composerSection = bootstrapSource.slice(composerStart, composerEnd);

    assert.match(htmlSource, /<button id="send"[^>]*aria-label="Send, send message"/);
    assert.match(htmlSource, /<span>Send<\/span><span aria-hidden="true">→<\/span>/);
    assert.match(bootstrapSource, /let\s+sendButtonDisabledState\s*=\s*null/);
    assert.match(helperSection, /const nextAriaLabel = String\(ariaLabel \|\| label \|\| title \|\| ''\);/);
    assert.match(helperSection, /nextAriaLabel/);
    assert.match(helperSection, /iconEl\.setAttribute\('aria-hidden', 'true'\);/);
    assert.match(helperSection, /if \(typeof sendBtn\.replaceChildren === 'function'\) \{/);
    assert.match(helperSection, /sendBtn\.replaceChildren\(iconEl, labelEl\);/);
    assert.match(helperSection, /fragment\.appendChild\(iconEl\);/);
    assert.match(helperSection, /fragment\.appendChild\(labelEl\);/);
    assert.match(helperSection, /replaceElementChildren\(sendBtn, fragment\);/);
    assert.match(helperSection, /setAttributeValue\(sendBtn, 'aria-label', nextAriaLabel\);/);
    assert.match(helperSection, /\} else \{\s*const fragment = document\.createDocumentFragment\(\);/);
    assert.doesNotMatch(helperSection, /sendBtn\.innerHTML\s*=/);
    assert.doesNotMatch(helperSection, /sendBtn\.appendChild\(/);
    assert.match(disabledHelperSection, /if \(!sendBtn\) return;/);
    assert.match(disabledHelperSection, /if \(sendButtonDisabledState === disabledFlag\) return;/);
    assert.match(disabledHelperSection, /sendButtonDisabledState = disabledFlag;/);
    assert.ok(
      disabledHelperSection.indexOf('if (sendButtonDisabledState === disabledFlag) return;') <
        disabledHelperSection.indexOf('sendBtn.disabled !== disabledFlag'),
      'expected send disabled cache guard before DOM property read'
    );
    assert.match(composerSection, /setSendButtonPresentation\('…', 'Connecting', 'Connecting…', 'Connecting'\);/);
    assert.match(composerSection, /setSendButtonPresentation\('↻', 'Update Plan', 'Enter to update the plan; Shift\+Enter for newline', 'Update Plan, update the plan'\);/);
    assert.match(composerSection, /setSendButtonPresentation\('⏸', 'Queue', 'Queue input to run after the current task finishes', 'Queue, queue input'\);/);
    assert.match(composerSection, /setSendButtonPresentation\('→', 'Send', 'Enter to send; Shift\+Enter for newline', 'Send, send message'\);/);
  });

	  test('session control state updates avoid duplicate property writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const syncStart = bootstrapSource.indexOf('function syncInputState');
	    assert.ok(syncStart >= 0, 'expected syncInputState');
    const sessionEnd = bootstrapSource.indexOf('const providerSettingsStatePending', syncStart);
    assert.ok(sessionEnd > syncStart, 'expected provider settings section after session controls');
    const sessionSection = bootstrapSource.slice(syncStart, sessionEnd);
    const sessionActionStart = mainSource.indexOf("case 'sessionActionState':");
    assert.ok(sessionActionStart >= 0, 'expected session action state branch');
    const sessionActionEnd = mainSource.indexOf("case 'revertActionState':", sessionActionStart);
    assert.ok(sessionActionEnd > sessionActionStart, 'expected revert action branch after session action state');
    const sessionActionSection = mainSource.slice(sessionActionStart, sessionActionEnd);
    const revertActionStart = mainSource.indexOf("case 'revertActionState':");
    assert.ok(revertActionStart >= 0, 'expected revert action state branch');
    const revertActionEnd = mainSource.indexOf("case 'operationStart':", revertActionStart);
    assert.ok(revertActionEnd > revertActionStart, 'expected operation start branch after revert action state');
    const revertActionSection = mainSource.slice(revertActionStart, revertActionEnd);
    const sessionsPersistStateStart = mainSource.indexOf("case 'sessionsPersistState':");
    assert.ok(sessionsPersistStateStart >= 0, 'expected sessions persist state branch');
	    const sessionsPersistStateEnd = mainSource.indexOf("case 'sessionRetentionState':", sessionsPersistStateStart);
	    assert.ok(sessionsPersistStateEnd > sessionsPersistStateStart, 'expected session retention branch after sessions persist state');
	    const sessionsPersistStateSection = mainSource.slice(sessionsPersistStateStart, sessionsPersistStateEnd);
	    const sessionRetentionStateEnd = mainSource.indexOf("case 'autoApproveState':", sessionsPersistStateEnd);
	    assert.ok(sessionRetentionStateEnd > sessionsPersistStateEnd, 'expected auto-approve branch after session retention state');
	    const sessionRetentionStateSection = mainSource.slice(sessionsPersistStateEnd, sessionRetentionStateEnd);

    assert.match(sessionSection, /const submissionPending = !!pendingComposerSubmission;/);
    assert.match(sessionSection, /const attachmentReadPending = pendingImageAttachmentOperations > 0;/);
    assert.match(sessionSection, /const routingControlsBusy = isProcessing \|\| submissionPending \|\| attachmentReadPending;/);
    assert.match(sessionSection, /const sessionControlsDisabled = !connected \|\| routingControlsBusy \|\| sessionActionBusy;/);
    assert.match(sessionSection, /setDisabled\(newSessionBtn, sessionControlsDisabled\);/);
    assert.match(sessionSection, /setDisabled\(compactSessionBtn, sessionControlsDisabled\);/);
    assert.match(sessionSection, /setDisabled\(undoBtn,/);
    assert.match(sessionSection, /setDisabled\(redoBtn,/);
    assert.match(sessionSection, /setDisabled\(sessionSelect,/);
	    assert.match(sessionSection, /setDisabled\(sessionSettings,/);
	    assert.match(sessionSection, /setDisabled\(sessionsPersistToggle, sessionsPersistDisabled\);/);
	    assert.match(sessionSection, /setDisabledClass\(sessionsPersistLabel, sessionsPersistDisabled\);/);
	    assert.match(sessionSection, /setDisabled\(sessionsMaxSessionsInput, sessionRetentionDisabled\);/);
	    assert.match(sessionSection, /setDisabled\(sessionClearConfirmRunBtn, sessionControlsDisabled\);/);
			    assert.match(bootstrapSource, /function isCachedCurrentSessionOptionValid\(option\)/);
			    assert.match(bootstrapSource, /function getCurrentSessionOption\(sessionOptions\)/);
		    assert.match(bootstrapSource, /setTextContent\(activeSessionOption, nextProcessing \? '◉ ' \+ label : label\);/);
		    assert.doesNotMatch(bootstrapSource, /(?:currentSessionOption|activeSessionOption)\.textContent\s*=\s*nextProcessing \? '◉ ' \+ label : label;/);
    assert.match(sessionActionSection, /if \(!data\.pending && !sessionActionPending\) break;/);
    assert.match(sessionActionSection, /clearPendingActionTimer\('sessionAction'\);/);
    assert.match(sessionActionSection, /sessionActionPending = '';/);
    assert.match(sessionActionSection, /syncInputState\(\);/);
    assert.match(revertActionSection, /if \(!data\.pending && !revertActionPending\) break;/);
    assert.match(revertActionSection, /clearPendingActionTimer\('revertAction'\);/);
    assert.match(revertActionSection, /revertActionPending = '';/);
	    assert.match(sessionsPersistStateSection, /const nextSessionsPersistEnabled = data\.sessionsPersist !== false;/);
	    assert.match(sessionsPersistStateSection, /if \(!hasPendingSettingState\('sessionsPersistState'\) && sessionsPersistEnabled === nextSessionsPersistEnabled\) break;/);
	    assert.match(sessionsPersistStateSection, /updateSessionsPersistState\(nextSessionsPersistEnabled\);/);
		    assert.match(sessionRetentionStateSection, /const nextSessionRetentionLimits = normalizeSessionRetentionLimits\(data\.sessionsMaxSessions \|\| 20, data\.sessionsMaxSessionBytes \|\| 2000000\);/);
		    assert.match(sessionRetentionStateSection, /sessionRetentionLimitsEqual\(nextSessionRetentionLimits, currentSessionRetentionLimits\)/);
		    assert.ok(
		      sessionRetentionStateSection.indexOf('sessionRetentionLimitsEqual(nextSessionRetentionLimits, currentSessionRetentionLimits)') < sessionRetentionStateSection.indexOf('updateNormalizedSessionRetentionState('),
		      'expected unchanged session retention guard before metadata update'
		    );
		    assert.match(sessionRetentionStateSection, /updateNormalizedSessionRetentionState\(nextSessionRetentionLimits\);/);
	    assert.match(revertActionSection, /syncInputState\(\);/);
			    assert.doesNotMatch(sessionSection, /\.(?:disabled)\s*=/);
			    assert.doesNotMatch(sessionSection, /classList\.toggle\('disabled'/);
			  });

  test('session selector state updates avoid duplicate option rebuilds', () => {
    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const helperStart = contextSource.indexOf('function getSessionSelectRenderKey');
    assert.ok(helperStart >= 0, 'expected session select render key helper');
    const stateStart = contextSource.indexOf('function updateSessionSelect');
    assert.ok(stateStart > helperStart, 'expected session select updater after render key helper');
    const helperSection = contextSource.slice(helperStart, stateStart);
    const stateEnd = contextSource.indexOf('function updateModelHeader', stateStart);
    assert.ok(stateEnd > stateStart, 'expected model header after session select updater');
    const stateSection = contextSource.slice(stateStart, stateEnd);
    const sessionsCaseStart = mainSource.indexOf("case 'sessions':");
    assert.ok(sessionsCaseStart >= 0, 'expected sessions branch');
    const sessionsCaseEnd = mainSource.indexOf("case 'inputHistory':", sessionsCaseStart);
    assert.ok(sessionsCaseEnd > sessionsCaseStart, 'expected inputHistory branch after sessions');
    const sessionsCaseSection = mainSource.slice(sessionsCaseStart, sessionsCaseEnd);

	    assert.match(contextSource, /let\s+sessionSelectRenderKey\s*=\s*''/);
	    assert.match(contextSource, /const SESSION_OPTION_LABEL_DISPLAY_LIMIT = 160;/);
		    assert.doesNotMatch(contextSource, /function getCompactContextRenderKey\(renderKey\)/);
		    assert.doesNotMatch(contextSource, /function getCompactSessionSelectRenderKey\(renderKey\)/);
		    assert.match(helperSection, /const key = createCompactRenderKeyBuilder\(\);/);
		    assert.match(helperSection, /appendCompactContextRenderKeyPart\(key, selectedId \|\| ''\)/);
		    assert.match(helperSection, /appendCompactContextRenderKeyPart\(key, list\.length\)/);
		    assert.match(helperSection, /for \(let sessionIndex = 0; sessionIndex < list\.length; sessionIndex\+\+\)/);
		    assert.match(helperSection, /const s = list\[sessionIndex\];/);
		    assert.doesNotMatch(helperSection, /for \(const s of list\)/);
		    assert.match(helperSection, /appendCompactContextRenderKeyPart\(key, id\)/);
		    assert.match(helperSection, /appendCompactContextRenderKeyPart\(key, s && s\.title \? String\(s\.title\) : id\)/);
		    assert.match(helperSection, /return finishCompactRenderKey\(key\);/);
		    assert.match(contextSource, /function getSessionOptionLabelDisplayText\(value\)/);
		    assert.match(contextSource, /text\.length <= SESSION_OPTION_LABEL_DISPLAY_LIMIT/);
		    assert.doesNotMatch(helperSection, /function appendSessionSelectRenderKeyPart\(/);
	    assert.doesNotMatch(helperSection, /isProcessing/);
		    assert.match(contextSource, /function isSessionSelectRenderKeyCurrent\(renderKey\)/);
		    assert.match(contextSource, /return renderKey === sessionSelectRenderKey;/);
		    assert.match(contextSource, /function isSessionSelectCurrent\(sessions, selectedId\)/);
		    assert.match(contextSource, /return isSessionSelectRenderKeyCurrent\(getSessionSelectRenderKey\(sessions, selectedId \|\| ''\)\);/);
		    assert.match(stateSection, /const nextRenderKey = typeof renderKey === 'string' && renderKey \? renderKey : getSessionSelectRenderKey\(sessions, nextSelectedId\);/);
		    assert.match(stateSection, /if \(nextRenderKey === sessionSelectRenderKey\) return;/);
	    assert.ok(
	      stateSection.indexOf('if (nextRenderKey === sessionSelectRenderKey) return;') < stateSection.indexOf('const fragment = list.length > 1 ? document.createDocumentFragment() : null;'),
	      'expected unchanged session state to return before option allocation'
	    );
	    assert.match(stateSection, /sessionSelectRenderKey = nextRenderKey;/);
	    assert.match(stateSection, /const fragment = list\.length > 1 \? document\.createDocumentFragment\(\) : null;/);
	    assert.match(stateSection, /let singleOption = null;/);
	    assert.match(stateSection, /for \(let sessionIndex = 0; sessionIndex < list\.length; sessionIndex\+\+\)/);
	    assert.match(stateSection, /const s = list\[sessionIndex\];/);
	    assert.match(stateSection, /const rawLabel = s && s\.title \? String\(s\.title\) : id;/);
	    assert.match(stateSection, /const baseLabel = getSessionOptionLabelDisplayText\(rawLabel\);/);
	    assert.match(stateSection, /let label = baseLabel;/);
	    assert.match(stateSection, /opt\.__lingyunSessionBaseLabel = baseLabel;/);
	    assert.doesNotMatch(stateSection, /for \(const s of list\)/);
	    assert.match(stateSection, /if \(fragment\) \{[\s\S]*fragment\.appendChild\(opt\);[\s\S]*\} else \{[\s\S]*singleOption = opt;[\s\S]*\}/);
	    assert.match(stateSection, /replaceElementChildren\(sessionSelect, fragment \|\| singleOption\);/);
	    assert.doesNotMatch(stateSection, /const fragment = document\.createDocumentFragment\(\);/);
	    assert.doesNotMatch(stateSection, /setValue\(sessionSelect, nextSelectedId\);/);
	    assert.match(sessionsCaseSection, /const nextSessions = Array\.isArray\(data\.sessions\) \? data\.sessions : \[\];/);
	    assert.match(sessionsCaseSection, /const nextActiveSessionId = data\.activeSessionId \|\| currentSessionId;/);
	    assert.match(sessionsCaseSection, /const sessionActionWasPending = !!sessionActionPending \|\| sessionSwitchPending;/);
		    assert.match(sessionsCaseSection, /const nextSessionSelectRenderKey = !sessionActionWasPending &&/);
		    assert.match(sessionsCaseSection, /getSessionSelectRenderKey\(nextSessions, nextActiveSessionId\)/);
		    assert.strictEqual(
		      (sessionsCaseSection.match(/getSessionSelectRenderKey\(nextSessions, nextActiveSessionId\)/g) || []).length,
		      1,
		      'expected sessions branch to build the render key once'
		    );
	    assert.match(sessionsCaseSection, /isSessionSelectRenderKeyCurrent\(nextSessionSelectRenderKey\)/);
	    assert.ok(
	      sessionsCaseSection.indexOf('isSessionSelectRenderKeyCurrent(nextSessionSelectRenderKey)') <
	        sessionsCaseSection.indexOf("clearPendingActionTimer('sessionSwitch')"),
	      'expected duplicate idle sessions guard before clearing action state'
	    );
		    assert.match(sessionsCaseSection, /updateSessionSelect\(nextSessions, nextActiveSessionId, nextSessionSelectRenderKey\);/);
	    assert.doesNotMatch(stateSection, /sessionSelect\.innerHTML = '';/);
	  });

  test('backend session list renders centralized navigation order in one pass', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.runtime.ts'), 'utf8');
    const start = source.indexOf('getSessionsForUI(this: ChatSessionRuntimeRuntime)');
    assert.ok(start >= 0, 'expected backend session list helper');
    const end = source.indexOf('postSessions(this: ChatSessionRuntimeRuntime)', start);
    assert.ok(end > start, 'expected postSessions after backend session list helper');
    const section = source.slice(start, end);

    assert.match(section, /const sessions: Array<\{ id: string; title: string \}> = \[\];/);
    assert.match(section, /for \(const \{ session, depth \} of orderSessionsForNavigation\(/);
    assert.match(section, /this\.sessions\.values\(\),/);
    assert.match(section, /this\.activeSessionId/);
    assert.match(section, /sessions\.push\(\{/);
    assert.match(section, /title: depth > 0 \? `↳ \$\{title\}` : title,/);
    assert.match(section, /return sessions;/);
    assert.doesNotMatch(section, /\[\.\.\.this\.sessions\.values\(\)\]/);
    assert.doesNotMatch(section, /\.map\(/);
  });

  test('backend renderable message lookup scans revert boundary without findIndex callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.runtime.ts'), 'utf8');
    const start = source.indexOf('getRenderableMessages(this: ChatSessionRuntimeRuntime)');
    assert.ok(start >= 0, 'expected renderable messages helper');
    const end = source.indexOf('persistActiveSession(this: ChatSessionRuntimeRuntime)', start);
    assert.ok(end > start, 'expected persist helper after renderable messages helper');
    const section = source.slice(start, end);

    assert.match(section, /let boundaryIndex = -1;/);
    assert.match(section, /for \(let i = 0; i < this\.messages\.length; i\+\+\)/);
    assert.match(section, /if \(this\.messages\[i\]\.id === boundaryId\) \{/);
    assert.match(section, /boundaryIndex = i;/);
    assert.match(section, /return this\.messages\.slice\(0, boundaryIndex\);/);
    assert.doesNotMatch(section, /\.findIndex\(/);
  });

  test('backend context model lookup scans provider models without find callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.runtime.ts'), 'utf8');
    const helperStart = source.indexOf('function findModelInfo');
    assert.ok(helperStart >= 0, 'expected model lookup helper');
    const helperEnd = source.indexOf('function findLatestSummaryMessage', helperStart);
    assert.ok(helperEnd > helperStart, 'expected summary helper after model lookup');
    const helperSection = source.slice(helperStart, helperEnd);
    const contextStart = source.indexOf('getContextForUI(this: ChatSessionRuntimeRuntime)');
    assert.ok(contextStart >= 0, 'expected context state helper');
    const contextEnd = source.indexOf('getRenderableMessages(this: ChatSessionRuntimeRuntime)', contextStart);
    assert.ok(contextEnd > contextStart, 'expected renderable messages helper after context helper');
    const contextSection = source.slice(contextStart, contextEnd);

    assert.match(helperSection, /const normalized = modelId\.trim\(\);/);
    assert.match(helperSection, /for \(const model of models\)/);
    assert.match(helperSection, /if \(model\.id === normalized\) return model;/);
    assert.match(contextSection, /const modelInfo = findModelInfo\(this\.availableModels, this\.currentModel\);/);
    assert.doesNotMatch(helperSection, /\.find\(/);
  });

  test('manual compaction summary lookup scans history without copy reverse chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.runtime.ts'), 'utf8');
    const helperStart = source.indexOf('function findLatestSummaryMessage');
    assert.ok(helperStart >= 0, 'expected latest summary helper');
    const helperEnd = source.indexOf('export function createChatSessionRuntimeService', helperStart);
    assert.ok(helperEnd > helperStart, 'expected runtime service after latest summary helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const compactStart = source.indexOf('async compactCurrentSession(this: ChatSessionRuntimeRuntime)');
    assert.ok(compactStart >= 0, 'expected manual compaction helper');
    const compactEnd = source.indexOf("this.postMessage({ type: 'updateMessage', message: operationMsg });", compactStart);
    assert.ok(compactEnd > compactStart, 'expected compaction summary section before update post');
    const compactSection = source.slice(compactStart, compactEnd);

    assert.match(helperSection, /for \(let i = history\.length - 1; i >= 0; i--\)/);
    assert.match(helperSection, /metadata\?\.summary/);
    assert.match(compactSection, /findLatestSummaryMessage\(this\.agent\.getHistory\(\)\)/);
    assert.doesNotMatch(compactSection, /\[\.\.\.history\]\.reverse\(\)\.find/);
    assert.doesNotMatch(compactSection, /\.reverse\(\)\.find/);
  });

  test('compaction callback summary lookup scans history without find callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/compactionCallbacks.ts'), 'utf8');
    const helperStart = source.indexOf('function findHistoryMessageById');
    assert.ok(helperStart >= 0, 'expected compaction summary id lookup helper');
    const helperEnd = source.indexOf('export function createCompactionCallbacks', helperStart);
    assert.ok(helperEnd > helperStart, 'expected compaction callbacks after summary id lookup helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const compactStart = source.indexOf('function onCompactionEnd');
    assert.ok(compactStart >= 0, 'expected compaction end callback');
    const compactEnd = source.indexOf("view.postMessage({ type: 'updateMessage', message: compactionMsg });", compactStart);
    assert.ok(compactEnd > compactStart, 'expected compaction summary lookup before update post');
    const compactSection = source.slice(compactStart, compactEnd);

    assert.match(helperSection, /for \(let i = 0; i < history\.length; i\+\+\)/);
    assert.match(helperSection, /const message = history\[i\];/);
    assert.match(helperSection, /if \(message\?\.id === messageId\) return message;/);
    assert.match(compactSection, /findHistoryMessageById\(history, summaryMessageId\)/);
    assert.doesNotMatch(compactSection, /\.find\(/);
  });

  test('iteration assistant reconciliation scans history without copy reverse chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/executionState.ts'), 'utf8');
    const helperStart = source.indexOf('function findLatestAssistantMessage');
    assert.ok(helperStart >= 0, 'expected latest assistant helper');
    const helperEnd = source.indexOf('export function createChatExecutionState', helperStart);
    assert.ok(helperEnd > helperStart, 'expected execution state factory after latest assistant helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const reconcileStart = source.indexOf('function reconcileAssistantFromHistory');
    assert.ok(reconcileStart >= 0, 'expected assistant history reconciliation helper');
    const reconcileEnd = source.indexOf('function startNewTurn', reconcileStart);
    assert.ok(reconcileEnd > reconcileStart, 'expected turn reset after assistant reconciliation helper');
    const reconcileSection = source.slice(reconcileStart, reconcileEnd);

    assert.match(helperSection, /for \(let i = history\.length - 1; i >= 0; i--\)/);
    assert.match(helperSection, /message\?\.role === 'assistant'/);
    assert.match(reconcileSection, /findLatestAssistantMessage\(view\.agent\.getHistory\(\)\)/);
    assert.doesNotMatch(reconcileSection, /\[\.\.\.history\]\.reverse\(\)\.find/);
    assert.doesNotMatch(reconcileSection, /\.reverse\(\)\.find/);
  });

  test('execution state flushes token buffers without key snapshot allocation', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/executionState.ts'), 'utf8');
    const flushStart = source.indexOf('function flushAllTokenBuffers');
    assert.ok(flushStart >= 0, 'expected token buffer flush helper');
    const flushEnd = source.indexOf('function discardTokenBuffer', flushStart);
    assert.ok(flushEnd > flushStart, 'expected discard helper after flush helper');
    const flushSection = source.slice(flushStart, flushEnd);

    assert.match(flushSection, /for \(const messageId of tokenBuffersByMessageId\.keys\(\)\)/);
    assert.match(flushSection, /flushTokenBuffer\(messageId\)/);
    assert.doesNotMatch(flushSection, /\[\.\.\.tokenBuffersByMessageId\.keys\(\)\]/);
  });

  test('session settings state updates avoid duplicate checked value and title writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const planStart = bootstrapSource.indexOf('function updatePlanFirstState');
    assert.ok(planStart >= 0, 'expected plan-first state helper');
    const summaryStart = bootstrapSource.indexOf('function updateSessionSettingsTitle', planStart);
    assert.ok(summaryStart > planStart, 'expected session summary helper after plan-first helper');
    const planSection = bootstrapSource.slice(planStart, summaryStart);
    const persistStart = bootstrapSource.indexOf('function updateSessionsPersistState', summaryStart);
    assert.ok(persistStart > summaryStart, 'expected session persistence helper after session summary helper');
    const summarySection = bootstrapSource.slice(summaryStart, persistStart);
	    const retentionNormalizeStart = bootstrapSource.indexOf('function normalizeSessionRetentionLimits', persistStart);
	    assert.ok(retentionNormalizeStart > persistStart, 'expected session retention normalizer after persistence helper');
	    const persistSection = bootstrapSource.slice(persistStart, retentionNormalizeStart);
		    const retentionStart = bootstrapSource.indexOf('function updateNormalizedSessionRetentionState', retentionNormalizeStart);
		    assert.ok(retentionStart > retentionNormalizeStart, 'expected normalized session retention helper after normalizer');
		    const retentionNormalizeSection = bootstrapSource.slice(retentionNormalizeStart, retentionStart);
		    const retentionEnd = bootstrapSource.indexOf('function applySessionRetentionLimits', retentionStart);
		    assert.ok(retentionEnd > retentionStart, 'expected session retention apply helper after retention state helper');
		    const retentionSection = bootstrapSource.slice(retentionStart, retentionEnd);
    const sessionSwitchListenerStart = bootstrapSource.indexOf('if (sessionSelect)', retentionEnd);
    assert.ok(sessionSwitchListenerStart > retentionEnd, 'expected session switch listener after retention helper');
    const sessionSwitchListenerEnd = bootstrapSource.indexOf('if (sessionSettings)', sessionSwitchListenerStart);
    assert.ok(sessionSwitchListenerEnd > sessionSwitchListenerStart, 'expected session settings listener after switch listener');
    const sessionSwitchListenerSection = bootstrapSource.slice(sessionSwitchListenerStart, sessionSwitchListenerEnd);
    const persistListenerStart = bootstrapSource.indexOf('if (sessionsPersistToggle)', retentionEnd);
    assert.ok(persistListenerStart > retentionEnd, 'expected session persistence listener after retention helper');
    const persistListenerEnd = bootstrapSource.indexOf('if (sessionsMaxSessionsInput)', persistListenerStart);
    assert.ok(persistListenerEnd > persistListenerStart, 'expected session retention input listener after persistence listener');
    const persistListenerSection = bootstrapSource.slice(persistListenerStart, persistListenerEnd);
    const planListenerStart = bootstrapSource.indexOf('if (planFirstToggle)', persistListenerEnd);
    assert.ok(planListenerStart > persistListenerEnd, 'expected plan-first listener after session settings listeners');
    const planListenerEnd = bootstrapSource.indexOf('if (modelPicker)', planListenerStart);
    assert.ok(planListenerEnd > planListenerStart, 'expected model picker listener after plan-first listener');
    const planListenerSection = bootstrapSource.slice(planListenerStart, planListenerEnd);

    assert.match(planSection, /setChecked\(planFirstToggle, planFirstEnabled\);/);
    assert.match(planSection, /setTitle\(planFirstLabel, planFirstEnabled/);
	    assert.match(summarySection, /setTitle\(sessionSettings, 'Session settings: ' \+ persistText/);
	    assert.match(persistSection, /setChecked\(sessionsPersistToggle, sessionsPersistEnabled\);/);
	    assert.match(persistSection, /setTitle\(sessionsPersistLabel, sessionsPersistEnabled/);
		    assert.match(retentionNormalizeSection, /maxSessions: Number\.isFinite\(parsedMaxSessions\) && parsedMaxSessions >= 1 \? Math\.floor\(parsedMaxSessions\) : 20/);
		    assert.match(retentionNormalizeSection, /maxSessionBytes: Number\.isFinite\(parsedMaxSessionBytes\) && parsedMaxSessionBytes >= 1000 \? Math\.floor\(parsedMaxSessionBytes\) : 2000000/);
		    assert.match(retentionSection, /function updateNormalizedSessionRetentionState\(limits\)/);
		    assert.match(retentionSection, /setValue\(sessionsMaxSessionsInput, sessionsMaxSessions\);/);
		    assert.match(retentionSection, /setValue\(sessionsMaxSessionBytesInput, sessionsMaxSessionBytes\);/);
		    assert.match(retentionSection, /function updateSessionRetentionState\(maxSessions, maxSessionBytes\)/);
		    assert.match(retentionSection, /updateNormalizedSessionRetentionState\(normalizeSessionRetentionLimits\(maxSessions, maxSessionBytes\)\);/);
    assert.match(sessionSwitchListenerSection, /setValue\(sessionSelect, currentSessionId\);/);
    assert.match(persistListenerSection, /setChecked\(sessionsPersistToggle, sessionsPersistEnabled\);/);
    assert.match(planListenerSection, /setChecked\(planFirstToggle, planFirstEnabled\);/);
    assert.doesNotMatch(
	      planSection + summarySection + persistSection + retentionSection + sessionSwitchListenerSection + persistListenerSection + planListenerSection,
	      /\.(?:checked|value|title)\s*=/
	    );
  });

		  test('session clear confirmation updates avoid duplicate aria text and visibility writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const visibilityHelperStart = bootstrapSource.indexOf('function setSessionClearConfirmVisible');
	    assert.ok(visibilityHelperStart >= 0, 'expected session clear confirmation visibility helper');
	    const helperStart = bootstrapSource.indexOf('function setSessionClearConfirmAction');
	    assert.ok(helperStart >= 0, 'expected session clear confirmation helper');
	    assert.ok(visibilityHelperStart < helperStart, 'expected visibility helper before session clear confirmation action helper');
	    const visibilityHelperSection = bootstrapSource.slice(visibilityHelperStart, helperStart);
	    const helperEnd = bootstrapSource.indexOf('function closeSessionSettingsPopover', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected session settings popover helper after clear confirmation helper');
		    const helperSection = bootstrapSource.slice(helperStart, helperEnd);

			    assert.match(bootstrapSource, /function getSessionClearConfirmTrigger\(action\)/);
			    assert.match(bootstrapSource, /let\s+sessionClearConfirmSynced\s*=\s*false/);
			    assert.match(bootstrapSource, /let\s+sessionClearConfirmVisible\s*=\s*false/);
			    assert.match(visibilityHelperSection, /function setSessionClearConfirmVisible\(visible\) \{[\s\S]*if \(sessionClearConfirmVisible === visibleFlag\) return;[\s\S]*sessionClearConfirmVisible = visibleFlag;[\s\S]*sessionClearConfirm\.classList\.toggle\('hidden', !visibleFlag\);[\s\S]*\}/);
			    assert.doesNotMatch(visibilityHelperSection, /setHidden\(sessionClearConfirm/);
			    assert.match(helperSection, /const previousAction = sessionClearConfirmAction;/);
			    assert.match(helperSection, /if \(sessionClearConfirmSynced && previousAction === normalized\) \{[\s\S]*if \(!options \|\| options\.sync !== false\) syncInputState\(\);[\s\S]*return;[\s\S]*\}/);
			    assert.match(helperSection, /sessionClearConfirmSynced = true;/);
			    assert.match(helperSection, /if \(sessionClearConfirmSynced && previousAction === normalized\) \{[\s\S]*return;[\s\S]*\}[\s\S]*setSessionClearConfirmVisible\(!!normalized\);/);
			    assert.match(helperSection, /setSessionClearConfirmVisible\(!!normalized\);/);
		    assert.match(helperSection, /setAttributeValue\(sessionClearCurrentBtn, 'aria-expanded', normalized === 'clearCurrentSession' \? 'true' : 'false'\);/);
		    assert.match(helperSection, /setAttributeValue\(sessionClearSavedBtn, 'aria-expanded', normalized === 'clearSavedSessions' \? 'true' : 'false'\);/);
		    assert.match(helperSection, /setTextContent\(\s*sessionClearConfirmText,/);
		    assert.match(helperSection, /setTextContent\(sessionClearConfirmRunBtn, runLabel\);/);
		    assert.match(helperSection, /setAttributeValue\(sessionClearConfirmRunBtn, 'aria-label', runAccessibleLabel\);/);
		    assert.match(helperSection, /setTitle\(sessionClearConfirmRunBtn, runAccessibleLabel\);/);
		    assert.match(helperSection, /focusInlineConfirmationTarget\(sessionClearCancelBtn\);/);
		    assert.match(helperSection, /focusInlineConfirmationTarget\(getSessionClearConfirmTrigger\(previousAction\)\);/);
		    assert.match(helperSection, /options\.restoreFocus !== false/);
		    assert.match(bootstrapSource, /setSessionClearConfirmAction\('', \{ sync: false, restoreFocus: false \}\);/);
		    assert.doesNotMatch(helperSection, /setHidden\(sessionClearConfirm, !normalized\);/);
		    assert.doesNotMatch(helperSection, /classList\.toggle\('hidden'/);
		    assert.doesNotMatch(helperSection, /\.setAttribute\('aria-expanded'/);
	    assert.doesNotMatch(helperSection, /\.setAttribute\('aria-label'/);
	    assert.doesNotMatch(helperSection, /sessionClearConfirmText\.textContent\s*=/);
	    assert.doesNotMatch(helperSection, /sessionClearConfirmRunBtn\.textContent\s*=/);
	    assert.doesNotMatch(helperSection, /sessionClearConfirmRunBtn\.title\s*=/);
	  });

	  test('settings popover visibility updates use cached class toggles', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const focusHelperStart = bootstrapSource.indexOf('const settingsPopoverFocusReturnTargets = new WeakMap();');
	    assert.ok(focusHelperStart >= 0, 'expected settings popover focus return state');
	    const focusHelperEnd = bootstrapSource.indexOf('function updateSkillsEnabledState', focusHelperStart);
	    assert.ok(focusHelperEnd > focusHelperStart, 'expected settings popover focus helpers before skills state');
	    const focusHelperSection = bootstrapSource.slice(focusHelperStart, focusHelperEnd);
	    const settingsContainsStart = focusHelperSection.indexOf('function elementContainsEventTarget');
	    assert.ok(settingsContainsStart >= 0, 'expected settings popover containment helper');
	    const settingsContainsEnd = focusHelperSection.indexOf('function settingsTargetMatchesAny', settingsContainsStart);
	    assert.ok(settingsContainsEnd > settingsContainsStart, 'expected settings target helper after containment helper');
	    const settingsContainsSection = focusHelperSection.slice(settingsContainsStart, settingsContainsEnd);
			    assert.match(focusHelperSection, /let settingsPopoverOpenStack = \[\];/);
			    assert.match(focusHelperSection, /const settingsPopoverOpenStates = new WeakMap\(\);/);
			    assert.match(focusHelperSection, /let settingsPopoverFocusRestoreTimer = null;/);
			    assert.match(focusHelperSection, /function canFocusSettingsPopoverTarget\(element\)/);
			    assert.match(focusHelperSection, /function focusSettingsPopoverTarget\(element\)/);
			    assert.match(focusHelperSection, /element\.focus\(\{ preventScroll: true \}\);/);
			    assert.match(focusHelperSection, /return document\.activeElement === element;/);
		    assert.match(focusHelperSection, /function clearSettingsPopoverFocusRestoreTimer\(\)/);
		    assert.match(focusHelperSection, /clearTimeout\(settingsPopoverFocusRestoreTimer\);/);
			    assert.match(focusHelperSection, /function setSettingsPopoverTriggersExpanded\(triggers, expanded\)/);
		    assert.match(focusHelperSection, /const value = expanded \? 'true' : 'false';/);
		    assert.match(focusHelperSection, /for \(let triggerIndex = 0; triggerIndex < triggers\.length; triggerIndex\+\+\) \{[\s\S]*const trigger = triggers\[triggerIndex\];[\s\S]*setAttributeValue\(trigger, 'aria-expanded', value\);[\s\S]*\}/);
		    assert.match(focusHelperSection, /setAttributeValue\(trigger, 'aria-expanded', value\);/);
		    assert.match(focusHelperSection, /setAttributeValue\(triggers, 'aria-expanded', value\);/);
	    assert.match(focusHelperSection, /function isNodeEventTarget\(target\)/);
	    assert.match(focusHelperSection, /if \(typeof Node === 'function'\) return target instanceof Node;/);
	    assert.match(focusHelperSection, /return typeof target\.nodeType === 'number';/);
	    assert.match(focusHelperSection, /function elementContainsEventTarget\(element, target\)/);
	    assert.match(focusHelperSection, /if \(element === target\) return true;/);
	    assert.match(focusHelperSection, /if \(!isNodeEventTarget\(target\)\) return false;/);
	    assert.match(focusHelperSection, /if \(typeof element\.contains !== 'function'\) return false;/);
		    assert.doesNotMatch(settingsContainsSection, /catch \{/);
		    assert.match(focusHelperSection, /function settingsTargetMatchesAny\(target, triggers\)/);
		    assert.match(focusHelperSection, /for \(let triggerIndex = 0; triggerIndex < triggers\.length; triggerIndex\+\+\) \{[\s\S]*const trigger = triggers\[triggerIndex\];[\s\S]*if \(elementContainsEventTarget\(trigger, target\)\) return true;[\s\S]*\}/);
		    assert.match(focusHelperSection, /function isSettingsPopoverBoundaryTarget\(popover, target, triggers\)/);
	    assert.match(focusHelperSection, /function isSettingsPopoverOpen\(popover\)/);
	    assert.match(focusHelperSection, /const knownOpen = settingsPopoverOpenStates\.get\(popover\);/);
	    assert.match(focusHelperSection, /if \(knownOpen === true\) return true;/);
	    assert.match(focusHelperSection, /if \(knownOpen === false\) return false;/);
	    assert.doesNotMatch(focusHelperSection, /trustCachedClosed/);
	    assert.match(focusHelperSection, /const open = !popover\.classList \|\| !popover\.classList\.contains\('hidden'\);/);
	    assert.match(focusHelperSection, /settingsPopoverOpenStates\.set\(popover, open\);/);
	    assert.match(focusHelperSection, /function removeSettingsPopoverFromStack\(popover\)/);
	    assert.match(focusHelperSection, /settingsPopoverOpenStack\.splice\(i, 1\)/);
	    assert.match(focusHelperSection, /function trackSettingsPopoverOpen\(popover\)/);
	    assert.match(focusHelperSection, /function trackSettingsPopoverClosed\(popover\)/);
	    assert.match(focusHelperSection, /const SETTINGS_POPOVER_ESCAPE_ENTRIES = \[/);
	    assert.match(focusHelperSection, /const SETTINGS_POPOVER_OUTSIDE_POINTER_ENTRIES = \[/);
	    assert.match(focusHelperSection, /triggers: \[modelSettings, modelPicker\]/);
	    assert.match(focusHelperSection, /for \(let settingsEntryIndex = 0; settingsEntryIndex < SETTINGS_POPOVER_ESCAPE_ENTRIES\.length; settingsEntryIndex\+\+\) \{[\s\S]*const settingsEntry = SETTINGS_POPOVER_ESCAPE_ENTRIES\[settingsEntryIndex\];[\s\S]*settingsPopoverOpenStates\.set\(settingsEntry\.popover, false\);[\s\S]*\}/);
	    assert.match(focusHelperSection, /for \(let settingsEntryIndex = 0; settingsEntryIndex < entries\.length; settingsEntryIndex\+\+\) \{[\s\S]*const settingsEntry = entries\[settingsEntryIndex\];[\s\S]*if \(settingsEntry\.popover === popover\) return settingsEntry;[\s\S]*\}/);
	    assert.strictEqual(
	      (focusHelperSection.match(/for \(let settingsEntryIndex = 0; settingsEntryIndex < entries\.length; settingsEntryIndex\+\+\)/g) || []).length,
	      2,
	      'expected settings entry lookup and Escape fallback scans to use indexed loops'
	    );
	    assert.doesNotMatch(focusHelperSection, /for \(const entry of (?:SETTINGS_POPOVER_ESCAPE_ENTRIES|entries)\)/);
	    assert.match(focusHelperSection, /function findSettingsPopoverEntry\(popover, entries\)/);
		    assert.match(focusHelperSection, /function closeSettingsPopoverForEscape\(\)/);
		    assert.match(focusHelperSection, /isSettingsPopoverOpen\(popover\)/);
		    assert.match(focusHelperSection, /isSettingsPopoverOpen\(settingsEntry\.popover\)/);
		    assert.match(focusHelperSection, /function closeOpenSettingsPopoversFromOutsidePointer\(target\)/);
		    assert.match(focusHelperSection, /if \(settingsPopoverOpenStack\.length === 0\) return;/);
		    assert.match(focusHelperSection, /closeSettingsPopoverFromOutsidePointer\(entry\.popover, entry\.triggers, entry\.close, target\);/);
		    assert.match(focusHelperSection, /function restoreSettingsPopoverFocusAfterPointerDismiss\(popover, target\)/);
		    assert.match(focusHelperSection, /clearSettingsPopoverFocusRestoreTimer\(\);[\s\S]*const timer = setTimeout/);
		    assert.match(focusHelperSection, /if \(settingsPopoverFocusRestoreTimer !== timer\) return;[\s\S]*settingsPopoverFocusRestoreTimer = null;/);
		    assert.match(focusHelperSection, /settingsPopoverFocusRestoreTimer = timer;/);
		    assert.match(focusHelperSection, /function closeSettingsPopoverFromOutsidePointer\(popover, triggers, close, target\)/);
		    assert.match(focusHelperSection, /isSettingsPopoverBoundaryTarget\(popover, target, triggers\)/);
		    assert.match(focusHelperSection, /function toggleSettingsPopover\(popover, open, close\)/);
		    assert.match(focusHelperSection, /isSettingsPopoverOpen\(popover\)/);
		    assert.match(focusHelperSection, /close\(\);[\s\S]*open\(\);/);
		    assert.match(focusHelperSection, /function openSettingsPopover\(popover, fallbackTrigger, closeControl, expandedTriggers\)/);
		    assert.match(focusHelperSection, /const knownOpen = settingsPopoverOpenStates\.get\(popover\);/);
		    assert.match(focusHelperSection, /if \(knownOpen === true\) return;/);
		    assert.match(focusHelperSection, /const wasHidden = knownOpen === false \? true : \(!popover\.classList \|\| popover\.classList\.contains\('hidden'\)\);/);
	    assert.match(focusHelperSection, /settingsPopoverFocusReturnTargets\.set\(popover, getSettingsPopoverFocusReturnTarget\(popover, fallbackTrigger\)\);/);
	    assert.match(focusHelperSection, /popover\.classList\.toggle\('hidden', false\);/);
	    assert.match(focusHelperSection, /settingsPopoverOpenStates\.set\(popover, true\);/);
	    assert.match(focusHelperSection, /trackSettingsPopoverOpen\(popover\);/);
	    assert.match(focusHelperSection, /setSettingsPopoverTriggersExpanded\(expandedTriggers \|\| fallbackTrigger, true\);/);
	    assert.match(focusHelperSection, /focusSettingsPopoverTarget\(closeControl\);/);
		    assert.match(focusHelperSection, /function closeSettingsPopover\(popover, expandedTriggers, options\)/);
		    assert.match(focusHelperSection, /if \(knownOpen === false\) return;/);
		    assert.match(focusHelperSection, /const wasOpen = knownOpen === true \? true : \(!popover\.classList \|\| !popover\.classList\.contains\('hidden'\)\);/);
		    assert.match(focusHelperSection, /if \(Array\.isArray\(expandedTriggers\)\) \{/);
		    assert.match(focusHelperSection, /for \(let triggerIndex = 0; triggerIndex < expandedTriggers\.length; triggerIndex\+\+\) \{[\s\S]*const trigger = expandedTriggers\[triggerIndex\];[\s\S]*if \(canFocusSettingsPopoverTarget\(trigger\)\) \{[\s\S]*focusReturnTarget = trigger;[\s\S]*break;[\s\S]*\}/);
		    assert.match(focusHelperSection, /\} else if \(canFocusSettingsPopoverTarget\(expandedTriggers\)\) \{/);
	    assert.match(focusHelperSection, /popover\.classList\.toggle\('hidden', true\);/);
	    assert.match(focusHelperSection, /settingsPopoverOpenStates\.set\(popover, false\);/);
	    assert.doesNotMatch(focusHelperSection, /setHidden\(popover,/);
	    assert.match(focusHelperSection, /trackSettingsPopoverClosed\(popover\);/);
	    assert.match(focusHelperSection, /setSettingsPopoverTriggersExpanded\(expandedTriggers, false\);/);
		    assert.match(focusHelperSection, /restoreSettingsPopoverFocus\(focusReturnTarget\);/);
			    assert.match(mainSource, /clearSettingsPopoverFocusRestoreTimer\(\);/);
			    assert.match(bootstrapSource, /function toggleProviderSettingsPopover\(\) \{\s*toggleSettingsPopover\(providerSettingsPopover, openProviderSettingsPopover, closeProviderSettingsPopover\);\s*\}/);
			    assert.match(bootstrapSource, /function toggleModelSettingsPopover\(\) \{\s*toggleSettingsPopover\(modelSettingsPopover, openModelSettingsPopover, closeModelSettingsPopover\);\s*\}/);
			    assert.match(bootstrapSource, /function toggleSessionSettingsPopover\(\) \{\s*toggleSettingsPopover\(sessionSettingsPopover, openSessionSettingsPopover, closeSessionSettingsPopover\);\s*\}/);
			    assert.match(bootstrapSource, /function toggleSafetySettingsPopover\(\) \{\s*toggleSettingsPopover\(safetySettingsPopover, openSafetySettingsPopover, closeSafetySettingsPopover\);\s*\}/);
			    assert.match(bootstrapSource, /function toggleSkillsSettingsPopover\(\) \{\s*toggleSettingsPopover\(skillsSettingsPopover, openSkillsSettingsPopover, closeSkillsSettingsPopover\);\s*\}/);
			    assert.doesNotMatch(focusHelperSection, /normalizeSettingsPopoverTriggers/);
	    assert.doesNotMatch(focusHelperSection, /return Array\.isArray\(triggers\) \? triggers : \[triggers\]/);
		    assert.doesNotMatch(focusHelperSection, /settingsPopoverOpenStack = settingsPopoverOpenStack\.filter/);
		    assert.doesNotMatch(focusHelperSection, /function getSettingsPopoverEscapeEntries\(\)/);
		    assert.doesNotMatch(focusHelperSection, /for \(const trigger of (?:triggers|expandedTriggers)\)/);
	    const helpers = [
	      {
	        close: 'function closeProviderSettingsPopover',
	        toggle: 'function toggleProviderSettingsPopover',
	        element: 'providerSettingsPopover',
	        trigger: 'providerSettings',
	        closeControl: 'providerSettingsClose',
	        expandedTriggers: undefined,
	      },
	      {
	        close: 'function closeModelSettingsPopover',
	        toggle: 'function toggleModelSettingsPopover',
	        element: 'modelSettingsPopover',
	        trigger: 'modelSettings',
	        closeControl: 'modelSettingsClose',
	        expandedTriggers: '[modelSettings, modelPicker]',
	      },
	      {
	        close: 'function closeSessionSettingsPopover',
	        toggle: 'function toggleSessionSettingsPopover',
	        element: 'sessionSettingsPopover',
	        trigger: 'sessionSettings',
	        closeControl: 'sessionSettingsClose',
	        expandedTriggers: undefined,
	      },
	      {
	        close: 'function closeSafetySettingsPopover',
	        toggle: 'function toggleSafetySettingsPopover',
	        element: 'safetySettingsPopover',
	        trigger: 'safetySettings',
	        closeControl: 'safetySettingsClose',
	        expandedTriggers: undefined,
	      },
	      {
	        close: 'function closeSkillsSettingsPopover',
	        toggle: 'function toggleSkillsSettingsPopover',
	        element: 'skillsSettingsPopover',
	        trigger: 'skillsSettings',
	        closeControl: 'skillsSettingsClose',
	        expandedTriggers: undefined,
	      },
	    ];

		    for (const helper of helpers) {
	      const helperStart = bootstrapSource.indexOf(helper.close);
	      assert.ok(helperStart >= 0, `expected ${helper.close}`);
      const helperEnd = bootstrapSource.indexOf(helper.toggle, helperStart);
	      assert.ok(helperEnd > helperStart, `expected ${helper.toggle} after ${helper.close}`);
	      const helperSection = bootstrapSource.slice(helperStart, helperEnd);

	      const expanded = helper.expandedTriggers || helper.trigger;
	      assert.ok(helperSection.includes(`closeSettingsPopover(${helper.element}, ${expanded}`));
	      assert.ok(helperSection.includes(`openSettingsPopover(${helper.element}, ${helper.trigger}, ${helper.closeControl}`));
	      assert.doesNotMatch(helperSection, new RegExp(helper.element + "\\.classList\\.(?:add|remove)\\('hidden'\\)"));
		      assert.doesNotMatch(helperSection, /\.setAttribute\('aria-expanded'/);
		    }
		    const modelHelperStart = bootstrapSource.indexOf('function closeModelSettingsPopover');
		    assert.ok(modelHelperStart >= 0, 'expected model settings close helper');
		    const modelHelperEnd = bootstrapSource.indexOf('function toggleModelSettingsPopover', modelHelperStart);
		    assert.ok(modelHelperEnd > modelHelperStart, 'expected model settings toggle after open helper');
		    const modelHelperSection = bootstrapSource.slice(modelHelperStart, modelHelperEnd);
		    assert.ok(modelHelperSection.includes('closeSettingsPopover(modelSettingsPopover, [modelSettings, modelPicker], options);'));
		    assert.ok(modelHelperSection.includes('openSettingsPopover(modelSettingsPopover, modelSettings, modelSettingsClose, [modelSettings, modelPicker]);'));
		    const outsideClickStart = bootstrapSource.indexOf("document.addEventListener('click'");
		    assert.ok(outsideClickStart >= 0, 'expected document click handler');
		    const outsideClickEnd = bootstrapSource.indexOf("document.addEventListener('keydown'", outsideClickStart);
		    assert.ok(outsideClickEnd > outsideClickStart, 'expected keydown handler after click handler');
		    const outsideClickSection = bootstrapSource.slice(outsideClickStart, outsideClickEnd);
		    assert.match(outsideClickSection, /elementContainsEventTarget\(outputModal, target\)/);
		    assert.match(outsideClickSection, /elementContainsEventTarget\(skillDropdown, target\)/);
		    assert.match(outsideClickSection, /closeOpenSettingsPopoversFromOutsidePointer\(target\);/);
		    assert.doesNotMatch(outsideClickSection, /closeSettingsPopoverFromOutsidePointer\((?:modelSettingsPopover|providerSettingsPopover|sessionSettingsPopover|safetySettingsPopover|skillsSettingsPopover)/);
		    assert.doesNotMatch(outsideClickSection, /\.contains\(target\)/);
	    const settingsKeydownStart = bootstrapSource.indexOf("document.addEventListener('keydown'", outsideClickEnd);
	    assert.ok(settingsKeydownStart >= 0, 'expected settings Escape keydown handler');
	    const settingsKeydownEnd = bootstrapSource.indexOf('const defaultPlaceholder', settingsKeydownStart);
	    assert.ok(settingsKeydownEnd > settingsKeydownStart, 'expected send helper after settings Escape keydown handler');
	    const settingsKeydownSection = bootstrapSource.slice(settingsKeydownStart, settingsKeydownEnd);
		    assert.match(settingsKeydownSection, /if \(outputModal && \(typeof isOutputModalOpen === 'function' \? isOutputModalOpen\(\) : !outputModal\.classList\.contains\('hidden'\)\)\) return;/);
	    assert.match(settingsKeydownSection, /if \(!closeSettingsPopoverForEscape\(\)\) return;/);
	    assert.match(settingsKeydownSection, /e\.preventDefault\(\);/);
	    assert.match(settingsKeydownSection, /e\.stopImmediatePropagation\(\);/);
	    assert.doesNotMatch(settingsKeydownSection, /closeModelSettingsPopover\(\);[\s\S]*closeProviderSettingsPopover\(\);/);
	  });

	  test('provider control state updates avoid duplicate property writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const providerStart = bootstrapSource.indexOf('const providerSettingsStatePending');
    assert.ok(providerStart >= 0, 'expected provider settings section');
    const providerEnd = bootstrapSource.indexOf('const safetyControlsDisabled', providerStart);
    assert.ok(providerEnd > providerStart, 'expected safety settings section after provider controls');
    const providerSection = bootstrapSource.slice(providerStart, providerEnd);

    assert.match(providerSection, /const providerSettingsDisabled = !connected \|\| routingControlsBusy \|\| providerSwitchPending \|\| providerSettingsStatePending;/);
    assert.match(providerSection, /setDisabled\(providerSelect, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabled\(providerSettings, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabled\(codexDefaultModelInput, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabledClass\(codexDefaultModelLabel, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabled\(openAIBaseURLInput, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabledClass\(openAIBaseURLLabel, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabled\(openAIModelDisplayNamesInput, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabledClass\(openAIModelDisplayNamesLabel, providerSettingsDisabled\);/);
    assert.match(providerSection, /setDisabled\(providerSettingsApply, providerSettingsDisabled\);/);
    assert.doesNotMatch(providerSection, /\.(?:disabled)\s*=/);
	    assert.doesNotMatch(providerSection, /classList\.toggle\('disabled'/);
	  });

		  test('provider settings state updates avoid duplicate value checked and title writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const selectionStart = bootstrapSource.indexOf('function updateProviderSelection');
    assert.ok(selectionStart >= 0, 'expected provider selection helper');
    const selectionEnd = bootstrapSource.indexOf('function normalizeOpenAICompatibleDisplayNames', selectionStart);
    assert.ok(selectionEnd > selectionStart, 'expected OpenAI display-name normalizer after provider selection helper');
    const selectionSection = bootstrapSource.slice(selectionStart, selectionEnd);
    const summaryStart = bootstrapSource.indexOf('function updateProviderSettingsSummary');
    assert.ok(summaryStart >= 0, 'expected provider settings summary helper');
    const codexStart = bootstrapSource.indexOf('function updateNormalizedCodexSubscriptionSettingsState', summaryStart);
    assert.ok(codexStart > summaryStart, 'expected Codex settings helper after provider summary helper');
    const summarySection = bootstrapSource.slice(summaryStart, codexStart);
    const openAIStart = bootstrapSource.indexOf('function updateNormalizedOpenAICompatibleSettingsState', codexStart);
    assert.ok(openAIStart > codexStart, 'expected OpenAI settings helper after Codex settings helper');
    const codexSection = bootstrapSource.slice(codexStart, openAIStart);
    const openAIEnd = bootstrapSource.indexOf('function closeProviderSettingsPopover', openAIStart);
    assert.ok(openAIEnd > openAIStart, 'expected provider popover helper after OpenAI settings helper');
    const openAISection = bootstrapSource.slice(openAIStart, openAIEnd);
    const providerListenerStart = bootstrapSource.indexOf('if (providerSelect)', openAIEnd);
    assert.ok(providerListenerStart > openAIEnd, 'expected provider switch listener after provider helpers');
    const providerListenerEnd = bootstrapSource.indexOf('if (providerSettings)', providerListenerStart);
    assert.ok(providerListenerEnd > providerListenerStart, 'expected provider settings listener after provider switch listener');
    const providerListenerSection = bootstrapSource.slice(providerListenerStart, providerListenerEnd);
    const applyStart = bootstrapSource.indexOf('function applyProviderSettings', openAIEnd);
    assert.ok(applyStart > openAIEnd, 'expected provider apply helper after provider settings helpers');
	    const applyEnd = bootstrapSource.indexOf('function normalizeTextVerbosity', applyStart);
	    assert.ok(applyEnd > applyStart, 'expected generation settings helper after provider apply helper');
	    const applySection = bootstrapSource.slice(applyStart, applyEnd);
	    const providerAuthEqualStart = contextSource.indexOf('function providerAuthStatesEqual');
	    assert.ok(providerAuthEqualStart >= 0, 'expected provider auth equality helper');
	    const providerAuthEqualEnd = contextSource.indexOf('function updateProviderAuthHeader', providerAuthEqualStart);
	    assert.ok(providerAuthEqualEnd > providerAuthEqualStart, 'expected provider auth header helper after equality helper');
	    const providerAuthEqualSection = contextSource.slice(providerAuthEqualStart, providerAuthEqualEnd);
	    const providerStateStart = mainSource.indexOf("case 'providerState':");
	    assert.ok(providerStateStart >= 0, 'expected provider state branch');
	    const openAICompatibleStateStart = mainSource.indexOf("case 'openAICompatibleSettingsState':", providerStateStart);
	    assert.ok(openAICompatibleStateStart > providerStateStart, 'expected OpenAI-compatible settings branch after provider branch');
	    const providerStateSection = mainSource.slice(providerStateStart, openAICompatibleStateStart);
	    const codexSubscriptionStateStart = mainSource.indexOf("case 'codexSubscriptionSettingsState':", openAICompatibleStateStart);
	    assert.ok(codexSubscriptionStateStart > openAICompatibleStateStart, 'expected Codex subscription settings branch after OpenAI-compatible branch');
	    const openAICompatibleStateSection = mainSource.slice(openAICompatibleStateStart, codexSubscriptionStateStart);
	    const planFirstStateStart = mainSource.indexOf("case 'planFirstState':", codexSubscriptionStateStart);
	    assert.ok(planFirstStateStart > codexSubscriptionStateStart, 'expected plan-first branch after Codex subscription branch');
	    const codexSubscriptionStateSection = mainSource.slice(codexSubscriptionStateStart, planFirstStateStart);

	    assert.match(selectionSection, /setValue\(providerSelect, currentProviderId\);/);
	    assert.match(selectionSection, /setTitle\(providerSelect, currentProviderId === 'copilot'/);
	    assert.doesNotMatch(selectionSection, /update(?:Normalized)?OpenAICompatibleSettingsState/);
	    assert.match(summarySection, /const codexDefaultModelDisplay = getModelDisplayText\(codexSubscriptionSettings\.defaultModelId\);/);
	    assert.match(summarySection, /const openAIDefaultModelDisplay = getModelDisplayText\(openAICompatibleSettings\.defaultModelId\);/);
	    assert.match(summarySection, /'Provider settings: Codex default ' \+ codexDefaultModelDisplay/);
	    assert.match(summarySection, /', OpenAI-compatible default ' \+ openAIDefaultModelDisplay/);
    assert.match(codexSection, /function updateNormalizedCodexSubscriptionSettingsState\(settings\)/);
    assert.match(codexSection, /setValue\(codexDefaultModelInput, codexSubscriptionSettings\.defaultModelId\);/);
    assert.match(codexSection, /setTitle\(codexDefaultModelLabel, 'Codex subscription fallback model: ' \+ getModelDisplayText\(codexSubscriptionSettings\.defaultModelId\)\);/);
    assert.match(codexSection, /function updateCodexSubscriptionSettingsState\(settings\)/);
    assert.match(codexSection, /updateNormalizedCodexSubscriptionSettingsState\(normalizeCodexSubscriptionSettings\(settings\)\);/);
    assert.match(openAISection, /function updateNormalizedOpenAICompatibleSettingsState\(settings\)/);
    assert.match(openAISection, /setValue\(openAIBaseURLInput, openAICompatibleSettings\.baseURL\);/);
    assert.match(openAISection, /setValue\(openAIDefaultModelInput, openAICompatibleSettings\.defaultModelId\);/);
    assert.match(openAISection, /setValue\(openAIApiKeyEnvInput, openAICompatibleSettings\.apiKeyEnv\);/);
    assert.match(openAISection, /setChecked\(openAIAllowInsecureTLSInput, openAICompatibleSettings\.allowInsecureTLS\);/);
    assert.match(openAISection, /setValue\(openAIModelDisplayNamesInput, serializeNormalizedOpenAICompatibleDisplayNames\(openAICompatibleSettings\.modelDisplayNames\)\);/);
    assert.match(openAISection, /setTitle\(openAIBaseURLLabel, hasBaseURL/);
    assert.match(openAISection, /setTitle\(openAIDefaultModelLabel, openAICompatibleSettings\.defaultModelId/);
    assert.match(openAISection, /'Fallback model: ' \+ getModelDisplayText\(openAICompatibleSettings\.defaultModelId\)/);
    assert.match(openAISection, /setTitle\(openAIApiKeyEnvLabel, 'API key environment variable: ' \+ openAICompatibleSettings\.apiKeyEnv\);/);
    assert.match(openAISection, /setTitle\(openAIAllowInsecureTLSLabel, openAICompatibleSettings\.allowInsecureTLS/);
    assert.match(openAISection, /setTitle\(openAIModelDisplayNamesLabel, modelCount/);
    assert.match(openAISection, /function updateOpenAICompatibleSettingsState\(settings\)/);
    assert.match(openAISection, /updateNormalizedOpenAICompatibleSettingsState\(normalizeOpenAICompatibleSettings\(settings\)\);/);
	    assert.match(providerListenerSection, /setValue\(providerSelect, currentProviderId\);/);
	    assert.match(providerAuthEqualSection, /left\.providerId === right\.providerId/);
	    assert.match(providerAuthEqualSection, /left\.secondaryActionLabel === right\.secondaryActionLabel/);
		    assert.match(providerStateSection, /const nextProviderStateId = normalizeProviderId\(data\.currentProviderId \|\| \(data\.providerAuth && data\.providerAuth\.providerId\) \|\| ''\);/);
		    assert.match(providerStateSection, /const nextProviderStateAuth = normalizeProviderAuthState\(data\.providerAuth \|\| null\);/);
		    assert.match(providerStateSection, /providerAuthStatesEqual\(nextProviderStateAuth, currentProviderAuth\)/);
		    assert.match(providerStateSection, /updateProviderSelection\(nextProviderStateId\);/);
		    assert.match(providerStateSection, /updateNormalizedProviderAuthHeader\(nextProviderStateAuth\);/);
		    assert.match(openAICompatibleStateSection, /const nextOpenAICompatibleSettings = normalizeOpenAICompatibleSettings\(data\.openAICompatibleSettings \|\| \{\}\);/);
	    assert.match(openAICompatibleStateSection, /!hasPendingSettingState\('openAICompatibleSettingsState'\)/);
	    assert.match(openAICompatibleStateSection, /openAICompatibleSettingsEqual\(nextOpenAICompatibleSettings, openAICompatibleSettings\)/);
		    assert.match(openAICompatibleStateSection, /providerAuthStatesEqual\(nextOpenAICompatibleProviderAuth, currentProviderAuth\)/);
		    assert.match(openAICompatibleStateSection, /updateNormalizedOpenAICompatibleSettingsState\(nextOpenAICompatibleSettings\);/);
		    assert.match(openAICompatibleStateSection, /if \(hasOpenAICompatibleProviderAuth\) updateNormalizedProviderAuthHeader\(nextOpenAICompatibleProviderAuth\);/);
		    assert.match(codexSubscriptionStateSection, /const nextCodexSubscriptionSettings = normalizeCodexSubscriptionSettings\(data\.codexSubscriptionSettings \|\| \{\}\);/);
	    assert.match(codexSubscriptionStateSection, /!hasPendingSettingState\('codexSubscriptionSettingsState'\)/);
	    assert.match(codexSubscriptionStateSection, /codexSubscriptionSettingsEqual\(nextCodexSubscriptionSettings, codexSubscriptionSettings\)/);
		    assert.match(codexSubscriptionStateSection, /providerAuthStatesEqual\(nextCodexSubscriptionProviderAuth, currentProviderAuth\)/);
		    assert.match(codexSubscriptionStateSection, /updateNormalizedCodexSubscriptionSettingsState\(nextCodexSubscriptionSettings\);/);
		    assert.match(codexSubscriptionStateSection, /if \(hasCodexSubscriptionProviderAuth\) updateNormalizedProviderAuthHeader\(nextCodexSubscriptionProviderAuth\);/);
		    assert.doesNotMatch(selectionSection + summarySection + codexSection + openAISection + providerListenerSection, /\.(?:value|checked|title)\s*=/);
    assert.match(applySection, /const codexChanged = !codexSubscriptionSettingsEqual\(codexNext, codexSubscriptionSettings\);/);
    assert.match(applySection, /const openAIChanged = !openAICompatibleSettingsEqual\(openAINext, openAICompatibleSettings\);/);
    assert.match(applySection, /if \(!codexChanged && !openAIChanged\) \{/);
    assert.match(applySection, /stateTypes\.push\('codexSubscriptionSettingsState'\);/);
    assert.match(applySection, /messages\.push\(\{ type: 'setOpenAICompatibleSettings', settings: openAINext \}\);/);
    assert.ok(
      applySection.indexOf('if (!codexChanged && !openAIChanged)') < applySection.indexOf('postSettingsWithPendingStates'),
      'expected unchanged provider apply guard before settings post'
    );
	  });

	  test('advanced safety settings state updates avoid duplicate value checked and title writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const autoApproveStart = bootstrapSource.indexOf('function updateAutoApproveState');
    assert.ok(autoApproveStart >= 0, 'expected auto-approve state helper');
    const allowExternalStart = bootstrapSource.indexOf('function updateAllowExternalPathsState', autoApproveStart);
    assert.ok(allowExternalStart > autoApproveStart, 'expected external-path state helper after auto-approve state helper');
    const autoApproveSection = bootstrapSource.slice(autoApproveStart, allowExternalStart);
    const blockPushStart = bootstrapSource.indexOf('function updateBlockGitPushState', allowExternalStart);
    assert.ok(blockPushStart > allowExternalStart, 'expected git-push state helper after external-path state helper');
    const allowExternalSection = bootstrapSource.slice(allowExternalStart, blockPushStart);
    const debugNormalizeStart = bootstrapSource.indexOf('function normalizeDebugSettings', blockPushStart);
    assert.ok(debugNormalizeStart > blockPushStart, 'expected debug normalizer after git-push state helper');
    const blockPushSection = bootstrapSource.slice(blockPushStart, debugNormalizeStart);
    const debugStart = bootstrapSource.indexOf('function updateNormalizedDebugSettingsState', debugNormalizeStart);
    assert.ok(debugStart > debugNormalizeStart, 'expected normalized debug state helper after debug normalizer');
    const debugEnd = bootstrapSource.indexOf('function applyDebugSettings', debugStart);
    assert.ok(debugEnd > debugStart, 'expected debug apply helper after debug state helper');
    const debugSection = bootstrapSource.slice(debugStart, debugEnd);
    const pluginSpecsNormalizeStart = bootstrapSource.indexOf('function normalizePluginSpecs', debugEnd);
    assert.ok(pluginSpecsNormalizeStart > debugEnd, 'expected plugin specs normalizer after debug helpers');
    const pluginTitleStart = bootstrapSource.indexOf('function getPluginSpecsTitleDisplayText', pluginSpecsNormalizeStart);
    assert.ok(pluginTitleStart > pluginSpecsNormalizeStart, 'expected plugin specs title display helper after plugin specs normalizer');
    const pluginNormalizeStart = bootstrapSource.indexOf('function normalizePluginSettings', pluginTitleStart);
    assert.ok(pluginNormalizeStart > pluginTitleStart, 'expected plugin settings normalizer after plugin specs title display helper');
    const pluginStart = bootstrapSource.indexOf('function updateNormalizedPluginSettingsState', pluginNormalizeStart);
    assert.ok(pluginStart > pluginNormalizeStart, 'expected normalized plugin state helper after plugin normalizer');
    const debugApplySection = bootstrapSource.slice(debugEnd, pluginSpecsNormalizeStart);
    const pluginTitleSection = bootstrapSource.slice(pluginTitleStart, pluginNormalizeStart);
    const pluginEnd = bootstrapSource.indexOf('function applyPluginSettings', pluginStart);
    assert.ok(pluginEnd > pluginStart, 'expected plugin apply helper after plugin state helper');
    const pluginSection = bootstrapSource.slice(pluginStart, pluginEnd);
	    const filterTitleStart = bootstrapSource.indexOf('function getToolFilterTitleDisplayText', pluginEnd);
	    assert.ok(filterTitleStart > pluginEnd, 'expected tool-filter title display helper after plugin helper');
	    const filterStart = bootstrapSource.indexOf('function updateNormalizedToolFilterState', filterTitleStart);
	    assert.ok(filterStart > filterTitleStart, 'expected normalized tool-filter state helper after title display helper');
    const pluginApplySection = bootstrapSource.slice(pluginEnd, filterTitleStart);
	    const filterTitleSection = bootstrapSource.slice(filterTitleStart, filterStart);
    const filterApplyStart = bootstrapSource.indexOf('function applyToolFilter', filterStart);
    assert.ok(filterApplyStart > filterStart, 'expected tool-filter apply helper after tool-filter state helper');
    const filterStateSection = bootstrapSource.slice(filterStart, filterApplyStart);
    const envStart = bootstrapSource.indexOf('function updateNormalizedWorkspaceEnvState', filterApplyStart);
    assert.ok(envStart > filterApplyStart, 'expected normalized workspace env state helper after tool-filter helpers');
    const envEnd = bootstrapSource.indexOf('function applyWorkspaceEnv', envStart);
    assert.ok(envEnd > envStart, 'expected workspace env apply helper after workspace env state helper');
    const filterApplySection = bootstrapSource.slice(filterApplyStart, envStart);
    const envSection = bootstrapSource.slice(envStart, envEnd);
    const envApplyEnd = bootstrapSource.indexOf('function hasToolCatalogSchemaDefault', envEnd);
    assert.ok(envApplyEnd > envEnd, 'expected tool catalog helper after workspace env apply helper');
    const envApplySection = bootstrapSource.slice(envEnd, envApplyEnd);
    const pluginAutoListenerStart = bootstrapSource.indexOf("pluginsAutoDiscoverToggle.addEventListener('change'", envApplyEnd);
    assert.ok(pluginAutoListenerStart > envApplyEnd, 'expected plugin auto-discovery listener after safety helpers');
    const pluginAutoListenerEnd = bootstrapSource.indexOf('if (pluginsWorkspaceDirInput)', pluginAutoListenerStart);
    assert.ok(pluginAutoListenerEnd > pluginAutoListenerStart, 'expected plugin workspace dir listener after auto-discovery listener');
    const pluginAutoListenerSection = bootstrapSource.slice(pluginAutoListenerStart, pluginAutoListenerEnd);
    const summaryStart = bootstrapSource.indexOf('function updateSafetySettingsTitle');
    assert.ok(summaryStart >= 0, 'expected safety settings summary helper');
    const summaryEnd = bootstrapSource.indexOf('function normalizeInstructionPatterns', summaryStart);
    assert.ok(summaryEnd > summaryStart, 'expected instruction normalizer after safety summary helper');
    const summarySection = bootstrapSource.slice(summaryStart, summaryEnd);
    const autoApproveStateStart = mainSource.indexOf("case 'autoApproveState':");
    assert.ok(autoApproveStateStart >= 0, 'expected auto-approve state branch');
    const allowExternalStateStart = mainSource.indexOf("case 'allowExternalPathsState':", autoApproveStateStart);
    assert.ok(allowExternalStateStart > autoApproveStateStart, 'expected external-path state branch after auto-approve state');
    const autoApproveStateSection = mainSource.slice(autoApproveStateStart, allowExternalStateStart);
    const blockGitPushStateStart = mainSource.indexOf("case 'blockGitPushState':", allowExternalStateStart);
    assert.ok(blockGitPushStateStart > allowExternalStateStart, 'expected git-push state branch after external-path state');
    const allowExternalStateSection = mainSource.slice(allowExternalStateStart, blockGitPushStateStart);
	    const debugSettingsStateStart = mainSource.indexOf("case 'debugSettingsState':", blockGitPushStateStart);
	    assert.ok(debugSettingsStateStart > blockGitPushStateStart, 'expected debug settings branch after git-push state');
	    const blockGitPushStateSection = mainSource.slice(blockGitPushStateStart, debugSettingsStateStart);
	    const toolRuntimeLimitsStateStart = mainSource.indexOf("case 'toolRuntimeLimitsState':", debugSettingsStateStart);
	    assert.ok(toolRuntimeLimitsStateStart > debugSettingsStateStart, 'expected tool runtime branch after debug settings branch');
	    const debugSettingsStateSection = mainSource.slice(debugSettingsStateStart, toolRuntimeLimitsStateStart);
	    const pluginSettingsStateStart = mainSource.indexOf("case 'pluginSettingsState':", toolRuntimeLimitsStateStart);
	    assert.ok(pluginSettingsStateStart > toolRuntimeLimitsStateStart, 'expected plugin settings branch after tool runtime branch');
	    const toolRuntimeLimitsStateSection = mainSource.slice(toolRuntimeLimitsStateStart, pluginSettingsStateStart);
	    const toolFilterStateStart = mainSource.indexOf("case 'toolFilterState':", pluginSettingsStateStart);
	    assert.ok(toolFilterStateStart > pluginSettingsStateStart, 'expected tool-filter branch after plugin settings branch');
	    const pluginSettingsStateSection = mainSource.slice(pluginSettingsStateStart, toolFilterStateStart);
	    const toolsCatalogStateStart = mainSource.indexOf("case 'toolsCatalogState':", toolFilterStateStart);
	    assert.ok(toolsCatalogStateStart > toolFilterStateStart, 'expected tools catalog branch after tool-filter branch');
	    const toolFilterStateSection = mainSource.slice(toolFilterStateStart, toolsCatalogStateStart);
		    const workspaceEnvStateStart = mainSource.indexOf("case 'workspaceEnvState':", toolsCatalogStateStart);
		    assert.ok(workspaceEnvStateStart > toolsCatalogStateStart, 'expected workspace env branch after tools catalog branch');
		    const toolsCatalogStateSection = mainSource.slice(toolsCatalogStateStart, workspaceEnvStateStart);
		    const instructionPatternsStateStart = mainSource.indexOf("case 'instructionPatternsState':", workspaceEnvStateStart);
		    assert.ok(instructionPatternsStateStart > workspaceEnvStateStart, 'expected instruction patterns branch after workspace env branch');
		    const workspaceEnvStateSection = mainSource.slice(workspaceEnvStateStart, instructionPatternsStateStart);

    assert.match(autoApproveSection, /setValue\(safetySelect, autoApproveEnabled \? 'auto' : 'ask'\);/);
    assert.match(autoApproveSection, /setTitle\(safetySelect, autoApproveEnabled/);
    assert.match(autoApproveStateSection, /const nextAutoApproveEnabled = !!data\.autoApprove;/);
    assert.match(autoApproveStateSection, /if \(!hasPendingSettingState\('autoApproveState'\) && autoApproveEnabled === nextAutoApproveEnabled\) break;/);
    assert.match(autoApproveStateSection, /updateAutoApproveState\(nextAutoApproveEnabled\);/);
    assert.match(allowExternalSection, /setChecked\(allowExternalPathsToggle, allowExternalPathsEnabled\);/);
    assert.match(allowExternalSection, /setTitle\(allowExternalPathsLabel, allowExternalPathsEnabled/);
    assert.match(allowExternalStateSection, /const nextAllowExternalPathsEnabled = !!data\.allowExternalPaths;/);
    assert.match(allowExternalStateSection, /if \(!hasPendingSettingState\('allowExternalPathsState'\) && allowExternalPathsEnabled === nextAllowExternalPathsEnabled\) break;/);
    assert.match(allowExternalStateSection, /updateAllowExternalPathsState\(nextAllowExternalPathsEnabled\);/);
    assert.match(blockPushSection, /setChecked\(blockGitPushToggle, blockGitPushEnabled\);/);
    assert.match(blockPushSection, /setTitle\(blockGitPushLabel, blockGitPushEnabled/);
    assert.match(blockGitPushStateSection, /const nextBlockGitPushEnabled = data\.blockGitPush !== false;/);
    assert.match(blockGitPushStateSection, /if \(!hasPendingSettingState\('blockGitPushState'\) && blockGitPushEnabled === nextBlockGitPushEnabled\) break;/);
    assert.match(blockGitPushStateSection, /updateBlockGitPushState\(nextBlockGitPushEnabled\);/);
			    assert.match(debugSection, /function updateNormalizedDebugSettingsState\(settings\)/);
			    assert.match(debugSection, /function updateDebugSettingsState\(settings\)/);
			    assert.match(debugSection, /updateNormalizedDebugSettingsState\(normalizeDebugSettings\(settings\)\);/);
		    assert.match(debugSection, /setChecked\(debugDetailsToggle, debugSettings\.details\);/);
    assert.match(debugSection, /setChecked\(debugLlmToggle, debugSettings\.effectiveLlm\);/);
	    assert.match(debugSection, /setTitle\(debugDetailsLabel, debugSettings\.details/);
		    assert.match(debugSection, /setTitle\(debugPluginsLabel, debugSettings\.details/);
		    assert.match(debugApplySection, /if \(debugSettingsEqual\(next, debugSettings\)\) \{/);
		    assert.match(debugSettingsStateSection, /const nextDebugSettings = normalizeDebugSettings\(data\.debugSettings \|\| \{\}\);/);
		    assert.match(debugSettingsStateSection, /if \(!debugSettingsPending && debugSettingsEqual\(nextDebugSettings, debugSettings\)\) break;/);
			    assert.match(debugSettingsStateSection, /updateNormalizedDebugSettingsState\(nextDebugSettings\);/);
		    assert.ok(
		      debugApplySection.indexOf('debugSettingsEqual(next, debugSettings)') < debugApplySection.indexOf('vscode.postMessage'),
		      'expected unchanged diagnostics guard before posting'
		    );
				    assert.match(pluginSection, /function updateNormalizedPluginSettingsState\(settings\)/);
				    assert.match(pluginSection, /function updatePluginSettingsState\(settings\)/);
				    assert.match(pluginSection, /updateNormalizedPluginSettingsState\(normalizePluginSettings\(settings\)\);/);
			    assert.match(pluginSection, /setChecked\(pluginsAutoDiscoverToggle, pluginSettings\.autoDiscover\);/);
		    assert.match(pluginSection, /setValue\(pluginsWorkspaceDirInput, pluginSettings\.workspaceDir\);/);
		    assert.match(bootstrapSource, /const PLUGIN_SPECS_TITLE_DISPLAY_LIMIT = 240;/);
		    assert.match(pluginTitleSection, /function getPluginSpecsTitleDisplayText\(plugins\)/);
		    assert.match(pluginTitleSection, /formatCommaSeparatedList\(plugins\)/);
		    assert.match(pluginTitleSection, /value\.length <= PLUGIN_SPECS_TITLE_DISPLAY_LIMIT/);
		    assert.match(pluginTitleSection, /value\.slice\(0, PLUGIN_SPECS_TITLE_DISPLAY_LIMIT\) \+ '…'/);
			    assert.match(pluginSection, /setTitle\(pluginSpecsLabel, pluginSettings\.plugins\.length/);
		    assert.match(pluginSection, /getPluginSpecsTitleDisplayText\(pluginSettings\.plugins\)/);
		    assert.match(pluginApplySection, /hasListItemLongerThan\(next\.plugins, 240\)/);
		    assert.match(pluginApplySection, /if \(pluginSettingsEqual\(next, pluginSettings\)\) \{/);
		    assert.doesNotMatch(pluginApplySection, /\.some\(/);
		    assert.match(pluginSettingsStateSection, /const nextPluginSettings = normalizePluginSettings\(data\.pluginSettings \|\| \{\}\);/);
		    assert.match(pluginSettingsStateSection, /if \(!pluginSettingsPending && pluginSettingsEqual\(nextPluginSettings, pluginSettings\)\) break;/);
			    assert.match(pluginSettingsStateSection, /updateNormalizedPluginSettingsState\(nextPluginSettings\);/);
		    assert.match(toolRuntimeLimitsStateSection, /const nextToolRuntimeLimits = normalizeToolRuntimeLimits\(data\.toolRuntimeLimits \|\| \{\}\);/);
		    assert.match(toolRuntimeLimitsStateSection, /if \(!hasPendingSettingState\('toolRuntimeLimitsState'\) && toolRuntimeLimitsEqual\(nextToolRuntimeLimits, toolRuntimeLimits\)\) break;/);
		    assert.match(toolRuntimeLimitsStateSection, /updateNormalizedToolRuntimeLimitsState\(nextToolRuntimeLimits\);/);
		    assert.ok(
		      pluginApplySection.indexOf('pluginSettingsEqual(next, pluginSettings)') < pluginApplySection.indexOf('vscode.postMessage'),
		      'expected unchanged plugin settings guard before posting'
		    );
	    assert.match(pluginAutoListenerSection, /applyPluginSettings\(\);/);
	    assert.doesNotMatch(pluginAutoListenerSection, /vscode\.postMessage/);
	    assert.match(bootstrapSource, /const TOOL_FILTER_TITLE_DISPLAY_LIMIT = 240;/);
	    assert.match(filterTitleSection, /function getToolFilterTitleDisplayText\(patterns\)/);
	    assert.match(filterTitleSection, /formatCommaSeparatedList\(patterns\)/);
	    assert.match(filterTitleSection, /value\.length <= TOOL_FILTER_TITLE_DISPLAY_LIMIT/);
	    assert.match(filterTitleSection, /value\.slice\(0, TOOL_FILTER_TITLE_DISPLAY_LIMIT\) \+ '…'/);
	    assert.match(filterStateSection, /function updateNormalizedToolFilterState\(patterns\)/);
	    assert.match(filterStateSection, /function updateToolFilterState\(patterns\)/);
	    assert.match(filterStateSection, /updateNormalizedToolFilterState\(normalizeToolFilter\(patterns\)\);/);
	    assert.match(filterStateSection, /setValue\(toolFilterInput, toolFilter\.join\('\\n'\)\);/);
	    assert.match(filterStateSection, /setTitle\(toolFilterLabel, toolFilter\.length/);
	    assert.match(filterStateSection, /getToolFilterTitleDisplayText\(toolFilter\)/);
		    assert.match(filterApplySection, /hasListItemLongerThan\(patterns, 120\)/);
	    assert.match(filterApplySection, /if \(stringListsEqual\(patterns, toolFilter\)\) \{/);
		    assert.match(filterApplySection, /updateNormalizedToolFilterState\(toolFilter\);/);
		    assert.doesNotMatch(filterApplySection, /\.some\(/);
	    assert.match(toolFilterStateSection, /const nextToolFilter = normalizeToolFilter\(data\.toolFilter \|\| \[\]\);/);
			    assert.match(toolFilterStateSection, /stringListsEqual\(nextToolFilter, toolFilter\)/);
			    assert.match(toolFilterStateSection, /!data\.toolsCatalog/);
				    assert.match(toolFilterStateSection, /updateNormalizedToolFilterState\(nextToolFilter\);/);
				    assert.match(toolsCatalogStateSection, /const nextToolsCatalog = data\.toolsCatalog && typeof data\.toolsCatalog === 'object' \? data\.toolsCatalog : null;/);
				    assert.match(toolsCatalogStateSection, /!toolsCatalogRequestPending && data\.reveal !== true && !nextToolsCatalog && !currentToolsCatalog/);
				    assert.match(toolsCatalogStateSection, /cancelToolsCatalogSearchRender\(\);[\s\S]*break;/);
				    assert.ok(
				      toolsCatalogStateSection.indexOf('!toolsCatalogRequestPending') < toolsCatalogStateSection.indexOf('updateToolsCatalogState(nextToolsCatalog'),
				      'expected unchanged hidden catalog guard before catalog update'
				    );
			    assert.ok(
			      filterApplySection.indexOf('stringListsEqual(patterns, toolFilter)') < filterApplySection.indexOf('postSettingWithPendingState('),
			      'expected unchanged tool-filter guard before posting'
		    );
			    assert.match(envSection, /function updateNormalizedWorkspaceEnvState\(env\)/);
			    assert.match(envSection, /function updateWorkspaceEnvState\(env\)/);
			    assert.match(envSection, /updateNormalizedWorkspaceEnvState\(normalizeWorkspaceEnv\(env\)\);/);
			    assert.match(envSection, /setValue\(workspaceEnvInput, serializeNormalizedWorkspaceEnv\(workspaceEnv\)\);/);
			    assert.match(envSection, /setTitle\(workspaceEnvLabel, count/);
			    assert.match(envApplySection, /if \(workspaceEnvsEqual\(next, workspaceEnv\)\) \{/);
			    assert.match(envApplySection, /updateNormalizedWorkspaceEnvState\(workspaceEnv\);/);
			    assert.match(workspaceEnvStateSection, /const nextWorkspaceEnv = normalizeWorkspaceEnv\(data\.workspaceEnv \|\| \{\}\);/);
			    assert.match(workspaceEnvStateSection, /if \(!hasPendingSettingState\('workspaceEnvState'\) && workspaceEnvsEqual\(nextWorkspaceEnv, workspaceEnv\)\) break;/);
			    assert.match(workspaceEnvStateSection, /updateNormalizedWorkspaceEnvState\(nextWorkspaceEnv\);/);
		    assert.ok(
		      envApplySection.indexOf('workspaceEnvsEqual(next, workspaceEnv)') < envApplySection.indexOf('postSettingWithPendingState('),
	      'expected unchanged workspace-env guard before posting'
	    );
	    assert.match(summarySection, /setTitle\(safetySettings, 'Advanced safety: '/);
	    assert.doesNotMatch(pluginSection + filterStateSection, /\.join\(', '\)/);
	    assert.doesNotMatch(
	      autoApproveSection + allowExternalSection + blockPushSection + debugSection + pluginSection + filterStateSection + envSection + summarySection,
	      /\.(?:value|checked|title)\s*=/
	    );
  });

  test('settings parsers cap entries with counters instead of repeated key array scans', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const helperSection = (startPattern: string, endPattern: string) => {
      const start = bootstrapSource.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = bootstrapSource.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return bootstrapSource.slice(start, end);
    };

    const sections = [
      helperSection('function normalizeOpenAICompatibleDisplayNames', 'function parseOpenAICompatibleDisplayNames'),
      helperSection('function parseOpenAICompatibleDisplayNames', 'function serializeOpenAICompatibleDisplayNames'),
      helperSection('function normalizeWorkspaceEnv', 'function serializeWorkspaceEnv'),
      helperSection('function parseWorkspaceEnv', 'function updateWorkspaceEnvState'),
      helperSection('function normalizeModelLimits', 'function serializeModelLimits'),
	      helperSection('function parseModelLimits', 'function updateNormalizedModelLimitsState'),
    ];
    const normalizerSections = [
      sections[0],
      sections[2],
      sections[4],
    ];
    const textParserSections = [
      sections[1],
      sections[3],
      sections[5],
    ];
	    const lineScannerSection = helperSection('function forEachTextLine', 'function setTextContent');

    for (const section of sections) {
      assert.match(section, /let count = 0;/);
      assert.doesNotMatch(section, /Object\.keys\((?:normalized|parsed)\)\.length/);
    }
    for (const section of normalizerSections) {
      assert.match(section, /for \(const rawKey in source\)/);
      assert.match(section, /Object\.prototype\.hasOwnProperty\.call\(source, rawKey\)/);
      assert.doesNotMatch(section, /Object\.keys\(source\)\.forEach/);
    }
    for (const section of textParserSections) {
      assert.match(section, /forEachTextLine\(/);
      assert.doesNotMatch(section, /\.split\(\s*\/\\n\/\s*\)/);
	    }
	    assert.match(lineScannerSection, /const text = String\(value === undefined \|\| value === null \? '' : value\);/);
	    assert.match(lineScannerSection, /for \(let i = 0; i <= text\.length; i\+\+\)/);
    assert.match(lineScannerSection, /callback\(text\.slice\(lineStart, i\), lineNumber\)/);
    assert.doesNotMatch(lineScannerSection, /\.split\(/);
    assert.match(sections[5], /parseModelLimitValue\(rest\)/);
    assert.doesNotMatch(sections[5], /\.map\(/);
	    assert.doesNotMatch(sections[5], /\.filter\(Boolean\)/);
	    assert.match(sections[4], /const normalizedEntry = \{ context: Math\.floor\(context\) \};/);
	    assert.match(sections[4], /if \(Number\.isFinite\(output\) && output > 0\) normalizedEntry\.output = Math\.floor\(output\);/);
	    assert.match(sections[4], /normalized\[key\] = normalizedEntry;/);
	    assert.match(sections[5], /const normalizedEntry = \{ context: Math\.floor\(context\) \};/);
	    assert.match(sections[5], /if \(output\) normalizedEntry\.output = Math\.floor\(output\);/);
	    assert.match(sections[5], /normalized\[key\] = normalizedEntry;/);
	    assert.doesNotMatch(sections[4] + sections[5], /\.\.\.\s*\(/);
	    assert.match(sections.join('\n'), /Object\.prototype\.hasOwnProperty\.call/);
	  });

	  test('extension settings normalizers avoid entry arrays while enforcing caps', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
	    const helperSection = (startPattern: string, endPattern: string) => {
	      const start = source.indexOf(startPattern);
	      assert.ok(start >= 0, 'expected ' + startPattern);
	      const end = source.indexOf(endPattern, start + startPattern.length);
	      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
	      return source.slice(start, end);
	    };

	    const keyHelperSection = helperSection('function hasOwnEnumerableKey', 'function normalizeLlmProviderId');
	    const workspaceSection = helperSection('function normalizeWorkspaceEnv', 'function getWorkspaceEnvValidationError');
	    const workspaceValidationSection = helperSection('function getWorkspaceEnvValidationError', 'function getWorkspaceEnv');
	    const displayNameSection = helperSection(
	      'function normalizeOpenAICompatibleModelDisplayNames',
	      'function getOpenAICompatibleModelDisplayNamesValidationError'
	    );
	    const displayNameValidationSection = helperSection(
	      'function getOpenAICompatibleModelDisplayNamesValidationError',
	      'function getOpenAICompatibleSettings'
	    );
	    const modelLimitsSection = helperSection('function normalizeModelLimits', 'function getModelLimitsValidationError');
	    const modelLimitsValidationSection = helperSection('function getModelLimitsValidationError', 'function getModelLimits');
	    const normalizerSections = [workspaceSection, displayNameSection, modelLimitsSection];
	    const validationSections = [workspaceValidationSection, displayNameValidationSection, modelLimitsValidationSection];

	    assert.match(keyHelperSection, /Object\.prototype\.hasOwnProperty\.call\(value, key\)/);
	    assert.match(keyHelperSection, /for \(const key in value\)/);
	    assert.match(keyHelperSection, /countOwnEnumerableKeys\(value: object, limit\?: number\): number/);
	    for (const section of normalizerSections) {
	      assert.match(section, /let count = 0;/);
	      assert.match(section, /for \(const rawKey in source\)/);
	      assert.match(section, /if \(!hasOwnEnumerableKey\(source, rawKey\)\) continue;/);
	      assert.match(section, /if \(!hasOwnEnumerableKey\(normalized, key\)\) count\+\+;/);
	      assert.match(section, /if \(count >= 100\) break;/);
	      assert.doesNotMatch(section, /Object\.entries\(/);
	      assert.doesNotMatch(section, /Object\.keys\(normalized\)\.length/);
	    }
	    for (const section of validationSections) {
	      assert.match(section, /countOwnEnumerableKeys\(source, 101\) > 100/);
	      assert.match(section, /for \(const rawKey in source\)/);
	      assert.match(section, /if \(!hasOwnEnumerableKey\(source, rawKey\)\) continue;/);
	      assert.doesNotMatch(section, /Object\.entries\(/);
	    }
	    assert.match(modelLimitsSection, /const normalizedEntry: ModelLimitEntry = \{ context \};/);
	    assert.match(modelLimitsSection, /if \(output\) normalizedEntry\.output = output;/);
	    assert.match(modelLimitsSection, /normalized\[key\] = normalizedEntry;/);
	    assert.doesNotMatch(modelLimitsSection, /\.\.\.\s*\(/);
	  });

		  test('settings list normalizers scan comma and newline text without split arrays', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const helperSection = (startPattern: string, endPattern: string) => {
      const start = bootstrapSource.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = bootstrapSource.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return bootstrapSource.slice(start, end);
    };

    const normalizerSections = [
      helperSection('function normalizeSkillSearchPaths', 'function updateSkillsSettingsTitle'),
      helperSection('function normalizePluginSpecs', 'function normalizePluginSettings'),
	      helperSection('function normalizeToolFilter', 'function updateNormalizedToolFilterState'),
      helperSection('function normalizeInstructionPatterns', 'function normalizeInstructionFileSettings'),
    ];
    const scannerSection = helperSection('function appendNormalizedStringListItem', 'function countOwnEnumerableKeys');
    const lengthHelperSection = helperSection('function hasListItemLongerThan', 'function stringListsEqual');

    for (const section of normalizerSections) {
      assert.match(section, /return normalizeSeparatedStringList\(raw\);/);
      assert.doesNotMatch(section, /\.split\(/);
      assert.doesNotMatch(section, /new Set\(/);
    }
    assert.match(scannerSection, /function appendNormalizedStringListItem\(value, seen, normalized\)/);
    assert.match(scannerSection, /const seen = new Set\(\);/);
    assert.match(scannerSection, /for \(let i = 0; i < raw\.length; i\+\+\) appendNormalizedStringListItem\(raw\[i\], seen, normalized\);/);
    assert.match(scannerSection, /for \(let i = 0; i <= raw\.length; i\+\+\)/);
    assert.match(scannerSection, /charCode !== 10 && charCode !== 44/);
	    assert.match(scannerSection, /appendNormalizedStringListItem\(raw\.slice\(itemStart, i\), seen, normalized\);/);
	    assert.doesNotMatch(scannerSection, /\.split\(/);
	    assert.doesNotMatch(scannerSection, /const append\s*=/);
	    assert.match(lengthHelperSection, /for \(let i = 0; i < values\.length; i\+\+\)/);
	    assert.match(lengthHelperSection, /values\[i\]\.length > maxLength/);
	    assert.doesNotMatch(lengthHelperSection, /\.some\(/);
	  });

	  test('extension settings list normalizers share scanner without split arrays', () => {
	    const webviewSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const helperSection = (startPattern: string, endPattern: string) => {
      const start = webviewSource.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = webviewSource.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return webviewSource.slice(start, end);
    };

	    const scannerSection = helperSection('function appendNormalizedStringListItem', 'function normalizeSkillSearchPaths');
    const toolFilterSection = helperSection('function normalizeToolFilter', 'function getToolFilter');
	    const normalizerSections = [
	      helperSection('function normalizeSkillSearchPaths', 'function getSkillSearchPaths'),
	      helperSection('function normalizeInstructionPatterns', 'function getInstructionPatterns'),
	      helperSection('function normalizePluginSpecs', 'function normalizePluginWorkspaceDir'),
	    ];

    for (const section of normalizerSections) {
      assert.match(section, /return normalizeSeparatedStringList\(input\);/);
	      assert.doesNotMatch(section, /\.split\(/);
	      assert.doesNotMatch(section, /new Set</);
	    }
    assert.match(toolFilterSection, /return normalizeToolFilterSetting\(input\);/);
    assert.doesNotMatch(toolFilterSection, /\.split\(/);
    assert.doesNotMatch(toolFilterSection, /new Set</);
	    assert.match(scannerSection, /function appendNormalizedStringListItem\(value: unknown, seen: Set<string>, normalized: string\[\], maxItems: number\): boolean/);
	    assert.match(scannerSection, /const seen = new Set<string>\(\);/);
    assert.match(scannerSection, /for \(let i = 0; i < input\.length; i\+\+\)/);
	    assert.match(scannerSection, /appendNormalizedStringListItem\(input\[i\], seen, normalized, maxItems\)/);
    assert.match(scannerSection, /for \(let i = 0; i <= input\.length; i\+\+\)/);
    assert.match(scannerSection, /charCode !== 10 && charCode !== 44/);
	    assert.match(scannerSection, /appendNormalizedStringListItem\(input\.slice\(itemStart, i\), seen, normalized, maxItems\)/);
	    assert.doesNotMatch(scannerSection, /\.split\(/);
	    assert.doesNotMatch(scannerSection, /const append\s*=/);
	    assert.doesNotMatch(scannerSection, /for \(const value of input\)/);
	  });

	  test('plan status classifier scans lines without intermediate arrays', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.runner.input.ts'), 'utf8');
    const helperStart = source.indexOf('function extractPlanStepText');
    assert.ok(helperStart >= 0, 'expected plan step text helper');
    const helperEnd = source.indexOf('export function createChatRunnerInputService', helperStart);
    assert.ok(helperEnd > helperStart, 'expected runner input service after helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const classifyStart = source.indexOf('classifyPlanStatus');
    assert.ok(classifyStart >= 0, 'expected plan status classifier');
    const classifyEnd = source.indexOf("return 'draft';", classifyStart);
    assert.ok(classifyEnd > classifyStart, 'expected draft return from classifier');
    const classifySection = source.slice(classifyStart, classifyEnd);

    assert.match(helperSection, /function extractPlanStepText\(rawLine: string\): string/);
    assert.match(helperSection, /return line\.slice\(2\)\.trim\(\);/);
    assert.match(helperSection, /return line\.slice\(digitIndex \+ 2\)\.trim\(\);/);
    assert.match(classifySection, /let steps = 0;/);
    assert.match(classifySection, /let questionSteps = 0;/);
    assert.match(classifySection, /for \(let i = 0; i <= text\.length; i\+\+\)/);
    assert.match(classifySection, /text\.charCodeAt\(i\) !== 10/);
    assert.match(classifySection, /extractPlanStepText\(text\.slice\(lineStart, i\)\)/);
    assert.match(classifySection, /if \(step\.endsWith\('\?'\)\) questionSteps\+\+;/);
    assert.doesNotMatch(classifySection, /\.split\(/);
    assert.doesNotMatch(classifySection, /\.map\(/);
	    assert.doesNotMatch(classifySection, /\.filter\(/);
	  });

  test('runner user input normalizer builds agent input without spread arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/runCoordinator.ts'), 'utf8');
    const helperStart = source.indexOf('function normalizeUserInput');
    assert.ok(helperStart >= 0, 'expected user input normalizer');
    const helperEnd = source.indexOf('function appendAssumptionsToPlan', helperStart);
    assert.ok(helperEnd > helperStart, 'expected assumptions helper after user input normalizer');
    const helperSection = source.slice(helperStart, helperEnd);

    assert.match(helperSection, /const agentInput: UserHistoryInputPart\[\] = text \? \[\{ type: 'text', text \}\] : \[\];/);
    assert.match(helperSection, /agentInput\.push\(\{\s*type: 'file',/);
    assert.match(helperSection, /const attachmentCount = imageAttachments\.length;/);
    assert.doesNotMatch(helperSection, /const imageParts/);
    assert.doesNotMatch(helperSection, /const textParts/);
    assert.doesNotMatch(helperSection, /\[\.\.\.textParts,\s*\.\.\.imageParts\]/);
  });

  test('pending plan assumptions heading check is line-aware without split arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/runCoordinator.ts'), 'utf8');
    const matchStart = source.indexOf('function lineMatchesAssumptionsHeading');
    assert.ok(matchStart >= 0, 'expected line-aware assumptions heading matcher');
    const appendStart = source.indexOf('function appendAssumptionsToPlan', matchStart);
    assert.ok(appendStart > matchStart, 'expected assumptions appender after heading matcher');
    const helperSection = source.slice(matchStart, appendStart);
    const appendEnd = source.indexOf('export class RunCoordinator', appendStart);
    assert.ok(appendEnd > appendStart, 'expected coordinator class after assumptions appender');
    const appendSection = source.slice(appendStart, appendEnd);

    assert.match(helperSection, /while \(start < end && isHeadingEdgeWhitespace\(text\.charCodeAt\(start\)\)\) start\+\+;/);
    assert.match(helperSection, /while \(end > start && isHeadingEdgeWhitespace\(text\.charCodeAt\(end - 1\)\)\) end--;/);
    assert.match(helperSection, /function hasAssumptionsHeadingLine\(text: string\): boolean/);
    assert.match(helperSection, /for \(let i = 0; i <= text\.length; i\+\+\)/);
    assert.match(helperSection, /text\.charCodeAt\(i\) !== 10/);
    assert.match(appendSection, /hasAssumptionsHeadingLine\(text\)/);
    assert.doesNotMatch(appendSection, /\.includes\(ASSUMPTIONS_HEADING\)/);
    assert.doesNotMatch(helperSection + appendSection, /\.split\(/);
  });

  test('goal objective length validation counts code points without spread arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/goals.ts'), 'utf8');
    const helperStart = source.indexOf('function countGoalObjectiveChars');
    assert.ok(helperStart >= 0, 'expected goal objective character counter');
    const parseStart = source.indexOf('export function parseGoalSlashCommand', helperStart);
    assert.ok(parseStart > helperStart, 'expected goal parser after character counter');
    const helperSection = source.slice(helperStart, parseStart);
    const parseEnd = source.indexOf('export function formatGoalSummary', parseStart);
    assert.ok(parseEnd > parseStart, 'expected summary formatter after goal parser');
    const parseSection = source.slice(parseStart, parseEnd);

    assert.match(helperSection, /for \(const _ch of value\) count\+\+;/);
    assert.match(parseSection, /const objectiveLength = countGoalObjectiveChars\(objective\);/);
    assert.match(parseSection, /if \(objectiveLength > MAX_GOAL_OBJECTIVE_CHARS\)/);
    assert.match(parseSection, /Goal objective is too long: \$\{objectiveLength\} characters/);
    assert.doesNotMatch(parseSection, /\[\.\.\.objective\]/);

    const toolSource = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/goal.ts'), 'utf8');
    const toolHelperStart = toolSource.indexOf('function goalObjectiveExceedsCodePointLimit');
    assert.ok(toolHelperStart >= 0, 'expected tool goal objective limit helper');
    const toolCreateStart = toolSource.indexOf('export async function createGoalHandler', toolHelperStart);
    assert.ok(toolCreateStart > toolHelperStart, 'expected create handler after tool helper');
    const toolHelperSection = toolSource.slice(toolHelperStart, toolCreateStart);
    const toolCreateEnd = toolSource.indexOf('export async function updateGoalHandler', toolCreateStart);
    assert.ok(toolCreateEnd > toolCreateStart, 'expected update handler after create handler');
    const toolCreateSection = toolSource.slice(toolCreateStart, toolCreateEnd);

    assert.match(toolHelperSection, /for \(const _ch of value\)/);
    assert.match(toolHelperSection, /if \(count > limit\) return true;/);
    assert.match(toolCreateSection, /goalObjectiveExceedsCodePointLimit\(objective, MAX_GOAL_OBJECTIVE_CHARS\)/);
    assert.doesNotMatch(toolCreateSection, /\[\.\.\.objective\]/);

    const agentSource = fs.readFileSync(path.resolve(__dirname, '../../../src/core/agent/index.ts'), 'utf8');
    const agentHelperStart = agentSource.indexOf('function goalObjectiveExceedsCodePointLimit');
    assert.ok(agentHelperStart >= 0, 'expected agent goal objective limit helper');
    const agentStateStart = agentSource.indexOf('export type AgentSessionState', agentHelperStart);
    assert.ok(agentStateStart > agentHelperStart, 'expected agent state type after helper');
    const agentHelperSection = agentSource.slice(agentHelperStart, agentStateStart);
    const setObjectiveStart = agentSource.indexOf('setThreadGoalObjective(params:', agentStateStart);
    assert.ok(setObjectiveStart > agentStateStart, 'expected setThreadGoalObjective method');
    const setObjectiveEnd = agentSource.indexOf('updateThreadGoalStatus(status:', setObjectiveStart);
    assert.ok(setObjectiveEnd > setObjectiveStart, 'expected goal status updater after objective setter');
    const setObjectiveSection = agentSource.slice(setObjectiveStart, setObjectiveEnd);

    assert.match(agentHelperSection, /for \(const _ch of value\)/);
    assert.match(agentHelperSection, /if \(count > limit\) return true;/);
    assert.match(setObjectiveSection, /goalObjectiveExceedsCodePointLimit\(objective, MAX_THREAD_GOAL_OBJECTIVE_CHARS\)/);
    assert.doesNotMatch(setObjectiveSection, /\[\.\.\.objective\]/);
  });

		  test('settings serializers avoid map arrays after sorting keys', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const helperSection = (startPattern: string, endPattern: string) => {
      const start = bootstrapSource.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = bootstrapSource.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return bootstrapSource.slice(start, end);
    };

    const displayNamesSection = helperSection('function serializeNormalizedOpenAICompatibleDisplayNames', 'function normalizeOpenAICompatibleSettings');
	    const workspaceEnvSection = helperSection('function serializeNormalizedWorkspaceEnv', 'function parseWorkspaceEnv');
	    const modelLimitsSection = helperSection('function serializeNormalizedModelLimits', 'function parseModelLimits');
    const serializerHelperSection = helperSection('function serializeSortedOwnEnumerableEntries', 'function setTextContent');

    assert.match(serializerHelperSection, /let keys = null;/);
    assert.match(serializerHelperSection, /keys\.sort\(compareLocaleAscending\);/);
    assert.match(bootstrapSource, /function\s+compareLocaleAscending\(left, right\)/);
    assert.match(serializerHelperSection, /for \(let i = 0; i < keys\.length; i\+\+\)/);
    assert.match(serializerHelperSection, /text \+= formatEntry\(key, value\[key\]\);/);
    assert.doesNotMatch(serializerHelperSection, /\.map\(/);
    assert.doesNotMatch(serializerHelperSection, /\.sort\(\(a, b\) => a\.localeCompare\(b\)\)/);
    assert.match(displayNamesSection, /function serializeNormalizedOpenAICompatibleDisplayNames\(names\)/);
    assert.match(displayNamesSection, /return serializeSortedOwnEnumerableEntries\(names, \(key, value\) => key \+ ' = ' \+ value\);/);
    assert.match(displayNamesSection, /function serializeOpenAICompatibleDisplayNames\(names\)/);
    assert.match(displayNamesSection, /return serializeNormalizedOpenAICompatibleDisplayNames\(normalizeOpenAICompatibleDisplayNames\(names\)\);/);
	    assert.match(workspaceEnvSection, /function serializeNormalizedWorkspaceEnv\(env\)/);
	    assert.match(workspaceEnvSection, /return serializeSortedOwnEnumerableEntries\(env, \(key, value\) => key \+ '=' \+ value\);/);
	    assert.match(workspaceEnvSection, /function serializeWorkspaceEnv\(env\)/);
	    assert.match(workspaceEnvSection, /return serializeNormalizedWorkspaceEnv\(normalizeWorkspaceEnv\(env\)\);/);
	    assert.match(modelLimitsSection, /function serializeNormalizedModelLimits\(limits\)/);
	    assert.match(modelLimitsSection, /return serializeSortedOwnEnumerableEntries\(limits, \(key, entry\) => \{/);
	    assert.match(modelLimitsSection, /function serializeModelLimits\(limits\)/);
	    assert.match(modelLimitsSection, /return serializeNormalizedModelLimits\(normalizeModelLimits\(limits\)\);/);
    assert.doesNotMatch(displayNamesSection + workspaceEnvSection + modelLimitsSection, /Object\.keys\(normalized\)[\s\S]*?\.map\(/);
  });

  test('settings summaries count object entries without key array allocations', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const helperStart = bootstrapSource.indexOf('function countOwnEnumerableKeys');
    assert.ok(helperStart >= 0, 'expected shared own-key count helper');
    const helperEnd = bootstrapSource.indexOf('function setTextContent', helperStart);
    assert.ok(helperEnd > helperStart, 'expected stream text helpers after own-key counter');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
    const providerStart = bootstrapSource.indexOf('function updateProviderSettingsSummary');
    assert.ok(providerStart >= 0, 'expected provider settings summary helper');
    const providerEnd = bootstrapSource.indexOf('function updateNormalizedCodexSubscriptionSettingsState', providerStart);
    assert.ok(providerEnd > providerStart, 'expected codex settings helper after provider summary');
    const providerSection = bootstrapSource.slice(providerStart, providerEnd);
    const openAIStart = bootstrapSource.indexOf('function updateNormalizedOpenAICompatibleSettingsState', providerEnd);
    assert.ok(openAIStart > providerEnd, 'expected OpenAI settings helper');
    const openAIEnd = bootstrapSource.indexOf('function closeProviderSettingsPopover', openAIStart);
    assert.ok(openAIEnd > openAIStart, 'expected provider popover helper after OpenAI settings');
    const openAISection = bootstrapSource.slice(openAIStart, openAIEnd);
    const workspaceStart = bootstrapSource.indexOf('function updateNormalizedWorkspaceEnvState');
    assert.ok(workspaceStart >= 0, 'expected normalized workspace env state helper');
    const workspaceEnd = bootstrapSource.indexOf('function applyWorkspaceEnv', workspaceStart);
    assert.ok(workspaceEnd > workspaceStart, 'expected workspace env apply helper');
    const workspaceSection = bootstrapSource.slice(workspaceStart, workspaceEnd);
    const safetyStart = bootstrapSource.indexOf('function updateSafetySettingsTitle');
    assert.ok(safetyStart >= 0, 'expected safety settings summary helper');
    const safetyEnd = bootstrapSource.indexOf('function normalizeInstructionPatterns', safetyStart);
    assert.ok(safetyEnd > safetyStart, 'expected instruction normalizer after safety summary');
    const safetySection = bootstrapSource.slice(safetyStart, safetyEnd);
    const modelLimitsStart = bootstrapSource.indexOf('function updateNormalizedModelLimitsState');
    assert.ok(modelLimitsStart >= 0, 'expected normalized model limits state helper');
    const modelLimitsEnd = bootstrapSource.indexOf('function applyModelLimits', modelLimitsStart);
    assert.ok(modelLimitsEnd > modelLimitsStart, 'expected model limits apply helper');
    const modelLimitsSection = bootstrapSource.slice(modelLimitsStart, modelLimitsEnd);
    const combinedSections = providerSection + openAISection + workspaceSection + safetySection + modelLimitsSection;

    assert.match(helperSection, /for \(const key in value\)/);
    assert.match(helperSection, /Object\.prototype\.hasOwnProperty\.call\(value, key\)/);
    assert.match(providerSection, /const modelCount = countOwnEnumerableKeys\(openAICompatibleSettings\.modelDisplayNames\);/);
    assert.match(openAISection, /const modelCount = countOwnEnumerableKeys\(openAICompatibleSettings\.modelDisplayNames\);/);
    assert.match(workspaceSection, /const count = countOwnEnumerableKeys\(workspaceEnv\);/);
    assert.match(safetySection, /const envCount = countOwnEnumerableKeys\(workspaceEnv\);/);
    assert.match(safetySection, /if \(debugSettings\.effectiveLlm\) debugCount\+\+;/);
    assert.match(modelLimitsSection, /const count = countOwnEnumerableKeys\(modelLimits\);/);
    assert.doesNotMatch(combinedSections, /Object\.keys\([^)]*\)\.length/);
    assert.doesNotMatch(safetySection, /\.filter\(Boolean\)\.length/);
  });

  test('tool runtime limits state updates avoid duplicate value and title writes', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const updateStart = bootstrapSource.indexOf('function updateNormalizedToolRuntimeLimitsState');
    assert.ok(updateStart >= 0, 'expected normalized tool runtime limits state helper');
    const updateEnd = bootstrapSource.indexOf('function applyToolRuntimeLimits', updateStart);
    assert.ok(updateEnd > updateStart, 'expected tool runtime limits apply helper after state helper');
    const updateSection = bootstrapSource.slice(updateStart, updateEnd);

    assert.match(updateSection, /function updateNormalizedToolRuntimeLimitsState\(limits\)/);
    assert.match(updateSection, /function updateToolRuntimeLimitsState\(limits\)/);
    assert.match(updateSection, /updateNormalizedToolRuntimeLimitsState\(normalizeToolRuntimeLimits\(limits\)\);/);
    assert.match(updateSection, /setValue\(toolTimeoutMsInput, toolRuntimeLimits\.toolTimeoutMs\);/);
    assert.match(updateSection, /setValue\(readMaxLinesInput, toolRuntimeLimits\.readMaxLines\);/);
    assert.match(updateSection, /setValue\(bashBackgroundTtlMsInput, toolRuntimeLimits\.bashBackgroundTtlMs\);/);
    assert.match(updateSection, /setValue\(bashBackgroundCaptureMsInput, toolRuntimeLimits\.bashBackgroundCaptureMs\);/);
    assert.match(updateSection, /setValue\(bashBackgroundCaptureLinesInput, toolRuntimeLimits\.bashBackgroundCaptureLines\);/);
    assert.match(updateSection, /setValue\(workspaceShellTimeoutMsInput, toolRuntimeLimits\.workspaceShellTimeoutMs\);/);
    assert.match(updateSection, /setValue\(httpTimeoutMsInput, toolRuntimeLimits\.httpTimeoutMs\);/);
    assert.match(updateSection, /setTitle\(toolTimeoutMsLabel, 'Global tool timeout is '/);
    assert.match(updateSection, /setTitle\(readMaxLinesLabel, 'Read tools can return up to '/);
    assert.match(updateSection, /setTitle\(bashBackgroundTtlMsLabel, 'Background bash commands auto-stop after '/);
    assert.match(updateSection, /setTitle\(bashBackgroundCaptureMsLabel, 'Background bash startup capture waits up to '/);
    assert.match(updateSection, /setTitle\(bashBackgroundCaptureLinesLabel, 'Background bash startup capture includes up to '/);
    assert.match(updateSection, /setTitle\(workspaceShellTimeoutMsLabel, 'Workspace shell tools time out after '/);
    assert.match(updateSection, /setTitle\(httpTimeoutMsLabel, 'Workspace HTTP tools time out after '/);
    assert.doesNotMatch(updateSection, /\.(?:value|title)\s*=/);
  });

  test('settings apply handlers skip unchanged normalized posts', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = bootstrapSource.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = bootstrapSource.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return bootstrapSource.slice(start, end);
    };
    const expectGuardBeforePost = (source: string, guardText: string, label: string) => {
      assert.ok(source.indexOf(guardText) >= 0, `expected unchanged guard for ${label}`);
      assert.ok(source.indexOf(guardText) < source.indexOf('postSettingWithPendingState'), `expected ${label} guard before post`);
    };

    const sessionApply = section('function applySessionRetentionLimits', 'function getSessionClearConfirmTrigger');
    const toolApply = section('function applyToolRuntimeLimits', 'function closeSafetySettingsPopover');
    const memoryBudgetApply = section('function applyMemoryAutoRecallBudget', 'function updateMemoryAutoRecallFiltersState');
    const memoryFiltersApply = section('function applyMemoryAutoRecallFilters', 'function clampMemoryLimit');
    const memoryAdvancedApply = section('function applyMemoryAdvancedLimits', 'function updateExplorePrepassState');
    const modelLimitsApply = section('function applyModelLimits', 'function updateCompactionPruneState');

	    assert.match(sessionApply, /const limits = \{ maxSessions: Math\.floor\(maxSessions\), maxSessionBytes: Math\.floor\(maxSessionBytes\) \};/);
	    assert.match(sessionApply, /updateNormalizedSessionRetentionState\(currentLimits\);/);
	    assert.doesNotMatch(sessionApply, /updateSessionRetentionState\(currentLimits\.maxSessions, currentLimits\.maxSessionBytes\)/);
	    expectGuardBeforePost(sessionApply, 'sessionRetentionLimitsEqual(limits, currentLimits)', 'session retention');

    assert.match(toolApply, /const normalized = normalizeToolRuntimeLimits\(limits\);/);
    expectGuardBeforePost(toolApply, 'toolRuntimeLimitsEqual(normalized, toolRuntimeLimits)', 'tool runtime limits');

	    assert.match(memoryBudgetApply, /const budget = \{ maxResults: Math\.floor\(maxResults\), maxTokens: Math\.floor\(maxTokens\) \};/);
	    assert.match(memoryBudgetApply, /updateNormalizedMemoryAutoRecallBudgetState\(currentBudget\);/);
	    assert.doesNotMatch(memoryBudgetApply, /updateMemoryAutoRecallBudgetState\(currentBudget\.maxResults, currentBudget\.maxTokens\)/);
	    expectGuardBeforePost(memoryBudgetApply, 'memoryAutoRecallBudgetEqual(budget, currentBudget)', 'memory recall budget');

	    assert.match(memoryFiltersApply, /maxAgeDays: Math\.min\(3650, Math\.floor\(maxAgeDays\)\)/);
	    assert.match(memoryFiltersApply, /updateNormalizedMemoryAutoRecallFiltersState\(currentFilters\);/);
	    assert.doesNotMatch(memoryFiltersApply, /updateMemoryAutoRecallFiltersState\(currentFilters\.minScore, currentFilters\.minScoreGap, currentFilters\.maxAgeDays\)/);
	    expectGuardBeforePost(memoryFiltersApply, 'memoryAutoRecallFiltersEqual(filters, currentFilters)', 'memory recall filters');

    assert.match(memoryAdvancedApply, /const normalized = normalizeMemoryAdvancedLimits\(limits\);/);
    expectGuardBeforePost(memoryAdvancedApply, 'memoryAdvancedLimitsEqual(normalized, currentLimits)', 'memory advanced limits');

    assert.match(modelLimitsApply, /if \(modelLimitsEqual\(parsed, modelLimits\)\) \{/);
    expectGuardBeforePost(modelLimitsApply, 'modelLimitsEqual(parsed, modelLimits)', 'model limits');
  });

				  test('safety debug and plugin control state updates avoid duplicate property writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const safetyStart = bootstrapSource.indexOf('const safetyControlsDisabled');
    assert.ok(safetyStart >= 0, 'expected safety settings section');
    const safetyEnd = bootstrapSource.indexOf('const toolLimitsDisabled', safetyStart);
    assert.ok(safetyEnd > safetyStart, 'expected tool limits section after safety/debug/plugin controls');
    const safetySection = bootstrapSource.slice(safetyStart, safetyEnd);
    const logsActionStart = mainSource.indexOf("case 'logsActionState':");
    assert.ok(logsActionStart >= 0, 'expected logs action state branch');
    const logsActionEnd = mainSource.indexOf("case 'providerState':", logsActionStart);
    assert.ok(logsActionEnd > logsActionStart, 'expected provider state branch after logs action state');
    const logsActionSection = mainSource.slice(logsActionStart, logsActionEnd);

    assert.match(safetySection, /setDisabled\(safetySelect, safetyControlsDisabled\);/);
    assert.match(safetySection, /setDisabled\(safetySettings, safetyControlsDisabled\);/);
    assert.match(safetySection, /setDisabled\(allowExternalPathsToggle, safetyControlsDisabled\);/);
    assert.match(safetySection, /setDisabledClass\(allowExternalPathsLabel, safetyControlsDisabled\);/);
    assert.match(safetySection, /setDisabled\(debugDetailsToggle, debugDisabled\);/);
    assert.match(safetySection, /setDisabledClass\(debugDetailsLabel, debugDisabled\);/);
    assert.match(safetySection, /setDisabled\(debugLlmToggle, debugStreamDisabled\);/);
	    assert.match(safetySection, /setDisabled\(showLogsBtn, !connected \|\| showLogsPending\);/);
	    assert.match(safetySection, /const showLogsText = showLogsPending \? 'Opening logs…' : 'Show logs';/);
	    assert.match(safetySection, /setTextContent\(showLogsBtn, showLogsText\);/);
	    assert.match(safetySection, /setAttributeValue\(showLogsBtn, 'aria-label', showLogsText \+ ', open the LingYun output channel'\);/);
    assert.match(safetySection, /setDisabled\(listToolsBtn, !connected \|\| isProcessing \|\| toolsCatalogRequestPending\);/);
    assert.match(safetySection, /setDisabled\(pluginsAutoDiscoverToggle, pluginSettingsDisabled\);/);
    assert.match(safetySection, /setDisabledClass\(pluginsAutoDiscoverLabel, pluginSettingsDisabled\);/);
    assert.match(safetySection, /setDisabled\(pluginSettingsApply, pluginSettingsDisabled\);/);
    assert.doesNotMatch(safetySection, /\.(?:disabled)\s*=/);
    assert.doesNotMatch(safetySection, /classList\.toggle\('disabled'/);
	    assert.doesNotMatch(safetySection, /showLogsBtn\.textContent\s*=/);
    assert.match(logsActionSection, /if \(!data\.pending && !showLogsPending\) break;/);
    assert.match(logsActionSection, /clearPendingActionTimer\('showLogs'\);/);
    assert.match(logsActionSection, /showLogsPending = false;/);
    assert.match(logsActionSection, /syncInputState\(\);/);
	  });

	  test('tool limit control state updates avoid duplicate property writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const toolLimitsStart = bootstrapSource.indexOf('const toolLimitsDisabled');
	    assert.ok(toolLimitsStart >= 0, 'expected tool limits section');
	    const toolLimitsEnd = bootstrapSource.indexOf('if (!connected || isProcessing) closeSafetySettingsPopover();', toolLimitsStart);
	    assert.ok(toolLimitsEnd > toolLimitsStart, 'expected safety popover close after tool limit controls');
	    const toolLimitsSection = bootstrapSource.slice(toolLimitsStart, toolLimitsEnd);

	    assert.match(toolLimitsSection, /setDisabled\(toolFilterInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(toolFilterLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(toolFilterApply, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(workspaceEnvInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(workspaceEnvLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(workspaceEnvApply, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(toolTimeoutMsInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(toolTimeoutMsLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(readMaxLinesInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(readMaxLinesLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(bashBackgroundTtlMsInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(bashBackgroundTtlMsLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(bashBackgroundCaptureMsInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(bashBackgroundCaptureMsLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(bashBackgroundCaptureLinesInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(bashBackgroundCaptureLinesLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(workspaceShellTimeoutMsInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(workspaceShellTimeoutMsLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(httpTimeoutMsInput, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabledClass\(httpTimeoutMsLabel, toolLimitsDisabled\);/);
	    assert.match(toolLimitsSection, /setDisabled\(toolLimitsApply, toolLimitsDisabled\);/);
	    assert.doesNotMatch(toolLimitsSection, /\.(?:disabled)\s*=/);
	    assert.doesNotMatch(toolLimitsSection, /classList\.toggle\('disabled'/);
	  });

	  test('thinking and memory control state updates avoid duplicate property writes', () => {
			    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const memoryListsStart = bootstrapSource.indexOf('const memoryAdvancedLimitInputs = [');
		    assert.ok(memoryListsStart >= 0, 'expected shared memory limit input list');
		    const memoryListsEnd = bootstrapSource.indexOf('const explorePrepassLabel', memoryListsStart);
		    assert.ok(memoryListsEnd > memoryListsStart, 'expected explore controls after shared memory limit lists');
		    const memoryListsSection = bootstrapSource.slice(memoryListsStart, memoryListsEnd);
		    assert.match(memoryListsSection, /const memoryAdvancedLimitLabels = \[/);
		    assert.doesNotMatch(memoryListsSection, /forEach/);
		    const unavailableStart = bootstrapSource.indexOf('function setUnavailableControlState');
		    assert.ok(unavailableStart >= 0, 'expected shared unavailable control helper');
		    assert.ok(bootstrapSource.indexOf('const STREAM_TEXT_CACHE_KEY') < unavailableStart, 'stream text cache key must be initialized before startup text setters run');
		    const fatalStart = bootstrapSource.indexOf('function showFatalError', unavailableStart);
		    assert.ok(fatalStart > unavailableStart, 'expected fatal-error fallback after unavailable helper');
		    const unavailableSection = bootstrapSource.slice(unavailableStart, fatalStart);
		    const fatalEnd = bootstrapSource.indexOf("window.addEventListener('error'", fatalStart);
		    assert.ok(fatalEnd > fatalStart, 'expected fatal-error listener registration after helper');
		    const fatalSection = bootstrapSource.slice(fatalStart, fatalEnd);
		    const startupDisabledEnd = bootstrapSource.indexOf('const toolIcons', fatalEnd);
		    assert.ok(startupDisabledEnd > fatalEnd, 'expected tool icon map after startup disabled-state call');
		    const startupDisabledSection = bootstrapSource.slice(fatalEnd, startupDisabledEnd);
		    assert.match(unavailableSection, /function setUnavailableControlState\(label, state\)/);
		    assert.match(unavailableSection, /const isStartup = state === 'startup';/);
		    assert.match(unavailableSection, /const isFatal = state === 'fatal';/);
		    assert.match(unavailableSection, /setTextContent\(modelPickerLabel, label\);/);
		    assert.match(unavailableSection, /setTextContent\(modelPicker, label\);/);
			    assert.strictEqual((unavailableSection.match(/for \(let memoryLimitInputIndex = 0; memoryLimitInputIndex < memoryAdvancedLimitInputs\.length; memoryLimitInputIndex\+\+\)/g) || []).length, 1);
			    assert.match(unavailableSection, /const memoryLimitInput = memoryAdvancedLimitInputs\[memoryLimitInputIndex\];/);
			    assert.strictEqual((unavailableSection.match(/for \(let memoryLimitLabelIndex = 0; memoryLimitLabelIndex < memoryAdvancedLimitLabels\.length; memoryLimitLabelIndex\+\+\)/g) || []).length, 1);
			    assert.match(unavailableSection, /const memoryLimitLabel = memoryAdvancedLimitLabels\[memoryLimitLabelIndex\];/);
			    assert.match(unavailableSection, /if \(isFatal\) \{/);
			    assert.match(unavailableSection, /setDisabled\(modelRefreshList, true\);/);
			    assert.match(unavailableSection, /if \(isStartup\) setGenerationInputsDisabled\(true\);/);
			    assert.doesNotMatch(unavailableSection, /setHidden\(providerAuthGroup/);
			    assert.match(bootstrapSource, /let fatalErrorBanner = null;/);
			    assert.match(fatalSection, /setUnavailableControlState\('Webview error', 'fatal'\);/);
				    assert.match(fatalSection, /if \(!fatalErrorBanner\) \{/);
				    assert.match(fatalSection, /fatalErrorBanner = document\.createElement\('div'\);/);
				    assert.match(fatalSection, /setAttributeValue\(fatalErrorBanner, 'role', 'alert'\);/);
				    assert.match(fatalSection, /setAttributeValue\(fatalErrorBanner, 'aria-atomic', 'true'\);/);
				    assert.match(fatalSection, /document\.body\.insertBefore\(fatalErrorBanner, document\.body\.firstChild\);/);
			    assert.match(fatalSection, /setTextContent\(fatalErrorBanner, bannerText\);/);
			    assert.doesNotMatch(fatalSection, /const banner = document\.createElement\('div'\);/);
			    assert.match(startupDisabledSection, /setUnavailableControlState\('Connecting…', 'startup'\);/);
			    assert.doesNotMatch(unavailableSection + fatalSection + startupDisabledSection, /\]\.forEach/);
		    assert.doesNotMatch(unavailableSection, /\.(?:disabled)\s*=/);
		    assert.doesNotMatch(unavailableSection, /classList\.add\('disabled'\)/);

		    const memoryStart = bootstrapSource.indexOf('const thinkingDisabled');
	    assert.ok(memoryStart >= 0, 'expected thinking/memory settings section');
	    const memoryEnd = bootstrapSource.indexOf('const explorePrepassDisabled', memoryStart);
	    assert.ok(memoryEnd > memoryStart, 'expected explore settings section after thinking/memory controls');
	    const memorySection = bootstrapSource.slice(memoryStart, memoryEnd);

	    assert.match(memorySection, /setDisabled\(thinkingToggle, thinkingDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(thinkingLabel, thinkingDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoriesFeatureToggle, memoriesFeatureDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(memoriesFeatureLabel, memoriesFeatureDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryAutoRecallToggle, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(memoryAutoRecallLabel, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryAutoRecallMaxResultsInput, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(memoryAutoRecallMaxResultsLabel, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryAutoRecallMaxTokensInput, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(memoryAutoRecallMaxTokensLabel, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryAutoRecallMinScoreInput, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(memoryAutoRecallMinScoreLabel, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryAutoRecallMinScoreGapInput, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(memoryAutoRecallMinScoreGapLabel, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryAutoRecallMaxAgeDaysInput, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabledClass\(memoryAutoRecallMaxAgeDaysLabel, memoryControlsDisabled\);/);
		    assert.match(memorySection, /for \(let memoryLimitInputIndex = 0; memoryLimitInputIndex < memoryAdvancedLimitInputs\.length; memoryLimitInputIndex\+\+\) \{/);
		    assert.match(memorySection, /const memoryLimitInput = memoryAdvancedLimitInputs\[memoryLimitInputIndex\];/);
	    assert.match(memorySection, /setDisabled\(memoryLimitInput, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryAdvancedLimitsApply, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryUpdateNowBtn, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryDropBtn, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryDropCancelBtn, memoryControlsDisabled\);/);
	    assert.match(memorySection, /setDisabled\(memoryDropConfirmRunBtn, memoryControlsDisabled\);/);
		    assert.match(memorySection, /for \(let memoryLimitLabelIndex = 0; memoryLimitLabelIndex < memoryAdvancedLimitLabels\.length; memoryLimitLabelIndex\+\+\) \{/);
		    assert.match(memorySection, /const memoryLimitLabel = memoryAdvancedLimitLabels\[memoryLimitLabelIndex\];/);
	    assert.match(memorySection, /setDisabledClass\(memoryLimitLabel, memoryControlsDisabled\);/);
		    assert.doesNotMatch(memorySection, /\.(?:disabled)\s*=/);
			    assert.doesNotMatch(memorySection, /classList\.toggle\('disabled'/);
				    assert.doesNotMatch(memorySection, /\]\.forEach/);
				    assert.doesNotMatch(unavailableSection + memorySection, /for \(const memoryLimit(?:Input|Label) of memoryAdvancedLimit(?:Inputs|Labels)\)/);
				  });

				  test('memory settings state updates avoid duplicate checked value and title writes', () => {
				    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
				    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
				    const stateStart = bootstrapSource.indexOf('function updateShowThinkingState');
				    assert.ok(stateStart >= 0, 'expected thinking settings helper');
				    const stateEnd = bootstrapSource.indexOf('function applyMemoryAdvancedLimits', stateStart);
				    assert.ok(stateEnd > stateStart, 'expected memory advanced limits apply helper after memory state helpers');
			    const stateSection = bootstrapSource.slice(stateStart, stateEnd);
			    const listenerStart = bootstrapSource.indexOf('if (thinkingToggle)', stateEnd);
			    assert.ok(listenerStart > stateEnd, 'expected thinking/memory listeners after memory state helpers');
				    const listenerEnd = bootstrapSource.indexOf('if (memoryAutoRecallMaxResultsInput)', listenerStart);
				    assert.ok(listenerEnd > listenerStart, 'expected memory auto-recall budget listener after toggle listeners');
				    const listenerSection = bootstrapSource.slice(listenerStart, listenerEnd);
				    const showThinkingStateStart = mainSource.indexOf("case 'showThinkingState':");
				    assert.ok(showThinkingStateStart >= 0, 'expected show-thinking state branch');
				    const memoriesFeatureStateStart = mainSource.indexOf("case 'memoriesFeatureState':", showThinkingStateStart);
				    assert.ok(memoriesFeatureStateStart > showThinkingStateStart, 'expected memories-feature state branch after show-thinking state');
				    const showThinkingStateSection = mainSource.slice(showThinkingStateStart, memoriesFeatureStateStart);
				    const memoryAutoRecallStateStart = mainSource.indexOf("case 'memoryAutoRecallState':", memoriesFeatureStateStart);
				    assert.ok(memoryAutoRecallStateStart > memoriesFeatureStateStart, 'expected memory auto-recall state branch after memories-feature state');
				    const memoriesFeatureStateSection = mainSource.slice(memoriesFeatureStateStart, memoryAutoRecallStateStart);
					    const memoryAutoRecallBudgetStateStart = mainSource.indexOf("case 'memoryAutoRecallBudgetState':", memoryAutoRecallStateStart);
					    assert.ok(memoryAutoRecallBudgetStateStart > memoryAutoRecallStateStart, 'expected memory budget state branch after auto-recall state');
					    const memoryAutoRecallStateSection = mainSource.slice(memoryAutoRecallStateStart, memoryAutoRecallBudgetStateStart);
					    const memoryAutoRecallFiltersStateStart = mainSource.indexOf("case 'memoryAutoRecallFiltersState':", memoryAutoRecallBudgetStateStart);
					    assert.ok(memoryAutoRecallFiltersStateStart > memoryAutoRecallBudgetStateStart, 'expected memory filters state branch after memory budget state');
					    const memoryAutoRecallBudgetStateSection = mainSource.slice(memoryAutoRecallBudgetStateStart, memoryAutoRecallFiltersStateStart);
						    const memoryAdvancedLimitsStateStart = mainSource.indexOf("case 'memoryAdvancedLimitsState':", memoryAutoRecallFiltersStateStart);
						    assert.ok(memoryAdvancedLimitsStateStart > memoryAutoRecallFiltersStateStart, 'expected memory advanced limits branch after memory filters state');
						    const memoryAutoRecallFiltersStateSection = mainSource.slice(memoryAutoRecallFiltersStateStart, memoryAdvancedLimitsStateStart);
						    const memoryActionStatusStateStart = mainSource.indexOf("case 'memoryActionStatusState':", memoryAdvancedLimitsStateStart);
						    assert.ok(memoryActionStatusStateStart > memoryAdvancedLimitsStateStart, 'expected memory action status branch after memory advanced limits state');
						    const memoryAdvancedLimitsStateSection = mainSource.slice(memoryAdvancedLimitsStateStart, memoryActionStatusStateStart);

			    assert.match(stateSection, /setChecked\(thinkingToggle, showThinkingEnabled\);/);
			    assert.match(stateSection, /setTitle\(thinkingLabel,/);
			    assert.match(stateSection, /setChecked\(memoriesFeatureToggle, memoriesFeatureEnabled\);/);
			    assert.match(stateSection, /setTitle\(memoriesFeatureLabel,/);
			    assert.match(stateSection, /setChecked\(memoryAutoRecallToggle, memoryAutoRecallEnabled\);/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallLabel,/);
			    assert.match(stateSection, /function normalizeMemoryAutoRecallBudget\(maxResults, maxTokens\)/);
			    assert.match(stateSection, /function updateNormalizedMemoryAutoRecallBudgetState\(budget\)/);
			    assert.match(stateSection, /function updateMemoryAutoRecallBudgetState\(maxResults, maxTokens\)/);
			    assert.match(stateSection, /updateNormalizedMemoryAutoRecallBudgetState\(normalizeMemoryAutoRecallBudget\(maxResults, maxTokens\)\);/);
			    assert.match(stateSection, /setValue\(memoryAutoRecallMaxResultsInput, memoryAutoRecallMaxResults\);/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMaxResultsInput,/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMaxResultsLabel,/);
			    assert.match(stateSection, /setValue\(memoryAutoRecallMaxTokensInput, memoryAutoRecallMaxTokens\);/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMaxTokensInput,/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMaxTokensLabel,/);
			    assert.match(stateSection, /function normalizeMemoryAutoRecallFilters\(minScore, minScoreGap, maxAgeDays\)/);
			    assert.match(stateSection, /function updateNormalizedMemoryAutoRecallFiltersState\(filters\)/);
			    assert.match(stateSection, /function updateMemoryAutoRecallFiltersState\(minScore, minScoreGap, maxAgeDays\)/);
			    assert.match(stateSection, /updateNormalizedMemoryAutoRecallFiltersState\(normalizeMemoryAutoRecallFilters\(minScore, minScoreGap, maxAgeDays\)\);/);
			    assert.match(stateSection, /setValue\(memoryAutoRecallMinScoreInput, memoryAutoRecallMinScore\);/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMinScoreInput,/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMinScoreLabel,/);
			    assert.match(stateSection, /setValue\(memoryAutoRecallMinScoreGapInput, memoryAutoRecallMinScoreGap\);/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMinScoreGapInput,/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMinScoreGapLabel,/);
			    assert.match(stateSection, /setValue\(memoryAutoRecallMaxAgeDaysInput, memoryAutoRecallMaxAgeDays\);/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMaxAgeDaysInput,/);
			    assert.match(stateSection, /setTitle\(memoryAutoRecallMaxAgeDaysLabel,/);
			    assert.match(stateSection, /setValue\(memoryMaxRawMemoriesForGlobalInput, memoryAdvancedLimits\.maxRawMemoriesForGlobal\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRawMemoriesForGlobalInput, maxRawMemoriesForGlobalTitle\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRawMemoriesForGlobalLabel, memoryMaxRawMemoriesForGlobalInput \? maxRawMemoriesForGlobalTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memoryMaxRolloutAgeDaysInput, memoryAdvancedLimits\.maxRolloutAgeDays\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRolloutAgeDaysInput, maxRolloutAgeDaysTitle\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRolloutAgeDaysLabel, memoryMaxRolloutAgeDaysInput \? maxRolloutAgeDaysTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memoryMaxRolloutsPerStartupInput, memoryAdvancedLimits\.maxRolloutsPerStartup\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRolloutsPerStartupInput, maxRolloutsPerStartupTitle\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRolloutsPerStartupLabel, memoryMaxRolloutsPerStartupInput \? maxRolloutsPerStartupTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memoryMinRolloutIdleHoursInput, memoryAdvancedLimits\.minRolloutIdleHours\);/);
				    assert.match(listenerSection, /setChecked\(thinkingToggle, showThinkingEnabled\);/);
				    assert.match(listenerSection, /setChecked\(memoriesFeatureToggle, memoriesFeatureEnabled\);/);
				    assert.match(listenerSection, /setChecked\(memoryAutoRecallToggle, memoryAutoRecallEnabled\);/);
				    assert.doesNotMatch(listenerSection, /(?:thinkingToggle|memoriesFeatureToggle|memoryAutoRecallToggle)\.checked\s*=/);
				    assert.match(showThinkingStateSection, /const nextShowThinkingEnabled = data\.showThinking !== false;/);
				    assert.match(showThinkingStateSection, /if \(!hasPendingSettingState\('showThinkingState'\) && showThinkingEnabled === nextShowThinkingEnabled\) break;/);
				    assert.match(showThinkingStateSection, /updateShowThinkingState\(nextShowThinkingEnabled\);/);
				    assert.match(memoriesFeatureStateSection, /const nextMemoriesFeatureEnabled = data\.memoriesFeatureEnabled !== false;/);
				    assert.match(memoriesFeatureStateSection, /if \(!hasPendingSettingState\('memoriesFeatureState'\) && memoriesFeatureEnabled === nextMemoriesFeatureEnabled\) break;/);
				    assert.match(memoriesFeatureStateSection, /updateMemoriesFeatureState\(nextMemoriesFeatureEnabled\);/);
					    assert.match(memoryAutoRecallStateSection, /const nextMemoryAutoRecallEnabled = data\.memoryAutoRecall !== false;/);
					    assert.match(memoryAutoRecallStateSection, /if \(!hasPendingSettingState\('memoryAutoRecallState'\) && memoryAutoRecallEnabled === nextMemoryAutoRecallEnabled\) break;/);
					    assert.match(memoryAutoRecallStateSection, /updateMemoryAutoRecallState\(nextMemoryAutoRecallEnabled\);/);
					    assert.match(memoryAutoRecallBudgetStateSection, /const nextMemoryAutoRecallBudget = normalizeMemoryAutoRecallBudget\(data\.memoryAutoRecallMaxResults \|\| 4, data\.memoryAutoRecallMaxTokens \|\| 1200\);/);
					    assert.match(memoryAutoRecallBudgetStateSection, /const currentMemoryAutoRecallBudget = \{ maxResults: memoryAutoRecallMaxResults, maxTokens: memoryAutoRecallMaxTokens \};/);
					    assert.match(memoryAutoRecallBudgetStateSection, /if \(!hasPendingSettingState\('memoryAutoRecallBudgetState'\) && memoryAutoRecallBudgetEqual\(nextMemoryAutoRecallBudget, currentMemoryAutoRecallBudget\)\) break;/);
					    assert.match(memoryAutoRecallBudgetStateSection, /updateNormalizedMemoryAutoRecallBudgetState\(nextMemoryAutoRecallBudget\);/);
						    assert.match(memoryAutoRecallFiltersStateSection, /const nextMemoryAutoRecallFilters = normalizeMemoryAutoRecallFilters\(/);
						    assert.match(memoryAutoRecallFiltersStateSection, /typeof data\.memoryAutoRecallMinScore === 'number' \? data\.memoryAutoRecallMinScore : 7/);
						    assert.match(memoryAutoRecallFiltersStateSection, /typeof data\.memoryAutoRecallMaxAgeDays === 'number' \? data\.memoryAutoRecallMaxAgeDays : 45/);
						    assert.match(memoryAutoRecallFiltersStateSection, /if \(!hasPendingSettingState\('memoryAutoRecallFiltersState'\) && memoryAutoRecallFiltersEqual\(nextMemoryAutoRecallFilters, currentMemoryAutoRecallFilters\)\) break;/);
						    assert.match(memoryAutoRecallFiltersStateSection, /updateNormalizedMemoryAutoRecallFiltersState\(nextMemoryAutoRecallFilters\);/);
						    assert.match(memoryAdvancedLimitsStateSection, /const nextMemoryAdvancedLimits = normalizeMemoryAdvancedLimits\(data\.memoryAdvancedLimits \|\| \{\}\);/);
						    assert.match(memoryAdvancedLimitsStateSection, /if \(!hasPendingSettingState\('memoryAdvancedLimitsState'\) && memoryAdvancedLimitsEqual\(nextMemoryAdvancedLimits, memoryAdvancedLimits\)\) break;/);
						    assert.match(memoryAdvancedLimitsStateSection, /updateNormalizedMemoryAdvancedLimitsState\(nextMemoryAdvancedLimits\);/);
						    assert.match(stateSection, /function updateNormalizedMemoryAdvancedLimitsState\(limits\)/);
						    assert.match(stateSection, /function updateMemoryAdvancedLimitsState\(limits\)/);
						    assert.match(stateSection, /updateNormalizedMemoryAdvancedLimitsState\(normalizeMemoryAdvancedLimits\(limits\)\);/);
						    assert.match(stateSection, /setTitle\(memoryMinRolloutIdleHoursInput, minRolloutIdleHoursTitle\);/);
				    assert.match(stateSection, /setTitle\(memoryMinRolloutIdleHoursLabel, memoryMinRolloutIdleHoursInput \? minRolloutIdleHoursTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memoryMaxStateOutputsInput, memoryAdvancedLimits\.maxStateOutputs\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxStateOutputsInput, maxStateOutputsTitle\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxStateOutputsLabel, memoryMaxStateOutputsInput \? maxStateOutputsTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memoryMaxRecordsInput, memoryAdvancedLimits\.maxRecords\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRecordsInput, maxRecordsTitle\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxRecordsLabel, memoryMaxRecordsInput \? maxRecordsTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memoryMaxSearchResultsInput, memoryAdvancedLimits\.maxSearchResults\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxSearchResultsInput, maxSearchResultsTitle\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxSearchResultsLabel, memoryMaxSearchResultsInput \? maxSearchResultsTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memoryMaxResultsPerKindInput, memoryAdvancedLimits\.maxResultsPerKind\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxResultsPerKindInput, maxResultsPerKindTitle\);/);
			    assert.match(stateSection, /setTitle\(memoryMaxResultsPerKindLabel, memoryMaxResultsPerKindInput \? maxResultsPerKindTitle : ''\);/);
			    assert.match(stateSection, /setValue\(memorySearchNeighborWindowInput, memoryAdvancedLimits\.searchNeighborWindow\);/);
			    assert.match(stateSection, /setTitle\(memorySearchNeighborWindowInput, searchNeighborWindowTitle\);/);
			    assert.match(stateSection, /setTitle\(memorySearchNeighborWindowLabel, memorySearchNeighborWindowInput \? searchNeighborWindowTitle : ''\);/);
			    assert.doesNotMatch(stateSection, /\.(?:checked|value|title)\s*=/);
			  });

			  test('shared live-region announcer coalesces stale frames and skips duplicate clears', () => {
				    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
				    const helperStart = bootstrapSource.indexOf('let liveRegionAnnouncementFrame = null;');
			    assert.ok(helperStart >= 0, 'expected live-region announcement state');
			    const helperEnd = bootstrapSource.indexOf('function hasPendingSettingState', helperStart);
			    assert.ok(helperEnd > helperStart, 'expected live-region announcer before settings helpers');
			    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
			    const announceStart = helperSection.indexOf('function announceStatus');
			    assert.ok(announceStart >= 0, 'expected shared live-region announce helper');
			    const announceSection = helperSection.slice(announceStart);

			    assert.match(helperSection, /let liveRegionAnnouncementVersion = 0;/);
			    assert.match(helperSection, /let pendingLiveRegionAnnouncement = '';/);
			    assert.match(helperSection, /let lastLiveRegionAnnouncement = '';/);
			    assert.match(helperSection, /let lastLiveRegionRenderedText = '';/);
			    assert.match(helperSection, /if \(text === pendingLiveRegionAnnouncement\) return;/);
			    assert.match(helperSection, /text === lastLiveRegionAnnouncement && lastLiveRegionRenderedText === text/);
			    assert.match(helperSection, /cancelAnimationFrameHandle\(liveRegionAnnouncementFrame\);/);
			    assert.match(helperSection, /liveRegionAnnouncementVersion \+= 1;/);
				    assert.match(helperSection, /if \(version !== liveRegionAnnouncementVersion \|\| pendingLiveRegionAnnouncement !== text\) return;/);
				    assert.match(helperSection, /liveRegionAnnouncementFrame = requestAnimationFrameHandle\(\(\) => \{/);
				    assert.match(helperSection, /setTextContent\(liveRegion, ''\);/);
				    assert.match(helperSection, /lastLiveRegionRenderedText = '';/);
				    assert.match(helperSection, /setTextContent\(liveRegion, text\);/);
				    assert.match(helperSection, /lastLiveRegionRenderedText = text;/);
				    assert.doesNotMatch(helperSection, /liveRegionAnnouncementFrame = frame \|\| 0;/);
				    assert.doesNotMatch(announceSection, /try \{/);
				    assert.doesNotMatch(announceSection, /catch \{/);
				    assert.doesNotMatch(announceSection, /liveRegion\.textContent\s*=/);
				    assert.doesNotMatch(announceSection, /liveRegion\.textContent \|\| ''/);
			    assert.doesNotMatch(helperSection, /requestAnimationFrame\(\(\) => \{ liveRegion\.textContent = text; \}\)/);
			  });

			  test('memory action status updates avoid duplicate DOM and live-region writes', () => {
			    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
			    const chatHtml = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
		    const visibilityStart = bootstrapSource.indexOf('function setMemoryDropConfirmVisible');
		    assert.ok(visibilityStart >= 0, 'expected memory drop confirmation visibility helper');
		    const confirmStart = bootstrapSource.indexOf('function setMemoryDropConfirmPending', visibilityStart);
		    assert.ok(confirmStart > visibilityStart, 'expected memory drop confirmation helper after visibility helper');
			    const statusMessageStart = bootstrapSource.indexOf('function getMemoryActionStatusMessage', confirmStart);
			    assert.ok(statusMessageStart > confirmStart, 'expected memory action status message helper after confirmation helper');
			    const statusStart = bootstrapSource.indexOf('function updateMemoryActionStatusState', statusMessageStart);
			    assert.ok(statusStart > statusMessageStart, 'expected memory action status helper after message helper');
		    const statusEnd = bootstrapSource.indexOf('function updateMemoryAutoRecallState', statusStart);
		    assert.ok(statusEnd > statusStart, 'expected memory auto-recall helper after status helper');
			    const confirmSection = bootstrapSource.slice(visibilityStart, statusMessageStart);
			    const statusMessageSection = bootstrapSource.slice(statusMessageStart, statusStart);
			    const statusSection = bootstrapSource.slice(statusStart, statusEnd);

				    assert.match(bootstrapSource, /let\s+lastMemoryActionAnnouncement\s*=\s*''/);
				    assert.match(bootstrapSource, /let\s+memoryActionStatusKey\s*=\s*''/);
				    assert.match(bootstrapSource, /let\s+memoryActionStatusVisible\s*=\s*false/);
				    assert.match(bootstrapSource, /let\s+memoryActionStatusError\s*=\s*false/);
				    assert.match(bootstrapSource, /let\s+memoryActionStatusSuccess\s*=\s*false/);
				    assert.match(bootstrapSource, /let\s+memoryDropConfirmSynced\s*=\s*false/);
				    assert.match(bootstrapSource, /let\s+memoryDropConfirmVisible\s*=\s*false/);
		    assert.match(
		      chatHtml,
		      /<div id="memoryActionStatus" class="context-status hidden" role="note" aria-label="Memory action status"><\/div>/
		    );
		    assert.doesNotMatch(chatHtml, /<div id="memoryActionStatus"[^>]*(?:role="status"|aria-live=)/);
		    assert.match(
		      chatHtml,
		      /<div id="liveRegion" class="sr-only" role="status" aria-live="polite" aria-atomic="true"><\/div>/
		    );
				    assert.match(confirmSection, /function setMemoryDropConfirmVisible\(visible\)/);
				    assert.match(confirmSection, /if \(memoryDropConfirmVisible === visibleFlag\) return;/);
				    assert.match(confirmSection, /memoryDropConfirm\.classList\.toggle\('hidden', !visibleFlag\);/);
				    assert.match(confirmSection, /setMemoryDropConfirmVisible\(memoryDropConfirmPending\);/);
				    assert.match(confirmSection, /setAttributeValue\(memoryDropBtn, 'aria-expanded', memoryDropConfirmPending \? 'true' : 'false'\);/);
				    assert.match(confirmSection, /const wasPending = memoryDropConfirmPending;/);
				    assert.match(confirmSection, /const nextPending = !!pending;/);
				    assert.match(confirmSection, /if \(memoryDropConfirmSynced && wasPending === nextPending\) \{[\s\S]*if \(!options \|\| options\.sync !== false\) syncInputState\(\);[\s\S]*return;[\s\S]*\}/);
				    assert.match(confirmSection, /memoryDropConfirmPending = nextPending;/);
				    assert.match(confirmSection, /memoryDropConfirmSynced = true;/);
				    assert.match(confirmSection, /if \(memoryDropConfirmSynced && wasPending === nextPending\) \{[\s\S]*return;[\s\S]*\}[\s\S]*setMemoryDropConfirmVisible\(memoryDropConfirmPending\);/);
				    assert.match(confirmSection, /focusInlineConfirmationTarget\(memoryDropCancelBtn\);/);
			    assert.match(confirmSection, /focusInlineConfirmationTarget\(memoryDropBtn\);/);
			    assert.match(confirmSection, /options\.restoreFocus !== false/);
				    assert.match(bootstrapSource, /setMemoryDropConfirmPending\(false, \{ sync: false, restoreFocus: false \}\);/);
				    assert.doesNotMatch(confirmSection, /setHidden\(memoryDropConfirm, !memoryDropConfirmPending\);/);
				    assert.doesNotMatch(confirmSection, /\.setAttribute\('aria-expanded'/);
				    assert.match(bootstrapSource, /const MEMORY_ACTION_STATUS_MESSAGE_LIMIT = 240;/);
				    assert.match(statusMessageSection, /const value = typeof message === 'string' \? message\.trim\(\) : '';/);
				    assert.match(statusMessageSection, /value\.length <= MEMORY_ACTION_STATUS_MESSAGE_LIMIT/);
				    assert.match(statusMessageSection, /value\.slice\(0, MEMORY_ACTION_STATUS_MESSAGE_LIMIT\) \+ '…'/);
				    assert.match(statusSection, /const message = getMemoryActionStatusMessage\(status && typeof status\.message === 'string' \? status\.message : ''\);/);
				    assert.match(statusSection, /const nextKey = state \+ '\\n' \+ message;/);
			    assert.match(statusSection, /if \(nextKey === memoryActionStatusKey\) return false;/);
			    assert.match(statusSection, /memoryActionStatusKey = nextKey;/);
			    assert.match(statusSection, /setTextContent\(memoryActionStatus, message\);/);
			    assert.match(statusSection, /const hasMessage = !!message;/);
			    assert.match(statusSection, /if \(memoryActionStatusVisible !== hasMessage\) \{[\s\S]*memoryActionStatusVisible = hasMessage;[\s\S]*memoryActionStatus\.classList\.toggle\('hidden', !hasMessage\);[\s\S]*\}/);
			    assert.doesNotMatch(statusSection, /setHidden\(memoryActionStatus/);
			    assert.match(statusSection, /const isError = state === 'error';/);
			    assert.match(statusSection, /if \(memoryActionStatusError !== isError\) \{[\s\S]*memoryActionStatusError = isError;[\s\S]*setClassPresence\(memoryActionStatus, 'error', isError\);[\s\S]*\}/);
			    assert.match(statusSection, /const isSuccess = state === 'success';/);
			    assert.match(statusSection, /if \(memoryActionStatusSuccess !== isSuccess\) \{[\s\S]*memoryActionStatusSuccess = isSuccess;[\s\S]*setClassPresence\(memoryActionStatus, 'success', isSuccess\);[\s\S]*\}/);
			    assert.match(statusSection, /setTextContent\(memoryUpdateNowBtn,/);
			    assert.match(statusSection, /setTitle\(memoryUpdateNowBtn,/);
			    assert.match(statusSection, /setAttributeValue\(memoryUpdateNowBtn, 'aria-label', updateMemoriesAriaDetail \? updateMemoriesText \+ ', ' \+ updateMemoriesAriaDetail : updateMemoriesText\);/);
			    assert.match(statusSection, /setTextContent\(memoryDropBtn,/);
			    assert.match(statusSection, /setTitle\(memoryDropBtn,/);
			    assert.match(statusSection, /setAttributeValue\(memoryDropBtn, 'aria-label', dropMemoriesAriaDetail \? dropMemoriesText \+ ', ' \+ dropMemoriesAriaDetail : dropMemoriesText\);/);
			    assert.match(statusSection, /message && lastMemoryActionAnnouncement !== message/);
			    assert.match(statusSection, /announceStatus\(message\);/);
			    assert.match(statusSection, /syncInputState\(\);/);
			    assert.match(statusSection, /return true;/);
		    assert.doesNotMatch(statusSection, /memoryActionStatus\.textContent\s*=/);
		    assert.doesNotMatch(statusSection, /setHidden\(memoryActionStatus, !message\);/);
		    assert.doesNotMatch(statusSection, /setClassPresence\(memoryActionStatus, 'error', state === 'error'\);/);
		    assert.doesNotMatch(statusSection, /setClassPresence\(memoryActionStatus, 'success', state === 'success'\);/);
		    assert.doesNotMatch(statusSection, /memoryUpdateNowBtn\.textContent\s*=/);
		    assert.doesNotMatch(statusSection, /memoryDropBtn\.textContent\s*=/);
		  });

		  test('explore subagent compaction and plan control state updates avoid duplicate property writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
		    const controlsStart = bootstrapSource.indexOf('const explorePrepassDisabled');
	    assert.ok(controlsStart >= 0, 'expected explore/subagent/compaction settings section');
	    const controlsEnd = bootstrapSource.indexOf('const modelControlsDisabled', controlsStart);
	    assert.ok(controlsEnd > controlsStart, 'expected model controls section after explore/subagent/compaction controls');
	    const controlsSection = bootstrapSource.slice(controlsStart, controlsEnd);
	    const planFirstStateStart = mainSource.indexOf("case 'planFirstState':");
	    assert.ok(planFirstStateStart >= 0, 'expected plan-first state branch');
		    const planFirstStateEnd = mainSource.indexOf("case 'sessionsPersistState':", planFirstStateStart);
		    assert.ok(planFirstStateEnd > planFirstStateStart, 'expected sessions persist branch after plan-first state');
		    const planFirstStateSection = mainSource.slice(planFirstStateStart, planFirstStateEnd);
			    const explorePrepassStateStart = mainSource.indexOf("case 'explorePrepassState':");
			    assert.ok(explorePrepassStateStart >= 0, 'expected explore-prepass state branch');
			    const subagentModelOverrideStateStart = mainSource.indexOf("case 'subagentModelOverrideState':", explorePrepassStateStart);
			    assert.ok(subagentModelOverrideStateStart > explorePrepassStateStart, 'expected subagent model branch after explore-prepass state');
			    const explorePrepassStateSection = mainSource.slice(explorePrepassStateStart, subagentModelOverrideStateStart);
				    const subagentTaskMaxOutputCharsStateStart = mainSource.indexOf("case 'subagentTaskMaxOutputCharsState':", subagentModelOverrideStateStart);
				    assert.ok(subagentTaskMaxOutputCharsStateStart > subagentModelOverrideStateStart, 'expected subagent task output branch after subagent model branch');
				    const subagentModelOverrideStateSection = mainSource.slice(subagentModelOverrideStateStart, subagentTaskMaxOutputCharsStateStart);
				    const autoCompactionStateStart = mainSource.indexOf("case 'autoCompactionState':", subagentTaskMaxOutputCharsStateStart);
				    assert.ok(autoCompactionStateStart > subagentTaskMaxOutputCharsStateStart, 'expected auto-compaction state branch after subagent task output branch');
				    const subagentTaskMaxOutputCharsStateSection = mainSource.slice(subagentTaskMaxOutputCharsStateStart, autoCompactionStateStart);
				    const compactionPruneStateStart = mainSource.indexOf("case 'compactionPruneState':", autoCompactionStateStart);
				    assert.ok(compactionPruneStateStart > autoCompactionStateStart, 'expected compaction prune branch after auto-compaction state');
				    const autoCompactionStateSection = mainSource.slice(autoCompactionStateStart, compactionPruneStateStart);
			    const compactionToolOutputModeStateStart = mainSource.indexOf("case 'compactionToolOutputModeState':", compactionPruneStateStart);
			    assert.ok(compactionToolOutputModeStateStart > compactionPruneStateStart, 'expected compaction tool-output mode branch after compaction prune state');
			    const compactionPruneStateSection = mainSource.slice(compactionPruneStateStart, compactionToolOutputModeStateStart);
				    const modelLimitsStateStart = mainSource.indexOf("case 'modelLimitsState':", compactionToolOutputModeStateStart);
				    assert.ok(modelLimitsStateStart > compactionToolOutputModeStateStart, 'expected model limits branch after compaction tool-output mode state');
				    const compactionToolOutputModeStateSection = mainSource.slice(compactionToolOutputModeStateStart, modelLimitsStateStart);
				    const generationSettingsStateStart = mainSource.indexOf("case 'generationSettingsState':", modelLimitsStateStart);
				    assert.ok(generationSettingsStateStart > modelLimitsStateStart, 'expected generation settings branch after model limits state');
				    const modelLimitsStateSection = mainSource.slice(modelLimitsStateStart, generationSettingsStateStart);

	    assert.match(controlsSection, /setDisabled\(explorePrepassToggle, explorePrepassDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(explorePrepassLabel, explorePrepassDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(explorePrepassMaxCharsInput, explorePrepassDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(explorePrepassMaxCharsLabel, explorePrepassDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(subagentModelOverrideInput, subagentModelOverrideDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(subagentModelOverrideLabel, subagentModelOverrideDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(subagentTaskMaxOutputCharsInput, subagentTaskMaxOutputCharsDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(subagentTaskMaxOutputCharsLabel, subagentTaskMaxOutputCharsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(autoCompactionToggle, autoCompactionDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(autoCompactionLabel, autoCompactionDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(modelLimitsInput, modelLimitsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(modelLimitsApply, modelLimitsDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(modelLimitsLabel, modelLimitsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(compactionPruneToggle, compactionPruneDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(compactionPruneLabel, compactionPruneDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(compactionPruneProtectTokensInput, compactionPruneDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(compactionPruneProtectTokensLabel, compactionPruneDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(compactionPruneMinimumTokensInput, compactionPruneDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(compactionPruneMinimumTokensLabel, compactionPruneDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(compactionToolOutputModeSelect, compactionToolOutputModeDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(compactionToolOutputModeLabel, compactionToolOutputModeDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(planFirstToggle, planFirstDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(planFirstLabel, planFirstDisabled\);/);
		    assert.match(planFirstStateSection, /const nextPlanFirstEnabled = data\.planFirst !== false;/);
		    assert.match(planFirstStateSection, /if \(!hasPendingSettingState\('planFirstState'\) && planFirstEnabled === nextPlanFirstEnabled\) break;/);
		    assert.match(planFirstStateSection, /updatePlanFirstState\(nextPlanFirstEnabled\);/);
			    assert.match(explorePrepassStateSection, /const nextExplorePrepassEnabled = !!data\.explorePrepass;/);
			    assert.match(explorePrepassStateSection, /const nextExplorePrepassMaxChars = normalizeExplorePrepassMaxChars\(data\.explorePrepassMaxChars\);/);
				    assert.match(explorePrepassStateSection, /explorePrepassEnabled === nextExplorePrepassEnabled/);
				    assert.match(explorePrepassStateSection, /explorePrepassMaxChars === nextExplorePrepassMaxChars/);
				    assert.match(explorePrepassStateSection, /updateNormalizedExplorePrepassState\(nextExplorePrepassEnabled, nextExplorePrepassMaxChars\);/);
					    assert.match(subagentModelOverrideStateSection, /const nextSubagentModelOverride = normalizeSubagentModelOverride\(data\.subagentModelOverride\);/);
					    assert.match(subagentModelOverrideStateSection, /if \(!hasPendingSettingState\('subagentModelOverrideState'\) && subagentModelOverride === nextSubagentModelOverride\) break;/);
					    assert.match(subagentModelOverrideStateSection, /updateNormalizedSubagentModelOverrideState\(nextSubagentModelOverride\);/);
					    assert.match(subagentTaskMaxOutputCharsStateSection, /const nextSubagentTaskMaxOutputChars = normalizeSubagentTaskMaxOutputChars\(data\.subagentTaskMaxOutputChars \|\| 8000\);/);
					    assert.match(subagentTaskMaxOutputCharsStateSection, /if \(!hasPendingSettingState\('subagentTaskMaxOutputCharsState'\) && subagentTaskMaxOutputChars === nextSubagentTaskMaxOutputChars\) break;/);
					    assert.match(subagentTaskMaxOutputCharsStateSection, /updateNormalizedSubagentTaskMaxOutputCharsState\(nextSubagentTaskMaxOutputChars\);/);
				    assert.match(autoCompactionStateSection, /const nextAutoCompactionEnabled = data\.autoCompaction !== false;/);
				    assert.match(autoCompactionStateSection, /if \(!hasPendingSettingState\('autoCompactionState'\) && autoCompactionEnabled === nextAutoCompactionEnabled\) break;/);
				    assert.match(autoCompactionStateSection, /updateAutoCompactionState\(nextAutoCompactionEnabled\);/);
				    assert.match(compactionPruneStateSection, /const nextCompactionPruneSettings = normalizeCompactionPruneSettings\(/);
				    assert.match(compactionPruneStateSection, /data\.compactionPrune !== false,/);
				    assert.match(compactionPruneStateSection, /nextCompactionPruneProtectTokensSource,/);
				    assert.match(compactionPruneStateSection, /if \(!hasPendingSettingState\('compactionPruneState'\) && compactionPruneSettingsEqual\(nextCompactionPruneSettings, currentCompactionPruneSettings\)\) break;/);
				    assert.match(compactionPruneStateSection, /updateNormalizedCompactionPruneState\(nextCompactionPruneSettings\);/);
				    assert.match(compactionToolOutputModeStateSection, /const nextCompactionToolOutputMode = normalizeCompactionToolOutputMode\(data\.compactionToolOutputMode \|\| 'onCompaction'\);/);
				    assert.match(compactionToolOutputModeStateSection, /if \(!hasPendingSettingState\('compactionToolOutputModeState'\) && compactionToolOutputMode === nextCompactionToolOutputMode\) break;/);
				    assert.match(compactionToolOutputModeStateSection, /updateNormalizedCompactionToolOutputModeState\(nextCompactionToolOutputMode\);/);
				    assert.match(modelLimitsStateSection, /const nextModelLimits = normalizeModelLimits\(data\.modelLimits \|\| \{\}\);/);
				    assert.match(modelLimitsStateSection, /if \(!hasPendingSettingState\('modelLimitsState'\) && modelLimitsEqual\(nextModelLimits, modelLimits\)\) break;/);
				    assert.match(modelLimitsStateSection, /updateNormalizedModelLimitsState\(nextModelLimits\);/);
					    assert.doesNotMatch(controlsSection, /\.(?:disabled)\s*=/);
			    assert.doesNotMatch(controlsSection, /classList\.toggle\('disabled'/);
		  });

		  test('explore subagent compaction settings state updates avoid duplicate checked value and title writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
			    const stateStart = bootstrapSource.indexOf('function normalizeExplorePrepassMaxChars');
			    assert.ok(stateStart >= 0, 'expected explore prepass normalization helper');
		    const stateEnd = bootstrapSource.indexOf('function setMode', stateStart);
		    assert.ok(stateEnd > stateStart, 'expected mode helper after explore/subagent/compaction state helpers');
		    const stateSection = bootstrapSource.slice(stateStart, stateEnd);
		    const pruneApplyStart = bootstrapSource.indexOf('function applyCompactionPruneSettings', stateStart);
		    assert.ok(pruneApplyStart > stateStart, 'expected compaction prune apply helper after compaction state helper');
		    const pruneApplyEnd = bootstrapSource.indexOf('function updateNormalizedCompactionToolOutputModeState', pruneApplyStart);
		    assert.ok(pruneApplyEnd > pruneApplyStart, 'expected compaction tool-output mode helper after prune apply helper');
		    const pruneApplySection = bootstrapSource.slice(pruneApplyStart, pruneApplyEnd);
		    const listenerStart = bootstrapSource.indexOf('if (explorePrepassToggle)', stateEnd);
		    assert.ok(listenerStart > stateEnd, 'expected explore/subagent listener section after state helpers');
		    const listenerEnd = bootstrapSource.indexOf('if (autoCompactionToggle)', listenerStart);
		    assert.ok(listenerEnd > listenerStart, 'expected auto-compaction listener after subagent listeners');
		    const listenerSection = bootstrapSource.slice(listenerStart, listenerEnd);

			    assert.match(stateSection, /function normalizeExplorePrepassMaxChars\(maxChars\)/);
			    assert.match(stateSection, /function updateNormalizedExplorePrepassState\(enabled, maxChars\)/);
			    assert.match(stateSection, /function updateExplorePrepassState\(enabled, maxChars\)/);
			    assert.match(stateSection, /updateNormalizedExplorePrepassState\(enabled, normalizeExplorePrepassMaxChars\(maxChars\)\);/);
			    assert.match(stateSection, /setChecked\(explorePrepassToggle, explorePrepassEnabled\);/);
		    assert.match(stateSection, /setValue\(explorePrepassMaxCharsInput, explorePrepassMaxChars\);/);
		    assert.match(stateSection, /setTitle\(explorePrepassMaxCharsInput,/);
		    assert.match(stateSection, /setTitle\(explorePrepassLabel,/);
			    assert.match(stateSection, /function normalizeSubagentModelOverride\(model\)/);
			    assert.match(stateSection, /function updateNormalizedSubagentModelOverrideState\(model\)/);
			    assert.match(stateSection, /function updateSubagentModelOverrideState\(model\)/);
			    assert.match(stateSection, /updateNormalizedSubagentModelOverrideState\(normalizeSubagentModelOverride\(model\)\);/);
			    assert.match(stateSection, /setValue\(subagentModelOverrideInput, subagentModelOverride\);/);
		    assert.match(stateSection, /setTitle\(subagentModelOverrideInput,/);
		    assert.match(stateSection, /setTitle\(subagentModelOverrideLabel,/);
			    assert.match(stateSection, /function normalizeSubagentTaskMaxOutputChars\(maxChars\)/);
			    assert.match(stateSection, /function updateNormalizedSubagentTaskMaxOutputCharsState\(maxChars\)/);
			    assert.match(stateSection, /function updateSubagentTaskMaxOutputCharsState\(maxChars\)/);
			    assert.match(stateSection, /updateNormalizedSubagentTaskMaxOutputCharsState\(normalizeSubagentTaskMaxOutputChars\(maxChars\)\);/);
			    assert.match(stateSection, /setValue\(subagentTaskMaxOutputCharsInput, subagentTaskMaxOutputChars\);/);
		    assert.match(stateSection, /setTitle\(subagentTaskMaxOutputCharsInput,/);
		    assert.match(stateSection, /setTitle\(subagentTaskMaxOutputCharsLabel,/);
		    assert.match(stateSection, /setChecked\(autoCompactionToggle, autoCompactionEnabled\);/);
		    assert.match(stateSection, /setTitle\(autoCompactionLabel,/);
		    assert.match(stateSection, /function updateNormalizedModelLimitsState\(limits\)/);
		    assert.match(stateSection, /function updateModelLimitsState\(limits\)/);
		    assert.match(stateSection, /updateNormalizedModelLimitsState\(normalizeModelLimits\(limits\)\);/);
		    assert.match(stateSection, /setValue\(modelLimitsInput, serializeNormalizedModelLimits\(modelLimits\)\);/);
		    assert.match(stateSection, /setTitle\(modelLimitsInput,/);
		    assert.match(stateSection, /setTitle\(modelLimitsLabel,/);
			    assert.match(stateSection, /function normalizeCompactionPruneSettings\(prune, protectTokens, minimumTokens\)/);
			    assert.match(stateSection, /function updateNormalizedCompactionPruneState\(settings\)/);
			    assert.match(stateSection, /function updateCompactionPruneState\(prune, protectTokens, minimumTokens\)/);
			    assert.match(stateSection, /updateNormalizedCompactionPruneState\(normalizeCompactionPruneSettings\(prune, protectTokens, minimumTokens\)\);/);
			    assert.match(stateSection, /setChecked\(compactionPruneToggle, compactionPruneEnabled\);/);
		    assert.match(stateSection, /setValue\(compactionPruneProtectTokensInput, compactionPruneProtectTokens\);/);
		    assert.match(stateSection, /setTitle\(compactionPruneProtectTokensInput,/);
		    assert.match(stateSection, /setTitle\(compactionPruneProtectTokensLabel,/);
		    assert.match(stateSection, /setValue\(compactionPruneMinimumTokensInput, compactionPruneMinimumTokens\);/);
		    assert.match(stateSection, /setTitle\(compactionPruneMinimumTokensInput,/);
		    assert.match(stateSection, /setTitle\(compactionPruneMinimumTokensLabel,/);
		    assert.match(stateSection, /setTitle\(compactionPruneLabel,/);
		    assert.match(stateSection, /setChecked\(compactionPruneToggle, compactionPruneEnabled\);/);
		    assert.match(stateSection, /function updateNormalizedCompactionToolOutputModeState\(mode\)/);
		    assert.match(stateSection, /setValue\(compactionToolOutputModeSelect, compactionToolOutputMode\);/);
		    assert.match(stateSection, /setTitle\(compactionToolOutputModeSelect,/);
		    assert.match(stateSection, /function updateCompactionToolOutputModeState\(mode\)/);
		    assert.match(stateSection, /updateNormalizedCompactionToolOutputModeState\(normalizeCompactionToolOutputMode\(mode\)\);/);
		    assert.match(pruneApplySection, /const settings = \{/);
		    assert.match(pruneApplySection, /pruneProtectTokens: Math\.floor\(pruneProtectTokens\)/);
		    assert.match(pruneApplySection, /if \(compactionPruneSettingsEqual\(settings, current\)\) \{/);
		    assert.match(pruneApplySection, /updateNormalizedCompactionPruneState\(current\);/);
		    assert.ok(
		      pruneApplySection.indexOf('compactionPruneSettingsEqual(settings, current)') < pruneApplySection.indexOf('postSettingWithPendingState('),
		      'expected unchanged compaction prune guard before posting'
		    );
		    assert.match(listenerSection, /if \(enabled === explorePrepassEnabled\) return;/);
		    assert.match(listenerSection, /if \(normalizedMaxChars === explorePrepassMaxChars\) \{/);
		    assert.match(listenerSection, /if \(model === subagentModelOverride\) \{/);
		    assert.match(listenerSection, /if \(normalizedMaxChars === subagentTaskMaxOutputChars\) \{/);
		    assert.match(listenerSection, /updateNormalizedExplorePrepassState\(explorePrepassEnabled, explorePrepassMaxChars\)/);
		    assert.match(listenerSection, /updateNormalizedSubagentModelOverrideState\(subagentModelOverride\)/);
		    assert.match(listenerSection, /updateNormalizedSubagentTaskMaxOutputCharsState\(subagentTaskMaxOutputChars\)/);
		    assert.doesNotMatch(listenerSection, /updateExplorePrepassState\(explorePrepassEnabled, explorePrepassMaxChars\)/);
		    assert.doesNotMatch(listenerSection, /updateSubagentModelOverrideState\(subagentModelOverride\)/);
		    assert.doesNotMatch(listenerSection, /updateSubagentTaskMaxOutputCharsState\(subagentTaskMaxOutputChars\)/);
		    assert.ok(
		      listenerSection.indexOf('normalizedMaxChars === explorePrepassMaxChars') < listenerSection.indexOf("{ type: 'setExplorePrepassMaxChars'"),
		      'expected unchanged explore max guard before posting'
		    );
		    assert.ok(
		      listenerSection.indexOf('model === subagentModelOverride') < listenerSection.indexOf("{ type: 'setSubagentModelOverride'"),
		      'expected unchanged subagent model guard before posting'
		    );
		    assert.ok(
		      listenerSection.indexOf('normalizedMaxChars === subagentTaskMaxOutputChars') < listenerSection.indexOf("{ type: 'setSubagentTaskMaxOutputChars'"),
		      'expected unchanged subagent output guard before posting'
		    );
		    assert.doesNotMatch(stateSection, /\.(?:checked|value|title)\s*=/);
		  });

		  test('model mode and context control state updates avoid duplicate property writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const controlsStart = bootstrapSource.indexOf('const modelControlsDisabled');
	    assert.ok(controlsStart >= 0, 'expected model/mode/context controls section');
	    const controlsEnd = bootstrapSource.indexOf('const canAuthenticate', controlsStart);
	    assert.ok(controlsEnd > controlsStart, 'expected provider auth controls after model/mode/context controls');
	    const controlsSection = bootstrapSource.slice(controlsStart, controlsEnd);
	    const advancedStateStart = mainSource.indexOf("case 'advancedModelSettingsState':");
	    assert.ok(advancedStateStart >= 0, 'expected advanced model settings state branch');
	    const advancedStateEnd = mainSource.indexOf("case 'logsActionState':", advancedStateStart);
	    assert.ok(advancedStateEnd > advancedStateStart, 'expected logs action state after advanced model settings state');
	    const advancedStateSection = mainSource.slice(advancedStateStart, advancedStateEnd);

	    assert.match(controlsSection, /setDisabled\(modelPicker, modelControlsDisabled\);/);
	    assert.match(controlsSection, /const modelControlsDisabled = !connected \|\| routingControlsBusy \|\| modelSwitchPending \|\| modelFavoritePending \|\| modelPickerRefreshPending \|\| modelPickerOpenPending;/);
	    assert.match(controlsSection, /setDisabled\(reasoningEffortSelect, !connected \|\| routingControlsBusy \|\| reasoningEffortPending \|\| modelSwitchPending\);/);
	    assert.match(controlsSection, /setDisabled\(modelFavoriteToggle, modelControlsDisabled \|\| !currentModel\);/);
	    assert.match(controlsSection, /setDisabled\(modelSettings, modelControlsDisabled\);/);
		    assert.match(controlsSection, /setDisabled\(customModelApply, !connected \|\| routingControlsBusy \|\| modelSwitchPending\);/);
		    assert.match(controlsSection, /setDisabled\(modelRefreshList, modelControlsDisabled\);/);
		    assert.match(bootstrapSource, /function hasRecentModelsForPicker\(\)/);
		    assert.match(bootstrapSource, /function getModelClearRecentsDisabled\(modelControlsDisabled\)/);
		    assert.match(bootstrapSource, /modelFavoritePending \|\| !hasRecentModelsForPicker\(\)\) return;/);
		    assert.match(controlsSection, /setDisabled\(modelClearRecents, getModelClearRecentsDisabled\(modelControlsDisabled\)\);/);
		    assert.match(controlsSection, /setDisabled\(modelPickerSearchInput, modelControlsDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(modelPickerSearchLabel, modelControlsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(modelSettingsApply, generationSettingsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(modelSettingsOpenSettings, !connected \|\| isProcessing \|\| advancedModelSettingsPending\);/);
	    assert.match(controlsSection, /const modeControlsDisabled = !connected \|\| routingControlsBusy \|\| modeSwitchPending;/);
	    assert.match(controlsSection, /setDisabled\(modePlanBtn, modeControlsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(modeBuildBtn, modeControlsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(contextIndicator, !connected\);/);
	    assert.match(controlsSection, /setDisabled\(contextCompactNowBtn, !connected \|\| isProcessing \|\| sessionActionBusy\);/);
	    assert.match(advancedStateSection, /if \(!data\.pending && !advancedModelSettingsPending\) break;/);
	    assert.match(advancedStateSection, /clearPendingActionTimer\('advancedModelSettings'\);/);
	    assert.match(advancedStateSection, /advancedModelSettingsPending = false;/);
	    assert.match(advancedStateSection, /syncInputState\(\);/);
	    assert.doesNotMatch(controlsSection, /\.(?:disabled)\s*=/);
	    assert.doesNotMatch(controlsSection, /classList\.toggle\('disabled'/);
	  });

	  test('mode toggle updates avoid duplicate active and aria writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const helperStart = bootstrapSource.indexOf('function setMode(mode)');
	    assert.ok(helperStart >= 0, 'expected mode helper');
	    const helperEnd = bootstrapSource.indexOf('function requestModeChange', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected mode request helper after mode helper');
	    const helperSection = bootstrapSource.slice(helperStart, helperEnd);
	    const listenerStart = bootstrapSource.indexOf('if (modePlanBtn)', helperEnd);
	    assert.ok(listenerStart > helperEnd, 'expected mode button listener setup');
	    const listenerEnd = bootstrapSource.indexOf('if (newSessionBtn)', listenerStart);
	    assert.ok(listenerEnd > listenerStart, 'expected session button setup after mode listener setup');
	    const listenerSection = bootstrapSource.slice(listenerStart, listenerEnd);
	    const modeChangedStart = mainSource.indexOf("case 'modeChanged':");
	    assert.ok(modeChangedStart >= 0, 'expected modeChanged branch');
	    const modeChangedEnd = mainSource.indexOf("case 'turnStatus':", modeChangedStart);
	    assert.ok(modeChangedEnd > modeChangedStart, 'expected turnStatus branch after modeChanged');
	    const modeChangedSection = mainSource.slice(modeChangedStart, modeChangedEnd);

	    assert.match(helperSection, /setClassPresence\(modePlanBtn, 'active', currentMode === 'plan'\);/);
	    assert.match(helperSection, /setAttributeValue\(modePlanBtn, 'aria-pressed', currentMode === 'plan' \? 'true' : 'false'\);/);
	    assert.match(helperSection, /setClassPresence\(modeBuildBtn, 'active', currentMode === 'build'\);/);
	    assert.match(helperSection, /setAttributeValue\(modeBuildBtn, 'aria-pressed', currentMode === 'build' \? 'true' : 'false'\);/);
	    assert.match(modeChangedSection, /const nextMode = data\.mode === 'plan' \? 'plan' : 'build';/);
	    assert.match(modeChangedSection, /if \(!modeSwitchPending && currentMode === nextMode\) break;/);
	    assert.match(modeChangedSection, /setMode\(nextMode\);/);
	    assert.doesNotMatch(modeChangedSection, /setMode\(nextMode\);\s*syncInputState\(\);/);
	    assert.match(listenerSection, /setAttributeValue\(modePlanBtn, 'aria-pressed', 'false'\);/);
	    assert.match(listenerSection, /setAttributeValue\(modeBuildBtn, 'aria-pressed', 'true'\);/);
	    assert.doesNotMatch(helperSection, /classList\.toggle\('active'/);
	    assert.doesNotMatch(helperSection, /\.setAttribute\('aria-pressed'/);
	    assert.doesNotMatch(listenerSection, /\.setAttribute\('aria-pressed'/);
	  });

	  test('model header updates avoid duplicate property writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
		    const renderKeyStart = contextSource.indexOf('function getModelHeaderRenderKeyForState');
		    assert.ok(renderKeyStart >= 0, 'expected model header render-key helper');
		    const renderKeyEnd = contextSource.indexOf('function getModelHeaderRenderKey', renderKeyStart + 1);
		    assert.ok(renderKeyEnd > renderKeyStart, 'expected model header public render-key helper after state helper');
		    const renderKeySection = contextSource.slice(renderKeyStart, renderKeyEnd);
			    const headerStart = contextSource.indexOf('function updateNormalizedModelHeader');
			    assert.ok(headerStart >= 0, 'expected normalized model header update helper');
		    const headerEnd = contextSource.indexOf('function normalizeProviderAuthState', headerStart);
		    assert.ok(headerEnd > headerStart, 'expected provider auth helper after model header helper');
		    const headerSection = contextSource.slice(headerStart, headerEnd);
		    const modelChangedStart = mainSource.indexOf("case 'modelChanged':");
		    assert.ok(modelChangedStart >= 0, 'expected modelChanged branch');
		    const modelStateStart = mainSource.indexOf("case 'modelState':", modelChangedStart);
		    assert.ok(modelStateStart > modelChangedStart, 'expected modelState branch after modelChanged');
		    const modelPickerStateStart = mainSource.indexOf("case 'modelPickerState':", modelStateStart);
		    assert.ok(modelPickerStateStart > modelStateStart, 'expected modelPickerState branch after modelState');
		    const modelPickerStateEnd = mainSource.indexOf("case 'advancedModelSettingsState':", modelPickerStateStart);
		    assert.ok(modelPickerStateEnd > modelPickerStateStart, 'expected advanced model settings branch after modelPickerState');
		    const modelChangedSection = mainSource.slice(modelChangedStart, modelStateStart);
		    const modelStateSection = mainSource.slice(modelStateStart, modelPickerStateStart);
		    const modelPickerStateSection = mainSource.slice(modelPickerStateStart, modelPickerStateEnd);
		    const customModelStart = bootstrapSource.indexOf('function updateCustomModelInputState');
		    assert.ok(customModelStart >= 0, 'expected custom model input helper');
		    const customModelEnd = bootstrapSource.indexOf('function appendSearchToken', customModelStart);
		    assert.ok(customModelEnd > customModelStart, 'expected search helper after custom model input helper');
		    const customModelSection = bootstrapSource.slice(customModelStart, customModelEnd);
		    const reasoningListenerStart = bootstrapSource.indexOf("reasoningEffortSelect.addEventListener('change'");
		    assert.ok(reasoningListenerStart >= 0, 'expected reasoning effort change listener');
		    const reasoningListenerEnd = bootstrapSource.indexOf("if (modelFavoriteToggle)", reasoningListenerStart);
		    assert.ok(reasoningListenerEnd > reasoningListenerStart, 'expected model favorite listener after reasoning listener');
		    const reasoningListenerSection = bootstrapSource.slice(reasoningListenerStart, reasoningListenerEnd);

		    assert.match(bootstrapSource, /function\s+setTitle\(/);
	    assert.match(bootstrapSource, /function\s+setValue\(/);
	    assert.match(bootstrapSource, /function\s+setAttributeValue\(/);
	    assert.match(bootstrapSource, /const MODEL_DISPLAY_LIMIT = 160;/);
	    assert.match(contextSource, /let modelHeaderRenderKey = '';/);
	    assert.ok(contextSource.includes("const MODEL_HEADER_REASONING_EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];"));
			    assert.match(contextSource, /function\s+normalizeModelHeaderState\(state\)/);
			    assert.match(contextSource, /function\s+isModelHeaderRenderKeyCurrent\(renderKey\)/);
			    assert.match(contextSource, /function\s+isModelHeaderStateCurrent\(state\)/);
			    assert.match(contextSource, /return renderKey === modelHeaderRenderKey;/);
			    assert.match(contextSource, /return isModelHeaderRenderKeyCurrent\(getModelHeaderRenderKey\(state\)\);/);
			    assert.match(contextSource, /MODEL_HEADER_REASONING_EFFORTS\.indexOf\(nextReasoningEffort\) >= 0/);
		    assert.match(renderKeySection, /const key = createCompactRenderKeyBuilder\(\);/);
		    assert.match(renderKeySection, /appendCompactContextRenderKeyPart\(key, state\.modelId\);/);
		    assert.match(renderKeySection, /appendCompactContextRenderKeyPart\(key, state\.label\);/);
		    assert.match(renderKeySection, /return finishCompactRenderKey\(key\);/);
		    assert.doesNotMatch(contextSource, /function appendModelHeaderRenderKeyPart\(/);
		    assert.doesNotMatch(contextSource, /const allowedReasoningEfforts = \['', 'low', 'medium', 'high', 'xhigh', 'max'\];/);
		    assert.match(headerSection, /function updateNormalizedModelHeader\(modelHeaderState, renderKey\)/);
		    assert.match(headerSection, /const nextRenderKey = typeof renderKey === 'string' && renderKey \? renderKey : getModelHeaderRenderKeyForState\(modelHeaderState\);/);
		    assert.match(headerSection, /const displayLabel = getModelDisplayText\(label\);/);
		    assert.match(headerSection, /const displayTitle = displayLabel \+ ' • reasoning ' \+ reasoningLabel;/);
		    assert.match(headerSection, /if \(nextRenderKey === modelHeaderRenderKey\) return;/);
		    assert.match(headerSection, /modelHeaderRenderKey = nextRenderKey;/);
	    assert.ok(
	      headerSection.indexOf('if (nextRenderKey === modelHeaderRenderKey) return;') > headerSection.indexOf('updateCustomModelInputState(modelId);'),
	      'expected duplicate model header state to keep custom model input sync'
	    );
	    assert.ok(
	      headerSection.indexOf('if (nextRenderKey === modelHeaderRenderKey) return;') < headerSection.indexOf('setTextContent(modelPickerLabel, displayLabel);'),
	      'expected duplicate model header state to return before header DOM helper reads'
	    );
		    assert.match(modelChangedSection, /const changedModelHeaderState = normalizeModelHeaderState\(\{/);
		    assert.match(modelChangedSection, /const changedModelHeaderActionWasPending = reasoningEffortPending \|\|/);
		    assert.match(modelChangedSection, /getModelHeaderRenderKeyForState\(changedModelHeaderState\)/);
		    assert.strictEqual(
		      (modelChangedSection.match(/getModelHeaderRenderKeyForState\(changedModelHeaderState\)/g) || []).length,
		      1,
		      'expected modelChanged branch to build the render key once'
		    );
		    assert.match(modelChangedSection, /isModelHeaderRenderKeyCurrent\(changedModelHeaderRenderKey\)/);
		    assert.match(modelChangedSection, /updateNormalizedModelHeader\(changedModelHeaderState, changedModelHeaderRenderKey\);/);
		    assert.match(modelStateSection, /const nextModelHeaderState = normalizeModelHeaderState\(\{/);
		    assert.match(modelStateSection, /const nextModelHeaderActionWasPending = reasoningEffortPending \|\|/);
		    assert.match(modelStateSection, /getModelHeaderRenderKeyForState\(nextModelHeaderState\)/);
		    assert.strictEqual(
		      (modelStateSection.match(/getModelHeaderRenderKeyForState\(nextModelHeaderState\)/g) || []).length,
		      1,
		      'expected modelState branch to build the render key once'
		    );
		    assert.match(modelStateSection, /isModelHeaderRenderKeyCurrent\(nextModelHeaderRenderKey\)/);
		    assert.match(modelStateSection, /updateNormalizedModelHeader\(nextModelHeaderState, nextModelHeaderRenderKey\);/);
		    assert.match(bootstrapSource, /function isModelPickerStateCurrent\(picker\)/);
		    assert.match(bootstrapSource, /let\s+modelPickerSearchDisplayQuery\s*=\s*''/);
		    assert.match(bootstrapSource, /let\s+modelPickerSearchLocalQuery\s*=\s*''/);
		    assert.match(bootstrapSource, /function getModelPickerCurrentRenderKey\(picker\)/);
		    assert.match(bootstrapSource, /function modelPickerListsShareRenderableContent\(left, right\)/);
		    assert.match(bootstrapSource, /function isModelPickerListReferenceCurrent\(picker\)/);
		    assert.match(bootstrapSource, /if \(isModelPickerListReferenceCurrent\(picker\)\) return modelPickerRenderKey;/);
		    assert.match(bootstrapSource, /return getModelPickerRenderKey\(picker, currentModelId, modelPickerSearchLocalQuery\);/);
		    assert.match(bootstrapSource, /function isModelPickerRenderKeyCurrent\(renderKey\)/);
		    assert.match(bootstrapSource, /return modelPickerSearchRenderFrame === null && !!renderKey && renderKey === modelPickerRenderKey;/);
		    assert.match(bootstrapSource, /return isModelPickerRenderKeyCurrent\(getModelPickerCurrentRenderKey\(picker\)\);/);
	    assert.match(modelPickerStateSection, /const nextModelPickerState = data\.picker \|\| null;/);
	    assert.match(modelPickerStateSection, /const revealModelPickerState = data\.reveal === true;/);
	    assert.match(modelPickerStateSection, /const nextModelPickerRenderKey = typeof getModelPickerCurrentRenderKey === 'function'[\s\S]*\? getModelPickerCurrentRenderKey\(nextModelPickerState\)[\s\S]*: '';/);
	    assert.match(modelPickerStateSection, /!revealModelPickerState/);
	    assert.match(modelPickerStateSection, /typeof isModelPickerRenderKeyCurrent === 'function'/);
	    assert.match(modelPickerStateSection, /isModelPickerRenderKeyCurrent\(nextModelPickerRenderKey\)/);
	    assert.ok(
	      modelPickerStateSection.indexOf('isModelPickerRenderKeyCurrent(nextModelPickerRenderKey)') <
	        modelPickerStateSection.indexOf("clearPendingActionTimer('modelFavorite')"),
	      'expected duplicate model picker guard before clearing pending state'
	    );
	    assert.match(modelPickerStateSection, /updateModelPickerState\(nextModelPickerState, \{ reveal: revealModelPickerState, renderKey: nextModelPickerRenderKey \}\);/);
	    assert.ok(headerSection.includes('setTextContent(modelPickerLabel, displayLabel);'));
	    assert.ok(headerSection.includes('setTitle(modelPickerLabel, displayTitle);'));
	    assert.ok(headerSection.includes('setTextContent(modelPicker, displayLabel);'));
	    assert.ok(headerSection.includes('setTitle(modelPicker, displayTitle);'));
	    assert.ok(headerSection.includes("setAttributeValue(modelPicker, 'aria-label', displayLabel + ', select AI model');"));
	    assert.ok(headerSection.includes('setValue(reasoningEffortSelect, reasoningEffort);'));
	    assert.ok(headerSection.includes('setDisabled(reasoningEffortSelect, !initReceived || isProcessing || reasoningEffortPending || modelSwitchPending);'));
		    assert.ok(headerSection.includes("setTitle(reasoningEffortSelect, 'Reasoning effort: ' + reasoningLabel + ' (GPT-5/Codex models)');"));
			    assert.ok(headerSection.includes('setDisabled(modelFavoriteToggle, !currentModel || !initReceived || isProcessing || modelFavoritePending || modelSwitchPending || modelPickerRefreshPending);'));
			    assert.ok(headerSection.includes("setTextContent(modelFavoriteIcon || modelFavoriteToggle, isFavorite ? '★' : '☆');"));
		    assert.ok(headerSection.includes("const favoriteModelLabel = displayLabel || getModelDisplayText(modelId) || 'current model';"));
		    assert.ok(headerSection.includes("setTitle(modelFavoriteToggle, (isFavorite ? 'Remove from favorites: ' : 'Add to favorites: ') + favoriteModelLabel);"));
			    assert.ok(headerSection.includes("setAttributeValue(modelFavoriteToggle, 'aria-label', 'Toggle favorite model: ' + favoriteModelLabel);"));
		    assert.ok(headerSection.includes("setAttributeValue(modelFavoriteToggle, 'aria-pressed', isFavorite ? 'true' : 'false');"));
	    assert.ok(headerSection.includes('setDisabled(modelSettings, !initReceived || isProcessing || modelSwitchPending || modelFavoritePending || modelPickerRefreshPending);'));
	    assert.doesNotMatch(headerSection, /\.(?:disabled|textContent|title|value)\s*=/);
	    assert.doesNotMatch(headerSection, /\.setAttribute\('aria-(?:label|pressed)'/);
	    assert.match(customModelSection, /setValue\(customModelInput, nextModel\);/);
	    assert.match(customModelSection, /function getModelDisplayText\(value\)/);
	    assert.match(customModelSection, /text\.length <= MODEL_DISPLAY_LIMIT/);
	    assert.match(customModelSection, /text\.slice\(0, MODEL_DISPLAY_LIMIT\) \+ '…'/);
	    assert.match(customModelSection, /setTitle\(customModelLabel,/);
	    assert.match(customModelSection, /getModelDisplayText\(nextModel\)/);
	    assert.doesNotMatch(customModelSection, /\.(?:title|value)\s*=/);
	    assert.match(reasoningListenerSection, /setValue\(reasoningEffortSelect, currentReasoningEffort\);/);
	    assert.match(reasoningListenerSection, /recoverPendingAction\('reasoningEffort'/);
	    assert.doesNotMatch(reasoningListenerSection, /reasoningEffortSelect\.value\s*=/);
		  });

	  test('cached model picker open stays local', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const listenerStart = bootstrapSource.indexOf('if (modelPicker)');
	    assert.ok(listenerStart >= 0, 'expected model picker listener');
	    const listenerEnd = bootstrapSource.indexOf('if (reasoningEffortSelect)', listenerStart);
	    assert.ok(listenerEnd > listenerStart, 'expected reasoning effort listener after model picker listener');
	    const listenerSection = bootstrapSource.slice(listenerStart, listenerEnd);

	    assert.match(listenerSection, /if \(currentModelPickerState\) \{/);
	    assert.match(listenerSection, /updateModelPickerState\(currentModelPickerState, \{ reveal: true \}\);/);
	    assert.match(listenerSection, /return;/);
	    assert.ok(
	      listenerSection.indexOf('return;') < listenerSection.indexOf('modelPickerOpenPending = true'),
	      'expected cached model picker guard before pending open state'
	    );
	    assert.ok(
	      listenerSection.indexOf('return;') < listenerSection.indexOf("vscode.postMessage({ type: 'showModelPicker' })"),
	      'expected cached model picker guard before backend request'
	    );
	  });

	  test('cached tool runner open stays local', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const listenerStart = bootstrapSource.indexOf('if (runToolBtn)');
	    assert.ok(listenerStart >= 0, 'expected run tool listener');
	    const listenerEnd = bootstrapSource.indexOf('if (createToolsConfigBtn)', listenerStart);
	    assert.ok(listenerEnd > listenerStart, 'expected create tools config listener after run tool listener');
	    const listenerSection = bootstrapSource.slice(listenerStart, listenerEnd);

	    assert.match(listenerSection, /if \(currentToolsCatalog\) \{/);
	    assert.match(listenerSection, /updateToolsCatalogState\(currentToolsCatalog, \{ reveal: true \}\);/);
	    assert.match(listenerSection, /return;/);
	    assert.ok(
	      listenerSection.indexOf('return;') < listenerSection.indexOf('toolsCatalogRequestPending = true'),
	      'expected cached tool runner guard before pending catalog state'
	    );
	    assert.ok(
	      listenerSection.indexOf('return;') < listenerSection.indexOf("vscode.postMessage({ type: 'runTool' })"),
	      'expected cached tool runner guard before backend request'
	    );
	  });

	  test('provider auth header updates use cached class toggles', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const renderKeyStart = contextSource.indexOf('function getProviderAuthHeaderRenderKey');
	    assert.ok(renderKeyStart >= 0, 'expected provider auth render-key helper');
	    const renderKeyEnd = contextSource.indexOf('function providerAuthStatesEqual', renderKeyStart);
	    assert.ok(renderKeyEnd > renderKeyStart, 'expected provider auth equality helper after render-key helper');
	    const renderKeySection = contextSource.slice(renderKeyStart, renderKeyEnd);
		    const headerStart = contextSource.indexOf('function updateNormalizedProviderAuthHeader');
		    assert.ok(headerStart >= 0, 'expected normalized provider auth header update helper');
	    const visibilityHelperStart = contextSource.indexOf('function setProviderAuthGroupVisible', renderKeyEnd);
	    assert.ok(visibilityHelperStart > renderKeyEnd, 'expected provider auth visibility helper after equality helper');
	    assert.ok(visibilityHelperStart < headerStart, 'expected provider auth visibility helpers before header update');
	    const visibilityHelperSection = contextSource.slice(visibilityHelperStart, headerStart);
	    const headerEnd = contextSource.indexOf('function formatInt', headerStart);
	    assert.ok(headerEnd > headerStart, 'expected format helper after provider auth header helper');
	    const headerSection = contextSource.slice(headerStart, headerEnd);

	    assert.match(contextSource, /let providerAuthRenderKey = '';/);
	    assert.match(contextSource, /let providerAuthGroupVisible = false;/);
	    assert.match(contextSource, /let providerAuthPrimaryConnected = false;/);
	    assert.match(contextSource, /let providerAuthSecondaryVisible = null;/);
	    assert.match(contextSource, /const PROVIDER_AUTH_DISPLAY_LIMIT = 160;/);
		    assert.match(renderKeySection, /const key = createCompactRenderKeyBuilder\(\);/);
		    assert.match(renderKeySection, /appendCompactContextRenderKeyPart\(key, state\.providerId\);/);
		    assert.match(renderKeySection, /appendCompactContextRenderKeyPart\(key, state\.secondaryActionLabel\);/);
		    assert.match(renderKeySection, /appendCompactContextRenderKeyPart\(key, providerAuthBusy \? '1' : '0'\);/);
		    assert.match(renderKeySection, /return finishCompactRenderKey\(key\);/);
		    assert.doesNotMatch(contextSource, /function appendProviderAuthRenderKeyPart\(/);
		    assert.match(contextSource, /function getProviderAuthDisplayText\(value\)/);
		    assert.match(contextSource, /text\.length <= PROVIDER_AUTH_DISPLAY_LIMIT/);
		    assert.match(headerSection, /function updateNormalizedProviderAuthHeader\(nextProviderAuth, renderKey\)/);
		    assert.match(headerSection, /currentProviderAuth = nextProviderAuth;/);
		    assert.match(headerSection, /const nextRenderKey = typeof renderKey === 'string' && renderKey \? renderKey : getProviderAuthHeaderRenderKey\(currentProviderAuth\);/);
		    assert.match(headerSection, /if \(nextRenderKey === providerAuthRenderKey\) return;/);
	    assert.ok(
	      headerSection.indexOf('if (nextRenderKey === providerAuthRenderKey) return;') < headerSection.indexOf('setProviderAuthGroupVisible(visible);'),
	      'expected duplicate provider auth state to return before DOM helper reads'
	    );
	    assert.match(visibilityHelperSection, /function setProviderAuthGroupVisible\(visible\) \{[\s\S]*if \(providerAuthGroupVisible === visibleFlag\) return;[\s\S]*providerAuthGroupVisible = visibleFlag;[\s\S]*providerAuthGroup\.classList\.toggle\('hidden', !visibleFlag\);[\s\S]*\}/);
	    assert.match(visibilityHelperSection, /function setProviderAuthPrimaryConnected\(connected\) \{[\s\S]*if \(providerAuthPrimaryConnected === connectedFlag\) return;[\s\S]*providerAuthPrimaryConnected = connectedFlag;[\s\S]*providerAuthPrimary\.classList\.toggle\('connected', connectedFlag\);[\s\S]*\}/);
	    assert.match(visibilityHelperSection, /function setProviderAuthSecondaryVisible\(visible\) \{[\s\S]*if \(providerAuthSecondaryVisible === visibleFlag\) return;[\s\S]*providerAuthSecondaryVisible = visibleFlag;[\s\S]*providerAuthSecondary\.classList\.toggle\('hidden', !visibleFlag\);[\s\S]*\}/);
	    assert.doesNotMatch(visibilityHelperSection, /setHidden\(providerAuth(?:Group|Secondary)/);
	    assert.doesNotMatch(visibilityHelperSection, /setClassPresence\(providerAuthPrimary/);
	    assert.ok(headerSection.includes('setProviderAuthGroupVisible(visible);'));
		    assert.ok(headerSection.includes('setTextContent(providerAuthPrimary, primaryLabel);'));
		    assert.ok(headerSection.includes('setTitle(providerAuthPrimary, title);'));
		    assert.match(headerSection, /const rawPrimaryLabel = providerAuthBusy/);
		    assert.match(headerSection, /const primaryLabel = getProviderAuthDisplayText\(rawPrimaryLabel\);/);
		    assert.match(headerSection, /const providerName = getProviderAuthDisplayText\(currentProviderAuth\.providerName\);/);
		    assert.match(headerSection, /const providerDetail = getProviderAuthDisplayText\(currentProviderAuth\.detail\);/);
		    assert.match(headerSection, /let title = primaryLabel;/);
		    assert.match(headerSection, /title = providerName;/);
		    assert.match(headerSection, /title \+= ' • ' \+ providerDetail;/);
		    assert.ok(headerSection.includes('const providerAccountLabel = providerName'));
		    assert.ok(headerSection.includes("setAttributeValue(providerAuthPrimary, 'aria-label', providerAccountLabel);"));
		    assert.doesNotMatch(headerSection, /Provider account:|Sign in to/);
		    assert.doesNotMatch(headerSection, /detailParts/);
		    assert.doesNotMatch(headerSection, /\.join\(' • '\)/);
		    assert.ok(headerSection.includes('setProviderAuthPrimaryConnected(connected);'));
		    assert.match(headerSection, /const secondaryLabel = getProviderAuthDisplayText\(currentProviderAuth\.secondaryActionLabel \|\| 'Disconnect'\);/);
		    assert.ok(headerSection.includes('setTextContent(providerAuthSecondary, secondaryLabel);'));
		    assert.ok(headerSection.includes('setTitle(providerAuthSecondary, secondaryTitle);'));
		    assert.ok(headerSection.includes("setAttributeValue(providerAuthSecondary, 'aria-label', secondaryTitle);"));
		    assert.ok(headerSection.includes('setProviderAuthSecondaryVisible(connected);'));
		    assert.doesNotMatch(headerSection, /setHidden\(providerAuthGroup, !visible\);/);
		    assert.doesNotMatch(headerSection, /setClassPresence\(providerAuthPrimary, 'connected', connected\);/);
			    assert.doesNotMatch(headerSection, /setHidden\(providerAuthSecondary, !connected\);/);
		    assert.doesNotMatch(headerSection, /\.(?:textContent|title)\s*=/);
		    assert.doesNotMatch(headerSection, /\.setAttribute\('aria-label'/);
		    assert.doesNotMatch(headerSection, /classList\.(?:add|remove|toggle)\(/);
		    assert.match(contextSource, /function updateProviderAuthHeader\(state, renderKey\)/);
		    assert.match(contextSource, /updateNormalizedProviderAuthHeader\(normalizeProviderAuthState\(state\), renderKey\);/);
		  });

	  test('provider auth operation and skills control state updates avoid duplicate property writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const operationStart = bootstrapSource.indexOf('function updateOperationBanner');
	    assert.ok(operationStart >= 0, 'expected operation banner helper');
	    const operationEnd = bootstrapSource.indexOf('function updateApprovalBanner', operationStart);
	    assert.ok(operationEnd > operationStart, 'expected approval banner helper after operation banner helper');
	    const operationSection = bootstrapSource.slice(operationStart, operationEnd);
	    const controlsStart = bootstrapSource.indexOf('const canAuthenticate');
	    assert.ok(controlsStart >= 0, 'expected provider auth controls section');
	    const controlsEnd = bootstrapSource.indexOf('function findSessionOptionById', controlsStart);
	    assert.ok(controlsEnd > controlsStart, 'expected session option helper after provider auth operation and skills controls');
	    const controlsSection = bootstrapSource.slice(controlsStart, controlsEnd);

	    assert.match(operationSection, /setDisabled\(operationStopBtn, !initReceived \|\| !isProcessing \|\| abortRequestPending \|\| status !== 'running'\);/);
	    assert.doesNotMatch(operationSection, /operationStopBtn\.disabled\s*=/);
	    assert.match(controlsSection, /const canAuthenticate =/);
	    assert.match(controlsSection, /const providerAuthPrimaryConnected = !!\(currentProviderAuth && currentProviderAuth\.authenticated\);/);
	    assert.match(controlsSection, /setDisabled\(providerAuthPrimary, providerAuthPrimaryConnected \|\| !canAuthenticate\);/);
	    assert.match(controlsSection, /const canDisconnect =/);
	    assert.match(controlsSection, /setDisabled\(providerAuthSecondary, !canDisconnect\);/);
	    assert.doesNotMatch(controlsSection, /providerAuthPrimary\.classList\.contains\('connected'\)/);
	    assert.match(controlsSection, /setDisabled\(\s*operationStopBtn,/);
	    assert.match(controlsSection, /setDisabled\(skillsToggle, skillsEnabledDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(skillsToggleLabel, skillsEnabledDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(skillsSettings, skillsSettingsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(skillsMaxPromptInput, skillsSettingsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(skillsMaxInjectInput, skillsSettingsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(skillsMaxInjectCharsInput, skillsSettingsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(skillSearchPathsInput, skillsSettingsDisabled\);/);
	    assert.match(controlsSection, /setDisabledClass\(skillSearchPathsLabel, skillsSettingsDisabled\);/);
	    assert.match(controlsSection, /setDisabled\(skillsSettingsApply, skillsSettingsDisabled\);/);
	    assert.doesNotMatch(controlsSection, /\.(?:disabled)\s*=/);
	    assert.doesNotMatch(controlsSection, /classList\.toggle\('disabled'/);
	  });

	  test('skills settings state updates avoid duplicate checked value and title writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const enabledStart = bootstrapSource.indexOf('function updateSkillsEnabledState');
    assert.ok(enabledStart >= 0, 'expected skills enabled helper');
    const enabledEnd = bootstrapSource.indexOf('function normalizeSkillSearchPaths', enabledStart);
    assert.ok(enabledEnd > enabledStart, 'expected normalize helper after skills enabled helper');
    const enabledSection = bootstrapSource.slice(enabledStart, enabledEnd);
    const pathsTitleStart = bootstrapSource.indexOf('function getSkillSearchPathsTitleDisplayText', enabledEnd);
    assert.ok(pathsTitleStart > enabledEnd, 'expected skill search paths title helper after path normalizer');
    const titleStart = bootstrapSource.indexOf('function updateSkillsSettingsTitle', pathsTitleStart);
    assert.ok(titleStart > pathsTitleStart, 'expected skills settings title helper after skill search paths title helper');
    const pathsTitleSection = bootstrapSource.slice(pathsTitleStart, titleStart);
	    const pathsStart = bootstrapSource.indexOf('function updateNormalizedSkillSearchPathsState', titleStart);
	    assert.ok(pathsStart > titleStart, 'expected normalized skill paths helper after skills title helper');
	    const titleSection = bootstrapSource.slice(titleStart, pathsStart);
	    const budgetStart = bootstrapSource.indexOf('function normalizeSkillsBudget', pathsStart);
	    assert.ok(budgetStart > pathsStart, 'expected skills budget helper after paths helper');
	    const pathsSection = bootstrapSource.slice(pathsStart, budgetStart);
    const budgetEnd = bootstrapSource.indexOf('function setAvailableSkills', budgetStart);
    assert.ok(budgetEnd > budgetStart, 'expected available skills helper after budget helper');
    const budgetSection = bootstrapSource.slice(budgetStart, budgetEnd);
	    const listenerStart = bootstrapSource.indexOf('if (skillsToggle) {', bootstrapSource.indexOf('if (inputAttachments)'));
	    assert.ok(listenerStart >= 0, 'expected skills toggle listener');
	    const listenerEnd = bootstrapSource.indexOf('function closeSkillsSettingsPopover', listenerStart);
	    assert.ok(listenerEnd > listenerStart, 'expected skills popover helper after skills toggle listener');
	    const listenerSection = bootstrapSource.slice(listenerStart, listenerEnd);
	    const searchApplyStart = bootstrapSource.indexOf('function applySkillSearchPaths', listenerEnd);
	    assert.ok(searchApplyStart > listenerEnd, 'expected skill search paths apply helper after skills popover helpers');
	    const budgetApplyStart = bootstrapSource.indexOf('function applySkillsBudget', searchApplyStart);
	    assert.ok(budgetApplyStart > searchApplyStart, 'expected skills budget apply helper after search paths apply helper');
	    const searchApplySection = bootstrapSource.slice(searchApplyStart, budgetApplyStart);
		    const budgetApplyEnd = bootstrapSource.indexOf('if (skillsSettings)', budgetApplyStart);
		    assert.ok(budgetApplyEnd > budgetApplyStart, 'expected skills settings listener after skills budget apply helper');
		    const budgetApplySection = bootstrapSource.slice(budgetApplyStart, budgetApplyEnd);
		    const skillsEnabledStateStart = mainSource.indexOf("case 'skillsEnabledState':");
		    assert.ok(skillsEnabledStateStart >= 0, 'expected skills enabled state branch');
		    const skillSearchPathsStateStart = mainSource.indexOf("case 'skillSearchPathsState':", skillsEnabledStateStart);
		    assert.ok(skillSearchPathsStateStart > skillsEnabledStateStart, 'expected skill-search-paths branch after skills enabled branch');
		    const skillsEnabledStateSection = mainSource.slice(skillsEnabledStateStart, skillSearchPathsStateStart);
		    const skillsBudgetStateStart = mainSource.indexOf("case 'skillsBudgetState':", skillSearchPathsStateStart);
		    assert.ok(skillsBudgetStateStart > skillSearchPathsStateStart, 'expected skills budget branch after skill-search-paths branch');
		    const skillSearchPathsStateSection = mainSource.slice(skillSearchPathsStateStart, skillsBudgetStateStart);
		    const skillsBudgetStateEnd = mainSource.indexOf("case 'modeChanged':", skillsBudgetStateStart);
		    assert.ok(skillsBudgetStateEnd > skillsBudgetStateStart, 'expected mode branch after skills budget branch');
		    const skillsBudgetStateSection = mainSource.slice(skillsBudgetStateStart, skillsBudgetStateEnd);

    assert.match(bootstrapSource, /function\s+setChecked\(/);
    assert.match(enabledSection, /setChecked\(skillsToggle, skillsEnabled\);/);
    assert.match(enabledSection, /setTitle\(skillsToggleLabel, skillsEnabled/);
	    assert.match(titleSection, /setTitle\(skillsSettings, 'Skills: ' \+ pathText/);
	    assert.match(pathsSection, /function updateNormalizedSkillSearchPathsState\(paths\)/);
	    assert.match(pathsSection, /function updateSkillSearchPathsState\(paths\)/);
	    assert.match(pathsSection, /updateNormalizedSkillSearchPathsState\(normalizeSkillSearchPaths\(paths\)\);/);
		    assert.ok(pathsSection.includes("setValue(skillSearchPathsInput, skillSearchPaths.join('\\n'));"));
	    assert.match(pathsSection, /setTitle\(skillSearchPathsInput, skillSearchPaths\.length/);
	    assert.match(bootstrapSource, /const SKILL_SEARCH_PATHS_TITLE_DISPLAY_LIMIT = 240;/);
	    assert.match(pathsTitleSection, /function getSkillSearchPathsTitleDisplayText\(paths\)/);
	    assert.match(pathsTitleSection, /formatCommaSeparatedList\(paths\)/);
	    assert.match(pathsTitleSection, /value\.length <= SKILL_SEARCH_PATHS_TITLE_DISPLAY_LIMIT/);
	    assert.match(pathsTitleSection, /value\.slice\(0, SKILL_SEARCH_PATHS_TITLE_DISPLAY_LIMIT\) \+ '…'/);
	    assert.match(pathsSection, /setTitle\(skillSearchPathsLabel, skillSearchPaths\.length/);
	    assert.match(pathsSection, /getSkillSearchPathsTitleDisplayText\(skillSearchPaths\)/);
	    assert.match(budgetSection, /setValue\(skillsMaxPromptInput, skillsBudget\.maxPromptSkills\);/);
	    assert.match(budgetSection, /setValue\(skillsMaxInjectInput, skillsBudget\.maxInjectSkills\);/);
	    assert.match(budgetSection, /setValue\(skillsMaxInjectCharsInput, skillsBudget\.maxInjectChars\);/);
	    assert.match(budgetSection, /function updateNormalizedSkillsBudgetState\(budget\)/);
	    assert.match(budgetSection, /function updateSkillsBudgetState\(budget\)/);
	    assert.match(budgetSection, /updateNormalizedSkillsBudgetState\(normalizeSkillsBudget\(budget\)\);/);
	    assert.match(listenerSection, /setChecked\(skillsToggle, skillsEnabled\);/);
	    assert.match(searchApplySection, /if \(stringListsEqual\(paths, skillSearchPaths\)\) \{/);
		    assert.match(searchApplySection, /hasListItemLongerThan\(paths, 240\)/);
		    assert.match(searchApplySection, /updateNormalizedSkillSearchPathsState\(skillSearchPaths\);/);
		    assert.doesNotMatch(searchApplySection, /\.some\(/);
	    assert.ok(
	      searchApplySection.indexOf('stringListsEqual(paths, skillSearchPaths)') < searchApplySection.indexOf('postSettingWithPendingState('),
	      'expected unchanged skill-search-path guard before posting'
	    );
		    assert.match(budgetApplySection, /const budgetChanged = !skillsBudgetsEqual\(budget, skillsBudget\);/);
		    assert.match(budgetApplySection, /const pathsChanged = !stringListsEqual\(paths, skillSearchPaths\);/);
		    assert.match(budgetApplySection, /if \(!budgetChanged && !pathsChanged\) \{/);
		    assert.match(budgetApplySection, /hasListItemLongerThan\(paths, 240\)/);
		    assert.doesNotMatch(budgetApplySection, /\.some\(/);
		    assert.match(bootstrapSource, /function normalizeSkillsBudget\(budget\) \{/);
		    assert.match(bootstrapSource, /function setAvailableSkillsFromNormalized\(next\) \{/);
		    assert.match(skillsEnabledStateSection, /const nextSkillsEnabled = data\.skillsEnabled !== false;/);
		    assert.match(skillsEnabledStateSection, /const nextSkillsEnabledAvailableSkills = normalizeAvailableSkills\(Array\.isArray\(data\.skills\) \? data\.skills : \[\]\);/);
		    assert.match(skillsEnabledStateSection, /skillsEnabled === nextSkillsEnabled/);
		    assert.match(skillsEnabledStateSection, /nextSkillsEnabledAvailableSkills\.key === availableSkillsKey/);
		    assert.match(skillsEnabledStateSection, /setAvailableSkillsFromNormalized\(nextSkillsEnabledAvailableSkills\)/);
		    assert.match(skillSearchPathsStateSection, /const nextSkillSearchPaths = normalizeSkillSearchPaths\(data\.skillSearchPaths \|\| \[\]\);/);
		    assert.match(skillSearchPathsStateSection, /const nextSkillSearchPathsAvailableSkills = normalizeAvailableSkills\(Array\.isArray\(data\.skills\) \? data\.skills : \[\]\);/);
		    assert.match(skillSearchPathsStateSection, /stringListsEqual\(nextSkillSearchPaths, skillSearchPaths\)/);
		    assert.match(skillSearchPathsStateSection, /nextSkillSearchPathsAvailableSkills\.key === availableSkillsKey/);
		    assert.match(skillSearchPathsStateSection, /updateNormalizedSkillSearchPathsState\(nextSkillSearchPaths\);/);
		    assert.match(skillSearchPathsStateSection, /setAvailableSkillsFromNormalized\(nextSkillSearchPathsAvailableSkills\)/);
		    assert.doesNotMatch(skillsEnabledStateSection + skillSearchPathsStateSection, /availableSkillsEqual\(/);
		    assert.match(skillsBudgetStateSection, /const nextSkillsBudget = normalizeSkillsBudget\(data\.skillsBudget \|\| \{\}\);/);
		    assert.match(skillsBudgetStateSection, /if \(!hasPendingSettingState\('skillsBudgetState'\) && skillsBudgetsEqual\(nextSkillsBudget, skillsBudget\)\) break;/);
		    assert.match(skillsBudgetStateSection, /updateNormalizedSkillsBudgetState\(nextSkillsBudget\);/);
		    assert.ok(
		      budgetApplySection.indexOf('!budgetChanged && !pathsChanged') < budgetApplySection.indexOf('postSettingsWithPendingStates('),
	      'expected unchanged skills settings guard before posting'
	    );
		    assert.doesNotMatch(enabledSection + listenerSection, /skillsToggle\.checked\s*=/);
		    assert.doesNotMatch(enabledSection + titleSection + pathsSection, /\.title\s*=/);
		    assert.doesNotMatch(pathsSection, /\.join\(', '\)/);
	    assert.doesNotMatch(pathsSection + budgetSection, /\.(?:value)\s*=/);
	  });

	  test('generation settings state updates avoid duplicate value checked and title writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const updateStart = bootstrapSource.indexOf('function updateNormalizedGenerationSettingsState');
    assert.ok(updateStart >= 0, 'expected normalized generation settings state helper');
    const updateEnd = bootstrapSource.indexOf('function closeModelSettingsPopover', updateStart);
    assert.ok(updateEnd > updateStart, 'expected model settings close helper after generation settings state helper');
    const updateSection = bootstrapSource.slice(updateStart, updateEnd);
    const applyStart = bootstrapSource.indexOf('function applyGenerationSettings');
    assert.ok(applyStart >= 0, 'expected generation settings apply helper');
	    const applyEnd = bootstrapSource.indexOf('function updateCustomModelInputState', applyStart);
	    assert.ok(applyEnd > applyStart, 'expected custom model helper after generation settings apply helper');
	    const applySection = bootstrapSource.slice(applyStart, applyEnd);
	    const generationSettingsStateStart = mainSource.indexOf("case 'generationSettingsState':");
	    assert.ok(generationSettingsStateStart >= 0, 'expected generation settings state branch');
	    const generationSettingsStateEnd = mainSource.indexOf("case 'skillsEnabledState':", generationSettingsStateStart);
	    assert.ok(generationSettingsStateEnd > generationSettingsStateStart, 'expected skills branch after generation settings branch');
	    const generationSettingsStateSection = mainSource.slice(generationSettingsStateStart, generationSettingsStateEnd);

	    assert.match(bootstrapSource, /function normalizeGenerationSettings\(settings\) \{/);
	    assert.match(bootstrapSource, /function currentGenerationSettings\(\) \{/);
	    assert.match(bootstrapSource, /function generationSettingsEqual\(left, right\) \{/);
	    assert.match(bootstrapSource, /function updateGenerationSettingsState\(settings\) \{/);
	    assert.match(bootstrapSource, /updateNormalizedGenerationSettingsState\(normalizeGenerationSettings\(settings\)\);/);
	    assert.match(updateSection, /setValue\(temperatureInput, generationTemperature\);/);
    assert.match(updateSection, /setValue\(topPInput, generationTopP\);/);
    assert.match(updateSection, /setTitle\(topPLabel, generationTopP > 0/);
    assert.match(updateSection, /setValue\(topKInput, generationTopK\);/);
    assert.match(updateSection, /setTitle\(topKLabel, generationTopK > 0/);
    assert.match(updateSection, /setValue\(maxOutputTokensInput, generationMaxOutputTokens\);/);
    assert.match(updateSection, /setValue\(maxIterationsInput, generationMaxIterations\);/);
    assert.match(updateSection, /setValue\(textVerbositySelect, generationTextVerbosity\);/);
    assert.match(updateSection, /setTitle\(textVerbosityLabel, generationTextVerbosity/);
    assert.match(updateSection, /setValue\(maxRetriesInput, generationMaxRetries\);/);
    assert.match(updateSection, /setValue\(llmTimeoutInput, generationTimeoutMs\);/);
    assert.match(updateSection, /setChecked\(retryWithPartialOutputToggle, generationRetryWithPartialOutput\);/);
    assert.match(updateSection, /setTitle\(retryWithPartialOutputLabel, generationRetryWithPartialOutput/);
    assert.match(updateSection, /setTitle\(modelSettings, 'Generation settings: temperature '/);
    assert.match(applySection, /const normalizedTemperature = Math\.round\(temperature \* 100\) \/ 100;/);
    assert.match(applySection, /const normalizedTopP = Math\.round\(topP \* 1000\) \/ 1000;/);
    assert.match(applySection, /const normalizedSettings =|const settings = \{/);
    assert.match(applySection, /normalizedTemperature === generationTemperature/);
	    assert.match(applySection, /normalizedTimeoutMs === generationTimeoutMs/);
		    assert.match(applySection, /updateNormalizedGenerationSettingsState\(currentSettings\);/);
		    assert.match(applySection, /postSettingWithPendingState\(/);
			    assert.match(generationSettingsStateSection, /const nextGenerationSettings = normalizeGenerationSettings\(data\.generationSettings \|\| \{\}\);/);
			    assert.match(generationSettingsStateSection, /generationSettingsEqual\(nextGenerationSettings, currentGenerationSettings\(\)\)/);
			    assert.match(generationSettingsStateSection, /updateNormalizedGenerationSettingsState\(nextGenerationSettings\);/);
		    assert.doesNotMatch(updateSection, /\.(?:value|checked|title)\s*=/);
	    assert.ok(
	      applySection.indexOf('normalizedTemperature === generationTemperature') < applySection.indexOf('postSettingWithPendingState('),
      'expected unchanged generation settings guard before posting'
    );
  });

  test('generation settings backend skips unchanged writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const helperStart = source.indexOf('function generationSettingsEqual');
    assert.ok(helperStart >= 0, 'expected generation settings equality helper');
    const helperEnd = source.indexOf('function getMemoryAutoRecallEnabled', helperStart);
    assert.ok(helperEnd > helperStart, 'expected memory settings helper after generation settings equality helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const methodStart = source.indexOf('async setGenerationSettings');
    assert.ok(methodStart >= 0, 'expected setGenerationSettings method');
    const methodEnd = source.indexOf('async authenticateProvider', methodStart);
    assert.ok(methodEnd > methodStart, 'expected provider auth method after setGenerationSettings');
    const methodSection = source.slice(methodStart, methodEnd);

    assert.match(helperSection, /left\.temperature === right\.temperature/);
    assert.match(helperSection, /left\.textVerbosity === right\.textVerbosity/);
    assert.match(methodSection, /const normalizedSettings: GenerationSettings = \{/);
    assert.match(methodSection, /if \(generationSettingsEqual\(normalizedSettings, currentSettings\)\) \{/);
    assert.match(methodSection, /this\.postMessage\(\{ type: 'generationSettingsState', generationSettings: currentSettings \}\);/);
    assert.match(methodSection, /config\.update\('temperature', normalizedSettings\.temperature, true\);/);
    assert.ok(
      methodSection.indexOf('generationSettingsEqual(normalizedSettings, currentSettings)') < methodSection.indexOf("config.update('temperature'"),
      'expected unchanged generation settings guard before config writes'
    );
  });

  test('model limits backend skips unchanged writes before config update', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const helperStart = source.indexOf('function modelLimitsEqual');
    assert.ok(helperStart >= 0, 'expected model limits equality helper');
    const helperEnd = source.indexOf('function getNumberSetting', helperStart);
    assert.ok(helperEnd > helperStart, 'expected numeric settings helper after model limits equality helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const methodStart = source.indexOf('async setModelLimits');
    assert.ok(methodStart >= 0, 'expected setModelLimits method');
    const methodEnd = source.indexOf('async setGenerationSettings', methodStart);
    assert.ok(methodEnd > methodStart, 'expected generation settings method after setModelLimits');
    const methodSection = source.slice(methodStart, methodEnd);

    assert.match(helperSection, /countOwnEnumerableKeys\(left\) !== countOwnEnumerableKeys\(right\)/);
    assert.match(helperSection, /leftEntry\.context !== rightEntry\.context/);
    assert.match(helperSection, /leftEntry\.output !== rightEntry\.output/);
    assert.match(methodSection, /const current = getModelLimits\(\);/);
    assert.match(methodSection, /const next = normalizeModelLimits\(limits\);/);
    assert.match(methodSection, /if \(modelLimitsEqual\(next, current\)\) \{/);
    assert.match(methodSection, /this\.postMessage\(\{ type: 'modelLimitsState', modelLimits: current \}\);/);
    assert.ok(
      methodSection.indexOf('modelLimitsEqual(next, current)') < methodSection.indexOf("update('modelLimits'"),
      'expected unchanged model limits guard before config writes'
    );
  });

  test('sessions persist backend skips unchanged writes and refreshes before config update', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const methodStart = source.indexOf('async setSessionsPersist');
    assert.ok(methodStart >= 0, 'expected setSessionsPersist method');
    const methodEnd = source.indexOf('async setSessionRetentionLimits', methodStart);
    assert.ok(methodEnd > methodStart, 'expected session retention method after setSessionsPersist');
    const methodSection = source.slice(methodStart, methodEnd);

    assert.match(methodSection, /const next = !!enabled;/);
    assert.match(methodSection, /const current = getSessionsPersistEnabled\(\);/);
    assert.match(methodSection, /if \(next === current\) \{/);
    assert.match(methodSection, /this\.postMessage\(\{ type: 'sessionsPersistState', sessionsPersist: current \}\);/);
    assert.match(methodSection, /update\('sessions\.persist', next, true\)/);
    assert.ok(
      methodSection.indexOf('next === current') < methodSection.indexOf("update('sessions.persist'"),
      'expected unchanged sessions persistence guard before config write'
    );
    assert.ok(
      methodSection.indexOf('next === current') < methodSection.indexOf('this.onSessionPersistenceConfigChanged()'),
      'expected unchanged sessions persistence guard before persistence refresh'
    );
  });

  test('session retention backend skips unchanged writes and refreshes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const helperStart = source.indexOf('function getSessionRetentionLimits');
    assert.ok(helperStart >= 0, 'expected session retention state helper');
    const helperEnd = source.indexOf('type ToolRuntimeLimits', helperStart);
    assert.ok(helperEnd > helperStart, 'expected tool runtime limits type after session retention helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const methodStart = source.indexOf('async setSessionRetentionLimits');
    assert.ok(methodStart >= 0, 'expected setSessionRetentionLimits method');
    const methodEnd = source.indexOf('async setShowThinking', methodStart);
    assert.ok(methodEnd > methodStart, 'expected show-thinking method after setSessionRetentionLimits');
    const methodSection = source.slice(methodStart, methodEnd);

    assert.match(helperSection, /maxSessions: getSessionsMaxSessions\(\)/);
    assert.match(helperSection, /maxSessionBytes: getSessionsMaxSessionBytes\(\)/);
    assert.match(methodSection, /const current = getSessionRetentionLimits\(\);/);
    assert.match(methodSection, /const normalized: SessionRetentionLimits = \{/);
    assert.match(methodSection, /normalized\.maxSessions === current\.maxSessions && normalized\.maxSessionBytes === current\.maxSessionBytes/);
    assert.match(methodSection, /sessionsMaxSessions: current\.maxSessions/);
    assert.ok(
      methodSection.indexOf('normalized.maxSessions === current.maxSessions') < methodSection.indexOf("config.update('sessions.maxSessions'"),
      'expected unchanged session retention guard before config writes'
    );
    assert.ok(
      methodSection.indexOf('normalized.maxSessions === current.maxSessions') < methodSection.indexOf('this.onSessionPersistenceConfigChanged()'),
      'expected unchanged session retention guard before persistence refresh'
    );
  });

  test('simple webview settings backend skips unchanged default writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const methodSection = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };
    const booleanCases = [
      ['async setPlanFirst', 'async setAutoApprove', 'getPlanFirstEnabled', "update('planFirst', next, true)", 'planFirst: current'],
      ['async setAutoApprove', 'async setAllowExternalPaths', 'getAutoApproveEnabled', "update('autoApprove', next, true)", 'autoApprove: current'],
      [
        'async setAllowExternalPaths',
        'async setBlockGitPush',
        'getAllowExternalPathsEnabled',
        "update('security.allowExternalPaths', next, true)",
        'allowExternalPaths: current',
      ],
	      ['async setBlockGitPush', 'async setDebugSettings', 'getBlockGitPushEnabled', "update('security.blockGitPush', next, true)", 'blockGitPush: current'],
	      ['async setSkillsEnabled', 'async setSkillSearchPaths', 'getSkillsEnabled', "update('skills.enabled', next, true)", 'skillsEnabled: current'],
	      ['async setShowThinking', 'async setMemoriesFeatureEnabled', 'getShowThinkingEnabled', "update('showThinking', next, true)", 'showThinking: current'],
      [
        'async setMemoriesFeatureEnabled',
        'async setMemoryAutoRecall',
        'getMemoriesFeatureEnabled',
        "update('features.memories', next, true)",
        'memoriesFeatureEnabled: current',
      ],
      [
        'async setMemoryAutoRecall',
        'async setMemoryAutoRecallBudget',
        'getMemoryAutoRecallEnabled',
        "update('memories.autoRecall', next, true)",
        'memoryAutoRecall: current',
	      ],
	      [
	        'async setExplorePrepass',
	        'async setExplorePrepassMaxChars',
	        'getExplorePrepassEnabled',
	        "update('subagents.explorePrepass.enabled', next, true)",
	        'explorePrepass: current',
	      ],
	      ['async setAutoCompaction', 'async setCompactionPruneSettings', 'getAutoCompactionEnabled', "update('compaction.auto', next, true)", 'autoCompaction: current'],
	    ];

    for (const [startText, endText, getter, updateCall, stateFragment] of booleanCases) {
      const section = methodSection(startText, endText);
      assert.match(section, /const next = !!enabled;/);
      assert.match(section, new RegExp(`const current = ${getter}\\(\\);`));
      assert.match(section, /if \(next === current\) \{/);
      assert.ok(section.includes(stateFragment), `expected unchanged state post for ${startText}`);
      assert.ok(
        section.indexOf('next === current') < section.indexOf(updateCall),
        `expected unchanged guard before config write for ${startText}`
      );
    }

    const compactionModeSection = methodSection('async setCompactionToolOutputMode', 'async setModelLimits');
    assert.match(compactionModeSection, /const current = getCompactionToolOutputMode\(\);/);
    assert.match(compactionModeSection, /if \(normalized === current\) \{/);
    assert.match(compactionModeSection, /compactionToolOutputMode: current/);
    assert.ok(
      compactionModeSection.indexOf('normalized === current') < compactionModeSection.indexOf("update('compaction.toolOutputMode'"),
      'expected unchanged guard before tool-output compaction config write'
    );
  });

  test('diagnostics and plugin settings backend skip unchanged grouped writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const debugHelpers = section('function debugSettingsEqual', 'function normalizePluginSpecs');
    const pluginHelpers = section('function pluginSettingsEqual', 'function normalizeOpenAICompatibleText');
    const debugSection = section('async setDebugSettings', 'async setPluginSettings');
    const pluginSection = section('async setPluginSettings', 'async setToolRuntimeLimits');

    assert.match(debugHelpers, /left\.details === right\.details/);
    assert.match(debugHelpers, /left\.plugins === right\.plugins/);
    assert.match(pluginHelpers, /left\.autoDiscover === right\.autoDiscover/);
    assert.match(pluginHelpers, /stringListsEqual\(left\.plugins, right\.plugins\)/);

    assert.match(debugSection, /const current = getDebugSettingsForUi\(\);/);
    assert.match(debugSection, /const normalized = normalizeDebugSettings\(settings, current\);/);
    assert.match(debugSection, /if \(debugSettingsEqual\(normalized, current\)\) \{/);
    assert.match(debugSection, /debugSettings: current/);
    assert.ok(
      debugSection.indexOf('debugSettingsEqual(normalized, current)') < debugSection.indexOf("config.update('debug.details'"),
      'expected unchanged diagnostics guard before config writes'
    );

    assert.match(pluginSection, /const current = getPluginSettings\(\);/);
    assert.match(pluginSection, /if \(pluginSettingsEqual\(next, current\)\) \{/);
    assert.match(pluginSection, /pluginSettings: current/);
    assert.ok(
      pluginSection.indexOf('pluginSettingsEqual(next, current)') < pluginSection.indexOf("config.update('plugins'"),
      'expected unchanged plugin guard before config writes'
    );
  });

  test('provider settings backend skips unchanged writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const helpers = section('function stringRecordEqual', 'function getCodexSubscriptionSettings');
    const openAISection = section('async setOpenAICompatibleSettings', 'async setCodexSubscriptionSettings');
    const codexSection = section('async setCodexSubscriptionSettings', 'async setPlanFirst');

    assert.match(helpers, /countOwnEnumerableKeys\(left\) !== countOwnEnumerableKeys\(right\)/);
    assert.match(helpers, /left\.baseURL === right\.baseURL/);
    assert.match(helpers, /left\.allowInsecureTLS === right\.allowInsecureTLS/);
    assert.match(helpers, /stringRecordEqual\(left\.modelDisplayNames, right\.modelDisplayNames\)/);

    assert.match(openAISection, /const current = getOpenAICompatibleSettings\(\);/);
    assert.match(openAISection, /if \(openAICompatibleSettingsEqual\(next, current\)\) \{/);
    assert.match(openAISection, /openAICompatibleSettings: current/);
    assert.ok(
      openAISection.indexOf('openAICompatibleSettingsEqual(next, current)') < openAISection.indexOf("config.update('openaiCompatible.baseURL'"),
      'expected unchanged OpenAI-compatible guard before config writes'
    );

    assert.match(codexSection, /const current = getCodexSubscriptionSettings\(\);/);
    assert.match(codexSection, /if \(next\.defaultModelId === current\.defaultModelId\) \{/);
    assert.match(codexSection, /codexSubscriptionSettings: current/);
    assert.ok(
      codexSection.indexOf('next.defaultModelId === current.defaultModelId') < codexSection.indexOf("update('codexSubscription.defaultModelId'"),
      'expected unchanged Codex subscription guard before config write'
    );
  });

  test('workspace instruction and compaction prune backends skip unchanged writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const workspaceHelpers = section('function workspaceEnvEqual', 'function getDebugSettingsForUi');
    const instructionHelpers = section('function instructionFileSettingsEqual', 'function normalizeWorkspaceEnv');
    const compactionHelpers = section('function getCompactionPruneSettings', 'function getCompactionToolOutputMode');
    const workspaceSection = section('async setWorkspaceEnv', 'async setInstructionPatterns');
    const instructionPatternsSection = section('async setInstructionPatterns', 'async setInstructionFileSettings');
    const instructionFilesSection = section('async setInstructionFileSettings', 'async setSkillsEnabled');
    const compactionSection = section('async setCompactionPruneSettings', 'async setCompactionToolOutputMode');

    assert.match(workspaceHelpers, /countOwnEnumerableKeys\(left\) !== countOwnEnumerableKeys\(right\)/);
    assert.match(workspaceHelpers, /left\[key\] !== right\[key\]/);
    assert.match(instructionHelpers, /left\.includeGlobal === right\.includeGlobal/);
    assert.match(instructionHelpers, /left\.maxTotalChars === right\.maxTotalChars/);
    assert.match(compactionHelpers, /function compactionPruneSettingsEqual/);
    assert.match(compactionHelpers, /left\.pruneMinimumTokens === right\.pruneMinimumTokens/);

    assert.match(workspaceSection, /const current = getWorkspaceEnv\(\);/);
    assert.match(workspaceSection, /if \(workspaceEnvEqual\(normalized, current\)\) \{/);
    assert.ok(
      workspaceSection.indexOf('workspaceEnvEqual(normalized, current)') < workspaceSection.indexOf("update('env'"),
      'expected unchanged workspace env guard before config write'
    );

    assert.match(instructionPatternsSection, /const current = getInstructionPatterns\(\);/);
    assert.match(instructionPatternsSection, /if \(stringListsEqual\(normalized, current\)\) \{/);
    assert.ok(
      instructionPatternsSection.indexOf('stringListsEqual(normalized, current)') < instructionPatternsSection.indexOf("update('instructions'"),
      'expected unchanged instruction pattern guard before config write'
    );

    assert.match(instructionFilesSection, /const current = getInstructionFileSettings\(\);/);
    assert.match(instructionFilesSection, /if \(instructionFileSettingsEqual\(normalized, current\)\) \{/);
    assert.ok(
      instructionFilesSection.indexOf('instructionFileSettingsEqual(normalized, current)') < instructionFilesSection.indexOf("config.update('instructionFiles.includeGlobal'"),
      'expected unchanged instruction file settings guard before config writes'
    );

    assert.match(compactionSection, /const current = getCompactionPruneSettings\(\);/);
    assert.match(compactionSection, /if \(compactionPruneSettingsEqual\(normalized, current\)\) \{/);
    assert.ok(
      compactionSection.indexOf('compactionPruneSettingsEqual(normalized, current)') < compactionSection.indexOf("config.update('compaction.prune'"),
      'expected unchanged compaction prune guard before config writes'
    );
  });

  test('skills and subagent backends skip unchanged writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const budgetHelpers = section('function skillsBudgetEqual', 'function getSubagentModelOverride');
    const searchSection = section('async setSkillSearchPaths', 'async setSkillsBudget');
    const budgetSection = section('async setSkillsBudget', 'async setSessionsPersist');
    const exploreMaxSection = section('async setExplorePrepassMaxChars', 'async setSubagentModelOverride');
    const subagentModelSection = section('async setSubagentModelOverride', 'async setSubagentTaskMaxOutputChars');
    const subagentTaskSection = section('async setSubagentTaskMaxOutputChars', 'async setAutoCompaction');

    assert.match(budgetHelpers, /left\.maxPromptSkills === right\.maxPromptSkills/);
    assert.match(budgetHelpers, /left\.maxInjectChars === right\.maxInjectChars/);

    assert.match(searchSection, /const current = getSkillSearchPaths\(\);/);
    assert.match(searchSection, /if \(stringListsEqual\(normalized, current\)\) \{/);
    assert.ok(
      searchSection.indexOf('stringListsEqual(normalized, current)') < searchSection.indexOf("update('skills.paths'"),
      'expected unchanged skill search path guard before config write'
    );
    assert.ok(
      searchSection.indexOf('stringListsEqual(normalized, current)') < searchSection.indexOf('this.skillNamesForUiPromise = undefined'),
      'expected unchanged skill search path guard before skill cache invalidation'
    );

    assert.match(budgetSection, /const current = getSkillsBudget\(\);/);
    assert.match(budgetSection, /if \(skillsBudgetEqual\(normalized, current\)\) \{/);
    assert.ok(
      budgetSection.indexOf('skillsBudgetEqual(normalized, current)') < budgetSection.indexOf("config.update('skills.maxPromptSkills'"),
      'expected unchanged skills budget guard before config writes'
    );
    assert.ok(
      budgetSection.indexOf('skillsBudgetEqual(normalized, current)') < budgetSection.indexOf('this.skillNamesForUiPromise = undefined'),
      'expected unchanged skills budget guard before skill cache invalidation'
    );

    assert.match(exploreMaxSection, /const current = getExplorePrepassMaxChars\(\);/);
    assert.match(exploreMaxSection, /if \(normalized === current\) \{/);
    assert.ok(
      exploreMaxSection.indexOf('normalized === current') < exploreMaxSection.indexOf("update('subagents.explorePrepass.maxChars'"),
      'expected unchanged explore max guard before config write'
    );

    assert.match(subagentModelSection, /const current = getSubagentModelOverride\(\);/);
    assert.match(subagentModelSection, /if \(normalized === current\) \{/);
    assert.ok(
      subagentModelSection.indexOf('normalized === current') < subagentModelSection.indexOf("update('subagents.model'"),
      'expected unchanged subagent model guard before config write'
    );

    assert.match(subagentTaskSection, /const current = getSubagentTaskMaxOutputChars\(\);/);
    assert.match(subagentTaskSection, /if \(normalized === current\) \{/);
    assert.ok(
      subagentTaskSection.indexOf('normalized === current') < subagentTaskSection.indexOf("update('subagents.task.maxOutputChars'"),
      'expected unchanged subagent output guard before config write'
    );
  });

  test('memory grouped settings backend skips unchanged grouped writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const methodSection = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const budgetSection = methodSection('async setMemoryAutoRecallBudget', 'async setMemoryAutoRecallFilters');
    const filtersSection = methodSection('async setMemoryAutoRecallFilters', 'async updateMemoriesNow');
    const advancedSection = methodSection('async setMemoryAdvancedLimits', 'async setExplorePrepass');
    const helpersSection = methodSection('function getMemoryAutoRecallBudget', 'function getExplorePrepassEnabled');

    assert.match(helpersSection, /function getMemoryAutoRecallBudget\(\): MemoryAutoRecallBudget/);
    assert.match(helpersSection, /function getMemoryAutoRecallFilters\(\): MemoryAutoRecallFilters/);
    assert.match(helpersSection, /function memoryAdvancedLimitsEqual\(left: MemoryAdvancedLimits, right: MemoryAdvancedLimits\): boolean/);

    assert.match(budgetSection, /const current = getMemoryAutoRecallBudget\(\);/);
    assert.match(budgetSection, /const normalized: MemoryAutoRecallBudget = \{/);
    assert.match(budgetSection, /normalized\.maxResults === current\.maxResults && normalized\.maxTokens === current\.maxTokens/);
    assert.ok(
      budgetSection.indexOf('normalized.maxResults === current.maxResults') < budgetSection.indexOf("config.update('memories.maxAutoRecallResults'"),
      'expected unchanged memory budget guard before config writes'
    );

    assert.match(filtersSection, /const current = getMemoryAutoRecallFilters\(\);/);
    assert.match(filtersSection, /const normalized: MemoryAutoRecallFilters = \{/);
    assert.match(filtersSection, /normalized\.minScore === current\.minScore/);
    assert.ok(
      filtersSection.indexOf('normalized.minScore === current.minScore') < filtersSection.indexOf("config.update('memories.autoRecallMinScore'"),
      'expected unchanged memory filters guard before config writes'
    );

    assert.match(advancedSection, /const current = getMemoryAdvancedLimits\(\);/);
    assert.match(advancedSection, /if \(memoryAdvancedLimitsEqual\(normalized, current\)\) \{/);
    assert.match(advancedSection, /memoryAdvancedLimits: current/);
    assert.ok(
      advancedSection.indexOf('memoryAdvancedLimitsEqual(normalized, current)') < advancedSection.indexOf("config.update('memories.maxRawMemoriesForGlobal'"),
      'expected unchanged memory limits guard before config writes'
    );
  });

  test('tool runtime limits backend skips unchanged grouped writes before config updates', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const helperStart = source.indexOf('function toolRuntimeLimitsEqual');
    assert.ok(helperStart >= 0, 'expected tool runtime equality helper');
    const helperEnd = source.indexOf('type CompactionToolOutputMode', helperStart);
    assert.ok(helperEnd > helperStart, 'expected compaction mode type after tool runtime equality helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const methodStart = source.indexOf('async setToolRuntimeLimits');
    assert.ok(methodStart >= 0, 'expected setToolRuntimeLimits method');
    const methodEnd = source.indexOf('async setToolFilter', methodStart);
    assert.ok(methodEnd > methodStart, 'expected tool filter method after setToolRuntimeLimits');
    const methodSection = source.slice(methodStart, methodEnd);

    assert.match(helperSection, /left\.toolTimeoutMs === right\.toolTimeoutMs/);
    assert.match(helperSection, /left\.httpTimeoutMs === right\.httpTimeoutMs/);
    assert.match(methodSection, /const current = getToolRuntimeLimits\(\);/);
    assert.match(methodSection, /const normalized: ToolRuntimeLimits = \{/);
    assert.match(methodSection, /if \(toolRuntimeLimitsEqual\(normalized, current\)\) \{/);
    assert.match(methodSection, /this\.postMessage\(\{ type: 'toolRuntimeLimitsState', toolRuntimeLimits: current \}\);/);
    assert.ok(
      methodSection.indexOf('toolRuntimeLimitsEqual(normalized, current)') < methodSection.indexOf("config.update('toolTimeoutMs'"),
      'expected unchanged tool runtime guard before config writes'
    );
  });

  test('tool filter backend skips unchanged writes and catalog rebuild before config update', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const helperStart = source.indexOf('function stringListsEqual');
    assert.ok(helperStart >= 0, 'expected string-list equality helper');
    const helperEnd = source.indexOf('function collectRequiredParameterNames', helperStart);
    assert.ok(helperEnd > helperStart, 'expected required-parameter helper after string-list equality helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const methodStart = source.indexOf('async setToolFilter');
    assert.ok(methodStart >= 0, 'expected setToolFilter method');
    const methodEnd = source.indexOf('async revokeAlwaysAllowedTool', methodStart);
    assert.ok(methodEnd > methodStart, 'expected auto-approved tool method after setToolFilter');
    const methodSection = source.slice(methodStart, methodEnd);

    assert.match(helperSection, /left\.length !== right\.length/);
    assert.match(helperSection, /left\[i\] !== right\[i\]/);
    assert.match(methodSection, /const current = getToolFilter\(\);/);
    assert.match(methodSection, /if \(stringListsEqual\(normalized, current\)\) \{/);
    assert.match(methodSection, /this\.postMessage\(\{ type: 'toolFilterState', toolFilter: current \}\);/);
    assert.ok(
      methodSection.indexOf('stringListsEqual(normalized, current)') < methodSection.indexOf("update('toolFilter'"),
      'expected unchanged tool filter guard before config write'
    );
    assert.ok(
      methodSection.indexOf('stringListsEqual(normalized, current)') < methodSection.indexOf('buildToolCatalogForUI()'),
      'expected unchanged tool filter guard before catalog rebuild'
    );
  });

  test('settings backend list length checks scan without callback arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const helperSection = section('function hasListItemLongerThan', 'function collectRequiredParameterNames');
    const pluginSection = section('async setPluginSettings', 'async setToolRuntimeLimits');
    const toolFilterSection = section('async setToolFilter', 'async revokeAlwaysAllowedTool');
    const instructionSection = section('async setInstructionPatterns', 'async setInstructionFileSettings');
    const skillSearchSection = section('async setSkillSearchPaths', 'async setSkillsBudget');
    const settingsSections = pluginSection + toolFilterSection + instructionSection + skillSearchSection;

    assert.match(helperSection, /for \(let i = 0; i < values\.length; i\+\+\)/);
    assert.match(helperSection, /if \(values\[i\]\.length > maxLength\) return true;/);
    assert.match(pluginSection, /hasListItemLongerThan\(next\.plugins, 240\)/);
    assert.match(toolFilterSection, /hasListItemLongerThan\(normalized, 120\)/);
    assert.match(instructionSection, /hasListItemLongerThan\(normalized, 240\)/);
    assert.match(skillSearchSection, /hasListItemLongerThan\(normalized, 240\)/);
    assert.doesNotMatch(settingsSections, /\.some\(\s*[^)]*=>\s*[^)]*\.length > /);
  });

		  test('instruction settings state updates avoid duplicate value checked and title writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const patternsTitleStart = bootstrapSource.indexOf('function getInstructionPatternsTitleDisplayText');
    assert.ok(patternsTitleStart >= 0, 'expected instruction patterns title display helper');
    const patternsStart = bootstrapSource.indexOf('function updateNormalizedInstructionPatternsState', patternsTitleStart);
    assert.ok(patternsStart > patternsTitleStart, 'expected normalized instruction patterns state helper after title display helper');
    const patternsTitleSection = bootstrapSource.slice(patternsTitleStart, patternsStart);
    const settingsNormalizeStart = bootstrapSource.indexOf('function normalizeInstructionFileSettings', patternsStart);
    assert.ok(settingsNormalizeStart > patternsStart, 'expected instruction file settings normalizer after patterns state helper');
    const patternsSection = bootstrapSource.slice(patternsStart, settingsNormalizeStart);
    const titlesStart = bootstrapSource.indexOf('function updateInstructionFileTitles', settingsNormalizeStart);
    assert.ok(titlesStart > settingsNormalizeStart, 'expected instruction file title helper after settings normalizer');
	    const settingsStart = bootstrapSource.indexOf('function updateNormalizedInstructionFileSettingsState', titlesStart);
	    assert.ok(settingsStart > titlesStart, 'expected normalized instruction file settings state helper after title helper');
    const titlesSection = bootstrapSource.slice(titlesStart, settingsStart);
    const settingsEnd = bootstrapSource.indexOf('function applyInstructionSettings', settingsStart);
    assert.ok(settingsEnd > settingsStart, 'expected instruction settings apply helper after state helper');
    const settingsSection = bootstrapSource.slice(settingsStart, settingsEnd);
	    const applyEnd = bootstrapSource.indexOf('function normalizeToolRuntimeLimits', settingsEnd);
	    assert.ok(applyEnd > settingsEnd, 'expected tool runtime normalizer after instruction apply helper');
	    const applySection = bootstrapSource.slice(settingsEnd, applyEnd);
	    const instructionPatternsStateStart = mainSource.indexOf("case 'instructionPatternsState':");
	    assert.ok(instructionPatternsStateStart >= 0, 'expected instruction patterns state branch');
	    const instructionFileSettingsStateStart = mainSource.indexOf("case 'instructionFileSettingsState':", instructionPatternsStateStart);
	    assert.ok(instructionFileSettingsStateStart > instructionPatternsStateStart, 'expected instruction file settings branch after patterns branch');
	    const instructionPatternsStateSection = mainSource.slice(instructionPatternsStateStart, instructionFileSettingsStateStart);
	    const showThinkingStateStart = mainSource.indexOf("case 'showThinkingState':", instructionFileSettingsStateStart);
	    assert.ok(showThinkingStateStart > instructionFileSettingsStateStart, 'expected thinking branch after instruction file settings branch');
	    const instructionFileSettingsStateSection = mainSource.slice(instructionFileSettingsStateStart, showThinkingStateStart);

		    assert.match(patternsSection, /function updateNormalizedInstructionPatternsState\(patterns\)/);
		    assert.match(patternsSection, /function updateInstructionPatternsState\(patterns\)/);
		    assert.match(patternsSection, /updateNormalizedInstructionPatternsState\(normalizeInstructionPatterns\(patterns\)\);/);
		    assert.match(patternsSection, /setValue\(instructionPatternsInput, instructionPatterns\.join\('\\n'\)\);/);
	    assert.match(patternsSection, /setTitle\(instructionPatternsInput, instructionPatterns\.length/);
	    assert.match(bootstrapSource, /const INSTRUCTION_PATTERNS_TITLE_DISPLAY_LIMIT = 240;/);
	    assert.match(patternsTitleSection, /function getInstructionPatternsTitleDisplayText\(patterns\)/);
	    assert.match(patternsTitleSection, /formatCommaSeparatedList\(patterns\)/);
	    assert.match(patternsTitleSection, /value\.length <= INSTRUCTION_PATTERNS_TITLE_DISPLAY_LIMIT/);
	    assert.match(patternsTitleSection, /value\.slice\(0, INSTRUCTION_PATTERNS_TITLE_DISPLAY_LIMIT\) \+ '…'/);
	    assert.match(titlesSection, /setTitle\(instructionPatternsLabel, instructionPatterns\.length/);
	    assert.match(titlesSection, /getInstructionPatternsTitleDisplayText\(instructionPatterns\)/);
	    assert.match(titlesSection, /setTitle\(instructionIncludeGlobalLabel, instructionFileSettings\.includeGlobal/);
    assert.match(titlesSection, /setTitle\(instructionMaxCharsPerFileLabel, 'Each instruction file is capped at '/);
    assert.match(titlesSection, /setTitle\(instructionMaxTotalCharsLabel, 'All instruction files are capped at '/);
    assert.match(titlesSection, /setTitle\(instructionPatternsApply, 'Apply instruction files: '/);
		    assert.match(settingsSection, /function updateNormalizedInstructionFileSettingsState\(settings\)/);
		    assert.match(settingsSection, /function updateInstructionFileSettingsState\(settings\)/);
		    assert.match(settingsSection, /updateNormalizedInstructionFileSettingsState\(normalizeInstructionFileSettings\(settings\)\);/);
		    assert.match(settingsSection, /setChecked\(instructionIncludeGlobalToggle, instructionFileSettings\.includeGlobal\);/);
		    assert.match(settingsSection, /setValue\(instructionMaxCharsPerFileInput, instructionFileSettings\.maxCharsPerFile\);/);
		    assert.match(settingsSection, /setValue\(instructionMaxTotalCharsInput, instructionFileSettings\.maxTotalChars\);/);
		    assert.match(applySection, /const normalizedSettings = normalizeInstructionFileSettings\(settings\);/);
		    assert.match(applySection, /stringListsEqual\(patterns, instructionPatterns\)/);
		    assert.match(applySection, /instructionFileSettingsEqual\(normalizedSettings, instructionFileSettings\)/);
		    assert.match(applySection, /hasListItemLongerThan\(patterns, 240\)/);
		    assert.doesNotMatch(applySection, /\.some\(/);
		    assert.match(instructionPatternsStateSection, /const nextInstructionPatterns = normalizeInstructionPatterns\(data\.instructionPatterns \|\| \[\]\);/);
		    assert.match(instructionPatternsStateSection, /if \(!hasPendingSettingState\('instructionPatternsState'\) && stringListsEqual\(nextInstructionPatterns, instructionPatterns\)\) break;/);
		    assert.match(instructionPatternsStateSection, /updateNormalizedInstructionPatternsState\(nextInstructionPatterns\);/);
		    assert.match(instructionFileSettingsStateSection, /const nextInstructionFileSettings = normalizeInstructionFileSettings\(data\.instructionFileSettings \|\| \{\}\);/);
		    assert.match(instructionFileSettingsStateSection, /if \(!hasPendingSettingState\('instructionFileSettingsState'\) && instructionFileSettingsEqual\(nextInstructionFileSettings, instructionFileSettings\)\) break;/);
		    assert.match(instructionFileSettingsStateSection, /updateNormalizedInstructionFileSettingsState\(nextInstructionFileSettings\);/);
		    assert.ok(
	      applySection.indexOf('stringListsEqual(patterns, instructionPatterns)') < applySection.indexOf('postSettingsWithPendingStates('),
	      'expected unchanged instruction settings guard before posting'
	    );
		    assert.doesNotMatch(titlesSection, /\.join\(', '\)/);
		    assert.doesNotMatch(patternsSection + titlesSection + settingsSection, /\.(?:value|checked|title)\s*=/);
  });

		  test('settings control state updates avoid duplicate property writes', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const classHelperStart = bootstrapSource.indexOf('function setClassPresence');
    assert.ok(classHelperStart >= 0, 'expected class presence helper');
    const classHelperEnd = bootstrapSource.indexOf('function setDisabledClass', classHelperStart);
    assert.ok(classHelperEnd > classHelperStart, 'expected disabled-class helper after class presence helper');
    const classHelperSection = bootstrapSource.slice(classHelperStart, classHelperEnd);
    const disabledClassStart = bootstrapSource.indexOf('function setDisabledClass');
    assert.ok(disabledClassStart >= 0, 'expected disabled-class helper');
    const disabledClassEnd = bootstrapSource.indexOf('function setHidden', disabledClassStart);
    assert.ok(disabledClassEnd > disabledClassStart, 'expected hidden helper after disabled-class helper');
    const disabledClassSection = bootstrapSource.slice(disabledClassStart, disabledClassEnd);
    const customStart = bootstrapSource.indexOf('function setCustomModelInputsDisabled');
    assert.ok(customStart >= 0, 'expected custom model settings helper');
    const generationStart = bootstrapSource.indexOf('function setGenerationInputsDisabled', customStart);
    assert.ok(generationStart > customStart, 'expected generation settings helper after custom model helper');
    const instructionStart = bootstrapSource.indexOf('function setInstructionFileInputsDisabled', generationStart);
    assert.ok(instructionStart > generationStart, 'expected instruction settings helper after generation helper');
    const instructionEnd = bootstrapSource.indexOf('function showFatalError', instructionStart);
    assert.ok(instructionEnd > instructionStart, 'expected settings helpers before fatal error helper');
    const settingsSection = bootstrapSource.slice(customStart, instructionEnd);

    assert.match(classHelperSection, /const presentFlag = !!present;/);
    assert.match(classHelperSection, /element\.classList\.contains\(className\) !== presentFlag/);
    assert.match(classHelperSection, /element\.classList\.toggle\(className, presentFlag\);/);
    assert.match(disabledClassSection, /setClassPresence\(element, 'disabled', disabled\);/);
    assert.match(settingsSection, /setDisabled\(customModelInput, disabled\);/);
    assert.match(settingsSection, /setDisabledClass\(customModelLabel, disabled\);/);
    assert.match(settingsSection, /setDisabled\(temperatureInput, disabled\);/);
    assert.match(settingsSection, /setDisabled\(retryWithPartialOutputToggle, disabled\);/);
    assert.match(settingsSection, /setDisabledClass\(retryWithPartialOutputLabel, disabled\);/);
    assert.match(settingsSection, /setDisabled\(instructionPatternsInput, disabled\);/);
    assert.match(settingsSection, /setDisabledClass\(instructionPatternsLabel, disabled\);/);
	    assert.doesNotMatch(settingsSection, /\.disabled = disabled/);
	    assert.doesNotMatch(settingsSection, /classList\.toggle\('disabled'/);
	  });

	  test('batch settings posts avoid temporary array wrapping', () => {
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const hasPendingStart = bootstrapSource.indexOf('function hasPendingSettingStates');
    assert.ok(hasPendingStart >= 0, 'expected batch pending-state checker');
    const setPendingStart = bootstrapSource.indexOf('function setPendingSettingStates', hasPendingStart);
    assert.ok(setPendingStart > hasPendingStart, 'expected pending-state setter after checker');
    const postMessagesStart = bootstrapSource.indexOf('function postSettingsMessages', setPendingStart);
    assert.ok(postMessagesStart > setPendingStart, 'expected settings message poster after pending-state setter');
    const batchStart = bootstrapSource.indexOf('function postSettingsWithPendingStates', postMessagesStart);
    assert.ok(batchStart > postMessagesStart, 'expected batch settings poster after helpers');
	    const batchEnd = bootstrapSource.indexOf('function isCompactOperationRunning', batchStart);
    assert.ok(batchEnd > batchStart, 'expected end of batch settings poster');
    const helpersSection = bootstrapSource.slice(hasPendingStart, batchStart);
    const batchSection = bootstrapSource.slice(batchStart, batchEnd);

	    assert.strictEqual(
	      (helpersSection.match(/for \(let stateTypeIndex = 0; stateTypeIndex < stateTypes\.length; stateTypeIndex\+\+\)/g) || []).length,
	      2,
	      'expected pending-state helpers to scan stateTypes with indexed loops'
	    );
	    assert.match(helpersSection, /const stateType = stateTypes\[stateTypeIndex\];/);
	    assert.match(helpersSection, /return !!stateTypes && hasPendingSettingState\(stateTypes\);/);
	    assert.match(helpersSection, /setPendingSettingState\(stateType, pending\);/);
    assert.match(helpersSection, /Object\.prototype\.hasOwnProperty\.call\(messages, i\)/);
    assert.match(helpersSection, /vscode\.postMessage\(messages\[i\]\);/);
    assert.match(helpersSection, /vscode\.postMessage\(messages\);/);
    assert.match(batchSection, /hasPendingSettingStates\(stateTypes\)/);
    assert.match(batchSection, /setPendingSettingStates\(stateTypes, true\)/);
    assert.match(batchSection, /postSettingsMessages\(messages\)/);
    assert.match(batchSection, /setPendingSettingStates\(stateTypes, false\)/);
	    assert.doesNotMatch(batchSection, /\(Array\.isArray\(stateTypes\) \? stateTypes : \[stateTypes\]\)\.filter\(Boolean\)/);
	    assert.doesNotMatch(batchSection, /\.some\(\(stateType\) => hasPendingSettingState\(stateType\)\)/);
			    assert.doesNotMatch(batchSection, /\(Array\.isArray\(messages\) \? messages : \[messages\]\)\.forEach/);
			    assert.doesNotMatch(batchSection, /types\.forEach/);
	    assert.doesNotMatch(helpersSection, /for \(const stateType of stateTypes\)/);
		  });

		  test('settings summary serializers skip Object.keys snapshots', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const helperStart = bootstrapSource.indexOf('function serializeSortedOwnEnumerableEntries');
		    assert.ok(helperStart >= 0, 'expected sorted entry serializer');
		    const helperEnd = bootstrapSource.indexOf('function forEachTextLine', helperStart);
		    assert.ok(helperEnd > helperStart, 'expected text-line helper after sorted entry serializer');
		    const helperSection = bootstrapSource.slice(helperStart, helperEnd);

		    assert.match(helperSection, /let keys = null;/);
		    assert.match(helperSection, /for \(const key in value\)/);
		    assert.match(helperSection, /Object\.prototype\.hasOwnProperty\.call\(value, key\)/);
		    assert.match(helperSection, /if \(!keys\) keys = \[\];/);
		    assert.match(helperSection, /if \(!keys\) return '';/);
		    assert.match(helperSection, /if \(keys\.length > 1\) keys\.sort\(compareLocaleAscending\);/);
		    assert.match(bootstrapSource, /function\s+compareLocaleAscending\(left, right\)/);
		    assert.doesNotMatch(helperSection, /\.sort\(\(a, b\) => a\.localeCompare\(b\)\)/);
		    assert.doesNotMatch(helperSection, /Object\.keys/);
		  });

		  test('pending state timer cleanup avoids callback sweeps and temporary action arrays', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
	    const pendingStart = bootstrapSource.indexOf('function clearPendingSettingTimer');
	    assert.ok(pendingStart >= 0, 'expected pending settings timer helper');
	    const pendingEnd = bootstrapSource.indexOf('function postSettingWithPendingState', pendingStart);
	    assert.ok(pendingEnd > pendingStart, 'expected setting post helper after pending timer helpers');
	    const pendingSection = bootstrapSource.slice(pendingStart, pendingEnd);
	    const settingsStart = mainSource.indexOf('function applySettingsState');
	    assert.ok(settingsStart >= 0, 'expected settings state apply helper');
	    const settingsEnd = mainSource.indexOf('function flushAssistantMarkdownRender', settingsStart);
	    assert.ok(settingsEnd > settingsStart, 'expected markdown flush helper after settings apply helper');
	    const settingsSection = mainSource.slice(settingsStart, settingsEnd);

	    assert.match(pendingSection, /for \(const timer of pendingSettingTimers\.values\(\)\) \{[\s\S]*clearTimeout\(timer\);/);
	    assert.match(pendingSection, /for \(const timer of pendingActionTimers\.values\(\)\) \{[\s\S]*clearTimeout\(timer\);/);
	    assert.doesNotMatch(pendingSection, /pendingSettingTimers\.forEach/);
	    assert.doesNotMatch(pendingSection, /pendingActionTimers\.forEach/);
	    assert.match(settingsSection, /clearPendingActionTimer\('reasoningEffort'\);[\s\S]*clearPendingActionTimer\('providerSwitch'\);/);
	    assert.doesNotMatch(settingsSection, /\[[^\]]*reasoningEffort[\s\S]*providerSwitch[^\]]*\]\.forEach/);
	  });

  test('composer input events avoid the full control state sweep', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const inputListenerStart = bootstrapSource.indexOf("input.addEventListener('input'");
    assert.ok(inputListenerStart >= 0, 'expected input event listener');
    const inputListenerEnd = bootstrapSource.indexOf("input.addEventListener('click'", inputListenerStart);
    assert.ok(inputListenerEnd > inputListenerStart, 'expected input listener end');
    const inputListenerSection = bootstrapSource.slice(inputListenerStart, inputListenerEnd);
    const syncStart = bootstrapSource.indexOf('function syncInputState');
    assert.ok(syncStart >= 0, 'expected syncInputState');
    const syncEnd = bootstrapSource.indexOf('function findSessionOptionById', syncStart);
    assert.ok(syncEnd > syncStart, 'expected syncInputState end');
    const syncSection = bootstrapSource.slice(syncStart, syncEnd);

    assert.match(bootstrapSource, /function\s+getComposerInputState\(\)/);
    assert.match(bootstrapSource, /function\s+syncComposerInputState\(\)/);
    assert.match(syncSection, /syncComposerInputState\(\);/);
    assert.match(inputListenerSection, /syncComposerInputState\(\);/);
    assert.match(inputListenerSection, /updateInputLayout\(\{ clearButton: false \}\);/);
    assert.doesNotMatch(inputListenerSection, /syncInputState\(\);/);
    assert.doesNotMatch(inputListenerSection, /setToolsCatalogControlsDisabled/);
    const bootstrapLines = bootstrapSource.split(/\r?\n/);
    for (let index = 0; index < bootstrapLines.length; index++) {
      if (!bootstrapLines[index].includes('updateInputLayout();')) continue;
      for (let nextIndex = index + 1; nextIndex < Math.min(index + 5, bootstrapLines.length); nextIndex++) {
        if (!bootstrapLines[nextIndex].includes('syncComposerInputState();')) continue;
        assert.fail(`updateInputLayout before composer sync should pass { clearButton: false } near line ${index + 1}`);
      }
    }
  });

  test('model picker current row has disabled and focus styles', () => {
    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
    const disabledStart = htmlSource.indexOf('.model-picker-item:disabled');
    assert.ok(disabledStart >= 0, 'expected model picker disabled item style');
    const focusStart = htmlSource.indexOf('.model-picker-item:focus-visible,', disabledStart);
    assert.ok(focusStart > disabledStart, 'expected model picker focus style after disabled style');
    const rowHoverStart = htmlSource.indexOf('.model-picker-row:hover', focusStart);
    assert.ok(rowHoverStart > focusStart, 'expected row hover style after focus style');
    const disabledSection = htmlSource.slice(disabledStart, focusStart);
    const focusSection = htmlSource.slice(focusStart, rowHoverStart);

    assert.match(disabledSection, /cursor: default;/);
    assert.match(disabledSection, /opacity: 1;/);
    assert.match(focusSection, /\.model-picker-favorite:focus-visible/);
    assert.match(focusSection, /outline: 1px solid var\(--vscode-focusBorder\);/);
    assert.match(focusSection, /outline-offset: -1px;/);
  });

  test('catalog searches cache normalized search text per item', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const modelMatchStart = bootstrapSource.indexOf('function modelMatchesSearch');
    assert.ok(modelMatchStart >= 0, 'expected modelMatchesSearch helper');
	    const modelMatchEnd = bootstrapSource.indexOf('function createModelPickerRow', modelMatchStart);
	    assert.ok(modelMatchEnd > modelMatchStart, 'expected model match helper end');
	    const modelMatchSection = bootstrapSource.slice(modelMatchStart, modelMatchEnd);
	    const modelRenderKeyStart = bootstrapSource.indexOf('function appendModelPickerRenderKey');
	    assert.ok(modelRenderKeyStart >= 0, 'expected model picker render-key helper');
		    const modelRenderKeyEnd = bootstrapSource.indexOf('function collectFavoriteModelIds', modelRenderKeyStart);
		    assert.ok(modelRenderKeyEnd > modelRenderKeyStart, 'expected model picker favorites helper after render-key helper');
		    const modelRenderKeySection = bootstrapSource.slice(modelRenderKeyStart, modelRenderKeyEnd);
		    const collectFavoriteEnd = bootstrapSource.indexOf('function appendModelDetailText', modelRenderKeyEnd);
		    assert.ok(collectFavoriteEnd > modelRenderKeyEnd, 'expected model detail helper after favorites collector');
		    const collectFavoriteSection = bootstrapSource.slice(modelRenderKeyEnd, collectFavoriteEnd);
		    const modelRowStart = bootstrapSource.indexOf('function createModelPickerRow');
		    assert.ok(modelRowStart >= 0, 'expected model picker row helper');
		    const modelStatusStart = bootstrapSource.indexOf('function formatModelPickerStatus', modelRowStart);
		    assert.ok(modelStatusStart > modelRowStart, 'expected model picker status helper after row helper');
		    const modelRowEnd = modelStatusStart;
		    const modelRowSection = bootstrapSource.slice(modelRowStart, modelRowEnd);
			    const modelSectionStart = bootstrapSource.indexOf('function renderModelPickerSection', modelStatusStart);
			    assert.ok(modelSectionStart >= 0, 'expected model picker section helper');
		    const modelStatusSection = bootstrapSource.slice(modelStatusStart, modelSectionStart);
		    const modelSectionEnd = bootstrapSource.indexOf('function getModelPickerListControlsDisabled', modelSectionStart);
		    assert.ok(modelSectionEnd > modelSectionStart, 'expected model picker control helper after section helper');
		    const modelSectionSection = bootstrapSource.slice(modelSectionStart, modelSectionEnd);
		    const modelStateStart = bootstrapSource.indexOf('function updateModelPickerState');
	    assert.ok(modelStateStart >= 0, 'expected model picker state helper');
	    const modelStateEnd = bootstrapSource.indexOf('function applyCustomModelId', modelStateStart);
	    assert.ok(modelStateEnd > modelStateStart, 'expected model picker state helper end');
	    const modelStateSection = bootstrapSource.slice(modelStateStart, modelStateEnd);
	    const clearModelCacheStart = bootstrapSource.indexOf('function clearModelPickerCache');
	    assert.ok(clearModelCacheStart >= 0, 'expected model picker cache reset helper');
	    const clearModelCacheEnd = bootstrapSource.indexOf('function markInvalidField', clearModelCacheStart);
	    assert.ok(clearModelCacheEnd > clearModelCacheStart, 'expected end of model picker cache reset helper');
	    const clearModelCacheSection = bootstrapSource.slice(clearModelCacheStart, clearModelCacheEnd);
	    const defaultArgsStart = bootstrapSource.indexOf('function buildDefaultToolArgs');
	    assert.ok(defaultArgsStart >= 0, 'expected default tool args helper');
	    const defaultArgsEnd = bootstrapSource.indexOf('function setToolsCatalogControlsDisabled', defaultArgsStart);
	    assert.ok(defaultArgsEnd > defaultArgsStart, 'expected control helper after default args helper');
	    const defaultArgsSection = bootstrapSource.slice(defaultArgsStart, defaultArgsEnd);
	    const toolParamStart = bootstrapSource.indexOf('function getToolCatalogParamText');
	    assert.ok(toolParamStart >= 0, 'expected tool parameter cache helper');
	    const toolParamEnd = bootstrapSource.indexOf('function getToolCatalogSearchText', toolParamStart);
	    assert.ok(toolParamEnd > toolParamStart, 'expected tool search helper after parameter cache helper');
	    const toolParamSection = bootstrapSource.slice(toolParamStart, toolParamEnd);
	    const toolMatchStart = bootstrapSource.indexOf('function toolMatchesCatalogSearch');
	    assert.ok(toolMatchStart >= 0, 'expected toolMatchesCatalogSearch helper');
	    const toolMatchEnd = bootstrapSource.indexOf('function collectToolsCatalogMatches', toolMatchStart);
	    assert.ok(toolMatchEnd > toolMatchStart, 'expected tool match helper end');
	    const toolMatchSection = bootstrapSource.slice(toolMatchStart, toolMatchEnd);
	    const toolCollectStart = toolMatchEnd;
	    const toolCollectEnd = bootstrapSource.indexOf('function getToolCatalogRenderText', toolCollectStart);
	    assert.ok(toolCollectEnd > toolCollectStart, 'expected tool catalog collector before render text helper');
	    const toolCollectSection = bootstrapSource.slice(toolCollectStart, toolCollectEnd);
	    const toolRenderTextStart = toolCollectEnd;
	    const toolRenderTextEnd = bootstrapSource.indexOf('function getToolsCatalogRenderKey', toolRenderTextStart);
	    assert.ok(toolRenderTextEnd > toolRenderTextStart, 'expected tool catalog render text helper before catalog render-key helper');
	    const toolRenderTextSection = bootstrapSource.slice(toolRenderTextStart, toolRenderTextEnd);
	    const toolRenderKeyStart = toolRenderTextEnd;
	    assert.ok(toolRenderKeyStart >= 0, 'expected tools catalog render-key helper');
	    const toolRenderKeyEnd = bootstrapSource.indexOf('function showManualToolResult', toolRenderKeyStart);
	    assert.ok(toolRenderKeyEnd > toolRenderKeyStart, 'expected tools catalog render-key helper end');
	    const toolRenderKeySection = bootstrapSource.slice(toolRenderKeyStart, toolRenderKeyEnd);
	    const manualResultStart = bootstrapSource.indexOf('function showManualToolResult');
	    assert.ok(manualResultStart >= 0, 'expected manual tool result state helper');
	    const manualResultEnd = bootstrapSource.indexOf('function renderManualToolResult', manualResultStart);
	    assert.ok(manualResultEnd > manualResultStart, 'expected manual tool render helper after state helper');
	    const manualResultSection = bootstrapSource.slice(manualResultStart, manualResultEnd);
			    const toolRunHandlerStart = bootstrapSource.indexOf('function requestManualToolRun', manualResultEnd);
			    assert.ok(toolRunHandlerStart > manualResultEnd, 'expected manual tool run handler after result renderer');
			    const manualResultRenderSection = bootstrapSource.slice(manualResultEnd, toolRunHandlerStart);
			    const toolRunHandlerEnd = bootstrapSource.indexOf('function renderManualToolConfirmation', toolRunHandlerStart);
			    assert.ok(toolRunHandlerEnd > toolRunHandlerStart, 'expected manual tool confirmation after run handler');
			    const toolRunHandlerSection = bootstrapSource.slice(toolRunHandlerStart, toolRunHandlerEnd);
			    const manualConfirmationEnd = bootstrapSource.indexOf('function handleManualToolConfirmationRequired', toolRunHandlerEnd);
			    assert.ok(manualConfirmationEnd > toolRunHandlerEnd, 'expected manual tool confirmation handler after confirmation renderer');
			    const manualConfirmationSection = bootstrapSource.slice(toolRunHandlerEnd, manualConfirmationEnd);
		    const manualConfirmationHandlerEnd = bootstrapSource.indexOf('function handleManualToolResult', manualConfirmationEnd);
		    assert.ok(manualConfirmationHandlerEnd > manualConfirmationEnd, 'expected manual tool result handler after confirmation handler');
		    const manualConfirmationHandlerSection = bootstrapSource.slice(manualConfirmationEnd, manualConfirmationHandlerEnd);
		    const toolStateStart = bootstrapSource.indexOf('function updateToolsCatalogState');
	    assert.ok(toolStateStart >= 0, 'expected tools catalog state helper');
	    const manualResultHandlerSection = bootstrapSource.slice(manualConfirmationHandlerEnd, toolStateStart);
	    const toolStateEnd = bootstrapSource.indexOf('function updateSafetySettingsTitle', toolStateStart);
	    assert.ok(toolStateEnd > toolStateStart, 'expected tools catalog assignment before render');
	    const toolStateSection = bootstrapSource.slice(toolStateStart, toolStateEnd);
	    const modelVisibilityStart = bootstrapSource.indexOf('function setModelPickerListVisible');
	    assert.ok(modelVisibilityStart >= 0, 'expected model picker visibility helper');
	    const toolsVisibilityStart = bootstrapSource.indexOf('function setToolsCatalogVisible', modelVisibilityStart);
	    assert.ok(toolsVisibilityStart > modelVisibilityStart, 'expected tools catalog visibility helper after model picker visibility helper');
	    const visibilityEnd = bootstrapSource.indexOf('function clearModelPickerCache', toolsVisibilityStart);
	    assert.ok(visibilityEnd > toolsVisibilityStart, 'expected cache reset helper after visibility helpers');
	    const modelVisibilitySection = bootstrapSource.slice(modelVisibilityStart, toolsVisibilityStart);
	    const toolsVisibilitySection = bootstrapSource.slice(toolsVisibilityStart, visibilityEnd);

			    assert.match(bootstrapSource, /let\s+modelSearchTextCache\s*=\s*new WeakMap\(\)/);
			    assert.match(bootstrapSource, /let\s+modelPickerRenderKey\s*=\s*''/);
			    assert.match(bootstrapSource, /let\s+modelPickerRenderedState\s*=\s*null/);
			    assert.match(bootstrapSource, /let\s+modelPickerRenderedCurrentModelId\s*=\s*''/);
			    assert.match(bootstrapSource, /let\s+modelPickerRenderedQuery\s*=\s*''/);
			    assert.match(bootstrapSource, /let\s+modelPickerListControls\s*=\s*\[\]/);
			    assert.match(bootstrapSource, /let\s+modelPickerListVisible\s*=\s*false/);
			    assert.match(bootstrapSource, /const\s+modelPickerModelIdByButton\s*=\s*new WeakMap\(\);/);
			    assert.match(bootstrapSource, /let\s+toolsCatalogSearchTextCache\s*=\s*new WeakMap\(\)/);
			    assert.match(bootstrapSource, /let\s+toolsCatalogParamTextCache\s*=\s*new WeakMap\(\)/);
			    assert.match(bootstrapSource, /let\s+toolsCatalogRenderTextCache\s*=\s*new WeakMap\(\)/);
			    assert.match(bootstrapSource, /let\s+toolsCatalogDefaultArgsTextCache\s*=\s*new WeakMap\(\)/);
			    assert.match(bootstrapSource, /let\s+toolsCatalogSearchDisplayQuery\s*=\s*''/);
			    assert.match(bootstrapSource, /let\s+toolsCatalogSearchLocalQuery\s*=\s*''/);
					    assert.match(bootstrapSource, /let\s+toolsCatalogRunnerControls\s*=\s*\[\]/);
					    assert.match(bootstrapSource, /let\s+toolsCatalogConfirmationControls\s*=\s*\[\]/);
						    assert.match(bootstrapSource, /const\s+toolsCatalogRunToolIdByButton\s*=\s*new WeakMap\(\);/);
						    assert.match(bootstrapSource, /const\s+toolsCatalogRunArgsByButton\s*=\s*new WeakMap\(\);/);
						    assert.match(bootstrapSource, /const\s+toolsCatalogRunStatusByButton\s*=\s*new WeakMap\(\);/);
						    assert.match(bootstrapSource, /const\s+toolsCatalogRunStatusByArgs\s*=\s*new WeakMap\(\);/);
					    assert.match(bootstrapSource, /let\s+toolsCatalogVisible\s*=\s*false/);
					    assert.match(bootstrapSource, /let\s+toolsCatalogSearchVisible\s*=\s*false/);
					    assert.match(bootstrapSource, /let\s+toolsCatalogRenderKey\s*=\s*''/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedState\s*=\s*null/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedTools\s*=\s*null/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedFilter\s*=\s*null/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedTotal\s*=\s*0/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedShown\s*=\s*0/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedRawQuery\s*=\s*''/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedLocalQuery\s*=\s*''/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogRenderedOverlayVersion\s*=\s*0/);
				    assert.match(bootstrapSource, /let\s+toolsCatalogOverlayVersion\s*=\s*0/);
				    assert.match(modelVisibilitySection, /modelPickerListVisible === nextVisible/);
				    assert.match(modelVisibilitySection, /modelPickerList\.classList\.toggle\('hidden', !nextVisible\);/);
				    assert.doesNotMatch(modelVisibilitySection, /setHidden\(modelPickerList/);
				    assert.match(toolsVisibilitySection, /toolsCatalogVisible !== nextVisible/);
				    assert.match(toolsVisibilitySection, /toolsCatalog\.classList\.toggle\('hidden', !nextVisible\);/);
				    assert.doesNotMatch(toolsVisibilitySection, /setHidden\(toolsCatalog,/);
				    assert.match(toolsVisibilitySection, /toolsCatalogSearchVisible !== nextVisible/);
				    assert.match(toolsVisibilitySection, /toolsCatalogSearchLabel\.classList\.toggle\('hidden', !nextVisible\);/);
				    assert.doesNotMatch(toolsVisibilitySection, /setHidden\(toolsCatalogSearchLabel/);
			    assert.match(bootstrapSource, /let\s+lastFocusedManualToolConfirmationKey\s*=\s*''/);
					    assert.match(bootstrapSource, /function\s+getModelSearchText\(model\)/);
					    assert.match(modelRenderKeySection, /function\s+appendModelPickerRenderKey\(key, name, models\)/);
					    assert.match(modelRenderKeySection, /appendCompactRenderStateKeyPart\(key, name\);/);
					    assert.match(modelRenderKeySection, /appendCompactRenderStateKeyPart\(key, list\.length\);/);
					    assert.match(modelRenderKeySection, /for \(let i = 0; i < list\.length; i\+\+\)/);
					    assert.match(modelRenderKeySection, /const model = list\[i\];/);
					    assert.match(modelRenderKeySection, /appendCompactRenderStateKeyPart\(key, model\.id\);/);
					    assert.match(modelRenderKeySection, /appendCompactRenderStateKeyPart\(key, model\.maxInputTokens \|\| ''\);/);
					    assert.match(modelRenderKeySection, /appendCompactRenderStateKeyPart\(key, model\.maxOutputTokens \|\| ''\);/);
					    assert.match(modelRenderKeySection, /const key = createCompactRenderStateKeyBuilder\(\);/);
					    assert.match(modelRenderKeySection, /appendCompactRenderStateKeyPart\(key, currentModelId \|\| ''\);/);
					    assert.match(modelRenderKeySection, /appendModelPickerRenderKey\(key, 'favorites', state && state\.favorites\);/);
					    assert.match(modelRenderKeySection, /return finishCompactRenderStateKey\(key\);/);
					    assert.doesNotMatch(modelRenderKeySection, /appendRenderKeyPart\(key, model\.id\)/);
					    assert.doesNotMatch(modelRenderKeySection, /for \(const model of list\)/);
				    assert.doesNotMatch(modelRenderKeySection, /const parts = \[/);
				    assert.doesNotMatch(modelRenderKeySection, /parts\.push/);
				    assert.doesNotMatch(modelRenderKeySection, /parts\.join/);
				    assert.match(bootstrapSource, /function\s+getModelPickerRenderKey\(state, currentModelId, query\)/);
					    assert.match(collectFavoriteSection, /function\s+collectFavoriteModelIds\(models\)/);
					    assert.match(collectFavoriteSection, /for \(let i = 0; i < list\.length; i\+\+\)/);
					    assert.match(collectFavoriteSection, /const model = list\[i\];/);
					    assert.match(collectFavoriteSection, /if \(model && model\.id\) out\.add\(String\(model\.id\)\);/);
						    assert.doesNotMatch(collectFavoriteSection, /for \(const model of list\)/);
						    assert.match(bootstrapSource, /const MODEL_PICKER_DETAIL_LIMIT = 160;/);
						    assert.match(bootstrapSource, /function\s+appendModelDetailText\(text, part\)/);
						    assert.match(bootstrapSource, /function\s+getModelPickerDetailDisplayText\(text\)/);
						    assert.match(bootstrapSource, /value\.length <= MODEL_PICKER_DETAIL_LIMIT/);
						    assert.match(bootstrapSource, /value\.slice\(0, MODEL_PICKER_DETAIL_LIMIT\) \+ '…'/);
						    assert.match(bootstrapSource, /function\s+getModelPickerDetailText\(model, modelId, currentModelId\)/);
						    assert.match(bootstrapSource, /return getModelPickerDetailDisplayText\(detailText\);/);
					    assert.match(modelRenderKeySection, /function\s+modelPickerListsShareRenderableContent\(left, right\)/);
					    assert.match(modelRenderKeySection, /if \(leftList\.length !== rightList\.length\) return false;/);
					    assert.match(modelRenderKeySection, /for \(let index = 0; index < leftList\.length; index\+\+\)/);
					    assert.match(modelRenderKeySection, /if \(leftList\[index\] !== rightList\[index\]\) return false;/);
					    assert.doesNotMatch(modelRenderKeySection, /leftList\.length === 0 && rightList\.length === 0/);
					    assert.match(bootstrapSource, /function\s+requestModelSwitch\(modelId\)/);
					    assert.match(bootstrapSource, /function\s+requestFavoriteModelToggle\(modelId\)/);
					    assert.match(bootstrapSource, /function\s+findModelPickerActionButton\(target, className\)/);
					    assert.match(modelMatchSection, /el\.classList && el\.classList\.contains\(className\)/);
					    assert.doesNotMatch(modelMatchSection, /const classes = ' ' \+ String\(el\.className \|\| ''\) \+ ' ';/);
					    assert.doesNotMatch(modelMatchSection, /classes\.includes\(' ' \+ className \+ ' '\)/);
					    assert.match(bootstrapSource, /function\s+handleModelPickerListClick\(e\)/);
					    assert.match(bootstrapSource, /modelPickerList\.addEventListener\('click', handleModelPickerListClick\);/);
					    assert.match(bootstrapSource, /detailText = appendModelDetailText\(detailText, 'maxOut=' \+ Math\.floor\(maxOutputTokens\)\);/);
					    assert.match(bootstrapSource, /const MODEL_PICKER_SECTION_ID_UNSAFE_RE = \/\[\^a-z0-9\]\+\/g;/);
				    assert.match(bootstrapSource, /function\s+replaceElementChildren\(element, child\)/);
						    assert.match(modelRowSection, /rowEl\.setAttribute\('role', 'listitem'\);/);
						    assert.match(modelRowSection, /const isCurrentModel = modelId === currentModelId;/);
						    assert.match(modelRowSection, /itemEl\.setAttribute\('aria-current', 'true'\);/);
						    assert.match(modelRowSection, /itemEl\.setAttribute\('aria-label', modelLabel \+ ', current model'\);/);
						    assert.match(modelRowSection, /itemEl\.title = 'Current model: ' \+ modelLabel;/);
						    assert.match(modelRowSection, /itemEl\.disabled = true;/);
						    assert.match(modelRowSection, /itemEl\.setAttribute\('aria-label', modelLabel \+ ', switch model'\);/);
						    assert.match(modelRowSection, /itemEl\.title = 'Switch to model: ' \+ modelLabel;/);
							    assert.match(modelRowSection, /const rawModelLabel = String\(model\.name \|\| modelId\);/);
							    assert.match(modelRowSection, /const modelLabel = getModelDisplayText\(rawModelLabel\);/);
							    assert.match(modelRowSection, /const detailText = getModelPickerDetailText\(model, modelId, currentModelId\);/);
							    assert.match(modelRowSection, /detailEl\.textContent = detailText;/);
							    assert.match(modelRowSection, /if \(detailText\) itemEl\.appendChild\(detailEl\);/);
							    assert.match(modelRowSection, /modelPickerModelIdByButton\.set\(itemEl, modelId\);/);
						    assert.doesNotMatch(modelRowSection, /detailParts/);
						    assert.doesNotMatch(modelRowSection, /\.join\(' • '\)/);
						    assert.doesNotMatch(modelRowSection, /\.unshift\(/);
						    assert.doesNotMatch(modelRowSection, /itemEl\.addEventListener\('click'/);
							    assert.match(modelRowSection, /favoriteIcon\.setAttribute\('aria-hidden', 'true'\);/);
							    assert.match(modelRowSection, /favoriteIcon\.textContent = isFavorite \? '★' : '☆';/);
							    assert.match(modelRowSection, /favoriteEl\.appendChild\(favoriteIcon\);/);
							    assert.match(modelRowSection, /favoriteEl\.setAttribute\('aria-label', 'Toggle favorite model: ' \+ modelLabel\);/);
						    assert.match(modelRowSection, /favoriteEl\.setAttribute\('aria-pressed', isFavorite \? 'true' : 'false'\);/);
					    assert.match(modelRowSection, /favoriteEl\.title = \(isFavorite \? 'Remove from favorites: ' : 'Add to favorites: '\) \+ modelLabel;/);
					    assert.match(modelRowSection, /modelPickerModelIdByButton\.set\(favoriteEl, modelId\);/);
						    assert.doesNotMatch(modelRowSection, /favoriteEl\.addEventListener\('click'/);
						    assert.match(modelRowSection, /if \(!isCurrentModel\) modelPickerListControls\.push\(itemEl\);/);
						    assert.match(modelRowSection, /modelPickerListControls\.push\(favoriteEl\);/);
					    assert.match(modelStatusSection, /function\s+formatModelPickerStatus\(shownCount, matchedCount, query\)/);
					    assert.match(modelStatusSection, /shownCount < matchedCount/);
					    assert.match(modelStatusSection, /String\(shownCount\) \+ ' of ' \+ matchedCount/);
					    assert.match(modelStatusSection, /query \? 'No matching models\.' : 'No models available\.'/);
					    assert.match(modelSectionSection, /let rowsFragment = null;/);
					    assert.match(modelSectionSection, /let singleModelRow = null;/);
					    assert.match(modelSectionSection, /function appendModelPickerRow\(row\)/);
				    assert.match(modelSectionSection, /if \(singleModelRow\) \{[\s\S]*rowsFragment = document\.createDocumentFragment\(\);[\s\S]*rowsFragment\.appendChild\(singleModelRow\);[\s\S]*singleModelRow = null;[\s\S]*rowsFragment\.appendChild\(row\);[\s\S]*return;/);
				    assert.doesNotMatch(modelSectionSection, /const rowsFragment = document\.createDocumentFragment\(\);/);
					    assert.match(modelSectionSection, /let renderedCount = 0;/);
					    assert.match(modelSectionSection, /let pendingLastModel = null;/);
					    assert.match(modelSectionSection, /if \(stats\) \{[\s\S]*stats\.matched \+= matchedCount;[\s\S]*stats\.shown \+= renderedCount;[\s\S]*\}/);
					    assert.match(modelSectionSection, /for \(let i = 0; i < models\.length; i\+\+\)/);
				    assert.match(modelSectionSection, /const model = models\[i\];/);
				    assert.match(modelSectionSection, /appendModelPickerRow\(createModelPickerRow\(pendingLastModel, currentModelId, favoriteSet\)\);/);
				    assert.match(modelSectionSection, /groupEl\.setAttribute\('role', 'group'\);/);
				    assert.match(modelSectionSection, /groupEl\.setAttribute\('aria-labelledby', sectionEl\.id\);/);
				    assert.match(modelSectionSection, /groupEl\.appendChild\(rowsFragment \|\| singleModelRow\);/);
				    assert.match(modelSectionSection, /target\.appendChild\(groupEl\);/);
				    assert.match(modelSectionSection, /sectionEl\.id = 'modelPickerSection-' \+ String\(title \|\| 'models'\)\.toLowerCase\(\)\.replace\(MODEL_PICKER_SECTION_ID_UNSAFE_RE, '-'\);/);
				    assert.doesNotMatch(modelSectionSection, /const renderModels = \[\];/);
				    assert.doesNotMatch(modelSectionSection, /renderModels\.push/);
				    assert.doesNotMatch(modelSectionSection, /for \(const model of renderModels\)/);
					    assert.doesNotMatch(modelSectionSection, /for \(const model of models\)/);
					    assert.doesNotMatch(modelSectionSection, /modelPickerList\.appendChild/);
					    assert.doesNotMatch(modelSectionSection, /\.replace\(\//);
				    assert.match(modelStateSection, /const modelPickerSectionStats = \{ matched: 0, shown: 0 \};/);
				    assert.match(modelStateSection, /renderModelPickerSection\(sectionTarget, 'Favorites'[\s\S]*modelPickerSectionStats\);/);
				    assert.match(modelStateSection, /renderModelPickerSection\(sectionTarget, 'Recent'[\s\S]*modelPickerSectionStats\);/);
				    assert.match(modelStateSection, /renderModelPickerSection\(sectionTarget, 'All models'[\s\S]*modelPickerSectionStats\);/);
				    assert.match(modelStateSection, /if \(!modelPickerSectionStats\.matched\)/);
				    assert.match(modelStateSection, /formatModelPickerStatus\(modelPickerSectionStats\.shown, modelPickerSectionStats\.matched, query\)/);
			    assert.match(bootstrapSource, /function\s+hasToolCatalogSchemaDefault\(schema\)/);
		    assert.match(bootstrapSource, /function\s+getToolCatalogDefaultRenderKey\(schema\)/);
		    assert.match(defaultArgsSection, /const requiredParamNames = getToolCatalogParamText\(tool\)\.requiredParamNames \|\| \[\];/);
		    assert.match(defaultArgsSection, /for \(let i = 0; i < requiredParamNames\.length; i\+\+\)/);
		    assert.match(defaultArgsSection, /const name = requiredParamNames\[i\];/);
		    assert.match(defaultArgsSection, /if \(hasToolCatalogSchemaDefault\(schema\)\)/);
		    assert.match(defaultArgsSection, /args\[name\] = schema\.default;/);
		    assert.match(defaultArgsSection, /function\s+getDefaultToolArgsText\(tool\)/);
		    assert.match(defaultArgsSection, /toolsCatalogDefaultArgsTextCache\.get\(tool\)/);
		    assert.match(defaultArgsSection, /toolsCatalogDefaultArgsTextCache\.set\(tool, text\);/);
		    assert.match(bootstrapSource, /argsEl\.value = getDefaultToolArgsText\(tool\);/);
		    assert.match(toolStateSection, /toolsCatalogDefaultArgsTextCache = new WeakMap\(\);/);
		    assert.doesNotMatch(bootstrapSource, /argsEl\.value = JSON\.stringify\(buildDefaultToolArgs\(tool\), null, 2\);/);
		    assert.doesNotMatch(defaultArgsSection, /Object\.keys\(properties\)/);
			    assert.match(bootstrapSource, /function\s+getToolCatalogParamText\(tool\)/);
		    assert.match(toolParamSection, /const paramRenderKey = createCompactRenderStateKeyBuilder\(\);/);
		    assert.match(toolParamSection, /let paramCount = 0;/);
		    assert.match(toolParamSection, /if \(properties\) for \(const param in properties\)/);
		    assert.match(toolParamSection, /Object\.prototype\.hasOwnProperty\.call\(properties, param\)/);
		    assert.match(toolParamSection, /const requiredParamNames = \[\];/);
		    assert.match(toolParamSection, /paramCount\+\+;/);
		    assert.match(toolParamSection, /if \(isRequired\) requiredParamNames\.push\(param\);/);
		    assert.match(toolParamSection, /appendCompactRenderStateKeyPart\(paramRenderKey, param\);/);
		    assert.match(toolParamSection, /appendCompactRenderStateKeyPart\(paramRenderKey, isRequired \? '1' : '0'\);/);
		    assert.match(toolParamSection, /appendCompactRenderStateKeyPart\(paramRenderKey, schema\.type\);/);
		    assert.match(toolParamSection, /renderText \+= param \+ \(isRequired \? '\*' : ''\);/);
		    assert.match(toolParamSection, /appendCompactRenderStateKeyPart\(paramRenderKey, paramCount\);/);
		    assert.match(toolParamSection, /const renderKey = finishCompactRenderStateKey\(paramRenderKey\);/);
		    assert.match(toolParamSection, /if \(paramCount\) renderText = 'Params: ' \+ renderText;/);
		    assert.match(toolParamSection, /const out = \{ searchText, renderKey, renderText, requiredParamNames \};/);
		    assert.doesNotMatch(toolParamSection, /paramRenderKey = appendRenderKeyPart/);
		    assert.doesNotMatch(toolParamSection, /Object\.keys\(properties\)/);
					    assert.match(bootstrapSource, /function\s+getToolCatalogSearchText\(tool\)/);
					    assert.match(bootstrapSource, /function\s+getToolCatalogRenderText\(tool\)/);
					    assert.match(toolRenderTextSection, /const paramText = getToolCatalogParamText\(tool\);/);
					    assert.match(toolRenderTextSection, /const key = createCompactRenderStateKeyBuilder\(\);/);
					    assert.match(toolRenderTextSection, /appendCompactRenderStateKeyPart\(key, paramText\.renderKey\);/);
					    assert.match(toolRenderTextSection, /for \(let i = 0; i < paramText\.requiredParamNames\.length; i\+\+\)/);
					    assert.match(toolRenderTextSection, /const name = paramText\.requiredParamNames\[i\];/);
					    assert.match(toolRenderTextSection, /const defaultRenderKey = getToolCatalogDefaultRenderKey\(schema\);/);
					    assert.match(toolRenderTextSection, /appendCompactRenderStateKeyPart\(key, defaultRenderKey === null \? '0' : '1'\);/);
					    assert.match(toolRenderTextSection, /if \(defaultRenderKey !== null\) appendCompactRenderStateKeyPart\(key, defaultRenderKey\);/);
					    assert.match(toolRenderTextSection, /const renderKey = finishCompactRenderStateKey\(key\);/);
					    assert.doesNotMatch(toolRenderTextSection, /appendRenderKeyPart\(key,/);
					    assert.doesNotMatch(defaultArgsSection, /for \(const name of requiredParamNames\)/);
					    assert.doesNotMatch(toolRenderTextSection, /for \(const name of paramText\.requiredParamNames\)/);
					    assert.match(toolCollectSection, /const renderKey = createCompactRenderStateKeyBuilder\(\);/);
					    assert.match(toolCollectSection, /if \(!query\)/);
						    assert.match(toolCollectSection, /const limit = Math\.min\(tools\.length, TOOLS_CATALOG_RENDER_LIMIT\);/);
						    assert.match(toolCollectSection, /for \(let i = 0; i < limit; i\+\+\)/);
						    assert.match(toolCollectSection, /return \{ matchedCount: tools\.length, renderTools, renderKey: finishCompactRenderStateKey\(renderKey\) \};/);
						    assert.match(toolCollectSection, /for \(let i = 0; i < tools\.length; i\+\+\)/);
						    assert.match(toolCollectSection, /const tool = tools\[i\];/);
						    assert.match(toolCollectSection, /appendCompactRenderStateKeyPart\(renderKey, getToolCatalogRenderText\(tool\)\);/);
						    assert.match(toolCollectSection, /return \{ matchedCount, renderTools, renderKey: finishCompactRenderStateKey\(renderKey\) \};/);
						    assert.doesNotMatch(toolCollectSection, /renderKey = appendRenderKeyPart/);
						    assert.doesNotMatch(toolCollectSection, /for \(const tool of tools\)/);
					    assert.match(bootstrapSource, /function\s+getToolsCatalogRenderKey\(catalog, total, shown, rawQuery, localQuery, visibleToolCount, visibleToolsRenderKey\)/);
					    assert.match(bootstrapSource, /function\s+appendToolsCatalogBadge\(target, text\)/);
					    assert.match(bootstrapSource, /const toolsCatalogStatus = document\.getElementById\('toolsCatalogStatus'\);/);
						    assert.match(bootstrapSource, /function\s+setPendingManualToolConfirmation\(next\)/);
						    assert.match(bootstrapSource, /function\s+manualToolConfirmationsEqual\(left, right\)/);
						    assert.match(bootstrapSource, /left\.args === right\.args/);
						    assert.match(bootstrapSource, /stringListsEqual\(left\.reasons \|\| \[\], right\.reasons \|\| \[\]\)/);
						    assert.match(bootstrapSource, /if \(manualToolConfirmationsEqual\(pendingManualToolConfirmation, value\)\) return false;/);
							    assert.match(bootstrapSource, /if \(!pendingManualToolConfirmation\) lastFocusedManualToolConfirmationKey = '';/);
							    assert.match(bootstrapSource, /return true;/);
								    assert.match(bootstrapSource, /function\s+setLatestManualToolResult\(next, renderInfoOverride\)/);
									    assert.match(bootstrapSource, /let\s+latestManualToolResultRenderKey\s*=\s*''/);
									    assert.match(bootstrapSource, /let\s+latestManualToolResultSummaryText\s*=\s*''/);
										    assert.match(bootstrapSource, /let\s+latestManualToolResultOutputText\s*=\s*''/);
										    assert.match(bootstrapSource, /let\s+latestManualToolResultOutputPreviewText\s*=\s*''/);
										    assert.match(bootstrapSource, /const MANUAL_TOOL_RESULT_SUMMARY_LIMIT = 240;/);
										    assert.match(bootstrapSource, /const MANUAL_TOOL_RESULT_OUTPUT_PREVIEW_LIMIT = 4000;/);
									    assert.match(bootstrapSource, /function\s+getManualToolResultRenderInfo\(result\)/);
									    assert.match(bootstrapSource, /const outputText = formatManualToolResultOutput\(value\.data\);/);
									    assert.match(bootstrapSource, /const outputPreviewText = getManualToolResultOutputPreview\(outputText\);/);
									    assert.match(bootstrapSource, /const summaryText = getManualToolResultSummary\(value\);/);
									    assert.match(bootstrapSource, /const renderKeyBuilder = createCompactRenderStateKeyBuilder\(\);/);
									    assert.match(bootstrapSource, /appendCompactRenderStateKeyPart\(renderKeyBuilder, summaryText\);/);
									    assert.match(bootstrapSource, /appendCompactRenderStateKeyPart\(renderKeyBuilder, outputText\.length\);/);
									    assert.match(bootstrapSource, /appendCompactRenderStateKeyPart\(renderKeyBuilder, outputPreviewText\);/);
									    assert.match(bootstrapSource, /const renderKey = finishCompactRenderStateKey\(renderKeyBuilder\);/);
									    assert.match(bootstrapSource, /outputPreviewText,/);
									    assert.match(bootstrapSource, /renderKey,/);
									    assert.doesNotMatch(bootstrapSource, /appendRenderKeyPart\(renderKey, outputPreviewText\)/);
									    assert.doesNotMatch(bootstrapSource, /appendRenderKeyPart\(key, formatManualToolResultOutput\(value\.data\)\)/);
									    assert.doesNotMatch(bootstrapSource, /function\s+getManualToolResultRenderKey\(/);
									    assert.doesNotMatch(bootstrapSource, /function\s+getManualToolResultRenderKeyFromParts/);
									    assert.match(bootstrapSource, /latestManualToolResultRenderKey === renderKey/);
									    assert.match(bootstrapSource, /latestManualToolResultRenderKey = renderKey;/);
									    assert.match(bootstrapSource, /latestManualToolResultSummaryText = info \? info\.summaryText : '';/);
									    assert.match(bootstrapSource, /latestManualToolResultOutputText = info \? info\.outputText : '';/);
									    assert.match(bootstrapSource, /latestManualToolResultOutputPreviewText = info \? info\.outputPreviewText : '';/);
									    assert.match(bootstrapSource, /function\s+getManualToolResultSummary\(result\)/);
									    assert.match(bootstrapSource, /function\s+getManualToolResultSummaryText\(text\)/);
									    assert.match(bootstrapSource, /value\.length <= MANUAL_TOOL_RESULT_SUMMARY_LIMIT/);
									    assert.match(bootstrapSource, /value\.slice\(0, MANUAL_TOOL_RESULT_SUMMARY_LIMIT\) \+ '…'/);
									    assert.match(bootstrapSource, /return getManualToolResultSummaryText\('Tool ' \+ toolId \+ ' ' \+ status \+ details\);/);
									    assert.match(bootstrapSource, /function\s+formatManualToolResultOutput\(data\)/);
								    assert.match(bootstrapSource, /function\s+getManualToolResultOutputPreview\(outputText\)/);
								    assert.match(bootstrapSource, /text\.length <= MANUAL_TOOL_RESULT_OUTPUT_PREVIEW_LIMIT/);
								    assert.match(bootstrapSource, /text\.slice\(0, MANUAL_TOOL_RESULT_OUTPUT_PREVIEW_LIMIT\) \+ '\\n… \(output preview truncated\)'/);
								    assert.doesNotMatch(bootstrapSource, /function\s+getManualToolResultOutputRenderKey/);
							    assert.match(bootstrapSource, /const TOOLS_CATALOG_DOM_ID_UNSAFE_RE = \/\[\^a-zA-Z0-9_-\]\+\/g;/);
								    assert.match(manualResultSection, /const changed = setLatestManualToolResult\(data, renderInfo\);/);
								    assert.match(manualResultSection, /if \(changed && data && typeof data === 'object'\)/);
								    assert.match(manualResultSection, /return changed;/);
								    assert.match(manualResultSection, /announceStatus\(latestManualToolResultSummaryText\);/);
							    assert.match(manualResultSection, /if \(data === null\) return 'null';/);
							    assert.match(manualResultSection, /JSON\.stringify\(data, null, 2\)/);
							    assert.doesNotMatch(manualResultSection, /toolsCatalog\.insertBefore|document\.createElement|appendChild/);
									    assert.match(manualResultRenderSection, /summaryEl\.textContent = latestManualToolResultSummaryText;/);
									    assert.match(manualResultRenderSection, /const outputText = latestManualToolResultOutputText;/);
										    assert.match(manualResultRenderSection, /if \(outputText !== ''\)/);
										    assert.match(manualResultRenderSection, /const outputPreviewText = latestManualToolResultOutputPreviewText;/);
									    assert.match(manualResultRenderSection, /preEl\.setAttribute\('tabindex', '0'\);/);
								    assert.match(manualResultRenderSection, /preEl\.setAttribute\('data-scrollable', 'true'\);/);
								    assert.match(manualResultRenderSection, /preEl\.setAttribute\('aria-label', 'Tool output preview'\);/);
								    assert.match(manualResultRenderSection, /preEl\.textContent = outputPreviewText;/);
								    assert.doesNotMatch(manualResultRenderSection, /preEl\.textContent = outputText;/);
								    assert.match(manualResultRenderSection, /target\.appendChild\(resultEl\);/);
									    assert.doesNotMatch(manualResultRenderSection, /toolsCatalog\.insertBefore|toolsCatalog\.appendChild/);
									    assert.doesNotMatch(manualResultRenderSection, /formatManualToolResultOutput/);
									    assert.doesNotMatch(manualResultRenderSection, /getManualToolResultOutputPreview/);
									    assert.doesNotMatch(manualResultRenderSection, /getManualToolResultSummary/);
								    assert.doesNotMatch(manualResultRenderSection, /if \(latestManualToolResult\.data\)/);
								    assert.doesNotMatch(manualResultRenderSection, /String\(latestManualToolResult\.data\)/);
				    assert.match(manualConfirmationSection, /confirmationEl\.setAttribute\('role', 'group'\);/);
				    assert.match(bootstrapSource, /const MANUAL_TOOL_CONFIRMATION_TOOL_NAME_LIMIT = 120;/);
				    assert.match(bootstrapSource, /const MANUAL_TOOL_CONFIRMATION_REASON_LIMIT = 240;/);
				    assert.match(bootstrapSource, /function\s+getManualToolConfirmationDisplayText\(text, limit\)/);
				    assert.match(manualConfirmationSection, /const displayToolName = getManualToolConfirmationDisplayText\(toolName, MANUAL_TOOL_CONFIRMATION_TOOL_NAME_LIMIT\);/);
				    assert.match(manualConfirmationSection, /const displayReasons = getManualToolConfirmationDisplayText\(reasons, MANUAL_TOOL_CONFIRMATION_REASON_LIMIT\);/);
				    assert.match(bootstrapSource, /function\s+focusManualToolConfirmationOnce\(target\)/);
				    assert.match(bootstrapSource, /function\s+focusManualToolRunButton\(toolId\)/);
					    assert.match(bootstrapSource, /function\s+isManualToolControlFocused\(\)/);
					    assert.match(bootstrapSource, /focusInlineConfirmationTarget\(target\)/);
					    assert.match(bootstrapSource, /lastFocusedManualToolConfirmationKey = focusKey;/);
						    assert.match(bootstrapSource, /for \(let controlIndex = 0; controlIndex < toolsCatalogRunnerControls\.length; controlIndex\+\+\) \{[\s\S]*const el = toolsCatalogRunnerControls\[controlIndex\];[\s\S]*toolsCatalogRunToolIdByButton\.get\(el\) !== expectedToolId/);
						    assert.match(bootstrapSource, /for \(let controlIndex = 0; controlIndex < toolsCatalogConfirmationControls\.length; controlIndex\+\+\) \{[\s\S]*const el = toolsCatalogConfirmationControls\[controlIndex\];[\s\S]*if \(el === activeElement\) return true;/);
						    assert.match(bootstrapSource, /toolsCatalogRunToolIdByButton\.get\(el\) !== expectedToolId/);
						    assert.doesNotMatch(bootstrapSource, /el\.dataset\.toolId !== expectedToolId/);
						    assert.doesNotMatch(bootstrapSource, /for \(const el of toolsCatalog(?:Runner|Confirmation)Controls\)/);
						    assert.match(toolRunHandlerSection, /function requestManualToolRun\(button\)/);
						    assert.match(toolRunHandlerSection, /const argsText = argsEl && typeof argsEl\.value === 'string' \? argsEl\.value : '';/);
						    assert.match(toolRunHandlerSection, /const parsed = hasNonWhitespaceText\(argsText\) \? JSON\.parse\(argsText\) : \{\};/);
						    assert.doesNotMatch(toolRunHandlerSection, /argsEl\.value\.trim\(\)/);
						    assert.match(toolRunHandlerSection, /function findToolsCatalogRunButton\(target\)/);
						    assert.match(toolRunHandlerSection, /function handleToolsCatalogClick\(e\)/);
						    assert.match(toolRunHandlerSection, /function handleToolsCatalogInput\(e\)/);
						    assert.match(bootstrapSource, /toolsCatalog\.addEventListener\('click', handleToolsCatalogClick\);/);
						    assert.match(bootstrapSource, /toolsCatalog\.addEventListener\('input', handleToolsCatalogInput\);/);
				    assert.match(manualConfirmationSection, /confirmationEl\.setAttribute\('aria-labelledby', titleEl\.id\);/);
				    assert.match(manualConfirmationSection, /const confirmationId = 'toolsCatalogConfirmation-' \+ toolId\.replace\(TOOLS_CATALOG_DOM_ID_UNSAFE_RE, '-'\);/);
			    assert.match(manualConfirmationSection, /confirmationEl\.setAttribute\('aria-describedby', reasonEl\.id\);/);
			    assert.match(manualConfirmationSection, /cancelEl\.setAttribute\('aria-label', 'Cancel guarded tool run'\);/);
			    assert.match(manualConfirmationSection, /titleEl\.textContent = 'Run guarded tool "' \+ displayToolName \+ '"\?';/);
			    assert.match(manualConfirmationSection, /reasonEl\.textContent = 'This tool is guarded because ' \+ displayReasons \+ \(displayReasons\.endsWith\('…'\) \? '' : '\.'\);/);
			    assert.match(manualConfirmationSection, /runEl\.setAttribute\('aria-label', 'Run guarded tool "' \+ displayToolName \+ '"'\);/);
			    assert.match(manualConfirmationSection, /const returnToolId = toolId;/);
			    assert.match(manualConfirmationSection, /focusManualToolRunButton\(returnToolId\)/);
			    assert.match(manualConfirmationSection, /focusInlineConfirmationTarget\(toolsCatalogSearchInput\)/);
			    assert.match(manualConfirmationSection, /for \(let i = 0; i < pendingManualToolConfirmation\.reasons\.length; i\+\+\)/);
			    assert.match(manualConfirmationSection, /const reason = pendingManualToolConfirmation\.reasons\[i\];/);
			    assert.doesNotMatch(manualConfirmationSection, /for \(const reason of pendingManualToolConfirmation\.reasons\)/);
			    assert.match(manualConfirmationSection, /function normalizeManualToolConfirmationReasons\(raw\)/);
			    assert.match(manualConfirmationSection, /for \(let i = 0; i < raw\.length; i\+\+\)/);
			    assert.match(manualConfirmationSection, /if \(raw\[i\]\) reasons\.push\(raw\[i\]\);/);
				    assert.match(manualConfirmationHandlerSection, /normalizeManualToolConfirmationReasons\(data && data\.reasons\)/);
				    assert.match(manualConfirmationHandlerSection, /const changed = setPendingManualToolConfirmation/);
				    assert.match(manualConfirmationHandlerSection, /if \(!changed\) return;/);
				    assert.match(manualResultHandlerSection, /const restoreFocus = isManualToolControlFocused\(\);/);
				    assert.match(manualResultHandlerSection, /const wasManualToolRunBusy = manualToolRunBusy;/);
					    assert.match(manualResultHandlerSection, /const nextResultRenderInfo = getManualToolResultRenderInfo\(data\);/);
					    assert.match(manualResultHandlerSection, /const nextResultRenderKey = nextResultRenderInfo \? nextResultRenderInfo\.renderKey : '';/);
					    assert.match(manualResultHandlerSection, /nextResultRenderKey === latestManualToolResultRenderKey/);
					    assert.match(manualResultHandlerSection, /const resultToolId = pendingManualToolConfirmation && pendingManualToolConfirmation\.toolId/);
					    assert.match(manualResultHandlerSection, /showManualToolResult\(data, nextResultRenderInfo\);/);
			    assert.match(manualResultHandlerSection, /focusManualToolRunButton\(resultToolId\)/);
			    assert.match(manualResultHandlerSection, /focusInlineConfirmationTarget\(toolsCatalogSearchInput\)/);
				    assert.match(manualConfirmationSection, /toolsCatalogConfirmationControls\.push\(cancelEl, runEl\);/);
				    assert.match(manualConfirmationSection, /if \(reasonEl\) confirmationEl\.appendChild\(reasonEl\);/);
					    assert.match(manualConfirmationSection, /target\.appendChild\(confirmationEl\);/);
					    assert.match(manualConfirmationSection, /return cancelEl;/);
					    assert.doesNotMatch(manualConfirmationSection, /toolsCatalog\.insertBefore|toolsCatalog\.appendChild/);
					    assert.doesNotMatch(manualConfirmationSection, /\.filter\(Boolean\)\.join/);
					    assert.doesNotMatch(manualConfirmationSection, /\.replace\(\//);
			    assert.doesNotMatch(manualConfirmationSection + manualConfirmationHandlerSection, /\.filter\(Boolean\)/);
			    assert.match(modelMatchSection, /getModelSearchText\(model\)\.indexOf\(query\) >= 0/);
		    assert.doesNotMatch(modelMatchSection, /\.filter\(Boolean\)\.join/);
			    assert.match(toolMatchSection, /getToolCatalogSearchText\(tool\)\.indexOf\(query\) >= 0/);
			    assert.doesNotMatch(toolMatchSection, /\.filter\(Boolean\)\.join/);
				    assert.match(toolRenderKeySection, /const key = createCompactRenderStateKeyBuilder\(\);/);
				    assert.match(toolRenderKeySection, /for \(let filterIndex = 0; filterIndex < filter\.length; filterIndex\+\+\) \{[\s\S]*appendCompactRenderStateKeyPart\(key, filter\[filterIndex\]\);[\s\S]*\}/);
				    assert.match(toolRenderKeySection, /appendCompactRenderStateKeyPart\(key, toolsCatalogOverlayVersion\);/);
				    assert.match(toolRenderKeySection, /appendCompactRenderStateKeyPart\(key, visibleToolsRenderKey \|\| ''\);/);
				    assert.match(toolRenderKeySection, /return finishCompactRenderStateKey\(key\);/);
				    assert.doesNotMatch(toolRenderKeySection, /key \+= visibleToolsRenderKey/);
				    assert.doesNotMatch(toolRenderKeySection, /for \(const item of filter\)/);
				    assert.doesNotMatch(toolRenderKeySection, /for \(const tool of visibleTools\)/);
			    assert.doesNotMatch(toolRenderKeySection, /latestManualToolResult\.data/);
			    assert.match(toolStateSection, /const manualToolConfirmationFocusTarget = pendingManualToolConfirmation[\s\S]*renderManualToolConfirmation\(catalogTarget\)[\s\S]*: null;/);
			    assert.match(toolStateSection, /focusManualToolConfirmationOnce\(manualToolConfirmationFocusTarget\);/);
				    const modelPickerRenderedFastPathIndex = modelStateSection.indexOf('modelPickerRenderedState === currentModelPickerState');
				    const modelPickerRenderKeyIndex = modelStateSection.indexOf('const nextRenderKey = options && typeof options.renderKey');
				    assert.ok(modelPickerRenderedFastPathIndex >= 0, 'expected rendered-state fast path before model picker render-key scan');
				    assert.ok(modelPickerRenderKeyIndex > modelPickerRenderedFastPathIndex, 'expected rendered-state fast path before model picker render-key scan');
				    assert.match(modelStateSection, /modelPickerRenderedCurrentModelId === currentModelId/);
				    assert.match(modelStateSection, /modelPickerRenderedQuery === query/);
				    assert.match(modelStateSection, /modelPickerRenderedState = currentModelPickerState;/);
				    assert.match(modelStateSection, /modelPickerRenderedCurrentModelId = currentModelId;/);
				    assert.match(modelStateSection, /modelPickerRenderedQuery = query;/);
				    assert.match(modelStateSection, /const nextRenderKey = options && typeof options\.renderKey === 'string' && options\.renderKey[\s\S]*\? options\.renderKey[\s\S]*: getModelPickerRenderKey\(currentModelPickerState, currentModelId, query\);/);
			    assert.match(modelStateSection, /if \(nextRenderKey === modelPickerRenderKey\)/);
			    assert.match(modelStateSection, /modelPickerRenderKey = nextRenderKey;/);
			    assert.match(modelStateSection, /const query = modelPickerSearchLocalQuery;/);
			    assert.match(modelStateSection, /modelPickerSearchDisplayQuery/);
			    assert.doesNotMatch(modelStateSection, /modelPickerSearchQuery\.trim\(\)/);
			    assert.doesNotMatch(modelStateSection, /modelPickerSearchQuery\.trim\(\)\.toLowerCase\(\)/);
			    assert.match(modelStateSection, /setModelPickerListVisible\(false\);/);
				    assert.match(modelStateSection, /setModelPickerListVisible\(true\);/);
					    assert.match(modelStateSection, /setTextContent\(modelPickerStatus, formatModelPickerStatus\(modelPickerSectionStats\.shown, modelPickerSectionStats\.matched, query\)\);/);
				    assert.match(clearModelCacheSection + modelStateSection, /setTextContent\(modelPickerStatus, ''\);/);
				    assert.match(bootstrapSource, /function\s+cancelModelPickerSearchRender\(\)/);
				    assert.match(clearModelCacheSection, /cancelModelPickerSearchRender\(\);/);
				    assert.match(modelStateSection, /cancelModelPickerSearchRender\(\);/);
				    assert.match(clearModelCacheSection, /setModelPickerListVisible\(false\);/);
				    assert.match(clearModelCacheSection, /setValue\(modelPickerSearchInput, ''\);/);
			    assert.match(clearModelCacheSection, /replaceElementChildren\(modelPickerList\);/);
				    assert.doesNotMatch(clearModelCacheSection, /modelPickerSearchInput\.value = '';/);
				    assert.match(modelStateSection, /const favoriteIds = collectFavoriteModelIds\(currentModelPickerState\.favorites \|\| \[\]\);/);
			    assert.match(modelStateSection, /let sectionsFragment = null;/);
			    assert.match(modelStateSection, /let singleSectionGroup = null;/);
			    assert.match(modelStateSection, /sectionsFragment = document\.createDocumentFragment\(\);/);
			    assert.match(modelStateSection, /renderModelPickerSection\(sectionTarget, 'Favorites'/);
			    assert.match(modelStateSection, /replaceElementChildren\(modelPickerList, emptyEl\);/);
			    assert.match(modelStateSection, /replaceElementChildren\(modelPickerList, sectionsFragment \|\| singleSectionGroup\);/);
			    assert.doesNotMatch(modelStateSection, /const fragment = document\.createDocumentFragment\(\);/);
				    assert.doesNotMatch(modelStateSection, /\.map\(\(model\) => model && model\.id/);
				    assert.doesNotMatch(modelStateSection, /\.filter\(Boolean\)/);
			    assert.doesNotMatch(clearModelCacheSection + modelStateSection, /modelPickerList\.innerHTML = '';/);
			    assert.doesNotMatch(modelStateSection, /modelPickerList\.appendChild/);
				    assert.doesNotMatch(clearModelCacheSection + modelStateSection, /modelPickerList\.classList\.(?:add|remove|toggle)\(['"]hidden['"]/);
				    assert.doesNotMatch(clearModelCacheSection + modelStateSection, /setHidden\(modelPickerList/);
			    assert.match(modelStateSection, /modelSearchTextCache = new WeakMap\(\);/);
				    assert.match(toolStateSection, /const previousTools = currentToolsCatalog && Array\.isArray\(currentToolsCatalog\.tools\) \? currentToolsCatalog\.tools : null;/);
				    assert.match(bootstrapSource, /function\s+toolsCatalogListsShareRenderableContent\(left, right\)/);
				    assert.match(toolRenderKeySection, /if \(leftList\.length !== rightList\.length\) return false;/);
				    assert.match(toolRenderKeySection, /for \(let index = 0; index < leftList\.length; index\+\+\)/);
				    assert.match(toolRenderKeySection, /if \(leftItem !== rightItem\) return false;/);
				    assert.match(toolRenderKeySection, /if \(leftItem !== null && typeof leftItem === 'object'\) return false;/);
				    assert.doesNotMatch(toolRenderKeySection, /leftList\.length === 0 && rightList\.length === 0/);
				    assert.match(bootstrapSource, /function\s+isToolsCatalogReferenceCurrent\(catalog, total, shown, rawQuery, localQuery\)/);
				    assert.match(bootstrapSource, /function\s+cancelToolsCatalogSearchRender\(\)/);
				    assert.match(toolStateSection, /cancelToolsCatalogSearchRender\(\);/);
				    assert.match(toolStateSection, /const toolsCatalogReferenceCurrent = isToolsCatalogReferenceCurrent\(nextToolsCatalog, total, shown, rawQuery, localQuery\);/);
				    assert.match(toolStateSection, /if \(toolsCatalogReferenceCurrent\) \{[\s\S]*toolsCatalogRenderedState = currentToolsCatalog;[\s\S]*return;[\s\S]*\}/);
				    assert.ok(
				      toolStateSection.indexOf('const toolsCatalogReferenceCurrent = isToolsCatalogReferenceCurrent') <
				        toolStateSection.indexOf('if (nextTools !== previousTools)'),
				      'expected tool catalog reference fast path before cache reset checks'
				    );
				    assert.ok(
				      toolStateSection.indexOf('const toolsCatalogReferenceCurrent = isToolsCatalogReferenceCurrent') <
				        toolStateSection.indexOf('const catalogMatches = collectToolsCatalogMatches(tools, localQuery);'),
				      'expected tool catalog reference fast path before visible tool collection'
				    );
					    assert.match(toolStateSection, /toolsCatalogSearchTextCache = new WeakMap\(\);/);
				    assert.match(toolStateSection, /toolsCatalogParamTextCache = new WeakMap\(\);/);
				    assert.match(toolStateSection, /toolsCatalogRenderTextCache = new WeakMap\(\);/);
				    assert.match(toolStateSection, /replaceElementChildren\(toolsCatalog\);/);
				    assert.match(toolStateSection, /toolsCatalogRenderedTools = null;/);
				    assert.match(toolStateSection, /toolsCatalogRenderedFilter = null;/);
				    assert.match(toolStateSection, /setTextContent\(toolsCatalogStatus, ''\);/);
		    assert.match(toolStateSection, /setToolsCatalogVisible\(false\);/);
				    assert.match(toolStateSection, /setToolsCatalogVisible\(true\);/);
				    assert.doesNotMatch(toolStateSection, /setHidden\(toolsCatalog/);
				    assert.match(toolStateSection, /setValue\(toolsCatalogSearchInput, toolsCatalogSearchQuery\);/);
				    const toolsCatalogRenderedFastPathIndex = toolStateSection.indexOf('toolsCatalogRenderedState === currentToolsCatalog');
				    const toolsCatalogCollectIndex = toolStateSection.indexOf('const catalogMatches = collectToolsCatalogMatches(tools, localQuery);');
				    assert.ok(toolsCatalogRenderedFastPathIndex >= 0, 'expected rendered-state fast path before tool catalog scan');
				    assert.ok(toolsCatalogCollectIndex > toolsCatalogRenderedFastPathIndex, 'expected rendered-state fast path before tool catalog scan');
					    assert.match(toolStateSection, /const rawQuery = toolsCatalogSearchDisplayQuery;/);
					    assert.match(toolStateSection, /const localQuery = toolsCatalogSearchLocalQuery;/);
					    assert.match(bootstrapSource, /function\s+normalizeToolsCatalogCount\(value, fallback\)/);
					    assert.match(bootstrapSource, /Number\.isFinite\(count\) && count >= 0 \? Math\.floor\(count\) : fallbackCount/);
					    assert.match(toolStateSection, /const shown = Math\.max\(tools\.length, normalizeToolsCatalogCount\(nextToolsCatalog && nextToolsCatalog\.shown, tools\.length\)\);/);
					    assert.match(toolStateSection, /const total = Math\.max\(shown, normalizeToolsCatalogCount\(nextToolsCatalog && nextToolsCatalog\.total, shown\)\);/);
					    assert.match(toolStateSection, /toolsCatalogRenderedTotal === total/);
					    assert.match(toolStateSection, /toolsCatalogRenderedShown === shown/);
					    assert.doesNotMatch(toolStateSection, /Number\.isFinite\(Number\(nextToolsCatalog\.total\)\) \? Number\(nextToolsCatalog\.total\)/);
					    assert.doesNotMatch(toolStateSection, /Number\.isFinite\(Number\(nextToolsCatalog\.shown\)\) \? Number\(nextToolsCatalog\.shown\)/);
					    assert.match(toolStateSection, /toolsCatalogRenderedRawQuery === rawQuery/);
				    assert.match(toolStateSection, /toolsCatalogRenderedLocalQuery === localQuery/);
				    assert.match(toolStateSection, /toolsCatalogRenderedOverlayVersion === toolsCatalogOverlayVersion/);
				    assert.match(toolStateSection, /toolsCatalogRenderedState = currentToolsCatalog;/);
				    assert.match(toolStateSection, /toolsCatalogRenderedTools = tools;/);
				    assert.match(toolStateSection, /toolsCatalogRenderedFilter = Array\.isArray\(currentToolsCatalog\.filter\) \? currentToolsCatalog\.filter : \[\];/);
				    assert.match(toolStateSection, /toolsCatalogRenderedTotal = total;/);
				    assert.match(toolStateSection, /toolsCatalogRenderedShown = shown;/);
				    assert.match(toolStateSection, /toolsCatalogRenderedRawQuery = rawQuery;/);
				    assert.match(toolStateSection, /toolsCatalogRenderedLocalQuery = localQuery;/);
				    assert.match(toolStateSection, /toolsCatalogRenderedOverlayVersion = toolsCatalogOverlayVersion;/);
							    assert.match(toolStateSection, /const visibleToolsRenderKey = catalogMatches\.renderKey;/);
							    assert.match(bootstrapSource, /function\s+getToolsCatalogSummaryText\(total, shown, filter, rawQuery, localQuery, visibleToolCount, visibleToolShown\)/);
							    assert.match(bootstrapSource, /const TOOLS_CATALOG_SUMMARY_QUERY_LIMIT = 80;/);
							    assert.match(bootstrapSource, /const TOOLS_CATALOG_SUMMARY_FILTER_LIMIT = 240;/);
							    assert.match(bootstrapSource, /const TOOLS_CATALOG_ID_DISPLAY_LIMIT = 160;/);
							    assert.match(bootstrapSource, /const TOOLS_CATALOG_DESCRIPTION_LIMIT = 240;/);
							    assert.match(bootstrapSource, /const TOOLS_CATALOG_PARAMS_LIMIT = 240;/);
							    assert.match(bootstrapSource, /const TOOLS_CATALOG_BADGE_LIMIT = 48;/);
							    assert.match(bootstrapSource, /function\s+getToolsCatalogSummaryQuery\(rawQuery\)/);
							    assert.match(bootstrapSource, /function\s+getToolsCatalogSummaryFilterText\(filter\)/);
							    assert.match(bootstrapSource, /function\s+getToolsCatalogRowDisplayText\(text, limit\)/);
							    assert.match(bootstrapSource, /const filterText = getToolsCatalogSummaryFilterText\(filter\);/);
							    assert.match(bootstrapSource, /const summaryQuery = getToolsCatalogSummaryQuery\(rawQuery\);/);
							    assert.match(bootstrapSource, /value\.length <= TOOLS_CATALOG_SUMMARY_QUERY_LIMIT/);
							    assert.match(bootstrapSource, /value\.slice\(0, TOOLS_CATALOG_SUMMARY_QUERY_LIMIT\) \+ '…'/);
							    assert.match(bootstrapSource, /value\.length <= TOOLS_CATALOG_SUMMARY_FILTER_LIMIT/);
							    assert.match(bootstrapSource, /value\.slice\(0, TOOLS_CATALOG_SUMMARY_FILTER_LIMIT\) \+ '…'/);
							    assert.match(bootstrapSource, /renderText = getToolsCatalogRowDisplayText\(renderText, TOOLS_CATALOG_PARAMS_LIMIT\);/);
							    assert.match(bootstrapSource, /badgeEl\.textContent = getToolsCatalogRowDisplayText\(text, TOOLS_CATALOG_BADGE_LIMIT\);/);
							    assert.match(bootstrapSource, /visibleToolShown < visibleToolCount/);
							    assert.match(bootstrapSource, /'Showing first ' \+ visibleToolShown \+ ' of ' \+ visibleToolCount/);
							    assert.match(bootstrapSource, /visibleToolCount === 1 \? ' match "' : ' matches "'/);
							    assert.match(toolStateSection, /const summaryText = getToolsCatalogSummaryText\(total, shown, filter, rawQuery, localQuery, visibleToolCount, visibleTools\.length\);/);
								    assert.match(toolStateSection, /summary\.textContent = summaryText;/);
							    assert.match(toolStateSection, /setTextContent\(toolsCatalogStatus, summaryText\);/);
							    assert.match(toolStateSection, /'No visible tools match "' \+ getToolsCatalogSummaryQuery\(rawQuery\) \+ '"/);
						    assert.doesNotMatch(toolStateSection, /toolsCatalogSearchQuery\.trim\(\)/);
						    assert.doesNotMatch(toolStateSection, /toolsCatalogSearchQuery\.trim\(\)\.toLowerCase\(\)/);
								    assert.match(bootstrapSource, /function\s+replaceToolsCatalogChildren\(children\)/);
								    assert.match(bootstrapSource, /if \(list\.length === 0\) \{[\s\S]*toolsCatalog\.replaceChildren\(\);[\s\S]*return;/);
								    assert.match(bootstrapSource, /if \(list\.length === 1\) \{[\s\S]*toolsCatalog\.replaceChildren\(list\[0\]\);[\s\S]*return;/);
								    assert.match(bootstrapSource, /if \(list\.length === 2\) \{[\s\S]*toolsCatalog\.replaceChildren\(list\[0\], list\[1\]\);[\s\S]*return;/);
								    assert.match(bootstrapSource, /toolsCatalog\.replaceChildren\(fragment\);/);
								    assert.doesNotMatch(bootstrapSource, /toolsCatalog\.replaceChildren\(\.\.\.list\);/);
						    assert.match(toolStateSection, /const catalogChildren = \[\];/);
						    assert.match(toolStateSection, /const catalogTarget = \{/);
						    assert.match(toolStateSection, /renderManualToolConfirmation\(catalogTarget\)/);
						    assert.match(toolStateSection, /renderManualToolResult\(catalogTarget\);/);
							    assert.match(bootstrapSource, /function\s+getToolsCatalogSummaryText[\s\S]*const filterText = getToolsCatalogSummaryFilterText\(filter\);/);
								    assert.match(toolStateSection, /const itemsEl = document\.createElement\('ul'\);/);
						    assert.match(toolStateSection, /itemsEl\.setAttribute\('role', 'list'\);/);
						    assert.match(toolStateSection, /const visibleFragment = visibleTools\.length > 1 \? document\.createDocumentFragment\(\) : null;/);
						    assert.match(toolStateSection, /for \(let index = 0; index < visibleTools\.length; index\+\+\)/);
						    assert.match(toolStateSection, /const tool = visibleTools\[index\];/);
					    assert.match(toolStateSection, /const toolId = tool && tool\.id \? String\(tool\.id\) : 'tool';/);
					    assert.match(toolStateSection, /const displayToolId = getToolsCatalogRowDisplayText\(toolId, TOOLS_CATALOG_ID_DISPLAY_LIMIT\);/);
					    assert.match(toolStateSection, /const itemEl = document\.createElement\('li'\);/);
					    assert.match(toolStateSection, /itemEl\.setAttribute\('role', 'listitem'\);/);
					    assert.match(toolStateSection, /appendToolsCatalogBadge\(badgesEl, tool && tool\.readOnly \? 'read-only' : 'writes'\);/);
					    assert.match(toolStateSection, /idEl\.textContent = displayToolId;/);
					    assert.match(toolStateSection, /idEl\.title = displayToolId;/);
					    assert.match(toolStateSection, /descEl\.textContent = tool && \(tool\.description \|\| tool\.name\)[\s\S]*getToolsCatalogRowDisplayText\(tool\.description \|\| tool\.name, TOOLS_CATALOG_DESCRIPTION_LIMIT\)/);
					    assert.match(toolStateSection, /paramsEl\.textContent = getToolCatalogParamText\(tool\)\.renderText;/);
					    assert.doesNotMatch(toolStateSection, /params\.map\(/);
					    assert.doesNotMatch(toolStateSection, /visibleTools\.forEach/);
					    assert.doesNotMatch(toolStateSection, /const addBadge =/);
						    assert.match(toolStateSection, /statusEl\.id = 'toolsCatalogRunStatus-' \+ index;/);
						    assert.doesNotMatch(toolStateSection, /toolId\.replace\(TOOLS_CATALOG_DOM_ID_UNSAFE_RE/);
					    assert.match(toolStateSection, /statusEl\.setAttribute\('role', 'status'\);/);
					    assert.match(toolStateSection, /statusEl\.setAttribute\('aria-live', 'polite'\);/);
						    assert.match(toolStateSection, /statusEl\.setAttribute\('aria-atomic', 'true'\);/);
						    assert.match(toolStateSection, /argsEl\.setAttribute\('aria-describedby', statusEl\.id\);/);
						    assert.match(toolStateSection, /toolsCatalogRunStatusByArgs\.set\(argsEl, statusEl\);/);
						    assert.doesNotMatch(toolStateSection, /argsEl\.addEventListener\('input'/);
						    assert.match(toolRunHandlerSection, /setAttributeValue\(argsEl, 'aria-errormessage', statusEl \? statusEl\.id : ''\);/);
					    assert.match(toolRunHandlerSection, /removeAttributeValue\(argsEl, 'aria-errormessage'\);/);
					    assert.match(toolRunHandlerSection, /setTextContent\(statusEl, message\);/);
					    assert.match(toolRunHandlerSection, /setTextContent\(statusEl, 'Requesting…'\);/);
						    assert.doesNotMatch(toolStateSection, /statusEl\.textContent\s*=/);
						    assert.doesNotMatch(toolStateSection, /\.replace\(\//);
					    assert.match(toolStateSection, /argsEl\.setAttribute\('aria-label', 'Arguments for ' \+ displayToolId\);/);
					    assert.match(toolStateSection, /runEl\.setAttribute\('aria-label', 'Run ' \+ displayToolId\);/);
					    assert.match(toolStateSection, /runEl\.title = 'Run ' \+ displayToolId;/);
					    assert.match(toolStateSection, /toolsCatalogRunToolIdByButton\.set\(runEl, tool && tool\.id \? String\(tool\.id\) : ''\);/);
					    assert.doesNotMatch(toolStateSection, /idEl\.textContent = toolId;/);
					    assert.match(toolStateSection, /toolsCatalogRunArgsByButton\.set\(runEl, argsEl\);/);
						    assert.match(toolStateSection, /toolsCatalogRunStatusByButton\.set\(runEl, statusEl\);/);
						    assert.doesNotMatch(toolStateSection, /runEl\.addEventListener\('click'/);
						    assert.doesNotMatch(toolStateSection, /runEl\.dataset\.toolId = toolId;/);
					    assert.match(toolStateSection, /toolsCatalogRunnerControls\.push\(argsEl, runEl\);/);
					    assert.match(toolStateSection, /if \(visibleFragment\) \{[\s\S]*visibleFragment\.appendChild\(itemEl\);[\s\S]*\} else \{[\s\S]*itemsEl\.appendChild\(itemEl\);[\s\S]*\}/);
				    assert.doesNotMatch(toolStateSection, /toolsCatalogSearchInput\.value = toolsCatalogSearchQuery;/);
			    assert.match(toolStateSection, /const nextRenderKey = getToolsCatalogRenderKey\(/);
			    assert.match(toolStateSection, /if \(nextRenderKey === toolsCatalogRenderKey\)/);
				    assert.match(toolStateSection, /toolsCatalogRenderKey = nextRenderKey;/);
					    assert.match(toolStateSection, /if \(visibleFragment\) itemsEl\.appendChild\(visibleFragment\);/);
					    assert.doesNotMatch(toolStateSection, /const visibleFragment = document\.createDocumentFragment\(\);/);
					    assert.match(toolStateSection, /replaceToolsCatalogChildren\(catalogChildren\);/);
					    assert.doesNotMatch(toolStateSection, /const fragment = document\.createDocumentFragment\(\);/);
					    assert.doesNotMatch(toolStateSection, /toolsCatalog\.innerHTML = '';/);
						    assert.doesNotMatch(toolStateSection, /filter\.join\(', '\)/);
						    assert.doesNotMatch(toolStateSection, /setTextContent\(toolsCatalogStatus, summary\.textContent\)/);
						    assert.doesNotMatch(toolStateSection, /toolsCatalog\.(?:appendChild|insertBefore)/);
				    assert.doesNotMatch(toolStateSection, /toolsCatalog(?:SearchLabel)?\.classList\.(?:add|remove|toggle)\(['"]hidden['"]/);
				  });

	  test('backend tool catalog builder avoids separate filter and map passes', () => {
	    const webviewSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
	    const requiredStart = webviewSource.indexOf('function collectRequiredParameterNames');
	    assert.ok(requiredStart >= 0, 'expected required-parameter collector');
	    const reasonStart = webviewSource.indexOf('function collectManualToolConfirmationReasons', requiredStart);
	    assert.ok(reasonStart > requiredStart, 'expected manual tool reason collector after required-parameter collector');
	    const catalogStart = webviewSource.indexOf('async function buildToolCatalogForUI');
	    assert.ok(catalogStart > reasonStart, 'expected tool catalog builder after manual tool reason collector');
	    const requiredSection = webviewSource.slice(requiredStart, reasonStart);
	    const reasonSection = webviewSource.slice(reasonStart, catalogStart);
		    const catalogEnd = webviewSource.indexOf('function formatManualToolResultData', catalogStart);
		    assert.ok(catalogEnd > catalogStart, 'expected manual tool result formatter after catalog builder');
		    const catalogSection = webviewSource.slice(catalogStart, catalogEnd);
		    const manualResultDataEnd = webviewSource.indexOf('function formatMemoryUpdateMessage', catalogEnd);
		    assert.ok(manualResultDataEnd > catalogEnd, 'expected memory update formatter after manual tool result formatter');
		    const manualResultDataSection = webviewSource.slice(catalogEnd, manualResultDataEnd);
		    const runToolStart = webviewSource.indexOf('async runTool(this: ChatWebviewRuntime');
		    assert.ok(runToolStart >= 0, 'expected manual tool runner');
	    const runToolEnd = webviewSource.indexOf('this.outputChannel?.show();', runToolStart);
	    assert.ok(runToolEnd > runToolStart, 'expected manual confirmation block before output channel show');
	    const runToolSection = webviewSource.slice(runToolStart, runToolEnd);

	    assert.match(requiredSection, /const required: string\[\] = \[\];/);
	    assert.match(requiredSection, /for \(let i = 0; i < raw\.length; i\+\+\)/);
	    assert.match(requiredSection, /const value = raw\[i\];/);
	    assert.match(requiredSection, /if \(typeof value === 'string'\) required\.push\(value\);/);
	    assert.doesNotMatch(requiredSection, /for \(const value of raw\)/);
	    assert.doesNotMatch(requiredSection, /\.filter\(/);
	    assert.match(reasonSection, /const reasons: string\[\] = \[\];/);
	    assert.match(reasonSection, /reasons\.push\('it may change workspace\/editor state'\);/);
	    assert.match(reasonSection, /reasons\.push\('it normally requires approval during agent runs'\);/);
	    assert.match(reasonSection, /return reasons;/);
	    assert.match(webviewSource, /const TOOL_CATALOG_ID_COLLATOR = new Intl\.Collator\(\);/);
	    assert.match(reasonSection, /function compareToolCatalogItemsById\(left: ToolCatalogItem, right: ToolCatalogItem\): number/);
	    assert.match(reasonSection, /return TOOL_CATALOG_ID_COLLATOR\.compare\(left\.id, right\.id\);/);
	    assert.doesNotMatch(reasonSection, /\.filter\(/);
	    assert.doesNotMatch(reasonSection, /localeCompare/);
	    assert.match(runToolSection, /let tool: \(typeof allTools\)\[number\] \| undefined;/);
	    assert.match(runToolSection, /for \(const candidate of allTools\)/);
	    assert.match(runToolSection, /if \(candidate\.id === id\) \{/);
	    assert.match(runToolSection, /reasons: collectManualToolConfirmationReasons\(tool\),/);
	    assert.doesNotMatch(runToolSection, /\.filter\(Boolean\)/);
	    assert.doesNotMatch(runToolSection, /\.find\(/);
	    assert.match(catalogSection, /const tools: ToolCatalogItem\[\] = \[\];/);
    assert.match(catalogSection, /const allowTool = createToolFilterMatcher\(filter\);/);
		    assert.match(catalogSection, /for \(const tool of allTools\)/);
    assert.match(catalogSection, /if \(!allowTool\(tool\.id\)\) continue;/);
    assert.match(catalogSection, /tools\.push\(\{/);
    assert.match(catalogSection, /required: collectRequiredParameterNames\(parameters\.required\),/);
	    assert.match(catalogSection, /if \(tools\.length > 1\) tools\.sort\(compareToolCatalogItemsById\);/);
	    assert.doesNotMatch(catalogSection, /tools\.sort\(\(a, b\) => a\.id\.localeCompare\(b\.id\)\);/);
	    assert.doesNotMatch(catalogSection, /filteredTools/);
		    assert.doesNotMatch(catalogSection, /\.filter\(/);
		    assert.doesNotMatch(catalogSection, /\.map\(/);
		    assert.match(manualResultDataSection, /if \(data === undefined\)/);
		    assert.match(manualResultDataSection, /raw = '';/);
		    assert.match(manualResultDataSection, /JSON\.stringify\(data, null, 2\)/);
		    assert.doesNotMatch(manualResultDataSection, /data \?\? null/);
		  });

  test('provider auth toast messages scan first non-empty line without split map chains', () => {
    const webviewSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
    const toastStart = webviewSource.indexOf('function getToastErrorMessage');
    assert.ok(toastStart >= 0, 'expected toast error formatter');
    const scannerStart = webviewSource.indexOf('function getFirstNonEmptyTrimmedLine', toastStart);
    assert.ok(scannerStart > toastStart, 'expected first-line scanner after toast formatter');
    const scannerEnd = webviewSource.indexOf('export interface ChatWebviewService', scannerStart);
    assert.ok(scannerEnd > scannerStart, 'expected webview service interface after first-line scanner');
    const toastSection = webviewSource.slice(toastStart, scannerStart);
    const scannerSection = webviewSource.slice(scannerStart, scannerEnd);

    assert.match(toastSection, /const firstLine = getFirstNonEmptyTrimmedLine\(formatted\);/);
    assert.doesNotMatch(toastSection, /\.split\(/);
    assert.doesNotMatch(toastSection, /\.map\(/);
    assert.match(scannerSection, /for \(let i = 0; i <= value\.length; i\+\+\)/);
    assert.match(scannerSection, /value\.charCodeAt\(i\) !== 10/);
    assert.match(scannerSection, /value\.slice\(lineStart, i\)\.trim\(\)/);
    assert.doesNotMatch(scannerSection, /\.split\(/);
    assert.doesNotMatch(scannerSection, /\.map\(/);
  });

  test('OpenAI-compatible model list normalization builds discovered models in one pass', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/providers/openaiCompatible.ts'), 'utf8');
    const modelListStart = source.indexOf('const rawModels = data.data;');
    assert.ok(modelListStart >= 0, 'expected model list normalization section');
    const modelListEnd = source.indexOf('this.cachedModels = models;', modelListStart);
    assert.ok(modelListEnd > modelListStart, 'expected default model append check after model list normalization');
    const modelListSection = source.slice(modelListStart, modelListEnd);

    assert.match(modelListSection, /const models: ModelInfo\[\] = \[\];/);
    assert.match(modelListSection, /for \(const rawModel of rawModels\)/);
    assert.match(modelListSection, /const model = validOpenAICompatibleModelRecord\(rawModel\);/);
    assert.match(modelListSection, /const modelId = model\.id\.trim\(\);/);
    assert.match(modelListSection, /seenModelIds\.add\(modelId\);/);
    assert.match(modelListSection, /models\.push\(createFallbackModelInfo\(modelId,/);
    assert.match(modelListSection, /if \(this\.defaultModelId && !seenModelIds\.has\(this\.defaultModelId\)\) \{/);
    assert.match(modelListSection, /models\.push\(this\.createDefaultModelInfo\(\)\);/);
    assert.doesNotMatch(modelListSection, /\.map\(/);
    assert.doesNotMatch(modelListSection, /\.filter\(/);
    assert.doesNotMatch(modelListSection, /\.some\(/);
    assert.doesNotMatch(modelListSection, /\{\s*\.\.\.model/);
  });

  test('Copilot model list normalization builds discovered models in one pass', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/providers/copilot.ts'), 'utf8');
    const mapStart = source.indexOf('function buildFallbackModelMap');
    assert.ok(mapStart >= 0, 'expected fallback model map helper');
    const collectStart = source.indexOf('function collectCopilotModelInfo', mapStart);
    assert.ok(collectStart > mapStart, 'expected Copilot model collector after fallback map helper');
    const collectEnd = source.indexOf('export interface CopilotProviderOptions', collectStart);
    assert.ok(collectEnd > collectStart, 'expected Copilot provider options after model collector');
    const collectSection = source.slice(collectStart, collectEnd);
    const loadStart = source.indexOf('private async loadModels');
    assert.ok(loadStart >= 0, 'expected Copilot model loading method');
    const loadEnd = source.indexOf('clearModelCache', loadStart);
    assert.ok(loadEnd > loadStart, 'expected Copilot cache clearer after model loading');
    const loadSection = source.slice(loadStart, loadEnd);

    assert.match(source, /for \(const model of FALLBACK_MODELS\)/);
    assert.match(collectSection, /const normalized: ModelInfo\[\] = \[\];/);
    assert.match(collectSection, /for \(const model of models\)/);
    assert.match(collectSection, /const normalizedModel = normalizeCopilotModelInfo\(model\);/);
    assert.match(collectSection, /if \(normalizedModel\) normalized\.push\(normalizedModel\);/);
    assert.match(loadSection, /const discoveredModels = collectCopilotModelInfo\(vscodeLmModels\);/);
    assert.match(loadSection, /this\.cachedModels = cloneFallbackCopilotModels\(\);/);
    assert.doesNotMatch(source, /FALLBACK_MODELS\.map\(/);
    assert.doesNotMatch(collectSection, /\.map\(/);
    assert.doesNotMatch(collectSection, /\.filter\(/);
    assert.doesNotMatch(loadSection, /\.map\(/);
    assert.doesNotMatch(loadSection, /\.filter\(/);
  });

  test('Codex subscription model list normalization avoids chained model arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/providers/codexSubscriptionModels.ts'), 'utf8');
    const finalizeStart = source.indexOf('function finalizeSortedCodexModels');
    assert.ok(finalizeStart >= 0, 'expected Codex model finalizer');
    const fallbackStart = source.indexOf('export function createCodexFallbackModels', finalizeStart);
    assert.ok(fallbackStart > finalizeStart, 'expected fallback creator after finalizer');
    const finalizeSection = source.slice(finalizeStart, fallbackStart);
    const fallbackEnd = source.indexOf('function normalizeCodexModelInfo', fallbackStart);
    assert.ok(fallbackEnd > fallbackStart, 'expected Codex model normalizer after fallback creator');
    const fallbackSection = source.slice(fallbackStart, fallbackEnd);
    const appendStart = source.indexOf('function appendDefaultCodexModel');
    assert.ok(appendStart >= 0, 'expected Codex default append helper');
    const appendEnd = source.indexOf('export function createCodexFallbackModels', appendStart);
    assert.ok(appendEnd > appendStart, 'expected fallback creator after default append helper');
    const appendSection = source.slice(appendStart, appendEnd);
    const normalizeStart = source.indexOf('export function normalizeCodexModelsResponse');
    assert.ok(normalizeStart >= 0, 'expected Codex response normalizer');
    const normalizeEnd = source.indexOf('if (remoteModels.length === 0)', normalizeStart);
    assert.ok(normalizeEnd > normalizeStart, 'expected fallback check after remote model collection');
    const collectionSection = source.slice(normalizeStart, normalizeEnd);
    const finalizeCallEnd = source.indexOf('return appendDefaultCodexModel', normalizeEnd);
    assert.ok(finalizeCallEnd > normalizeEnd, 'expected default append after finalization');
    const finalizeCallSection = source.slice(normalizeEnd, finalizeCallEnd);

    assert.match(source, /for \(const model of CODEX_SUBSCRIPTION_FALLBACK_MODELS\)/);
    assert.match(finalizeSection, /models\.sort\(\(left, right\) =>/);
    assert.match(finalizeSection, /const normalized = new Array<ModelInfo>\(models\.length\);/);
    assert.match(finalizeSection, /for \(let index = 0; index < models\.length; index\+\+\)/);
    assert.match(fallbackSection, /const models = new Array<ModelInfo>\(CODEX_SUBSCRIPTION_FALLBACK_MODELS\.length\);/);
    assert.match(fallbackSection, /for \(let index = 0; index < CODEX_SUBSCRIPTION_FALLBACK_MODELS\.length; index\+\+\)/);
    assert.match(appendSection, /for \(const model of models\)/);
    assert.match(appendSection, /if \(model\.id === normalizedDefault\) return models;/);
    assert.match(appendSection, /models\.push\(createCodexDefaultModelInfo\(normalizedDefault\)\);/);
    assert.doesNotMatch(appendSection, /\.some\(/);
    assert.doesNotMatch(appendSection, /\[\.\.\.models/);
    assert.match(collectionSection, /const remoteModels: Array<ModelInfo & \{ priority\?: number \}> = \[\];/);
    assert.match(collectionSection, /const seenModelIds = new Set<string>\(\);/);
    assert.match(collectionSection, /for \(const rawModel of rawModels\)/);
    assert.match(collectionSection, /if \(!isRecord\(rawModel\)\) continue;/);
    assert.match(collectionSection, /if \(rawModel\.visibility && rawModel\.visibility !== 'list'\) continue;/);
    assert.match(collectionSection, /const normalizedModel = normalizeCodexModelInfo\(rawModel as CodexModelRecord\);/);
    assert.match(collectionSection, /if \(!normalizedModel \|\| seenModelIds\.has\(normalizedModel\.id\)\) continue;/);
    assert.match(collectionSection, /seenModelIds\.add\(normalizedModel\.id\);/);
    assert.match(collectionSection, /remoteModels\.push\(normalizedModel\);/);
    assert.match(finalizeCallSection, /const normalized = finalizeSortedCodexModels\(remoteModels\);/);
    assert.doesNotMatch(source, /CODEX_SUBSCRIPTION_FALLBACK_MODELS\.map\(/);
    assert.doesNotMatch(collectionSection, /\.filter\(/);
    assert.doesNotMatch(collectionSection, /\.map\(/);
    assert.doesNotMatch(collectionSection, /\.some\(/);
    assert.doesNotMatch(finalizeCallSection, /\.map\(/);
    assert.doesNotMatch(finalizeSection, /\[\.\.\.models\]/);
  });

  test('OpenAI-compatible token metadata lookup scans keys without value arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/providers/openaiCompatible.ts'), 'utf8');
    const lookupStart = source.indexOf('function positiveFiniteNumber');
    assert.ok(lookupStart >= 0, 'expected positive finite number helper');
    const lookupEnd = source.indexOf('function getOpenAICompatibleMaxInputTokens', lookupStart);
    assert.ok(lookupEnd > lookupStart, 'expected token metadata lookup helpers before provider token getters');
    const lookupSection = source.slice(lookupStart, lookupEnd);
    const inputGetterStart = lookupEnd;
    const outputGetterEnd = source.indexOf('function isUnsupportedModelListStatus', inputGetterStart);
    assert.ok(outputGetterEnd > inputGetterStart, 'expected model-list status helpers after provider token getters');
    const getterSection = source.slice(inputGetterStart, outputGetterEnd);

    assert.match(source, /const OPENAI_COMPATIBLE_NESTED_METADATA_KEYS = \[/);
    assert.match(source, /const OPENAI_COMPATIBLE_MAX_INPUT_TOKEN_KEYS = \[/);
    assert.match(source, /const OPENAI_COMPATIBLE_MAX_OUTPUT_TOKEN_KEYS = \[/);
    assert.match(lookupSection, /function positiveFiniteModelMetadataNumber\(model: OpenAICompatibleModelRecord, keys: readonly string\[\]\)/);
    assert.match(lookupSection, /for \(const key of keys\)/);
    assert.match(lookupSection, /for \(const nestedKey of OPENAI_COMPATIBLE_NESTED_METADATA_KEYS\)/);
    assert.match(lookupSection, /positiveFiniteRecordMetadataNumber\(nested, keys\)/);
    assert.match(getterSection, /positiveFiniteModelMetadataNumber\(model, OPENAI_COMPATIBLE_MAX_INPUT_TOKEN_KEYS\)/);
    assert.match(getterSection, /positiveFiniteModelMetadataNumber\(model, OPENAI_COMPATIBLE_MAX_OUTPUT_TOKEN_KEYS\)/);
    assert.doesNotMatch(lookupSection + getterSection, /metadataValues/);
    assert.doesNotMatch(lookupSection + getterSection, /nestedMetadataRecords/);
    assert.doesNotMatch(lookupSection + getterSection, /\.filter\(/);
    assert.doesNotMatch(getterSection, /\.\.\.metadataValues/);
  });

	  test('catalog search handlers skip unchanged queries', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const toolInputStart = bootstrapSource.indexOf("toolsCatalogSearchInput.addEventListener('input'");
    assert.ok(toolInputStart >= 0, 'expected tool catalog search input handler');
    const toolInputEnd = bootstrapSource.indexOf("toolsCatalogSearchInput.addEventListener('keydown'", toolInputStart);
    assert.ok(toolInputEnd > toolInputStart, 'expected tool catalog search input handler end');
    const toolInputSection = bootstrapSource.slice(toolInputStart, toolInputEnd);
	    const toolKeydownEnd = bootstrapSource.indexOf('for (let toolLimitInputIndex = 0; toolLimitInputIndex < toolRuntimeLimitInputs.length; toolLimitInputIndex++)', toolInputEnd);
	    assert.ok(toolKeydownEnd > toolInputEnd, 'expected tool catalog search keydown handler end');
    const toolKeydownSection = bootstrapSource.slice(toolInputEnd, toolKeydownEnd);
    const modelInputStart = bootstrapSource.indexOf("modelPickerSearchInput.addEventListener('input'");
    assert.ok(modelInputStart >= 0, 'expected model picker search input handler');
    const modelInputEnd = bootstrapSource.indexOf("modelPickerSearchInput.addEventListener('keydown'", modelInputStart);
    assert.ok(modelInputEnd > modelInputStart, 'expected model picker search input handler end');
    const modelInputSection = bootstrapSource.slice(modelInputStart, modelInputEnd);
    const modelKeydownEnd = bootstrapSource.indexOf('if (modelClearRecents)', modelInputEnd);
    assert.ok(modelKeydownEnd > modelInputEnd, 'expected model picker search keydown handler end');
    const modelKeydownSection = bootstrapSource.slice(modelInputEnd, modelKeydownEnd);

		    assert.match(bootstrapSource, /function\s+setToolsCatalogSearchQuery\(query\)/);
		    assert.match(bootstrapSource, /function\s+setModelPickerSearchQuery\(query\)/);
			    assert.match(bootstrapSource, /nextDisplayQuery !== toolsCatalogSearchDisplayQuery/);
			    assert.match(bootstrapSource, /toolsCatalogSearchDisplayQuery = nextDisplayQuery;/);
			    assert.match(bootstrapSource, /toolsCatalogSearchLocalQuery = nextLocalQuery;/);
			    assert.match(bootstrapSource, /const nextDisplayQuery = nextQuery\.trim\(\);/);
			    assert.match(bootstrapSource, /const nextLocalQuery = nextDisplayQuery\.toLowerCase\(\);/);
			    assert.match(bootstrapSource, /const MODEL_PICKER_SEARCH_QUERY_DISPLAY_LIMIT = 80;/);
			    assert.match(bootstrapSource, /function\s+getModelPickerSearchDisplayText\(query\)/);
			    assert.match(bootstrapSource, /value\.length <= MODEL_PICKER_SEARCH_QUERY_DISPLAY_LIMIT/);
			    assert.match(bootstrapSource, /const nextDisplayText = getModelPickerSearchDisplayText\(nextDisplayQuery\);/);
		    assert.match(bootstrapSource, /let\s+toolsCatalogSearchRenderFrame\s*=\s*null/);
		    assert.match(bootstrapSource, /let\s+modelPickerSearchRenderFrame\s*=\s*null/);
		    assert.match(bootstrapSource, /function\s+requestSearchRenderFrame\(callback\)/);
		    assert.match(bootstrapSource, /return requestAnimationFrameHandle\(callback\);/);
		    assert.doesNotMatch(bootstrapSource, /requestAnimationFrame\.bind\(window\)/);
		    assert.doesNotMatch(bootstrapSource, /cancelAnimationFrame\.bind\(window\)/);
		    assert.match(bootstrapSource, /function\s+scheduleToolsCatalogSearchRender\(\)/);
		    assert.match(bootstrapSource, /function\s+scheduleModelPickerSearchRender\(\)/);
		    assert.match(bootstrapSource, /function\s+consumeHandledKeyEvent\(event\)/);
		    assert.match(bootstrapSource, /function\s+clearSearchInputForEscape\(event, inputEl, currentQuery, setQuery, onCleared\)/);
		    assert.match(bootstrapSource, /consumeHandledKeyEvent\(event\);/);
		    assert.match(toolInputSection, /if \(!setToolsCatalogSearchQuery\(toolsCatalogSearchInput\.value\)\) return;/);
		    assert.match(toolInputSection, /scheduleToolsCatalogSearchRender\(\);/);
		    assert.doesNotMatch(toolInputSection, /toolsCatalogSearchQuery = String/);
		    assert.doesNotMatch(toolInputSection, /updateToolsCatalogState\(currentToolsCatalog\)/);
		    assert.match(toolKeydownSection, /clearSearchInputForEscape\(/);
		    assert.match(toolKeydownSection, /toolsCatalogSearchQuery/);
		    assert.match(toolKeydownSection, /setToolsCatalogSearchQuery/);
		    assert.match(toolKeydownSection, /updateToolsCatalogState\(currentToolsCatalog\)/);
		    assert.doesNotMatch(toolKeydownSection, /toolsCatalogSearchInput\.value = '';/);
		    assert.doesNotMatch(toolKeydownSection, /if \(!setToolsCatalogSearchQuery\(''\)\) return;/);
    assert.match(modelInputSection, /if \(!setModelPickerSearchQuery\(modelPickerSearchInput\.value\)\) return;/);
    assert.match(bootstrapSource, /nextDisplayText !== modelPickerSearchDisplayQuery/);
    assert.match(bootstrapSource, /modelPickerSearchDisplayQuery = nextDisplayText;/);
    assert.match(bootstrapSource, /modelPickerSearchLocalQuery = nextLocalQuery;/);
    assert.match(bootstrapSource, /return changed;/);
    assert.match(modelInputSection, /scheduleModelPickerSearchRender\(\);/);
		    assert.doesNotMatch(modelInputSection, /modelPickerSearchQuery = String/);
		    assert.doesNotMatch(modelInputSection, /updateModelPickerState\(currentModelPickerState/);
		    assert.match(modelKeydownSection, /clearSearchInputForEscape\(/);
		    assert.match(modelKeydownSection, /modelPickerSearchQuery/);
	    assert.match(modelKeydownSection, /setModelPickerSearchQuery/);
	    assert.match(modelKeydownSection, /updateModelPickerState\(currentModelPickerState/);
	    assert.doesNotMatch(modelKeydownSection, /modelPickerSearchInput\.value = '';/);
	    assert.doesNotMatch(modelKeydownSection, /if \(!setModelPickerSearchQuery\(''\)\) return;/);
	  });

	  test('setting hint aria descriptions are static and skip startup linker', () => {
	    const htmlSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat.html'), 'utf8');
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const labelMatches = [...htmlSource.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)];
	    let linkedHintCount = 0;

	    for (const [labelBlock] of labelMatches) {
	      if (!/\bclass="[^"]*model-setting-field[^"]*"/.test(labelBlock)) continue;
	      const hintId = labelBlock.match(/<span\b[^>]*\bid="([^"]+)"[^>]*\bclass="[^"]*model-setting-hint[^"]*"/i)?.[1];
	      if (!hintId) continue;
	      linkedHintCount++;
	      const controlTag = labelBlock.match(/<(?:input|textarea|select)\b[^>]*>/i)?.[0] || '';
	      assert.match(controlTag, new RegExp(`\\baria-describedby="[^"]*\\b${hintId}\\b[^"]*"`));
	    }

	    assert.ok(linkedHintCount > 10, 'expected static model-setting helper descriptions');
	    assert.doesNotMatch(bootstrapSource, /function\s+linkModelSettingHints\b/);
	    assert.doesNotMatch(bootstrapSource, /function\s+linkModelSettingControlHint\b/);
	    assert.doesNotMatch(bootstrapSource, /\bmodelSettingHintControls\b/);
	    assert.doesNotMatch(bootstrapSource, /ariaDescribedByHasId/);
	  });

  test('settings keydown listener setup avoids callback sweeps', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
			    const providerStart = bootstrapSource.indexOf('for (let providerInputIndex = 0; providerInputIndex < providerSettingsShortcutInputs.length; providerInputIndex++)');
			    assert.ok(providerStart >= 0, 'expected provider settings shortcut listener loop');
			    const providerEnd = bootstrapSource.indexOf('if (openAIModelDisplayNamesInput)', providerStart);
			    assert.ok(providerEnd > providerStart, 'expected display-name listener after provider shortcut listeners');
			    const providerSection = bootstrapSource.slice(providerStart, providerEnd);
			    const toolStart = bootstrapSource.indexOf('for (let toolLimitInputIndex = 0; toolLimitInputIndex < toolRuntimeLimitInputs.length; toolLimitInputIndex++)');
			    assert.ok(toolStart >= 0, 'expected tool runtime limit listener loop');
			    const toolEnd = bootstrapSource.indexOf('if (pluginsAutoDiscoverToggle)', toolStart);
			    assert.ok(toolEnd > toolStart, 'expected plugin toggle listener after tool limit listeners');
			    const toolSection = bootstrapSource.slice(toolStart, toolEnd);
			    const memoryListenerAnchor = bootstrapSource.indexOf('if (instructionPatternsApply)');
			    assert.ok(memoryListenerAnchor >= 0, 'expected instruction patterns listener before memory listener loop');
			    const memoryStart = bootstrapSource.indexOf('for (let memoryLimitInputIndex = 0; memoryLimitInputIndex < memoryAdvancedLimitInputs.length; memoryLimitInputIndex++)', memoryListenerAnchor);
			    assert.ok(memoryStart >= 0, 'expected memory advanced limit listener loop');
			    const memoryEnd = bootstrapSource.indexOf('if (memoryAdvancedLimitsApply)', memoryStart);
			    assert.ok(memoryEnd > memoryStart, 'expected memory limits apply listener after memory advanced limit listeners');
			    const memorySection = bootstrapSource.slice(memoryStart, memoryEnd);
			    const skillsStart = bootstrapSource.indexOf('for (let skillsBudgetInputIndex = 0; skillsBudgetInputIndex < skillsBudgetInputs.length; skillsBudgetInputIndex++)');
			    assert.ok(skillsStart >= 0, 'expected skills budget listener loop');
			    const skillsEnd = bootstrapSource.indexOf('if (skillDropdown)', skillsStart);
			    assert.ok(skillsEnd > skillsStart, 'expected skill dropdown listener after skills budget listeners');
			    const skillsSection = bootstrapSource.slice(skillsStart, skillsEnd);

			    assert.match(bootstrapSource, /const providerSettingsShortcutInputs = \[codexDefaultModelInput, openAIBaseURLInput, openAIDefaultModelInput, openAIApiKeyEnvInput\];/);
			    assert.match(bootstrapSource, /const toolRuntimeLimitInputs = \[/);
			    assert.match(bootstrapSource, /const memoryAdvancedLimitInputs = \[/);
			    assert.match(bootstrapSource, /const skillsBudgetInputs = \[skillsMaxPromptInput, skillsMaxInjectInput, skillsMaxInjectCharsInput\];/);
			    assert.match(providerSection, /const providerInput = providerSettingsShortcutInputs\[providerInputIndex\];/);
			    assert.match(providerSection, /if \(!providerInput\) continue;/);
			    assert.match(providerSection, /if \(isEnterKey\(e\)\) applyProviderSettings\(\);/);
			    assert.match(toolSection, /const toolLimitInput = toolRuntimeLimitInputs\[toolLimitInputIndex\];/);
			    assert.match(toolSection, /if \(!toolLimitInput\) continue;/);
			    assert.match(toolSection, /if \(isEnterKey\(e\)\) applyToolRuntimeLimits\(\);/);
			    assert.match(memorySection, /const memoryLimitInput = memoryAdvancedLimitInputs\[memoryLimitInputIndex\];/);
			    assert.match(memorySection, /if \(!memoryLimitInput\) continue;/);
			    assert.match(memorySection, /if \(isEnterKey\(e\)\) applyMemoryAdvancedLimits\(\);/);
			    assert.match(skillsSection, /const el = skillsBudgetInputs\[skillsBudgetInputIndex\];/);
			    assert.match(skillsSection, /if \(!el\) continue;/);
			    assert.match(skillsSection, /if \(isEnterKey\(e\)\) applySkillsBudget\(\);/);
			    assert.doesNotMatch(providerSection + toolSection + memorySection + skillsSection, /forEach/);
			    assert.doesNotMatch(providerSection + toolSection + memorySection + skillsSection, /for \(const (?:providerInput of providerSettingsShortcutInputs|toolLimitInput of toolRuntimeLimitInputs|memoryLimitInput of memoryAdvancedLimitInputs|el of skillsBudgetInputs)\)/);
			    assert.doesNotMatch(toolSection, /const toolLimitInputs = \[/);
			  });

		  test('tools catalog control state updates avoid duplicate property writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const helperStart = bootstrapSource.indexOf('function setToolsCatalogControlsDisabled');
	    assert.ok(helperStart >= 0, 'expected tools catalog control-state helper');
    const helperEnd = bootstrapSource.indexOf('function getToolCatalogSearchText', helperStart);
    assert.ok(helperEnd > helperStart, 'expected tools catalog search helper after control-state helper');
    const helperSection = bootstrapSource.slice(helperStart, helperEnd);

	    assert.match(helperSection, /setDisabled\(toolsCatalogSearchInput, disabledFlag\);/);
    assert.match(helperSection, /setDisabledClass\(toolsCatalogSearchLabel, disabledFlag\);/);
	    assert.match(helperSection, /!toolsCatalogVisible/);
	    assert.match(helperSection, /const nextKey = \(disabledFlag \? '1' : '0'\) \+/);
	    assert.match(bootstrapSource, /function pruneDetachedToolsCatalogControls\(controls\)/);
	    assert.match(bootstrapSource, /toolsCatalog\.contains\(el\)/);
	    assert.match(bootstrapSource, /controls\.length = writeIndex;/);
	    assert.match(helperSection, /const runnerControls = pruneDetachedToolsCatalogControls\(toolsCatalogRunnerControls\);/);
	    assert.match(helperSection, /for \(let i = 0; i < runnerControls\.length; i\+\+\)/);
	    assert.match(helperSection, /const el = runnerControls\[i\];/);
    assert.match(helperSection, /const confirmationControls = pruneDetachedToolsCatalogControls\(toolsCatalogConfirmationControls\);/);
    assert.match(helperSection, /for \(let i = 0; i < confirmationControls\.length; i\+\+\)/);
    assert.match(helperSection, /const el = confirmationControls\[i\];/);
    assert.match(helperSection, /setDisabled\(el, disabledFlag\);/);
    assert.match(helperSection, /setDisabled\(el, confirmationDisabled \|\| manualToolRunBusy \|\| isProcessing \|\| !initReceived\);/);
	    assert.doesNotMatch(helperSection, /for \(const el of toolsCatalogRunnerControls\)/);
	    assert.doesNotMatch(helperSection, /for \(const el of toolsCatalogConfirmationControls\)/);
	    assert.doesNotMatch(helperSection, /querySelectorAll/);
	    assert.doesNotMatch(helperSection, /toolsCatalog\.classList\.contains\('hidden'\)/);
	    assert.doesNotMatch(helperSection, /\.join\('\|'\)/);
		    assert.doesNotMatch(helperSection, /\.(?:disabled)\s*=/);
		    assert.doesNotMatch(helperSection, /classList\.toggle\('disabled'/);
		  });

		  test('tools catalog run buttons initialize through disabled helper', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const runButtonStart = bootstrapSource.indexOf("const runEl = document.createElement('button');");
		    assert.ok(runButtonStart >= 0, 'expected tools catalog run button creation');
		    const runButtonEnd = bootstrapSource.indexOf('rowEl.appendChild(statusEl);', runButtonStart);
		    assert.ok(runButtonEnd > runButtonStart, 'expected run button row append after creation');
		    const runButtonSection = bootstrapSource.slice(runButtonStart, runButtonEnd);

		    assert.match(runButtonSection, /setDisabled\(runEl, !initReceived \|\| isProcessing \|\| manualToolRunBusy\);/);
		    assert.doesNotMatch(runButtonSection, /runEl\.disabled\s*=/);
		  });

		  test('model picker list control state updates avoid duplicate disabled writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const pruneStart = bootstrapSource.indexOf('function pruneDetachedModelPickerListControls');
	    assert.ok(pruneStart >= 0, 'expected model picker stale control pruning helper');
	    const helperStart = bootstrapSource.indexOf('function setModelPickerListControlsDisabled', pruneStart);
	    assert.ok(helperStart > pruneStart, 'expected model picker list control-state helper after stale control pruning helper');
	    const helperEnd = bootstrapSource.indexOf('function updateModelPickerState', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected model picker state helper after control-state helper');
	    const pruneSection = bootstrapSource.slice(pruneStart, helperStart);
	    const helperSection = bootstrapSource.slice(helperStart, helperEnd);

	    assert.match(pruneSection, /function pruneDetachedModelPickerListControls\(\)/);
	    assert.match(pruneSection, /typeof modelPickerList\.contains !== 'function'/);
	    assert.match(pruneSection, /for \(let i = 0; i < modelPickerListControls\.length; i\+\+\)/);
	    assert.match(pruneSection, /if \(!button \|\| !modelPickerList\.contains\(button\)\) continue;/);
	    assert.match(pruneSection, /modelPickerListControls\[writeIndex\+\+\] = button;/);
	    assert.match(pruneSection, /modelPickerListControls\.length = writeIndex;/);
	    assert.match(helperSection, /pruneDetachedModelPickerListControls\(\);[\s\S]*for \(let i = 0; i < modelPickerListControls\.length; i\+\+\)/);
	    assert.match(helperSection, /for \(let i = 0; i < modelPickerListControls\.length; i\+\+\)/);
	    assert.match(helperSection, /const button = modelPickerListControls\[i\];/);
	    assert.match(helperSection, /setDisabled\(button, disabled\);/);
	    assert.match(helperSection, /!modelPickerListVisible/);
	    assert.doesNotMatch(helperSection, /for \(const button of modelPickerListControls\)/);
	    assert.doesNotMatch(helperSection, /querySelectorAll/);
	    assert.doesNotMatch(helperSection, /modelPickerList\.classList\.contains\('hidden'\)/);
	    assert.doesNotMatch(helperSection, /\.disabled\s*=/);
	  });

		  test('auto-approved tools control state updates avoid duplicate property writes', () => {
		    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
		    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
		    const normalizeStart = bootstrapSource.indexOf('function normalizeAutoApprovedTools');
		    assert.ok(normalizeStart >= 0, 'expected auto-approved tools normalizer');
	    const confirmStart = bootstrapSource.indexOf('function setAutoApprovedToolsClearConfirmVisible');
	    assert.ok(confirmStart >= 0, 'expected auto-approved clear confirmation visibility helper');
	    const confirmPendingStart = bootstrapSource.indexOf('function setAutoApprovedToolsClearConfirmPending', confirmStart);
	    assert.ok(confirmPendingStart > confirmStart, 'expected auto-approved clear confirmation helper after visibility helper');
	    const pruneStart = bootstrapSource.indexOf('function pruneDetachedAutoApprovedToolButtons', confirmPendingStart);
	    assert.ok(pruneStart > confirmPendingStart, 'expected auto-approved stale button pruning helper after confirmation helper');
	    const controlsStart = bootstrapSource.indexOf('function setAutoApprovedToolsControlsDisabled', pruneStart);
	    assert.ok(controlsStart > pruneStart, 'expected auto-approved controls helper after stale button pruning helper');
    const controlsEnd = bootstrapSource.indexOf('function updateNormalizedAutoApprovedToolsState', controlsStart);
    assert.ok(controlsEnd > controlsStart, 'expected normalized auto-approved state helper after controls helper');
		    const rawStateStart = bootstrapSource.indexOf('function updateAutoApprovedToolsState', controlsEnd);
		    assert.ok(rawStateStart > controlsEnd, 'expected raw auto-approved state helper after normalized helper');
		    const stateEnd = bootstrapSource.indexOf('function clearAutoApprovedTools', rawStateStart);
		    assert.ok(stateEnd > rawStateStart, 'expected auto-approved clear helper after state helpers');
		    const clearEnd = bootstrapSource.indexOf('function updateSafetySettingsTitle', stateEnd);
		    assert.ok(clearEnd > stateEnd, 'expected safety title helper after auto-approved clear helper');
		    const autoApprovedToolsStateStart = mainSource.indexOf("case 'autoApprovedToolsState':");
		    assert.ok(autoApprovedToolsStateStart >= 0, 'expected auto-approved tools state branch');
		    const manualToolConfirmationStart = mainSource.indexOf("case 'manualToolConfirmationRequired':", autoApprovedToolsStateStart);
		    assert.ok(manualToolConfirmationStart > autoApprovedToolsStateStart, 'expected manual tool confirmation branch after auto-approved tools state branch');
			    const normalizeSection = bootstrapSource.slice(normalizeStart, confirmStart);
			    const confirmSection = bootstrapSource.slice(confirmStart, pruneStart);
			    const pruneSection = bootstrapSource.slice(pruneStart, controlsStart);
			    const controlsSection = bootstrapSource.slice(controlsStart, controlsEnd);
			    const stateSection = bootstrapSource.slice(controlsEnd, rawStateStart);
			    const rawStateSection = bootstrapSource.slice(rawStateStart, stateEnd);
			    const clearSection = bootstrapSource.slice(stateEnd, clearEnd);
			    const autoApprovedToolsStateSection = mainSource.slice(autoApprovedToolsStateStart, manualToolConfirmationStart);

				    assert.match(bootstrapSource, /let\s+autoApprovedToolsRenderKey\s*=\s*''/);
				    assert.match(bootstrapSource, /let\s+autoApprovedToolButtons\s*=\s*\[\]/);
				    assert.match(bootstrapSource, /const\s+autoApprovedToolIdByRevokeButton\s*=\s*new WeakMap\(\);/);
			    assert.match(bootstrapSource, /let\s+autoApprovedToolsClearConfirmSynced\s*=\s*false/);
		    assert.match(bootstrapSource, /let\s+autoApprovedToolsClearConfirmVisible\s*=\s*false/);
		    assert.match(bootstrapSource, /function\s+getAutoApprovedToolsRenderKey\(toolIds\)/);
		    assert.match(bootstrapSource, /const AUTO_APPROVED_TOOL_ID_DISPLAY_LIMIT = 160;/);
		    assert.match(normalizeSection, /function\s+getAutoApprovedToolDisplayId\(toolId\)/);
		    assert.match(normalizeSection, /value\.length <= AUTO_APPROVED_TOOL_ID_DISPLAY_LIMIT/);
		    assert.match(normalizeSection, /value\.slice\(0, AUTO_APPROVED_TOOL_ID_DISPLAY_LIMIT\) \+ '…'/);
		    assert.match(bootstrapSource, /function\s+compareLocaleAscending\(left, right\)/);
		    assert.match(normalizeSection, /if \(normalized\.length > 1\) normalized\.sort\(compareLocaleAscending\);/);
		    assert.match(normalizeSection, /return normalized;/);
		    assert.doesNotMatch(normalizeSection, /return normalized\.sort/);
		    assert.doesNotMatch(normalizeSection, /\.sort\(\(a, b\) => a\.localeCompare\(b\)\)/);
		    assert.match(normalizeSection, /const key = createCompactRenderStateKeyBuilder\(\);/);
			    assert.match(normalizeSection, /appendCompactRenderStateKeyPart\(key, source\.length\);/);
			    assert.match(normalizeSection, /appendCompactRenderStateKeyPart\(key, toolId\);/);
			    assert.match(normalizeSection, /return finishCompactRenderStateKey\(key\);/);
			    assert.doesNotMatch(normalizeSection, /appendRenderKeyPart\(key,/);
			    assert.doesNotMatch(normalizeSection, /getCompactRenderStateKey\(key\)/);
			    assert.match(bootstrapSource, /function\s+replaceElementChildren\(element, child\)/);
			    assert.match(bootstrapSource, /typeof element\.replaceChildren === 'function'/);
				    assert.match(bootstrapSource, /const autoApprovedToolsStatus = document\.getElementById\('autoApprovedToolsStatus'\);/);
				    assert.match(normalizeSection, /for \(let i = 0; i < source\.length; i\+\+\)/);
				    assert.match(normalizeSection, /const value = source\[i\];/);
				    assert.match(normalizeSection, /const toolId = source\[i\];/);
				    assert.doesNotMatch(normalizeSection, /source\.forEach/);
				    assert.doesNotMatch(normalizeSection, /for \(const (?:value|toolId) of source\)/);
				    assert.match(normalizeSection, /function\s+focusInlineConfirmationTarget\(element\)/);
				    assert.match(normalizeSection, /element\.focus\(\{ preventScroll: true \}\);/);
				    assert.match(confirmSection, /function setAutoApprovedToolsClearConfirmVisible\(visible\)/);
				    assert.match(confirmSection, /if \(autoApprovedToolsClearConfirmVisible === visibleFlag\) return;/);
				    assert.match(confirmSection, /autoApprovedToolsClearConfirm\.classList\.toggle\('hidden', !visibleFlag\);/);
				    assert.match(confirmSection, /setAutoApprovedToolsClearConfirmVisible\(autoApprovedToolsClearConfirmPending\);/);
				    assert.match(confirmSection, /const wasPending = autoApprovedToolsClearConfirmPending;/);
				    assert.match(confirmSection, /const nextPending = !!pending;/);
					    assert.match(confirmSection, /if \(autoApprovedToolsClearConfirmSynced && wasPending === nextPending\) \{[\s\S]*if \(!options \|\| options\.sync !== false\) syncInputState\(\);[\s\S]*return;[\s\S]*\}/);
					    assert.match(confirmSection, /autoApprovedToolsClearConfirmPending = nextPending;/);
					    assert.match(confirmSection, /autoApprovedToolsClearConfirmSynced = true;/);
					    assert.match(confirmSection, /if \(autoApprovedToolsClearConfirmSynced && wasPending === nextPending\) \{[\s\S]*return;[\s\S]*\}[\s\S]*setAutoApprovedToolsClearConfirmVisible\(autoApprovedToolsClearConfirmPending\);/);
			    assert.doesNotMatch(confirmSection, /setHidden\(autoApprovedToolsClearConfirm, !autoApprovedToolsClearConfirmPending\);/);
			    assert.match(confirmSection, /setAttributeValue\(autoApprovedToolsClear, 'aria-expanded', autoApprovedToolsClearConfirmPending \? 'true' : 'false'\);/);
			    assert.match(confirmSection, /focusInlineConfirmationTarget\(autoApprovedToolsClearCancel\);/);
				    assert.match(confirmSection, /focusInlineConfirmationTarget\(autoApprovedToolsClear\);/);
				    assert.match(confirmSection, /options\.restoreFocus !== false/);
				    assert.match(bootstrapSource, /setAutoApprovedToolsClearConfirmPending\(false, \{ sync: false, restoreFocus: false \}\);/);
			    assert.doesNotMatch(confirmSection, /autoApprovedToolsClearConfirm\.classList\.contains\('hidden'\)/);
			    assert.doesNotMatch(confirmSection, /\.setAttribute\('aria-expanded'/);
		    assert.match(pruneSection, /function pruneDetachedAutoApprovedToolButtons\(\)/);
		    assert.match(pruneSection, /typeof autoApprovedToolsList\.contains !== 'function'/);
		    assert.match(pruneSection, /for \(let i = 0; i < autoApprovedToolButtons\.length; i\+\+\)/);
		    assert.match(pruneSection, /if \(!button \|\| !autoApprovedToolsList\.contains\(button\)\) continue;/);
		    assert.match(pruneSection, /autoApprovedToolButtons\[writeIndex\+\+\] = button;/);
		    assert.match(pruneSection, /autoApprovedToolButtons\.length = writeIndex;/);
		    assert.match(controlsSection, /setDisabled\(autoApprovedToolsClear, disabledFlag \|\| autoApprovedTools\.length === 0\);/);
		    assert.match(controlsSection, /setDisabled\(autoApprovedToolsClearCancel, disabledFlag\);/);
		    assert.match(controlsSection, /setDisabled\(autoApprovedToolsClearConfirmRun, disabledFlag\);/);
		    assert.match(controlsSection, /pruneDetachedAutoApprovedToolButtons\(\);[\s\S]*for \(let i = 0; i < autoApprovedToolButtons\.length; i\+\+\)/);
		    assert.match(controlsSection, /for \(let i = 0; i < autoApprovedToolButtons\.length; i\+\+\)/);
			    assert.match(controlsSection, /setDisabled\(autoApprovedToolButtons\[i\], disabledFlag\);/);
			    assert.match(controlsSection, /function\s+requestAutoApprovedToolRevoke\(toolId\)/);
			    assert.match(controlsSection, /function\s+findAutoApprovedToolRevokeButton\(target\)/);
			    assert.match(controlsSection, /function\s+handleAutoApprovedToolsListClick\(e\)/);
		    assert.doesNotMatch(controlsSection, /querySelectorAll/);
			    assert.doesNotMatch(controlsSection, /\.(?:disabled)\s*=/);
			    assert.match(bootstrapSource, /function\s+updateAutoApprovedToolsStatus\(\)/);
			    assert.match(bootstrapSource, /autoApprovedToolsList\.addEventListener\('click', handleAutoApprovedToolsListClick\);/);
			    assert.match(stateSection, /function\s+updateNormalizedAutoApprovedToolsState\(nextAutoApprovedTools\)/);
			    assert.match(stateSection, /const nextRenderKey = getAutoApprovedToolsRenderKey\(nextAutoApprovedTools\);/);
			    assert.doesNotMatch(stateSection, /normalizeAutoApprovedTools\(/);
		    assert.match(stateSection, /updateAutoApprovedToolsStatus\(\);/);
		    assert.match(stateSection, /if \(nextRenderKey === autoApprovedToolsRenderKey\)/);
			    assert.match(stateSection, /autoApprovedToolsRenderKey = nextRenderKey;/);
			    assert.match(stateSection, /for \(let i = 0; i < autoApprovedTools\.length; i\+\+\)/);
			    assert.match(stateSection, /const toolId = autoApprovedTools\[i\];/);
			    assert.match(stateSection, /const displayToolId = getAutoApprovedToolDisplayId\(toolId\);/);
				    assert.match(stateSection, /document\.createElement\('li'\)/);
			    assert.match(stateSection, /autoApprovedToolButtons = \[\];/);
					    assert.match(stateSection, /autoApprovedToolButtons\.push\(revokeEl\);/);
				    assert.match(stateSection, /autoApprovedToolIdByRevokeButton\.set\(revokeEl, toolId\);/);
				    assert.match(stateSection, /idEl\.textContent = displayToolId;/);
				    assert.match(stateSection, /const revokeLabel = 'Revoke ' \+ displayToolId \+ ' from always-allowed tools';/);
				    assert.doesNotMatch(stateSection, /revokeEl\.addEventListener\('click'/);
				    assert.doesNotMatch(stateSection, /dataset\.toolId/);
			    assert.match(stateSection, /replaceElementChildren\(autoApprovedToolsList, emptyEl\);/);
			    assert.match(stateSection, /const fragment = autoApprovedTools\.length > 1 \? document\.createDocumentFragment\(\) : null;/);
			    assert.match(stateSection, /let singleItemEl = null;/);
			    assert.match(stateSection, /if \(fragment\) \{[\s\S]*fragment\.appendChild\(itemEl\);[\s\S]*\} else \{[\s\S]*singleItemEl = itemEl;[\s\S]*\}/);
			    assert.match(stateSection, /replaceElementChildren\(autoApprovedToolsList, fragment \|\| singleItemEl\);/);
			    assert.doesNotMatch(stateSection, /const fragment = document\.createDocumentFragment\(\);/);
			    assert.match(rawStateSection, /function\s+updateAutoApprovedToolsState\(toolIds\)/);
				    assert.match(rawStateSection, /updateNormalizedAutoApprovedToolsState\(normalizeAutoApprovedTools\(toolIds\)\);/);
				    assert.doesNotMatch(rawStateSection, /const nextRenderKey = getAutoApprovedToolsRenderKey/);
				    assert.match(clearSection, /updateNormalizedAutoApprovedToolsState\(autoApprovedTools\);/);
				    assert.doesNotMatch(clearSection, /updateAutoApprovedToolsState\(autoApprovedTools\);/);
				    assert.match(autoApprovedToolsStateSection, /const nextAutoApprovedTools = normalizeAutoApprovedTools\(data\.autoApprovedTools \|\| \[\]\);/);
				    assert.match(autoApprovedToolsStateSection, /if \(!autoApprovedToolsPending && stringListsEqual\(nextAutoApprovedTools, autoApprovedTools\)\) break;/);
				    assert.match(autoApprovedToolsStateSection, /updateNormalizedAutoApprovedToolsState\(nextAutoApprovedTools\);/);
				    assert.doesNotMatch(autoApprovedToolsStateSection, /updateAutoApprovedToolsState\(nextAutoApprovedTools\);/);
			    assert.doesNotMatch(stateSection, /autoApprovedToolsList\.innerHTML = '';/);
			    assert.doesNotMatch(stateSection, /autoApprovedToolsList\.appendChild/);
			    assert.doesNotMatch(stateSection, /autoApprovedTools\.forEach/);
			    assert.doesNotMatch(stateSection, /for \(const toolId of autoApprovedTools\)/);
				    assert.doesNotMatch(stateSection, /setAttribute\('role', 'listitem'\)/);
		    assert.match(stateSection, /setDisabled\(autoApprovedToolsClear, true\);/);
	    assert.doesNotMatch(stateSection, /autoApprovedToolsClear\.disabled\s*=/);
	  });

  test('auto-approved tool store remembers tools without whole-set spread copies', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/autoApprovedToolsStore.ts'), 'utf8');
    const normalizeStart = source.indexOf('function normalizeAutoApprovedToolsInPlace');
    assert.ok(normalizeStart >= 0, 'expected in-place auto-approved tool normalizer');
    const rememberStart = source.indexOf('export function rememberAutoApprovedTool');
    assert.ok(rememberStart > normalizeStart, 'expected remember helper after in-place normalizer');
    const rememberEnd = source.indexOf('export function forgetAutoApprovedTool', rememberStart);
    assert.ok(rememberEnd > rememberStart, 'expected forget helper after remember helper');
    const normalizeSection = source.slice(normalizeStart, rememberStart);
    const rememberSection = source.slice(rememberStart, rememberEnd);

    assert.match(normalizeSection, /replaceAutoApprovedTools\(autoApprovedTools, autoApprovedTools\)/);
    assert.match(rememberSection, /const normalizedExisting = normalizeAutoApprovedToolsInPlace\(autoApprovedTools\);/);
    assert.match(rememberSection, /const normalizedToolId = normalizeAutoApprovedToolId\(toolId\);/);
    assert.match(rememberSection, /autoApprovedTools\.add\(normalizedToolId\);/);
    assert.doesNotMatch(rememberSection, /\[\.\.\.autoApprovedTools/);
    assert.doesNotMatch(rememberSection, /replaceAutoApprovedTools\(autoApprovedTools, \[\.\.\.autoApprovedTools/);
  });

  test('skill dropdown avoids redundant render and close work', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const closeStart = bootstrapSource.indexOf('function closeSkillDropdown');
	    assert.ok(closeStart >= 0, 'expected closeSkillDropdown helper');
	    const closeEnd = bootstrapSource.indexOf('function getSkillMentionContext', closeStart);
	    assert.ok(closeEnd > closeStart, 'expected end of closeSkillDropdown helper');
	    const closeSection = bootstrapSource.slice(closeStart, closeEnd);
	    const contextStart = bootstrapSource.indexOf('function isSkillQueryChar');
	    assert.ok(contextStart >= 0, 'expected skill query character helper');
	    const contextEnd = bootstrapSource.indexOf('function filterSkillsForQuery', contextStart);
	    assert.ok(contextEnd > contextStart, 'expected filterSkillsForQuery after skill context helper');
	    const contextSection = bootstrapSource.slice(contextStart, contextEnd);
	    const setAvailableStart = bootstrapSource.indexOf('function setAvailableSkills(skills)');
	    assert.ok(setAvailableStart >= 0, 'expected setAvailableSkills helper');
	    const setAvailableEnd = bootstrapSource.indexOf('function closeSkillDropdown', setAvailableStart);
	    assert.ok(setAvailableEnd > setAvailableStart, 'expected setAvailableSkills before closeSkillDropdown');
	    const setAvailableSection = bootstrapSource.slice(setAvailableStart, setAvailableEnd);
	    const normalizeAvailableStart = bootstrapSource.indexOf('function normalizeAvailableSkills(skills)');
	    assert.ok(normalizeAvailableStart >= 0, 'expected normalizeAvailableSkills helper');
	    const normalizeAvailableEnd = bootstrapSource.indexOf('function setAvailableSkillsFromNormalized', normalizeAvailableStart);
	    assert.ok(normalizeAvailableEnd > normalizeAvailableStart, 'expected normalized setter after available skills normalizer');
	    const normalizeAvailableSection = bootstrapSource.slice(normalizeAvailableStart, normalizeAvailableEnd);
	    const visibilityStart = bootstrapSource.indexOf('function setSkillDropdownVisible', setAvailableStart);
	    assert.ok(visibilityStart > setAvailableStart, 'expected skill dropdown visibility helper after skill state helpers');
	    assert.ok(visibilityStart < closeStart, 'expected skill dropdown visibility helper before close helper');
	    const visibilitySection = bootstrapSource.slice(visibilityStart, closeStart);
	    const filterStart = bootstrapSource.indexOf('function filterSkillsForQuery');
	    assert.ok(filterStart >= 0, 'expected filterSkillsForQuery helper');
	    const filterEnd = bootstrapSource.indexOf('function getSkillDropdownOptionId', filterStart);
	    assert.ok(filterEnd > filterStart, 'expected filterSkillsForQuery before option id helper');
	    const filterSection = bootstrapSource.slice(filterStart, filterEnd);
	    const updateStart = bootstrapSource.indexOf('function updateSkillDropdown');
	    assert.ok(updateStart >= 0, 'expected updateSkillDropdown helper');
	    const updateEnd = bootstrapSource.indexOf('function moveSkillDropdownSelection', updateStart);
    assert.ok(updateEnd > updateStart, 'expected end of updateSkillDropdown helper');
    const updateSection = bootstrapSource.slice(updateStart, updateEnd);
    const renderStart = bootstrapSource.indexOf('function renderSkillDropdown');
    assert.ok(renderStart >= 0, 'expected renderSkillDropdown helper');
    const renderEnd = bootstrapSource.indexOf('function updateSkillDropdown', renderStart);
    assert.ok(renderEnd > renderStart, 'expected updateSkillDropdown after renderSkillDropdown');
    const renderSection = bootstrapSource.slice(renderStart, renderEnd);
    const activeStateStart = bootstrapSource.indexOf('function syncSkillDropdownInputState');
    assert.ok(activeStateStart >= 0, 'expected skill active-descendant helper');
    const activeStateEnd = bootstrapSource.indexOf('function renderSkillDropdown', activeStateStart);
    assert.ok(activeStateEnd > activeStateStart, 'expected renderSkillDropdown after active-descendant helper');
    const activeStateSection = bootstrapSource.slice(activeStateStart, activeStateEnd);
	    const renderKeyStart = bootstrapSource.indexOf('function getSkillDropdownRenderKey');
	    assert.ok(renderKeyStart >= 0, 'expected skill dropdown render-key helper');
	    const renderKeyEnd = bootstrapSource.indexOf('function renderSkillDropdown', renderKeyStart);
	    assert.ok(renderKeyEnd > renderKeyStart, 'expected renderSkillDropdown after render-key helper');
	    const renderKeySection = bootstrapSource.slice(renderKeyStart, renderKeyEnd);
	    const moveStart = bootstrapSource.indexOf('function moveSkillDropdownSelection');
	    assert.ok(moveStart >= 0, 'expected moveSkillDropdownSelection helper');
	    const moveEnd = bootstrapSource.indexOf('function applySkillSuggestion', moveStart);
	    assert.ok(moveEnd > moveStart, 'expected applySkillSuggestion after moveSkillDropdownSelection');
	    const moveSection = bootstrapSource.slice(moveStart, moveEnd);
	    const applyStart = bootstrapSource.indexOf('function applySkillSuggestion', moveEnd);
	    assert.ok(applyStart >= 0, 'expected applySkillSuggestion helper');
	    const applyEnd = bootstrapSource.indexOf('function applySelectedSkill', applyStart);
	    assert.ok(applyEnd > applyStart, 'expected applySelectedSkill after applySkillSuggestion');
	    const applySection = bootstrapSource.slice(applyStart, applyEnd);
	    const consumeStart = bootstrapSource.indexOf('function consumeHandledKeyEvent');
	    assert.ok(consumeStart >= 0, 'expected handled key event consumer');
	    const consumeEnd = bootstrapSource.indexOf('function clearSearchInputForEscape', consumeStart);
	    assert.ok(consumeEnd > consumeStart, 'expected search Escape helper after handled key consumer');
	    const consumeSection = bootstrapSource.slice(consumeStart, consumeEnd);
		    const inputKeydownStart = bootstrapSource.indexOf("input.addEventListener('keydown'");
		    assert.ok(inputKeydownStart >= 0, 'expected composer keydown handler');
		    const inputKeydownEnd = bootstrapSource.indexOf("clearInputBtn.addEventListener('click'", inputKeydownStart);
		    assert.ok(inputKeydownEnd > inputKeydownStart, 'expected composer keydown handler before clear button');
		    const inputKeydownSection = bootstrapSource.slice(inputKeydownStart, inputKeydownEnd);
		    const clickStart = bootstrapSource.indexOf("skillDropdown.addEventListener('click'");
		    assert.ok(clickStart >= 0, 'expected skill dropdown click handler');
		    const clickEnd = bootstrapSource.indexOf("input.addEventListener('keydown'", clickStart);
		    assert.ok(clickEnd > clickStart, 'expected input keydown handler after skill dropdown click handler');
		    const clickSection = bootstrapSource.slice(clickStart, clickEnd);

		    assert.match(bootstrapSource, /let\s+availableSkillsVersion\s*=\s*0/);
	    assert.match(bootstrapSource, /let\s+availableSkillSearchText\s*=\s*\[\]/);
	    assert.match(bootstrapSource, /let\s+availableSkillsKey\s*=\s*''/);
	    assert.match(bootstrapSource, /let\s+skillDropdownItemsVersion\s*=\s*-1/);
	    assert.match(bootstrapSource, /let\s+skillDropdownRenderKey\s*=\s*''/);
	    assert.match(bootstrapSource, /let\s+skillDropdownInputStateKey\s*=\s*''/);
	    assert.match(bootstrapSource, /let\s+skillDropdownSyncedSelectedIndex\s*=\s*-1/);
	    assert.match(bootstrapSource, /const\s+skillDropdownItemIndexByElement\s*=\s*new WeakMap\(\);/);
		    assert.match(bootstrapSource, /let\s+skillDropdownLocalQuery\s*=\s*''/);
		    assert.match(bootstrapSource, /let\s+skillDropdownVisible\s*=\s*false/);
		    assert.match(bootstrapSource, /function findSkillDropdownItem\(target\)/);
		    assert.match(bootstrapSource, /if \(skillDropdownItemIndexByElement\.has\(el\)\) return el;/);
		    assert.match(clickSection, /const item = findSkillDropdownItem\(e && e\.target \? e\.target : null\);/);
		    assert.doesNotMatch(clickSection, /\.closest\('\.skill-dropdown-item'\)/);
		    assert.match(bootstrapSource, /const SKILL_QUERY_CHAR_RE = \/\[A-Za-z0-9_\.-\]\/;/);
		    assert.match(bootstrapSource, /const\s+SKILL_DROPDOWN_ITEM_DISPLAY_LIMIT\s*=\s*160;/);
		    assert.match(bootstrapSource, /const WHITESPACE_CHAR_RE = \/\\s\/;/);
		    assert.match(contextSection, /function isSkillQueryChar\(ch\)/);
		    assert.match(contextSection, /function isWhitespaceChar\(ch\)/);
		    assert.match(contextSection, /const code = text\.charCodeAt\(0\);/);
		    assert.match(contextSection, /if \(code === 32 \|\| \(code >= 9 && code <= 13\)\) return true;/);
		    assert.match(contextSection, /if \(code < 128\) return false;/);
		    assert.match(contextSection, /return WHITESPACE_CHAR_RE\.test\(text\[0\]\);/);
		    assert.match(contextSection, /const selectionStart = input\.selectionStart;/);
	    assert.match(contextSection, /const selectionEnd = input\.selectionEnd;/);
	    assert.match(contextSection, /if \(selectionStart !== selectionEnd\) return null;/);
	    assert.match(contextSection, /const value = String\(input\.value \|\| ''\);/);
	    assert.match(contextSection, /const caret = selectionStart \|\| 0;/);
	    assert.match(contextSection, /let tokenStart = caret;/);
	    assert.match(contextSection, /while \(tokenStart > 0 && !isWhitespaceChar\(value\[tokenStart - 1\]\)\) tokenStart -= 1;/);
	    assert.match(contextSection, /return \{ start: tokenStart, query: value\.slice\(tokenStart \+ 1, caret\) \};/);
	    assert.doesNotMatch(contextSection, /\.slice\(0, caret\)/);
	    assert.doesNotMatch(contextSection, /\.match\(/);
	    assert.match(bootstrapSource, /function normalizeAvailableSkills\(skills\) \{/);
	    assert.match(bootstrapSource, /function setAvailableSkillsFromNormalized\(next\) \{/);
	    assert.match(setAvailableSection, /return setAvailableSkillsFromNormalized\(normalizeAvailableSkills\(skills\)\);/);
	    assert.match(bootstrapSource, /const searchText = \[\];/);
	    assert.match(bootstrapSource, /const key = createCompactRenderStateKeyBuilder\(\);/);
	    assert.match(normalizeAvailableSection, /for \(let i = 0; i < next\.length; i\+\+\)/);
	    assert.match(normalizeAvailableSection, /const item = next\[i\];/);
	    assert.doesNotMatch(normalizeAvailableSection, /for \(const item of next\)/);
	    assert.match(bootstrapSource, /searchText\.push\(name\.toLowerCase\(\)\);/);
	    assert.match(bootstrapSource, /appendCompactRenderStateKeyPart\(key, name\);/);
	    assert.match(bootstrapSource, /appendCompactRenderStateKeyPart\(key, normalized\.length\);/);
	    assert.match(bootstrapSource, /key: finishCompactRenderStateKey\(key\)/);
	    assert.doesNotMatch(bootstrapSource, /keyParts = appendRenderKeyPart\(keyParts, name\);/);
	    assert.doesNotMatch(bootstrapSource, /const key = appendRenderKeyPart\('', normalized\.length\) \+ keyParts;/);
	    assert.match(bootstrapSource, /if \(!next \|\| next\.key === availableSkillsKey\) return false;/);
	    assert.match(bootstrapSource, /availableSkillSearchText = searchText;/);
	    assert.match(bootstrapSource, /availableSkillsKey = next\.key;/);
	    assert.doesNotMatch(bootstrapSource, /JSON\.stringify\(normalized\)/);
	    assert.match(bootstrapSource, /availableSkillsVersion \+= 1;/);
	    assert.match(filterSection, /const matches = \[\];/);
	    assert.match(filterSection, /const q = localQuery \|\| '';/);
	    assert.match(filterSection, /let hasPrefixMatches = false;/);
	    assert.match(filterSection, /for \(let i = 0; i < availableSkills\.length; i\+\+\)/);
	    assert.match(filterSection, /const haystack = availableSkillSearchText\[i\] \|\| '';/);
	    assert.match(filterSection, /if \(!hasPrefixMatches\) \{\s*matches\.length = 0;\s*hasPrefixMatches = true;\s*\}/);
	    assert.match(filterSection, /return matches;/);
	    assert.doesNotMatch(filterSection, /name\.toLowerCase\(\)/);
	    assert.doesNotMatch(filterSection, /\.toLowerCase\(\)/);
	    assert.doesNotMatch(filterSection, /const starts = \[\];/);
	    assert.doesNotMatch(filterSection, /const contains = \[\];/);
	    assert.match(consumeSection, /event\.stopImmediatePropagation/);
	    assert.match(closeSection, /if \(!skillDropdownOpen && skillDropdownItems\.length === 0 && skillDropdownTokenStart === -1 && !skillDropdownQuery\) return;/);
	    assert.match(closeSection, /skillDropdownLocalQuery = '';/);
	    assert.match(visibilitySection, /if \(skillDropdownVisible === visibleFlag\) return;/);
	    assert.match(visibilitySection, /skillDropdownVisible = visibleFlag;/);
	    assert.match(visibilitySection, /skillDropdown\.classList\.toggle\('hidden', !visibleFlag\);/);
	    assert.doesNotMatch(visibilitySection, /setHidden\(skillDropdown/);
	    assert.match(closeSection, /setSkillDropdownVisible\(false\);/);
	    assert.match(closeSection, /syncSkillDropdownInputState\(\);/);
	    assert.match(closeSection, /replaceElementChildren\(skillDropdown\);/);
	    assert.match(closeSection, /skillDropdownRenderKey = '';/);
    assert.match(activeStateSection, /const expanded = skillDropdownOpen \? 'true' : 'false';/);
    assert.match(activeStateSection, /const nextStateKeyBuilder = createCompactRenderStateKeyBuilder\(\);/);
    assert.match(activeStateSection, /appendCompactRenderStateKeyPart\(nextStateKeyBuilder, expanded\);/);
    assert.match(activeStateSection, /appendCompactRenderStateKeyPart\(nextStateKeyBuilder, activeId\);/);
    assert.match(activeStateSection, /const nextStateKey = finishCompactRenderStateKey\(nextStateKeyBuilder\);/);
    assert.match(activeStateSection, /if \(nextStateKey === skillDropdownInputStateKey\) return;/);
    assert.match(activeStateSection, /skillDropdownInputStateKey = nextStateKey;/);
    assert.match(activeStateSection, /setAttributeValue\(input, 'aria-expanded', expanded\);/);
	    assert.match(activeStateSection, /setAttributeValue\(input, 'aria-activedescendant', activeId\);/);
	    assert.match(activeStateSection, /removeAttributeValue\(input, 'aria-activedescendant'\);/);
	    assert.match(activeStateSection, /function\s+scrollSelectedSkillDropdownItemIntoView\(\)/);
	    assert.match(activeStateSection, /const selectedEl = skillDropdown\.children && skillDropdown\.children\[skillDropdownSelectedIndex\];/);
	    assert.match(activeStateSection, /function\s+syncSkillDropdownItemSelection\(index, selected\)/);
	    assert.match(activeStateSection, /if \(!itemEl \|\| !skillDropdownItemIndexByElement\.has\(itemEl\)\) return;/);
	    assert.match(activeStateSection, /setAttributeValue\(itemEl, 'aria-selected', 'true'\);/);
	    assert.match(activeStateSection, /removeAttributeValue\(itemEl, 'aria-selected'\);/);
	    assert.match(activeStateSection, /function\s+syncSkillDropdownSelection\(previousIndex\)/);
	    assert.match(activeStateSection, /if \(skillDropdownSyncedSelectedIndex === skillDropdownSelectedIndex\) \{/);
	    assert.match(activeStateSection, /syncSkillDropdownItemSelection\(previousIndex, false\);[\s\S]*syncSkillDropdownItemSelection\(skillDropdownSelectedIndex, true\);/);
	    assert.match(activeStateSection, /skillDropdownSyncedSelectedIndex = skillDropdownSelectedIndex;/);
	    assert.match(activeStateSection, /if \(!itemEl \|\| !skillDropdownItemIndexByElement\.has\(itemEl\)\) continue;/);
	    assert.match(activeStateSection, /syncSkillDropdownItemSelection\(i, i === skillDropdownSelectedIndex\);/);
	    assert.doesNotMatch(activeStateSection, /dataset\.index/);
	    assert.doesNotMatch(activeStateSection, /String\(itemEl\.className \|\| ''\)/);
	    assert.doesNotMatch(activeStateSection, /\.includes\('skill-dropdown-item'\)/);
	    assert.match(renderSection, /const nextRenderKey = getSkillDropdownRenderKey\(\);/);
	    assert.match(renderSection, /if \(skillDropdownOpen && skillDropdownRenderKey === nextRenderKey\) \{/);
	    assert.match(renderSection, /syncSkillDropdownSelection\(\);/);
	    assert.match(renderSection, /skillDropdownRenderKey = nextRenderKey;/);
	    assert.doesNotMatch(renderKeySection, /skillDropdownSelectedIndex/);
	    assert.match(renderKeySection, /const key = createCompactRenderStateKeyBuilder\(\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, skillDropdownItems\.length\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, availableSkills\.length === 0 \? 'No skills available\.' : 'No matching skills\.'\);/);
	    assert.match(renderKeySection, /appendCompactRenderStateKeyPart\(key, skillDropdownItems\[i\]\);/);
	    assert.match(renderKeySection, /return finishCompactRenderStateKey\(key\);/);
	    assert.doesNotMatch(renderKeySection, /appendRenderKeyPart\(key,/);
	    assert.doesNotMatch(renderKeySection, /getCompactRenderStateKey\(key\)/);
	    assert.match(renderSection, /const itemEl = document\.createElement\('div'\);/);
	    assert.match(renderSection, /const displayName = name\.length <= SKILL_DROPDOWN_ITEM_DISPLAY_LIMIT\s*\?\s*name\s*:\s*name\.slice\(0, SKILL_DROPDOWN_ITEM_DISPLAY_LIMIT\) \+ '…';/);
    assert.doesNotMatch(renderSection, /document\.createElement\('button'\)/);
    assert.doesNotMatch(renderSection, /itemEl\.type = 'button'/);
	    assert.match(renderSection, /setSkillDropdownVisible\(true\);/);
		    assert.match(renderSection, /replaceElementChildren\(skillDropdown, emptyEl\);/);
		    assert.match(renderSection, /const fragment = skillDropdownItems\.length > 1 \? document\.createDocumentFragment\(\) : null;/);
		    assert.match(renderSection, /let singleItemEl = null;/);
		    assert.match(renderSection, /if \(fragment\) \{[\s\S]*fragment\.appendChild\(itemEl\);[\s\S]*\} else \{[\s\S]*singleItemEl = itemEl;[\s\S]*\}/);
		    assert.match(renderSection, /replaceElementChildren\(skillDropdown, fragment \|\| singleItemEl\);/);
		    assert.doesNotMatch(renderSection, /const fragment = document\.createDocumentFragment\(\);/);
	    assert.match(renderSection, /itemEl\.id = getSkillDropdownOptionId\(i\);/);
	    assert.match(renderSection, /skillDropdownItemIndexByElement\.set\(itemEl, i\);/);
	    assert.match(renderSection, /if \(i === skillDropdownSelectedIndex\) itemEl\.setAttribute\('aria-selected', 'true'\);/);
	    assert.match(renderSection, /itemEl\.textContent = displayName;/);
	    assert.match(renderSection, /itemEl\.title = displayName;/);
	    assert.doesNotMatch(renderSection, /itemEl\.textContent = name;/);
	    assert.doesNotMatch(renderSection, /'aria-selected', i === skillDropdownSelectedIndex \? 'true' : 'false'/);
	    assert.doesNotMatch(bootstrapSource, /dataset\.index/);
	    assert.match(bootstrapSource, /const idx = skillDropdownItemIndexByElement\.get\(item\);/);
    assert.match(renderSection, /syncSkillDropdownInputState\(\);/);
    assert.match(renderSection, /scrollSelectedSkillDropdownItemIntoView\(\);/);
    assert.match(updateSection, /const skillsChanged = skillDropdownItemsVersion !== availableSkillsVersion;/);
    assert.match(updateSection, /if \(!queryChanged && !skillsChanged && skillDropdownOpen\) return;/);
    assert.match(updateSection, /const nextLocalQuery = queryChanged \? ctx\.query\.toLowerCase\(\) : skillDropdownLocalQuery;/);
    assert.match(updateSection, /const nextItems = filterSkillsForQuery\(nextLocalQuery\);/);
    assert.match(updateSection, /skillDropdownItemsVersion = availableSkillsVersion;/);
    assert.match(updateSection, /skillDropdownLocalQuery = nextLocalQuery;/);
		    assert.match(moveSection, /const previousIndex = skillDropdownSelectedIndex;/);
		    assert.match(moveSection, /syncSkillDropdownSelection\(previousIndex\);/);
		    assert.doesNotMatch(moveSection, /syncSkillDropdownSelection\(\);/);
		    assert.doesNotMatch(moveSection, /renderSkillDropdown\(\);/);
		    assert.match(applySection, /while \(end < text\.length && isSkillQueryChar\(text\[end\]\)\) end\+\+;/);
		    assert.match(applySection, /if \(text !== nextText\) \{[\s\S]*input\.value = nextText;[\s\S]*updateInputLayout\(\);[\s\S]*\}/);
		    assert.doesNotMatch(applySection, /\[A-Za-z0-9_\.-\]\.test/);
		    assert.match(inputKeydownSection, /if \(isEscapeKey\(e\)\) \{[\s\S]*consumeHandledKeyEvent\(e\);[\s\S]*closeSkillDropdown\(\);/);
		    assert.doesNotMatch(inputKeydownSection, /if \(isEscapeKey\(e\)\) \{[\s\S]*e\.preventDefault\(\);[\s\S]*closeSkillDropdown\(\);/);
		    assert.match(inputKeydownSection, /const selectionStart = input\.selectionStart;/);
		    assert.match(inputKeydownSection, /const selectionEnd = input\.selectionEnd;/);
		    assert.match(inputKeydownSection, /if \(selectionStart !== selectionEnd\) return;/);
		    assert.match(inputKeydownSection, /const caret = selectionStart \|\| 0;/);
		    assert.match(inputKeydownSection, /const isEmpty = !hasNonWhitespaceText\(text\);/);
		    assert.doesNotMatch(inputKeydownSection, /text\.trim\(\)/);
		    assert.doesNotMatch(closeSection + renderSection, /setHidden\(skillDropdown/);
		    assert.doesNotMatch(closeSection + renderSection, /skillDropdown\.classList\.(?:add|toggle)\('hidden'/);
		    assert.doesNotMatch(closeSection + renderSection, /skillDropdown\.innerHTML = ''/);
		    assert.doesNotMatch(renderSection, /skillDropdown\.appendChild/);
		  });

  test('session reset clears transient file linkification state', () => {
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');

	    assert.match(contextSource, /function\s+resetFileLinkState\(/);
	    assert.match(contextSource, /fileLinkCache\.clear\(\)/);
	    assert.match(contextSource, /fileLinkCandidatesByRaw\.clear\(\)/);
	    assert.match(contextSource, /const linkifyForceRootGeneration = new WeakMap\(\);/);
	    assert.match(contextSource, /linkifyForceRootGeneration\.set\(rootEl, fileLinkGeneration\);/);
	    assert.match(contextSource, /const force = forceGeneration === fileLinkGeneration;/);
	    assert.doesNotMatch(contextSource, /const linkifyForceRoots = new WeakSet\(\);/);
	    assert.match(mainSource, /case 'init':[\s\S]*resetFileLinkState\(\)/);
	    assert.match(mainSource, /case 'cleared':[\s\S]*resetFileLinkState\(\)/);
	  });

	  test('file link resolver cache is bounded', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const applyStart = contextSource.indexOf('function applyResolvedFileLink');
    assert.ok(applyStart >= 0, 'expected resolved file link helper');
    const applyEnd = contextSource.indexOf('function renderContextPopover', applyStart);
    assert.ok(applyEnd > applyStart, 'expected end of resolved file link helper');
    const applySection = contextSource.slice(applyStart, applyEnd);

    assert.match(contextSource, /const FILE_LINK_CACHE_MAX_ENTRIES = \d+;/);
    assert.match(contextSource, /function\s+pruneFileLinkCache\(/);
    assert.match(contextSource, /const oldestRaws = fileLinkCache\.keys\(\);/);
    assert.match(contextSource, /const next = oldestRaws\.next\(\);/);
    assert.match(contextSource, /if \(next\.done\) return;/);
    assert.match(contextSource, /const oldestRaw = next\.value;/);
    assert.match(contextSource, /while \(fileLinkCache\.size > FILE_LINK_CACHE_MAX_ENTRIES\)/);
    assert.doesNotMatch(contextSource, /fileLinkCache\.keys\(\)\.next\(\)/);
    assert.doesNotMatch(
      contextSource,
      /rootEl\.querySelectorAll\('\.file-link-token\.file-link-candidate'\)/
    );
    assert.match(contextSource, /const fileLinkCandidatesByRoot = new WeakMap\(\);/);
    assert.match(contextSource, /function\s+collectKnownFileLinkCandidatesForRoot\(/);
    const handleStart = contextSource.indexOf('function handleResolvedFileLinks');
    assert.ok(handleStart >= 0, 'expected resolved file link handler');
    const handleEnd = contextSource.indexOf('function applyResolvedFileLink', handleStart);
    assert.ok(handleEnd > handleStart, 'expected resolved file link applier after handler');
    const handleSection = contextSource.slice(handleStart, handleEnd);
    assert.match(handleSection, /const checkedAt = Date\.now\(\);/);
    assert.match(handleSection, /for \(let i = 0; i < results\.length; i\+\+\)/);
    assert.match(handleSection, /const r = results\[i\];/);
    assert.match(handleSection, /fileLinkCache\.set\(raw,\s*\{ ok, path: resolvedPath, checkedAt \}\);/);
    assert.match(handleSection, /if \(cacheChanged\) pruneFileLinkCache\(\);/);
    assert.doesNotMatch(handleSection, /for \(const r of results\)/);
    assert.doesNotMatch(handleSection, /checkedAt: Date\.now\(\)/);
    assert.doesNotMatch(handleSection, /fileLinkCache\.set\(raw,[\s\S]*?pruneFileLinkCache\(\);[\s\S]*?applyResolvedFileLink\(raw\);/);
    assert.match(applySection, /for \(const el of set\)/);
    assert.doesNotMatch(applySection, /Array\.from\(set\)/);
	    assert.match(applySection, /set\.clear\(\);/);
	    assert.match(applySection, /fileLinkCandidatesByRaw\.delete\(raw\)/);
	    assert.doesNotMatch(applySection, /set\.delete\(el\)/);
	  });

	  test('file link candidate state caches avoid DOM dataset payload storage', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const markStart = contextSource.indexOf('function markFileCandidatesInElement');
	    assert.ok(markStart >= 0, 'expected file candidate marker');
	    const markEnd = contextSource.indexOf('function collectPendingFileLinkCandidate', markStart);
	    assert.ok(markEnd > markStart, 'expected collector after marker');
	    const markSection = contextSource.slice(markStart, markEnd);
	    const collectStart = contextSource.indexOf('function collectPendingFileLinkCandidate');
	    assert.ok(collectStart >= 0, 'expected file candidate collector');
	    const collectEnd = contextSource.indexOf('function shouldSkipFileLinkify', collectStart);
	    assert.ok(collectEnd > collectStart, 'expected collector section end');
	    const collectSection = contextSource.slice(collectStart, collectEnd);
	    const registerStart = contextSource.indexOf('function registerFileLinkCandidate');
	    assert.ok(registerStart >= 0, 'expected file candidate registrar');
	    const registerEnd = contextSource.indexOf('function registerRootFileLinkCandidate', registerStart);
	    assert.ok(registerEnd > registerStart, 'expected root registrar after candidate registrar');
	    const registerSection = contextSource.slice(registerStart, registerEnd);

	    assert.match(contextSource, /const fileLinkRawByElement = new WeakMap\(\);/);
	    assert.match(contextSource, /const fileLinkLocationByElement = new WeakMap\(\);/);
		    assert.match(contextSource, /function rememberFileLinkCandidateRaw\(el, raw\)/);
		    assert.match(contextSource, /function getFileLinkCandidateRaw\(el\)/);
		    assert.match(contextSource, /const FILE_LINK_CANDIDATE_LABEL_DISPLAY_LIMIT = 160;/);
		    assert.match(contextSource, /function getFileLinkCandidateDisplayLabel\(label, raw\)/);
		    assert.match(contextSource, /value\.length <= FILE_LINK_CANDIDATE_LABEL_DISPLAY_LIMIT/);
		    assert.match(contextSource, /value\.slice\(0, FILE_LINK_CANDIDATE_LABEL_DISPLAY_LIMIT\) \+ '…'/);
			    assert.match(contextSource, /function normalizeFileLinkLocationCoordinate\(value\)/);
			    assert.match(contextSource, /const parsed = Number\(value\);/);
			    assert.match(contextSource, /return Number\.isInteger\(parsed\) && parsed > 0 \? parsed : 1;/);
			    assert.match(contextSource, /function rememberFileLinkCandidateLocation\(el, line, character\)/);
			    assert.match(contextSource, /line: normalizeFileLinkLocationCoordinate\(line\),/);
			    assert.match(contextSource, /character: normalizeFileLinkLocationCoordinate\(character\),/);
			    assert.match(contextSource, /function getFileLinkCandidateLocation\(el\)/);
			    assert.match(contextSource, /function createFileLinkCandidateSpan\(part, rootEl, markedCandidates\)/);
			    assert.match(contextSource, /const EMPTY_FILE_LINK_CANDIDATES = \[\];/);
			    assert.match(markSection, /let candidates = null;/);
			    assert.match(markSection, /if \(!candidates\) candidates = \[\];/);
			    assert.match(markSection, /if \(!candidates\) return EMPTY_FILE_LINK_CANDIDATES;/);
			    assert.match(markSection, /parts\.length === 1 && parts\[0\]\.kind === 'file' && !parts\[0\]\.prefix && !parts\[0\]\.suffix/);
			    assert.match(markSection, /textNode\.parentNode\.replaceChild\(span, textNode\);/);
			    assert.match(markSection, /for \(let candidateIndex = 0; candidateIndex < candidates\.length; candidateIndex\+\+\)/);
			    assert.match(markSection, /candidates\.push\(n\);/);
			    assert.match(markSection, /const textNode = candidates\[candidateIndex\];/);
			    assert.match(markSection, /const text = String\(textNode\.nodeValue \|\| ''\);/);
			    assert.match(markSection, /for \(let partIndex = 0; partIndex < parts\.length; partIndex\+\+\)/);
			    assert.match(markSection, /const part = parts\[partIndex\];/);
			    assert.match(markSection, /createFileLinkCandidateSpan\(part, rootEl, markedCandidates\);/);
		    assert.match(contextSource, /rememberFileLinkCandidateRaw\(span, part\.fileRaw\);/);
		    assert.match(contextSource, /rememberFileLinkCandidateLocation\(span, part\.line, part\.character\);/);
		    assert.match(contextSource, /span\.textContent = getFileLinkCandidateDisplayLabel\(part\.label, part\.fileRaw\);/);
		    assert.doesNotMatch(contextSource, /span\.textContent = part\.label \|\| part\.fileRaw;/);
	    assert.match(collectSection, /const raw = getFileLinkCandidateRaw\(el\);/);
	    assert.match(registerSection, /rememberFileLinkCandidateRaw\(el, raw\);/);
			    assert.doesNotMatch(markSection, /for \(const item of candidates\)/);
			    assert.doesNotMatch(markSection, /for \(const part of parts\)/);
			    assert.doesNotMatch(markSection, /const candidates = \[\];/);
			    assert.doesNotMatch(markSection, /candidates\.push\(\{ textNode: n, text \}\);/);
			    assert.doesNotMatch(contextSource, /dataset\.fileRaw/);
	    assert.doesNotMatch(contextSource, /dataset\.line/);
	    assert.doesNotMatch(contextSource, /dataset\.character/);
	    assert.doesNotMatch(contextSource, /Math\.floor\(Number\(line/);
	    assert.doesNotMatch(contextSource, /Math\.floor\(Number\(character/);
	  });

	  test('resolved file link buttons keep open payloads out of DOM datasets', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
	    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
	    const applyStart = contextSource.indexOf('function applyResolvedFileLink');
	    assert.ok(applyStart >= 0, 'expected resolved file link applier');
	    const applyEnd = contextSource.indexOf('function renderContextPopover', applyStart);
	    assert.ok(applyEnd > applyStart, 'expected context popover after resolved file link applier');
	    const applySection = contextSource.slice(applyStart, applyEnd);
	    const labelStart = bootstrapSource.indexOf('function formatOpenLocationLabel');
	    assert.ok(labelStart >= 0, 'expected open-location label formatter');
	    const labelEnd = bootstrapSource.indexOf('function setTextContent', labelStart);
	    assert.ok(labelEnd > labelStart, 'expected text content helper after open-location formatter');
	    const labelSection = bootstrapSource.slice(labelStart, labelEnd);
	    const handlerStart = renderUtilsSource.indexOf("if (action === 'openLocation')");
	    assert.ok(handlerStart >= 0, 'expected open-location click handler');
	    const handlerEnd = renderUtilsSource.indexOf("if (action === 'viewCompactionSummary')", handlerStart);
	    assert.ok(handlerEnd > handlerStart, 'expected compaction handler after open-location handler');
	    const handlerSection = renderUtilsSource.slice(handlerStart, handlerEnd);

	    assert.match(renderUtilsSource, /const openLocationPayloadByElement = new WeakMap\(\);/);
	    assert.match(renderUtilsSource, /const openLocationPayloadById = new Map\(\);/);
	    assert.match(renderUtilsSource, /const openLocationPayloadIdByKey = new Map\(\);/);
	    assert.match(renderUtilsSource, /filePath: getNonWhitespaceString\(filePath\),/);
	    assert.match(renderUtilsSource, /line: typeof line === 'number' && Number\.isInteger\(line\) && line > 0 \? line : 0,/);
	    assert.match(renderUtilsSource, /character: typeof character === 'number' && Number\.isInteger\(character\) && character > 0 \? character : 1,/);
	    assert.match(renderUtilsSource, /function rememberOpenLocationPayload\(el, filePath, line, character\)/);
	    assert.match(renderUtilsSource, /function getOpenLocationPayload\(el\)/);
	    assert.match(renderUtilsSource, /openLocationPayloadByElement\.set\(el, payload\)/);
		    assert.match(renderUtilsSource, /function renderOpenLocationAttrs\(filePath, line, character\)/);
		    assert.match(renderUtilsSource, /function hydrateOpenLocationPayloadButton\(button\)/);
		    assert.match(renderUtilsSource, /function hydrateOpenLocationPayloads\(rootEl\)/);
		    assert.match(renderUtilsSource, /querySelectorAll\('\[data-open-location-id\]'\)/);
		    assert.match(contextSource, /const FILE_LINK_OPEN_LABEL_DISPLAY_LIMIT = 160;/);
		    assert.match(contextSource, /function getFileLinkOpenDisplayPath\(path\)/);
		    assert.match(contextSource, /value\.length <= FILE_LINK_OPEN_LABEL_DISPLAY_LIMIT/);
		    assert.match(contextSource, /value\.slice\(0, FILE_LINK_OPEN_LABEL_DISPLAY_LIMIT\) \+ '…'/);
		    assert.match(applySection, /const location = getFileLinkCandidateLocation\(el\);/);
		    assert.match(applySection, /rememberRenderedAction\(btn, 'openLocation'\);/);
		    assert.match(applySection, /rememberOpenLocationPayload\(btn, cached\.path, line, character\);/);
		    assert.match(applySection, /const displayPath = getFileLinkOpenDisplayPath\(cached\.path\);/);
		    assert.match(applySection, /const openLabel = formatOpenLocationLabel\(displayPath, line, character\);/);
		    assert.match(applySection, /const accessibleLabel = formatOpenLocationAccessibleLabel\(visibleLabel, displayPath, line, character\);/);
		    assert.match(labelSection, /const displayPath = typeof filePath === 'string' && hasNonWhitespaceText\(filePath\) \? filePath\.trim\(\) : 'file';/);
	    assert.match(labelSection, /const lineNumber = Number\.isInteger\(parsedLine\) && parsedLine > 0 \? parsedLine : 1;/);
	    assert.match(labelSection, /const characterNumber = Number\.isInteger\(parsedCharacter\) && parsedCharacter > 0 \? parsedCharacter : 1;/);
	    assert.match(labelSection, /const text = typeof visibleLabel === 'string' && hasNonWhitespaceText\(visibleLabel\) \? visibleLabel\.trim\(\) : '';/);
	    assert.doesNotMatch(applySection, /btn\.dataset\.action/);
	    assert.doesNotMatch(applySection, /btn\.dataset\.path/);
	    assert.doesNotMatch(applySection, /btn\.dataset\.line/);
	    assert.doesNotMatch(applySection, /btn\.dataset\.character/);
	    assert.doesNotMatch(applySection, /el\.dataset\.line/);
	    assert.doesNotMatch(applySection, /el\.dataset\.character/);
	    assert.match(handlerSection, /const location = getOpenLocationPayload\(locationBtn\);/);
	    assert.doesNotMatch(handlerSection, /locationBtn\.dataset\.path/);
	    assert.doesNotMatch(renderUtilsSource, /\bdata-path=/);
	    assert.doesNotMatch(renderUtilsSource, /\bdata-line=/);
	    assert.doesNotMatch(renderUtilsSource, /\bdata-character=/);
	    assert.doesNotMatch(renderUtilsSource, /dataset\.path/);
	    assert.doesNotMatch(renderUtilsSource, /dataset\.line/);
	    assert.doesNotMatch(renderUtilsSource, /dataset\.character/);
	    assert.doesNotMatch(renderUtilsSource, /filePath: String\(filePath \|\| ''\)/);
	    assert.doesNotMatch(renderUtilsSource, /line: Number\(line \|\| 0\) \|\| 0/);
	    assert.doesNotMatch(renderUtilsSource, /character: Number\(character \|\| 1\) \|\| 1/);
		    assert.doesNotMatch(labelSection, /const displayPath = String\(filePath \|\| 'file'\);/);
		    assert.doesNotMatch(labelSection, /Math\.floor\(Number\((?:line|character)/);
		    assert.doesNotMatch(labelSection, /String\(visibleLabel \|\| ''\)\.trim\(\)/);
		    assert.doesNotMatch(applySection, /formatOpenLocationLabel\(cached\.path/);
		    assert.doesNotMatch(applySection, /formatOpenLocationAccessibleLabel\(visibleLabel, cached\.path/);
		  });

		  test('file link resolver batching avoids extra full-array filter slice and map passes', () => {
		    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const requestStart = contextSource.indexOf('function requestResolveFileLinks');
    assert.ok(requestStart >= 0, 'expected resolver request helper');
    const requestEnd = contextSource.indexOf('function handleResolvedFileLinks', requestStart);
    assert.ok(requestEnd > requestStart, 'expected end of resolver request helper section');
    const requestSection = contextSource.slice(requestStart, requestEnd);

    assert.match(requestSection, /function\s+postFileLinkResolveChunk\(/);
    assert.match(requestSection, /for \(let i = 0; i < rawPaths\.length; i\+\+\)/);
    assert.match(requestSection, /const raw = rawPaths\[i\];/);
	    assert.match(requestSection, /candidates\.push\(\{ raw \}\);/);
	    assert.match(requestSection, /if \(candidates\.length >= chunkSize\)/);
	    assert.match(requestSection, /for \(let candidateIndex = 0; candidateIndex < candidates\.length; candidateIndex\+\+\)/);
	    assert.match(requestSection, /const candidate = candidates\[candidateIndex\];/);
	    assert.match(requestSection, /fileLinkPending\.delete\(candidate\.raw\);/);
	    assert.doesNotMatch(requestSection, /for \(const raw of rawPaths\)/);
	    assert.doesNotMatch(requestSection, /for \(const candidate of candidates\)/);
	    assert.doesNotMatch(requestSection, /\.filter\(Boolean\)/);
    assert.doesNotMatch(requestSection, /\.slice\(i,\s*i \+ chunkSize\)/);
	    assert.doesNotMatch(requestSection, /\.map\(raw => \(\{ raw \}\)\)/);
	  });

	  test('webview file link resolver scans unique candidates in one pass', () => {
	    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.webview.ts'), 'utf8');
	    const caseStart = source.indexOf("case 'resolveFileLinks':");
	    assert.ok(caseStart >= 0, 'expected resolveFileLinks webview branch');
	    const caseEnd = source.indexOf("case 'openNativeDiff':", caseStart);
	    assert.ok(caseEnd > caseStart, 'expected native diff branch after file link resolver');
	    const caseSection = source.slice(caseStart, caseEnd);

	    assert.match(caseSection, /const results: Array<\{ raw: string; ok: boolean; path\?: string \}> = \[\];/);
	    assert.match(caseSection, /const seen = new Set<string>\(\);/);
	    assert.match(caseSection, /let uniqueCount = 0;/);
	    assert.match(caseSection, /for \(const item of candidatesRaw\)/);
	    assert.match(caseSection, /if \(uniqueCount >= 200\) break;/);
	    assert.match(caseSection, /uniqueCount\+\+;/);
	    assert.match(caseSection, /const stripped = normalized\.slice\(2\);/);
	    assert.match(caseSection, /await resolveExistingFilePath\(stripped, workspaceFolderUris, allowExternalPaths\)/);
	    assert.match(caseSection, /if \(!resolved\) \{[\s\S]*await resolveExistingFilePath\(normalized, workspaceFolderUris, allowExternalPaths\)/);
	    assert.match(caseSection, /results\.push\(\{ raw, ok: true, path: resolved\.absPath \}\);/);
	    assert.doesNotMatch(caseSection, /const deduped: string\[\] = \[\];/);
	    assert.doesNotMatch(caseSection, /deduped\.push/);
	    assert.doesNotMatch(caseSection, /for \(const raw of deduped\)/);
	    assert.doesNotMatch(caseSection, /const candidates: string\[\] = \[\];/);
	    assert.doesNotMatch(caseSection, /candidates\.push/);
	    assert.doesNotMatch(caseSection, /for \(const candidate of candidates\)/);
	  });

	  test('file linkification queue drains without snapshot array allocation', () => {
	    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
	    const scheduleStart = contextSource.indexOf('function scheduleFileLinkify');
	    assert.ok(scheduleStart >= 0, 'expected file linkification scheduler');
	    const scheduleEnd = contextSource.indexOf('function scheduleFileLinkifyIfNeeded', scheduleStart);
	    assert.ok(scheduleEnd > scheduleStart, 'expected end of file linkification scheduler');
	    const scheduleSection = contextSource.slice(scheduleStart, scheduleEnd);
    const flushStart = contextSource.indexOf('function flushFileLinkifyQueue');
    assert.ok(flushStart >= 0, 'expected file linkification flush helper');
	    const flushEnd = contextSource.indexOf('function markFileCandidatesInElement', flushStart);
	    assert.ok(flushEnd > flushStart, 'expected end of file linkification flush helper');
	    const flushSection = contextSource.slice(flushStart, flushEnd);
	    const collectStart = contextSource.indexOf('function collectPendingFileLinkCandidate', flushEnd);
	    assert.ok(collectStart > flushEnd, 'expected file link candidate collector after marker');
	    const collectEnd = contextSource.indexOf('function shouldSkipFileLinkify', collectStart);
	    assert.ok(collectEnd > collectStart, 'expected end of file link candidate collector');
	    const collectSection = contextSource.slice(collectStart, collectEnd);

	    assert.match(scheduleSection, /if \(!rootEl\) return;/);
	    assert.match(scheduleSection, /linkifyQueue\.add\(rootEl\);/);
	    assert.match(scheduleSection, /if \(opts && opts\.force\)/);
	    assert.doesNotMatch(scheduleSection, /querySelectorAll/);
	    assert.match(flushSection, /const rootCount = linkifyQueue\.size;/);
		    assert.match(flushSection, /const roots = linkifyQueue\.values\(\);/);
		    assert.match(flushSection, /const next = roots\.next\(\);/);
		    assert.match(flushSection, /if \(next\.done\) break;/);
		    assert.match(flushSection, /const rootEl = next\.value;/);
		    assert.match(flushSection, /linkifyQueue\.delete\(rootEl\);/);
		    assert.match(flushSection, /const pendingRaw = \[\];/);
		    assert.match(flushSection, /const pendingRawSet = new Set\(\);/);
		    assert.match(flushSection, /let negativeCacheNow = null;/);
		    assert.match(flushSection, /function getNegativeCacheNow\(\)/);
		    assert.match(flushSection, /if \(negativeCacheNow === null\) negativeCacheNow = Date\.now\(\);/);
		    assert.match(flushSection, /const markedCandidates = markFileCandidatesInElement\(rootEl\) \|\| \[\];/);
		    assert.match(flushSection, /for \(let markedIndex = 0; markedIndex < markedCandidates\.length; markedIndex\+\+\)/);
		    assert.match(flushSection, /const el = markedCandidates\[markedIndex\];/);
		    assert.match(flushSection, /collectPendingFileLinkCandidate\(el, force, pendingRawSet, pendingRaw, getNegativeCacheNow\);/);
		    assert.doesNotMatch(flushSection, /for \(const el of markedCandidates\)/);
		    assert.match(flushSection, /if \(force \|\| markedCandidates\.length === 0\)/);
		    assert.match(flushSection, /collectKnownFileLinkCandidatesForRoot\(rootEl, force, pendingRawSet, pendingRaw, getNegativeCacheNow\);/);
		    assert.match(collectSection, /const now = typeof getNegativeCacheNow === 'function' \? getNegativeCacheNow\(\) : Date\.now\(\);/);
		    assert.match(collectSection, /const age = now - \(Number\(cached\.checkedAt \|\| 0\) \|\| 0\);/);
		    assert.match(collectSection, /pendingRaw\.push\(raw\);/);
		    assert.match(flushSection, /requestResolveFileLinks\(pendingRaw\);/);
		    assert.match(collectSection, /fileLinkPending\.has\(raw\)/);
		    assert.match(collectSection, /pendingRawSet\.has\(raw\)/);
		    assert.doesNotMatch(collectSection, /Date\.now\(\) -/);
		    assert.doesNotMatch(flushSection, /linkifyQueue\.values\(\)\.next\(\)/);
		    assert.doesNotMatch(flushSection, /Array\.from\(linkifyQueue\)/);
	    assert.doesNotMatch(flushSection, /Array\.from\(pendingRaw\)/);
	    assert.doesNotMatch(flushSection, /roots\.forEach/);
	    assert.doesNotMatch(flushSection, /rootEl\.querySelectorAll\('\.file-link-token\.file-link-candidate'\)/);
	  });

  test('tool output and legacy diff previews scan without allocating full line arrays', () => {
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const previewStart = renderUtilsSource.indexOf('const PREVIEW_LINE_CHAR_LIMIT');
    assert.ok(previewStart >= 0, 'expected preview line cap constant');
    const previewEnd = renderUtilsSource.indexOf('function extractArgValue', previewStart);
    assert.ok(previewEnd > previewStart, 'expected preview helper section end');
		    const previewSection = renderUtilsSource.slice(previewStart, previewEnd);

				    assert.match(previewSection, /const PREVIEW_LINE_CHAR_LIMIT = 400;/);
				    assert.match(previewSection, /const PREVIEW_REMAINING_LINE_SCAN_LIMIT = 1000;/);
				    assert.match(previewSection, /const DIFF_VIEW_MAX_VISIBLE_ROWS = 120;/);
				    assert.match(previewSection, /const LSP_LOCATION_RENDER_LIMIT = 30;/);
				    assert.match(previewSection, /const LSP_HOVER_MARKDOWN_CHAR_LIMIT = 4000;/);
			    assert.match(previewSection, /function\s+appendPreviewLine\(/);
			    assert.match(previewSection, /lineLength > PREVIEW_LINE_CHAR_LIMIT/);
			    assert.match(previewSection, /function\s+collectPreviewLines\(/);
			    assert.match(previewSection, /function\s+formatPreviewRemainingText\(preview\)/);
			    assert.match(previewSection, /preview\.remainingExact === false/);
			    assert.match(previewSection, /const toolResultTextCache = new WeakMap\(\);/);
			    assert.match(previewSection, /const toolResultPreviewHtmlCache = new WeakMap\(\);/);
			    assert.match(previewSection, /function\s+getToolResultText\(toolCall\)/);
			    assert.match(previewSection, /toolCall\.result === undefined \|\| toolCall\.result === null/);
			    assert.match(previewSection, /const resultValue = toolCall\.result;/);
			    assert.match(previewSection, /const canCache = resultType !== 'function';/);
			    assert.match(previewSection, /const cached = toolResultTextCache\.get\(toolCall\);/);
			    assert.match(previewSection, /if \(cached && cached\.resultValue === resultValue\) return cached\.text;/);
			    assert.match(previewSection, /if \(resultType === 'object'\)/);
			    assert.match(previewSection, /JSON\.stringify\(resultValue, null, 2\)/);
			    assert.match(previewSection, /text = json === undefined \? String\(resultValue\) : json;/);
			    assert.match(previewSection, /text = String\(resultValue\);/);
			    assert.match(previewSection, /toolResultTextCache\.set\(toolCall, \{ resultValue, text \}\);/);
			    assert.match(previewSection, /function\s+getToolResultPreviewHtml\(toolCall, resultText, maxLines\)/);
			    assert.match(previewSection, /const cached = toolResultPreviewHtmlCache\.get\(toolCall\);/);
			    assert.match(previewSection, /cached\.resultText === resultText && cached\.maxLines === maxLines/);
			    assert.match(previewSection, /toolResultPreviewHtmlCache\.set\(toolCall, \{ resultText, maxLines, html \}\);/);
			    assert.doesNotMatch(previewSection, /return String\(toolCall\.result\);/);
					    assert.match(previewSection, /if \(text === undefined \|\| text === null\) return '';/);
					    assert.match(previewSection, /const fullText = String\(text\);/);
					    assert.match(previewSection, /if \(!hasNonWhitespaceText\(fullText\)\) return '';/);
					    assert.match(previewSection, /if \(!hasNonWhitespaceText\(diff\)\) return '';/);
					    assert.doesNotMatch(previewSection, /if \(!text\) return '';/);
			    assert.match(previewSection, /function\s+renderDiffActionsFooter\(/);
			    assert.match(previewSection, /formatPreviewRemainingText\(preview\) \+ ' more lines\)'/);
			    assert.match(previewSection, /let remainingExact = true;/);
			    assert.match(previewSection, /lineCount >= PREVIEW_REMAINING_LINE_SCAN_LIMIT/);
			    assert.match(previewSection, /remainingExact = false;/);
			    assert.match(previewSection, /if \(remainingExact && lines\.length < limit\)/);
			    assert.match(previewSection, /remainingExact,/);
			    assert.match(previewSection, /let diffViewClipped = false;/);
			    assert.match(previewSection, /let diffViewTruncated = false;/);
			    assert.match(previewSection, /visibleDiffRows >= DIFF_VIEW_MAX_VISIBLE_ROWS/);
				    assert.match(previewSection, /let scrollHtml = '';/);
				    assert.match(previewSection, /let fileRowCount = 0;/);
				    assert.match(previewSection, /const filePath = toolCall \? getNonWhitespaceString\(toolCall\.path\) : '';/);
				    assert.match(previewSection, /const rawPath = typeof file\.filePath === 'string' && hasNonWhitespaceText\(file\.filePath\) \? file\.filePath\.trim\(\) : filePath;/);
					    assert.match(previewSection, /const displayPath = truncateText\(formatFilePath\(rawPath\), TOOL_PATH_DISPLAY_LIMIT\);/);
					    assert.match(renderUtilsSource, /const TOOL_DIFF_HUNK_HEADER_DISPLAY_LIMIT = 160;/);
					    assert.match(previewSection, /const header = truncateText\(getNonWhitespaceString\(hunk\.header\), TOOL_DIFF_HUNK_HEADER_DISPLAY_LIMIT\);/);
			    assert.match(previewSection, /const oldLine = typeof line\.oldLine === 'number' && Number\.isInteger\(line\.oldLine\) && line\.oldLine > 0 \? line\.oldLine : 0;/);
			    assert.match(previewSection, /const newLine = typeof line\.newLine === 'number' && Number\.isInteger\(line\.newLine\) && line\.newLine > 0 \? line\.newLine : 0;/);
				    assert.match(previewSection, /if \(fileRowCount > 0\) \{/);
				    assert.match(previewSection, /visibleDiffRows === 0 && hasNonWhitespaceText\(diff\)/);
				    assert.match(previewSection, /alwaysShowActions: true/);
				    assert.match(previewSection, /const openAttrs = rawPath && openLine \? renderOpenLocationAttrs\(rawPath, openLine, 1\) : '';/);
				    assert.match(previewSection, /const openLabel = 'Open ' \+ displayPath \+ ' at line ' \+ openLine;/);
				    assert.match(previewSection, /const accessibleLabel = formatOpenLocationAccessibleLabel\(visibleLine, displayPath, openLine, 1\);/);
				    assert.match(previewSection, /<div class="tool-diff-file-header" title="' \+ escapeHtml\(displayPath\) \+ '">/);
				    assert.match(previewSection, /displayText\.length > PREVIEW_LINE_CHAR_LIMIT/);
		    assert.match(previewSection, /diffViewClipped = true;/);
		    assert.match(previewSection, /renderDiffActionsFooter\('Diff preview truncated', actionOptions\)/);
		    assert.match(previewSection, /escapeHtml\(displayText\)/);
				    assert.doesNotMatch(previewSection, /Number\.isFinite\(line\.(?:oldLine|newLine)\)/);
				    assert.doesNotMatch(previewSection, /const openAttrs = displayPath && openLine/);
				    assert.doesNotMatch(previewSection, /tool-diff-file-header" title="' \+ escapeHtml\(rawPath\)/);
	    assert.match(previewSection, /aria-label="View full output, full tool output"/);
	    assert.doesNotMatch(previewSection, /aria-label="View full tool output">View full output<\/button>/);
		    assert.match(renderUtilsSource, /html \+= getToolResultPreviewHtml\(toolCall, resultText, toolId === 'glob' \? 10 : 12\);/);
		    assert.match(renderUtilsSource, /showDiff = hasNonWhitespaceText\(diff\);/);
		    assert.doesNotMatch(renderUtilsSource, /renderOutputPreview\(resultText, 12\)/);
		    assert.doesNotMatch(renderUtilsSource, /showDiff = !!diff/);
	    assert.match(previewSection, /fullText\.indexOf\('\\n', lineStart\)/);
	    assert.match(previewSection, /preview\.clipped/);
	    assert.strictEqual((previewSection.match(/for \(let i = 0; i < preview\.lines\.length; i\+\+\)/g) || []).length, 2);
	    assert.doesNotMatch(previewSection, /preview\.lines\.join\('\\n'\)/);
	    assert.doesNotMatch(previewSection, /preview\.lines\.forEach/);
		    assert.doesNotMatch(previewSection, /\.split\(/);
		    assert.doesNotMatch(renderUtilsSource, /toolCall\.result \?/);
		    assert.doesNotMatch(renderUtilsSource, /&& toolCall\.result\)/);
		  });

	  test('diff action footer centralizes native and text diff buttons', () => {
	    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
	    const helperStart = renderUtilsSource.indexOf('function renderDiffActionsFooter');
    assert.ok(helperStart >= 0, 'expected shared diff action footer helper');
    const helperEnd = renderUtilsSource.indexOf('function renderDiffViewer', helperStart);
    assert.ok(helperEnd > helperStart, 'expected diff viewer after shared footer helper');
	    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);

	    assert.match(helperSection, /if \(hasNonWhitespaceText\(footerText\)\) \{/);
	    assert.match(helperSection, /aria-label="Open diff editor"/);
	    assert.match(helperSection, /aria-label="Text diff, view text diff"/);
	    assert.doesNotMatch(helperSection, /aria-label="View text diff">Text diff<\/button>/);
    assert.strictEqual((renderUtilsSource.match(/<button class="tool-diff-action" type="button"/g) || []).length, 1);
    assert.strictEqual((renderUtilsSource.match(/<button class="tool-diff-action secondary" type="button"/g) || []).length, 1);
    assert.match(renderUtilsSource, /if \(options\.canOpenNativeDiff\)/);
    assert.match(renderUtilsSource, /const actionOptions = \{ canOpenNativeDiff: !!\(toolCall && toolCall\.approvalId\) \};/);
    assert.match(renderUtilsSource, /const diffActionOptions = \{ canOpenNativeDiff: !!toolCall\.approvalId \};/);
	    assert.match(renderUtilsSource, /renderDiffActionsFooter\('Diff truncated', actionOptions\)/);
	    assert.match(renderUtilsSource, /renderDiffActionsFooter\('', actionOptions\)/);
	  });

	  test('tool action buttons share scoped accessible label rendering', () => {
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
		    const helperStart = renderUtilsSource.indexOf('function getToolActionTargetLabel');
		    assert.ok(helperStart >= 0, 'expected shared tool action label helpers');
	    const helperEnd = renderUtilsSource.indexOf('function formatFilePath', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected file path helper after tool action helper');
	    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);

	    const bodyStart = renderUtilsSource.indexOf('function formatToolCardBody');
	    assert.ok(bodyStart >= 0, 'expected tool-card body formatter');
	    const bodyEnd = renderUtilsSource.indexOf('function renderLspResults', bodyStart);
	    assert.ok(bodyEnd > bodyStart, 'expected LSP renderer after tool-card body formatter');
	    const bodySection = renderUtilsSource.slice(bodyStart, bodyEnd);
	    const handlerStart = renderUtilsSource.indexOf("if (action !== 'approve'");
	    assert.ok(handlerStart >= 0, 'expected tool action handler');
	    const handlerEnd = renderUtilsSource.indexOf("if (action === 'approve')", handlerStart);
	    assert.ok(handlerEnd > handlerStart, 'expected approval branches after handler setup');
	    const handlerSection = renderUtilsSource.slice(handlerStart, handlerEnd);

		    assert.match(helperSection, /title="' \+ escapedAriaLabel \+ '"/);
		    assert.match(helperSection, /aria-label="' \+ escapedAriaLabel \+ '"/);
			    assert.match(helperSection, /renderToolActionApprovalAttrs\(approvalId\)/);
					    assert.match(renderUtilsSource, /const TOOL_HEADER_LABEL_DISPLAY_LIMIT = 160;/);
					    assert.match(renderUtilsSource, /const TOOL_ACTION_TARGET_DISPLAY_LIMIT = 120;/);
					    assert.match(helperSection, /return truncateText\(text \|\| 'tool', TOOL_ACTION_TARGET_DISPLAY_LIMIT\);/);
			    assert.match(helperSection, /const suffixText = String\(suffix \|\| ''\);/);
					    assert.match(helperSection, /const displayText = truncateText\(text, TOOL_HEADER_LABEL_DISPLAY_LIMIT\);/);
					    assert.match(helperSection, /title="' \+ escapeHtml\(displayText \+ suffixText\) \+ '"/);
					    assert.match(helperSection, /escapeHtml\(displayText\) \+ escapeHtml\(suffixText\)/);
					    assert.doesNotMatch(helperSection, /escapeHtml\(text\) \+ escapeHtml\(suffixText\)/);
					    assert.doesNotMatch(helperSection, /escapeHtml\(text \+ suffixText\)/);
					    assert.match(renderUtilsSource, /function getNonWhitespaceString\(value\)/);
				    assert.match(bodySection, /const toolId = getNonWhitespaceString\(toolCall\.id\);/);
				    assert.match(bodySection, /const path = getNonWhitespaceString\(toolCall\.path\) \|\| getNonWhitespaceString\(args\.filePath\) \|\| getNonWhitespaceString\(args\.path\);/);
				    assert.match(bodySection, /const operationText = getNonWhitespaceString\(args\.operation\);/);
					    assert.match(bodySection, /const queryText = getNonWhitespaceString\(args\.query\);/);
					    assert.match(bodySection, /const patternText = getNonWhitespaceString\(args\.pattern\);/);
					    assert.match(bodySection, /const descriptionText = getNonWhitespaceString\(args\.description\);/);
					    assert.match(bodySection, /const commandText = getNonWhitespaceString\(args\.command\);/);
					    assert.match(renderUtilsSource, /const TOOL_PATH_DISPLAY_LIMIT = 160;/);
					    assert.match(bodySection, /const visibleLabel = truncateText\(formatFilePath\(path\), TOOL_PATH_DISPLAY_LIMIT\);/);
					    assert.match(bodySection, /const title = escapeHtml\(visibleLabel\);/);
					    assert.match(bodySection, /const openLabel = escapeHtml\(formatOpenLocationLabel\(visibleLabel, 1, 1\)\);/);
					    assert.match(bodySection, /const accessibleLabel = escapeHtml\(formatOpenLocationAccessibleLabel\(visibleLabel, visibleLabel, 1, 1\)\);/);
					    assert.match(bodySection, /renderOpenLocationAttrs\(path, 1, 1\)/);
					    assert.match(bodySection, /const diff = getNonWhitespaceString\(toolCall\.diff\);/);
				    assert.match(bodySection, /const additionalCount = typeof toolCall\.additionalCount === 'number' && Number\.isInteger\(toolCall\.additionalCount\) && toolCall\.additionalCount > 0 \? toolCall\.additionalCount : 0;/);
				    assert.match(bodySection, /headerText = getNonWhitespaceString\(toolCall\.name\) \|\| toolId \|\| 'Tool';/);
				    assert.doesNotMatch(bodySection, /truncateText\(args\./);
				    assert.match(renderUtilsSource, /const toolActionApprovalByElement = new WeakMap\(\);/);
	    assert.match(renderUtilsSource, /const toolActionApprovalById = new Map\(\);/);
	    assert.match(renderUtilsSource, /const toolActionApprovalIdByValue = new Map\(\);/);
	    assert.match(renderUtilsSource, /function renderToolActionApprovalAttrs\(approvalId\)/);
	    assert.match(renderUtilsSource, /function getToolActionApprovalId\(el\)/);
	    assert.match(renderUtilsSource, /function hydrateToolActionPayloadButton\(button\)/);
	    assert.match(renderUtilsSource, /function hydrateToolActionPayloads\(rootEl\)/);
	    assert.match(renderUtilsSource, /querySelectorAll\('\[data-tool-action-id\]'\)/);
		    assert.match(renderUtilsSource, /function toolCardBodyHtmlHasHydratablePayloads\(bodyHtml\)/);
		    assert.match(renderUtilsSource, /function hydrateToolCardPayloads\(rootEl, bodyHtml\)/);
		    assert.match(renderUtilsSource, /if \(bodyHtml !== undefined && !toolCardBodyHtmlHasHydratablePayloads\(bodyHtml\)\) return;/);
		    assert.match(renderUtilsSource, /querySelectorAll\('\[data-open-location-id\],\[data-tool-action-id\]'\)/);
		    const hydrateCardStart = renderUtilsSource.indexOf('function hydrateToolCardPayloads(rootEl, bodyHtml)');
	    assert.ok(hydrateCardStart >= 0, 'expected combined tool-card hydrator');
	    const hydrateCardEnd = renderUtilsSource.indexOf('function rememberPlanActionMessageToken', hydrateCardStart);
	    assert.ok(hydrateCardEnd > hydrateCardStart, 'expected plan action token helper after tool-card hydrator');
	    const hydrateCardSection = renderUtilsSource.slice(hydrateCardStart, hydrateCardEnd);
	    assert.match(hydrateCardSection, /hydrateOpenLocationPayloadButton\(button\);/);
	    assert.match(hydrateCardSection, /hydrateToolActionPayloadButton\(button\);/);
	    assert.doesNotMatch(hydrateCardSection, /hydrateOpenLocationPayloads\(rootEl\)/);
	    assert.doesNotMatch(hydrateCardSection, /hydrateToolActionPayloads\(rootEl\)/);
		    assert.match(bodySection, /let actionTarget = '';/);
		    assert.doesNotMatch(bodySection, /const actionTarget = getToolActionTargetLabel\(headerText\);/);
		    assert.strictEqual((bodySection.match(/getToolActionTargetLabel\(headerText\)/g) || []).length, 3);
			    assert.match(bodySection, /const approvalReason = getNonWhitespaceString\(toolCall\.approvalReason\);/);
			    assert.match(bodySection, /const diffUnavailableReason = getNonWhitespaceString\(toolCall\.diffUnavailableReason\);/);
			    assert.match(bodySection, /Number\.isInteger\(diffStats\.additions\)/);
			    assert.match(bodySection, /Number\.isInteger\(diffStats\.deletions\)/);
				    assert.match(bodySection, /if \(approvalReason\) \{/);
				    assert.match(bodySection, /const approvalReasonText = truncateText\(approvalReason, 140\);/);
				    assert.match(bodySection, /} else if \(diffUnavailableReason\) \{/);
				    assert.match(renderUtilsSource, /const TOOL_DIFF_UNAVAILABLE_REASON_DISPLAY_LIMIT = 240;/);
				    assert.match(bodySection, /const diffUnavailableText = truncateText\(diffUnavailableReason, TOOL_DIFF_UNAVAILABLE_REASON_DISPLAY_LIMIT\);/);
				    assert.doesNotMatch(bodySection, /truncateText\(String\(toolCall\.approvalReason\)/);
					    assert.doesNotMatch(bodySection, /String\(diffUnavailableReason\)/);
					    assert.doesNotMatch(bodySection, /const diffUnavailableText = diffUnavailableReason;/);
					    assert.doesNotMatch(bodySection, /const title = escapeHtml\(path\);/);
				    assert.doesNotMatch(bodySection, /const diff = toolCall\.diff \|\| '';/);
			    assert.doesNotMatch(bodySection, /Number\(diffStats\.additions \|\| 0\)/);
			    assert.doesNotMatch(bodySection, /Number\(diffStats\.deletions \|\| 0\)/);
			    assert.doesNotMatch(bodySection, /Number\.isFinite\(diffStats\.(?:additions|deletions)\)/);
			    assert.doesNotMatch(bodySection, /Number\.isFinite\(toolCall\.additionalCount\)/);
			    assert.doesNotMatch(bodySection, /additionalCount = typeof toolCall\.additionalCount === 'number' && toolCall\.additionalCount > 0/);
		    assert.match(bodySection, /renderToolActionButton\('approve', 'approve', toolCall\.approvalId, 'Allow once', 'Allow once ' \+ actionTarget\)/);
	    assert.match(bodySection, /renderToolActionButton\('always', 'always', toolCall\.approvalId, 'Allow always', 'Allow always ' \+ actionTarget\)/);
	    assert.match(bodySection, /renderToolActionButton\('reject', 'reject', toolCall\.approvalId, 'Deny', 'Deny ' \+ actionTarget\)/);
	    assert.match(bodySection, /toolCall\.status === 'rejected' && toolCall\.approvalId/);
	    assert.match(bodySection, /if \(!actionTarget\) actionTarget = getToolActionTargetLabel\(headerText\);/);
	    assert.doesNotMatch(bodySection, /<button class="tool-btn approve"/);
		    assert.doesNotMatch(renderUtilsSource, /\bdata-approval=/);
		    assert.doesNotMatch(renderUtilsSource, /dataset\.approval/);
		    assert.match(handlerSection, /const approvalId = getToolActionApprovalId\(btn\);/);
		  });

	  test('todo tool card helpers are hoisted out of the hot body renderer', () => {
	    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
	    const todoHelperStart = renderUtilsSource.indexOf('function normalizeTodoStatus');
	    assert.ok(todoHelperStart >= 0, 'expected todo status helper');
	    const bodyStart = renderUtilsSource.indexOf('function formatToolCardBody');
	    assert.ok(bodyStart > todoHelperStart, 'expected todo helpers before tool-card body formatter');
	    const bodyEnd = renderUtilsSource.indexOf('function renderLspResults', bodyStart);
	    assert.ok(bodyEnd > bodyStart, 'expected LSP renderer after tool-card body formatter');
	    const todoHelperSection = renderUtilsSource.slice(todoHelperStart, bodyStart);
	    const bodySection = renderUtilsSource.slice(bodyStart, bodyEnd);

	    assert.match(renderUtilsSource, /const NON_WHITESPACE_TEXT_RE = \/\\S\/;/);
	    assert.match(renderUtilsSource, /function hasNonWhitespaceText\(value\)/);
	    assert.match(todoHelperSection, /function normalizeTodoStatus\(value\)/);
	    assert.match(todoHelperSection, /function normalizeTodoPriority\(value\)/);
		    assert.match(todoHelperSection, /function todoStatusIcon\(status\)/);
		    assert.match(todoHelperSection, /const TOOL_TODO_RENDER_LIMIT = 20;/);
		    assert.match(todoHelperSection, /const TOOL_TODO_CONTENT_DISPLAY_LIMIT = 240;/);
		    assert.match(todoHelperSection, /function renderTodoList\(items\)/);
	    assert.match(todoHelperSection, /let renderedCount = 0;/);
	    assert.match(todoHelperSection, /let hiddenCount = 0;/);
	    assert.match(todoHelperSection, /for \(let todoIndex = 0; todoIndex < list\.length; todoIndex\+\+\)/);
	    assert.match(todoHelperSection, /const t = list\[todoIndex\];/);
	    assert.doesNotMatch(todoHelperSection, /for \(const t of list\)/);
	    assert.match(todoHelperSection, /if \(renderedCount >= TOOL_TODO_RENDER_LIMIT\) \{/);
	    assert.match(todoHelperSection, /hiddenCount\+\+;/);
		    assert.match(todoHelperSection, /if \(renderedCount === 0\) return '';/);
		    assert.match(todoHelperSection, /class="todo-overflow" role="listitem"/);
		    assert.match(todoHelperSection, /if \(!hasNonWhitespaceText\(content\)\) continue;/);
		    assert.match(todoHelperSection, /const displayContent = truncateText\(content, TOOL_TODO_CONTENT_DISPLAY_LIMIT\);/);
		    assert.doesNotMatch(todoHelperSection, /content\.trim\(\)/);
		    assert.doesNotMatch(todoHelperSection, /\.slice\(/);
	    assert.doesNotMatch(todoHelperSection, /\.filter\(/);
	    assert.match(todoHelperSection, /<div class="tool-todos" role="list" aria-label="Todos">/);
		    assert.match(todoHelperSection, /role="listitem"/);
		    assert.match(todoHelperSection, /<div class="todo-icon" aria-hidden="true">/);
		    assert.match(todoHelperSection, /<div class="todo-content">'\s*\+\s*escapeHtml\(displayContent\)\s*\+\s*'<\/div>/);
		    assert.doesNotMatch(todoHelperSection, /status === 'completed' \? ' completed'/);
	    assert.match(bodySection, /const rendered = renderTodoList\(list\);/);
	    assert.doesNotMatch(bodySection, /function normalizeTodoStatus|function normalizeTodoPriority|function todoStatusIcon|function renderTodoList/);
	  });

		  test('assistant copy actions share cached content lookup', () => {
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
		    const helperStart = renderUtilsSource.indexOf('function getAssistantCopyContentElement');
		    assert.ok(helperStart >= 0, 'expected assistant copy content helper');
		    const helperEnd = renderUtilsSource.indexOf('const planCancelTriggerByConfirm', helperStart);
		    assert.ok(helperEnd > helperStart, 'expected plan cancel state cache after assistant copy helper');
		    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);
		    const copyStart = renderUtilsSource.indexOf("if (action === 'copyAssistantMarkdown' || action === 'copyAssistantHtml')");
		    assert.ok(copyStart >= 0, 'expected assistant copy action branch');
		    const copyEnd = renderUtilsSource.indexOf("if (\n          action === 'executePlan'", copyStart);
		    assert.ok(copyEnd > copyStart, 'expected plan action branch after assistant copy branch');
		    const copySection = renderUtilsSource.slice(copyStart, copyEnd);
		    const classHelperStart = renderUtilsSource.indexOf('function hasRenderedElementClass(el, className)');
		    assert.ok(classHelperStart >= 0, 'expected rendered element class helper');
		    const classHelperEnd = renderUtilsSource.indexOf('function findAssistantActionMessageElementFromLayout', classHelperStart);
		    assert.ok(classHelperEnd > classHelperStart, 'expected assistant action layout helper after class helper');
		    const classHelperSection = renderUtilsSource.slice(classHelperStart, classHelperEnd);

		    assert.match(helperSection, /typeof getCachedMessageContentElement === 'function'/);
		    assert.match(helperSection, /return getCachedMessageContentElement\(msgEl\);/);
		    assert.match(helperSection, /return msgEl\.querySelector \? msgEl\.querySelector\('\.message-content'\) : null;/);
		    assert.match(helperSection, /function getRenderedMessageElementId\(msgEl\)/);
		    assert.match(helperSection, /typeof getMessageElementId === 'function'/);
		    assert.match(helperSection, /const id = getMessageElementId\(msgEl\);/);
		    assert.strictEqual(
		      (copySection.match(/getAssistantCopyContentElement\(msgEl\)/g) || []).length,
		      2,
		      'HTML copy and markdown fallback should share the cached content helper'
		    );
		    assert.match(copySection, /const msgId = getRenderedMessageElementId\(msgEl\);/);
		    assert.doesNotMatch(copySection, /msgEl \? msgEl\.querySelector\('\.message-content'\) : null/);
		    assert.doesNotMatch(copySection, /msgEl && msgEl\.dataset \? msgEl\.dataset\.id : ''/);
			    assert.match(renderUtilsSource, /const assistantActionMessageByElement = new WeakMap\(\);/);
			    assert.match(renderUtilsSource, /function getAssistantActionMessageElement\(actionEl\)/);
			    assert.match(renderUtilsSource, /function getContainedCachedElement\(actionEl, cache\)/);
			    assert.match(renderUtilsSource, /const cachedElement = cache\.get\(actionEl\);/);
			    assert.match(renderUtilsSource, /if \(typeof cachedElement\.contains !== 'function'\) return null;/);
			    assert.match(renderUtilsSource, /if \(cachedElement\.contains\(actionEl\)\) return cachedElement;/);
			    assert.match(renderUtilsSource, /cache\.delete\(actionEl\);/);
				    assert.match(renderUtilsSource, /function hasRenderedElementClass\(el, className\)/);
				    assert.match(classHelperSection, /if \(el\.classList && typeof el\.classList\.contains === 'function'\) return el\.classList\.contains\(className\);/);
				    assert.doesNotMatch(classHelperSection, /el\.classList && typeof el\.classList\.contains === 'function' && el\.classList\.contains\(className\)/);
				    assert.match(renderUtilsSource, /function findAssistantActionMessageElementFromLayout\(actionEl\)/);
				    assert.match(renderUtilsSource, /assistantActionMessageByElement\.set\(actionEl, messageEl\);/);
				    assert.match(renderUtilsSource, /const cachedMessage = getContainedCachedElement\(actionEl, assistantActionMessageByElement\);[\s\S]*if \(cachedMessage\) return cachedMessage;/);
				    const assistantGetterStart = renderUtilsSource.indexOf('function getAssistantActionMessageElement(actionEl)');
				    assert.ok(assistantGetterStart >= 0, 'expected assistant action owner getter');
				    const assistantGetterEnd = renderUtilsSource.indexOf('function getCompactionSummaryMessageElement', assistantGetterStart);
				    assert.ok(assistantGetterEnd > assistantGetterStart, 'expected compaction getter after assistant getter');
				    const assistantGetterSection = renderUtilsSource.slice(assistantGetterStart, assistantGetterEnd);
				    assert.ok(
				      assistantGetterSection.indexOf('if (cachedMessage) return cachedMessage;') <
				        assistantGetterSection.indexOf('findAssistantActionMessageElementFromLayout(actionEl)'),
				      'assistant action owner cache should be checked before layout traversal'
				    );
				    assert.match(renderUtilsSource, /const layoutMessage = findAssistantActionMessageElementFromLayout\(actionEl\);[\s\S]*if \(layoutMessage\) return layoutMessage;/);
			    assert.match(renderUtilsSource, /getCachedClosestElement\(actionEl, '\.message\.assistant', assistantActionMessageByElement\)/);
		    assert.match(copySection, /const msgEl = getAssistantActionMessageElement\(assistantCopyBtn\);/);
		    assert.doesNotMatch(copySection, /\.closest\('\.message\.assistant'\)/);
		  });

		  test('tool message actions share cached owner lookup', () => {
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
		    const helperStart = renderUtilsSource.indexOf('function getCachedClosestElement');
		    assert.ok(helperStart >= 0, 'expected cached closest owner helper');
		    const helperEnd = renderUtilsSource.indexOf('function isPlanCancelConfirmOpen', helperStart);
		    assert.ok(helperEnd > helperStart, 'expected plan cancel state helper after tool message cache helper');
		    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);
		    const outputStart = renderUtilsSource.indexOf("if (action === 'openFullOutput')");
		    assert.ok(outputStart >= 0, 'expected full output branch');
		    const toolActionEnd = renderUtilsSource.indexOf("if (action === 'copyCodeBlock')", outputStart);
		    assert.ok(toolActionEnd > outputStart, 'expected code copy branch after tool action branches');
		    const toolActionSection = renderUtilsSource.slice(outputStart, toolActionEnd);

		    assert.match(renderUtilsSource, /const toolActionMessageByElement = new WeakMap\(\);/);
		    assert.match(helperSection, /function getCachedClosestElement\(actionEl, selector, cache\)/);
		    assert.match(helperSection, /const cachedElement = cache\.get\(actionEl\);/);
		    assert.match(helperSection, /let isCurrent = true;/);
		    assert.match(helperSection, /cachedElement\.contains\(actionEl\)/);
		    assert.match(helperSection, /actionEl\.closest\(selector\) === cachedElement/);
		    assert.match(helperSection, /cache\.delete\(actionEl\);/);
		    assert.match(helperSection, /const element = actionEl\.closest \? actionEl\.closest\(selector\) : null;/);
		    assert.match(helperSection, /if \(element\) cache\.set\(actionEl, element\);/);
		    assert.doesNotMatch(helperSection, /const isCurrent =[\s\S]*\?/);
			    assert.match(helperSection, /function getToolActionMessageElement\(actionEl\)/);
			    assert.match(helperSection, /function findToolActionMessageElementFromLayout\(actionEl\)/);
			    assert.match(helperSection, /depth < 8/);
			    assert.match(helperSection, /toolActionMessageByElement\.set\(actionEl, messageEl\);/);
			    assert.match(helperSection, /const cachedMessage = getContainedCachedElement\(actionEl, toolActionMessageByElement\);[\s\S]*if \(cachedMessage\) return cachedMessage;/);
			    const toolGetterStart = helperSection.indexOf('function getToolActionMessageElement(actionEl)');
			    assert.ok(toolGetterStart >= 0, 'expected tool action owner getter');
			    const toolGetterEnd = helperSection.indexOf('function getAssistantActionMessageElement', toolGetterStart);
			    assert.ok(toolGetterEnd > toolGetterStart, 'expected assistant getter after tool getter');
			    const toolGetterSection = helperSection.slice(toolGetterStart, toolGetterEnd);
			    assert.ok(
			      toolGetterSection.indexOf('if (cachedMessage) return cachedMessage;') <
			        toolGetterSection.indexOf('findToolActionMessageElementFromLayout(actionEl)'),
			      'tool action owner cache should be checked before layout traversal'
			    );
			    assert.match(helperSection, /const layoutMessage = findToolActionMessageElementFromLayout\(actionEl\);[\s\S]*if \(layoutMessage\) return layoutMessage;/);
			    assert.match(helperSection, /getCachedClosestElement\(actionEl, '\.tool-message', toolActionMessageByElement\)/);
		    assert.strictEqual(
		      (toolActionSection.match(/getToolActionMessageElement\(/g) || []).length,
		      4,
		      'full output, native diff, text diff, and copy output should share the cached owner lookup'
		    );
		    assert.doesNotMatch(toolActionSection, /\.closest\('\.tool-message'\)/);
		  });

	  test('message avatar and assistant action chrome build without innerHTML', () => {
	    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
	    const helperStart = renderMessagesSource.indexOf('function createSvgPathIcon');
	    assert.ok(helperStart >= 0, 'expected SVG avatar helper');
	    const helperEnd = renderMessagesSource.indexOf('function rememberMessageStepParts', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected step cache helper after avatar/action helpers');
	    const helperSection = renderMessagesSource.slice(helperStart, helperEnd);

	    assert.match(renderMessagesSource, /const SVG_NS = 'http:\/\/www\.w3\.org\/2000\/svg';/);
	    assert.match(renderMessagesSource, /const messageIdByElement = new WeakMap\(\);/);
	    assert.match(renderMessagesSource, /function rememberMessageElementId\(messageEl, messageId\)/);
	    assert.match(renderMessagesSource, /function getMessageElementId\(messageEl\)/);
	    assert.match(helperSection, /document\.createElementNS\(SVG_NS, 'svg'\)/);
	    assert.match(helperSection, /document\.createElementNS\(SVG_NS, 'path'\)/);
	    assert.match(helperSection, /svg\.appendChild\(pathEl\);/);
	    assert.match(helperSection, /Object\.prototype\.hasOwnProperty\.call\(messageAvatarIconPaths, role\)/);
	    assert.match(helperSection, /avatar\.appendChild\(createSvgPathIcon\(icon\)\);/);
		    assert.match(helperSection, /button\.type = 'button';/);
		    assert.match(helperSection, /rememberRenderedAction\(button, action\);/);
		    assert.match(helperSection, /button\.setAttribute\('aria-label', ariaLabel\);/);
		    assert.match(helperSection, /button\.textContent = label;/);
		    assert.match(renderMessagesSource, /const actions = createAssistantMessageActions\(\);/);
		    assert.doesNotMatch(helperSection, /button\.dataset\.action = action;/);
		    assert.doesNotMatch(helperSection, /\.innerHTML\s*=/);
		    assert.doesNotMatch(renderMessagesSource, /avatar\.innerHTML\s*=/);
		    assert.doesNotMatch(renderMessagesSource, /actions\.innerHTML\s*=/);
		    assert.match(renderMessagesSource, /rememberMessageElementId\(el, msg\.id\);/);
		  });

		  test('code block copy caches rendered code text per block', () => {
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
		    const helperStart = renderUtilsSource.indexOf('function getCodeBlockCopyText');
		    assert.ok(helperStart >= 0, 'expected code-block copy text helper');
		    const helperEnd = renderUtilsSource.indexOf('function focusRenderedControl', helperStart);
		    assert.ok(helperEnd > helperStart, 'expected focus helper after code-block copy helper');
		    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);
		    const elementStart = renderUtilsSource.indexOf('function getCodeBlockCopyElement');
		    assert.ok(elementStart >= 0, 'expected code-block copy element helper');
		    const elementEnd = renderUtilsSource.indexOf('function getPlanCancelDismissConfirm', elementStart);
		    assert.ok(elementEnd > elementStart, 'expected plan-cancel helper after code-block copy element helper');
		    const elementSection = renderUtilsSource.slice(elementStart, elementEnd);
		    const copyStart = renderUtilsSource.indexOf("if (action === 'copyCodeBlock')");
		    assert.ok(copyStart >= 0, 'expected code-block copy action branch');
		    const copyEnd = renderUtilsSource.indexOf("if (action === 'copyAssistantMarkdown' || action === 'copyAssistantHtml')", copyStart);
		    assert.ok(copyEnd > copyStart, 'expected assistant copy branch after code-block copy branch');
		    const copySection = renderUtilsSource.slice(copyStart, copyEnd);
		    const cachedBlockIndex = elementSection.indexOf('const cachedBlock = getContainedCachedElement(actionEl, codeBlockByCopyButton);');
		    const layoutBlockIndex = elementSection.indexOf('const layoutBlock = findCodeBlockCopyElementFromLayout(actionEl);');

		    assert.match(renderUtilsSource, /const codeBlockCopyTextCache = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /const codeBlockByCopyButton = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /function getCodeBlockCopyElement\(actionEl\)/);
		    assert.match(renderUtilsSource, /function isMarkdownCodeBlockElement\(el\)/);
		    assert.match(renderUtilsSource, /function findCodeBlockCopyElementFromLayout\(actionEl\)/);
		    assert.match(renderUtilsSource, /codeBlockByCopyButton\.set\(actionEl, blockEl\);/);
		    assert.ok(cachedBlockIndex >= 0, 'expected code-block copy helper to check the contained cached block first');
		    assert.ok(layoutBlockIndex > cachedBlockIndex, 'expected cached code-block owner lookup before layout traversal');
		    assert.match(elementSection, /if \(cachedBlock\) return cachedBlock;/);
		    assert.match(elementSection, /const layoutBlock = findCodeBlockCopyElementFromLayout\(actionEl\);[\s\S]*if \(layoutBlock\) return layoutBlock;/);
		    assert.match(elementSection, /getCachedClosestElement\(actionEl, '\.markdown-code-block', codeBlockByCopyButton\)/);
		    assert.match(renderUtilsSource, /function isCodeElement\(el\)/);
		    assert.match(renderUtilsSource, /function findCodeBlockCodeElementFromLayout\(blockEl\)/);
		    assert.match(helperSection, /const cached = codeBlockCopyTextCache\.get\(blockEl\);/);
		    assert.match(helperSection, /if \(cached !== undefined\) return cached;/);
		    assert.match(helperSection, /const codeEl = findCodeBlockCodeElementFromLayout\(blockEl\) \|\| \(blockEl\.querySelector \? blockEl\.querySelector\('code'\) : null\);/);
		    assert.match(helperSection, /codeBlockCopyTextCache\.set\(blockEl, text\);/);
		    assert.match(copySection, /const blockEl = getCodeBlockCopyElement\(codeCopyBtn\);/);
		    assert.match(copySection, /const text = getCodeBlockCopyText\(blockEl\);/);
		    assert.doesNotMatch(copySection, /blockEl \? blockEl\.querySelector\('code'\) : null/);
		    assert.doesNotMatch(copySection, /codeCopyBtn\.closest\('\.markdown-code-block'\)/);
		  });

		  test('lsp result notes build without temporary note arrays', () => {
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
	    const lspStart = renderUtilsSource.indexOf('function renderLspResults');
	    assert.ok(lspStart >= 0, 'expected LSP renderer');
	    const lspEnd = renderUtilsSource.indexOf('function extractPlanQuestionGroups', lspStart);
	    assert.ok(lspEnd > lspStart, 'expected plan question extractor after LSP renderer');
	    const lspSection = renderUtilsSource.slice(lspStart, lspEnd);

		    assert.match(lspSection, /let noteText = '';/);
		    assert.match(lspSection, /const skipped = typeof payload\.skippedOutsideWorkspace === 'number' && Number\.isInteger\(payload\.skippedOutsideWorkspace\) && payload\.skippedOutsideWorkspace > 0 \? payload\.skippedOutsideWorkspace : 0;/);
		    assert.match(lspSection, /noteText = 'skipped ' \+ skipped \+ ' outside workspace';/);
		    assert.match(lspSection, /noteText \+= noteText \? ' · truncated' : 'truncated';/);
		    assert.match(lspSection, /const max = LSP_LOCATION_RENDER_LIMIT;/);
		    assert.match(lspSection, /for \(let resultIndex = 0; resultIndex < value\.length; resultIndex\+\+\)/);
			    assert.match(lspSection, /const item = value\[resultIndex\];/);
			    assert.doesNotMatch(lspSection, /for \(const item of value\)/);
			    assert.match(lspSection, /for \(let locationIndex = 0; locationIndex < locations\.length; locationIndex\+\+\)/);
			    assert.match(lspSection, /const loc = locations\[locationIndex\];/);
			    assert.doesNotMatch(lspSection, /for \(const loc of locations\)/);
			    assert.match(lspSection, /let locationRenderLimited = false;/);
			    assert.match(lspSection, /const line = start && typeof start\.line === 'number' && Number\.isInteger\(start\.line\) && start\.line > 0 \? start\.line : null;/);
			    assert.match(lspSection, /const character = start && typeof start\.character === 'number' && Number\.isInteger\(start\.character\) && start\.character > 0 \? start\.character : 1;/);
			    assert.match(lspSection, /if \(!fp \|\| !hasNonWhitespaceText\(fp\) \|\| !line\) return;/);
			    assert.match(lspSection, /if \(locations\.length >= max\) \{[\s\S]*?locationRenderLimited = true;[\s\S]*?return;[\s\S]*?\}/);
				    assert.match(lspSection, /let hoverPreviewTruncated = false;/);
				    assert.match(lspSection, /let hasHoverPreview = false;/);
				    assert.match(lspSection, /if \(hasNonWhitespaceText\(hoverContents\)\) \{/);
				    assert.match(lspSection, /hoverContents\.length > LSP_HOVER_MARKDOWN_CHAR_LIMIT/);
				    assert.match(lspSection, /hoverContents\.slice\(0, LSP_HOVER_MARKDOWN_CHAR_LIMIT\)/);
				    assert.match(renderUtilsSource, /const LSP_LOCATION_LABEL_DISPLAY_LIMIT = 120;/);
				    assert.match(lspSection, /const labelText = loc\.label \? truncateText\(String\(loc\.label\), LSP_LOCATION_LABEL_DISPLAY_LIMIT\) \+ ' — ' : '';/);
				    assert.match(lspSection, /const displayPath = truncateText\(formatFilePath\(loc\.filePath\), TOOL_PATH_DISPLAY_LIMIT\);/);
				    assert.match(lspSection, /const displayText = displayPath \+ ':' \+ loc\.line \+ ':' \+ loc\.character;/);
				    assert.match(lspSection, /const openLabel = escapeHtml\(formatOpenLocationLabel\(displayPath, loc\.line, loc\.character\)\);/);
				    assert.match(lspSection, /const accessibleLabel = escapeHtml\(formatOpenLocationAccessibleLabel\(labelText \+ displayText, displayPath, loc\.line, loc\.character\)\);/);
				    assert.match(lspSection, /renderOpenLocationAttrs\(loc\.filePath, loc\.line, loc\.character\)/);
				    assert.match(lspSection, /hasHoverPreview = true;/);
			    assert.match(lspSection, /if \(!hasHoverPreview\) html \+= renderLspNote\('No locations found'\);/);
			    assert.match(lspSection, /if \(locationRenderLimited\) noteText \+= noteText \? ' · location preview limited' : 'location preview limited';/);
			    assert.match(lspSection, /if \(hoverPreviewTruncated\) noteText \+= noteText \? ' · hover preview truncated' : 'hover preview truncated';/);
		    assert.strictEqual((lspSection.match(/visit\(results, filePath\);/g) || []).length, 1);
		    assert.doesNotMatch(lspSection, /Number\.isFinite\(start\.(?:line|character)\)/);
		    assert.doesNotMatch(lspSection, /const skipped = typeof payload\.skippedOutsideWorkspace === 'number' \? payload\.skippedOutsideWorkspace : 0;/);
		    assert.doesNotMatch(lspSection, /locations\.length === 0 && filePath && op === 'hover'/);
			    assert.doesNotMatch(lspSection, /const notes = \[\];/);
			    assert.doesNotMatch(lspSection, /notes\.push/);
			    assert.doesNotMatch(lspSection, /notes\.join/);
				    assert.doesNotMatch(lspSection, /const displayText = loc\.filePath \+ ':'/);
				    assert.doesNotMatch(lspSection, /formatOpenLocationLabel\(loc\.filePath/);
				    assert.doesNotMatch(lspSection, /formatOpenLocationAccessibleLabel\(labelText \+ displayText, loc\.filePath/);
		  });

	  test('tool batch preview renders bounded files without slice allocation', () => {
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const batchStart = renderUtilsSource.indexOf('const batchFiles =');
    assert.ok(batchStart >= 0, 'expected tool batch file normalization');
    const batchEnd = renderUtilsSource.indexOf("let headerText = '';", batchStart);
    assert.ok(batchEnd > batchStart, 'expected tool header rendering after batch preview');
	    const batchSection = renderUtilsSource.slice(batchStart, batchEnd);

	    assert.match(batchSection, /Array\.isArray\(toolCall\.batchFiles\)/);
	    assert.match(batchSection, /let visibleFileCount = 0;/);
	    assert.match(batchSection, /let hiddenFileCount = additionalCount;/);
		    assert.match(batchSection, /for \(let i = 0; i < batchFiles\.length; i\+\+\)/);
		    assert.match(batchSection, /const full = getNonWhitespaceString\(batchFiles\[i\]\);/);
		    assert.match(batchSection, /if \(!full\) continue;/);
		    assert.match(batchSection, /if \(visibleFileCount >= maxFilesToShow\) \{/);
		    assert.match(batchSection, /hiddenFileCount\+\+;/);
		    assert.match(renderUtilsSource, /const TOOL_BATCH_FILE_DISPLAY_LIMIT = 160;/);
		    assert.match(batchSection, /const display = truncateText\(formatFilePath\(full\), TOOL_BATCH_FILE_DISPLAY_LIMIT\);/);
		    assert.match(batchSection, /title="' \+ escapedDisplay \+ '" aria-label="' \+ escapedDisplay \+ '"/);
			    assert.doesNotMatch(batchSection, /batchFiles\.slice\(/);
			    assert.doesNotMatch(batchSection, /\.forEach\(file/);
			    assert.doesNotMatch(batchSection, /const full = String\(batchFiles\[i\]/);
		    assert.doesNotMatch(batchSection, /title="' \+ escapeHtml\(full\)/);
			  });

  test('tool batch merging tracks duplicate paths with a set', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const batchStart = renderMessagesSource.indexOf('if (msg.toolCall && isBatchToolType(msg.toolCall.id))');
    assert.ok(batchStart >= 0, 'expected batchable tool merge branch');
    const batchEnd = renderMessagesSource.indexOf('if (!msg.toolCall || !isBatchToolType(msg.toolCall.id))', batchStart);
    assert.ok(batchEnd > batchStart, 'expected batch branch to end before reset branch');
    const batchSection = renderMessagesSource.slice(batchStart, batchEnd);

    assert.match(bootstrapSource, /const\s+BATCH_TOOL_TYPES\s*=\s*\['read', 'read_range', 'glob', 'list'\]/);
    assert.match(bootstrapSource, /const\s+BATCH_TOOL_TYPE_SET\s*=\s*new Set\(BATCH_TOOL_TYPES\)/);
    assert.match(bootstrapSource, /function\s+isBatchToolType\(toolId\)\s*\{[\s\S]*BATCH_TOOL_TYPE_SET\.has\(toolId\);[\s\S]*\}/);
    assert.match(bootstrapSource, /let\s+lastToolBatchPathSet\s*=\s*null/);
    assert.match(renderMessagesSource, /function\s+resetLastToolBatchState\(\)/);
    assert.match(renderMessagesSource, /function\s+buildToolBatchPathSet\(toolCall\)/);
    assert.match(renderMessagesSource, /function\s+ensureLastToolBatchPathSet\(toolCall\)/);
    assert.match(renderMessagesSource, /function\s+rememberLastToolBatchMessage\(msg\)/);
    assert.match(batchSection, /const batchPathSet = ensureLastToolBatchPathSet\(lastToolMsg\.toolCall\);/);
    assert.match(batchSection, /const isDuplicate = batchPathSet\.has\(currentPath\);/);
    assert.match(batchSection, /if \(isDuplicate\) \{[\s\S]*messageEls\.set\(msg\.id, existingEl\);[\s\S]*return;/);
    assert.match(batchSection, /batchPathSet\.add\(currentPath\);/);
    assert.match(renderMessagesSource, /rememberLastToolBatchMessage\(msg\);/);
    assert.match(mainSource, /resetLastToolBatchState\(\);/);
    assert.doesNotMatch(batchSection, /\.includes\(currentPath\)/);
    assert.doesNotMatch(renderMessagesSource, /BATCH_TOOL_TYPES\.includes/);
  });

  test('markdown table renderer computes column count without extra row normalization arrays', () => {
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const splitStart = renderUtilsSource.indexOf('function splitTableRow');
    assert.ok(splitStart >= 0, 'expected markdown table row splitter');
	    const splitEnd = renderUtilsSource.indexOf('function countTableCells', splitStart);
	    assert.ok(splitEnd > splitStart, 'expected table cell counter after row splitter');
	    const splitSection = renderUtilsSource.slice(splitStart, splitEnd);
	    const countStart = renderUtilsSource.indexOf('function countTableCells', splitEnd);
	    assert.ok(countStart >= 0, 'expected markdown table cell counter');
	    const countEnd = renderUtilsSource.indexOf('function renderTableCells', countStart);
	    assert.ok(countEnd > countStart, 'expected table cell renderer after counter');
	    const countSection = renderUtilsSource.slice(countStart, countEnd);
    const cellStart = renderUtilsSource.indexOf('function renderTableCells');
    assert.ok(cellStart >= 0, 'expected markdown table cell renderer');
    const cellEnd = renderUtilsSource.indexOf('function renderTable', cellStart + 'function renderTableCells'.length);
    assert.ok(cellEnd > cellStart, 'expected table renderer after cell renderer');
    const cellSection = renderUtilsSource.slice(cellStart, cellEnd);
    const tableStart = renderUtilsSource.indexOf('function renderTable');
    assert.ok(tableStart >= 0, 'expected markdown table renderer');
    const tableEnd = renderUtilsSource.indexOf('function renderList', tableStart);
    assert.ok(tableEnd > tableStart, 'expected end of table renderer');
    const tableSection = renderUtilsSource.slice(tableStart, tableEnd);

    assert.match(splitSection, /const cells = \[\];/);
    assert.match(splitSection, /for \(let i = start; i <= end; i\+\+\)/);
    assert.match(splitSection, /cells\.push\(trimmed\.slice\(cellStart, i\)\.trim\(\)\);/);
    assert.match(splitSection, /return cells;/);
	    assert.doesNotMatch(splitSection, /\.split\('\|'\)/);
	    assert.doesNotMatch(splitSection, /\.map\(/);
	    assert.match(countSection, /function countTableCells\(line\)/);
	    assert.match(countSection, /let count = 0;/);
	    assert.match(countSection, /for \(let i = start; i <= end; i\+\+\)/);
	    assert.match(countSection, /count\+\+;/);
	    assert.match(countSection, /return count;/);
	    assert.doesNotMatch(countSection, /const cells = \[\];/);
	    assert.doesNotMatch(countSection, /cells\.push/);
		    assert.match(cellSection, /for \(let i = 0; i < colCount; i\+\+\)/);
			    assert.match(tableSection, /function renderTable\(lines, startIndex, endIndex\)/);
	    assert.match(tableSection, /const start = typeof startIndex === 'number' && startIndex > 0 \? startIndex : 0;/);
	    assert.match(tableSection, /const end = typeof endIndex === 'number' && endIndex <= lines\.length \? endIndex : lines\.length;/);
	    assert.match(tableSection, /let colCount = header\.length;/);
	    assert.match(tableSection, /const separatorCount = countTableCells\(lines\[start \+ 1\]\);/);
	    assert.match(tableSection, /if \(separatorCount > colCount\) colCount = separatorCount;/);
	    assert.match(tableSection, /const rowCount = countTableCells\(lines\[i\]\);/);
	    assert.match(tableSection, /if \(rowCount > colCount\) colCount = rowCount;/);
	    assert.match(tableSection, /renderTableCells\(header, 'th', colCount\)/);
	    assert.match(tableSection, /renderTableCells\(row, 'td', colCount\)/);
	    assert.doesNotMatch(tableSection, /const rows = \[\];/);
	    assert.doesNotMatch(tableSection, /rows\.push/);
		    assert.doesNotMatch(tableSection, /for \(const row of rows\)/);
		    assert.doesNotMatch(tableSection, /splitTableRow\(lines\[1\]\)/);
		    assert.doesNotMatch(tableSection, /const separator = splitTableRow\(lines\[start \+ 1\]\);/);
		    assert.doesNotMatch(tableSection, /const row = splitTableRow\(lines\[i\]\);\s*if \(row\.length > colCount\)/);
	    assert.doesNotMatch(tableSection, /\.\.\.rows\.map/);
	    assert.doesNotMatch(tableSection, /rows\.map\(r => r\.length\)/);
	    assert.doesNotMatch(tableSection, /\.map\(/);
    assert.doesNotMatch(tableSection, /\.slice\(0, colCount\)/);
  });

  test('markdown renderer streams blocks without intermediate filter map or join passes', () => {
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const lineScannerStart = renderUtilsSource.indexOf('function forEachNormalizedMarkdownLine');
    assert.ok(lineScannerStart >= 0, 'expected markdown line scanner');
    const lineScannerEnd = renderUtilsSource.indexOf('function renderMarkdown(text)', lineScannerStart);
    assert.ok(lineScannerEnd > lineScannerStart, 'expected markdown renderer after line scanner');
    const lineScannerSection = renderUtilsSource.slice(lineScannerStart, lineScannerEnd);
	    const markdownStart = renderUtilsSource.indexOf('function renderMarkdown(text)');
	    assert.ok(markdownStart >= 0, 'expected markdown renderer');
	    const fenceStart = renderUtilsSource.indexOf('const MARKDOWN_FENCE_OPEN_RE');
	    assert.ok(fenceStart >= 0, 'expected hoisted markdown fence regexes');
	    const fenceEnd = renderUtilsSource.indexOf('function isMarkdownLanguageWhitespace', fenceStart);
	    assert.ok(fenceEnd > fenceStart, 'expected markdown language helpers after fence helpers');
	    const fenceSection = renderUtilsSource.slice(fenceStart, fenceEnd);
	    const languageStart = renderUtilsSource.indexOf('function isMarkdownLanguageWhitespace');
	    assert.ok(languageStart >= 0, 'expected markdown language helpers');
    const languageEnd = renderUtilsSource.indexOf('function renderMarkdownCodeBlock', languageStart);
    assert.ok(languageEnd > languageStart, 'expected code block renderer after language normalizer');
    const languageSection = renderUtilsSource.slice(languageStart, languageEnd);
	    const markdownBlockStart = renderUtilsSource.indexOf('const MARKDOWN_HEADING_RE', markdownStart);
	    assert.ok(markdownBlockStart > markdownStart, 'expected markdown block regexes after markdown renderer');
	    const textLinesStart = renderUtilsSource.indexOf('function renderMarkdownTextLines', markdownBlockStart);
	    assert.ok(textLinesStart > markdownBlockStart, 'expected text-line renderer after markdown block regexes');
	    const markdownBlockSection = renderUtilsSource.slice(markdownBlockStart, textLinesStart);
	    const markdownSection = renderUtilsSource.slice(markdownStart, textLinesStart);
    const tableStart = renderUtilsSource.indexOf('function splitTableRow', textLinesStart);
    assert.ok(tableStart > textLinesStart, 'expected table helpers after text-line renderer');
    const textLinesSection = renderUtilsSource.slice(textLinesStart, tableStart);
    const listStart = renderUtilsSource.indexOf('function renderList', tableStart);
    assert.ok(listStart > tableStart, 'expected list renderer after table renderer');
    const listEnd = renderUtilsSource.indexOf('function renderParagraphs', listStart);
    assert.ok(listEnd > listStart, 'expected paragraph renderer after list renderer');
    const listSection = renderUtilsSource.slice(listStart, listEnd);

	    assert.match(lineScannerSection, /const value = String\(text === undefined \|\| text === null \? '' : text\);/);
	    assert.match(lineScannerSection, /for \(let i = 0; i < value\.length; i\+\+\)/);
    assert.match(lineScannerSection, /const code = value\.charCodeAt\(i\);/);
    assert.match(lineScannerSection, /onLine\(value\.slice\(start, i\)\);/);
    assert.match(lineScannerSection, /onLine\(value\.slice\(start\)\);/);
	    assert.doesNotMatch(lineScannerSection, /\.replace\(/);
	    assert.doesNotMatch(lineScannerSection, /\.split\(/);
	    assert.ok(
	      fenceSection.includes('const MARKDOWN_FENCE_OPEN_RE = /^[ \\t]{0,3}(`{3,}|~{3,})(.*)$/;'),
	      'expected markdown fence open regex to be hoisted'
	    );
	    assert.ok(
	      fenceSection.includes('const MARKDOWN_FENCE_CLOSE_RE = /^[ \\t]{0,3}(`{3,}|~{3,})[ \\t]*$/;'),
	      'expected markdown fence close regex to be hoisted'
	    );
	    assert.match(fenceSection, /MARKDOWN_FENCE_OPEN_RE\.exec\(String\(line \|\| ''\)\)/);
		    assert.match(fenceSection, /MARKDOWN_FENCE_CLOSE_RE\.exec\(String\(line \|\| ''\)\)/);
		    assert.doesNotMatch(fenceSection, /String\(line \|\| ''\)\.match\(/);
		    assert.match(renderUtilsSource, /const MARKDOWN_CODE_LANGUAGE_DISPLAY_LIMIT = 64;/);
		    assert.match(languageSection, /function\s+isMarkdownLanguageWhitespace\(code\)/);
	    assert.match(languageSection, /function\s+isMarkdownLanguageNameChar\(code\)/);
	    assert.match(languageSection, /for \(let i = 0; i < value\.length; i\+\+\)/);
	    assert.match(languageSection, /const code = value\.charCodeAt\(i\);/);
	    assert.match(languageSection, /if \(isMarkdownLanguageWhitespace\(code\)\)/);
	    assert.match(languageSection, /if \(isMarkdownLanguageNameChar\(code\)\)/);
	    assert.match(languageSection, /if \(output\.length >= MARKDOWN_CODE_LANGUAGE_DISPLAY_LIMIT\) break;/);
	    assert.doesNotMatch(languageSection, /\.replace\(/);
	    assert.doesNotMatch(languageSection, /\.split\(/);
	    assert.match(markdownSection, /let html = '';/);
	    assert.match(markdownSection, /forEachNormalizedMarkdownLine\(text, \(line\) => \{/);
	    assert.match(markdownSection, /function\s+flushText\(\)/);
	    assert.match(markdownSection, /html \+= renderMarkdownTextLines\(textLines\);/);
	    assert.match(markdownSection, /let codeText = '';/);
	    assert.match(markdownSection, /let codeLineCount = 0;/);
	    assert.match(markdownSection, /function\s+appendCodeLine\(line\)/);
	    assert.match(markdownSection, /if \(codeLineCount > 0\) codeText \+= '\\n';/);
	    assert.match(markdownSection, /codeText \+= line;/);
	    assert.match(markdownSection, /function\s+flushCode\(closed\)/);
	    assert.match(markdownSection, /const content = codeText;/);
	    assert.match(markdownSection, /html \+= renderMarkdown\(content\);/);
	    assert.match(markdownSection, /html \+= renderMarkdownCodeBlock\(\{ lang: codeLang, content, closed: !!closed \}\);/);
		    assert.match(markdownSection, /appendCodeLine\(line\);/);
		    assert.match(markdownSection, /return html;/);
	    assert.match(markdownBlockSection, /const MARKDOWN_HEADING_RE = /);
	    assert.match(markdownBlockSection, /const MARKDOWN_TABLE_SEPARATOR_RE = /);
	    assert.match(markdownBlockSection, /const MARKDOWN_ORDERED_LIST_START_RE = /);
	    assert.match(markdownBlockSection, /const MARKDOWN_BULLET_LIST_START_RE = /);
	    assert.match(markdownBlockSection, /function isMarkdownBlankLine\(line\)/);
	    assert.match(markdownBlockSection, /NON_WHITESPACE_TEXT_RE\.test\(String\(line \|\| ''\)\)/);
	    assert.match(textLinesSection, /let html = '';/);
	    assert.match(textLinesSection, /isMarkdownBlankLine\(raw\)/);
	    assert.match(textLinesSection, /isMarkdownBlankLine\(lines\[i\]\)/);
	    assert.match(textLinesSection, /isMarkdownBlankLine\(line\)/);
	    assert.match(textLinesSection, /isMarkdownBlankLine\(lines\[j\]\)/);
	    assert.match(textLinesSection, /const headingMatch = MARKDOWN_HEADING_RE\.exec\(raw\);/);
	    assert.match(textLinesSection, /MARKDOWN_TABLE_SEPARATOR_RE\.test\(next\)/);
	    assert.match(textLinesSection, /const orderedStart = MARKDOWN_ORDERED_LIST_START_RE\.test\(raw\);/);
	    assert.match(textLinesSection, /const bulletStart = MARKDOWN_BULLET_LIST_START_RE\.test\(raw\);/);
	    assert.match(textLinesSection, /MARKDOWN_HEADING_START_RE\.test\(line\)/);
	    assert.match(textLinesSection, /MARKDOWN_TABLE_SEPARATOR_RE\.test\(maybeNext\)/);
		    assert.match(textLinesSection, /const tableStart = i;/);
			    assert.match(textLinesSection, /html \+= renderTable\(lines, tableStart, i\);/);
			    assert.match(textLinesSection, /const listStart = i;/);
			    assert.match(textLinesSection, /let hasListContent = false;/);
			    assert.match(textLinesSection, /html \+= renderList\(lines, listType, listStart, i\);/);
		    assert.match(textLinesSection, /const paragraphStart = i;/);
		    assert.match(textLinesSection, /html \+= renderParagraphs\(lines, paragraphStart, i\);/);
		    assert.match(textLinesSection, /return html;/);
		    assert.match(listSection, /function renderList\(lines, type, startIndex, endIndex\)/);
		    assert.match(listSection, /if \(!lines\) return '';/);
		    assert.match(listSection, /const start = typeof startIndex === 'number' && startIndex > 0 \? startIndex : 0;/);
		    assert.match(listSection, /const end = typeof endIndex === 'number' && endIndex <= lines\.length \? endIndex : lines\.length;/);
		    assert.match(listSection, /let liHtml = '';/);
		    assert.match(listSection, /function\s+flushCurrent\(\)/);
		    assert.match(listSection, /for \(let i = start; i < end; i\+\+\)/);
	    assert.match(listSection, /MARKDOWN_ORDERED_LIST_ITEM_RE\.exec\(line\)/);
	    assert.match(listSection, /MARKDOWN_BULLET_LIST_ITEM_RE\.exec\(line\)/);
	    assert.match(listSection, /const continuation = line\.trim\(\);/);
	    assert.match(listSection, /if \(current && continuation\) \{/);
	    assert.match(listSection, /current \+= '\\n' \+ continuation;/);
	    assert.match(listSection, /liHtml \+= '<li>' \+ renderInlineMarkdown\(current\) \+ '<\/li>';/);
    assert.doesNotMatch(markdownSection, /const htmlParts = \[\];/);
    assert.doesNotMatch(markdownSection, /htmlParts\.join\(''\)/);
	    assert.doesNotMatch(markdownSection, /const lines = /);
	    assert.doesNotMatch(markdownSection, /codeLines/);
	    assert.doesNotMatch(markdownSection, /\.join\('\\n'\)/);
	    assert.doesNotMatch(markdownSection, /\.replace\(/);
    assert.doesNotMatch(markdownSection, /\.split\(/);
    assert.doesNotMatch(markdownSection, /const blocks = \[\];/);
    assert.doesNotMatch(markdownSection, /blocks\.push/);
	    assert.doesNotMatch(textLinesSection, /const isBlank/);
	    assert.doesNotMatch(textLinesSection, /\.trim\(\)/);
    assert.doesNotMatch(markdownSection, /for \(const block of blocks\)/);
		    assert.doesNotMatch(textLinesSection, /const parts = \[\];/);
		    assert.doesNotMatch(textLinesSection, /parts\.join\(''\)/);
		    assert.doesNotMatch(textLinesSection, /const tableLines = \[/);
		    assert.doesNotMatch(textLinesSection, /tableLines\.push/);
			    assert.doesNotMatch(textLinesSection, /const para = \[\];/);
			    assert.doesNotMatch(textLinesSection, /para\.push/);
			    assert.doesNotMatch(textLinesSection, /const listLines = \[\];/);
			    assert.doesNotMatch(textLinesSection, /listLines\.push/);
    assert.doesNotMatch(markdownSection, /htmlParts\.filter\(Boolean\)\.join/);
			    assert.doesNotMatch(textLinesSection, /parts\.filter\(Boolean\)\.join/);
			    assert.doesNotMatch(listSection, /const items = \[\];/);
			    assert.doesNotMatch(listSection, /for \(const raw of lines\)/);
		    assert.doesNotMatch(listSection, /\.map\(item =>/);
		    assert.doesNotMatch(listSection, /line\.trim\(\)[\s\S]*line\.trim\(\)/);
	    assert.doesNotMatch(textLinesSection + listSection, /\.match\(\/\^\\s/);
  });

	  test('markdown paragraph renderer streams paragraph html without intermediate arrays', () => {
	    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
	    const paragraphStart = renderUtilsSource.indexOf('function renderParagraphs');
	    assert.ok(paragraphStart >= 0, 'expected paragraph renderer');
	    const inlineRegexStart = renderUtilsSource.indexOf('const MARKDOWN_INLINE_CODE_RE', paragraphStart);
	    assert.ok(inlineRegexStart > paragraphStart, 'expected inline markdown regexes after paragraph renderer');
	    const paragraphEnd = inlineRegexStart;
	    const paragraphSection = renderUtilsSource.slice(paragraphStart, paragraphEnd);
	    const inlineStart = renderUtilsSource.indexOf('function renderInlineMarkdown', inlineRegexStart);
	    assert.ok(inlineStart > inlineRegexStart, 'expected inline renderer after inline regexes');
	    const inlineEnd = renderUtilsSource.indexOf('function postRenderedAction', inlineStart);
	    assert.ok(inlineEnd > inlineStart, 'expected action helper after inline renderer');
	    const inlineRegexSection = renderUtilsSource.slice(inlineRegexStart, inlineStart);
	    const inlineSection = renderUtilsSource.slice(inlineStart, inlineEnd);

		    assert.match(paragraphSection, /function renderParagraphs\(lines, startIndex, endIndex\)/);
		    assert.match(paragraphSection, /if \(!lines\) return '';/);
		    assert.match(paragraphSection, /const start = typeof startIndex === 'number' && startIndex > 0 \? startIndex : 0;/);
		    assert.match(paragraphSection, /const end = typeof endIndex === 'number' && endIndex <= lines\.length \? endIndex : lines\.length;/);
		    assert.match(paragraphSection, /let html = '';/);
		    assert.match(paragraphSection, /let current = '';/);
		    assert.match(paragraphSection, /function\s+flush\(\)/);
		    assert.match(paragraphSection, /html \+= '<p>' \+ renderInlineMarkdown\(text\) \+ '<\/p>';/);
		    assert.match(paragraphSection, /for \(let i = start; i < end; i\+\+\)/);
		    assert.match(paragraphSection, /if \(isMarkdownBlankLine\(line\)\) \{/);
		    assert.match(paragraphSection, /current = current \? current \+ '\\n' \+ line : line;/);
		    assert.match(paragraphSection, /return html;/);
		    assert.doesNotMatch(paragraphSection, /for \(const raw of lines\)/);
	    assert.ok(
	      inlineRegexSection.includes('const MARKDOWN_INLINE_CODE_RE = /`([^`]+)`/g;'),
	      'expected inline code regex to be hoisted'
	    );
	    assert.ok(
	      inlineRegexSection.includes('const MARKDOWN_INLINE_BOLD_RE = /\\*\\*([^*]+)\\*\\*/g;'),
	      'expected inline bold regex to be hoisted'
	    );
	    assert.ok(
	      inlineRegexSection.includes('const MARKDOWN_INLINE_NEWLINE_RE = /\\n/g;'),
	      'expected inline newline regex to be hoisted'
	    );
	    assert.match(inlineSection, /escaped\.replace\(MARKDOWN_INLINE_CODE_RE,/);
	    assert.match(inlineSection, /escaped\.replace\(MARKDOWN_INLINE_BOLD_RE,/);
	    assert.match(inlineSection, /escaped\.replace\(MARKDOWN_INLINE_NEWLINE_RE,/);
	    assert.match(inlineSection, /if \(escaped\.indexOf\('`'\) !== -1\) \{/);
	    assert.match(inlineSection, /if \(escaped\.indexOf\('\*\*'\) !== -1\) \{/);
	    assert.match(inlineSection, /if \(escaped\.indexOf\('\\n'\) !== -1\) \{/);
	    assert.ok(
	      inlineSection.indexOf("if (escaped.indexOf('`') !== -1)") <
	        inlineSection.indexOf('escaped = escaped.replace(MARKDOWN_INLINE_CODE_RE'),
	      'expected inline code replacement to be marker-gated'
	    );
	    assert.ok(
	      inlineSection.indexOf("if (escaped.indexOf('**') !== -1)") <
	        inlineSection.indexOf('escaped = escaped.replace(MARKDOWN_INLINE_BOLD_RE'),
	      'expected inline bold replacement to be marker-gated'
	    );
	    assert.ok(
	      inlineSection.indexOf("if (escaped.indexOf('\\n') !== -1)") <
	        inlineSection.indexOf('escaped = escaped.replace(MARKDOWN_INLINE_NEWLINE_RE'),
	      'expected inline newline replacement to be marker-gated'
	    );
	    assert.doesNotMatch(inlineSection, /escaped\.replace\(\/`/);
	    assert.doesNotMatch(inlineSection, /escaped\.replace\(\/\\\*\\\*/);
	    assert.doesNotMatch(inlineSection, /escaped\.replace\(\/\\n/);
    assert.doesNotMatch(paragraphSection, /const paragraphs = \[\];/);
    assert.doesNotMatch(paragraphSection, /let current = \[\];/);
	    assert.doesNotMatch(paragraphSection, /current\.push/);
	    assert.doesNotMatch(paragraphSection, /paragraphs\.join/);
		    assert.doesNotMatch(paragraphSection, /if \(!line\.trim\(\)\)/);
  });

		  test('plan question extraction streams body text without line arrays', () => {
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
		    assert.ok(renderUtilsSource.includes('const PLAN_MAIN_NUMBERED_QUESTION_RE = /^\\d+\\.\\s+.*\\?$/;'));
		    assert.ok(renderUtilsSource.includes('const PLAN_MAIN_SENTENCE_QUESTION_RE = /^[A-Z][^.!?]*\\?$/;'));
		    assert.ok(renderUtilsSource.includes('const PLAN_SUB_QUESTION_RE = /^[-\\*]\\s+.*\\?$/;'));
		    const planQuestionStart = renderUtilsSource.indexOf('const PLAN_MAIN_NUMBERED_QUESTION_RE');
		    assert.ok(planQuestionStart >= 0, 'expected plan question regex constants');
		    const helperStart = renderUtilsSource.indexOf('function extractPlanQuestionGroups');
		    assert.ok(helperStart >= 0, 'expected plan question extraction helper');
		    const helperEnd = renderUtilsSource.indexOf('function formatPlanCard', helperStart);
	    assert.ok(helperEnd > helperStart, 'expected plan card formatter after question extraction helper');
		    const planQuestionSection = renderUtilsSource.slice(planQuestionStart, helperEnd);
		    const helperSection = renderUtilsSource.slice(helperStart, helperEnd);

		    assert.match(planQuestionSection, /function isPlanMainQuestionLine\(trimmed\) \{/);
		    assert.match(planQuestionSection, /const firstCode = trimmed\.charCodeAt\(0\);/);
		    assert.match(planQuestionSection, /firstCode >= 48 && firstCode <= 57/);
		    assert.match(planQuestionSection, /firstCode >= 65 && firstCode <= 90/);
		    assert.match(planQuestionSection, /PLAN_MAIN_NUMBERED_QUESTION_RE\.test\(trimmed\)/);
		    assert.match(planQuestionSection, /PLAN_MAIN_SENTENCE_QUESTION_RE\.test\(trimmed\)/);
		    assert.match(helperSection, /const normalizedText = String\(text === undefined \|\| text === null \? '' : text\)\.trim\(\);/);
		    assert.match(helperSection, /let bodyText = '';/);
			    assert.match(helperSection, /forEachNormalizedMarkdownLine\(normalizedText, \(line\) => \{/);
			    assert.match(helperSection, /if \(isPlanMainQuestionLine\(trimmed\)\) \{/);
			    assert.match(helperSection, /if \(currentGroup && PLAN_SUB_QUESTION_RE\.test\(trimmed\)\) \{/);
			    assert.doesNotMatch(helperSection, /const isMainQuestion/);
			    assert.doesNotMatch(helperSection, /const isSubQuestion/);
			    assert.doesNotMatch(helperSection, /trimmed\.startsWith\('-'\)|trimmed\.startsWith\('\*'\)/);
		    assert.match(helperSection, /bodyText = bodyText \? bodyText \+ '\\n' \+ line : line;/);
		    assert.match(helperSection, /return \{ questionGroups, bodyText: bodyText\.trim\(\) \};/);
		    assert.doesNotMatch(helperSection, /\/\^\\d\+\\\.\\s\+\.\*\\\?\\\$\/\.test/);
		    assert.doesNotMatch(helperSection, /\/\^\[-\\\*\]\\s\+\.\*\\\?\\\$\/\.test/);
	    assert.doesNotMatch(helperSection, /bodyLines/);
	    assert.doesNotMatch(helperSection, /const lines = /);
	    assert.doesNotMatch(helperSection, /\.replace\(/);
	    assert.doesNotMatch(helperSection, /\.split\(/);
	    assert.doesNotMatch(helperSection, /new Set\(\)/);
	    assert.doesNotMatch(helperSection, /questionLineIndexes/);
		    assert.doesNotMatch(helperSection, /\.filter\(/);
		    assert.doesNotMatch(helperSection, /\.join\('\\n'\)/);
		  });

		  test('plan question rendering avoids callback iteration while assembling html', () => {
		    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
		    const formatterStart = renderUtilsSource.indexOf('function formatPlanCard');
		    assert.ok(formatterStart >= 0, 'expected plan card formatter');
		    const formatterEnd = renderUtilsSource.indexOf('function renderMarkdownCodeBlock', formatterStart);
		    assert.ok(formatterEnd > formatterStart, 'expected markdown renderer after plan card formatter');
			    const formatterSection = renderUtilsSource.slice(formatterStart, formatterEnd);
			    const needsInputBranchStart = formatterSection.indexOf("} else if (status === 'needs_input' && isActivePlan) {");
			    assert.ok(needsInputBranchStart >= 0, 'expected needs-input plan branch');
			    const needsInputBranchEnd = formatterSection.indexOf("} else if (status === 'generating' && isActivePlan) {", needsInputBranchStart);
			    assert.ok(needsInputBranchEnd > needsInputBranchStart, 'expected generating branch after needs-input plan branch');
			    const needsInputBranch = formatterSection.slice(needsInputBranchStart, needsInputBranchEnd);

					    assert.ok(renderUtilsSource.includes("const PLAN_CARD_SAFE_ID_UNSAFE_RE = /[^A-Za-z0-9_-]/g;"));
					    assert.ok(renderUtilsSource.includes('const PLAN_QUESTION_DISPLAY_LIMIT = 240;'));
					    assert.match(formatterSection, /const hasQuestions = questionGroups\.length > 0;/);
				    assert.match(formatterSection, /const hasPlanActionControls = isActivePlan && \(status === 'draft' \|\| status === 'needs_input'\);/);
				    assert.match(formatterSection, /const canCancelPlan = hasPlanActionControls;/);
				    assert.match(formatterSection, /let safePlanId = '';/);
				    assert.match(formatterSection, /if \(hasQuestions \|\| canCancelPlan\) \{[\s\S]*?safePlanId = planId\.replace\(PLAN_CARD_SAFE_ID_UNSAFE_RE, '_'\);[\s\S]*?\}/);
				    assert.match(formatterSection, /if \(hasQuestions\) \{[\s\S]*?const questionTitleId = 'planQuestionsTitle-' \+ safePlanId;/);
				    assert.match(formatterSection, /let cancelPlanButtonHtml = '';/);
				    assert.match(formatterSection, /let cancelConfirmHtml = '';/);
				    assert.match(formatterSection, /if \(canCancelPlan\) \{[\s\S]*?const cancelConfirmId = 'planCancelConfirm-' \+ safePlanId;/);
				    assert.match(formatterSection, /const questionTitleId = 'planQuestionsTitle-' \+ safePlanId;/);
				    assert.match(formatterSection, /const escapedQuestionTitleId = escapeHtml\(questionTitleId\);/);
				    assert.match(formatterSection, /<div class="plan-header"><span aria-hidden="true">🧭<\/span> Plan <span class="plan-status">/);
					    assert.match(formatterSection, /<ul class="plan-question-list" role="list" tabindex="0" data-scrollable="true" aria-labelledby="' \+ escapedQuestionTitleId \+ '">/);
					    assert.match(formatterSection, /let groupContent = '<li class="plan-question">';/);
					    assert.match(formatterSection, /groupContent \+= escapeHtml\(truncateText\(group\.main, PLAN_QUESTION_DISPLAY_LIMIT\)\);/);
					    assert.match(formatterSection, /groupContent \+= '<li>' \+ escapeHtml\(truncateText\(sub, PLAN_QUESTION_DISPLAY_LIMIT\)\) \+ '<\/li>';/);
					    assert.match(formatterSection, /groupContent \+= '<\/li>';/);
				    assert.match(formatterSection, /for \(let i = 0; i < questionGroups\.length; i\+\+\)/);
				    assert.match(formatterSection, /for \(let j = 0; j < group\.sub\.length; j\+\+\)/);
				    assert.doesNotMatch(formatterSection, /aria-label="Plan questions"/);
				    assert.doesNotMatch(formatterSection, /let groupContent = '<div class="plan-question">';/);
				    assert.doesNotMatch(formatterSection, /questionGroups\.forEach/);
				    assert.doesNotMatch(formatterSection, /group\.sub\.forEach/);
				    assert.doesNotMatch(formatterSection, /const safePlanId = planId\.replace/);
				    assert.doesNotMatch(needsInputBranch, /const hasQuestions = questionGroups\.length > 0;/);
			    assert.ok(!formatterSection.includes("planId.replace(/[^A-Za-z0-9_-]/g, '_')"));
			  });

	  test('tool card updates render explicit bodies instead of regex-stripping wrappers', () => {
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
    const contextSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/context.js'), 'utf8');
    const combinedCallers = mainSource + '\n' + renderMessagesSource;
    const batchUpdateStart = renderMessagesSource.indexOf('if (existingEl) {');
    assert.ok(batchUpdateStart >= 0, 'expected batch update branch');
	    const batchUpdateEnd = renderMessagesSource.indexOf('messageEls.set(msg.id, existingEl);', batchUpdateStart);
	    assert.ok(batchUpdateEnd > batchUpdateStart, 'expected message id update after batch update branch');
	    const updateOnlyCallers = mainSource + '\n' + renderMessagesSource.slice(batchUpdateStart, batchUpdateEnd);
	    const bodyStart = renderUtilsSource.indexOf('function formatToolCardBody');
	    assert.ok(bodyStart >= 0, 'expected tool-card body formatter');
	    const bodyEnd = renderUtilsSource.indexOf('function renderLspResults', bodyStart);
	    assert.ok(bodyEnd > bodyStart, 'expected LSP renderer after tool-card body formatter');
	    const bodySection = renderUtilsSource.slice(bodyStart, bodyEnd);
	    const extractStart = renderUtilsSource.indexOf('function extractArgValue');
	    assert.ok(extractStart >= 0, 'expected fallback arg extractor');
	    const extractEnd = renderUtilsSource.indexOf('function getToolCardStatusClass', extractStart);
	    assert.ok(extractEnd > extractStart, 'expected status class helper after fallback arg extractor');
	    const extractSection = renderUtilsSource.slice(extractStart, extractEnd);
	    const statusStart = extractEnd;
	    const statusEnd = renderUtilsSource.indexOf('function formatToolCardClass', statusStart);
	    assert.ok(statusEnd > statusStart, 'expected format class helper after status class helper');
	    const statusSection = renderUtilsSource.slice(statusStart, statusEnd);

		    assert.match(renderUtilsSource, /function\s+formatToolCardClass\(/);
	    assert.match(renderUtilsSource, /function\s+formatToolCardBody\(/);
	    assert.ok(renderUtilsSource.includes("const TOOL_ACTION_STATUS_PREFIX_RE = /^[✗✓]\\s*/;"));
	    assert.ok(renderUtilsSource.includes("const TOOL_ACTION_ELLIPSIS_SUFFIX_RE = /\\s*…$/;"));
	    assert.ok(renderUtilsSource.includes("replace(TOOL_ACTION_STATUS_PREFIX_RE, '').replace(TOOL_ACTION_ELLIPSIS_SUFFIX_RE, '')"));
	    assert.match(renderUtilsSource, /const toolCardBodyHtmlCache = new WeakMap\(\);/);
	    assert.match(renderUtilsSource, /const toolCardArgsCache = new WeakMap\(\);/);
	    assert.match(renderUtilsSource, /function\s+getToolCardBodyHtml\(cardEl\)/);
    assert.match(renderUtilsSource, /const cached = toolCardBodyHtmlCache\.get\(cardEl\);/);
    assert.match(renderUtilsSource, /if \(cached !== undefined\) return cached;/);
    assert.match(renderUtilsSource, /const current = cardEl\.innerHTML \|\| '';/);
    assert.match(renderUtilsSource, /toolCardBodyHtmlCache\.set\(cardEl, current\);/);
    assert.match(renderUtilsSource, /function\s+rememberToolCardBodyHtml\(cardEl, bodyHtml\)/);
    assert.match(renderUtilsSource, /toolCardBodyHtmlCache\.set\(cardEl, String\(bodyHtml \|\| ''\)\);/);
	    assert.match(renderUtilsSource, /function\s+formatToolSummary\(toolCall, bodyHtml\)/);
	    assert.match(renderUtilsSource, /const body = bodyHtml === undefined \? formatToolCardBody\(toolCall\) : String\(bodyHtml \|\| ''\);/);
	    assert.match(renderUtilsSource, /function\s+parseToolArgs\(rawArgsText\)/);
	    assert.match(renderUtilsSource, /const text = typeof rawArgsText === 'string' \? rawArgsText\.trim\(\) : '';/);
	    assert.match(renderUtilsSource, /if \(!text\) return \{\};/);
	    assert.match(renderUtilsSource, /const firstChar = text\[0\];/);
	    assert.match(renderUtilsSource, /if \(firstChar !== '\{' && firstChar !== '\['\) return \{\};/);
	    assert.match(renderUtilsSource, /try \{ args = JSON\.parse\(text\); \} catch \{\}/);
	    assert.doesNotMatch(renderUtilsSource, /JSON\.parse\(rawArgsText \|\| '\{\}'\)/);
	    assert.doesNotMatch(renderUtilsSource, /JSON\.parse\(rawArgsText\)/);
	    assert.match(renderUtilsSource, /const toolArgFallbackKeys = \['command', 'filePath', 'path', 'pattern', 'query'\];/);
	    assert.ok(renderUtilsSource.includes("const TOOL_ARG_QUOTE_EDGE_RE = /^['\"]|['\"]$/g;"));
	    assert.doesNotMatch(renderUtilsSource, /TOOL_STATUS_CLASS_UNSAFE_RE/);
		    assert.match(renderUtilsSource, /function\s+createToolArgFallbackPatterns\(key\)/);
		    assert.match(renderUtilsSource, /const toolArgFallbackPatterns = Object\.create\(null\);/);
		    assert.match(renderUtilsSource, /for \(let fallbackKeyIndex = 0; fallbackKeyIndex < toolArgFallbackKeys\.length; fallbackKeyIndex\+\+\)/);
		    assert.strictEqual(
		      (renderUtilsSource.match(/for \(let fallbackKeyIndex = 0; fallbackKeyIndex < toolArgFallbackKeys\.length; fallbackKeyIndex\+\+\)/g) || []).length,
		      2,
		      'expected fallback pattern setup and hydration to use indexed fallback key loops'
		    );
		    assert.match(renderUtilsSource, /const key = toolArgFallbackKeys\[fallbackKeyIndex\];/);
		    assert.doesNotMatch(renderUtilsSource, /for \(const key of toolArgFallbackKeys\)/);
		    assert.match(renderUtilsSource, /toolArgFallbackPatterns\[key\] = createToolArgFallbackPatterns\(key\);/);
		    assert.match(extractSection, /const patterns = toolArgFallbackPatterns\[key\];/);
		    assert.match(extractSection, /if \(!patterns\) return '';/);
		    assert.doesNotMatch(extractSection, /createToolArgFallbackPatterns\(key\)/);
		    assert.match(extractSection, /const jsonMatch = patterns\.json\.exec\(raw\);/);
	    assert.match(extractSection, /const flagMatch = patterns\.flag\.exec\(raw\);/);
	    assert.match(extractSection, /const kvMatch = patterns\.kv\.exec\(raw\);/);
	    assert.match(extractSection, /value\.replace\(TOOL_ARG_QUOTE_EDGE_RE, ''\)/);
	    assert.match(statusSection, /switch \(status\)/);
	    assert.match(statusSection, /case 'pending':[\s\S]*case 'running':[\s\S]*case 'success':[\s\S]*case 'error':[\s\S]*case 'rejected':[\s\S]*return status;/);
	    assert.match(statusSection, /default:[\s\S]*return status \? 'error' : 'running';/);
	    assert.doesNotMatch(extractSection, /new RegExp/);
	    assert.doesNotMatch(extractSection, /raw\.match\(patterns\./);
	    assert.ok(!extractSection.includes("value.replace(/^['\"]|['\"]$/g, '')"));
	    assert.doesNotMatch(statusSection, /replace\(/);
	    assert.match(renderUtilsSource, /function\s+toolArgTextMayContainKey\(rawArgsText, key\)/);
	    assert.match(renderUtilsSource, /return rawArgsText\.indexOf\(key\) !== -1;/);
	    assert.match(renderUtilsSource, /function\s+hydrateToolArgs\(args, rawArgsText\)/);
	    assert.match(renderUtilsSource, /if \(!toolArgTextMayContainKey\(rawArgsText, key\)\) continue;/);
	    assert.match(renderUtilsSource, /const extracted = extractArgValue\(rawArgsText, key\);/);
	    assert.match(renderUtilsSource, /function\s+getToolCardArgs\(toolCall, rawArgsText\)/);
	    assert.match(renderUtilsSource, /const cached = toolCardArgsCache\.get\(toolCall\);/);
	    assert.match(renderUtilsSource, /if \(cached && cached\.rawArgsText === rawArgsText\) return cached\.args;/);
	    assert.match(renderUtilsSource, /if \(!toolCall \|\| typeof toolCall !== 'object'\) return hydrateToolArgs\(parseToolArgs\(rawArgsText\), rawArgsText\);/);
	    assert.match(renderUtilsSource, /const args = hydrateToolArgs\(parseToolArgs\(rawArgsText\), rawArgsText\);/);
	    assert.match(renderUtilsSource, /toolCardArgsCache\.set\(toolCall, \{ rawArgsText, args \}\);/);
	    assert.match(renderUtilsSource, /function\s+updateToolCardElement\(/);
    assert.match(renderUtilsSource, /const classChanged = \(cardEl\.className \|\| ''\) !== nextClassName;/);
    assert.match(renderUtilsSource, /const bodyChanged = getToolCardBodyHtml\(cardEl\) !== nextBody;/);
    assert.match(renderUtilsSource, /if \(!classChanged && !bodyChanged\) return false;/);
    assert.match(renderUtilsSource, /if \(typeof beforeUpdate === 'function'\) beforeUpdate\(\);/);
	    assert.match(renderUtilsSource, /if \(classChanged\) setClassName\(cardEl, nextClassName\);/);
		    assert.match(renderUtilsSource, /if \(bodyChanged\) \{[\s\S]*cardEl\.innerHTML = nextBody;[\s\S]*hydrateToolCardPayloads\(cardEl, nextBody\);[\s\S]*toolCardBodyHtmlCache\.set\(cardEl, nextBody\);[\s\S]*\}/);
	    assert.match(bodySection, /const args = getToolCardArgs\(toolCall, rawArgsText\);/);
	    assert.doesNotMatch(bodySection, /JSON\.parse\(rawArgsText \|\| '\{\}'\)/);
	    assert.doesNotMatch(bodySection, /extractArgValue\(rawArgsText,/);
	    assert.match(contextSource, /const args = getToolCardArgs\(toolCall, rawArgsText\);/);
	    assert.doesNotMatch(contextSource, /function getToolModalTitle\(toolCall\) \{[\s\S]*?JSON\.parse\(rawArgsText \|\| '\{\}'\)/);
	    assert.match(renderUtilsSource, /return true;/);
	    assert.doesNotMatch(renderUtilsSource, /const bodyChanged = \(cardEl\.innerHTML \|\| ''\) !== nextBody;/);
	    assert.match(renderMessagesSource, /const messageToolCardElementCache = new WeakMap\(\);/);
		    assert.match(renderMessagesSource, /function\s+rememberMessageToolCardElement\(messageEl, toolCardEl\)/);
		    assert.match(renderMessagesSource, /messageToolCardElementCache\.set\(messageEl, toolCardEl\);/);
		    assert.match(renderMessagesSource, /function\s+findMessageToolCardElementFromLayout\(messageEl\)/);
		    assert.match(renderMessagesSource, /const card = children\[1\];/);
		    assert.match(renderMessagesSource, /return rememberMessageToolCardElement\(messageEl, card\);/);
		    assert.match(renderMessagesSource, /function\s+getCachedMessageToolCardElement\(messageEl\)/);
		    assert.match(renderMessagesSource, /function getContainedMessageCachedElement\(messageEl, cache\)/);
		    assert.match(renderMessagesSource, /typeof messageEl\.contains !== 'function' \|\| messageEl\.contains\(cached\)/);
		    assert.match(renderMessagesSource, /cache\.delete\(messageEl\);/);
		    assert.match(renderMessagesSource, /const cached = getContainedMessageCachedElement\(messageEl, messageToolCardElementCache\);/);
		    assert.match(renderMessagesSource, /if \(cached\) return cached;/);
		    assert.match(renderMessagesSource, /const layoutCard = findMessageToolCardElementFromLayout\(messageEl\);[\s\S]*if \(layoutCard\) return layoutCard;/);
		    assert.match(renderMessagesSource, /return rememberMessageToolCardElement\(messageEl, messageEl\.querySelector\('\.tool-card'\)\);/);
	    assert.match(renderMessagesSource, /const toolBodyHtml = formatToolCardBody\(msg\.toolCall\);/);
	    assert.doesNotMatch(renderMessagesSource, /formatToolSummary\(msg\.toolCall, toolBodyHtml\)/);
	    assert.match(renderMessagesSource, /hydrateToolCardPayloads\(toolCardEl, toolBodyHtml\);/);
	    assert.match(renderMessagesSource, /const cardEl = getCachedMessageToolCardElement\(existingEl\);/);
	    assert.match(renderMessagesSource, /rememberToolCardBodyHtml\(toolCardEl, toolBodyHtml\);/);
	    assert.match(combinedCallers, /const cardEl = getCachedMessageToolCardElement\(existingEl\);/);
	    assert.match(combinedCallers, /updateToolCardElement\(cardEl, lastToolMsg\.toolCall\);/);
	    assert.match(combinedCallers, /const markToolUpdateWillChange = \(\) => \{/);
	    assert.match(combinedCallers, /wasNearBottomToolUpdate = isNearBottom\(\);/);
	    assert.match(combinedCallers, /const cardEl = getCachedMessageToolCardElement\(toolEl\);/);
	    assert.match(combinedCallers, /const toolCardChanged = updateToolCardElement\(cardEl, updatedToolMessage\.toolCall, markToolUpdateWillChange\);/);
	    assert.match(combinedCallers, /if \(toolCardChanged && typeof scheduleFileLinkify === 'function'\)/);
	    assert.match(combinedCallers, /if \(toolUpdateNeedsAutoScroll\) maybeAutoScrollAfterLayout\(wasNearBottomToolUpdate\);/);
	    assert.doesNotMatch(combinedCallers, /const wasNearBottomToolUpdate = isNearBottom\(\);/);
	    assert.doesNotMatch(updateOnlyCallers, /formatToolCardBody\(/);
	    assert.doesNotMatch(updateOnlyCallers, /\.querySelector\('\.tool-card'\)/);
	    assert.doesNotMatch(combinedCallers, /cardEl\.className\s*=/);
    assert.doesNotMatch(combinedCallers, /cardEl\.innerHTML\s*=/);
    assert.doesNotMatch(combinedCallers, /replace\(/);
    assert.doesNotMatch(combinedCallers, /<div class="tool-card '\s*\+/);
	  });

  test('run coordinator pending-plan lookup scans messages without find callbacks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/runCoordinator.ts'), 'utf8');
    const section = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      assert.ok(start >= 0, `expected section start: ${startText}`);
      const end = source.indexOf(endText, start);
      assert.ok(end > start, `expected section end after ${startText}: ${endText}`);
      return source.slice(start, end);
    };

    const helperSection = section('function findChatMessageById', 'function normalizeUserInput');
    const resolveSection = section('private resolvePendingPlanMessage', 'private async handlePendingPlanUserInput');
    const cancelSection = section('async cancelPendingPlan', 'async revisePendingPlan');

    assert.match(helperSection, /for \(const message of messages\)/);
    assert.match(helperSection, /if \(message\.id === id\) return message;/);
    assert.match(resolveSection, /findChatMessageById\(c\.messages, params\.pendingPlan\.planMessageId\)/);
    assert.match(cancelSection, /findChatMessageById\(c\.messages, planMessageId\)/);
    assert.doesNotMatch(helperSection + resolveSection + cancelSection, /\.find\(/);
  });

  test('plan card rerenders preserve activity children without duplicate array snapshots', () => {
    const bootstrapSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/bootstrap.js'), 'utf8');
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/main.js'), 'utf8');
    const renderMessagesSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-messages.js'), 'utf8');
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const helperStart = mainSource.indexOf('function planCardRenderKeyMatches');
    assert.ok(helperStart >= 0, 'expected plan card render-key helper');
    const helperEnd = mainSource.indexOf('function rerenderPlanCards', helperStart);
    assert.ok(helperEnd > helperStart, 'expected end of rerenderPlanMessage helper');
    const helperSection = mainSource.slice(helperStart, helperEnd);
    const rerenderCardsStart = mainSource.indexOf('function rerenderPlanCards');
    assert.ok(rerenderCardsStart >= 0, 'expected rerenderPlanCards helper');
    const rerenderCardsEnd = mainSource.indexOf('const MARKDOWN_RENDER_DEBOUNCE_MS', rerenderCardsStart);
    assert.ok(rerenderCardsEnd > rerenderCardsStart, 'expected end of rerenderPlanCards helper');
    const rerenderCardsSection = mainSource.slice(rerenderCardsStart, rerenderCardsEnd);
    const updateCaseStart = mainSource.indexOf("case 'updateMessage':");
    assert.ok(updateCaseStart >= 0, 'expected updateMessage branch');
    const updateCaseEnd = mainSource.indexOf("case 'processing':", updateCaseStart);
    assert.ok(updateCaseEnd > updateCaseStart, 'expected end of updateMessage branch');
    const updateSection = mainSource.slice(updateCaseStart, updateCaseEnd);
    const clearedCaseStart = mainSource.indexOf("case 'cleared':");
    assert.ok(clearedCaseStart >= 0, 'expected cleared branch');
    const clearedCaseEnd = mainSource.indexOf("case 'modeChanged':", clearedCaseStart);
    assert.ok(clearedCaseEnd > clearedCaseStart, 'expected end of cleared branch');
    const clearedSection = mainSource.slice(clearedCaseStart, clearedCaseEnd);
    const planPendingCaseStart = mainSource.indexOf("case 'planPending':");
    assert.ok(planPendingCaseStart >= 0, 'expected planPending branch');
    const planPendingCaseEnd = mainSource.indexOf("case 'revertState':", planPendingCaseStart);
    assert.ok(planPendingCaseEnd > planPendingCaseStart, 'expected revertState branch after planPending');
    const planPendingSection = mainSource.slice(planPendingCaseStart, planPendingCaseEnd);

    assert.match(bootstrapSource, /const\s+planMessageIds\s*=\s*new Set\(\)/);
    assert.match(bootstrapSource, /function\s+rememberMessageData\(/);
    assert.match(bootstrapSource, /function\s+clearMessageDataIndexes\(/);
    assert.match(renderMessagesSource, /rememberMessageData\(msg\)/);
	    assert.match(renderMessagesSource, /const messagePlanActivityPartsCache = new WeakMap\(\);/);
	    assert.match(renderMessagesSource, /function rememberMessagePlanActivityParts\(messageEl, parts\)/);
	    assert.match(renderMessagesSource, /function hasElementClass\(el, className\)/);
	    assert.match(renderMessagesSource, /\(' ' \+ String\(el\.className \|\| ''\) \+ ' '\)\.indexOf\(' ' \+ className \+ ' '\) >= 0;/);
	    assert.doesNotMatch(renderMessagesSource, /String\(el\.className \|\| ''\)\.split\(/);
	    assert.match(renderMessagesSource, /function findMessagePlanActivityPartsFromLayout\(messageEl\)/);
	    assert.match(renderMessagesSource, /const details = children\[childCount - 1\];/);
	    assert.match(renderMessagesSource, /return rememberMessagePlanActivityParts\(messageEl, \{ details, body, count \}\);/);
	    assert.match(renderMessagesSource, /function findMessagePlanActivityParts\(messageEl\)/);
	    assert.match(renderMessagesSource, /const layoutParts = findMessagePlanActivityPartsFromLayout\(messageEl\);[\s\S]*if \(layoutParts\) return layoutParts;/);
	    assert.match(renderMessagesSource, /const parts = \{[\s\S]*details: messageEl\.querySelector\('\.plan-activity'\),[\s\S]*body: messageEl\.querySelector\('\.plan-activity-body'\),[\s\S]*count: null,[\s\S]*\};/);
    assert.match(renderMessagesSource, /parts\.count = parts\.details && parts\.details\.querySelector \? parts\.details\.querySelector\('\.plan-activity-count'\) : null;/);
    assert.match(renderMessagesSource, /if \(parts\.details && parts\.body && parts\.count\) return rememberMessagePlanActivityParts\(messageEl, parts\);/);
    assert.match(renderMessagesSource, /return parts\.details \|\| parts\.body \|\| parts\.count \? parts : null;/);
    assert.match(renderMessagesSource, /function getCachedMessagePlanActivityParts\(messageEl\)/);
    assert.match(renderMessagesSource, /function getContainedMessageCachedParts\(messageEl, cache, keys\)/);
    assert.match(renderMessagesSource, /for \(let i = 0; i < keys\.length; i\+\+\)/);
    assert.match(renderMessagesSource, /if \(!part \|\| !messageEl\.contains\(part\)\) \{[\s\S]*cache\.delete\(messageEl\);/);
    assert.match(renderMessagesSource, /const cached = getContainedMessageCachedParts\(messageEl, messagePlanActivityPartsCache, \['details', 'body', 'count'\]\);/);
    assert.match(renderMessagesSource, /return findMessagePlanActivityParts\(messageEl\);/);
    assert.match(renderMessagesSource, /const activityParts = findMessagePlanActivityParts\(el\);/);
    assert.match(renderMessagesSource, /const planParts = getCachedMessagePlanActivityParts\(stepEl\);/);
    assert.match(renderUtilsSource, /function\s+getPlanCardRenderKey\(msg\)/);
    assert.match(renderUtilsSource, /function\s+getPlanCardRenderKey\(msg\)[\s\S]*const key = createCompactRenderKeyBuilder\(\);[\s\S]*appendCompactRenderKeyPart\(key, content\);[\s\S]*appendCompactRenderKeyPart\(key, isActivePlan \? '1' : '0'\);[\s\S]*return finishCompactRenderKey\(key\);[\s\S]*function\s+formatPlanCard\(msg\)/);
    assert.doesNotMatch(renderUtilsSource, /function\s+appendPlanCardRenderKeyPart\(/);
    assert.doesNotMatch(renderUtilsSource, /appendPlanCardRenderKeyPart\(key, content\)/);
    assert.match(renderUtilsSource, /const\s+planCardRenderKeyByElement\s*=\s*new WeakMap\(\)/);
    assert.match(renderUtilsSource, /function\s+getCompactRenderDatasetKey\(renderKey\)/);
    assert.match(renderUtilsSource, /function\s+getPlanCardRenderDatasetKey\(renderKey\)/);
    assert.match(renderUtilsSource, /hash = Math\.imul\(hash, 16777619\);/);
    assert.match(renderUtilsSource, /function\s+getPlanCardRenderDatasetKey\(renderKey\)\s*\{\s*return getCompactRenderDatasetKey\(renderKey\);\s*\}/);
    assert.match(renderUtilsSource, /function\s+rememberPlanCardRenderKey\(messageEl, renderKey\)/);
    assert.match(renderUtilsSource, /planCardRenderKeyByElement\.set\(messageEl, key\)/);
    assert.match(renderUtilsSource, /messageEl\.dataset\.planRenderKey = datasetKey;/);
    assert.match(renderUtilsSource, /function\s+getRememberedPlanCardRenderKey\(messageEl\)/);
    assert.match(renderMessagesSource, /rememberPlanCardRenderKey\(el, getPlanCardRenderKey\(msg\)\);/);
    assert.match(renderMessagesSource, /hydratePlanActionPayloads\(el\);/);
    assert.doesNotMatch(renderMessagesSource, /el\.dataset\.planRenderKey = getPlanCardRenderKey\(msg\);/);
    assert.match(helperSection, /function planCardRenderKeyMatches\(messageEl, renderKey\)/);
    assert.match(helperSection, /getRememberedPlanCardRenderKey\(messageEl\) === renderKey/);
    assert.match(helperSection, /function rerenderPlanMessage\(msg, wasNearBottomOverride, renderKeyOverride\)/);
    assert.match(helperSection, /const nextRenderKey = renderKeyOverride \|\| \(typeof getPlanCardRenderKey === 'function' \? getPlanCardRenderKey\(msg\) : ''\);/);
    assert.match(helperSection, /if \(planCardRenderKeyMatches\(msgEl, nextRenderKey\)\) return false;/);
    assert.match(helperSection, /const shouldAutoScroll = typeof wasNearBottomOverride !== 'boolean';/);
    assert.match(helperSection, /const wasNearBottom = shouldAutoScroll \? isNearBottom\(\) : wasNearBottomOverride;/);
    assert.match(helperSection, /const existingActivity = typeof getCachedMessagePlanActivityParts === 'function'[\s\S]*getCachedMessagePlanActivityParts\(msgEl\)/);
    assert.match(helperSection, /const existingBody = existingActivity \? existingActivity\.body : msgEl\.querySelector\('\.plan-activity-body'\);/);
    assert.match(helperSection, /const existingDetails = existingActivity \? existingActivity\.details : msgEl\.querySelector\('\.plan-activity'\);/);
    assert.match(helperSection, /let activityFragment = null;/);
    assert.match(helperSection, /if \(existingBody && existingBody\.firstChild\) \{/);
    assert.match(helperSection, /activityFragment = document\.createDocumentFragment\(\);/);
    assert.match(helperSection, /while \(existingBody\.firstChild\)/);
    assert.match(helperSection, /if \(activityFragment\) nextBody\.appendChild\(activityFragment\);/);
    assert.doesNotMatch(helperSection, /const activityFragment = document\.createDocumentFragment\(\);/);
    assert.match(helperSection, /hydratePlanActionPayloads\(msgEl\);/);
    assert.match(helperSection, /rememberPlanCardRenderKey\(msgEl, nextRenderKey\);/);
    assert.match(helperSection, /const nextActivity = typeof findMessagePlanActivityParts === 'function'[\s\S]*findMessagePlanActivityParts\(msgEl\)/);
    assert.match(helperSection, /const nextDetails = nextActivity \? nextActivity\.details : msgEl\.querySelector\('\.plan-activity'\);/);
    assert.match(helperSection, /const countEl = nextActivity \? nextActivity\.count : nextDetails\.querySelector\('\.plan-activity-count'\);/);
    assert.match(helperSection, /const nextBody = nextActivity \? nextActivity\.body : msgEl\.querySelector\('\.plan-activity-body'\);/);
    assert.doesNotMatch(helperSection, /msgEl\.dataset\.planRenderKey = nextRenderKey;/);
    assert.match(helperSection, /if \(shouldAutoScroll\) maybeAutoScroll\(wasNearBottom\);/);
    assert.match(helperSection, /return true;/);
    assert.doesNotMatch(helperSection, /Array\.from\(existingBody\.children\)/);
    assert.match(rerenderCardsSection, /for \(const messageId of planMessageIds\)/);
    assert.match(rerenderCardsSection, /messageDataById\.get\(messageId\)/);
    assert.match(rerenderCardsSection, /if \(!msgEl\) continue;/);
    assert.match(rerenderCardsSection, /if \(planCardRenderKeyMatches\(msgEl, nextRenderKey\)\) continue;/);
    assert.match(rerenderCardsSection, /if \(wasNearBottom === undefined\) wasNearBottom = isNearBottom\(\);/);
    assert.match(rerenderCardsSection, /rerenderPlanMessage\(msg, wasNearBottom, nextRenderKey\)/);
    assert.match(rerenderCardsSection, /if \(rerendered\) maybeAutoScroll\(wasNearBottom\);/);
    assert.doesNotMatch(rerenderCardsSection, /messageDataById\.forEach/);
    assert.doesNotMatch(rerenderCardsSection, /rerenderPlanMessage\(msg\);/);
    assert.match(updateSection, /rerenderPlanMessage\(updatedMessage\)/);
    assert.match(updateSection, /rememberMessageData\(updatedMessage\)/);
    assert.match(clearedSection, /clearMessageDataIndexes\(\)/);
    assert.match(planPendingSection, /const nextPlanPending = !!data\.value;/);
    assert.match(planPendingSection, /const nextActivePlanMessageId = typeof data\.planMessageId === 'string' \? data\.planMessageId : '';/);
    assert.match(planPendingSection, /if \(planPending === nextPlanPending && activePlanMessageId === nextActivePlanMessageId\) break;/);
    assert.ok(
      planPendingSection.indexOf('planPending === nextPlanPending') < planPendingSection.indexOf('setPlanPending(nextPlanPending)'),
      'expected unchanged plan-pending guard before composer sync'
    );
    assert.doesNotMatch(updateSection, /Array\.from\(existingBody\.children\)/);
  });

  test('plan cancel confirmation visibility uses cached state before class writes', () => {
    const renderUtilsSource = fs.readFileSync(path.resolve(__dirname, '../../../media/chat/render-utils.js'), 'utf8');
    const markupStart = renderUtilsSource.indexOf("let cancelPlanButtonHtml = '';");
    assert.ok(markupStart >= 0, 'expected plan cancel confirmation markup');
    const markupEnd = renderUtilsSource.indexOf("let actions = '';", markupStart);
    assert.ok(markupEnd > markupStart, 'expected plan action markup after cancel confirmation markup');
    const markupSection = renderUtilsSource.slice(markupStart, markupEnd);
    const branchStart = renderUtilsSource.indexOf('const actionTarget = closestRenderedActionTarget(e);');
    assert.ok(branchStart >= 0, 'expected delegated rendered action handler');
    const branchEnd = renderUtilsSource.indexOf("if (action !== 'approve'", branchStart);
    assert.ok(branchEnd > branchStart, 'expected end of plan button handler');
	    const branchSection = renderUtilsSource.slice(branchStart, branchEnd);
	    const dismissGetterStart = renderUtilsSource.indexOf('function getPlanCancelDismissConfirm(actionEl)');
	    assert.ok(dismissGetterStart >= 0, 'expected plan cancel dismiss owner helper');
	    const dismissGetterEnd = renderUtilsSource.indexOf('function getPlanCancelActionPlan', dismissGetterStart);
	    assert.ok(dismissGetterEnd > dismissGetterStart, 'expected plan cancel action helper after dismiss helper');
	    const dismissGetterSection = renderUtilsSource.slice(dismissGetterStart, dismissGetterEnd);
	    const planGetterStart = renderUtilsSource.indexOf('function getPlanCancelActionPlan(actionEl)');
	    assert.ok(planGetterStart >= 0, 'expected plan cancel action owner helper');
	    const planGetterEnd = renderUtilsSource.indexOf('function isPlanCancelConfirmOpen', planGetterStart);
	    assert.ok(planGetterEnd > planGetterStart, 'expected plan cancel state helper after action helper');
	    const planGetterSection = renderUtilsSource.slice(planGetterStart, planGetterEnd);
	    const dismissCachedIndex = dismissGetterSection.indexOf('const cachedConfirm = getContainedCachedElement(actionEl, planCancelConfirmByDismissButton);');
	    const dismissLayoutIndex = dismissGetterSection.indexOf('const layoutConfirm = findPlanCancelDismissConfirmFromLayout(actionEl);');
	    const planCachedIndex = planGetterSection.indexOf('const cachedPlan = getContainedCachedElement(actionEl, planCancelPlanByButton);');
	    const planLayoutIndex = planGetterSection.indexOf('const layoutPlan = findPlanCancelActionPlanFromLayout(actionEl);');

	    assert.match(markupSection, /role="group"/);
	    assert.match(markupSection, /if \(canCancelPlan\) \{/);
	    assert.match(markupSection, /aria-labelledby="' \+ escapedCancelConfirmTextId \+ '"/);
	    assert.doesNotMatch(markupSection, /aria-label="Cancel plan confirmation"/);
	    assert.doesNotMatch(markupSection, /aria-describedby="/);
	    assert.match(markupSection, /id="' \+ escapedCancelConfirmId \+ '"/);
    assert.match(markupSection, /data-action="cancelPlanDismiss"[\s\S]*aria-label="Keep plan"/);
    assert.match(markupSection, /data-action="cancelPlanConfirm"[\s\S]*aria-label="Cancel plan"/);
    for (const { action, label, text } of [
      { action: 'executePlan', label: 'Execute plan', text: 'Execute' },
      { action: 'revisePlan', label: 'Revise plan', text: 'Revise' },
    ]) {
      const buttonMatches = [...renderUtilsSource.matchAll(new RegExp(`data-action="${action}"[^>]*>${text}<\\/button>`, 'g'))];
      assert.ok(buttonMatches.length >= 1, `expected ${action} button markup`);
      for (const match of buttonMatches) {
        const buttonSource = match[0];
        assert.match(buttonSource, new RegExp(`title="${label}"`));
        assert.match(buttonSource, new RegExp(`aria-label="${label}"`));
      }
    }
    const cancelPlanButtonMatches = [...renderUtilsSource.matchAll(/data-action="cancelPlan"[^>]*>Cancel<\/button>/g)];
    assert.ok(cancelPlanButtonMatches.length >= 1, 'expected shared cancel-plan button markup');
    for (const match of cancelPlanButtonMatches) {
      const buttonSource = match[0];
      assert.match(buttonSource, /title="Cancel plan"/);
      assert.match(buttonSource, /aria-label="Cancel plan"/);
      assert.match(buttonSource, /aria-expanded="false"/);
      assert.match(buttonSource, /aria-controls="/);
    }
    assert.match(renderUtilsSource, /let safePlanId = '';/);
    assert.match(renderUtilsSource, /safePlanId = planId\.replace/);
    assert.match(renderUtilsSource, /const cancelConfirmId = 'planCancelConfirm-' \+ safePlanId/);
    assert.match(renderUtilsSource, /const cancelConfirmTextId = 'planCancelConfirmText-' \+ safePlanId/);
    assert.doesNotMatch(markupSection, /data-plan-cancel-open=/);
    assert.doesNotMatch(markupSection, /data-plan-cancel-confirm=/);
    assert.doesNotMatch(markupSection, /\bdata-plan="/);
    assert.match(renderUtilsSource, /let cancelPlanButtonHtml = '';/);
    assert.match(renderUtilsSource, /cancelPlanButtonHtml =/);
    assert.match(renderUtilsSource, /const planActionMessageIdByElement = new WeakMap\(\);/);
    assert.match(renderUtilsSource, /const planActionMessageIdByToken = new Map\(\);/);
    assert.match(renderUtilsSource, /const planActionMessageTokenByValue = new Map\(\);/);
	    assert.match(renderUtilsSource, /function renderPlanActionAttrs\(planMessageId\)/);
	    assert.match(renderUtilsSource, /function getPlanActionMessageId\(el\)/);
	    assert.match(renderUtilsSource, /function hydratePlanActionPayloads\(rootEl\)/);
	    assert.match(renderUtilsSource, /function hydratePlanActionPayloadButton\(button\)/);
	    assert.match(renderUtilsSource, /function hydratePlanActionPayloadsFromLayout\(rootEl\)/);
	    assert.match(renderUtilsSource, /if \(hydratePlanActionPayloadsFromLayout\(rootEl\)\) return;/);
	    assert.match(renderUtilsSource, /querySelectorAll\('\[data-plan-action-id\]'\)/);
    assert.match(renderUtilsSource, /const hasPlanActionControls = isActivePlan && \(status === 'draft' \|\| status === 'needs_input'\);/);
    assert.match(renderUtilsSource, /const planActionAttrs = hasPlanActionControls \? renderPlanActionAttrs\(planId\) : '';/);
    assert.doesNotMatch(markupSection, /role="alert"/);
    assert.doesNotMatch(markupSection, /aria-live="polite"/);
    assert.match(renderUtilsSource, /const renderedActionByElement = new WeakMap\(\);/);
    assert.match(renderUtilsSource, /function rememberRenderedAction\(el, action\)/);
    assert.match(renderUtilsSource, /function getRenderedAction\(el\)/);
    assert.match(renderUtilsSource, /function closestRenderedActionTarget\(event\)/);
    assert.match(branchSection, /const action = getRenderedAction\(actionTarget\);/);
    assert.match(branchSection, /getRenderedMessageElementId\(msgEl\)/);
    assert.doesNotMatch(branchSection, /msgEl && msgEl\.dataset \? msgEl\.dataset\.id : ''/);
    assert.match(branchSection, /const planMessageId = getPlanActionMessageId\(planBtn\);/);
    assert.match(branchSection, /action === 'cancelPlan'/);
    assert.match(branchSection, /action === 'cancelPlanDismiss'/);
	    assert.match(branchSection, /setPlanCancelConfirmOpen\(confirmEl, true, planBtn\);/);
	    assert.match(branchSection, /setPlanCancelConfirmOpen\(confirmEl, false, null\);/);
		    assert.match(renderUtilsSource, /function focusRenderedControl\(element\)/);
		    assert.match(renderUtilsSource, /element\.focus\(\{ preventScroll: true \}\);/);
		    assert.match(renderUtilsSource, /const planCancelTriggerByConfirm = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /const planCancelOpenByConfirm = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /const planCancelPlanByButton = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /const planCancelConfirmByDismissButton = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /const planCancelConfirmByPlan = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /const planCancelKeepButtonByConfirm = new WeakMap\(\);/);
		    assert.match(renderUtilsSource, /function isPlanCancelConfirmOpen\(confirmEl\)/);
		    assert.match(renderUtilsSource, /const cachedOpen = planCancelOpenByConfirm\.get\(confirmEl\);/);
		    assert.match(renderUtilsSource, /Plan cancellation confirmations are rendered hidden/);
		    assert.match(renderUtilsSource, /planCancelOpenByConfirm\.set\(confirmEl, false\);/);
				    assert.match(renderUtilsSource, /function getPlanCancelKeepButton\(confirmEl\)/);
				    assert.match(renderUtilsSource, /const cachedButton = planCancelKeepButtonByConfirm\.get\(confirmEl\);/);
				    assert.match(renderUtilsSource, /typeof confirmEl\.contains !== 'function' \|\| confirmEl\.contains\(cachedButton\)/);
				    assert.match(renderUtilsSource, /planCancelKeepButtonByConfirm\.delete\(confirmEl\);/);
				    assert.match(renderUtilsSource, /function findPlanCancelKeepButtonFromLayout\(confirmEl\)/);
			    assert.match(renderUtilsSource, /getRenderedAction\(keepButton\) !== 'cancelPlanDismiss'/);
			    assert.match(renderUtilsSource, /const layoutButton = findPlanCancelKeepButtonFromLayout\(confirmEl\);[\s\S]*if \(layoutButton\) return layoutButton;/);
			    assert.match(renderUtilsSource, /if \(keepButton\) planCancelKeepButtonByConfirm\.set\(confirmEl, keepButton\);/);
			    assert.match(renderUtilsSource, /function getPlanCancelDismissConfirm\(actionEl\)/);
			    assert.match(renderUtilsSource, /function findPlanCancelDismissConfirmFromLayout\(actionEl\)/);
			    assert.match(renderUtilsSource, /planCancelConfirmByDismissButton\.set\(actionEl, confirmEl\);/);
			    assert.ok(dismissCachedIndex >= 0, 'expected dismiss helper to check the contained cached confirmation first');
			    assert.ok(dismissLayoutIndex > dismissCachedIndex, 'expected cached dismiss confirmation lookup before layout traversal');
			    assert.match(dismissGetterSection, /if \(cachedConfirm\) return cachedConfirm;/);
			    assert.match(dismissGetterSection, /const layoutConfirm = findPlanCancelDismissConfirmFromLayout\(actionEl\);[\s\S]*if \(layoutConfirm\) return layoutConfirm;/);
			    assert.match(dismissGetterSection, /getCachedClosestElement\(actionEl, '\.plan-cancel-confirm', planCancelConfirmByDismissButton\)/);
			    assert.match(renderUtilsSource, /function getPlanCancelActionPlan\(actionEl\)/);
			    assert.match(renderUtilsSource, /function findPlanCancelActionPlanFromLayout\(actionEl\)/);
			    assert.match(renderUtilsSource, /planCancelPlanByButton\.set\(actionEl, planEl\);/);
			    assert.ok(planCachedIndex >= 0, 'expected plan action helper to check the contained cached plan first');
			    assert.ok(planLayoutIndex > planCachedIndex, 'expected cached plan action lookup before layout traversal');
			    assert.match(planGetterSection, /if \(cachedPlan\) return cachedPlan;/);
			    assert.match(planGetterSection, /const layoutPlan = findPlanCancelActionPlanFromLayout\(actionEl\);[\s\S]*if \(layoutPlan\) return layoutPlan;/);
			    assert.match(planGetterSection, /getCachedClosestElement\(actionEl, '\.message\.plan', planCancelPlanByButton\)/);
		    assert.match(renderUtilsSource, /function getPlanCancelConfirm\(planEl\)/);
		    assert.match(renderUtilsSource, /const cachedConfirm = planCancelConfirmByPlan\.get\(planEl\);/);
		    assert.match(renderUtilsSource, /function findPlanCancelConfirmFromLayout\(planEl\)/);
		    assert.match(renderUtilsSource, /function isPlanCancelConfirmElement\(el\)/);
		    assert.match(renderUtilsSource, /planCancelConfirmByPlan\.set\(planEl, confirmEl\);[\s\S]*return confirmEl;/);
		    assert.match(renderUtilsSource, /const layoutConfirm = findPlanCancelConfirmFromLayout\(planEl\);[\s\S]*if \(layoutConfirm\) return layoutConfirm;/);
		    assert.match(renderUtilsSource, /let isCurrent = true;[\s\S]*planEl\.contains\(cachedConfirm\)/);
		    assert.match(renderUtilsSource, /cachedConfirm\.closest\('\.message\.plan'\) === planEl/);
		    assert.match(renderUtilsSource, /planCancelConfirmByPlan\.delete\(planEl\);/);
		    assert.match(renderUtilsSource, /if \(confirmEl\) planCancelConfirmByPlan\.set\(planEl, confirmEl\);/);
		    assert.doesNotMatch(renderUtilsSource, /const isCurrent =[\s\S]*\?[\s\S]*cachedConfirm\.closest\('\.message\.plan'\)/);
		    assert.doesNotMatch(renderUtilsSource, /function setPlanCancelConfirmOpenCache/);
		    assert.match(renderUtilsSource, /planCancelOpenByConfirm\.set\(confirmEl, nextOpen\);/);
		    assert.doesNotMatch(renderUtilsSource, /PLAN_CANCEL_(?:TRIGGER|OPEN)_KEY/);
		    assert.doesNotMatch(renderUtilsSource, /dataset\.planCancelOpen/);
		    assert.doesNotMatch(renderUtilsSource, /dataset\.plan;/);
		    assert.doesNotMatch(renderUtilsSource, /data-plan-cancel-open/);
		    assert.doesNotMatch(renderUtilsSource, /function findPlanCancelTrigger/);
		    assert.doesNotMatch(renderUtilsSource, /querySelectorAll\('\[data-action="cancelPlan"\]'\)/);
			    assert.match(renderUtilsSource, /function setPlanCancelConfirmOpen\(confirmEl, open, trigger\)/);
			    assert.match(renderUtilsSource, /const nextOpen = !!open;/);
			    assert.match(renderUtilsSource, /const wasOpen = isPlanCancelConfirmOpen\(confirmEl\);/);
			    assert.match(renderUtilsSource, /const cachedTrigger = planCancelTriggerByConfirm\.get\(confirmEl\) \|\| null;/);
			    assert.match(renderUtilsSource, /if \(nextOpen && wasOpen && cachedTrigger && \(!trigger \|\| trigger === cachedTrigger\)\) return;/);
			    assert.match(renderUtilsSource, /if \(!nextOpen && !wasOpen\) return;/);
			    assert.match(renderUtilsSource, /if \(nextOpen && wasOpen && cachedTrigger && \(!trigger \|\| trigger === cachedTrigger\)\) return;[\s\S]*if \(!nextOpen && !wasOpen\) return;[\s\S]*if \(nextOpen !== wasOpen\) \{[\s\S]*confirmEl\.classList\.toggle\('hidden', !nextOpen\);[\s\S]*planCancelOpenByConfirm\.set\(confirmEl, nextOpen\);/);
			    assert.doesNotMatch(renderUtilsSource, /setHidden\(confirmEl, !nextOpen\);/);
			    assert.match(renderUtilsSource, /const cancelTrigger = trigger \|\| cachedTrigger;/);
	    assert.match(renderUtilsSource, /if \(nextOpen\) planCancelTriggerByConfirm\.set\(confirmEl, cancelTrigger\);/);
	    assert.match(renderUtilsSource, /planCancelTriggerByConfirm\.delete\(confirmEl\);/);
	    assert.match(renderUtilsSource, /setAttributeValue\(cancelTrigger, 'aria-expanded', nextOpen \? 'true' : 'false'\);/);
    assert.match(renderUtilsSource, /focusRenderedControl\(getPlanCancelKeepButton\(confirmEl\)\);/);
    assert.doesNotMatch(renderUtilsSource, /const keepButton = confirmEl\.querySelector \? confirmEl\.querySelector\('\[data-action="cancelPlanDismiss"\]'\) : null;[\s\S]*focusRenderedControl\(keepButton\);/);
    assert.match(branchSection, /const planEl = getPlanCancelActionPlan\(planBtn\);/);
    assert.match(branchSection, /const confirmEl = getPlanCancelConfirm\(planEl\);/);
    assert.match(branchSection, /const confirmEl = getPlanCancelDismissConfirm\(planBtn\);/);
    assert.doesNotMatch(branchSection, /planEl \? planEl\.querySelector\('\.plan-cancel-confirm'\) : null/);
    assert.doesNotMatch(branchSection, /planBtn\.closest\('\.message\.plan'\)/);
    assert.doesNotMatch(branchSection, /planBtn\.closest\('\.plan-cancel-confirm'\)/);
    assert.doesNotMatch(branchSection, /closestEventTarget\(e, '\.plan-btn'\)/);
    assert.doesNotMatch(branchSection, /closestEventTarget\(e, '\[data-action="/);
    assert.doesNotMatch(branchSection, /confirmEl\.classList\.remove\('hidden'\)/);
    assert.doesNotMatch(branchSection, /confirmEl\.classList\.add\('hidden'\)/);
  });

  test('extension-side diff helpers scan without allocating full line arrays', () => {
    const toolDiffSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/toolDiff.ts'), 'utf8');
    const statsStart = toolDiffSource.indexOf('export function computeUnifiedDiffStats');
    assert.ok(statsStart >= 0, 'expected computeUnifiedDiffStats helper');
    const parserEnd = toolDiffSource.indexOf('export function buildToolDiffView', statsStart);
    assert.ok(parserEnd > statsStart, 'expected diff helper section end');
    const parserSection = toolDiffSource.slice(statsStart, parserEnd);
    const viewStart = toolDiffSource.indexOf('export function buildToolDiffView', parserEnd);
    assert.ok(viewStart >= 0, 'expected buildToolDiffView helper');
    const viewSection = toolDiffSource.slice(viewStart);

	    assert.match(parserSection, /function\s+forEachUnifiedDiffLine\(/);
		    assert.match(parserSection, /function\s+collectUnifiedDiffPrefix\(/);
		    assert.match(parserSection, /const TRUNCATED_DIFF_MARKER = '\.\.\. \[TRUNCATED\]';/);
		    assert.match(parserSection, /const index = raw\.lastIndexOf\(TRUNCATED_DIFF_MARKER\);/);
		    assert.doesNotMatch(parserSection, /raw\.includes\(TRUNCATED_DIFF_MARKER\)/);
		    assert.ok(
	      parserSection.includes('const UNIFIED_DIFF_HUNK_HEADER_RE = /^@@\\s*-(\\d+)(?:,(\\d+))?\\s+\\+(\\d+)(?:,(\\d+))?\\s+@@/;'),
	      'expected hunk header regex to be hoisted out of the per-line parser callback'
	    );
	    assert.match(parserSection, /charCodeAt\(i\) !== 10/);
	    assert.doesNotMatch(parserSection, /const lines: string\[\] = \[\];/);
	    assert.doesNotMatch(parserSection, /lines\.push/);
	    assert.doesNotMatch(parserSection, /lines\.join/);
	    assert.doesNotMatch(parserSection, /\.split\(/);
	    assert.match(viewSection, /forEachUnifiedDiffLine\(cleaned,/);
	    assert.match(viewSection, /const headerMatch = UNIFIED_DIFF_HUNK_HEADER_RE\.exec\(rawLine\);/);
	    assert.doesNotMatch(viewSection, /rawLine\.match\(\s*\/\^@@/);
	    assert.doesNotMatch(viewSection, /\.split\(/);
  });

  test('diff content URI helpers scan path segments without split arrays', () => {
    const diffProviderSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/diffContentProvider.ts'), 'utf8');
    const parseStart = diffProviderSource.indexOf('export function parseLingyunDiffUri');
    assert.ok(parseStart >= 0, 'expected diff URI parser helper');
    const providerStart = diffProviderSource.indexOf('export class LingyunDiffContentProvider', parseStart);
    assert.ok(providerStart > parseStart, 'expected content provider after parser');
    const parseSection = diffProviderSource.slice(parseStart, providerStart);
    const sanitizeStart = diffProviderSource.indexOf('function sanitizeFileName');
    assert.ok(sanitizeStart > providerStart, 'expected filename sanitizer after provider');
    const sanitizeSection = diffProviderSource.slice(sanitizeStart);

    assert.match(parseSection, /while \(index < path\.length && path\.charCodeAt\(index\) === 47\) index\+\+;/);
    assert.match(parseSection, /decodeURIComponent\(path\.slice\(toolCallIdStart, index\)\)/);
    assert.match(sanitizeSection, /for \(let i = raw\.length - 1; i >= 0; i--\)/);
    assert.match(sanitizeSection, /code === 47 \|\| code === 92/);
    assert.doesNotMatch(parseSection + sanitizeSection, /\.split\(/);
    assert.doesNotMatch(parseSection, /\.filter\(/);
  });

  test('external memory context tags scan without normalized tag arrays', () => {
    const lifecycleSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/toolLifecycleCallbacks.ts'), 'utf8');
    const tagStart = lifecycleSource.indexOf('function hasExternalMemoryContextTag');
    assert.ok(tagStart >= 0, 'expected external memory tag helper');
    const sourceStart = lifecycleSource.indexOf('function externalMemoryContextSource', tagStart);
    assert.ok(sourceStart > tagStart, 'expected external context source helper after tag helper');
    const tagSection = lifecycleSource.slice(tagStart, sourceStart);
    const sourceEnd = lifecycleSource.indexOf('function isMemoryScaffoldingToolResult', sourceStart);
    assert.ok(sourceEnd > sourceStart, 'expected memory scaffolding helper after context source helper');
    const sourceSection = lifecycleSource.slice(sourceStart, sourceEnd);

    assert.match(tagSection, /if \(!Array\.isArray\(tags\)\) return false;/);
    assert.match(tagSection, /for \(const tag of tags\)/);
    assert.match(tagSection, /String\(tag \|\| ''\)\.toLowerCase\(\)/);
    assert.match(sourceSection, /hasExternalMemoryContextTag\(def\.metadata\?\.tags\)/);
    assert.doesNotMatch(sourceSection, /\.map\(/);
    assert.doesNotMatch(sourceSection, /tags\.some/);
  });

  test('tool file result previews scan without allocating full result arrays', () => {
    const lifecycleSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/runner/toolLifecycleCallbacks.ts'), 'utf8');
    const helperStart = lifecycleSource.indexOf('function collectResultFilePreview');
    assert.ok(helperStart >= 0, 'expected bounded file preview helper');
    const resultStart = lifecycleSource.indexOf('function recordToolResultFileTouches', helperStart);
    assert.ok(resultStart > helperStart, 'expected tool result file touch helper');
    const resultEnd = lifecycleSource.indexOf('function stageToolDiffResult', resultStart);
    assert.ok(resultEnd > resultStart, 'expected end of file preview result section');
    const previewSection = lifecycleSource.slice(helperStart, resultEnd);

    assert.match(previewSection, /charCodeAt\(i\) !== 10/);
    assert.match(previewSection, /collectResultFilePreview\(resultStr,\s*previewCount\)/);
    assert.doesNotMatch(previewSection, /\.split\(/);
  });

  test('session persistence loaders scan restored queues without filter map chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.persistence.ts'), 'utf8');
    const helperSection = (startPattern: string, endPattern: string) => {
      const start = source.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = source.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return source.slice(start, end);
    };

    const queuedSection = helperSection('function normalizeLoadedQueuedInputs', 'function normalizeLoadedPendingInputs');
    const pendingSection = helperSection('function normalizeLoadedPendingInputs', 'function normalizeLoadedCompactionSyntheticContexts');
    const compactionSection = helperSection('function normalizeLoadedCompactionSyntheticContexts', 'export function createChatSessionPersistenceService');
    const previewSection = helperSection('function deriveFirstUserMessagePreview', 'function normalizeLoadedQueuedInputs');
    const loadedSessionSection = helperSection('normalizeLoadedSession(this: ChatSessionPersistenceRuntime', 'normalizeLoadedAgentState');
    const loadedAgentSection = helperSection('normalizeLoadedAgentState(this: ChatSessionPersistenceRuntime', 'recoverInterruptedSessions');

    assert.match(queuedSection, /const maxQueuedInputs = Math\.min\(raw\.length, 50\);/);
    assert.match(queuedSection, /const normalized: NonNullable<ChatSessionInfo\['queuedInputs'\]> = new Array\(maxQueuedInputs\);/);
    assert.match(queuedSection, /let writeIndex = maxQueuedInputs;/);
    assert.match(queuedSection, /for \(let i = raw\.length - 1; i >= 0 && count < maxQueuedInputs; i--\)/);
    assert.match(queuedSection, /normalized\[writeIndex\] = \{/);
    assert.match(queuedSection, /if \(writeIndex === 0\) return normalized;/);
    assert.match(queuedSection, /const compacted: NonNullable<ChatSessionInfo\['queuedInputs'\]> = new Array\(count\);/);
    assert.match(pendingSection, /for \(const input of raw\)/);
    assert.match(pendingSection, /parseUserHistoryInput\(input\)/);
    assert.match(pendingSection, /pendingInputs\.push\(normalized\);/);
    assert.match(compactionSection, /for \(const context of raw\)/);
    assert.match(compactionSection, /contexts\.push\(\{ transientContext, text: value\.text \}\);/);
    assert.match(previewSection, /for \(const message of messages\)/);
    assert.match(previewSection, /return createSessionPreview\(message\.content \|\| ''\);/);
    assert.match(loadedSessionSection, /const queuedInputs = normalizeLoadedQueuedInputs\(\(raw as any\)\.queuedInputs, now\);/);
    assert.match(loadedAgentSection, /normalizeLoadedPendingInputs\(\(state as any\)\.pendingInputs\)/);
    assert.match(loadedAgentSection, /normalizeLoadedCompactionSyntheticContexts\(\(state as any\)\.compactionSyntheticContexts\)/);
    assert.match(loadedAgentSection, /let historyIsValid = true;/);
    assert.match(loadedAgentSection, /for \(const msg of rawHistory\)/);
    assert.match(loadedAgentSection, /const loadedState: AgentSessionState = \{/);
    assert.match(loadedAgentSection, /if \(systemPromptSnapshot\) loadedState\.systemPromptSnapshot = systemPromptSnapshot;/);
    assert.match(loadedAgentSection, /if \(pendingInputs\) loadedState\.pendingInputs = pendingInputs;/);
    assert.match(loadedAgentSection, /return loadedState;/);
    assert.doesNotMatch(queuedSection + pendingSection + compactionSection, /\.filter\(/);
    assert.doesNotMatch(queuedSection + pendingSection + compactionSection, /\.map\(/);
    assert.doesNotMatch(previewSection, /\.find\(/);
    assert.doesNotMatch(loadedAgentSection, /\.every\(/);
    assert.doesNotMatch(loadedAgentSection, /\.\.\.\(systemPromptSnapshot/);
    assert.doesNotMatch(loadedAgentSection, /\.\.\.\(pendingInputs/);
    assert.doesNotMatch(loadedAgentSection, /\.\.\.\(mentionedSkills/);
    assert.doesNotMatch(loadedAgentSection, /\.\.\.\(compactionSyntheticContexts/);
    assert.doesNotMatch(queuedSection, /\.slice\(-50\)/);
    assert.doesNotMatch(queuedSection, /\.reverse\(\)/);
    assert.doesNotMatch(queuedSection, /newest\.push/);
  });

  test('session persistence sanitizers scan nested storage values without entry arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.persistence.ts'), 'utf8');
    const helperSection = (startPattern: string, endPattern: string) => {
      const start = source.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = source.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return source.slice(start, end);
    };

    const genericSection = helperSection('function sanitizeGenericStorageValue', 'function sanitizeToolArgValue');
    const argSection = helperSection('function sanitizeToolArgValue', 'function sanitizeToolArgsForStorage');
    const batchFilesSection = helperSection('function sanitizeBatchFilesForStorage', 'function sanitizeToolCallForStorage');
    const toolCallSection = helperSection('function sanitizeToolCallForStorage', 'function sanitizeMessageForStorage');
    const messagesSection = helperSection('function sanitizeMessagesForStorage', 'export function sanitizeSessionForStorage');
    const sessionSection = helperSection('export function sanitizeSessionForStorage', 'function deriveFirstUserMessagePreview');
    const sanitizerSections = genericSection + argSection + batchFilesSection + toolCallSection + messagesSection + sessionSection;

    assert.match(genericSection, /sanitizeGenericStorageValue\(value\[i\], depth \+ 1\)/);
    assert.match(argSection, /sanitizeToolArgValue\('', value\[i\], depth \+ 1\)/);
    assert.match(sanitizerSections, /const out = new Array<unknown>\(value\.length\);/);
    assert.match(sanitizerSections, /for \(let i = 0; i < value\.length; i\+\+\)/);
    assert.match(batchFilesSection, /const sanitized = new Array<string>\(batchFiles\.length\);/);
    assert.match(batchFilesSection, /for \(let i = 0; i < batchFiles\.length; i\+\+\)/);
    assert.match(toolCallSection, /batchFiles: sanitizeBatchFilesForStorage\(toolCall\.batchFiles\)/);
    assert.match(messagesSection, /const sanitized = new Array<ChatMessage>\(messages\.length\);/);
    assert.match(messagesSection, /for \(let i = 0; i < messages\.length; i\+\+\)/);
    assert.match(sessionSection, /messages: sanitizeMessagesForStorage\(session\.messages\)/);
    assert.match(sanitizerSections, /Object\.prototype\.hasOwnProperty\.call\(record,/);
    assert.doesNotMatch(sanitizerSections, /Object\.entries/);
    assert.doesNotMatch(sanitizerSections, /\.map\(/);
    assert.doesNotMatch(sanitizerSections, /\.filter\(/);
  });

  test('session store save consumes iterables without snapshot filter chains', () => {
    const storeSource = fs.readFileSync(path.resolve(__dirname, '../../../src/core/sessionStore.ts'), 'utf8');
    const persistenceSource = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.persistence.ts'), 'utf8');
    const helperSection = (source: string, startPattern: string, endPattern: string) => {
      const start = source.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = source.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return source.slice(start, end);
    };

    const saveSection = helperSection(storeSource, 'async save(params:', 'async clear()');
    const flushSection = helperSection(persistenceSource, 'async flushSessionSave', 'normalizeLoadedSession');

    assert.match(storeSource, /order: Iterable<string>;/);
    assert.match(storeSource, /function sessionsIndexEquals\(a: SessionsIndex \| undefined, b: SessionsIndex\): boolean/);
    assert.match(saveSection, /for \(const id of params\.order\)/);
    assert.match(saveSection, /const prunedOrder: string\[\] = \[\];/);
    assert.match(saveSection, /for \(let i = firstPrunedIndex; i < order\.length; i\+\+\)/);
    assert.match(saveSection, /for \(const id of params\.dirtySessionIds\)/);
    assert.match(saveSection, /const removedIds = new Set<string>\(\);/);
    assert.match(saveSection, /if \(dirtyToWrite\.length === 0 && sessionsIndexEquals\(previousIndex, index\)\) return;/);
    assert.match(flushSection, /const dirtyIds = this\.dirtySessionIds;/);
    assert.match(flushSection, /this\.dirtySessionIds = new Set<string>\(\);/);
    assert.match(flushSection, /const sessionIdsToPersist =/);
    assert.match(flushSection, /collectSessionIdsToKeep\(this\.sessions, maxSessions, this\.activeSessionId\)/);
    assert.match(flushSection, /order: sessionIdsToPersist,/);
    assert.doesNotMatch(saveSection, /params\.order\.find/);
    assert.doesNotMatch(saveSection, /\.filter\(/);
    assert.doesNotMatch(saveSection, /\.slice\(/);
    assert.doesNotMatch(saveSection, /\[\.\.\.params\.dirtySessionIds\]/);
    assert.doesNotMatch(flushSection, /\[\.\.\.this\.dirtySessionIds\]/);
    assert.doesNotMatch(flushSection, /\[\.\.\.this\.sessions\.keys\(\)\]/);
  });

  test('session recovery scans interrupted messages without copy reverse chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.persistence.ts'), 'utf8');
    const helperStart = source.indexOf('function findLatestInterruptedSessionMessages');
    assert.ok(helperStart >= 0, 'expected interrupted session message helper');
    const helperEnd = source.indexOf('function normalizeStorageKey', helperStart);
    assert.ok(helperEnd > helperStart, 'expected storage key normalizer after interrupted session helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const recoverStart = source.indexOf('recoverInterruptedSessions(this: ChatSessionPersistenceRuntime)');
    assert.ok(recoverStart >= 0, 'expected interrupted session recovery helper');
    const recoverEnd = source.indexOf('async ensureSessionsLoaded', recoverStart);
    assert.ok(recoverEnd > recoverStart, 'expected session loading helper after interrupted recovery');
    const recoverSection = source.slice(recoverStart, recoverEnd);

    assert.match(helperSection, /for \(let i = messages\.length - 1; i >= 0; i--\)/);
    assert.match(helperSection, /message\?\.role === 'step' && message\.step\?\.status === 'running'/);
    assert.match(helperSection, /message\?\.role === 'tool'/);
    assert.match(helperSection, /message\.toolCall\?\.status === 'running' \|\| message\.toolCall\?\.status === 'pending'/);
    assert.match(helperSection, /if \(lastRunningStep && lastTool\) break;/);
    assert.match(recoverSection, /findLatestInterruptedSessionMessages\(session\.messages\)/);
    assert.doesNotMatch(recoverSection, /\[\.\.\.session\.messages\]/);
    assert.doesNotMatch(recoverSection, /\.reverse\(\)/);
  });

  test('session in-memory pruning uses a bounded recency heap without full id snapshots', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.sessions.persistence.ts'), 'utf8');
    const helperStart = source.indexOf('function collectSessionIdsToKeep');
    assert.ok(helperStart >= 0, 'expected bounded session keep-set helper');
    const helperEnd = source.indexOf('function normalizeStorageKey', helperStart);
    assert.ok(helperEnd > helperStart, 'expected storage key normalizer after keep-set helper');
    const helperSection = source.slice(helperStart, helperEnd);
    const pruneStart = source.indexOf('pruneSessionsInMemory(this: ChatSessionPersistenceRuntime');
    assert.ok(pruneStart >= 0, 'expected in-memory session pruning helper');
    const pruneEnd = source.indexOf('async flushSessionSave', pruneStart);
    assert.ok(pruneEnd > pruneStart, 'expected flush session save after pruning helper');
    const pruneSection = source.slice(pruneStart, pruneEnd);

    assert.match(helperSection, /const candidateLimit = Math\.max\(0, limit - \(activeExists \? 1 : 0\)\);/);
    assert.match(helperSection, /const recent: SessionRecencyCandidate\[\] = \[\];/);
    assert.match(helperSection, /const siftUp = \(candidate: SessionRecencyCandidate\): void =>/);
    assert.match(helperSection, /const siftDown = \(\): void =>/);
    assert.match(helperSection, /if \(recent\.length < candidateLimit\)/);
    assert.match(helperSection, /if \(compareCandidates\(candidate, recent\[0\]\) <= 0\) continue;/);
    assert.match(helperSection, /recent\.sort\(compareCandidates\);/);
    assert.match(pruneSection, /collectSessionIdsToKeep\(this\.sessions, maxSessions, this\.activeSessionId\)/);
    assert.match(pruneSection, /for \(const \[id, session\] of this\.sessions\)/);
    assert.doesNotMatch(pruneSection, /\[\.\.\.this\.sessions\.keys\(\)\]/);
    assert.doesNotMatch(pruneSection, /\.slice\(-maxSessions\)/);
    assert.doesNotMatch(pruneSection, /keep\.includes/);
  });

  test('model picker backend buckets avoid filter map chains and sort without copy', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.models.ts'), 'utf8');
    const helperSection = (startPattern: string, endPattern: string) => {
      const start = source.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = source.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return source.slice(start, end);
    };

    const pickerHelpers = helperSection('function collectUniqueModels', 'async function withTimeout');
    const storedIdsSection = helperSection('function normalizeStoredModelIds', 'function createCustomModelInfo');
    const sortSection = helperSection('function sortModelsForPickerInPlace', 'function getUniqueModelPickerModels');
    const loadSection = helperSection('async loadModels', 'async getFavoriteModelIds');
    const favoriteIdsSection = helperSection('async getFavoriteModelIds', 'async getRecentModelIds');
    const recentIdsSection = helperSection('async getRecentModelIds', 'async getModelPickerStateForUI');
    const pickerStateSection = helperSection('async getModelPickerStateForUI', 'async clearRecentModels');
    const clearRecentSection = helperSection('async clearRecentModels', 'async refreshModelsForUI');
    const recentSection = helperSection('async recordRecentModel', 'async toggleFavoriteModel');
    const favoriteSection = helperSection('async toggleFavoriteModel', 'async setCurrentModel');
    const setCurrentSection = helperSection('async setCurrentModel', 'async setReasoningEffort');
    const reasoningSection = helperSection('async setReasoningEffort', 'async openAdvancedModelSettings');
    const favoriteCheckSection = helperSection('async isModelFavorite', 'getModelLabel');
    const modelLabelSection = helperSection('getModelLabel(this: ChatModelsDeps', 'async postModelState');

    assert.match(storedIdsSection, /const normalizedIds: string\[\] = \[\];/);
    assert.match(storedIdsSection, /const seen = new Set<string>\(\);/);
    assert.match(storedIdsSection, /for \(const id of ids\)/);
    assert.match(storedIdsSection, /const normalized = normalizeModelId\(id\);/);
    assert.match(storedIdsSection, /seen\.has\(normalized\)/);
    assert.match(source, /const MODEL_PICKER_NAME_COLLATOR = new Intl\.Collator\(undefined, \{ sensitivity: 'base' \}\);/);
    assert.match(sortSection, /models\.sort\(\(a, b\) => MODEL_PICKER_NAME_COLLATOR\.compare\(a\.name \|\| a\.id, b\.name \|\| b\.id\)\);/);
    assert.doesNotMatch(sortSection, /localeCompare/);
    assert.match(pickerHelpers, /const seen = new Set<string>\(\);/);
    assert.match(pickerHelpers, /let hasCurrentModel = false;/);
    assert.match(pickerHelpers, /for \(const model of availableModels\)/);
    assert.match(pickerHelpers, /if \(model\.id === currentId\) hasCurrentModel = true;/);
    assert.match(pickerHelpers, /if \(!uniqueModels\.hasCurrentModel\) \{/);
    assert.match(loadSection, /const uniqueModels = collectUniqueModels\(this\.availableModels, this\.currentModel\);/);
    assert.match(loadSection, /if \(uniqueModels\.hasCurrentModel\) \{/);
    assert.match(loadSection, /const models = new Array<ModelInfo>\(uniqueModels\.models\.length \+ 1\);/);
    assert.match(loadSection, /models\[0\] = createCustomModelInfo\(this\.currentModel\);/);
    assert.match(pickerHelpers, /function buildModelLookup\(models: ModelInfo\[\]\): Map<string, ModelInfo>/);
    assert.match(pickerHelpers, /for \(const model of models\)/);
    assert.match(pickerHelpers, /function collectFavoriteModels/);
    assert.match(pickerHelpers, /if \(favoriteSet\.has\(id\)\) continue;/);
    assert.match(pickerHelpers, /function collectRecentModels/);
    assert.match(pickerHelpers, /if \(recentSet\.has\(id\)\) continue;/);
    assert.match(pickerHelpers, /function collectRemainingModels/);
    assert.match(pickerHelpers, /sortModelsForPickerInPlace\(remaining\)/);
    assert.match(pickerHelpers, /function prependStoredModelId/);
    assert.match(pickerHelpers, /function removeStoredModelId/);
    assert.match(pickerHelpers, /function storedModelIdsEqual/);
    assert.match(pickerHelpers, /function storedModelIdsContain\(ids: string\[\], id: string\): boolean/);
    assert.match(favoriteIdsSection, /return normalizeStoredModelIds\(this\.context\.globalState\.get<string\[\]>\(favoritesStorageKey\(this\)\)\);/);
    assert.match(recentIdsSection, /return normalizeStoredModelIds\(this\.context\.globalState\.get<string\[\]>\(recentsStorageKey\(this\)\)\);/);
    assert.match(pickerStateSection, /const models = getUniqueModelPickerModels\(this\.availableModels, currentId\);/);
    assert.match(pickerStateSection, /const byId = buildModelLookup\(models\);/);
    assert.match(pickerStateSection, /const favorites = collectFavoriteModels\(favoriteIds, byId, favoriteSet\);/);
    assert.match(pickerStateSection, /const recent = collectRecentModels\(recentIds, byId, favoriteSet, recentSet\);/);
    assert.match(pickerStateSection, /const all = collectRemainingModels\(models, favoriteSet, recentSet\);/);
    assert.match(clearRecentSection, /const existing = await service\.getRecentModelIds\(\);/);
    assert.match(clearRecentSection, /if \(existing\.length > 0\) \{/);
    assert.match(clearRecentSection, /await this\.context\.globalState\.update\(recentsStorageKey\(this\), \[\]\);/);
    assert.match(clearRecentSection, /await service\.postModelPickerState\(true\);/);
    assert.match(recentSection, /prependStoredModelId\(id, existing, MAX_RECENT_MODELS\)/);
    assert.match(recentSection, /if \(storedModelIdsEqual\(existing, next\)\) return;/);
    assert.match(favoriteSection, /removeStoredModelId\(id, existing\)/);
    assert.match(favoriteSection, /prependStoredModelId\(id, existing\)/);
    assert.match(favoriteSection, /const isFavorite = storedModelIdsContain\(existing, id\);/);
    assert.match(favoriteCheckSection, /return storedModelIdsContain\(favorites, id\);/);
    assert.match(modelLabelSection, /for \(const model of this\.availableModels\)/);
    assert.match(modelLabelSection, /if \(model\?\.id === id\) return model\.name \|\| id;/);
    assert.match(setCurrentSection, /if \(id === this\.currentModel\) \{/);
    assert.match(setCurrentSection, /await service\.postModelState\(\);/);
    assert.match(setCurrentSection, /return;/);
    assert.match(reasoningSection, /if \(normalized === getConfiguredReasoningEffort\(\)\) \{/);
    assert.match(reasoningSection, /await service\.postModelState\(\);/);
    assert.match(reasoningSection, /return;/);
    const scannedSections =
      storedIdsSection +
      sortSection +
      pickerHelpers +
      loadSection +
      favoriteIdsSection +
      recentIdsSection +
      pickerStateSection +
      clearRecentSection +
      recentSection +
      favoriteSection +
      setCurrentSection +
      reasoningSection +
      favoriteCheckSection +
      modelLabelSection;
    assert.doesNotMatch(scannedSections, /\.filter\(/);
    assert.doesNotMatch(scannedSections, /\.map\(/);
    assert.doesNotMatch(pickerHelpers, /\.some\(/);
    assert.doesNotMatch(loadSection, /\.some\(/);
    assert.doesNotMatch(favoriteCheckSection + favoriteSection, /\.includes\(/);
    assert.doesNotMatch(modelLabelSection, /\.find\(/);
    assert.doesNotMatch(loadSection, /\.\.\.this\.availableModels/);
    assert.doesNotMatch(source, /function uniqById/);
    assert.doesNotMatch(sortSection + pickerHelpers, /\.slice\(\)/);
    assert.doesNotMatch(recentSection, /\.slice\(0, MAX_RECENT_MODELS\)/);
  });

  test('revert service scans message ranges without slice filter chains', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/ui/chat/methods.revert.ts'), 'utf8');
    const sourceSection = (startPattern: string, endPattern: string) => {
      const start = source.indexOf(startPattern);
      assert.ok(start >= 0, 'expected ' + startPattern);
      const end = source.indexOf(endPattern, start + startPattern.length);
      assert.ok(end > start, 'expected ' + endPattern + ' after ' + startPattern);
      return source.slice(start, end);
    };

    const helpersSection = sourceSection('function hasUserMessageBefore', 'export interface ChatRevertService');
    const availabilitySection = sourceSection(
      'getUndoRedoAvailability(this: ChatRevertRuntime)',
      'getRevertBarStateForUI'
    );
    const barSection = sourceSection('getRevertBarStateForUI(this: ChatRevertRuntime)', 'postRevertBarState');
    const patchesSection = sourceSection(
      'collectPatchesFromIndex(this: ChatRevertRuntime',
      'deriveAgentStateBeforeUserMessage'
    );
    const deriveSection = sourceSection(
      'deriveAgentStateBeforeUserMessage(\n    this: ChatRevertRuntime',
      'async applyRevert'
    );
    const scannedSections = availabilitySection + barSection + patchesSection + deriveSection;

    assert.match(helpersSection, /function countUserMessagesInRange/);
    assert.match(helpersSection, /function findMessageIndexById\(messages: ChatMessage\[\], messageId: string \| undefined\): number/);
    assert.match(helpersSection, /for \(let i = 0; i < messages\.length; i\+\+\)/);
    assert.match(helpersSection, /if \(messages\[i\]\?\.id === messageId\) return i;/);
    assert.match(helpersSection, /function findNthUserHistoryIndex/);
    assert.match(availabilitySection, /findMessageIndexById\(this\.messages, boundaryId\)/);
    assert.match(availabilitySection, /hasUserMessageBefore\(this\.messages, boundaryIndex\)/);
    assert.match(barSection, /findMessageIndexById\(this\.messages, boundaryId\)/);
    assert.match(barSection, /countUserMessagesInRange\(this\.messages, boundaryIndex, this\.messages\.length\)/);
    assert.match(patchesSection, /for \(let i = start; i < this\.messages\.length; i\+\+\)/);
    assert.match(deriveSection, /findNthUserHistoryIndex\(baseline\.history, chatUserCount\)/);
    assert.doesNotMatch(source, /\.findIndex\(/);
    assert.doesNotMatch(scannedSections, /\.filter\(/);
    assert.doesNotMatch(scannedSections, /\.some\(/);
    assert.doesNotMatch(patchesSection, /this\.messages\.slice/);
    assert.doesNotMatch(deriveSection, /userIndices/);
  });
});
