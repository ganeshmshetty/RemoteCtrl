/**
 * Checkpoint Manager
 * 
 * Save and restore task execution state for:
 * - Long-running tasks (resume after failure)
 * - User cancellation (resume later)
 * - Debugging (inspect intermediate state)
 * 
 * Checkpoints are saved to disk and can be loaded later.
 */

import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { app } from 'electron';
import { ConversationManager, type Message } from './conversation-manager.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Checkpoint {
  taskId: string;
  task: string;
  timestamp: number;
  
  // Execution state
  step: number;
  status: 'running' | 'paused' | 'waiting' | 'completed';
  
  // Conversation history
  conversation: {
    messages: Array<{ role: string; content: string; timestamp: number }>;
    compactionCount: number;
  };
  
  // Collected data
  collectedData: Record<string, any>;
  
  // Browser state
  browserState: {
    url: string;
    title: string;
    cookies?: string;
  };
  
  // Metadata
  metadata: {
    startedAt: number;
    lastSavedAt: number;
    checkpointCount: number;
    estimatedTokens?: number;
  };
}

export interface CheckpointMetadata {
  taskId: string;
  task: string;
  timestamp: number;
  step: number;
  status: string;
}

// ─── Checkpoint Manager Class ───────────────────────────────────────────────

export class CheckpointManager {
  private checkpointDir: string;
  private currentCheckpoint?: Checkpoint;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(checkpointDir?: string) {
    this.checkpointDir = checkpointDir ?? join(app.getPath('userData'), 'checkpoints');
  }

  /**
   * Create initial checkpoint
   */
  async create(
    taskId: string,
    task: string,
    conversationManager: ConversationManager,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      taskId,
      task,
      timestamp: Date.now(),
      step: 0,
      status: 'running',
      conversation: {
        messages: conversationManager.getMessages().map((m: Message) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
        compactionCount: conversationManager.getCompactionCount(),
      },
      collectedData: {},
      browserState: {
        url: 'about:blank',
        title: '',
      },
      metadata: {
        startedAt: Date.now(),
        lastSavedAt: Date.now(),
        checkpointCount: 0,
      },
    };

    this.currentCheckpoint = checkpoint;
    await this.save(checkpoint);
    
    return checkpoint;
  }

  /**
   * Update checkpoint with current state
   */
  async update(
    checkpoint: Checkpoint,
    updates: Partial<Checkpoint>,
    conversationManager?: ConversationManager,
  ): Promise<void> {
    // Merge updates
    Object.assign(checkpoint, updates);
    
    // Update conversation if provided
    if (conversationManager) {
      checkpoint.conversation = {
        messages: conversationManager.getMessages().map((m: Message) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
        compactionCount: conversationManager.getCompactionCount(),
      };
    }

    checkpoint.metadata.lastSavedAt = Date.now();
    checkpoint.metadata.checkpointCount++;

    this.currentCheckpoint = checkpoint;
    await this.save(checkpoint);
  }

  /**
   * Save checkpoint to disk
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    try {
      const filePath = this.getCheckpointPath(checkpoint.taskId);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    } catch (err) {
      console.error('[CheckpointManager] Failed to save checkpoint:', err);
      throw err;
    }
  }

  /**
   * Load checkpoint from disk
   */
  async load(taskId: string): Promise<Checkpoint | null> {
    try {
      const filePath = this.getCheckpointPath(taskId);
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as Checkpoint;
    } catch {
      return null;
    }
  }

  /**
   * Delete checkpoint
   */
  async delete(taskId: string): Promise<void> {
    try {
      const filePath = this.getCheckpointPath(taskId);
      await readFile(filePath); // Check if exists
      // Don't delete - keep for debugging. Or uncomment to delete:
      // await unlink(filePath);
    } catch {
      // File doesn't exist
    }
  }

  /**
   * List all checkpoints
   */
  async list(): Promise<CheckpointMetadata[]> {
    try {
      const files = await readdir(this.checkpointDir);
      const checkpoints: CheckpointMetadata[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = join(this.checkpointDir, file);
          const content = await readFile(filePath, 'utf-8');
          const checkpoint = JSON.parse(content) as Checkpoint;

          checkpoints.push({
            taskId: checkpoint.taskId,
            task: checkpoint.task,
            timestamp: checkpoint.timestamp,
            step: checkpoint.step,
            status: checkpoint.status,
          });
        } catch {
          // Skip invalid checkpoints
        }
      }

      return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }

  /**
   * Get latest checkpoint
   */
  async getLatest(): Promise<Checkpoint | null> {
    const checkpoints = await this.list();
    if (checkpoints.length === 0) {
      return null;
    }

    return this.load(checkpoints[0].taskId);
  }

  /**
   * Enable auto-save at interval
   */
  enableAutoSave(intervalMs: number = 30000): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      if (this.currentCheckpoint) {
        await this.save(this.currentCheckpoint);
      }
    }, intervalMs);
  }

  /**
   * Disable auto-save
   */
  disableAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * Get current checkpoint
   */
  getCurrent(): Checkpoint | undefined {
    return this.currentCheckpoint;
  }

  /**
   * Get checkpoint file path
   */
  private getCheckpointPath(taskId: string): string {
    return join(this.checkpointDir, `${taskId}.json`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate unique task ID
 */
export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if checkpoint exists
 */
export async function hasCheckpoint(taskId: string, checkpointDir: string): Promise<boolean> {
  const manager = new CheckpointManager(checkpointDir);
  const checkpoint = await manager.load(taskId);
  return checkpoint !== null;
}
