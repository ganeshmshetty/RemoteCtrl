# RemCtrl Smart Workflow Architecture

This document outlines the proposed "Smart Recipe" architecture for the RemCtrl workflow engine, moving beyond the simple one-shot execution model and differentiating workflows clearly from autonomous agents.

## Core Philosophy: Workflows vs. Agents

| Feature | Agent | Smart Workflow |
|---|---|---|
| **Mental Model** | *"Here's a goal, figure it out"* | *"Here's my recipe, run it every time"* |
| **Control Flow** | LLM decides dynamically | Human-defined sequence with explicit branches |
| **Predictability** | Variable (adaptive) | Deterministic (reliable) |
| **Caching** | Usually none (thinks fresh) | Aggressive (skips LLM on known pages) |

Workflows should feel like a **cooking recipe**—a fixed sequence of human-readable steps that run the same way every time, failing predictably and recovering intelligently.

---

## 1. Simplified, Human-Centric Step Types

The internal `act`, `observe`, and `extract` actions expose automation concepts to the user. The new model uses dead-simple, intent-based types:

- 🌐 **Go to**: URL input only. Translates to `page.goto()`. (No LLM).
- 👆 **Do**: Plain English action ("Click the login button"). Translates to `stagehand.act()`.
- 📋 **Collect**: Plain English extraction ("Get all unread emails"). Translates to `stagehand.extract()`.
- 🔀 **Check**: Conditional branching ("Is there a cookie banner?"). Determines the next step to execute based on a condition.
- 🔗 **Send to**: *(Planned)* External webhook or integration (e.g., Slack, Notion).

**No Loops:** Loops are an "Agent" feature. If a task requires dynamic looping (e.g., "for each company, do X"), it should be handled by the Agent, not a static Workflow.

---

## 2. The 3-Layer Execution Architecture

To make workflows foolproof without relying entirely on the LLM every run, execution is divided into three layers:

### Layer 1: Cache Layer (Speed & Reliability)
- **Concept:** If a step is executed on a page that looks identical to a previous successful run, skip the LLM.
- **Mechanism:** Before executing an extraction or complex action, compute a `PageFingerprint` (hashed accessibility tree/visible text). Check a local file cache keyed by `(InstructionHash + PageFingerprint)`.
- **Result:** Cache hit returns instantly. Cache miss falls through to Layer 2.

### Layer 2: Execution Layer (Stagehand & LLM)
- **Concept:** When a cache miss occurs, use Stagehand to execute the step.
- **Stagehand Enhancements:**
  - `cacheDir`: Enable Stagehand's built-in selector caching.
  - `selfHeal: true`: Allow Stagehand to auto-recover if a cached selector becomes stale.
  - **Singleton:** Maintain a single Stagehand instance instead of creating one per command, saving ~500ms initialization time and accumulating cache context.

### Layer 3: Recovery Layer (Resilience)
- **Concept:** When Layer 2 fails, classify the error and apply a specific fix rather than blindly retrying or crashing.
- **Classifications:**
  - *Element not found* → Run `observe()` to find candidates, rephrase, and retry.
  - *Stall* → Navigate away or refresh, then retry.
  - *Rate Limit (429)* → Apply exponential backoff.
- **Fallback Policy:** If recovery fails after one attempt, fall back to the step's `onFailure` policy (`stop` workflow or `skip` step).

---

## 3. Data Model (Proposed)

```typescript
export type StepType = 'navigate' | 'do' | 'collect' | 'check' | 'send';

export interface WorkflowStep {
  id: string;
  type: StepType;
  
  // Navigate
  url?: string;
  
  // Do, Collect, Check
  instruction?: string;
  
  // Check (Branching)
  onTrue?: string;   // step id to jump to
  onFalse?: string;  // step id to jump to
  
  // Recovery Policy
  onFailure: 'stop' | 'skip';
  
  // Cache Control
  cacheEnabled: boolean;
}
```

## 4. Edge Cases & Step Execution (The "Mini-Agent" Wrapper)

A major challenge with workflows is that plain-English instructions often imply multiple atomic browser actions or hide complex edge cases. We solve this by treating each step as a bounded "mini-agent" rather than a strict 1-to-1 mapping to a browser API call.

### The "Do" Node: Multi-Action Instructions
- **The Problem:** A user writes `"Type 'Playwright' in the search bar and click search"`. Stagehand's `act()` is atomic and will only execute the typing, missing the click.
- **The Solution (Mini-Agent Wrapper):** A `Do` node is wrapped in a tight ReAct loop (max ~3-4 actions). 
  - Iteration 1: LLM executes `fill("Playwright")`.
  - Iteration 2: Loop prompts LLM again. LLM sees typing is done, executes `click("search")`.
  - Iteration 3: LLM evaluates goal as complete and emits `GOAL_ACHIEVED`.
- **Result:** The node represents a *logical* step to the user, handled smoothly even if it takes 2-3 clicks to fulfill.

### The "Collect" Node: Pagination & Dynamic Loads
- **The Problem:** A user writes `"Get all product names"`, but the page uses infinite scroll or has a "Load More" button. A single `extract()` will only get the first 10 visible items.
- **The Solution:** The `Collect` step supports a `paginate` flag under the hood. If enabled, the wrapper detects if all expected elements are gathered. If not, it executes a scroll or clicks "Next", accumulates the results, and combines them into a single structured JSON array for the user. 

### The "Check" Node: Race Conditions & Popups
- **The Problem:** A user writes `"Is there a cookie banner?"`. If the page takes 2 seconds to render the banner, the `Check` node might fire immediately, see no banner, and incorrectly jump to the `onFalse` branch.
- **The Solution:** The `Check` node implements **implicit polling** (similar to Playwright's `expect.toBeVisible()`). Instead of a one-shot check, it observes the DOM state for a defined settling window (e.g., up to 3 seconds) before finalizing a `False` condition.

### The "Go to" Node: Auth Walls & Interstitials
- **The Problem:** A user instructs `"Go to https://dashboard.example.com"`, but the site redirects to a login page or shows a full-page promotional interstitial.
- **The Solution:** The `Go to` step doesn't just call `page.goto()`. After navigation, it compares the expected domain/path against the actual resulting URL. If redirected to a known auth wall (and auth isn't part of the recipe), it can explicitly trigger a pause for human intervention or inject a pre-configured session cookie.

---

## Summary of Implementation Steps (When Ready)

1. **Stagehand Singleton & Native Caching**: Update `browser-manager.ts` and initialization to use a single Stagehand instance with `cacheDir` and `selfHeal`.
2. **New Step Types & Wrapper**: Update `types.ts` and migrate away from `act/observe/extract`, implementing the "mini-agent" wrapper for `Do` nodes.
3. **Workflow Editor UI**: Create a visual builder for the new step types (Go To, Do, Collect, Check, Send).
4. **Step-Result Caching**: Implement a custom `workflow-cache.ts` for caching `collect` step outputs based on DOM fingerprints.
