/**
 * Strategy Generator - Auto-replan on failure
 * 
 * When the current approach fails, generates alternative strategies.
 * Analyzes what went wrong and suggests different approaches.
 * 
 * Example:
 * Current: "Clicking job links fails - selector not found"
 * New Strategy: "Use keyboard navigation instead of clicking"
 */

import { ConversationManager } from './conversation-manager.js';
import { getPreferredProvider, getApiKey } from './storage.js';
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StrategyContext {
  task: string;
  currentApproach: string;
  failureReason: string;
  stepsAttempted: number;
  stepsRemaining: number;
  pageState: {
    url: string;
    title: string;
    error?: string;
  };
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  steps: string[];
  confidence: 'low' | 'medium' | 'high';
  estimatedSuccessRate: number;
  risks: string[];
}

export interface StrategySuggestion {
  originalStrategy: string;
  alternativeStrategies: Strategy[];
  recommendation: string;
  timestamp: number;
}

// ─── Strategy Templates ──────────────────────────────────────────────────────

const STRATEGY_TEMPLATES: Record<string, Omit<Strategy, 'id' | 'confidence' | 'estimatedSuccessRate'>> = {
  navigation_failure: {
    name: 'Alternative Navigation',
    description: 'Use different navigation method when direct access fails',
    steps: [
      'Try direct URL access if known',
      'Use search engine as fallback',
      'Navigate through related pages',
      'Use browser history or bookmarks',
    ],
    risks: ['May take longer', 'Might not reach exact target'],
  },
  extraction_failure: {
    name: 'Alternative Extraction',
    description: 'Extract data using different selectors or methods',
    steps: [
      'Try CSS selectors instead of XPath',
      'Extract from page metadata',
      'Use text pattern matching',
      'Extract from network requests',
    ],
    risks: ['Data might be incomplete', 'May require multiple attempts'],
  },
  interaction_failure: {
    name: 'Alternative Interaction',
    description: 'Interact with page using different methods',
    steps: [
      'Use keyboard instead of mouse',
      'Try right-click context menu',
      'Use browser devtools console',
      'Inject JavaScript directly',
    ],
    risks: ['Might trigger anti-bot measures', 'Less reliable'],
  },
  stall_recovery: {
    name: 'Stall Recovery',
    description: 'Recover from stuck state by changing approach',
    steps: [
      'Navigate to a different page',
      'Refresh the current page',
      'Start from a known good state',
      'Try completely different website',
    ],
    risks: ['May lose progress', 'Might need to restart task'],
  },
  rate_limit_recovery: {
    name: 'Rate Limit Handling',
    description: 'Handle rate limiting gracefully',
    steps: [
      'Wait with exponential backoff',
      'Reduce request frequency',
      'Use cached data if available',
      'Switch to different endpoint',
    ],
    risks: ['Slower execution', 'May still hit limits'],
  },
};

// ─── Strategy Generator Class ───────────────────────────────────────────────

export class StrategyGenerator {
  private conversationManager: ConversationManager;

  constructor() {
    this.conversationManager = new ConversationManager({
      systemPrompt: 'You are an expert at generating alternative strategies when current approaches fail.',
    });
  }

  /**
   * Generate alternative strategies when current approach fails
   */
  async generateAlternatives(context: StrategyContext): Promise<StrategySuggestion> {
    const failureType = this.classifyFailure(context.failureReason);
    const template = STRATEGY_TEMPLATES[failureType];

    if (!template) {
      // Generic fallback strategy
      return this.generateGenericStrategy(context);
    }

    // Adapt template to current context
    const adaptedStrategy: Strategy = {
      id: `strategy_${Date.now()}`,
      ...template,
      confidence: this.calculateConfidence(context, failureType),
      estimatedSuccessRate: this.estimateSuccessRate(failureType),
    };

    return {
      originalStrategy: context.currentApproach,
      alternativeStrategies: [adaptedStrategy],
      recommendation: `Try "${adaptedStrategy.name}" - ${adaptedStrategy.description}`,
      timestamp: Date.now(),
    };
  }

  /**
   * Re-plan entire task from current state
   */
  async replanTask(
    originalTask: string,
    completedSteps: string[],
    failureReason: string,
  ): Promise<string[]> {
    const context = `
Original task: ${originalTask}
Completed steps: ${completedSteps.join(', ') || 'None'}
Failed because: ${failureReason}

Generate a new plan that avoids the failure point.
`;

    // Add to conversation for context
    this.conversationManager.addMessage('user', context);

    // Generate new plan (simplified - would call LLM in full implementation)
    const newPlan = await this.generateReplan(originalTask, failureReason);

    return newPlan;
  }

  /**
   * Get strategy for specific failure type
   */
  getStrategyForFailure(failureType: string): Strategy | null {
    const template = STRATEGY_TEMPLATES[failureType];
    if (!template) return null;

    return {
      id: `strategy_${Date.now()}`,
      ...template,
      confidence: 'medium',
      estimatedSuccessRate: 0.7,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private classifyFailure(failureReason: string): string {
    const reason = failureReason.toLowerCase();

    if (reason.includes('navigat') || reason.includes('url') || reason.includes('page')) {
      return 'navigation_failure';
    }
    if (reason.includes('extract') || reason.includes('selector') || reason.includes('element')) {
      return 'extraction_failure';
    }
    if (reason.includes('click') || reason.includes('interact') || reason.includes('input')) {
      return 'interaction_failure';
    }
    if (reason.includes('stuck') || reason.includes('loop') || reason.includes('stall')) {
      return 'stall_recovery';
    }
    if (reason.includes('rate') || reason.includes('limit') || reason.includes('429')) {
      return 'rate_limit_recovery';
    }

    return 'stall_recovery'; // Default fallback
  }

  private calculateConfidence(context: StrategyContext, _failureType: string): 'low' | 'medium' | 'high' {
    // Higher confidence if we have more steps remaining
    const remainingRatio = context.stepsRemaining / (context.stepsAttempted + context.stepsRemaining);
    
    if (remainingRatio > 0.5) return 'high';
    if (remainingRatio > 0.2) return 'medium';
    return 'low';
  }

  private estimateSuccessRate(failureType: string): number {
    const rates: Record<string, number> = {
      navigation_failure: 0.85,
      extraction_failure: 0.75,
      interaction_failure: 0.70,
      stall_recovery: 0.60,
      rate_limit_recovery: 0.90,
    };

    return rates[failureType] || 0.5;
  }

  private generateGenericStrategy(context: StrategyContext): StrategySuggestion {
    return {
      originalStrategy: context.currentApproach,
      alternativeStrategies: [
        {
          id: `strategy_${Date.now()}`,
          name: 'Alternative Approach',
          description: 'Try a completely different method',
          steps: [
            'Assess current situation',
            'Identify what is not working',
            'Find alternative path to goal',
            'Execute alternative approach',
          ],
          confidence: 'low',
          estimatedSuccessRate: 0.5,
          risks: ['Unproven approach', 'May require more steps'],
        },
      ],
      recommendation: 'Current approach failed. Consider rephrasing the task or breaking it into smaller steps.',
      timestamp: Date.now(),
    };
  }

  private async generateReplan(task: string, failureReason: string): Promise<string[]> {
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
      model = anthropic('claude-3-5-haiku-20241022');
    } else if (provider === 'gemini') {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google('gemini-2.5-flash');
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    try {
      const { object } = await generateObject({
        model,
        schema: z.object({
          steps: z.array(z.string()).describe('The new sequence of actionable steps to accomplish the task while avoiding the failure.'),
        }),
        prompt: `You are an expert browser automation planner.\nA previous attempt to complete the following task failed.\n\nOriginal task: "${task}"\nFailure reason: "${failureReason}"\n\nGenerate a new, systematic plan (as an array of steps) that avoids this failure point.`,
      });
      return object.steps;
    } catch (err: any) {
      console.warn('Failed to generate replan via LLM. Falling back to generic plan.', err);
      return [
        'Navigate to starting point',
        'Break task into smaller steps',
        'Execute one step at a time',
        'Verify each step before continuing',
        'Complete task and summarize',
      ];
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate strategy ID
 */
export function generateStrategyId(): string {
  return `strategy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
