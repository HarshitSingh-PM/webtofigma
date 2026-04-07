/**
 * DesignBuilder — Converts W2F node tree into Figma nodes.
 * Handles frames, text, images, SVG, auto-layout, fills, strokes, and effects.
 */

import { FontLoader } from './font-loader';

// Types inlined to avoid workspace dependency issues in Figma sandbox
interface W2FColor { r: number; g: number; b: number; a: number; }
interface W2FGradientStop { position: number; color: W2FColor; }
interface W2FSolidFill { type: 'SOLID'; color: W2FColor; }
interface W2FGradientFill { type: 'LINEAR_GRADIENT' | 'RADIAL_GRADIENT'; stops: W2FGradientStop[]; angle?: number; }
interface W2FImageFill { type: 'IMAGE'; imageRef: string; scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'; }
type W2FFill = W2FSolidFill | W2FGradientFill | W2FImageFill;
interface W2FStroke { color: W2FColor; weight: number; position: 'INSIDE' | 'OUTSIDE' | 'CENTER'; }
interface W2FShadow { type: 'DROP_SHADOW' | 'INNER_SHADOW'; color: W2FColor; offsetX: number; offsetY: number; blur: number; spread: number; }
interface W2FBlur { type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'; radius: number; }
type W2FEffect = W2FShadow | W2FBlur;
interface W2FBorderRadius { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number; }
interface W2FTextStyle {
  fontFamily: string; fontWeight: number; fontSize: number;
  lineHeight: number | 'auto'; letterSpacing: number;
  textAlign: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textDecoration: 'NONE' | 'UNDERLINE' | 'LINE_THROUGH';
  textTransform: 'NONE' | 'UPPERCASE' | 'LOWERCASE' | 'CAPITALIZE';
  color: W2FColor; fontStyle: 'normal' | 'italic';
}
interface W2FAutoLayout {
  direction: 'HORIZONTAL' | 'VERTICAL'; spacing: number;
  paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number;
  mainAxisAlignment: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  crossAxisAlignment: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  wrap: boolean;
}
interface W2FNode {
  id: string; type: string; name: string; semanticTag?: string;
  x: number; y: number; width: number; height: number; rotation?: number;
  visible: boolean; opacity: number; clipContent?: boolean;
  fills: W2FFill[]; strokes: W2FStroke[]; borderRadius?: W2FBorderRadius;
  effects: W2FEffect[]; autoLayout?: W2FAutoLayout;
  textContent?: string; textStyle?: W2FTextStyle;
  imageRef?: string; imageScaleMode?: string;
  svgContent?: string;
  children: W2FNode[];
  htmlTag?: string; htmlClass?: string; htmlId?: string;
}

interface W2FDocument {
  assets: {
    images: Record<string, { data: string; mimeType: string; width: number; height: number }>;
    fonts: any[];
  };
  viewport: { width: number; height: number };
}

type DeviceType = 'desktop' | 'tablet' | 'mobile';

interface AutoLayoutPending {
  node: FrameNode;
  layout: W2FAutoLayout;
}

export class DesignBuilder {
  private doc: W2FDocument;
  private deviceType: DeviceType;
  private fontLoader: FontLoader;
  private nodeCount = 0;
  private autoLayoutQueue: AutoLayoutPending[] = [];
  private pendingImageFills: Array<{ fill: any; paints: Paint[]; index: number }> = [];
  private scaleX = 1;
  private scaleY = 1;
  public imageStats = { total: 0, loaded: 0, failed: 0, errors: [] as string[] };
  private fixedElements: Array<{ node: SceneNode; parent: FrameNode }> = [];

  constructor(doc: W2FDocument, deviceType: DeviceType, fontLoader: FontLoader) {
    this.doc = doc;
    this.deviceType = deviceType;
    this.fontLoader = fontLoader;
    // 1:1 scale — Chrome extension already handles viewport sizing
    this.scaleX = 1;
    this.scaleY = 1;
  }

  getNodeCount(): number { return this.nodeCount; }

  async buildTree(
    w2fNode: W2FNode,
    parent: FrameNode | GroupNode,
    offsetX: number,
    offsetY: number,
  ): Promise<void> {
    if (!w2fNode || !w2fNode.visible) return;
    if (w2fNode.width <= 0 || w2fNode.height <= 0) return;

    const figmaNode = await this.createNode(w2fNode, offsetX, offsetY);
    if (!figmaNode) return;

    parent.appendChild(figmaNode);
    this.nodeCount++;

    // Track fixed/sticky elements for z-ordering later
    if ((w2fNode as any).cssPosition === 'fixed' || (w2fNode as any).cssPosition === 'sticky') {
      if (parent.type === 'FRAME') {
        this.fixedElements.push({ node: figmaNode, parent: parent as FrameNode });
      }
    }

    if (this.nodeCount % 50 === 0) {
      figma.ui.postMessage({
        type: 'status',
        text: `Creating layers... (${this.nodeCount})`,
        progress: Math.min(30 + (this.nodeCount / 10), 75),
      });
    }

    // Recurse into children
    if (w2fNode.children && w2fNode.children.length > 0 && figmaNode.type === 'FRAME') {
      for (const child of w2fNode.children) {
        await this.buildTree(child, figmaNode as FrameNode, w2fNode.x, w2fNode.y);
      }
    }
  }

  /** Move fixed/sticky elements to top of z-order in the root frame */
  reorderFixedElements(): void {
    for (const { node } of this.fixedElements) {
      try {
        // Walk up to find the top-level child of the root frame
        let current: SceneNode = node;
        while (current.parent && current.parent.type === 'FRAME' && current.parent.parent) {
          // Stop when parent's parent is the page (root level)
          if (current.parent.parent.type === 'PAGE') break;
          current = current.parent as SceneNode;
        }
        // Move the top-level ancestor to end of its parent's children
        if (current.parent && 'appendChild' in current.parent) {
          (current.parent as FrameNode).appendChild(current);
        }
      } catch { /* element may have been removed */ }
    }
  }

  applyAutoLayouts(): void {
    for (const { node, layout } of this.autoLayoutQueue) {
      try {
        node.layoutMode = layout.direction;
        node.itemSpacing = Math.round(layout.spacing * this.scaleX);
        node.paddingTop = Math.round(layout.paddingTop * this.scaleY);
        node.paddingRight = Math.round(layout.paddingRight * this.scaleX);
        node.paddingBottom = Math.round(layout.paddingBottom * this.scaleY);
        node.paddingLeft = Math.round(layout.paddingLeft * this.scaleX);
        node.primaryAxisAlignItems = layout.mainAxisAlignment === 'SPACE_BETWEEN'
          ? 'SPACE_BETWEEN' : layout.mainAxisAlignment;
        node.counterAxisAlignItems = layout.crossAxisAlignment === 'STRETCH'
          ? 'MIN' : layout.crossAxisAlignment;
        if (layout.wrap) {
          node.layoutWrap = 'WRAP';
        }
      } catch {
        // Auto-layout may fail if node structure is incompatible
      }
    }
  }

  private async createNode(
    w2fNode: W2FNode,
    parentX: number,
    parentY: number,
  ): Promise<SceneNode | null> {
    const x = Math.round((w2fNode.x - parentX) * this.scaleX);
    const y = Math.round((w2fNode.y - parentY) * this.scaleY);
    const w = Math.max(1, Math.round(w2fNode.width * this.scaleX));
    const h = Math.max(1, Math.round(w2fNode.height * this.scaleY));

    switch (w2fNode.type) {
      case 'TEXT':
        return this.createTextNode(w2fNode, x, y, w, h);
      case 'IMAGE':
        return this.createImageNode(w2fNode, x, y, w, h);
      case 'SVG':
        return this.createSVGNode(w2fNode, x, y, w, h);
      default:
        return this.createFrameNode(w2fNode, x, y, w, h);
    }
  }

  private createFrameNode(
    w2fNode: W2FNode, x: number, y: number, w: number, h: number,
  ): FrameNode {
    const frame = figma.createFrame();
    frame.name = w2fNode.name;
    frame.x = x;
    frame.y = y;
    frame.resize(w, h);
    // Full-width wrappers (>80% of viewport): don't clip (they constrain page flow)
    // Narrower containers (carousels, cards): respect original CSS overflow
    const viewportWidth = (this.doc.viewport && this.doc.viewport.width) || 1440;
    const isFullWidthWrapper = w2fNode.width >= viewportWidth * 0.8;
    frame.clipsContent = isFullWidthWrapper ? false : (w2fNode.clipContent || false);

    // Apply fills
    frame.fills = this.convertFills(w2fNode.fills);

    // Apply strokes
    if (w2fNode.strokes && w2fNode.strokes.length > 0) {
      const stroke = w2fNode.strokes[0];
      frame.strokes = [{ type: 'SOLID', color: this.toFigmaRGB(stroke.color), opacity: stroke.color.a }];
      frame.strokeWeight = stroke.weight;
      frame.strokeAlign = stroke.position;
    }

    // Border radius
    if (w2fNode.borderRadius) {
      frame.topLeftRadius = w2fNode.borderRadius.topLeft;
      frame.topRightRadius = w2fNode.borderRadius.topRight;
      frame.bottomRightRadius = w2fNode.borderRadius.bottomRight;
      frame.bottomLeftRadius = w2fNode.borderRadius.bottomLeft;
    }

    // Effects
    if (w2fNode.effects && w2fNode.effects.length > 0) {
      frame.effects = this.convertEffects(w2fNode.effects);
    }

    // Opacity
    if (w2fNode.opacity < 1) {
      frame.opacity = w2fNode.opacity;
    }

    // Rotation
    if (w2fNode.rotation) {
      frame.rotation = -w2fNode.rotation; // Figma uses counterclockwise
    }

    // Queue auto-layout for later application
    if (w2fNode.autoLayout) {
      this.autoLayoutQueue.push({ node: frame, layout: w2fNode.autoLayout });
    }

    return frame;
  }

  private async createTextNode(
    w2fNode: W2FNode, x: number, y: number, w: number, h: number,
  ): Promise<TextNode | FrameNode> {
    const text = w2fNode.textContent || '';
    if (!text) {
      // Empty text node — create a frame instead
      return this.createFrameNode(w2fNode, x, y, w, h);
    }

    const textNode = figma.createText();
    textNode.name = w2fNode.name;
    textNode.x = x;
    textNode.y = y;

    // Load and set font
    const style = w2fNode.textStyle;
    if (style) {
      const fontName = this.fontLoader.resolveFontName(style.fontFamily, style.fontWeight, style.fontStyle);
      try {
        await figma.loadFontAsync(fontName);
        textNode.fontName = fontName;
      } catch {
        // Fallback to Inter
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        textNode.fontName = { family: 'Inter', style: 'Regular' };
      }

      textNode.characters = text;
      textNode.fontSize = Math.round(style.fontSize * this.scaleX);

      if (style.lineHeight !== 'auto' && typeof style.lineHeight === 'number' && style.lineHeight > 0) {
        // Only set line-height if it's reasonable (between 0.8x and 3x font size)
        var lh = Math.round(style.lineHeight);
        if (lh >= style.fontSize * 0.8 && lh <= style.fontSize * 3) {
          textNode.lineHeight = { value: lh, unit: 'PIXELS' };
        }
      }

      if (style.letterSpacing !== 0) {
        textNode.letterSpacing = { value: style.letterSpacing * this.scaleX, unit: 'PIXELS' };
      }

      textNode.textAlignHorizontal = style.textAlign;

      // Text decoration
      if (style.textDecoration === 'UNDERLINE') {
        textNode.textDecoration = 'UNDERLINE';
      } else if (style.textDecoration === 'LINE_THROUGH') {
        textNode.textDecoration = 'STRIKETHROUGH';
      }

      // Text color as fill
      textNode.fills = [{ type: 'SOLID', color: this.toFigmaRGB(style.color), opacity: style.color.a }];
    } else {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      textNode.fontName = { family: 'Inter', style: 'Regular' };
      textNode.characters = text;
    }

    // Text sizing strategy:
    // - Single-line text (< 100 chars, no newline): auto-size width to prevent wrapping
    // - Multi-line text: fix width from capture with buffer, auto-size height
    var isSingleLine = text.length < 100 && text.indexOf('\n') === -1;
    if (isSingleLine) {
      textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
    } else {
      var textWidth = Math.max(10, Math.ceil(w * 1.1));
      textNode.resize(textWidth, Math.max(10, h));
      textNode.textAutoResize = 'HEIGHT';
    }

    // Opacity
    if (w2fNode.opacity < 1) {
      textNode.opacity = w2fNode.opacity;
    }

    return textNode;
  }

  private async createImageNode(
    w2fNode: W2FNode, x: number, y: number, w: number, h: number,
  ): Promise<RectangleNode> {
    const rect = figma.createRectangle();
    rect.name = w2fNode.name;
    rect.x = x;
    rect.y = y;
    rect.resize(w, h);

    // Border radius
    if (w2fNode.borderRadius) {
      rect.topLeftRadius = w2fNode.borderRadius.topLeft;
      rect.topRightRadius = w2fNode.borderRadius.topRight;
      rect.bottomRightRadius = w2fNode.borderRadius.bottomRight;
      rect.bottomLeftRadius = w2fNode.borderRadius.bottomLeft;
    }

    // Try to load image
    const imageRef = w2fNode.imageRef;
    if (imageRef && this.doc.assets && this.doc.assets.images && this.doc.assets.images[imageRef]) {
      const asset = this.doc.assets.images[imageRef];
      this.imageStats.total++;
      try {
        const imageData = await this.loadImageData(asset.data);
        if (imageData) {
          if (typeof imageData === 'string' && imageData.indexOf('SVG:') === 0) {
            // SVG — use createNodeFromSvg, replace rect with SVG node
            try {
              const svgContent = imageData.substring(4);
              const svgNode = figma.createNodeFromSvg(svgContent);
              svgNode.name = w2fNode.name;
              svgNode.x = rect.x;
              svgNode.y = rect.y;
              svgNode.resize(w, h);
              // Remove the rect, return the SVG node instead
              rect.remove();
              this.imageStats.loaded++;
              return svgNode as any;
            } catch {
              // SVG parsing failed — try as raster fallback
              rect.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.95 } }];
              this.imageStats.failed++;
              this.imageStats.errors.push('SVG_PARSE_FAIL');
            }
          } else {
            // Raster image (PNG, JPEG, GIF)
            const image = figma.createImage(imageData as Uint8Array);
            rect.fills = [{
              type: 'IMAGE',
              imageHash: image.hash,
              scaleMode: (w2fNode.imageScaleMode as 'FILL' | 'FIT' | 'CROP' | 'TILE') || 'FILL',
            }];
            this.imageStats.loaded++;
          }
        } else {
          this.imageStats.failed++;
          const dataPreview = typeof asset.data === 'string' ? asset.data.substring(0, 50) : 'no-data';
          this.imageStats.errors.push('NULL:' + dataPreview);
          rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
        }
      } catch (e: any) {
        this.imageStats.failed++;
        this.imageStats.errors.push('ERR:' + (e.message || '').substring(0, 60));
        rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
      }
    } else {
      rect.fills = this.convertFills(w2fNode.fills);
    }

    if (w2fNode.opacity < 1) {
      rect.opacity = w2fNode.opacity;
    }

    return rect;
  }

  private createSVGNode(
    w2fNode: W2FNode, x: number, y: number, w: number, h: number,
  ): FrameNode {
    // Try to create from SVG content
    if (w2fNode.svgContent) {
      try {
        const svgNode = figma.createNodeFromSvg(w2fNode.svgContent);
        svgNode.name = w2fNode.name;
        svgNode.x = x;
        svgNode.y = y;
        svgNode.resize(w, h);
        if (w2fNode.opacity < 1) svgNode.opacity = w2fNode.opacity;
        return svgNode;
      } catch {
        // SVG parsing failed — fall through to frame
      }
    }

    // Fallback: create a frame with a placeholder
    const frame = figma.createFrame();
    frame.name = w2fNode.name;
    frame.x = x;
    frame.y = y;
    frame.resize(w, h);
    frame.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.95 } }];
    return frame;
  }

  private convertFills(fills: W2FFill[]): Paint[] {
    if (!fills || fills.length === 0) return [];

    const paints: Paint[] = [];
    for (const fill of fills) {
      if (fill.type === 'SOLID') {
        paints.push({
          type: 'SOLID',
          color: this.toFigmaRGB(fill.color),
          opacity: fill.color.a,
        });
      } else if (fill.type === 'LINEAR_GRADIENT') {
        const angle = (fill.angle || 180) * (Math.PI / 180);
        paints.push({
          type: 'GRADIENT_LINEAR',
          gradientTransform: this.angleToTransform(angle),
          gradientStops: fill.stops.map((s: any) => ({
            position: s.position,
            color: { ...this.toFigmaRGB(s.color), a: s.color.a },
          })),
        });
      } else if (fill.type === 'RADIAL_GRADIENT') {
        paints.push({
          type: 'GRADIENT_RADIAL',
          gradientTransform: [[0.5, 0, 0.5], [0, 0.5, 0.5]],
          gradientStops: fill.stops.map((s: any) => ({
            position: s.position,
            color: { ...this.toFigmaRGB(s.color), a: s.color.a },
          })),
        });
      } else if (fill.type === 'IMAGE') {
        // Background image fill — queue for async loading
        this.pendingImageFills.push({ fill: fill as any, paints, index: paints.length });
        // Add placeholder that will be replaced
        paints.push({ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 });
      }
    }
    return paints;
  }

  /** Process all pending image fills after tree is built */
  async processImageFills(): Promise<void> {
    for (const { fill, paints, index } of this.pendingImageFills) {
      const imageRef = (fill as any).imageRef;
      if (imageRef && this.doc.assets && this.doc.assets.images && this.doc.assets.images[imageRef]) {
        const asset = this.doc.assets.images[imageRef];
        try {
          const imageData = await this.loadImageData(asset.data);
          if (imageData && typeof imageData !== 'string') {
            const image = figma.createImage(imageData as Uint8Array);
            paints[index] = {
              type: 'IMAGE',
              imageHash: image.hash,
              scaleMode: (fill as any).scaleMode || 'FILL',
            } as ImagePaint;
          }
        } catch { /* keep placeholder */ }
      }
    }
  }

  private convertEffects(effects: W2FEffect[]): Effect[] {
    return effects.map((effect) => {
      if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
        return {
          type: effect.type,
          color: { ...this.toFigmaRGB(effect.color), a: effect.color.a },
          offset: { x: effect.offsetX, y: effect.offsetY },
          radius: effect.blur,
          spread: effect.spread,
          visible: true,
          blendMode: 'NORMAL' as BlendMode,
        };
      } else if (effect.type === 'LAYER_BLUR') {
        return {
          type: 'LAYER_BLUR',
          radius: effect.radius,
          visible: true,
        };
      } else {
        return {
          type: 'BACKGROUND_BLUR',
          radius: (effect as W2FBlur).radius,
          visible: true,
        };
      }
    }) as Effect[];
  }

  private toFigmaRGB(color: W2FColor): RGB {
    return { r: color.r, g: color.g, b: color.b };
  }

  private angleToTransform(angle: number): Transform {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [[cos, sin, 0.5 - cos * 0.5 - sin * 0.5], [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]];
  }

  /**
   * Load image data from data URI or URL.
   * Returns Uint8Array for figma.createImage(), or 'SVG:...' string for SVGs.
   * Supports: PNG, JPEG, GIF (native Figma), SVG (via createNodeFromSvg),
   * WebP, AVIF, TIFF, HEIC, HEIF, APNG (must be converted before reaching here).
   */
  private async loadImageData(dataOrUrl: string): Promise<Uint8Array | string | null> {
    try {
      if (dataOrUrl.startsWith('data:')) {
        const mimeMatch = dataOrUrl.match(/^data:([^;,]+)/);
        const mime = mimeMatch ? mimeMatch[1] : '';

        // SVG — return raw SVG for createNodeFromSvg
        if (mime === 'image/svg+xml') {
          const base64Part = dataOrUrl.split(',')[1];
          if (!base64Part) return null;
          // Decode base64 to SVG string
          const bytes = this.decodeBase64(base64Part);
          var svgString = '';
          for (var si = 0; si < bytes.length; si++) {
            svgString += String.fromCharCode(bytes[si]);
          }
          // Handle URL-encoded SVGs
          if (svgString.indexOf('%3C') >= 0 || svgString.indexOf('%3c') >= 0) {
            try { svgString = decodeURIComponent(svgString); } catch {}
          }
          return 'SVG:' + svgString;
        }

        // PNG, JPEG, GIF — native Figma support
        if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') {
          const base64 = dataOrUrl.split(',')[1];
          if (!base64) return null;
          return this.decodeBase64(base64);
        }

        // Unsupported format that slipped through (WebP, AVIF, TIFF, HEIC, etc.)
        // Try decoding anyway — Figma might handle some formats
        const base64 = dataOrUrl.split(',')[1];
        if (!base64) return null;
        return this.decodeBase64(base64);
      }

      // URL — fetch directly (networkAccess allows "*")
      if (dataOrUrl.startsWith('http://') || dataOrUrl.startsWith('https://')) {
        const response = await fetch(dataOrUrl);
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      }

      return null;
    } catch {
      return null;
    }
  }

  /** Base64 decode without atob (Figma plugin sandbox doesn't have atob) */
  private decodeBase64(base64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
      lookup[chars.charCodeAt(i)] = i;
    }

    // Remove padding and whitespace
    const clean = base64.replace(/[\s=]/g, '');
    const len = clean.length;
    const outLen = (len * 3) >> 2;
    const bytes = new Uint8Array(outLen);

    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const a = lookup[clean.charCodeAt(i)];
      const b = i + 1 < len ? lookup[clean.charCodeAt(i + 1)] : 0;
      const c = i + 2 < len ? lookup[clean.charCodeAt(i + 2)] : 0;
      const d = i + 3 < len ? lookup[clean.charCodeAt(i + 3)] : 0;

      bytes[p++] = (a << 2) | (b >> 4);
      if (p < outLen) bytes[p++] = ((b & 15) << 4) | (c >> 2);
      if (p < outLen) bytes[p++] = ((c & 3) << 6) | d;
    }

    return bytes;
  }
}
