import { bindChatControllerService } from './controllerService';
import type { RunCoordinator } from './runner/runCoordinator';

export interface ChatRunnerPlanService {
  executePendingPlan(planMessageId?: string): Promise<void>;
  cancelPendingPlan(planMessageId: string): Promise<void>;
  revisePendingPlan(planMessageId: string, instructions: string): Promise<void>;
}

export interface ChatRunnerPlanDeps {
  runner: Pick<RunCoordinator, 'executePendingPlan' | 'cancelPendingPlan' | 'revisePendingPlan'>;
}

export function createChatRunnerPlanService(controller: ChatRunnerPlanDeps): ChatRunnerPlanService {
  return bindChatControllerService(controller, {
    async executePendingPlan(this: ChatRunnerPlanDeps, planMessageId?: string): Promise<void> {
      await this.runner.executePendingPlan(planMessageId);
    },

    async cancelPendingPlan(this: ChatRunnerPlanDeps, planMessageId: string): Promise<void> {
      await this.runner.cancelPendingPlan(planMessageId);
    },

    async revisePendingPlan(this: ChatRunnerPlanDeps, planMessageId: string, instructions: string): Promise<void> {
      await this.runner.revisePendingPlan(planMessageId, instructions);
    },
  });
}
