/**
 * Web2Fig Figma Plugin — Main entry point.
 * Receives W2F documents from the UI and creates Figma nodes.
 */

import { DesignBuilder } from './design-builder';
import { FontLoader } from './font-loader';

figma.showUI(__html__, {
  width: 480,
  height: 720,
  title: 'Web2Fig — Import Web Design',
  themeColors: true,
});

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'import') {
    await handleImport(msg.document, msg.deviceType, msg.pageName);
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }

  if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  }
};

async function handleImport(
  document: any,
  deviceType: 'desktop' | 'tablet' | 'mobile',
  pageName?: string,
) {
  try {
    figma.ui.postMessage({ type: 'status', text: 'Loading fonts...', progress: 5 });

    // Load fonts
    const fontLoader = new FontLoader();
    await fontLoader.loadFonts((document.assets && document.assets.fonts) || []);

    figma.ui.postMessage({ type: 'status', text: 'Building design...', progress: 20 });

    // Use the actual captured dimensions — no scaling needed
    // since the Chrome extension already clamps to viewport width
    const capturedWidth = (document.root && document.root.width) ||
                          (document.viewport && document.viewport.width) || 1440;
    const capturedHeight = (document.viewport && document.viewport.height) ||
                           (document.root && document.root.height) || 900;

    const deviceNames: Record<string, string> = {
      desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile',
    };

    const rootFrame = figma.createFrame();
    rootFrame.name = (deviceNames[deviceType] || 'Desktop') + ' - ' + capturedWidth + 'px';
    rootFrame.resize(capturedWidth, capturedHeight);
    rootFrame.x = 0;
    rootFrame.y = 0;
    rootFrame.clipsContent = false;

    figma.ui.postMessage({ type: 'status', text: 'Creating layers...', progress: 30 });

    // Build the design tree
    const builder = new DesignBuilder(document, deviceType, fontLoader);
    await builder.buildTree(document.root, rootFrame, 0, 0);

    figma.ui.postMessage({ type: 'status', text: 'Loading images...', progress: 75 });

    // Process background image fills
    await builder.processImageFills();

    // Move fixed/sticky elements (navbars) to top of z-order
    builder.reorderFixedElements();

    figma.ui.postMessage({ type: 'status', text: 'Finalizing...', progress: 95 });

    // Auto-resize rootFrame to fit ALL nested content (recursive)
    function findMaxExtent(node: SceneNode): { bottom: number; right: number } {
      let bottom = node.y + node.height;
      let right = node.x + node.width;
      if ('children' in node) {
        for (const child of (node as FrameNode).children) {
          const ext = findMaxExtent(child);
          // Convert child's extent to parent's coordinate space
          const childBottom = node.y + ext.bottom;
          const childRight = node.x + ext.right;
          if (childBottom > bottom) bottom = childBottom;
          if (childRight > right) right = childRight;
        }
      }
      return { bottom, right };
    }

    let maxBottom = capturedHeight;
    for (let i = 0; i < rootFrame.children.length; i++) {
      const ext = findMaxExtent(rootFrame.children[i]);
      if (ext.bottom > maxBottom) maxBottom = ext.bottom;
    }
    rootFrame.resize(capturedWidth, maxBottom);
    rootFrame.clipsContent = true;

    // Zoom to fit
    figma.viewport.scrollAndZoomIntoView([rootFrame]);

    const stats = builder.imageStats;
    const imgInfo = `Images: ${stats.loaded}/${stats.total} loaded` +
      (stats.failed > 0 ? `, ${stats.failed} failed` : '');

    figma.ui.postMessage({
      type: 'complete',
      text: `Imported "${document.title}" as ${rootFrame.name}. ${imgInfo}`,
      nodeCount: builder.getNodeCount(),
    });

    // Show errors if any
    if (stats.errors.length > 0) {
      figma.notify(`Web2Fig: ${imgInfo}. Errors: ${stats.errors.slice(0, 3).join(' | ')}`, { timeout: 10000 });
    } else {
      figma.notify(`Web2Fig: ${builder.getNodeCount()} layers, ${imgInfo}`);
    }
  } catch (err: any) {
    console.error('[Web2Fig] Import error:', err);
    figma.ui.postMessage({ type: 'error', text: err.message });
    figma.notify('Web2Fig: Import failed — ' + err.message, { error: true });
  }
}

// Handle menu commands
if (figma.command === 'about') {
  figma.notify('Web2Fig v1.0.0 — Convert web pages to Figma designs. MCP-enabled.');
  figma.closePlugin();
}
