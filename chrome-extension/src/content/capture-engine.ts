/**
 * CaptureEngine — Core DOM capture logic.
 * Traverses the DOM tree, extracts computed styles, positions, and assets.
 * Produces a W2FDocument.
 */

import type {
  W2FDocument, W2FNode, W2FFill, W2FStroke, W2FEffect,
  W2FTextStyle, W2FAutoLayout, W2FBorderRadius, W2FColor,
  W2FFont, W2FImageAsset, DeviceType, W2FNodeType,
} from './types';
import { StyleExtractor } from './style-extractor';
import { AssetCollector } from './asset-collector';
import { LayoutAnalyzer } from './layout-analyzer';
import { NodeNamer } from './node-namer';

const SKIP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'head', 'noscript',
  'template', 'slot', 'br', 'wbr',
]);

const INVISIBLE_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'head', 'title', 'base',
]);

interface CaptureOptions {
  mode: 'full-page' | 'viewport' | 'selection';
  deviceType?: DeviceType;
}

export class CaptureEngine {
  private styleExtractor = new StyleExtractor();
  private assetCollector = new AssetCollector();
  private layoutAnalyzer = new LayoutAnalyzer();
  private nodeNamer = new NodeNamer();
  private nodeIdCounter = 0;
  private colorMap = new Map<string, { color: W2FColor; count: number }>();

  async capture(options: CaptureOptions): Promise<W2FDocument> {
    const deviceType = options.deviceType || this.detectDeviceType();
    const isFullPage = options.mode === 'full-page';

    // For full-page capture, scroll to bottom then back to top to trigger lazy-loaded content
    if (isFullPage) {
      await this.triggerLazyLoading();
    }

    // Disable animations/transitions for clean capture
    this.disableAnimations();

    try {
      // Capture the root element (body, to skip <html> wrapper)
      const rootElement = document.body;
      const rootNode = await this.captureNode(rootElement, 0, 0);

      if (!rootNode) {
        throw new Error('Failed to capture root element');
      }

      // NOTE: Images are NOT fetched here. The background script will
      // fetch them via CDP after receiving this document.

      // Build color palette from collected colors
      const colorPalette = this.buildColorPalette();

      // For full-page capture, use the full document height
      const captureWidth = window.innerWidth;
      const captureHeight = isFullPage
        ? Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight,
          )
        : window.innerHeight;

      const doc: W2FDocument = {
        version: '1.0.0',
        generator: 'web2fig-chrome-extension',
        capturedAt: new Date().toISOString(),
        url: window.location.href,
        title: document.title || window.location.hostname,
        viewport: {
          width: captureWidth,
          height: captureHeight,
          devicePixelRatio: window.devicePixelRatio,
          deviceType,
        },
        root: rootNode,
        assets: {
          images: this.assetCollector.getImages(),
          fonts: this.assetCollector.getFonts(),
        },
        colorPalette,
        metadata: {
          captureMode: options.mode,
          deviceType,
          theme: this.detectTheme(),
          userAgent: navigator.userAgent,
        },
      };

      return doc;
    } finally {
      this.restoreAnimations();
    }
  }

  /**
   * Walk from root down through single-child full-width wrapper chains
   * and expand their heights to full page height.
   * Pattern: body > div#app > div.router-view > main (all viewport-height with overflow:hidden)
   */
  /**
   * Check if an element is fully outside the visible bounds of any
   * ancestor with overflow:hidden. Walks up the DOM tree to find
   * clipping ancestors (carousels, tabs, etc.).
   */
  private isClippedByAncestor(element: Element): boolean {
    const childRect = element.getBoundingClientRect();
    if (childRect.width === 0 && childRect.height === 0) return false;

    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      const style = window.getComputedStyle(ancestor);
      const clips = style.overflow === 'hidden' || style.overflow === 'clip'
        || style.overflowX === 'hidden' || style.overflowY === 'hidden';

      if (clips) {
        const ancestorRect = ancestor.getBoundingClientRect();
        // Check if child is completely outside this clipping ancestor
        const outsideX = childRect.right < ancestorRect.left - 2 || childRect.left > ancestorRect.right + 2;
        const outsideY = childRect.bottom < ancestorRect.top - 2 || childRect.top > ancestorRect.bottom + 2;
        if (outsideX || outsideY) return true;
      }

      ancestor = ancestor.parentElement;
    }
    return false;
  }

  private generateId(): string {
    return `w2f_${++this.nodeIdCounter}`;
  }

  private detectDeviceType(): DeviceType {
    const w = window.innerWidth;
    if (w <= 480) return 'mobile';
    if (w <= 1024) return 'tablet';
    return 'desktop';
  }

  private detectTheme(): 'light' | 'dark' {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    const match = bg.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    if (match) {
      const luminance = (parseInt(match[1]) * 299 + parseInt(match[2]) * 587 + parseInt(match[3]) * 114) / 1000;
      return luminance < 128 ? 'dark' : 'light';
    }
    return 'light';
  }

  /** Scroll through the entire page to trigger lazy-loaded images and content */
  private async triggerLazyLoading(): Promise<void> {
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    );
    const viewportHeight = window.innerHeight;
    const scrollStep = viewportHeight * 0.5; // Smaller steps for better lazy-load trigger

    // Pass 1: Scroll down slowly to trigger IntersectionObserver-based lazy loading
    for (let y = 0; y < totalHeight; y += scrollStep) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 300)); // Wait longer for images to start loading
    }
    window.scrollTo(0, totalHeight);
    await new Promise((r) => setTimeout(r, 500));

    // Pass 2: Scroll back up slowly — some sites lazy-load on scroll up too
    for (let y = totalHeight; y >= 0; y -= scrollStep * 2) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 200));
    }

    // Force all lazy images to load by setting their src from data-src
    try {
      const lazyImages = document.querySelectorAll('img[data-src], img[data-lazy], img[loading="lazy"]');
      lazyImages.forEach((img: Element) => {
        const htmlImg = img as HTMLImageElement;
        const dataSrc = htmlImg.getAttribute('data-src') || htmlImg.getAttribute('data-lazy');
        if (dataSrc && !htmlImg.src) {
          htmlImg.src = dataSrc;
        }
        // Remove loading=lazy to force immediate load
        htmlImg.removeAttribute('loading');
      });
      // Wait for images to load
      await new Promise((r) => setTimeout(r, 1500));
    } catch { /* */ }

    // Scroll back to top
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    await new Promise((r) => setTimeout(r, 300));
    if (window.scrollY !== 0) {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private animationStyleEl: HTMLStyleElement | null = null;

  private disableAnimations(): void {
    this.animationStyleEl = document.createElement('style');
    this.animationStyleEl.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `;
    document.head.appendChild(this.animationStyleEl);
  }

  private restoreAnimations(): void {
    if (this.animationStyleEl) {
      this.animationStyleEl.remove();
      this.animationStyleEl = null;
    }
  }

  async captureNode(
    element: Element,
    parentX: number,
    parentY: number,
    depth: number = 0,
  ): Promise<W2FNode | null> {
    const tagName = element.tagName.toLowerCase();

    // Skip invisible/irrelevant elements
    if (SKIP_TAGS.has(tagName) || INVISIBLE_TAGS.has(tagName)) return null;

    const style = window.getComputedStyle(element);

    // Skip hidden elements
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      (style.opacity === '0' && style.pointerEvents === 'none')
    ) {
      return null;
    }

    const rect = element.getBoundingClientRect();

    // Skip zero-size elements (unless they're text containers)
    if (rect.width === 0 && rect.height === 0 && !element.textContent?.trim()) {
      return null;
    }

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // For fixed/sticky elements, use viewport position only (don't add scroll offset)
    // This places navbars at y=0 regardless of scroll position during capture
    const isFixed = style.position === 'fixed' || style.position === 'sticky';
    const x = rect.left + (isFixed ? 0 : scrollX);
    const y = rect.top + (isFixed ? 0 : scrollY);

    // Determine node type
    const nodeType = this.determineNodeType(element, tagName);

    // Extract styles
    const fills = this.styleExtractor.extractFills(style, element);
    const strokes = this.styleExtractor.extractStrokes(style);
    const effects = this.styleExtractor.extractEffects(style);
    const borderRadius = this.styleExtractor.extractBorderRadius(style);
    const opacity = parseFloat(style.opacity) || 1;

    // Track colors for palette
    this.trackColors(fills, strokes);

    // Clamp dimensions: no element should exceed viewport width
    // and elements with negative x should be clamped to 0
    const vpWidth = window.innerWidth;
    let nodeX = Math.max(0, Math.round(x));
    let nodeWidth = Math.round(rect.width);
    if (nodeWidth > vpWidth) nodeWidth = vpWidth;
    if (nodeX + nodeWidth > vpWidth) nodeWidth = vpWidth - nodeX;

    // Build the node
    const node: W2FNode = {
      id: this.generateId(),
      type: nodeType,
      name: this.nodeNamer.generateName(element, tagName, depth),
      semanticTag: tagName,
      x: nodeX,
      y: Math.round(y),
      width: Math.max(1, nodeWidth),
      height: Math.round(rect.height),
      visible: true,
      opacity,
      clipContent: style.overflow === 'hidden' || style.overflow === 'clip',
      overflow: style.overflow === 'hidden' ? 'hidden' :
                style.overflow === 'scroll' || style.overflow === 'auto' ? 'scroll' : 'visible',
      fills,
      strokes,
      borderRadius,
      effects,
      children: [],
      htmlTag: tagName,
      htmlClass: element.className && typeof element.className === 'string'
        ? element.className.substring(0, 200) : undefined,
      htmlId: element.id || undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      href: element.getAttribute('href') || undefined,
    } as any;

    // Store CSS position for z-ordering in Figma
    if (isFixed) {
      (node as any).cssPosition = style.position;
    }

    // Handle rotation from CSS transform
    const rotation = this.styleExtractor.extractRotation(style);
    if (rotation !== 0) node.rotation = rotation;

    // Handle auto-layout (flexbox)
    const autoLayout = this.layoutAnalyzer.extractAutoLayout(style);
    if (autoLayout) node.autoLayout = autoLayout;

    // Handle constraints
    node.constraints = this.layoutAnalyzer.extractConstraints(style, element);

    // Handle specific node types
    if (nodeType === 'TEXT') {
      const textStyle = this.styleExtractor.extractTextStyle(style);
      const textContent = element.textContent?.trim() || '';

      // If element has background color AND text, keep as FRAME with text child
      // This preserves buttons (red bg + white text), badges, etc.
      if (node.fills.length > 0 && textContent) {
        node.type = 'FRAME';
        // Create a text child inside the frame
        const textChild: W2FNode = {
          id: this.generateId(),
          type: 'TEXT',
          name: `Text: "${textContent.substring(0, 30)}"`,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          visible: true,
          opacity: 1,
          fills: [],
          strokes: [],
          effects: [],
          textContent,
          textStyle,
          children: [],
        };
        node.children.push(textChild);
        this.assetCollector.collectFont(textStyle.fontFamily, textStyle.fontWeight, textStyle.fontStyle);
      } else {
        node.textContent = textContent;
        node.textStyle = textStyle;
        this.assetCollector.collectFont(textStyle.fontFamily, textStyle.fontWeight, textStyle.fontStyle);
      }
    } else if (nodeType === 'IMAGE') {
      const imageRef = this.assetCollector.collectImage(element as HTMLImageElement);
      if (imageRef) {
        node.imageRef = imageRef;
        node.imageScaleMode = 'FILL';
      }
    } else if (nodeType === 'SVG') {
      node.svgContent = (element as SVGElement).outerHTML;
    }

    // Handle background images
    if (style.backgroundImage && style.backgroundImage !== 'none') {
      const bgImageRef = this.assetCollector.collectBackgroundImage(style.backgroundImage);
      if (bgImageRef) {
        node.fills.push({
          type: 'IMAGE',
          imageRef: bgImageRef,
          scaleMode: this.mapBackgroundSize(style.backgroundSize),
        });
      }
    }

    // Recurse into children (skip for text-only and image nodes)
    if (nodeType !== 'TEXT' && nodeType !== 'IMAGE' && nodeType !== 'SVG') {
      await this.captureChildren(element, node, x, y, depth);
    }

    return node;
  }

  private async captureChildren(
    element: Element,
    parentNode: W2FNode,
    parentX: number,
    parentY: number,
    depth: number,
  ): Promise<void> {
    const children = element.children;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];

      // Skip children that are clipped by ANY ancestor with overflow:hidden
      if (this.isClippedByAncestor(child)) continue;

      const childNode = await this.captureNode(child, parentX, parentY, depth + 1);
      if (childNode) {
        parentNode.children.push(childNode);
      }
    }

    // Check for direct text nodes (mixed content)
    if (parentNode.children.length === 0 && element.textContent?.trim()) {
      const hasOnlyText = Array.from(element.childNodes).every(
        (n) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.COMMENT_NODE
      );
      if (hasOnlyText && element.textContent.trim()) {
        parentNode.type = 'TEXT';
        parentNode.textContent = element.textContent.trim();
        parentNode.textStyle = this.styleExtractor.extractTextStyle(
          window.getComputedStyle(element)
        );
        this.assetCollector.collectFont(
          parentNode.textStyle.fontFamily,
          parentNode.textStyle.fontWeight,
          parentNode.textStyle.fontStyle,
        );
      }
    }

    // Handle text nodes interspersed with elements
    if (parentNode.children.length > 0) {
      const textNodes: W2FNode[] = [];
      for (const childNode of element.childNodes) {
        if (childNode.nodeType === Node.TEXT_NODE && childNode.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(childNode);
          const rects = range.getClientRects();
          if (rects.length > 0) {
            const r = rects[0];
            const style = window.getComputedStyle(element);
            const textStyle = this.styleExtractor.extractTextStyle(style);
            textNodes.push({
              id: this.generateId(),
              type: 'TEXT',
              name: `Text: "${childNode.textContent.trim().substring(0, 30)}"`,
              x: Math.round(r.left + window.scrollX),
              y: Math.round(r.top + window.scrollY),
              width: Math.round(r.width),
              height: Math.round(r.height),
              visible: true,
              opacity: 1,
              fills: [],
              strokes: [],
              effects: [],
              textContent: childNode.textContent.trim(),
              textStyle,
              children: [],
              htmlTag: '#text',
            });
          }
        }
      }
      parentNode.children.push(...textNodes);
    }
  }

  private determineNodeType(element: Element, tagName: string): W2FNodeType {
    if (tagName === 'img' || tagName === 'picture') return 'IMAGE';
    if (tagName === 'svg') return 'SVG';
    if (tagName === 'canvas') return 'IMAGE';
    if (tagName === 'video') return 'IMAGE';

    // Check if element is a text-only leaf
    if (element.children.length === 0 && element.textContent?.trim()) {
      const hasNoBlockChildren = !element.querySelector('div, p, section, article, header, footer, main, aside, nav, ul, ol, table');
      if (hasNoBlockChildren) return 'TEXT';
    }

    // Inline text elements
    if (['span', 'a', 'strong', 'em', 'b', 'i', 'u', 'small', 'label'].includes(tagName)) {
      if (element.children.length === 0 && element.textContent?.trim()) {
        return 'TEXT';
      }
    }

    // Headings and paragraphs with no child elements
    if (/^h[1-6]$/.test(tagName) || tagName === 'p') {
      if (element.children.length === 0 || this.isInlineOnly(element)) {
        return 'TEXT';
      }
    }

    return 'FRAME';
  }

  private isInlineOnly(element: Element): boolean {
    const inlineTags = new Set(['span', 'a', 'strong', 'em', 'b', 'i', 'u', 'small', 'br', 'wbr', 'code', 'mark', 'sub', 'sup']);
    return Array.from(element.children).every((child) => inlineTags.has(child.tagName.toLowerCase()));
  }

  private mapBackgroundSize(bgSize: string): 'FILL' | 'FIT' | 'CROP' | 'TILE' {
    if (bgSize === 'cover') return 'FILL';
    if (bgSize === 'contain') return 'FIT';
    return 'FILL';
  }

  private trackColors(fills: W2FFill[], strokes: W2FStroke[]): void {
    for (const fill of fills) {
      if (fill.type === 'SOLID') {
        const key = `${fill.color.r.toFixed(3)},${fill.color.g.toFixed(3)},${fill.color.b.toFixed(3)}`;
        const existing = this.colorMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          this.colorMap.set(key, { color: fill.color, count: 1 });
        }
      }
    }
    for (const stroke of strokes) {
      const key = `${stroke.color.r.toFixed(3)},${stroke.color.g.toFixed(3)},${stroke.color.b.toFixed(3)}`;
      const existing = this.colorMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        this.colorMap.set(key, { color: stroke.color, count: 1 });
      }
    }
  }

  private buildColorPalette(): Array<{ name: string; color: W2FColor; count: number }> {
    const entries = Array.from(this.colorMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20);

    return entries.map(([_, { color, count }], i) => ({
      name: `Color ${i + 1}`,
      color,
      count,
    }));
  }
}
