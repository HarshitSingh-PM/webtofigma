/**
 * CaptureService — Headless browser capture using Puppeteer.
 * Captures web pages and produces W2F documents.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

const DEVICE_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

interface CaptureOptions {
  url: string;
  deviceType: 'desktop' | 'tablet' | 'mobile';
  fullPage: boolean;
  waitFor: number;
  outputPath?: string;
}

export interface CaptureResult {
  id: string;
  url: string;
  title: string;
  deviceType: string;
  filePath: string;
  nodeCount: number;
  imageCount: number;
  fontCount: number;
  capturedAt: string;
  document: any;
}

export class CaptureService {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.connected) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });
    }
    return this.browser;
  }

  async capture(options: CaptureOptions): Promise<CaptureResult> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      const viewport = DEVICE_VIEWPORTS[options.deviceType];
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: options.deviceType === 'mobile' ? 2 : 1,
      });

      // Navigate to URL
      await page.goto(options.url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      // Wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, options.waitFor));

      // Disable animations
      await page.addStyleTag({
        content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }',
      });

      // Capture screenshot
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: options.fullPage,
        encoding: 'base64',
      });

      // Get page title
      const title = await page.title();

      // Execute DOM capture in the page context
      const captureResult = await page.evaluate(captureDOM);

      // Build W2F document
      const id = randomUUID().substring(0, 8);
      const w2fDoc = {
        version: '1.0.0',
        generator: 'web2fig-mcp-server',
        capturedAt: new Date().toISOString(),
        url: options.url,
        title: title || new URL(options.url).hostname,
        viewport: {
          ...viewport,
          devicePixelRatio: options.deviceType === 'mobile' ? 2 : 1,
          deviceType: options.deviceType,
        },
        screenshot: `data:image/png;base64,${screenshot}`,
        root: captureResult.root,
        assets: captureResult.assets,
        colorPalette: captureResult.colorPalette,
        metadata: {
          captureMode: options.fullPage ? 'full-page' : 'viewport',
          deviceType: options.deviceType,
          theme: captureResult.theme,
          userAgent: await page.evaluate(() => navigator.userAgent),
        },
      };

      // Save file
      const capturesDir = options.outputPath
        ? path.dirname(options.outputPath)
        : path.join(os.homedir(), '.web2fig', 'captures');

      fs.mkdirSync(capturesDir, { recursive: true });

      const hostname = new URL(options.url).hostname.replace(/\./g, '_');
      const fileName = options.outputPath
        ? path.basename(options.outputPath)
        : `${hostname}_${options.deviceType}_${id}.w2f`;
      const filePath = options.outputPath || path.join(capturesDir, fileName);

      fs.writeFileSync(filePath, JSON.stringify(w2fDoc, null, 2));

      return {
        id,
        url: options.url,
        title: w2fDoc.title,
        deviceType: options.deviceType,
        filePath,
        nodeCount: captureResult.nodeCount,
        imageCount: Object.keys(captureResult.assets.images).length,
        fontCount: captureResult.assets.fonts.length,
        capturedAt: w2fDoc.capturedAt,
        document: w2fDoc,
      };
    } finally {
      await page.close();
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

/**
 * This function runs inside the browser page context via page.evaluate().
 * It captures the entire DOM tree with styles.
 */
function captureDOM(): {
  root: any;
  assets: { images: Record<string, any>; fonts: any[] };
  colorPalette: any[];
  theme: string;
  nodeCount: number;
} {
  const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'head', 'noscript', 'template', 'slot', 'br', 'wbr']);
  const images: Record<string, any> = {};
  const fonts: any[] = [];
  const fontSet = new Set<string>();
  const colorMap = new Map<string, { color: any; count: number }>();
  let nodeCount = 0;
  let imageCounter = 0;

  function parseCSSColor(cssColor: string): { r: number; g: number; b: number; a: number } {
    const fallback = { r: 0, g: 0, b: 0, a: 1 };
    if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') return { ...fallback, a: 0 };

    const rgbaMatch = cssColor.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (rgbaMatch) {
      return {
        r: parseInt(rgbaMatch[1]) / 255,
        g: parseInt(rgbaMatch[2]) / 255,
        b: parseInt(rgbaMatch[3]) / 255,
        a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
      };
    }
    return fallback;
  }

  function extractFills(style: CSSStyleDeclaration): any[] {
    const fills: any[] = [];
    const bg = style.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const color = parseCSSColor(bg);
      if (color.a > 0) fills.push({ type: 'SOLID', color });
    }
    return fills;
  }

  function extractStrokes(style: CSSStyleDeclaration): any[] {
    const w = parseFloat(style.borderTopWidth) || 0;
    if (w > 0 && style.borderTopStyle !== 'none') {
      return [{ color: parseCSSColor(style.borderTopColor), weight: w, position: 'INSIDE' }];
    }
    return [];
  }

  function extractEffects(style: CSSStyleDeclaration): any[] {
    const effects: any[] = [];
    if (style.boxShadow && style.boxShadow !== 'none') {
      // Simplified shadow parsing
      effects.push({ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.15 }, offsetX: 0, offsetY: 2, blur: 4, spread: 0 });
    }
    return effects;
  }

  function collectImage(el: HTMLImageElement): string | null {
    try {
      const src = el.currentSrc || el.src;
      if (!src) return null;
      const ref = `img_${++imageCounter}`;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = el.naturalWidth || el.width || 1;
        canvas.height = el.naturalHeight || el.height || 1;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(el, 0, 0);
          images[ref] = { data: canvas.toDataURL('image/png'), mimeType: 'image/png', width: canvas.width, height: canvas.height };
          return ref;
        }
      } catch { /* CORS */ }
      images[ref] = { data: src, mimeType: 'image/png', width: el.naturalWidth || el.width, height: el.naturalHeight || el.height };
      return ref;
    } catch { return null; }
  }

  function generateName(el: Element, tag: string): string {
    const NAMES: Record<string, string> = {
      header: 'Header', nav: 'Navigation', main: 'Main Content', footer: 'Footer',
      aside: 'Sidebar', section: 'Section', article: 'Article', form: 'Form',
      button: 'Button', a: 'Link', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
      h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', p: 'Paragraph',
      img: 'Image', ul: 'List', ol: 'Ordered List', li: 'List Item',
      input: 'Input', div: 'Container', span: 'Text',
    };
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.substring(0, 40);
    if (NAMES[tag]) return NAMES[tag];
    if (el.id) return el.id.replace(/[-_]/g, ' ').substring(0, 40);
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : '';
    if (cls && cls.length > 2) return cls.replace(/[-_]/g, ' ').substring(0, 40);
    return 'Frame';
  }

  function captureNode(el: Element, depth: number): any | null {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    nodeCount++;

    const isText = el.children.length === 0 && !!el.textContent?.trim();
    const isImg = tag === 'img' || tag === 'picture';
    const isSvg = tag === 'svg';
    const type = isImg ? 'IMAGE' : isSvg ? 'SVG' : isText ? 'TEXT' : 'FRAME';

    const fills = extractFills(style);
    const strokes = extractStrokes(style);
    const effects = extractEffects(style);

    // Track colors
    for (const f of fills) {
      if (f.type === 'SOLID') {
        const key = `${f.color.r.toFixed(2)},${f.color.g.toFixed(2)},${f.color.b.toFixed(2)}`;
        const existing = colorMap.get(key);
        if (existing) existing.count++; else colorMap.set(key, { color: f.color, count: 1 });
      }
    }

    const br = {
      topLeft: parseFloat(style.borderTopLeftRadius) || 0,
      topRight: parseFloat(style.borderTopRightRadius) || 0,
      bottomRight: parseFloat(style.borderBottomRightRadius) || 0,
      bottomLeft: parseFloat(style.borderBottomLeftRadius) || 0,
    };
    const hasBR = br.topLeft || br.topRight || br.bottomRight || br.bottomLeft;

    const node: any = {
      id: `w2f_${nodeCount}`,
      type,
      name: generateName(el, tag),
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: true,
      opacity: parseFloat(style.opacity) || 1,
      clipContent: style.overflow === 'hidden',
      fills,
      strokes,
      effects,
      children: [],
      htmlTag: tag,
    };

    if (hasBR) node.borderRadius = br;
    if (el.id) node.htmlId = el.id;

    // Auto-layout for flex containers
    if (style.display === 'flex' || style.display === 'inline-flex') {
      node.autoLayout = {
        direction: style.flexDirection === 'row' || style.flexDirection === 'row-reverse' ? 'HORIZONTAL' : 'VERTICAL',
        spacing: parseFloat(style.gap) || 0,
        paddingTop: parseFloat(style.paddingTop) || 0,
        paddingRight: parseFloat(style.paddingRight) || 0,
        paddingBottom: parseFloat(style.paddingBottom) || 0,
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        mainAxisAlignment: style.justifyContent === 'center' ? 'CENTER' :
          style.justifyContent === 'flex-end' ? 'MAX' :
          style.justifyContent === 'space-between' ? 'SPACE_BETWEEN' : 'MIN',
        crossAxisAlignment: style.alignItems === 'center' ? 'CENTER' :
          style.alignItems === 'flex-end' ? 'MAX' :
          style.alignItems === 'stretch' ? 'STRETCH' : 'MIN',
        wrap: style.flexWrap === 'wrap',
      };
    }

    // Text content
    if (type === 'TEXT') {
      node.textContent = el.textContent?.trim() || '';
      const fontWeight = parseInt(style.fontWeight) || 400;
      const fontFamily = style.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
      node.textStyle = {
        fontFamily,
        fontWeight,
        fontSize: parseFloat(style.fontSize) || 16,
        lineHeight: style.lineHeight === 'normal' ? 'auto' : (parseFloat(style.lineHeight) || 'auto'),
        letterSpacing: parseFloat(style.letterSpacing) || 0,
        textAlign: style.textAlign === 'center' ? 'CENTER' : style.textAlign === 'right' ? 'RIGHT' : 'LEFT',
        textDecoration: 'NONE',
        textTransform: 'NONE',
        color: parseCSSColor(style.color),
        fontStyle: style.fontStyle === 'italic' ? 'italic' : 'normal',
      };

      const fontKey = `${fontFamily}-${fontWeight}-${style.fontStyle}`;
      if (!fontSet.has(fontKey)) {
        fontSet.add(fontKey);
        (fonts as any[]).push({ family: fontFamily, weight: fontWeight, style: style.fontStyle === 'italic' ? 'italic' : 'normal', isSystem: true });
      }
    }

    // Image
    if (type === 'IMAGE' && el instanceof HTMLImageElement) {
      const ref = collectImage(el);
      if (ref) { node.imageRef = ref; node.imageScaleMode = 'FILL'; }
    }

    // SVG
    if (type === 'SVG') {
      node.svgContent = (el as SVGElement).outerHTML;
    }

    // Recurse children
    if (type === 'FRAME') {
      for (const child of el.children) {
        const childNode = captureNode(child, depth + 1);
        if (childNode) node.children.push(childNode);
      }
    }

    return node;
  }

  // Detect theme
  const bgColor = window.getComputedStyle(document.body).backgroundColor;
  const bgMatch = bgColor.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  const luminance = bgMatch
    ? (parseInt(bgMatch[1]) * 299 + parseInt(bgMatch[2]) * 587 + parseInt(bgMatch[3]) * 114) / 1000
    : 255;
  const theme = luminance < 128 ? 'dark' : 'light';

  const root = captureNode(document.body, 0);

  // Build color palette
  const palette = Array.from(colorMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([_, { color, count }], i) => ({ name: `Color ${i + 1}`, color, count }));

  return {
    root: root || { id: 'w2f_root', type: 'FRAME', name: 'Root', x: 0, y: 0, width: 0, height: 0, visible: true, opacity: 1, fills: [], strokes: [], effects: [], children: [] },
    assets: { images, fonts: fonts as any[] },
    colorPalette: palette,
    theme,
    nodeCount,
  };
}
