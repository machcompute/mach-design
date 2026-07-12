# Mach Design

An agentic design tool that runs entirely in the browser and talks directly to models on your local network. No backend, no cloud API keys — you bring the model, the UI connects to it.

## What it does

Mach Design is a canvas-based design environment powered by a local LLM. You describe what you want in the chat panel; the agent produces either HTML/CSS designs or editable slide decks, stores files in a project workspace, and renders the result live on the canvas. You can then tweak an element directly, send it back to chat for another iteration, or export the finished artifact.

**Three panels:**

- **Chat** — conversational interface to the agent. Describe what you want, request changes, iterate.
- **Canvas** — live render of the agent's app or deck output. Supports direct element editing without going back to chat.
- **File Browser** — a project workspace backed by the browser's Origin Private File System (OPFS). Stores inputs, intermediary files, and final outputs. The agent can read from and write to it as part of its tool loop.

## Slide decks

Ask for a presentation, slide deck, or PowerPoint and the agent creates a canonical `*.slides.json` deck under `Outputs/`. The canvas switches to a deck view with slide thumbnails, lint problems, element editing, and element-to-chat references.

You can upload a `.potx` file in the File Browser and select **Use template in chat**. The agent inspects its size, theme, layouts, and placeholders before generating a template-bound deck. PPTX export preserves the original template masters and layouts; PDF export follows the deck's canonical content and theme.

The deck canvas downloads editable PowerPoint (`.pptx`) or vector-first PDF (`.pdf`). Deck linting flags schema/ID problems, geometry/overflow, overlap, contrast, missing image assets, and template layout or placeholder mismatches.

### Reliable deck authoring

Presentation generation uses a dedicated, incremental tool workflow rather than requiring a model to emit or read one large deck document:

1. Save a `*.outline.json` presentation outline with audience, objective, visual direction, and slide briefs.
2. Create the canonical `*.slides.json` deck from the outline; when using a POTX, inspect it first and select its layouts.
3. Add or edit slides and text, shape, image, and line elements through typed operations.
4. Run deck linting, resolve every error, then preview or export.

The harness exposes paginated deck, outline, slide, and layout indexes (20 items per page), plus a targeted single-element read for edits. Raw deck and outline JSON cannot be read or written through agent tools or generic file operations. Mutations return only affected IDs and warnings, reject invalid IDs, geometry, missing images, and template-layout errors before saving. Warnings such as likely overflow, overlap, and low contrast remain visible for review, but only errors block preview and PPTX/PDF export.

For a manual acceptance check, generate an untemplated deck and a POTX-bound deck, confirm invalid geometry or image references are rejected, confirm warning-only decks export, and confirm error-bearing decks are refused by both chat tools and canvas downloads.

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
- **pptx-kit / PptxGenJS / jsPDF** — browser-side template-aware PPTX and PDF export

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), go to Settings, and enter your local model server URL (e.g. `http://localhost:11434/v1` for Ollama).

Your model server needs CORS enabled for the browser to reach it. For Ollama, set `OLLAMA_ORIGINS=*` before starting the server.
