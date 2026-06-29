/**
 * Human Checkpoint - Ask for human input at decision points
 * 
 * When uncertain or at critical decision points, pause execution
 * and request human guidance before continuing.
 * 
 * Features:
 * - Pause execution at checkpoints
 * - Present options to human
 * - Wait for human decision
 * - Resume with human's choice
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { app, BrowserWindow } from 'electron';
import type { AgentCheckpointPayload, CheckpointResponse } from '../shared/types.js';

// Global registry to handle IPC routing to the right manager
export const globalCheckpointCallbacks = new Map<string, (response: CheckpointResponse) => void>();

export async function submitCheckpointResponse(checkpointId: string, response: CheckpointResponse): Promise<void> {
  const callback = globalCheckpointCallbacks.get(checkpointId);
  if (!callback) {
    throw new Error(`No pending checkpoint found for ID: ${checkpointId}`);
  }
  callback(response);
  globalCheckpointCallbacks.delete(checkpointId);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckpointQuestion {
  id: string;
  taskId: string;
  step: number;
  question: string;
  options: CheckpointOption[];
  context: {
    currentPage: string;
    taskProgress: string;
    uncertainty?: string;
  };
  status: 'pending' | 'answered' | 'timeout';
  createdAt: number;
  answeredAt?: number;
  selectedOption?: string;
}

export interface CheckpointOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

// ─── Human Checkpoint Manager ───────────────────────────────────────────────

const DEFAULT_CHECKPOINT_FILE = join(app.getPath('userData'), 'human-checkpoints.json');

export class HumanCheckpointManager {
  private checkpointFile: string;
  private pendingCheckpoints: Map<string, CheckpointQuestion>;
  private timeoutMs: number;

  constructor(checkpointFile: string = DEFAULT_CHECKPOINT_FILE, timeoutMinutes: number = 10) {
    this.checkpointFile = checkpointFile;
    this.pendingCheckpoints = new Map();
    this.timeoutMs = timeoutMinutes * 60 * 1000;
  }

  /**
   * Create a checkpoint and wait for human response
   */
  async ask(
    taskId: string,
    step: number,
    question: string,
    options: CheckpointOption[],
    context: CheckpointQuestion['context'],
  ): Promise<string> {
    const checkpoint: CheckpointQuestion = {
      id: generateCheckpointId(),
      taskId,
      step,
      question,
      options,
      context,
      status: 'pending',
      createdAt: Date.now(),
    };

    // Save checkpoint
    this.pendingCheckpoints.set(checkpoint.id, checkpoint);
    await this.saveCheckpoints();

    // Emit event to all windows so renderer can show UI
    const payload: AgentCheckpointPayload = {
      checkpointId: checkpoint.id,
      taskId,
      step,
      question,
      options,
      context,
    };
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('browser:agentCheckpoint', payload);
    });

    // Wait for response with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        checkpoint.status = 'timeout';
        this.pendingCheckpoints.set(checkpoint.id, checkpoint);
        globalCheckpointCallbacks.delete(checkpoint.id);
        reject(new Error(`Checkpoint ${checkpoint.id} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      globalCheckpointCallbacks.set(checkpoint.id, (response: CheckpointResponse) => {
        clearTimeout(timeout);
        checkpoint.status = 'answered';
        checkpoint.answeredAt = Date.now();
        checkpoint.selectedOption = response.selectedOptionId;
        
        this.pendingCheckpoints.delete(checkpoint.id);
        this.saveCheckpoints();
        
        resolve(response.selectedOptionId);
      });
    });
  }

  /**
   * Submit response to a checkpoint
   */
  async submitResponse(checkpointId: string, response: CheckpointResponse): Promise<void> {
    await submitCheckpointResponse(checkpointId, response);
  }

  /**
   * Get pending checkpoints
   */
  getPendingCheckpoints(): CheckpointQuestion[] {
    return Array.from(this.pendingCheckpoints.values());
  }

  /**
   * Cancel a checkpoint
   */
  cancelCheckpoint(checkpointId: string): void {
    this.pendingCheckpoints.delete(checkpointId);
    globalCheckpointCallbacks.delete(checkpointId);
    this.saveCheckpoints();
  }

  /**
   * Save checkpoints to disk
   */
  private async saveCheckpoints(): Promise<void> {
    try {
      const checkpoints = Array.from(this.pendingCheckpoints.values());
      await writeFile(this.checkpointFile, JSON.stringify(checkpoints, null, 2), 'utf-8');
    } catch (err) {
      console.error('[HumanCheckpoint] Failed to save checkpoints:', err);
    }
  }

  /**
   * Load checkpoints from disk
   */
  async loadCheckpoints(): Promise<void> {
    let content: string | null = null;
    try {
      content = await readFile(this.checkpointFile, 'utf-8');
    } catch (err) {
      // If the target file doesn't exist and we're loading the default path, try migrating from legacy path
      if (this.checkpointFile === DEFAULT_CHECKPOINT_FILE) {
        const legacyPath = join(homedir(), '.config', 'RemoteCtrl', 'human-checkpoints.json');
        if (existsSync(legacyPath)) {
          try {
            console.log(`[HumanCheckpoint] Migrating legacy checkpoints from ${legacyPath} to ${this.checkpointFile}`);
            const legacyContent = await readFile(legacyPath, 'utf-8');
            await writeFile(this.checkpointFile, legacyContent, 'utf-8');
            content = legacyContent;
          } catch (migrateErr) {
            console.error('[HumanCheckpoint] Failed to migrate legacy checkpoints:', migrateErr);
          }
        }
      }
    }

    if (content) {
      try {
        const checkpoints: CheckpointQuestion[] = JSON.parse(content);
        for (const checkpoint of checkpoints) {
          if (checkpoint.status === 'pending') {
            this.pendingCheckpoints.set(checkpoint.id, checkpoint);
          }
        }
      } catch (parseErr) {
        console.error('[HumanCheckpoint] Failed to parse checkpoints:', parseErr);
      }
    }
  }
}

// ─── Uncertainty Detector ───────────────────────────────────────────────────

export interface UncertaintyCheck {
  shouldAsk: boolean;
  confidence: number;
  reason: string;
  suggestedQuestion?: string;
  suggestedOptions?: CheckpointOption[];
}

/**
 * Detect when human input is needed
 */
export class UncertaintyDetector {
  private thresholds = {
    lowConfidence: 0.6,      // Ask if confidence < 60%
    highStakes: true,        // Always ask for high-stakes decisions
    multipleOptions: 3,      // Ask if more than 3 viable options
  };

  /**
   * Check if human input is needed
   */
  shouldAskHuman(context: {
    confidence: number;
    decisionType: string;
    options: any[];
    taskImportance: 'low' | 'medium' | 'high';
  }): UncertaintyCheck {
    const { confidence, options, taskImportance } = context;

    // Low confidence
    if (confidence < this.thresholds.lowConfidence) {
      return {
        shouldAsk: true,
        confidence,
        reason: `Low confidence (${Math.round(confidence * 100)}%) in decision`,
        suggestedQuestion: `I'm not sure about the next step. Which option should I choose?`,
        suggestedOptions: this.generateOptions(options),
      };
    }

    // High-stakes decision
    if (this.thresholds.highStakes && taskImportance === 'high') {
      return {
        shouldAsk: true,
        confidence,
        reason: 'High-stakes decision requires human approval',
        suggestedQuestion: 'This is an important decision. How should I proceed?',
        suggestedOptions: this.generateOptions(options),
      };
    }

    // Multiple viable options
    if (options.length > this.thresholds.multipleOptions) {
      return {
        shouldAsk: true,
        confidence,
        reason: `Multiple options available (${options.length})`,
        suggestedQuestion: 'I found several options. Which one should I choose?',
        suggestedOptions: this.generateOptions(options),
      };
    }

    return {
      shouldAsk: false,
      confidence,
      reason: 'No human input needed',
    };
  }

  private generateOptions(options: any[]): CheckpointOption[] {
    return options.slice(0, 5).map((opt, index) => ({
      id: `option_${index}`,
      label: typeof opt === 'string' ? opt : JSON.stringify(opt),
      description: undefined,
      recommended: index === 0, // First option recommended by default
    }));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate checkpoint ID
 */
export function generateCheckpointId(): string {
  return `checkpoint_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
