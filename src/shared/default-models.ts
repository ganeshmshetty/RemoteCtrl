import type { ApiProvider } from './types.js';

export const DEFAULT_MODELS: Record<ApiProvider, string[]> = {
  "openai": [
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "o1-mini",
    "o3-mini",
    "gpt-4-turbo"
  ],
  "anthropic": [
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest"
  ],
  "gemini": [
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-computer-use-preview-10-2025",
    "deep-research-preview-04-2026",
    "deep-research-max-preview-04-2026",
    "antigravity-preview-05-2026"
  ],
  "groq": [
    "llama-3.3-70b-versatile",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
    "llama-3.1-8b-instant",
    "qwen-qwq-32b",
    "deepseek-r1-distill-llama-70b"
  ],
  "deepseek": [
    "deepseek-chat",
    "deepseek-reasoner"
  ],
  "nebius": [
    "meta-llama/Llama-3.3-70B-Instruct",
    "mistralai/Mixtral-8x22B-Instruct-v0.1",
    "deepseek-ai/DeepSeek-V3",
    "Qwen/Qwen2.5-72B-Instruct"
  ],
  "openrouter": [
    "anthropic/claude-3.7-sonnet",
    "openai/o3-mini",
    "google/gemini-2.5-flash",
    "meta-llama/llama-3.3-70b-instruct",
    "deepseek/deepseek-r1",
    "deepseek/deepseek-chat"
  ]
};
