#!/usr/bin/env node
/**
 * E2E test for Kimi K2.6 on Wafer (pass.wafer.ai).
 *
 * Tests:
 * 1. Basic streaming with reasoning prompt (delta.reasoning / reasoning_content)
 * 2. Non-streaming (reasoning_content structure)
 * 3. Preserved Thinking via thinking.keep="all"
 * 4. Preserved Thinking via chat_template_kwargs
 */

const API_KEY = process.env.WAFER_SERVERLESS_API_KEY;
const MODEL = process.env.MODEL || "Kimi-K2.6";
const BASE_URL = "https://pass.wafer.ai/v1/chat/completions";

if (!API_KEY) {
  console.error("❌ WAFER_SERVERLESS_API_KEY is not set.");
  process.exit(1);
}

async function streamRequest(label, body) {
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  TEST: ${label}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`═══════════════════════════════════════════════════`);

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "Wafer-ZDR": "required",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ HTTP ${res.status}: ${text}`);
    return { ok: false, error: text };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let reasoningChunks = [];
  let contentChunks = [];
  let hasDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            hasDone = true;
            continue;
          }
          try {
            const obj = JSON.parse(payload);
            const delta = obj.choices?.[0]?.delta || {};
            if (delta.reasoning) reasoningChunks.push(delta.reasoning);
            if (delta.content) contentChunks.push(delta.content);
          } catch {}
        }
      }
    }
  } catch (e) {
    console.error(`💥 Stream error: ${e.message}`);
  } finally {
    reader.releaseLock();
  }

  console.log(`  Reasoning chunks:  ${reasoningChunks.length}`);
  console.log(`  Content chunks:      ${contentChunks.length}`);
  console.log(`  [DONE] seen:       ${hasDone}`);

  if (reasoningChunks.length > 0) {
    console.log(`\n  --- First reasoning chunk ---`);
    console.log(`  ${reasoningChunks[0].substring(0, 200)}`);
  }
  if (contentChunks.length > 0) {
    const fullContent = contentChunks.join("");
    console.log(`\n  --- Final content (first 300 chars) ---`);
    console.log(`  ${fullContent.substring(0, 300)}`);
  }

  return { ok: true, reasoning: reasoningChunks, content: contentChunks };
}

async function nonStreamRequest(label, body) {
  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  TEST: ${label}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`═══════════════════════════════════════════════════`);

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "Wafer-ZDR": "required",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`❌ HTTP ${res.status}: ${JSON.stringify(data)}`);
    return { ok: false, error: data };
  }

  const choice = data.choices?.[0];
  const msg = choice?.message || {};

  console.log(`  keys:                ${JSON.stringify(Object.keys(msg))}`);
  console.log(`  has reasoning_content: ${"reasoning_content" in msg}`);
  console.log(`  has reasoning:         ${"reasoning" in msg}`);
  if (msg.reasoning_content) {
    console.log(`  reasoning_content len: ${msg.reasoning_content.length}`);
    console.log(`  --- reasoning_content (first 300) ---`);
    console.log(`  ${msg.reasoning_content.substring(0, 300)}`);
  }
  if (msg.reasoning) {
    console.log(`  reasoning: ${msg.reasoning.substring(0, 300)}`);
  }
  console.log(`  content: ${(msg.content || "").substring(0, 300)}`);
  console.log(`  usage: ${JSON.stringify(data.usage)}`);

  return { ok: true, message: msg, usage: data.usage };
}

async function main() {
  console.log(`E2E Testing Kimi K2.6 on Wafer`);
  console.log(`Base URL: ${BASE_URL}`);

  // Test 1: Basic streaming
  await streamRequest("Basic stream (reasoning prompt)", {
    model: MODEL,
    messages: [{ role: "user", content: "What is 13 × 17? Show your reasoning." }],
    max_tokens: 500,
    stream: true,
  });

  // Test 2: Non-streaming
  await nonStreamRequest("Non-stream (inspect structure)", {
    model: MODEL,
    messages: [{ role: "user", content: "What is 13 × 17? Show your reasoning." }],
    max_tokens: 500,
    stream: false,
  });

  // Test 3: Preserved Thinking via extra_body thinking.keep
  const r3 = await streamRequest("Stream with thinking.keep='all' (extra_body)", {
    model: MODEL,
    messages: [
      { role: "user", content: "Tell me three random numbers." },
      {
        role: "assistant",
        reasoning_content: "I generated five numbers and told the first three: 473, 921, 235, and the other two were 215, 222.",
        content: "473, 921, 235",
      },
      { role: "user", content: "What are the other two numbers you have in mind?" },
    ],
    max_tokens: 500,
    stream: true,
    extra_body: { thinking: { type: "enabled", keep: "all" } },
  });

  if (r3.ok && r3.content.length > 0) {
    const fullContent = r3.content.join("");
    const got215 = fullContent.includes("215");
    const got222 = fullContent.includes("222");
    console.log(`\n  🧪 Preserved Thinking (extra_body) check: mentions 215=${got215}, mentions 222=${got222}`);
  }

  // Test 4: Preserved Thinking via chat_template_kwargs
  const r4 = await streamRequest("Stream with chat_template_kwargs preserve_thinking", {
    model: MODEL,
    messages: [
      { role: "user", content: "Tell me three random numbers." },
      {
        role: "assistant",
        reasoning_content: "I generated five numbers and told the first three: 473, 921, 235, and kept 215 and 222 hidden.",
        content: "473, 921, 235",
      },
      { role: "user", content: "What are the other two numbers you have in mind?" },
    ],
    max_tokens: 500,
    stream: true,
    extra_body: { chat_template_kwargs: { thinking: true, preserve_thinking: true } },
  });

  if (r4.ok && r4.content.length > 0) {
    const fullContent = r4.content.join("");
    const got215 = fullContent.includes("215");
    const got222 = fullContent.includes("222");
    console.log(`\n  🧪 Preserved Thinking (chat_template_kwargs) check: mentions 215=${got215}, mentions 222=${got222}`);
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`  E2E Test Complete`);
  console.log(`═══════════════════════════════════════════════════`);
}

main().catch((e) => { console.error(e); process.exit(1); });
