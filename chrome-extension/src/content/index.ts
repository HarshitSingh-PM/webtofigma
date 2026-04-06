/**
 * Web2Fig Content Script
 * Injected into web pages to capture DOM structure, styles, and assets.
 * Produces a W2FDocument that can be imported into Figma.
 */

import { CaptureEngine } from './capture-engine';
import type { W2FDocument } from './types';

// Re-export types used by the content script (bundled, not from shared)
export type { W2FDocument };

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'capture') {
    handleCapture(message).then(sendResponse).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Async response
  }

  if (message.action === 'ping') {
    sendResponse({ alive: true });
    return false;
  }
});

async function handleCapture(message: {
  captureMode: 'full-page' | 'viewport' | 'selection';
  deviceType?: 'desktop' | 'tablet' | 'mobile';
}): Promise<{ success: boolean; document?: W2FDocument; error?: string }> {
  try {
    const engine = new CaptureEngine();
    const doc = await engine.capture({
      mode: message.captureMode || 'full-page',
      deviceType: message.deviceType,
    });
    return { success: true, document: doc };
  } catch (err: any) {
    console.error('[Web2Fig] Capture error:', err);
    return { success: false, error: err.message };
  }
}
