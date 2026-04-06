# Web2Fig — Web Page to Figma Design Converter

Convert any web page into a fully editable Figma design with proper layers, naming, and auto-layout.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Chrome Extension│     │    MCP Server     │     │  Figma Plugin   │
│                 │     │                  │     │                 │
│ • DOM Capture   │────▶│ • capture_webpage │────▶│ • .w2f Import   │
│ • Style Extract │     │ • import_to_figma│     │ • Layer Builder │
│ • Asset Collect │     │ • WebSocket Bridge│◀───│ • Auto-Layout   │
│ • .w2f Export   │     │ • Puppeteer      │     │ • Font Mapping  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Components

### 1. Chrome Extension (`chrome-extension/`)
- **MV3** Chrome extension with keyboard shortcuts
- Captures DOM tree with computed styles, images, fonts
- Generates `.w2f` files (open JSON format)
- Shortcuts: `Alt+Shift+F` (full page), `Alt+Shift+V` (viewport)

### 2. Figma Plugin (`figma-plugin/`)
- Imports `.w2f` files with drag-and-drop
- Device-responsive: Desktop (1440px), Tablet (768px), Mobile (375px)
- Semantic layer naming from HTML structure
- Auto-layout from flexbox detection
- Font fallback system

### 3. MCP Server (`mcp-server/`)
- Claude Code integration via MCP protocol
- Headless capture with Puppeteer (no Chrome extension needed)
- WebSocket bridge to Figma plugin for direct imports
- Tools:
  - `capture_webpage` — Capture any URL
  - `import_to_figma` — Send capture to Figma
  - `capture_and_import` — One-step URL → Figma
  - `list_captures` / `get_capture` — Browse history
  - `bridge_status` — Check Figma connection

## Quick Start

### Install
```bash
cd web2fig
npm install
npm run build
```

### Chrome Extension
1. Build: `npm run build:chrome`
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → select `chrome-extension/dist/`

### Figma Plugin
1. Build: `npm run build:figma`
2. In Figma: Plugins → Development → Import plugin from manifest
3. Select `figma-plugin/manifest.json`

### MCP Server (Claude Code)
Add to your Claude Code config (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "web2fig": {
      "command": "node",
      "args": ["/path/to/web2fig/mcp-server/dist/index.js"]
    }
  }
}
```

Then in Claude Code:
```
"Capture https://example.com and import it to Figma as a desktop design"
```

## .w2f File Format

Open JSON format with:
- Full DOM tree with semantic names
- Computed styles (fills, strokes, effects, typography)
- Auto-layout from flexbox/grid
- Base64 images and font references
- Color palette extraction
- Device viewport metadata

## Workflow

### Manual (Chrome Extension → Figma Plugin)
1. Navigate to any web page
2. Press `Alt+Shift+F` or use the extension popup
3. A `.w2f` file downloads
4. Open the Web2Fig Figma plugin
5. Drop the `.w2f` file
6. Select device type → Import

### Automated (MCP via Claude Code)
1. Claude Code builds a UI with HTML/CSS
2. Opens it in the browser
3. MCP `capture_webpage` captures it
4. MCP `import_to_figma` sends to Figma
5. Design appears in Figma with 1:1 fidelity

## Key Advantages over html.to.design

| Feature | html.to.design | Web2Fig |
|---------|---------------|---------|
| MCP Integration | No | Yes — Claude Code native |
| File Format | Proprietary (.h2d, XOR encoded) | Open JSON (.w2f) |
| Cloud Required | Yes (Google Cloud) | No — fully local |
| Headless Capture | No | Yes — Puppeteer |
| Semantic Naming | Basic | AI-ready semantic naming |
| Claude Marketplace | No | Yes — MCP marketplace ready |
| Automated Pipeline | No | Yes — capture → import in one step |

## License

MIT
