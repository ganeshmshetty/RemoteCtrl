/**
 * Complex Task Executor - Phase 2 Implementation
 * 
 * Handles long-running, multi-step tasks with:
 * - Iterative execution loop
 * - Progress tracking and reporting
 * - Checkpointing for recovery
 * - Conversation compaction
 * - Cost tracking
 * 
 * Architecture inspired by Open Browser and Magnitude
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { getPage, getCdpUrl } from './browser-manager.js';
import type { AgentLogPayload } from '../shared/types.js';
import type { Page } from 'playwright';
import { StallDetector } from './stall-detector.js';
import { ConversationManager } from './conversation-manager.js';
import { CheckpointManager, generateTaskId } from './checkpoint-manager.js';
import { ExecutionLogger } from './execution-logger.js';
import {
  AgentStalledError,
  extractError,
} from './errors.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentStatusCb = (payload: any) => void;
export type AgentLogCb = (payload: AgentLogPayload) => void;

export interface ComplexTaskOptions {
  maxSteps?: number;
  checkpointInterval?: number;
  onProgress?: (progress: TaskProgress) => void;
  model?: string;
  apiKey?: string;
  provider?: 'openai' | 'anthropic' | 'gemini';
}

export interface TaskProgress {
  taskId: string;
  step: number;
  status: 'running' | 'paused' | 'completed' | 'failed';
  percentage?: number;
  partialResults?: Record<string, any>;
  tokensUsed?: number;
  cost?: number;
  message?: string;
}

export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  summary: {
    stepsExecuted: number;
    tokensUsed: number;
    totalCost: number;
    duration: number;
  };
}

// ─── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI agent that helps users by controlling a web browser.
You can click, type, navigate, extract data, and observe pages.

Rules:
1. Always think step-by-step before acting
2. If you encounter an error, try a different approach
3. When you've completed the task, use the finish action
4. For long tasks, break them into smaller steps
5. If stuck, try navigating to a different page or using search

Available actions:
- click: Click on an element
- type: Type text into an input
- navigate: Go to a URL
- search: Search the current page
- extract: Extract structured data
- observe: Observe the page and report findings
- finish: Task is complete

Always be specific about which element you're interacting with.`;

// ─── Complex Task Executor Class ────────────────────────────────────────────

export class ComplexTaskExecutor {
  private taskId: string;
  private task: string;
  private options: Required<ComplexTaskOptions>;
  private conversationManager: ConversationManager;
  private checkpointManager: CheckpointManager;
  private executionLogger: ExecutionLogger;
  private stallDetector: StallDetector;

  private stagehand: Stagehand | null = null;
  private page: Page | null = null;
  private isCancelled = false;
  private currentStep = 0;

  constructor(task: string, options: ComplexTaskOptions = {}) {
    this.task = task;
    this.taskId = generateTaskId();
    this.options = {
      maxSteps: options.maxSteps ?? 50,
      checkpointInterval: options.checkpointInterval ?? 5,
      onProgress: options.onProgress ?? (() => { }),
      model: options.model ?? 'google/gemini-3.1-flash-lite',
      apiKey: options.apiKey ?? '',
      provider: options.provider ?? 'gemini',
    };

    this.conversationManager = new ConversationManager({
      systemPrompt: SYSTEM_PROMPT,
    });

    this.checkpointManager = new CheckpointManager('./checkpoints');
    this.executionLogger = new ExecutionLogger(this.taskId, task);
    this.stallDetector = new StallDetector();
  }

  /**
   * Execute the complex task
   */
  async execute(onLog: AgentLogCb): Promise<TaskResult> {
    const cdpUrl = getCdpUrl();
    const page = getPage();

    if (!page || !cdpUrl) {
      return {
        success: false,
        error: 'Browser is not running. Launch a browser first.',
        summary: { stepsExecuted: 0, tokensUsed: 0, totalCost: 0, duration: 0 },
      };
    }

    this.page = page;
    this.isCancelled = false;

    try {
      // Initialize Stagehand
      await this.initializeStagehand(cdpUrl, onLog);

      // Create initial checkpoint
      await this.checkpointManager.create(this.taskId, this.task, this.conversationManager);

      // Main execution loop
      while (this.currentStep < this.options.maxSteps) {
        if (this.isCancelled) {
          return this.createResult(false, undefined, 'Task cancelled');
        }

        // Get current page state
        const pageState = await this.getPageState();

        // Decide next action
        const decision = await this.decideNextAction(pageState);

        // Check if task is complete
        if (decision.isComplete) {
          this.executionLogger.complete();
          return this.createResult(true, decision.data);
        }

        // Execute the action
        const stepResult = await this.executeAction(decision.action, decision.instruction, onLog);

        // Update conversation
        this.conversationManager.addMessage('assistant', decision.instruction, {
          step: this.currentStep,
          action: decision.action,
        });

        // Log the step
        this.executionLogger.log({
          step: this.currentStep,
          action: decision.action,
          instruction: decision.instruction,
          result: stepResult,
          tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
          duration: 0,
          pageState,
        });

        // Checkpoint if needed
        if (this.currentStep % this.options.checkpointInterval === 0) {
          await this.saveCheckpoint();
          this.reportProgress('checkpoint_saved');
        }

        this.currentStep++;
      }

      // Max steps reached
      return this.createResult(false, undefined, `Max steps (${this.options.maxSteps}) reached`);
    } catch (err) {
      const errorInfo = extractError(err);
      this.executionLogger.fail();
      return this.createResult(false, undefined, errorInfo.message);
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

  // ─── Private Methods ───────────────────────────────────────────────────────

  private async initializeStagehand(cdpUrl: string, onLog: AgentLogCb): Promise<void> {
    onLog({ level: 'info', message: 'Initializing Stagehand for complex task...' });

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

  private async getPageState() {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const url = this.page.url();
    const title = await this.page.title();
    const content = await this.page.content();
    const elementCount = await this.page.locator('*').count();

    return {
      url,
      title,
      content,
      elementCount,
    };
  }

  private async decideNextAction(
    pageState: any,
  ): Promise<{
    action: string;
    instruction: string;
    isComplete: boolean;
    data?: any;
  }> {
    if (!this.stagehand || !this.page) {
      throw new Error('Stagehand not initialized');
    }

    // Build prompt for decision
    const prompt = `
Task: ${this.task}
Current URL: ${pageState.url}
Current Page Title: ${pageState.title}

What should I do next? Be specific about which element to interact with.
If the task is complete, respond with "DONE: [summary]"
`;

    // Get decision from LLM via Stagehand
    const messages = this.conversationManager.getMessagesWithinBudget(80000);
    const conversationContext = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    // `fullPrompt` wasn't being used below but it's needed for context, so we'll pass it if needed, or remove it.
    // actually, let's just use `fullPrompt` as the observe argument
    const fullPrompt = `${conversationContext}\n\n${prompt}`;

    try {
      // Use Stagehand's observe to get LLM's assessment
      const observationElements = await this.stagehand.observe({ instruction: fullPrompt } as any);

      // Parse the response
      const response = JSON.stringify(observationElements).toLowerCase();

      if (response.includes('done') || response.includes('complete')) {
        return {
          action: 'finish',
          instruction: 'Task complete',
          isComplete: true,
          data: observationElements,
        };
      }

      // Extract action from observation
      return {
        action: 'act',
        instruction: prompt,
        isComplete: false,
      };
    } catch (err) {
      // Fallback: use Stagehand's act directly
      return {
        action: 'act',
        instruction: this.task,
        isComplete: false,
      };
    }
  }

  private async executeAction(
    action: string,
    instruction: string,
    onLog: AgentLogCb,
  ): Promise<any> {
    if (!this.stagehand || !this.page) {
      throw new Error('Stagehand not initialized');
    }

    onLog({ level: 'info', message: `Step ${this.currentStep}: ${action} - ${instruction}` });

    try {
      let result;

      if (action === 'act') {
        result = await this.stagehand.act(instruction, { page: this.page });
      } else if (action === 'observe') {
        result = await this.stagehand.observe(instruction, { page: this.page });
      } else if (action === 'extract') {
        result = await this.stagehand.extract(instruction, { page: this.page });
      } else {
        throw new Error(`Unknown action: ${action}`);
      }

      // Record for stall detection
      this.stallDetector.recordAction(action, instruction);

      // Check for stalls
      const stallCheck = this.stallDetector.isStuck();
      if (stallCheck.stuck) {
        throw new AgentStalledError(stallCheck.reason);
      }

      return result;
    } catch (err) {
      const errorInfo = extractError(err);
      onLog({ level: 'error', message: `Step failed: ${errorInfo.message}` });
      throw err;
    }
  }

  private async saveCheckpoint(): Promise<void> {
    if (!this.checkpointManager.getCurrent()) {
      return;
    }

    await this.checkpointManager.update(
      this.checkpointManager.getCurrent()!,
      {
        step: this.currentStep,
        status: 'running',
      },
      this.conversationManager,
    );
  }

  private reportProgress(message?: string): void {
    const summary = this.executionLogger.getSummary();

    this.options.onProgress({
      taskId: this.taskId,
      step: this.currentStep,
      status: 'running',
      tokensUsed: summary.totalTokens.totalTokens,
      cost: summary.totalCost.totalCost,
      message,
    });
  }

  private createResult(
    success: boolean,
    data?: any,
    error?: string,
  ): TaskResult {
    const summary = this.executionLogger.getSummary();

    return {
      success,
      data,
      error,
      summary: {
        stepsExecuted: summary.totalSteps,
        tokensUsed: summary.totalTokens.totalTokens,
        totalCost: summary.totalCost.totalCost,
        duration: summary.totalDuration,
      },
    };
  }
}

// ─── Convenience Function ───────────────────────────────────────────────────

/**
 * Run a complex task with progress tracking
 */
export async function runComplexTask(
  task: string,
  options: ComplexTaskOptions & {
    onLog?: AgentLogCb;
  },
): Promise<TaskResult> {
  const executor = new ComplexTaskExecutor(task, options);

  const onLog: AgentLogCb = options.onLog ?? (() => { });

  return executor.execute(onLog);
}
