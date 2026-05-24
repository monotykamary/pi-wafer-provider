# pi-wafer-provider

A [pi](https://github.com/badlogic/pi-mono) extension that registers [Wafer](https://wafer.ai) as a custom provider. Supports both **Wafer Pass** and **Wafer Serverless** offerings simultaneously. Access Qwen3.5-397B-A17B, GLM-5.1, Kimi K2.6, and DeepSeek-V4-Pro models through a unified OpenAI-compatible API.

## Features

- **Dual Provider Support** — Use Wafer Pass and Wafer Serverless side by side
- **Fast Open-Source Models** via Wafer subscription
- **Unified API** via Wafer's OpenAI-compatible completions endpoint
- **Cost Tracking** with per-model pricing for budget management
- **Reasoning Models** support for advanced reasoning capabilities
- **Vision Support** for Qwen3.5 (image + text input)

## Providers

This extension registers two providers:

| Provider | API Key Env Var | Auth JSON Key |
|----------|----------------|---------------|
| `wafer-pass` | `WAFER_API_KEY` | `wafer-pass` |
| `wafer-serverless` | `WAFER_SERVERLESS_API_KEY` | `wafer-serverless` |

Use `/model` in pi to select a model from either provider. You can configure one or both — they operate independently.

## Installation

### Option 1: Using `pi install` (Recommended)

Install directly from GitHub:

```bash
pi install https://github.com/monotykamary/pi-wafer-provider
```

Then set your API keys and run pi:
```bash
# Recommended: add to auth.json
# See Authentication section below

# Or set as environment variables
export WAFER_API_KEY=your-pass-key
export WAFER_SERVERLESS_API_KEY=your-serverless-key

pi
```

### Option 2: Manual Clone

1. Clone this repository:
   ```bash
   git clone https://github.com/monotykamary/pi-wafer-provider.git
   cd pi-wafer-provider
   ```

2. Set your Wafer API keys:
   ```bash
   # Recommended: add to auth.json
   # See Authentication section below

   # Or set as environment variables
   export WAFER_API_KEY=your-pass-key
   export WAFER_SERVERLESS_API_KEY=your-serverless-key
   ```

3. Run pi with the extension:
   ```bash
   pi -e /path/to/pi-wafer-provider
   ```

## Available Models

Models shown below are available on both Pass and Serverless. The Serverless offering may include additional models not listed here — use `/model` to discover them.

| Model | Type | Context | Max Output | Input Cost | Output Cost | Cached Input |
|-------|------|---------|------------|------------|-------------|--------------|
| GLM 5.1 | Text | 203K | 33K | $1.50 | $4.50 | $0.15 |
| Kimi K2.6 | Text | 262K | 33K | $1.10 | $4.80 | $0.11 |
| Qwen 3.5 397B (A17B) | Text + Image | 262K | 33K | $0.60 | $3.60 | $0.06 |
| Qwen3.6 35B A3B | Text | 262K | 16K | Free | Free | Free |

*Costs are per million tokens. Prices based on official provider pricing.*

## Usage

After loading the extension, use the `/model` command in pi to select your preferred model:

```
/model
```

Then select `wafer-pass` or `wafer-serverless` as the provider and choose from the available models.

## Authentication

API keys can be configured in multiple ways (resolved in this order):

1. **`auth.json`** (recommended) — Add to `~/.pi/agent/auth.json`:
   ```json
   {
     "wafer-pass":        { "type": "api_key", "key": "your-pass-key" },
     "wafer-serverless":  { "type": "api_key", "key": "your-serverless-key" }
   }
   ```
   The `key` field supports literal values, env var names, and shell commands (prefix with `!`). You can reference an env var by name:
   ```json
   { "wafer-pass": { "type": "api_key", "key": "WAFER_PASS_API_KEY" } }
   ```
   See [pi's auth file docs](https://github.com/badlogic/pi-mono) for details.
2. **Runtime override** — Use the `--api-key` CLI flag
3. **Environment variable** — Set `WAFER_API_KEY` (pass) or `WAFER_SERVERLESS_API_KEY` (serverless)

## Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `WAFER_API_KEY` | `wafer-pass` | Pass API key (env var fallback; for backwards compat) |
| `WAFER_PASS_API_KEY` | `wafer-pass` | Pass API key via auth.json ref (use `"key": "WAFER_PASS_API_KEY"`) |
| `WAFER_SERVERLESS_API_KEY` | `wafer-serverless` | Serverless API key |

## Configuration

Add to your pi configuration for automatic loading:

```json
{
  "extensions": [
    "/path/to/pi-wafer-provider"
  ]
}
```

## License

MIT
