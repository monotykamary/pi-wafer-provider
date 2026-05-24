#!/usr/bin/env node
/**
 * Update Wafer models from API
 *
 * Fetches models from https://pass.wafer.ai/v1/models and updates:
 * - models.json: Provider model definitions (enriched with pricing & compat)
 * - README.md: Model table in the Available Models section
 *
 * The Wafer /v1/models API returns basic model info (id, max_model_len)
 * but does NOT include pricing or max output tokens.
 * models.json is the source of truth for curated specs — the script preserves
 * existing data and only adds new models with sensible defaults.
 * Curate models.json manually after new model discovery.
 *
 * patch.json is applied at runtime by the provider — not baked into models.json.
 *
 * Requires WAFER_API_KEY environment variable.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODELS_API_URL = 'https://pass.wafer.ai/v1/models';
const MODELS_JSON_PATH = path.join(__dirname, '..', 'models.json');
const PATCH_JSON_PATH = path.join(__dirname, '..', 'patch.json');
const CUSTOM_MODELS_JSON_PATH = path.join(__dirname, '..', 'custom-models.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  console.log(`✓ Saved ${path.basename(filePath)}`);
}

// ─── API fetch ───────────────────────────────────────────────────────────────

async function fetchModels() {
  const apiKey = process.env.WAFER_API_KEY;
  if (!apiKey) {
    throw new Error('WAFER_API_KEY environment variable is required');
  }

  console.log(`Fetching models from ${MODELS_API_URL}...`);
  const response = await fetch(MODELS_API_URL, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const models = Array.isArray(data) ? data : (data.data || []);
  console.log(`✓ Fetched ${models.length} models from API`);
  return models;
}

// ─── Transform API model → models.json entry ────────────────────────────────

function transformApiModel(apiModel, existingModelsMap) {
  const id = apiModel.id;

  // Preserve existing curated data (pricing, reasoning, compat, etc.)
  if (existingModelsMap[id]) {
    const existing = { ...existingModelsMap[id] };
    // Update API-derived fields if changed
    if (apiModel.max_model_len) {
      existing.contextWindow = apiModel.max_model_len;
    }
    if (apiModel.zdr_supported !== undefined) {
      existing.compat = existing.compat || {};
      existing.compat.supportsZdr = apiModel.zdr_supported;
    }
    return existing;
  }

  // New model — sensible defaults; curate models.json manually after discovery
  const model = {
    id,
    name: generateDisplayName(id),
    reasoning: false,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: apiModel.max_model_len || 131072,
    maxTokens: 16384,
    compat: {
      maxTokensField: 'max_completion_tokens',
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsZdr: apiModel.zdr_supported,
    },
  };

  return model;
}

function generateDisplayName(id) {
  // Fallback: prettify the ID
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Patch & Custom Models ──────────────────────────────────────────────────

function applyPatch(model, patch) {
  const result = { ...model };
  if (patch.name !== undefined) result.name = patch.name;
  if (patch.reasoning !== undefined) result.reasoning = patch.reasoning;
  if (patch.input !== undefined) result.input = patch.input;
  if (patch.contextWindow !== undefined) result.contextWindow = patch.contextWindow;
  if (patch.maxTokens !== undefined) result.maxTokens = patch.maxTokens;
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
  if (patch.thinkingLevelMap !== undefined) result.thinkingLevelMap = patch.thinkingLevelMap;
  if (!result.reasoning && result.compat?.thinkingFormat) {
    delete result.compat.thinkingFormat;
  }
  if (result.compat && Object.keys(result.compat).length === 0) {
    delete result.compat;
  }
  return result;
}

function buildModels(baseModels, customModels, patchData) {
  const modelMap = new Map();
  for (const model of baseModels) {
    modelMap.set(model.id, model);
  }
  for (const [id, patchEntry] of Object.entries(patchData)) {
    const existing = modelMap.get(id);
    if (existing) {
      modelMap.set(id, applyPatch(existing, patchEntry));
    }
  }
  for (const model of customModels) {
    const existing = modelMap.get(model.id);
    const patchEntry = patchData[model.id];
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

// ─── README generation ──────────────────────────────────────────────────────

function formatContext(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return n.toString();
}

function formatCost(cost) {
  if (cost === 0) return 'Free';
  if (cost === null || cost === undefined) return '-';
  return `$${cost.toFixed(2)}`;
}

function generateReadmeTable(models) {
  const lines = [
    '| Model | Type | Context | Max Output | Input Cost | Output Cost | Cached Input |',
    '|-------|------|---------|------------|------------|-------------|--------------|',
  ];

  for (const model of models) {
    const type = model.input.includes('image') ? 'Text + Image' : 'Text';
    const context = formatContext(model.contextWindow);
    const maxOutput = formatContext(model.maxTokens);
    const inputCost = formatCost(model.cost.input);
    const outputCost = formatCost(model.cost.output);
    const cacheCost = formatCost(model.cost.cacheRead);

    lines.push(`| ${model.name} | ${type} | ${context} | ${maxOutput} | ${inputCost} | ${outputCost} | ${cacheCost} |`);
  }

  return lines.join('\n');
}

function updateReadme(models) {
  let readme = fs.readFileSync(README_PATH, 'utf8');
  const newTable = generateReadmeTable(models);

  const tableRegex = /(## Available Models\n\n)\| Model \| Type \| Context[^\n]+\|\n\|[-| ]+\|(\n\|[^\n]+\|)*\n*/;

  if (tableRegex.test(readme)) {
    readme = readme.replace(tableRegex, (match, header) => `${header}${newTable}\n\n`);
    fs.writeFileSync(README_PATH, readme);
    console.log('✓ Updated README.md');
  } else {
    console.warn('⚠ Could not find model table in "## Available Models" section');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const apiModels = await fetchModels();

    // Load existing models.json — source of truth for curated specs
    const existingModels = loadJson(MODELS_JSON_PATH);
    const existingModelsMap = {};
    for (const m of (Array.isArray(existingModels) ? existingModels : [])) {
      existingModelsMap[m.id] = m;
    }

    // Transform API models, preserving existing data where available
    let models = apiModels.map(m =>
      transformApiModel(m, existingModelsMap)
    );

    // Live API is authoritative — models absent from API are removed
    // (embedded data is already used for enrichment in transformApiModel)

    // Sort by model name
    models.sort((a, b) => a.name.localeCompare(b.name));

    // Save models.json (pure API output, no patch/custom baked in)
    saveJson(MODELS_JSON_PATH, models);

    // Build full model list for README: base → patch → custom
    const patchData = loadJson(PATCH_JSON_PATH);
    const customModels = loadJson(CUSTOM_MODELS_JSON_PATH);
    const readmeModels = buildModels(models, Array.isArray(customModels) ? customModels : [], patchData);
    readmeModels.sort((a, b) => a.name.localeCompare(b.name));

    // Update README
    updateReadme(readmeModels);

    // Summary
    const newIds = new Set(models.map(m => m.id));
    const oldIds = new Set(Object.keys(existingModelsMap));
    const added = [...newIds].filter(id => !oldIds.has(id));
    const removed = [...oldIds].filter(id => !newIds.has(id));

    console.log('\n--- Summary ---');
    console.log(`Total models: ${models.length}`);
    console.log(`Vision models: ${models.filter(m => m.input.includes('image')).length}`);
    if (added.length > 0) console.log(`New models: ${added.join(', ')} — curate models.json manually`);
    if (removed.length > 0) console.log(`Removed models: ${removed.join(', ')}`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
