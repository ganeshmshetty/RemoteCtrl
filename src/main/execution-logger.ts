/**
 * Execution Logger - Track steps, tokens, costs, and outcomes
 * 
 * Features:
 * - Per-step logging with timing
 * - Token usage tracking
 * - Cost calculation
 * - Progress reporting
 * - Execution history
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface StepRecord {
  step: number;
  timestamp: number;
  action: string;
  instruction: string;
  result?: unknown;
  error?: string;
  tokensUsed: TokenUsage;
  cost: CostBreakdown;
  duration: number;
  pageState: {
    url: string;
    title: string;
    elementCount: number;
  };
}

export interface ExecutionSummary {
  taskId: string;
  task: string;
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  totalTokens: TokenUsage;
  totalCost: CostBreakdown;
  totalDuration: number;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}

// ─── Token Pricing (as of 2026) ──────────────────────────────────────────────

const TOKEN_PRICES = {
  // Per 1M tokens
  openai: {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
  },
  anthropic: {
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-3-5-haiku': { input: 1, output: 5 },
  },
  gemini: {
    'gemini-3.1-flash-lite': { input: 0.3, output: 1.2 },
    'gemini-2.5-flash': { input: 0.3, output: 1.2 },
    'gemini-2.5-pro': { input: 2.5, output: 10 },
  },
} as const;

// ─── Execution Logger Class ──────────────────────────────────────────────────

export class ExecutionLogger {
  private steps: StepRecord[] = [];
  private taskId: string;
  private task: string;
  private startTime: number;
  private endTime?: number;
  private status: 'running' | 'completed' | 'failed' | 'cancelled' = 'running';

  constructor(taskId: string, task: string) {
    this.taskId = taskId;
    this.task = task;
    this.startTime = Date.now();
  }

  /**
   * Log a step execution
   */
  log(step: Omit<StepRecord, 'timestamp'>): void {
    const record: StepRecord = {
      ...step,
      timestamp: Date.now(),
    };
    this.steps.push(record);
  }

  /**
   * Log a step with timing
   */
  async logWithTiming<T>(
    step: number,
    action: string,
    instruction: string,
    executor: () => Promise<T>,
    pageState: StepRecord['pageState'],
  ): Promise<T> {
    const start = Date.now();
    let result: T | undefined;
    let error: string | undefined;

    try {
      result = await executor();
      return result;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const duration = Date.now() - start;

      this.log({
        step,
        action,
        instruction,
        result: result as any,
        error,
        tokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
        duration,
        pageState,
      });
    }
  }

  /**
   * Update step with token usage and cost
   */
  updateStepTokens(
    step: number,
    tokens: TokenUsage,
    model: string,
    provider: 'openai' | 'anthropic' | 'gemini',
  ): void {
    const stepRecord = this.steps[step - 1];
    if (!stepRecord) return;

    stepRecord.tokensUsed = tokens;
    stepRecord.cost = calculateCost(tokens, model, provider);
  }

  /**
   * Get execution summary
   */
  getSummary(): ExecutionSummary {
    const totals = this.steps.reduce(
      (acc, step) => ({
        inputTokens: acc.inputTokens + step.tokensUsed.inputTokens,
        outputTokens: acc.outputTokens + step.tokensUsed.outputTokens,
        totalTokens: acc.totalTokens + step.tokensUsed.totalTokens,
        inputCost: acc.inputCost + step.cost.inputCost,
        outputCost: acc.outputCost + step.cost.outputCost,
        totalCost: acc.totalCost + step.cost.totalCost,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputCost: 0, outputCost: 0, totalCost: 0 },
    );

    return {
      taskId: this.taskId,
      task: this.task,
      totalSteps: this.steps.length,
      successfulSteps: this.steps.filter((s) => !s.error).length,
      failedSteps: this.steps.filter((s) => !!s.error).length,
      totalTokens: {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        totalTokens: totals.totalTokens,
      },
      totalCost: {
        inputCost: totals.inputCost,
        outputCost: totals.outputCost,
        totalCost: totals.totalCost,
      },
      totalDuration: (this.endTime ?? Date.now()) - this.startTime,
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.status,
    };
  }

  /**
   * Get progress report
   */
  getProgress(): {
    step: number;
    percentage: number;
    tokensUsed: number;
    cost: number;
    avgStepDuration: number;
    estimatedRemaining?: number;
  } {
    const totalDuration = Date.now() - this.startTime;
    const avgStepDuration = this.steps.length > 0 ? totalDuration / this.steps.length : 0;

    return {
      step: this.steps.length,
      percentage: 0, // Unknown for open-ended tasks
      tokensUsed: this.getSummary().totalTokens.totalTokens,
      cost: this.getSummary().totalCost.totalCost,
      avgStepDuration,
    };
  }

  /**
   * Get execution history
   */
  getHistory(): StepRecord[] {
    return [...this.steps];
  }

  /**
   * Get last N steps
   */
  getLastSteps(n: number): StepRecord[] {
    return this.steps.slice(-n);
  }

  /**
   * Mark execution as completed
   */
  complete(): void {
    this.status = 'completed';
    this.endTime = Date.now();
  }

  /**
   * Mark execution as failed
   */
  fail(): void {
    this.status = 'failed';
    this.endTime = Date.now();
  }

  /**
   * Mark execution as cancelled
   */
  cancel(): void {
    this.status = 'cancelled';
    this.endTime = Date.now();
  }

  /**
   * Save checkpoint to disk
   */
  async saveCheckpoint(checkpointPath: string): Promise<void> {
    try {
      await mkdir(join(checkpointPath, '..'), { recursive: true });
      await writeFile(
        checkpointPath,
        JSON.stringify({
          summary: this.getSummary(),
          steps: this.steps,
        }),
        'utf-8',
      );
    } catch (err) {
      console.error('[ExecutionLogger] Failed to save checkpoint:', err);
    }
  }

  /**
   * Load checkpoint from disk
   */
  static async loadCheckpoint(checkpointPath: string): Promise<{
    summary: ExecutionSummary;
    steps: StepRecord[];
  } | null> {
    try {
      const content = await readFile(checkpointPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Reset logger
   */
  reset(): void {
    this.steps = [];
    this.endTime = undefined;
    this.status = 'running';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calculate cost from token usage
 */
export function calculateCost(
  tokens: TokenUsage,
  model: string,
  provider: 'openai' | 'anthropic' | 'gemini',
): CostBreakdown {
  const pricing = (TOKEN_PRICES as any)[provider]?.[model as any];
  if (!pricing) {
    return { inputCost: 0, outputCost: 0, totalCost: 0 };
  }

  const inputCost = (tokens.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (tokens.outputTokens / 1_000_000) * pricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Estimate tokens from text (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English
  return Math.floor(text.length / 4);
}

/**
 * Estimate tokens from messages
 */
export function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content) + 4; // +4 for role formatting
  }, 0);
}
