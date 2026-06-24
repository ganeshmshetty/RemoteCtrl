import { z } from 'zod';
import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { getPreferredProvider, getApiKey } from './storage.js';

export interface ParsedInstruction {
  /** If set, navigate to this URL first before doing anything else. */
  navigationUrl: string | null;
  /**
   * The action to perform after navigation (or the full instruction if
   * there is no navigation component). Pass this to stagehand.act().
   */
  remainingAction: string;
  /**
   * True when this instruction is purely a navigation (no follow-up action).
   * In this case remainingAction will be empty.
   */
  navigationOnly: boolean;
}

/**
 * Parses an agent instruction dynamically using an LLM.
 * Separates navigation intent from post-navigation actions.
 *
 * Examples:
 *   "go to youtube.com and play a good song"
 *     → { navigationUrl: "https://www.youtube.com", remainingAction: "play a good song" }
 *
 *   "open google and search for cats"
 *     → { navigationUrl: "https://www.google.com", remainingAction: "search for cats" }
 *
 *   "go to https://example.com"
 *     → { navigationUrl: "https://example.com", remainingAction: "", navigationOnly: true }
 *
 *   "click the login button"
 *     → { navigationUrl: null, remainingAction: "click the login button", navigationOnly: false }
 */
export async function parseInstruction(instruction: string, currentUrl: string = 'about:blank'): Promise<ParsedInstruction> {
  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);

  if (!apiKey) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  let model;
  if (provider === 'openai') {
    const openai = createOpenAI({ apiKey });
    model = openai('gpt-4o-mini');
  } else if (provider === 'anthropic') {
    const anthropic = createAnthropic({ apiKey });
    model = anthropic('claude-3-5-haiku-20241022');
  } else if (provider === 'gemini') {
    const google = createGoogleGenerativeAI({ apiKey });
    model = google('gemini-2.5-flash');
  } else if (provider === 'groq') {
    const groq = createGroq({ apiKey });
    model = groq('llama-3.3-70b-versatile');
  } else if (provider === 'deepseek') {
    const deepseek = createDeepSeek({ apiKey });
    model = deepseek('deepseek-chat');
  } else if (provider === 'nebius') {
    const nebius = createOpenAI({ apiKey, baseURL: 'https://api.tokenfactory.nebius.com/v1/' });
    model = nebius('meta-llama/Llama-3.3-70B-Instruct');
  } else if (provider === 'openrouter') {
    const openrouter = createOpenAI({ 
      apiKey, 
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        'HTTP-Referer': 'https://github.com/ganeshmshetty/RemCtrl',
        'X-Title': 'RemoteCtrl'
      }
    });
    model = openrouter('anthropic/claude-3.5-sonnet');
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const { object } = await generateObject({
    model,
    schema: z.object({
      navigationUrl: z
        .string()
        .url()
        .nullable()
        .describe(
          "The URL to navigate to first. Must be a full valid URL starting with https://. " +
          "If the user says a site name (e.g. 'youtube', 'youtue', 'wiki', 'wikipedia'), " +
          "infer the correct canonical URL (e.g. 'https://www.youtube.com', 'https://www.wikipedia.org'). " +
          "If the instruction is just an action on the current page (e.g. 'click login'), return null."
        ),
      remainingAction: z
        .string()
        .describe("The remaining action to take after navigation. If the instruction was solely to navigate, this should be an empty string."),
      navigationOnly: z
        .boolean()
        .describe("True if the instruction was ONLY to navigate with no follow-up action. False otherwise."),
    }),
    prompt: `Analyze the following user instruction and determine if there is an explicit or implicit navigation intent.

Current Page URL: ${currentUrl}
Instruction: "${instruction}"

Guidelines:
1. Strip any politeness phrases (like "can you", "please") and isolate the core request.
2. If the user asks to go to a website (e.g., "go to wikipedia", "open youtue"), infer the correct URL, even if there are typos.
3. If they ask to do something ON a specific website (e.g. "search for dogs on google"), extract the website as 'navigationUrl' and the remaining action as 'remainingAction'.
4. CRITICAL: If the user asks to do something on a website, but the "Current Page URL" shows they are ALREADY on that website or a related subdomain (e.g., instruction is "search for despacito on youtube" and currentUrl is "https://www.youtube.com/"), DO NOT navigate. Set navigationUrl to null and leave the whole instruction as the remainingAction.
5. If there is no navigation intent (e.g., "click the login button", "scroll down"), set navigationUrl to null.
6. If the request is JUST navigation (e.g., "go to https://example.com"), set navigationOnly to true and remainingAction to an empty string.`,
  });

  return {
    navigationUrl: object.navigationUrl,
    remainingAction: object.remainingAction,
    navigationOnly: object.navigationOnly,
  };
}
