# Mach Design

An agentic design tool that runs entirely in the browser and talks directly to models on your local network. No backend, no cloud API keys — you bring the model, the UI connects to it.

## What it does

Mach Design is a canvas-based design environment powered by a local LLM. You describe what you want in the chat panel; the agent produces HTML/CSS designs, stores files in a project workspace, and renders the output live on the canvas. You can then tweak the design directly on the canvas with block-level editing, or keep iterating through chat.

**Three panels:**

- **Chat** — conversational interface to the agent. Describe what you want, request changes, iterate.
- **Canvas** — live render of the agent's output. Supports direct block editing (background, typography, spacing) without going back to chat.
- **File Browser** — a project workspace backed by the browser's Origin Private File System (OPFS). Stores inputs, intermediary files, and final outputs. The agent can read from and write to it as part of its tool loop.

## How it works

The browser talks directly to your local model server via the OpenAI-compatible API. There is no proxy or backend — requests go straight from the page to your model. This means:

- Your data stays local
- No API costs
- Works with any OpenAI-compatible server (Ollama, LM Studio, vLLM, etc.)

Point it at your model endpoint in Settings and you're ready.

## Stack

- **Next.js 16** — app router, React 19
- **Tailwind CSS v4** — utility-first styling
- **shadcn/ui** — component primitives
- **openai** JS SDK — browser-side, pointed at your local endpoint
- **react-resizable-panels** — resizable workspace layout
- **OPFS** — browser-native persistent filesystem for the file browser

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), go to Settings, and enter your local model server URL (e.g. `http://localhost:11434/v1` for Ollama).

Your model server needs CORS enabled for the browser to reach it. For Ollama, set `OLLAMA_ORIGINS=*` before starting the server.
