# RemCtrl Agent Architecture

This document outlines the architectural patterns and best practices for the autonomous Agent feature in RemCtrl, based on industry standards (e.g., Stagehand, browser-use, MultiOn, LaVague). 

Unlike deterministic Workflows (which execute a fixed recipe), Agents are designed to handle complex, open-ended tasks ("Find the cheapest flight to Tokyo") by reasoning about the page state and acting dynamically.

## Core Philosophy: Agents vs. Workflows

| Feature | Smart Workflow | Agent |
|---|---|---|
| **Mental Model** | *"Here's my recipe, run it every time"* | *"Here's a goal, figure it out"* |
| **Control Flow** | Human-defined sequence with explicit branches | LLM decides dynamically (ReAct loop) |
| **Predictability** | Deterministic (reliable) | Variable (adaptive) |
| **Caching** | Aggressive (skips LLM on known pages) | Minimal (needs to adapt to unknown pages) |

## 1. Goal Decomposition (Planning & Reactivity)

Modern agents do not pre-plan a strict 30-step sequence because the web is too unpredictable. Instead, they use a **hybrid approach**:
- **High-Level Planning:** The agent (via `task-planner.ts`) decomposes a massive goal into smaller, logical subtasks.
- **Reactive Execution (ReAct):** For each subtask, the agent observes the current DOM, decides the immediate next action, executes it, and re-evaluates. 
- **Dynamic Resolution:** Using Stagehand primitives (`act`, `extract`), the agent maps fuzzy goals to concrete browser interactions on the fly.

## 2. Context Management (Memory without Bloat)

Managing context across long runs without exceeding LLM token limits requires aggressive filtering:
- **Accessibility Trees:** Instead of raw HTML, the agent parses the Chrome Accessibility Tree (or uses Stagehand's observation features) to see only interactive elements (buttons, links, inputs).
- **Rolling Action Log:** The orchestrator maintains a condensed summary of past actions ("Clicked Login -> Success", "Typed Email -> Success") rather than keeping the full DOM history of every step.

## 3. Recovery & Self-Correction

Agents are inherently resilient because they are state-driven, but they need guardrails to prevent infinite loops:
- **The Observe-Evaluate Loop:** After every action, the agent verifies if the expected change occurred.
- **Cycle Detection:** The `StallDetector` monitors the page fingerprint (DOM hash + URL) over time. If the agent repeats the same action or cycles between identical states, the detector throws a stall error.
- **Self-Critique:** When a stall is detected, the `StrategyGenerator` interrupts the loop, prompts the LLM with the failure context, and asks it to formulate an alternative approach (e.g., "Clicking failed, try keyboard navigation").

## 4. Human-in-the-Loop (HITL) Handoff

When an agent encounters an insurmountable blocker (CAPTCHAs, 2FA, ambiguous choices), it must degrade gracefully rather than failing completely.
- **Detection:** The agent identifies blockers via specific cues (e.g., "Cloudflare challenge", "Enter SMS code").
- **Execution Pausing:** The main process suspends the execution loop and broadcasts a `PAUSED_FOR_HITL` state to the React renderer.
- **Manual Takeover:** The user leverages RemCtrl's existing WebRTC streaming and remote input injection to solve the CAPTCHA manually.
- **Resumption:** Once solved, the user clicks "Resume", and the agent re-observes the DOM and continues its task.

## 5. Secure Tool Use (Extensibility)

Agents can leverage external tools for tasks beyond simple browsing:
- **Function Calling:** The LLM is provided with schemas for specific tools (e.g., `calculate`, `readLocalFile`).
- **Main Process Isolation:** Tool execution happens securely in the Node.js main process, never in the React renderer. This allows the agent to scrape a web table and write it directly to the user's local disk without exposing system APIs to the browser context.

---

## Implementation Checklist for RemCtrl

1. **State Machine IPC Bridge:** Ensure a strict state machine (`IDLE`, `PLANNING`, `EXECUTING`, `PAUSED_FOR_HITL`) is synchronized between the main process orchestrator and the React UI.
2. **HITL Handoff Flow:** Polish the UX for pausing the agent, activating the manual remote control overlay, and resuming the agent.
3. **Accessibility Tree Optimization:** Transition DOM fingerprinting to prioritize the accessibility tree or visible text to save tokens and improve matching speed.
4. **Local Tools Integration:** Define a secure registry of Node-based tools (file I/O, notifications) that the LLM can call during execution.
