# pi-wafer-provider

A [pi](https://github.com/badlogic/pi-mono) extension that registers [Wafer Pass](https://wafer.ai) as a custom provider. Access Qwen3.5-397B-A17B, GLM-5.1, and DeepSeek-V4-Pro models through a unified OpenAI-compatible API.

## Features

- **Fast Open-Source Models** via Wafer Pass subscription
- **Unified API** via Wafer's OpenAI-compatible completions endpoint
- **Cost Tracking** with per-model pricing for budget management
- **Reasoning Models** support for advanced reasoning capabilities
- **Vision Support** for Qwen3.5 (image + text input)

## Installation

### Option 1: Using `pi install` (Recommended)

Install directly from GitHub:

```bash
pi install https://github.com/monotykamary/pi-wafer-provider
```

Then set your API key and run pi:
```bash
# Recommended: add to auth.json
# See Authentication section below

# Or set as environment variable
export WAFER_API_KEY=your-api-key-here

pi
```

### Option 2: Manual Clone

1. Clone this repository:
   ```bash
   git clone https://github.com/monotykamary/pi-wafer-provider.git
   cd pi-wafer-provider
   ```

2. Set your Wafer API key:
   ```bash
   # Recommended: add to auth.json
   # See Authentication section below

   # Or set as environment variable
   export WAFER_API_KEY=your-api-key-here
   ```

3. Run pi with the extension:
   ```bash
   pi -e /path/to/pi-wafer-provider
   ```

## Available Models

| Model | Type | Context | Max Output | Input Cost | Output Cost | Cached Input |
|-------|------|---------|------------|------------|-------------|--------------|
| GLM 5.1 | Text | 203K | 33K | $1.50 | $4.50 | $0.15 |
| Qwen 3.5 397B (A17B) | Text + Image | 262K | 33K | $0.60 | $3.60 | $0.06 |
| Qwen3.6 35B A3B | Text | 33K | 16K | Free | Free | Free |

*Costs are per million tokens. Prices based on official provider pricing.*

## Usage

After loading the extension, use the `/model` command in pi to select your preferred model:

```
/model
```

Then select "wafer" as the provider and choose from the available models.

## Authentication

The Wafer API key can be configured in multiple ways (resolved in this order):

1. **`auth.json`** (recommended) — Add to `~/.pi/agent/auth.json`:
   ```json
   { "wafer": { "type": "api_key", "key": "your-api-key" } }
   ```
   The `key` field supports literal values, env var names, and shell commands (prefix with `!`). See [pi's auth file docs](https://github.com/badlogic/pi-mono) for details.
2. **Runtime override** — Use the `--api-key` CLI flag
3. **Environment variable** — Set `WAFER_API_KEY`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WAFER_API_KEY` | No | Your Wafer Pass API key (fallback if not in auth.json) |

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
