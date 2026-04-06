#!/usr/bin/env node
/**
 * Web2Fig MCP Server
 *
 * Exposes tools for:
 * 1. capture_webpage — Capture a web page as a .w2f file using headless Puppeteer
 * 2. import_to_figma — Send a .w2f document to the Figma plugin via WebSocket bridge
 * 3. capture_and_import — End-to-end: capture a URL and import directly into Figma
 * 4. list_captures — List recent captures
 * 5. get_capture — Get a specific capture's data
 *
 * Resources:
 * - web2fig://captures — List of all captures
 * - web2fig://captures/{id} — Individual capture data
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CaptureService } from './capture-service.js';
import { BridgeService } from './bridge-service.js';
import { CaptureStore } from './capture-store.js';

const server = new McpServer({
  name: 'web2fig',
  version: '1.0.0',
});

const captureService = new CaptureService();
const bridgeService = new BridgeService();
const captureStore = new CaptureStore();

// ─── Tool: capture_webpage ───
server.tool(
  'capture_webpage',
  'Capture a web page and convert it to a .w2f file for Figma import. Opens the URL in a headless browser, captures all DOM elements, styles, images, and layout information.',
  {
    url: z.string().url().describe('The URL of the web page to capture'),
    device_type: z.enum(['desktop', 'tablet', 'mobile']).default('desktop')
      .describe('Device viewport to capture at: desktop (1440px), tablet (768px), or mobile (375px)'),
    full_page: z.boolean().default(true)
      .describe('Capture the full scrollable page (true) or just the visible viewport (false)'),
    wait_for: z.number().default(2000)
      .describe('Milliseconds to wait after page load for dynamic content to render'),
    output_path: z.string().optional()
      .describe('File path to save the .w2f file. If omitted, saves to ~/.web2fig/captures/'),
  },
  async ({ url, device_type, full_page, wait_for, output_path }) => {
    try {
      const result = await captureService.capture({
        url,
        deviceType: device_type,
        fullPage: full_page,
        waitFor: wait_for,
        outputPath: output_path,
      });

      captureStore.add(result);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            captureId: result.id,
            filePath: result.filePath,
            url: result.url,
            title: result.title,
            deviceType: device_type,
            nodeCount: result.nodeCount,
            imageCount: result.imageCount,
            fontCount: result.fontCount,
            message: `Captured "${result.title}" (${result.nodeCount} layers, ${result.imageCount} images). File saved to: ${result.filePath}`,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }],
        isError: true,
      };
    }
  },
);

// ─── Tool: import_to_figma ───
server.tool(
  'import_to_figma',
  'Import a .w2f capture file into Figma via the Web2Fig Figma plugin. Requires the Figma plugin to be running and connected via WebSocket bridge.',
  {
    capture_id: z.string().optional().describe('ID of a previous capture to import'),
    file_path: z.string().optional().describe('Path to a .w2f file to import'),
    device_type: z.enum(['desktop', 'tablet', 'mobile']).default('desktop')
      .describe('How to import the design: desktop (1440px frame), tablet (768px frame), or mobile (375px frame)'),
    page_name: z.string().optional().describe('Name for the Figma page'),
  },
  async ({ capture_id, file_path, device_type, page_name }) => {
    try {
      let document: any;

      if (capture_id) {
        const capture = captureStore.get(capture_id);
        if (!capture) throw new Error(`Capture ${capture_id} not found`);
        document = capture.document;
      } else if (file_path) {
        const fs = await import('fs');
        const data = fs.readFileSync(file_path, 'utf-8');
        document = JSON.parse(data);
      } else {
        throw new Error('Either capture_id or file_path must be provided');
      }

      const result = await bridgeService.sendToFigma({
        action: 'import',
        document,
        targetDeviceType: device_type,
        pageName: page_name,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: result.message || `Design imported to Figma as ${device_type}`,
            figmaConnected: bridgeService.isConnected(),
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }],
        isError: true,
      };
    }
  },
);

// ─── Tool: capture_and_import ───
server.tool(
  'capture_and_import',
  'End-to-end: Capture a web page and immediately import it into Figma. This is the one-step workflow for converting a URL to a Figma design.',
  {
    url: z.string().url().describe('The URL of the web page to capture and import'),
    device_type: z.enum(['desktop', 'tablet', 'mobile']).default('desktop')
      .describe('Device type for capture and Figma frame'),
    wait_for: z.number().default(2000)
      .describe('Milliseconds to wait after page load'),
    page_name: z.string().optional().describe('Name for the Figma page'),
  },
  async ({ url, device_type, wait_for, page_name }) => {
    try {
      // Step 1: Capture
      const capture = await captureService.capture({
        url,
        deviceType: device_type,
        fullPage: true,
        waitFor: wait_for,
      });
      captureStore.add(capture);

      // Step 2: Import to Figma
      let figmaResult: any = { message: 'Figma plugin not connected. File saved for manual import.' };
      if (bridgeService.isConnected()) {
        figmaResult = await bridgeService.sendToFigma({
          action: 'import',
          document: capture.document,
          targetDeviceType: device_type,
          pageName: page_name || capture.title,
        });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            captureId: capture.id,
            filePath: capture.filePath,
            title: capture.title,
            nodeCount: capture.nodeCount,
            figmaImported: bridgeService.isConnected(),
            message: bridgeService.isConnected()
              ? `Captured and imported "${capture.title}" to Figma (${capture.nodeCount} layers)`
              : `Captured "${capture.title}" (${capture.nodeCount} layers). File: ${capture.filePath}. Open the Figma plugin and import the .w2f file manually.`,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }],
        isError: true,
      };
    }
  },
);

// ─── Tool: list_captures ───
server.tool(
  'list_captures',
  'List all recent web page captures stored by Web2Fig.',
  {},
  async () => {
    const captures = captureStore.list();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: captures.length,
          captures: captures.map((c) => ({
            id: c.id,
            url: c.url,
            title: c.title,
            deviceType: c.deviceType,
            nodeCount: c.nodeCount,
            filePath: c.filePath,
            capturedAt: c.capturedAt,
          })),
        }, null, 2),
      }],
    };
  },
);

// ─── Tool: get_capture ───
server.tool(
  'get_capture',
  'Get details of a specific capture by ID.',
  {
    capture_id: z.string().describe('The capture ID to retrieve'),
  },
  async ({ capture_id }) => {
    const capture = captureStore.get(capture_id);
    if (!capture) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Capture ${capture_id} not found` }) }],
        isError: true,
      };
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: capture.id,
          url: capture.url,
          title: capture.title,
          filePath: capture.filePath,
          nodeCount: capture.nodeCount,
          imageCount: capture.imageCount,
          fontCount: capture.fontCount,
          capturedAt: capture.capturedAt,
          viewport: capture.document.viewport,
          colorPalette: capture.document.colorPalette?.slice(0, 5),
        }, null, 2),
      }],
    };
  },
);

// ─── Tool: bridge_status ───
server.tool(
  'bridge_status',
  'Check the status of the WebSocket bridge connection to the Figma plugin.',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          figmaConnected: bridgeService.isConnected(),
          bridgePort: bridgeService.getPort(),
          message: bridgeService.isConnected()
            ? 'Figma plugin is connected and ready for imports.'
            : 'Figma plugin is not connected. Start the Web2Fig plugin in Figma to enable direct imports.',
        }, null, 2),
      }],
    };
  },
);

// ─── Start the server ───
async function main() {
  // Start the WebSocket bridge for Figma communication
  await bridgeService.start();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[Web2Fig MCP] Server started');
}

main().catch((err) => {
  console.error('[Web2Fig MCP] Fatal error:', err);
  process.exit(1);
});
