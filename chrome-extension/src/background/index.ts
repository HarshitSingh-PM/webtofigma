/**
 * Web2Fig Background Service Worker
 *
 * Architecture:
 * 1. Content script captures DOM tree with image URLs (no fetching, fast)
 * 2. Background script receives lightweight document
 * 3. Background script fetches ALL images via CDP Page.getResourceContent
 *    (reads from browser cache, bypasses CORS completely)
 * 4. Background script embeds base64 images into document
 * 5. Downloads complete .w2f file
 */

export {};

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-full') {
    await startCapture('full-page');
  } else if (command === 'capture-viewport') {
    await startCapture('viewport');
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'start-capture') {
    startCapture(message.captureMode, message.deviceType)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.action === 'get-status') {
    sendResponse({ status: captureState.status, progress: captureState.progress });
    return false;
  }
  if (message.action === 'mcp-capture') {
    handleMCPCapture(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

interface CaptureState {
  status: 'idle' | 'capturing' | 'processing' | 'downloading' | 'complete' | 'error';
  progress: number;
  error?: string;
}

const captureState: CaptureState = { status: 'idle', progress: 0 };

function updateState(update: Partial<CaptureState>) {
  Object.assign(captureState, update);
  chrome.runtime.sendMessage({ action: 'state-update', ...captureState }).catch(() => {});
}

// ─────────────────────────────────────────────
// CDP Helpers
// ─────────────────────────────────────────────

async function cdpSend(tabId: number, method: string, params?: any): Promise<any> {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

let debuggerAttachedTabId: number | null = null;

async function attachDebugger(tabId: number): Promise<void> {
  if (debuggerAttachedTabId === tabId) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttachedTabId = tabId;
  } catch {
    // Already attached, that's fine
    debuggerAttachedTabId = tabId;
  }
}

async function detachDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch { /* */ }
  debuggerAttachedTabId = null;
}

// ─────────────────────────────────────────────
// Main Capture Flow
// ─────────────────────────────────────────────

async function startCapture(
  captureMode: 'full-page' | 'viewport' | 'selection',
  deviceType?: 'desktop' | 'tablet' | 'mobile',
): Promise<{ success: boolean; error?: string }> {
  let tabId: number | undefined;

  try {
    updateState({ status: 'capturing', progress: 0 });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found');
    tabId = tab.id;

    const tabUrl = tab.url || '';
    if (tabUrl.startsWith('chrome://') || tabUrl.startsWith('chrome-extension://') ||
        tabUrl.startsWith('edge://') || tabUrl.startsWith('about:') ||
        tabUrl.startsWith('chrome-search://') || tabUrl === '') {
      throw new Error('Cannot capture this page. Please navigate to a website first.');
    }

    updateState({ progress: 5 });

    // Wait for SPA rendering — Angular/React/Next.js apps fetch API data
    // and render components dynamically. We need to wait for this to complete.
    // 5 seconds is enough for most SPAs to finish their initial render cycle.
    await new Promise((r) => setTimeout(r, 5000));

    updateState({ progress: 10 });

    // Step 1: Inject and run content script — main frame only (avoid extension iframes)
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['content.js'] });

    updateState({ progress: 15 });

    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'capture',
      captureMode,
      deviceType,
    });

    if (!response.success) throw new Error(response.error || 'Capture failed');

    const doc = response.document;
    updateState({ progress: 40, status: 'processing' });

    // Step 2: Attach CDP debugger and fetch all images from browser cache
    await attachDebugger(tabId);

    try {
      await cdpSend(tabId, 'Page.enable');

      // Get resource tree to find cached resources
      let resourceMap: Map<string, string> | undefined;
      try {
        const tree = await cdpSend(tabId, 'Page.getResourceTree');
        const frameId = tree.frameTree.frame.id;
        resourceMap = new Map();

        // Build URL -> frameId map from resource tree
        collectResources(tree.frameTree, frameId, resourceMap);
      } catch {
        resourceMap = undefined;
      }

      // Collect all image URLs from the document
      const imageUrls = collectImageUrls(doc);
      updateState({ progress: 50 });
      chrome.runtime.sendMessage({ action: 'image-progress', loaded: 0, total: imageUrls.length }).catch(() => {});

      // Fetch images via CDP and regular fetch in parallel
      const totalImages = imageUrls.length;
      let fetched = 0;
      let fetchedOk = 0;
      const fetchErrors: string[] = [];

      const batchSize = 8;
      for (let i = 0; i < imageUrls.length; i += batchSize) {
        const batch = imageUrls.slice(i, i + batchSize);
        await Promise.all(batch.map(async ({ ref, url }) => {
          try {
            const data = await fetchImageData(tabId!, url, resourceMap);
            if (data) {
              doc.assets.images[ref] = {
                ...doc.assets.images[ref],
                data,
              };
              fetchedOk++;
            } else {
              fetchErrors.push(`NULL: ${url.substring(0, 80)}`);
            }
          } catch (e: any) {
            fetchErrors.push(`ERR(${e.message}): ${url.substring(0, 80)}`);
          }
          fetched++;
          updateState({ progress: 50 + Math.round((fetched / totalImages) * 30) });
          chrome.runtime.sendMessage({ action: 'image-progress', loaded: fetchedOk, total: totalImages, failed: fetched - fetchedOk }).catch(() => {});
        }));
      }

      // Store debug info in document for troubleshooting
      doc.metadata = doc.metadata || {};
      (doc.metadata as any)._debug = {
        totalImages,
        fetchedOk,
        failed: fetchErrors.length,
        resourceTreeSize: resourceMap ? resourceMap.size : 0,
        errors: fetchErrors.slice(0, 20),
      };
    } finally {
      await detachDebugger(tabId);
    }

    updateState({ progress: 85 });

    // Step 3: Take screenshot for preview
    try {
      doc.screenshot = await chrome.tabs.captureVisibleTab({ format: 'png', quality: 80 });
    } catch { /* */ }

    updateState({ progress: 90, status: 'downloading' });

    // Step 4: Download .w2f file
    const json = JSON.stringify(doc);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const dataUrl = `data:application/json;base64,${b64}`;

    const hostname = new URL(tabUrl).hostname.replace(/\./g, '_');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

    await chrome.downloads.download({ url: dataUrl, filename: `${hostname}_${ts}.w2f`, saveAs: true });

    try {
      await chrome.storage.local.set({ lastCapture: { document: doc, filename: `${hostname}_${ts}.w2f`, timestamp: Date.now() } });
    } catch {
      await chrome.storage.local.set({ lastCapture: { filename: `${hostname}_${ts}.w2f`, url: tabUrl, timestamp: Date.now() } });
    }

    updateState({ status: 'complete', progress: 100 });
    return { success: true };

  } catch (err: any) {
    if (tabId) await detachDebugger(tabId).catch(() => {});
    updateState({ status: 'error', error: err.message });
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────
// Image URL Collection from Document Tree
// ─────────────────────────────────────────────

function collectImageUrls(doc: any): Array<{ ref: string; url: string }> {
  const urls: Array<{ ref: string; url: string }> = [];
  const images = doc.assets?.images || {};

  for (const [ref, asset] of Object.entries(images) as Array<[string, any]>) {
    const data = asset.data;
    // Only fetch URLs, skip data URIs (already embedded)
    if (data && typeof data === 'string' && !data.startsWith('data:')) {
      urls.push({ ref, url: data });
    }
  }

  return urls;
}

// ─────────────────────────────────────────────
// Resource Tree Helpers
// ─────────────────────────────────────────────

function collectResources(frameTree: any, frameId: string, map: Map<string, string>): void {
  if (frameTree.resources) {
    for (const res of frameTree.resources) {
      if (res.url) map.set(res.url, frameId);
    }
  }
  if (frameTree.childFrames) {
    for (const child of frameTree.childFrames) {
      const childFrameId = child.frame?.id || frameId;
      collectResources(child, childFrameId, map);
    }
  }
}

// ─────────────────────────────────────────────
// Image Fetching (CDP + fetch fallback)
// ─────────────────────────────────────────────

async function fetchImageData(
  tabId: number,
  url: string,
  resourceMap?: Map<string, string>,
): Promise<string | null> {
  let absoluteUrl = url;
  if (url.startsWith('//')) absoluteUrl = 'https:' + url;
  if (!absoluteUrl.startsWith('http')) return null;

  // BEST STRATEGY: Render image to PNG canvas in the page context.
  // This converts WebP/AVIF/SVG to PNG (Figma only supports PNG/JPEG/GIF).
  // Works for same-origin and CORS-enabled images.
  try {
    const pngData = await renderImageToPNG(tabId, absoluteUrl);
    if (pngData) return pngData;
  } catch { /* fall through */ }

  // Fallback 1: CDP Page.getResourceContent (browser cache)
  if (resourceMap) {
    const frameId = resourceMap.get(absoluteUrl);
    if (frameId) {
      try {
        const result = await cdpSend(tabId, 'Page.getResourceContent', {
          frameId,
          url: absoluteUrl,
        });
        if (result && result.content && result.base64Encoded) {
          const mime = guessMimeType(absoluteUrl);
          // Only return Figma-supported formats directly
          if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') {
            return `data:${mime};base64,${result.content}`;
          }
          // Unsupported format — convert via canvas using the data URI
          const dataUri = `data:${mime};base64,${result.content}`;
          const converted = await renderImageToPNG(tabId, dataUri);
          if (converted) return converted;
        }
      } catch { /* fall through */ }
    }
  }

  // Fallback 2: Service worker fetch + convert if unsupported
  try {
    const fetched = await fetchWithServiceWorker(absoluteUrl);
    if (fetched) {
      const mimeMatch = fetched.match(/^data:([^;]+)/);
      const mime = mimeMatch ? mimeMatch[1] : '';
      if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') {
        return fetched;
      }
      // Unsupported format — convert via canvas
      const converted = await renderImageToPNG(tabId, fetched);
      if (converted) return converted;
    }
  } catch { /* */ }

  // Fallback 3: Screenshot the image element directly via CDP
  // This captures rendered pixels regardless of CORS — works for any visible image
  try {
    const screenshotData = await screenshotImageElement(tabId, absoluteUrl);
    if (screenshotData) return screenshotData;
  } catch { /* */ }

  return null;
}

/**
 * Render any image to PNG using a canvas in the page context via CDP.
 * Handles WebP, AVIF, SVG — anything the browser can render.
 * Returns data:image/png;base64,... or null.
 */
async function renderImageToPNG(tabId: number, url: string): Promise<string | null> {
  try {
    const result = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `
        new Promise(function(resolve) {
          var url = ${JSON.stringify(url)};
          var img = new Image();
          // Only set crossOrigin for http URLs, not for data URIs
          if (url.indexOf('http') === 0) {
            img.crossOrigin = 'anonymous';
          }
          img.onload = function() {
            try {
              var w = img.naturalWidth || img.width || 1;
              var h = img.naturalHeight || img.height || 1;
              // Limit canvas size (max 4096px per side)
              var maxDim = 4096;
              if (w > maxDim || h > maxDim) {
                var scale = Math.min(maxDim / w, maxDim / h);
                w = Math.round(w * scale);
                h = Math.round(h * scale);
              }
              // Minimum 1x1
              w = Math.max(1, w);
              h = Math.max(1, h);
              var c = document.createElement('canvas');
              c.width = w;
              c.height = h;
              var ctx = c.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              // Use JPEG for large images to reduce size
              var format = (w * h > 1000000) ? 'image/jpeg' : 'image/png';
              var quality = (format === 'image/jpeg') ? 0.85 : undefined;
              resolve(c.toDataURL(format, quality));
            } catch(e) { resolve(null); }
          };
          img.onerror = function() { resolve(null); };
          img.src = url;
          setTimeout(function() { resolve(null); }, 8000);
        })
      `,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = result && result.result && result.result.value;
    if (value && typeof value === 'string' && value.startsWith('data:image/')) {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Screenshot an image element directly using CDP Page.captureScreenshot.
 * Finds the <img> element with the given src, gets its bounding box,
 * and captures a screenshot of just that region. Works regardless of CORS.
 */
async function screenshotImageElement(tabId: number, url: string): Promise<string | null> {
  try {
    // Find the image element and get its bounding box
    const boxResult = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `
        (function() {
          var imgs = document.querySelectorAll('img');
          for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            if ((img.src === ${JSON.stringify(url)} || img.currentSrc === ${JSON.stringify(url)}) && img.naturalWidth > 0) {
              var rect = img.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return {
                  x: rect.left + window.scrollX,
                  y: rect.top + window.scrollY,
                  width: rect.width,
                  height: rect.height,
                  scrollX: window.scrollX,
                  scrollY: window.scrollY
                };
              }
            }
          }
          return null;
        })()
      `,
      returnByValue: true,
    });

    const box = boxResult && boxResult.result && boxResult.result.value;
    if (!box || box.width <= 0 || box.height <= 0) return null;

    // Scroll the element into view first
    await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `window.scrollTo(0, ${Math.max(0, box.y - 100)})`,
    });
    await new Promise(r => setTimeout(r, 200));

    // Recalculate position after scroll
    const newBoxResult = await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `
        (function() {
          var imgs = document.querySelectorAll('img');
          for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i];
            if ((img.src === ${JSON.stringify(url)} || img.currentSrc === ${JSON.stringify(url)}) && img.naturalWidth > 0) {
              var rect = img.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
              }
            }
          }
          return null;
        })()
      `,
      returnByValue: true,
    });

    const newBox = newBoxResult && newBoxResult.result && newBoxResult.result.value;
    if (!newBox || newBox.width <= 0 || newBox.height <= 0 || newBox.y < 0) return null;

    // Capture screenshot of just this region
    const screenshot = await cdpSend(tabId, 'Page.captureScreenshot', {
      format: 'png',
      clip: {
        x: Math.max(0, newBox.x),
        y: Math.max(0, newBox.y),
        width: Math.min(newBox.width, 4096),
        height: Math.min(newBox.height, 4096),
        scale: 1,
      },
    });

    if (screenshot && screenshot.data) {
      // Scroll back to top
      await cdpSend(tabId, 'Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
      return `data:image/png;base64,${screenshot.data}`;
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchWithServiceWorker(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return `data:${guessMimeType(url)};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function guessMimeType(url: string): string {
  const l = url.toLowerCase();
  if (l.includes('.png')) return 'image/png';
  if (l.includes('.jpg') || l.includes('.jpeg')) return 'image/jpeg';
  if (l.includes('.gif')) return 'image/gif';
  if (l.includes('.webp')) return 'image/webp';
  if (l.includes('.svg')) return 'image/svg+xml';
  if (l.includes('.avif')) return 'image/avif';
  if (l.includes('.apng')) return 'image/apng';
  if (l.includes('.tiff') || l.includes('.tif')) return 'image/tiff';
  if (l.includes('.heic')) return 'image/heic';
  if (l.includes('.heif')) return 'image/heif';
  if (l.includes('.bmp')) return 'image/bmp';
  if (l.includes('.ico')) return 'image/x-icon';
  if (l.includes('.jfif')) return 'image/jpeg';
  if (l.includes('.jp2')) return 'image/jp2';
  if (l.includes('.jxl')) return 'image/jxl';
  return 'image/png';
}

/** Check if a MIME type is natively supported by Figma's createImage() */
function isFigmaSupported(mime: string): boolean {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif';
}

// ─────────────────────────────────────────────
// MCP Handler
// ─────────────────────────────────────────────

async function handleMCPCapture(message: {
  url?: string;
  captureMode?: 'full-page' | 'viewport' | 'selection';
  deviceType?: 'desktop' | 'tablet' | 'mobile';
}): Promise<{ success: boolean; document?: any; error?: string }> {
  if (message.url) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: message.url });
      await new Promise<void>((resolve) => {
        const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const result = await startCapture(message.captureMode || 'full-page', message.deviceType);
  if (result.success) {
    const stored = await chrome.storage.local.get('lastCapture');
    return { success: true, document: stored.lastCapture?.document };
  }
  return result;
}
