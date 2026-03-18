import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { toolDefinitions, getToolsForPlan, executeTool } from './tools/index';
import { saveMessage, getHistory } from './db/schema';
import { log } from './logger';
import { UserContext } from './context';

const MAX_TOOL_OUTPUT = 2000;

const SYSTEM_PROMPT = `You are Jarvis — a persistent, autonomous job-search agent running 24/7.

Your mission: help the user land a job by:
- Finding recruiters on LinkedIn and sending personalized messages
- Keeping track of all outreach in the database
- Following up with recruiters who have not replied
- Updating the user's resume on Overleaf when asked
- Managing job-related emails via Gmail
- Providing daily summaries and stats

Rules:
- Be concise and action-oriented. Use *bold* for names and important info.
- For greetings like "hi", "hey", "hello": just respond with a short friendly greeting and ask how you can help. Do NOT call any tools for greetings.
- Only call tools when the user explicitly asks you to do something (search, message, check stats, etc.).
- NEVER invent or guess credentials, URLs, emails, or profile links. Only use what the user provides or what tools return.
- CRITICAL: If linkedin_login returns a verification/2FA challenge, STOP immediately. Tell the user to check their email/phone and send you the code. Do NOT call linkedin_verify yourself — WAIT for the user to send the code in their next message. NEVER use a dummy code like "123456".
- When asked to message someone on LinkedIn: ALWAYS search first to get their exact profile URL, then use that URL to message them. Never guess profile URLs.
- linkedin_login uses stored credentials — never pass email or password yourself.
- Always complete tasks fully in one response. Never say you will do something later.`;

function truncate(text: string, max: number = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n... [truncated]';
}

// ── Token cost tracking ──

let sessionTokens = { input: 0, output: 0, cost: 0, provider: '' };

function resetTokenTracking() {
  sessionTokens = { input: 0, output: 0, cost: 0, provider: '' };
}

function getCostSuffix(): string {
  if (!sessionTokens.provider) return '';
  const costStr = sessionTokens.cost > 0
    ? `$${sessionTokens.cost.toFixed(4)}`
    : 'free';
  return `\n\n_${sessionTokens.provider} | ${sessionTokens.input} in / ${sessionTokens.output} out | ${costStr}_`;
}

// ── Convert tool definitions to Anthropic format ──

function getAnthropicTools(ctx: UserContext) {
  const tools = getToolsForPlan(ctx);
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as any,
  }));
}

// ── LLM Providers ──

async function callClaude(
  messages: any[],
  systemPrompt: string,
  ctx: UserContext
): Promise<{ content: string | null; toolCalls: any[] | null }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const anthropicMessages: any[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }],
      });
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      const contentBlocks: any[] = [];
      if (msg.content) contentBlocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
      anthropicMessages.push({ role: 'assistant', content: contentBlocks });
      continue;
    }

    anthropicMessages.push({ role: msg.role, content: msg.content });
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: anthropicMessages,
    tools: getAnthropicTools(ctx),
  });

  const usage = response.usage;
  const inputCost = (usage.input_tokens / 1_000_000) * 3;
  const outputCost = (usage.output_tokens / 1_000_000) * 15;
  sessionTokens.input += usage.input_tokens;
  sessionTokens.output += usage.output_tokens;
  sessionTokens.cost += inputCost + outputCost;
  sessionTokens.provider = 'Claude';
  log.info(`Claude tokens: ${usage.input_tokens} in / ${usage.output_tokens} out | $${(inputCost + outputCost).toFixed(4)}`);

  let textContent = '';
  const toolCalls: any[] = [];

  for (const block of response.content) {
    if (block.type === 'text') textContent += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }

  return {
    content: textContent || null,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
  };
}

async function callGroq(
  messages: any[],
  model: string,
  ctx: UserContext
): Promise<{ content: string | null; toolCalls: any[] | null }> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const planTools = getToolsForPlan(ctx);
  const response = await groq.chat.completions.create({
    model,
    messages,
    tools: planTools,
    tool_choice: 'auto',
    max_tokens: 4096,
  });

  const choice = response.choices[0];
  const msg = choice.message;
  const usage = response.usage;

  if (usage) {
    sessionTokens.input += usage.prompt_tokens || 0;
    sessionTokens.output += usage.completion_tokens || 0;
  }
  sessionTokens.provider = `Groq ${model.includes('70b') ? '70B' : '8B'}`;

  return {
    content: msg.content || null,
    toolCalls: msg.tool_calls || null,
  };
}

async function callGemini(messages: any[]): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  const prompt = messages
    .map((m: any) => {
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join('\n\n');

  const result = await model.generateContent(prompt);
  sessionTokens.provider = 'Gemini';
  return result.response.text();
}

// ── Smart LLM call with fallback ──

async function callLLM(
  messages: any[],
  needsTools: boolean,
  ctx: UserContext
): Promise<{ content: string | null; toolCalls: any[] | null }> {
  // Chain: Groq 70B (free+tools) → Claude (paid+tools) → Groq 8B (free, text only) → Gemini (free, text only)

  // 1. Try Groq 70B (free, good at tools)
  try {
    log.info('Calling Groq 70B...');
    const result = await callGroq(messages, 'llama-3.3-70b-versatile', ctx);
    log.info('Groq 70B responded', result.toolCalls ? `with ${result.toolCalls.length} tool call(s)` : '(text only)');
    return result;
  } catch (e: any) {
    log.warn('Groq 70B failed:', e.message?.slice(0, 150));
  }

  // 2. If we need tool calls, use Claude (reliable). Otherwise try cheaper options first.
  if (needsTools) {
    try {
      log.info('Calling Claude (paid, tool-capable fallback)...');
      const result = await callClaude(messages, SYSTEM_PROMPT, ctx);
      log.info('Claude responded', result.toolCalls ? `with ${result.toolCalls.length} tool call(s)` : '(text only)');
      return result;
    } catch (e: any) {
      log.warn('Claude failed:', e.message?.slice(0, 150));
    }
  }

  // 3. Try Groq 8B (free, OK for text, weak at tools)
  try {
    log.info('Calling Groq 8B...');
    const result = await callGroq(messages, 'llama-3.1-8b-instant', ctx);
    log.info('Groq 8B responded', result.toolCalls ? `with ${result.toolCalls.length} tool call(s)` : '(text only)');
    return result;
  } catch (e: any) {
    log.warn('Groq 8B failed:', e.message?.slice(0, 150));
  }

  // 4. Gemini (free, text only)
  try {
    log.info('Trying Gemini...');
    const text = await callGemini(messages);
    log.info('Gemini responded, length:', text.length);
    return { content: text, toolCalls: null };
  } catch (e: any) {
    log.warn('Gemini failed:', e.message?.slice(0, 150));
  }

  // 5. Last resort: Claude for text if we haven't tried it yet
  if (!needsTools) {
    try {
      log.info('Calling Claude (last resort)...');
      const result = await callClaude(messages, SYSTEM_PROMPT, ctx);
      return result;
    } catch (e: any) {
      log.warn('Claude failed:', e.message?.slice(0, 150));
    }
  }

  throw new Error('All LLM providers failed');
}

// ── Main agent loop ──

export async function runAgent(userMessage: string, ctx: UserContext): Promise<string> {
  const sessionId = ctx.userId;
  saveMessage(ctx.userId, sessionId, 'user', userMessage);
  resetTokenTracking();

  const history = getHistory(ctx.userId, sessionId, 10);
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h: any) => ({ role: h.role, content: h.content })),
  ];

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  let finalResponse = '';
  const maxRounds = ctx.limits.agentRounds;

  for (let round = 0; round < maxRounds; round++) {
    log.info(`Agent round ${round + 1}/${maxRounds}`);

    let content: string | null = null;
    let toolCalls: any[] | null = null;

    const needsTools = round > 0;

    try {
      const result = await callLLM(messages, needsTools || round === 0, ctx);
      content = result.content;
      toolCalls = result.toolCalls;
    } catch (e: any) {
      log.error('All providers failed:', e.message);
      finalResponse = '⚠️ All AI providers are currently unavailable. Please try again in a few minutes.';
      break;
    }

    // If no tool calls, this is the final response
    if (!toolCalls || toolCalls.length === 0) {
      finalResponse = content || 'No response generated.';
      break;
    }

    // Push assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: content || '',
      tool_calls: toolCalls,
    });

    // Execute each tool call
    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      let fnArgs: Record<string, any> = {};

      try {
        fnArgs = JSON.parse(tc.function.arguments);
      } catch (e) {
        log.error(`Failed to parse args for ${fnName}:`, tc.function.arguments);
        fnArgs = {};
      }

      log.info(`Executing tool: ${fnName}`, JSON.stringify(fnArgs).slice(0, 200));
      const result = await executeTool(fnName, fnArgs, ctx);
      const truncatedResult = truncate(result);
      log.info(`Tool ${fnName} result:`, truncatedResult.slice(0, 300));

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: truncatedResult,
      });

      // 2FA detection — break immediately
      if (
        truncatedResult.includes('requires verification') ||
        truncatedResult.includes('verification challenge') ||
        truncatedResult.includes('Check your email/phone for a code')
      ) {
        log.info('Agent: 2FA challenge detected — breaking to ask user for code');
        finalResponse = truncatedResult;
        break;
      }
    }

    if (finalResponse) break;

    if (round === maxRounds - 1) {
      finalResponse = content || 'Completed tool operations.';
    }
  }

  // Append token cost
  finalResponse += getCostSuffix();

  if (finalResponse) {
    saveMessage(ctx.userId, sessionId, 'assistant', finalResponse);
  }

  return finalResponse;
}
