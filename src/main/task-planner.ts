/**
 * Task Planner - Phase 3 Implementation
 * 
 * Auto-decomposes complex tasks into manageable subtasks.
 * Uses LLM to break down high-level goals into executable steps.
 * 
 * Example:
 * Input: "Find top 5 AI companies, visit careers pages, extract jobs"
 * Output: [
 *   { id: 1, goal: "Search for AI company list", status: "pending" },
 *   { id: 2, goal: "Visit Company A careers page", status: "pending" },
 *   { id: 3, goal: "Extract jobs from Company A", status: "pending" },
 *   ...
 * ]
 */

import { ConversationManager } from './conversation-manager.js';
import { getPreferredProvider, getApiKey } from './storage.js';
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Subtask {
  id: number;
  goal: string;
  action: 'act' | 'observe' | 'extract';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: any;
  error?: string;
  parentTaskId?: number;
  dependencies?: number[];
}

export interface TaskPlan {
  taskId: string;
  originalTask: string;
  subtasks: Subtask[];
  createdAt: number;
  status: 'planning' | 'executing' | 'completed' | 'failed';
  metadata: {
    estimatedSteps: number;
    complexity: 'simple' | 'moderate' | 'complex';
  };
}

export interface PlanningOptions {
  maxSubtasks?: number;
  includeDependencies?: boolean;
  model?: string;
}

// ─── System Prompt for Planning ──────────────────────────────────────────────

const PLANNING_SYSTEM_PROMPT = `You are a task planning expert. Your job is to break down complex tasks into clear, actionable subtasks.

Guidelines:
1. Each subtask should be specific and achievable in 1-5 steps
2. Include navigation steps with action "act" (e.g., "Go to website")
3. Include extraction steps with action "extract" (e.g., "Extract job listings")
4. Include interaction steps with action "act" (e.g., "Click the login button")
5. Order subtasks logically and populate the dependencies array with the IDs (1-indexed) of prior subtasks that must be completed first.
6. For repetitive tasks (e.g., "for each of 5 companies"), create individual subtasks.
7. Mark the final subtask as the conclusion/summary step.

Example:
Task: "Find top 3 AI companies and their open engineer jobs"

Subtasks:
1. Search for "top AI companies 2026" on Google
2. Extract list of top AI companies from search results
3. Navigate to first company's careers page
4. Extract software engineer jobs from first company
5. Navigate to second company's careers page
6. Extract software engineer jobs from second company
7. Navigate to third company's careers page
8. Extract software engineer jobs from third company
9. Compile and summarize all collected job data

Respond with the required JSON structure.`;

// ─── Task Planner Class ─────────────────────────────────────────────────────

export class TaskPlanner {
  private conversationManager: ConversationManager;

  constructor(_options?: PlanningOptions) {
    this.conversationManager = new ConversationManager({
      systemPrompt: PLANNING_SYSTEM_PROMPT,
    });
  }

  /**
   * Create a plan for a complex task
   */
  async createPlan(task: string): Promise<TaskPlan> {
    const plan: TaskPlan = {
      taskId: generatePlanId(),
      originalTask: task,
      subtasks: [],
      createdAt: Date.now(),
      status: 'planning',
      metadata: {
        estimatedSteps: 0,
        complexity: 'moderate',
      },
    };

    try {
      // Generate subtasks using LLM
      const subtasks = await this.generateSubtasks(task);

      plan.subtasks = subtasks.map((subtask, index) => ({
        id: index + 1,
        ...subtask,
        status: 'pending' as const,
      }));

      plan.metadata.estimatedSteps = plan.subtasks.length;
      plan.metadata.complexity = this.assessComplexity(plan.subtasks.length);
      plan.status = 'executing';

      return plan;
    } catch (err) {
      plan.status = 'failed';
      throw err;
    }
  }

  /**
   * Update subtask status
   */
  updateSubtaskStatus(
    plan: TaskPlan,
    subtaskId: number,
    status: Subtask['status'],
    result?: any,
    error?: string,
  ): void {
    const subtask = plan.subtasks.find((s) => s.id === subtaskId);
    if (!subtask) {
      throw new Error(`Subtask ${subtaskId} not found in plan`);
    }

    subtask.status = status;
    if (result) subtask.result = result;
    if (error) subtask.error = error;

    // Update plan status
    if (plan.subtasks.every((s) => s.status === 'completed')) {
      plan.status = 'completed';
    } else if (plan.subtasks.some((s) => s.status === 'failed')) {
      plan.status = 'failed';
    }
  }

  /**
   * Get next pending subtask
   */
  getNextSubtask(plan: TaskPlan): Subtask | null {
    const pending = plan.subtasks.find((s) => s.status === 'pending');
    return pending || null;
  }

  /**
   * Get progress summary
   */
  getProgress(plan: TaskPlan): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    percentage: number;
  } {
    const total = plan.subtasks.length;
    const completed = plan.subtasks.filter((s) => s.status === 'completed').length;
    const failed = plan.subtasks.filter((s) => s.status === 'failed').length;
    const pending = plan.subtasks.filter((s) => s.status === 'pending').length;

    return {
      total,
      completed,
      failed,
      pending,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private async generateSubtasks(task: string): Promise<Omit<Subtask, 'id' | 'status'>[]> {
    this.conversationManager.clear();
    this.conversationManager.addMessage('user', task);

    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);

    if (!apiKey) {
      throw new Error(`No API key found for provider: ${provider}`);
    }

    let model;
    if (provider === 'openai') {
      const openai = createOpenAI({ apiKey });
      model = openai('gpt-4o');
    } else if (provider === 'anthropic') {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic('claude-3-5-sonnet-latest');
    } else {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google('gemini-2.5-flash');
    }

    const PlannerSchema = z.object({
      subtasks: z.array(z.object({
        goal: z.string(),
        action: z.enum(['act', 'observe', 'extract']),
        dependencies: z.array(z.number()).optional(),
      }))
    });

    const { object } = await generateObject({
      model,
      schema: PlannerSchema,
      system: PLANNING_SYSTEM_PROMPT,
      prompt: `Task: "${task}"`,
    });

    return object.subtasks;
  }

  private assessComplexity(stepCount: number): 'simple' | 'moderate' | 'complex' {
    if (stepCount <= 5) return 'simple';
    if (stepCount <= 20) return 'moderate';
    return 'complex';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate plan ID
 */
export function generatePlanId(): string {
  return `plan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
