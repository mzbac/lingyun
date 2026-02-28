import type { ChatController } from './controller';

export function installRunnerPlanMethods(controller: ChatController): void {
  Object.assign(controller, {
    async executePendingPlan(this: ChatController, planMessageId?: string): Promise<void> {
      await this.runner.executePendingPlan(planMessageId);
    },

    async regeneratePendingPlan(this: ChatController, planMessageId: string, reason?: string): Promise<void> {
      await this.runner.regeneratePendingPlan(planMessageId, reason);
    },

    async cancelPendingPlan(this: ChatController, planMessageId: string): Promise<void> {
      await this.runner.cancelPendingPlan(planMessageId);
    },

    async revisePendingPlan(this: ChatController, planMessageId: string, instructions: string): Promise<void> {
      await this.runner.revisePendingPlan(planMessageId, instructions);
    },
  });
}

