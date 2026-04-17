import { createChatApprovalsService } from './methods.approvals';
import { createChatInputHistoryService } from './methods.inputHistory';
import { createChatLoopService } from './methods.loop';
import { createChatModeService } from './methods.mode';
import { createChatModelsService } from './methods.models';
import { createChatRevertServiceForController } from './methods.revert';
import { createChatRunnerCallbacksServiceForController } from './methods.runner.callbacks';
import { createChatRunnerInputService } from './methods.runner.input';
import { createChatRunnerPlanService } from './methods.runner.plan';
import { createChatSessionsServiceForController } from './methods.sessions';
import { createChatSkillsService } from './methods.skills';
import { createChatWebviewServiceForController } from './methods.webview';
import type { ChatController } from './controller';
import { createChatLoopManager } from './loopManager';
import { createChatQueueManager } from './queueManager';
import { createRunCoordinatorForController } from './runner/runCoordinatorControllerAdapter';

export function installChatControllerComposition(controller: ChatController): void {
  if (controller.approvalsApi) return;

  controller.approvalsApi = createChatApprovalsService(controller);
  controller.inputHistoryApi = createChatInputHistoryService(controller);
  controller.skillsApi = createChatSkillsService(controller);
  controller.sessionApi = createChatSessionsServiceForController(controller);
  controller.modeApi = createChatModeService(controller);
  controller.modelApi = createChatModelsService(controller);
  controller.revertApi = createChatRevertServiceForController(controller);
  controller.runnerCallbacksApi = createChatRunnerCallbacksServiceForController(controller);
  controller.loopApi = createChatLoopService(controller);
  controller.runnerInputApi = createChatRunnerInputService(controller);
  controller.runnerPlanApi = createChatRunnerPlanService(controller);

  controller.queueManager = createChatQueueManager(controller);
  controller.loopManager = createChatLoopManager(controller);
  controller.runner = createRunCoordinatorForController(controller);
  controller.webviewApi = createChatWebviewServiceForController(controller);
}
