import { z } from 'zod';

// ─── Workflow Schemas ──────────────────────────────────────────────────────────

export const WorkflowStepActionSchema = z.enum(['act', 'observe', 'extract']);

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  action: WorkflowStepActionSchema,
  instruction: z.string().min(1),
  expected: z.string().optional(),
});

export const LocalWorkflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  startUrl: z.string().url().optional(),
  steps: z.array(WorkflowStepSchema).max(100),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

// ─── Settings Schemas ─────────────────────────────────────────────────────────

export const ApiProviderSchema = z.enum(['openai', 'anthropic', 'gemini']);

export const SetApiKeySchema = z.object({
  provider: ApiProviderSchema,
  value: z.string().min(1).max(500),
});

export const SetSignalingUrlSchema = z.object({
  url: z.string().url(),
});

export const SetPreferredProviderSchema = z.object({
  provider: ApiProviderSchema,
});

// ─── Host IPC Schemas ─────────────────────────────────────────────────────────

export const ApproveControllerSchema = z.object({
  controllerId: z.string().min(1),
});

// ─── Controller IPC Schemas ───────────────────────────────────────────────────

export const ConnectPinSchema = z.object({
  pin: z.string().length(9).regex(/^\d{9}$/),
});

// ─── Agent Schemas ────────────────────────────────────────────────────────────

export const AgentPromptSchema = z.object({
  commandId: z.string().uuid(),
  action: WorkflowStepActionSchema,
  instruction: z.string().min(1).max(5000),
});

export const AgentWorkflowBatchSchema = z.object({
  workflowRunId: z.string().uuid(),
  workflowId: z.string().min(1),
  name: z.string().min(1),
  startUrl: z.string().url().optional(),
  steps: z.array(WorkflowStepSchema).min(1).max(100),
});

// ─── Capture Metadata Schema ──────────────────────────────────────────────────

export const CaptureMetadataSchema = z.object({
  captureWidth: z.number().positive(),
  captureHeight: z.number().positive(),
  viewportWidth: z.number().positive(),
  viewportHeight: z.number().positive(),
  deviceScaleFactor: z.number().positive(),
  contentRect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});

// ─── Remote Input Schemas ─────────────────────────────────────────────────────

export const RemoteMousePayloadSchema = z.object({
  action: z.enum(['move', 'down', 'up', 'click', 'scroll']),
  xPercent: z.number().min(0).max(1),
  yPercent: z.number().min(0).max(1),
  button: z.enum(['left', 'right', 'middle']).optional(),
  deltaY: z.number().optional(),
});

export const RemoteKeyboardPayloadSchema = z.object({
  action: z.enum(['down', 'up', 'press']),
  key: z.string().min(1).max(50),
});

export const BrowserModeSchema = z.enum(['internal', 'local_chrome']);

// ─── Persisted Settings File Schema ──────────────────────────────────────────

export const PersistedSettingsSchema = z.object({
  signalingUrl: z.string().url().default('https://remotectrl-signaling.onrender.com'),
  preferredProvider: ApiProviderSchema.default('openai'),
  browserMode: BrowserModeSchema.default('internal'),
  // API keys are stored in a separate secure store — not in this file
});

export type PersistedSettings = z.infer<typeof PersistedSettingsSchema>;
