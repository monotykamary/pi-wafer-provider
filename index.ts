/**
 * Wafer Provider Extension
 *
 * Registers Wafer Pass and Wafer Serverless as custom providers using the
 * OpenAI completions API. Both offerings share the same base URL — the API
 * key determines which models are available.
 *
 * Model resolution strategy: Stale-While-Revalidate
 *   1. Serve stale immediately: disk cache → embedded models.json (zero-latency)
 *   2. Revalidate in background: live API /models → merge with embedded → cache → hot-swap
 *   3. patch.json + custom-models.json applied on top of whichever source won
 *
 * Merge order: [live|cache|embedded] → apply patch.json → merge custom-models.json
 *
 * Providers:
 *   - wafer-pass        (WAFER_API_KEY or WAFER_PASS_API_KEY)
 *   - wafer-serverless  (WAFER_SERVERLESS_API_KEY)
 *
 * Usage:
 *   # Option 1: Store in auth.json (recommended)
 *   # Add to ~/.pi/agent/auth.json:
 *   #   "wafer-pass":        { "type": "api_key", "key": "your-wafer-pass-key" }
 *   #   "wafer-serverless":  { "type": "api_key", "key": "your-wafer-serverless-key" }
 *
 *   # To reference an env var from auth.json:
 *   #   "wafer-pass": { "type": "api_key", "key": "WAFER_PASS_API_KEY" }
 *
 *   # Option 2: Set as environment variables
 *   export WAFER_API_KEY=your-wafer-pass-key
 *   #      WAFER_PASS_API_KEY also works via auth.json (see above)
 *   export WAFER_SERVERLESS_API_KEY=your-wafer-serverless-key
 *
 *   # Run pi with the extension
 *   pi -e /path/to/pi-wafer-provider
 *
 * Then use /model to select available models:
 *   - Qwen3.5-397B-A17B (262K context)
 *   - GLM-5.1 (202K context)
 */

import type { ExtensionAPI, ModelRegistry } from "@earendil-works/pi-coding-agent";
import modelsData from "./models.json" with { type: "json" };
import customModelsData from "./custom-models.json" with { type: "json" };
import patchData from "./patch.json" with { type: "json" };
import fs from "fs";
import os from "os";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string | null>;
  providers?: string[];
  headers?: Record<string, string>;
  compat?: {
    supportsDeveloperRole?: boolean;
    supportsStore?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    thinkingFormat?: "openai" | "zai" | "qwen" | "qwen-chat-template";
    supportsReasoningEffort?: boolean;
    supportsZdr?: boolean;
  };
}

interface PatchEntry {
  name?: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
  providers?: string[];
  compat?: Record<string, unknown>;
}

type PatchData = Record<string, PatchEntry>;

// ─── Patch Application ─────────────────────────────────────────────────────────

function applyPatch(model: JsonModel, patch: PatchEntry): JsonModel {
  const result = { ...model };

  if (patch.name !== undefined) result.name = patch.name;
  if (patch.reasoning !== undefined) result.reasoning = patch.reasoning;
  if (patch.input !== undefined) result.input = patch.input;
  if (patch.contextWindow !== undefined) result.contextWindow = patch.contextWindow;
  if (patch.maxTokens !== undefined) result.maxTokens = patch.maxTokens;
  if (patch.providers !== undefined) result.providers = patch.providers;

  if (patch.cost) {
    result.cost = {
      input: patch.cost.input ?? result.cost.input,
      output: patch.cost.output ?? result.cost.output,
      cacheRead: patch.cost.cacheRead ?? result.cost.cacheRead,
      cacheWrite: patch.cost.cacheWrite ?? result.cost.cacheWrite,
    };
  }
  if (patch.compat) {
    result.compat = { ...(result.compat || {}), ...patch.compat };
  }

  if (!result.reasoning && result.compat?.thinkingFormat) {
    delete result.compat.thinkingFormat;
  }
  if (result.compat && Object.keys(result.compat).length === 0) {
    delete result.compat;
  }

  return result;
}

/** Full pipeline: base models → patch → custom → result */
function buildModels(base: JsonModel[], custom: JsonModel[], patch: PatchData): JsonModel[] {
  const modelMap = new Map<string, JsonModel>();

  for (const model of base) {
    modelMap.set(model.id, model);
  }

  for (const [id, patchEntry] of Object.entries(patch)) {
    const existing = modelMap.get(id);
    if (existing) {
      modelMap.set(id, applyPatch(existing, patchEntry));
    }
  }

  for (const model of custom) {
    const existing = modelMap.get(model.id);
    const patchEntry = patch[model.id];
    if (existing && patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else if (existing) {
      modelMap.set(model.id, model);
    } else if (patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else {
      modelMap.set(model.id, model);
    }
  }

  return Array.from(modelMap.values());
}

/** Filter models to only those belonging to the given provider, then strip the `providers` field. */
function filterModelsForProvider(models: JsonModel[], providerId: string): JsonModel[] {
  return models
    .filter((m) => !m.providers || m.providers.includes(providerId))
    .map(({ providers, ...rest }) => rest);
}

/** Apply per-model ZDR header unless the model explicitly opts out. */
function applyZdrHeaders(models: JsonModel[]): JsonModel[] {
  return models.map((model) => {
    // default: ZDR supported; omit header only if compat.supportsZdr === false
    if (model.compat?.supportsZdr === false) return model;
    return {
      ...model,
      headers: { ...(model.headers || {}), "Wafer-ZDR": "required" },
    };
  });
}

// ─── Stale-While-Revalidate Model Sync ────────────────────────────────────────

const BASE_URL = "https://pass.wafer.ai/v1";
const MODELS_URL = `${BASE_URL}/models`;
const CACHE_DIR = path.join(os.homedir(), ".pi", "agent", "cache");
const LIVE_FETCH_TIMEOUT_MS = 8000;

interface ProviderConfig {
  providerId: string;
  apiKeyEnv: string;
}

/** Transform a model from the Wafer /v1/models API. */
function transformApiModel(apiModel: any): JsonModel | null {
  return {
    id: apiModel.id,
    name: apiModel.id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: apiModel.max_model_len || 0,
    maxTokens: 0,
    compat: {
      supportsZdr: apiModel.zdr_supported ?? undefined,
      supportsReasoningEffort: true,
    },
  };
}

function getCachePath(providerId: string): string {
  return path.join(CACHE_DIR, `${providerId}-models.json`);
}

async function fetchLiveModels(apiKey: string, signal?: AbortSignal): Promise<JsonModel[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS), signal]) : AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const apiModels = Array.isArray(data) ? data : (data.data || []);
    if (!Array.isArray(apiModels) || apiModels.length === 0) return null;
    return apiModels.map(transformApiModel).filter((m): m is JsonModel => m !== null);
  } catch {
    return null;
  }
}

function loadCachedModels(providerId: string): JsonModel[] | null {
  try {
    const data = JSON.parse(fs.readFileSync(getCachePath(providerId), "utf8"));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function cacheModels(providerId: string, models: JsonModel[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(getCachePath(providerId), JSON.stringify(models, null, 2) + "\n");
  } catch {
    // Cache write failure is non-fatal
  }
}

function mergeWithEmbedded(liveModels: JsonModel[], embeddedModels: JsonModel[]): JsonModel[] {
  const embeddedMap = new Map(embeddedModels.map(m => [m.id, m]));
  const seen = new Set<string>();
  const result: JsonModel[] = [];
  for (const liveModel of liveModels) {
    const embedded = embeddedMap.get(liveModel.id);
    seen.add(liveModel.id);
    if (embedded) {
      result.push({
        ...liveModel,
        ...embedded,
        contextWindow: liveModel.contextWindow || embedded.contextWindow,
      });
    } else {
      result.push(liveModel);
    }
  }
  // Append any embedded models that the live API didn't return
  for (const em of embeddedModels) {
    if (!seen.has(em.id)) {
      result.push(em);
    }
  }
  return result;
}

function loadStaleModels(providerId: string, embeddedModels: JsonModel[]): JsonModel[] {
  const cached = loadCachedModels(providerId);
  if (!cached || cached.length === 0) return embeddedModels;

  // Merge embedded models that are missing from cache (newly added models)
  const cachedMap = new Map(cached.map(m => [m.id, m]));
  for (const em of embeddedModels) {
    if (!cachedMap.has(em.id)) {
      cached.push(em);
    }
  }
  return cached;
}

async function revalidateModels(providerId: string, apiKey: string | undefined, embeddedModels: JsonModel[], signal?: AbortSignal): Promise<JsonModel[] | null> {
  if (!apiKey) return null;
  const liveModels = await fetchLiveModels(apiKey, signal);
  if (!liveModels || liveModels.length === 0) return null;
  const merged = mergeWithEmbedded(liveModels, embeddedModels);
  cacheModels(providerId, merged);
  return merged;
}

// ─── Per-Provider State ───────────────────────────────────────────────────────

interface ProviderState {
  cachedApiKey: string | undefined;
  revalidateAbort: AbortController | null;
}

function createProviderState(): ProviderState {
  return { cachedApiKey: undefined, revalidateAbort: null };
}

async function resolveApiKey(state: ProviderState, providerId: string, modelRegistry: ModelRegistry): Promise<void> {
  state.cachedApiKey = await modelRegistry.getApiKeyForProvider(providerId) ?? undefined;
}

function registerWaferProvider(
  pi: ExtensionAPI,
  config: ProviderConfig,
  embeddedModels: JsonModel[],
  customModels: JsonModel[],
  patches: PatchData,
): void {
  const { providerId, apiKeyEnv } = config;
  const state = createProviderState();

  const staleBase = loadStaleModels(providerId, embeddedModels);
  const staleModels = filterModelsForProvider(
    buildModels(staleBase, customModels, patches),
    providerId,
  );

  pi.registerProvider(providerId, {
    baseUrl: BASE_URL,
    apiKey: apiKeyEnv,
    api: "openai-completions",
    models: applyZdrHeaders(staleModels),
  });

  pi.on("session_start", async (_event, ctx) => {
    state.revalidateAbort?.abort();
    state.revalidateAbort = new AbortController();
    const signal = state.revalidateAbort.signal;
    resolveApiKey(state, providerId, ctx.modelRegistry).then(() => {
      revalidateModels(providerId, state.cachedApiKey, embeddedModels, signal).then((freshBase) => {
        if (freshBase && !signal.aborted) {
          pi.registerProvider(providerId, {
            baseUrl: BASE_URL,
            apiKey: apiKeyEnv,
            api: "openai-completions",
            models: applyZdrHeaders(
              filterModelsForProvider(buildModels(freshBase, customModels, patches), providerId),
            ),
          });
        }
      });
    });
  });

  pi.on("session_shutdown", () => {
    state.revalidateAbort?.abort();
  });
}

// ─── Provider Definitions ────────────────────────────────────────────────────

const PROVIDERS: ProviderConfig[] = [
  { providerId: "wafer-pass", apiKeyEnv: "WAFER_API_KEY" },
  { providerId: "wafer-serverless", apiKeyEnv: "WAFER_SERVERLESS_API_KEY" },
];

// ─── Extension Entry Point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const embeddedModels = modelsData as JsonModel[];
  const customModels = customModelsData as JsonModel[];
  const patches = patchData as PatchData;

  for (const config of PROVIDERS) {
    registerWaferProvider(pi, config, embeddedModels, customModels, patches);
  }
}
