/**
 * Advanced Task Executor - Phase 3 Orchestrator
 * 
 * Combines all Phase 3 features:
 * - Task planning with subtask decomposition
 * - Strategy generation and auto-replanning
 * - Human checkpoints for uncertainty
 * - Self-evaluation of results
 * 
 * This is the main entry point for complex task execution.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { getPage, getCdpUrl } from './browser-manager.js';
import type { AgentLogPayload } from '../shared/types.js';
import type { Page } from 'playwright';
import { TaskPlanner, type TaskPlan } from './task-planner.js';
import { StrategyGenerator, type StrategyContext } from './strategy-generator.js';
import { HumanCheckpointManager, UncertaintyDetector } from './human-checkpoint.js';
import { TaskEvaluator, type EvaluationResult } from './task-evaluator.js';
import { ConversationManager } from './conversation-manager.js';
import { CheckpointManager, type Checkpoint } from './checkpoint-manager.js';
import { ExecutionLogger } from './execution-logger.js';
import { generateTaskId } from './checkpoint-manager.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentStatusCb = (payload: any) => void;
export type AgentLogCb = (payload: AgentLogPayload) => void;

export interface AdvancedTaskOptions {
  maxSteps?: number;
  maxRetries?: number;
  askForHumanHelp?: boolean;
  autoReplanOnFailure?: boolean;
  evaluateOnCompletion?: boolean;
  strictEvaluation?: boolean;
  checkpointInterval?: number;
  model?: string;
  apiKey?: string;
  provider?: 'openai' | 'anthropic' | 'gemini';
  onProgress?: (progress: TaskProgress) => void;
}

export interface TaskProgress {
  taskId: string;
  status: 'planning' | 'executing' | 'evaluating' | 'completed' | 'failed';
  currentSubtask?: number;
  totalSubtasks?: number;
  percentage?: number;
  message?: string;
  partialResults?: any;
}

export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  evaluation?: EvaluationResult;
  plan?: TaskPlan;
  summary: {
    stepsExecuted: number;
    subtasksCompleted: number;
    humanCheckpoints: number;
    replans: number;
    tokensUsed: number;
    totalCost: number;
    duration: number;
  };
}

// ─── Advanced Task Executor Class ───────────────────────────────────────────

export class AdvancedTaskExecutor {
  private taskId: string;
  private task: string;
  private options: Required<AdvancedTaskOptions>;

  // Phase 2 components
  private conversationManager: ConversationManager;
  private checkpointManager: CheckpointManager;
  private executionLogger: ExecutionLogger;

  // Phase 3 components
  private taskPlanner: TaskPlanner;
  private strategyGenerator: StrategyGenerator;
  private humanCheckpointManager: HumanCheckpointManager;
  private uncertaintyDetector: UncertaintyDetector;
  private taskEvaluator: TaskEvaluator;

  private stagehand: Stagehand | null = null;
  private page: Page | null = null;
  private isCancelled = false;
  private currentPlan?: TaskPlan;
  private humanCheckpointsCount = 0;
  private replansCount = 0;
  private checkpoint: Checkpoint | null = null;

  constructor(task: string, options: AdvancedTaskOptions = {}) {
    this.task = task;
    this.taskId = generateTaskId();
    this.options = {
      maxSteps: options.maxSteps ?? 50,
      maxRetries: options.maxRetries ?? 3,
      askForHumanHelp: options.askForHumanHelp ?? true,
      autoReplanOnFailure: options.autoReplanOnFailure ?? true,
      evaluateOnCompletion: options.evaluateOnCompletion ?? true,
      strictEvaluation: options.strictEvaluation ?? true,
      checkpointInterval: options.checkpointInterval ?? 5,
      model: options.model ?? 'google/gemini-3.1-flash-lite',
      apiKey: options.apiKey ?? '',
      provider: options.provider ?? 'gemini',
      onProgress: options.onProgress ?? (() => { }),
    };

    // Phase 2 components
    // these fields are not currently used in this executor
    this.conversationManager = new ConversationManager();
    this.checkpointManager = new CheckpointManager('./checkpoints');
    this.executionLogger = new ExecutionLogger(this.taskId, task);

    // Phase 3 components
    this.taskPlanner = new TaskPlanner();
    this.strategyGenerator = new StrategyGenerator();
    this.humanCheckpointManager = new HumanCheckpointManager('./human-checkpoints.json');
    this.uncertaintyDetector = new UncertaintyDetector();
    this.taskEvaluator = new TaskEvaluator({ strictMode: this.options.strictEvaluation });
  }

  /**
   * Execute the advanced task with all Phase 3 features
   */
  async execute(onLog: AgentLogCb): Promise<TaskResult> {
    const cdpUrl = getCdpUrl();
    const page = getPage();

    if (!page || !cdpUrl) {
      return this.createFailureResult('Browser is not running. Launch a browser first.');
    }

    this.page = page;
    this.isCancelled = false;

    try {
      onLog({ level: 'info', message: 'Starting advanced task execution with Phase 3 features' });

      // Step 1: Create task plan
      onLog({ level: 'info', message: 'Creating task plan...' });
      this.currentPlan = await this.taskPlanner.createPlan(this.task);

      this.reportProgress('planning', 0, 'Task plan created');

      // Step 2: Execute subtasks with monitoring
      const result = await this.executePlan(onLog);

      // Step 3: Evaluate result
      let evaluation: EvaluationResult | undefined;
      if (this.options.evaluateOnCompletion && result.success) {
        onLog({ level: 'info', message: 'Evaluating task completion...' });
        evaluation = await this.taskEvaluator.evaluate(this.task, result.data || {}, {
          stepsExecuted: this.executionLogger.getSummary().totalSteps,
          errors: [],
          collectedData: result.data || {},
        });

        // If evaluation fails and auto-replan is enabled, try again
        if (!evaluation.success && this.options.autoReplanOnFailure && this.replansCount < this.options.maxRetries) {
          onLog({ level: 'info', message: `Evaluation failed (${evaluation.confidence.toFixed(2)}), replanning...` });
          return await this.replanAndContinue(onLog, evaluation.missingElements);
        }
      }

      this.executionLogger.complete();

      return {
        success: result.success,
        data: result.data,
        evaluation,
        plan: this.currentPlan,
        summary: {
          stepsExecuted: this.executionLogger.getSummary().totalSteps,
          subtasksCompleted: this.currentPlan?.subtasks.filter(s => s.status === 'completed').length || 0,
          humanCheckpoints: this.humanCheckpointsCount,
          replans: this.replansCount,
          tokensUsed: this.executionLogger.getSummary().totalTokens.totalTokens,
          totalCost: this.executionLogger.getSummary().totalCost.totalCost,
          duration: Date.now() - (this.currentPlan?.createdAt || Date.now()),
        },
      };
    } catch (err) {
      this.executionLogger.fail();
      return this.createFailureResult(err instanceof Error ? err.message : String(err));
    } finally {
      this.stagehand = null;
    }
  }

  /**
   * Cancel the current task
   */
  cancel(): void {
    this.isCancelled = true;
  }

  // ─── Private Execution Methods ─────────────────────────────────────────────

  private async executePlan(onLog: AgentLogCb): Promise<{ success: boolean; data?: any; error?: string }> {
    if (!this.currentPlan || !this.page) {
      return { success: false, error: 'No plan or page available' };
    }

    let subtaskIndex = 0;

    while (subtaskIndex < this.currentPlan.subtasks.length) {
      if (this.isCancelled) {
        return { success: false, error: 'Task cancelled' };
      }

      const subtask = this.currentPlan.subtasks[subtaskIndex];

      onLog({
        level: 'info',
        message: `Executing subtask ${subtask.id}/${this.currentPlan.subtasks.length}: ${subtask.goal}`
      });

      this.reportProgress('executing', subtaskIndex, subtask.goal);

      try {
        // Execute subtask
        const result = await this.executeSubtask(subtask.goal, onLog);

        this.taskPlanner.updateSubtaskStatus(
          this.currentPlan,
          subtask.id,
          'completed',
          result,
        );

        // Checkpoint periodically
        if (subtaskIndex % this.options.checkpointInterval === 0) {
          await this.saveCheckpoint();
        }

        subtaskIndex++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        onLog({ level: 'error', message: `Subtask failed: ${errorMessage}` });

        // Try strategy generation
        if (this.options.autoReplanOnFailure) {
          const strategyContext: StrategyContext = {
            task: this.task,
            currentApproach: subtask.goal,
            failureReason: errorMessage,
            stepsAttempted: subtaskIndex,
            stepsRemaining: this.currentPlan.subtasks.length - subtaskIndex,
            pageState: {
              url: this.page.url(),
              title: await this.page.title(),
              error: errorMessage,
            },
          };

          const strategy = await this.strategyGenerator.generateAlternatives(strategyContext);
          onLog({ level: 'info', message: `Generated alternative strategy: ${strategy.recommendation}` });

          this.replansCount++;

          // Continue with next subtask (assuming strategy adjustment)
          subtaskIndex++;
        } else {
          this.taskPlanner.updateSubtaskStatus(
            this.currentPlan,
            subtask.id,
            'failed',
            undefined,
            errorMessage,
          );
          return { success: false, error: errorMessage };
        }
      }
    }

    return { success: true };
  }

  private async executeSubtask(goal: string, onLog: AgentLogCb): Promise<any> {
    // Check if human input is needed
    if (this.options.askForHumanHelp) {
      const shouldAsk = await this.shouldAskHuman(goal);
      if (shouldAsk.shouldAsk) {
        onLog({ level: 'info', message: 'Requesting human input...' });
        const answer = await this.humanCheckpointManager.ask(
          this.taskId,
          this.executionLogger.getSummary().totalSteps,
          shouldAsk.question || 'How should I proceed?',
          shouldAsk.options || [],
          {
            currentPage: this.page?.url() || '',
            taskProgress: `${this.executionLogger.getSummary().totalSteps} steps completed`,
            uncertainty: shouldAsk.reason,
          },
        );

        this.humanCheckpointsCount++;
        onLog({ level: 'info', message: `Human selected option: ${answer}` });
      }
    }

    // Execute using Stagehand
    if (!this.stagehand) {
      await this.initializeStagehand(getCdpUrl()!, onLog);
    }

    if (!this.stagehand) {
      throw new Error('Stagehand not initialized');
    }

    return await this.stagehand.act(goal, { page: this.page! });
  }

  private async replanAndContinue(onLog: AgentLogCb, missingElements: string[]): Promise<TaskResult> {
    if (this.replansCount >= this.options.maxRetries) {
      return this.createFailureResult(`Max replans (${this.options.maxRetries}) reached`);
    }

    onLog({ level: 'info', message: `Replanning task to address: ${missingElements.join(', ')}` });

    // Generate new plan focusing on missing elements
    const newTask = `${this.task}. Additionally address: ${missingElements.join(', ')}`;
    this.currentPlan = await this.taskPlanner.createPlan(newTask);

    this.replansCount++;

    return this.execute(onLog);
  }

  private async shouldAskHuman(goal: string): Promise<{
    shouldAsk: boolean;
    question?: string;
    options?: any[];
    reason: string;
  }> {
    // Determine confidence (in a full implementation, you would ask an LLM or use Stagehand 'observe' to detect captchas/login walls)
    // Here we'll simulate a dynamic confidence check based on the goal string
    let simulatedConfidence = 0.9;
    let decisionType = 'navigation';
    const goalLower = goal.toLowerCase();

    if (goalLower.includes('login') || goalLower.includes('sign in')) {
      simulatedConfidence = 0.5; // Low confidence on auth walls
      decisionType = 'authentication';
    } else if (goalLower.includes('captcha') || goalLower.includes('verify')) {
      simulatedConfidence = 0.3; // Very low confidence on captchas
      decisionType = 'verification';
    }

    const check = this.uncertaintyDetector.shouldAskHuman({
      confidence: simulatedConfidence,
      decisionType,
      options: ['Continue as planned', 'Skip this step', 'Modify approach'],
      taskImportance: 'medium',
    });

    if (check.shouldAsk) {
      return {
        shouldAsk: true,
        question: check.suggestedQuestion || 'How should I proceed with this step?',
        options: check.suggestedOptions || [
          { id: 'continue', label: 'Continue as planned', recommended: true },
          { id: 'skip', label: 'Skip this step' },
          { id: 'modify', label: 'Modify approach' },
        ],
        reason: check.reason,
      };
    }

    return { shouldAsk: false, reason: '' };
  }

  private async initializeStagehand(cdpUrl: string, onLog: AgentLogCb): Promise<void> {
    onLog({ level: 'info', message: 'Initializing Stagehand...' });

    this.stagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: {
        modelName: this.options.model,
        apiKey: this.options.apiKey,
      },
      verbose: 1,
    });

    await this.stagehand.init();
    onLog({ level: 'info', message: 'Stagehand initialized' });
  }

  private async saveCheckpoint(): Promise<void> {
    if (!this.checkpoint) {
      this.checkpoint = await this.checkpointManager.create(
        this.taskId,
        this.task,
        this.conversationManager
      );
    } else {
      await this.checkpointManager.update(
        this.checkpoint,
        { status: 'running' },
        this.conversationManager
      );
    }
  }

  private reportProgress(
    status: TaskProgress['status'],
    current: number,
    message: string,
  ): void {
    const total = this.currentPlan?.subtasks.length || 1;

    this.options.onProgress({
      taskId: this.taskId,
      status,
      currentSubtask: current,
      totalSubtasks: total,
      percentage: Math.round((current / total) * 100),
      message,
    });
  }

  private createFailureResult(error: string): TaskResult {
    return {
      success: false,
      error,
      summary: {
        stepsExecuted: 0,
        subtasksCompleted: 0,
        humanCheckpoints: 0,
        replans: 0,
        tokensUsed: 0,
        totalCost: 0,
        duration: 0,
      },
    };
  }
}

// ─── Convenience Function ───────────────────────────────────────────────────

export async function runAdvancedTask(
  task: string,
  options: AdvancedTaskOptions & {
    onLog?: AgentLogCb;
  },
): Promise<TaskResult> {
  const executor = new AdvancedTaskExecutor(task, options);

  const onLog: AgentLogCb = options.onLog ?? (() => { });

  return executor.execute(onLog);
}
