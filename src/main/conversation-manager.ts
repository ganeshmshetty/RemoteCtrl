/**
 * Conversation Manager
 * 
 * Manages LLM conversation history with:
 * - Automatic token counting
 * - Smart compaction when approaching limits
 * - Screenshot management
 * - Context window optimization
 * 
 * Inspired by Open Browser's ConversationManager
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
  screenshot?: string; // Base64 or URL
  metadata?: {
    step?: number;
    action?: string;
    tokens?: number;
  };
}

export interface CompactionPolicy {
  /** Run compaction when conversation reaches this % of limit */
  threshold: number; // e.g., 0.8 = 80%
  /** Target size after compaction (as % of limit) */
  target: number; // e.g., 0.5 = 50%
  /** Minimum messages to keep (most recent) */
  minKeep: number;
}

const DEFAULT_POLICY: CompactionPolicy = {
  threshold: 0.8,
  target: 0.5,
  minKeep: 10,
};

// ─── Conversation Manager Class ─────────────────────────────────────────────

export class ConversationManager {
  private messages: Message[] = [];
  private systemPrompt?: string;
  private tokenCount: number = 0;
  private compactionCount: number = 0;
  private policy: CompactionPolicy;

  constructor(options?: {
    systemPrompt?: string;
    policy?: Partial<CompactionPolicy>;
  }) {
    this.systemPrompt = options?.systemPrompt;
    this.policy = { ...DEFAULT_POLICY, ...options?.policy };
    
    if (this.systemPrompt) {
      this.addSystemPrompt(this.systemPrompt);
    }
  }

  /**
   * Add a message to the conversation
   */
  addMessage(
    role: Message['role'],
    content: string,
    options?: { screenshot?: string; step?: number; action?: string },
  ): void {
    const message: Message = {
      role,
      content,
      timestamp: Date.now(),
      ...options,
    };

    this.messages.push(message);
    this.tokenCount = this.estimateTokenCount();

    // Check if compaction needed
    if (this.needsCompaction()) {
      this.compact();
    }
  }

  /**
   * Add system prompt
   */
  addSystemPrompt(content: string): void {
    this.systemPrompt = content;
    this.messages = [
      { role: 'system', content, timestamp: Date.now() },
      ...this.messages.filter((m) => m.role !== 'system'),
    ];
    this.tokenCount = this.estimateTokenCount();
  }

  /**
   * Get all messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get messages within token budget
   */
  getMessagesWithinBudget(budget: number): Message[] {
    let currentTokens = 0;
    const result: Message[] = [];

    // Start from most recent and work backwards
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      const messageTokens = this.estimateTokens(message.content);

      if (currentTokens + messageTokens > budget) {
        break;
      }

      result.unshift(message);
      currentTokens += messageTokens;
    }

    return result;
  }

  /**
   * Get last N messages
   */
  getLastMessages(n: number): Message[] {
    return this.messages.slice(-n);
  }

  /**
   * Compact conversation to reduce token count
   */
  compact(_customCompact?: (messages: Message[]) => Promise<string>): void {
    if (this.messages.length <= this.policy.minKeep) {
      return; // Nothing to compact
    }

    // Keep system prompt and recent messages
    const systemMessage = this.messages.find((m) => m.role === 'system');
    const recentMessages = this.messages.slice(-this.policy.minKeep);
    const oldMessages = this.messages.slice(0, -this.policy.minKeep);

    if (oldMessages.length === 0) {
      return; // Nothing to compact
    }

    // Create summary of old messages
    const summary = this.summarizeMessages(oldMessages);

    // Replace old messages with summary
    this.messages = [
      ...(systemMessage ? [systemMessage] : []),
      {
        role: 'system' as const,
        content: summary,
        timestamp: Date.now(),
        metadata: {
          action: 'compaction',
          step: this.compactionCount + 1,
        },
      },
      ...recentMessages,
    ].filter((m, i, arr) => {
      // Remove duplicate system messages
      if (m.role === 'system') {
        const firstSystem = arr.findIndex((msg) => msg.role === 'system');
        return i === firstSystem;
      }
      return true;
    });

    this.compactionCount++;
    this.tokenCount = this.estimateTokenCount();
  }

  /**
   * Check if compaction is needed
   */
  needsCompaction(): boolean {
    const limit = 100000; // Approximate token limit
    const threshold = limit * this.policy.threshold;
    return this.tokenCount > threshold;
  }

  /**
   * Get current token count estimate
   */
  getTokenCount(): number {
    return this.tokenCount;
  }

  /**
   * Get compaction count
   */
  getCompactionCount(): number {
    return this.compactionCount;
  }

  /**
   * Clear conversation
   */
  clear(): void {
    this.messages = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt, timestamp: Date.now() }]
      : [];
    this.tokenCount = 0;
    this.compactionCount = 0;
  }

  /**
   * Get conversation summary
   */
  getSummary(): {
    messageCount: number;
    tokenCount: number;
    compactionCount: number;
    systemPrompt: string | undefined;
  } {
    return {
      messageCount: this.messages.length,
      tokenCount: this.tokenCount,
      compactionCount: this.compactionCount,
      systemPrompt: this.systemPrompt,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Summarize a list of messages
   */
  private summarizeMessages(messages: Message[]): string {
    const steps: string[] = [];
    
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.metadata?.action) {
        steps.push(`- ${msg.metadata.action}: ${msg.content.slice(0, 100)}`);
      }
    }

    const summary = [
      `Previous conversation summary (${this.compactionCount + 1}):`,
      `Total steps discussed: ${messages.length}`,
      `Key actions taken:`,
      ...steps.slice(-10), // Last 10 actions
    ].join('\n');

    return summary;
  }

  /**
   * Estimate token count for content
   */
  private estimateTokens(content: string): number {
    // Rough estimate: 1 token ≈ 4 characters for English
    return Math.floor(content.length / 4);
  }

  /**
   * Estimate total token count
   */
  private estimateTokenCount(): number {
    return this.messages.reduce((total, msg) => {
      return total + this.estimateTokens(msg.content);
    }, 0);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Truncate text to fit within token limit
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  suffix: string = '...',
): string {
  const maxChars = maxTokens * 4; // Approximate
  
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(0, maxChars - suffix.length) + suffix;
}

/**
 * Format messages for LLM input
 */
export function formatMessages(messages: Message[]): Array<{ role: string; content: string }> {
  return messages.map(({ role, content }) => ({ role, content }));
}
