/**
 * AssetCollector — Collects images and fonts from the page.
 * Phase 1: Collect image URLs during DOM traversal (fast, no network)
 * Phase 2: Batch-fetch all images via background script (parallel, after traversal)
 */

import type { W2FImageAsset, W2FFont } from './types';

export class AssetCollector {
  private images: Record<string, W2FImageAsset> = {};
  private fonts: W2FFont[] = [];
  private fontSet = new Set<string>();
  private imageCounter = 0;
  private pendingUrls: Array<{ ref: string; url: string; width: number; height: number }> = [];
  private collectedUrls = new Map<string, string>(); // url -> ref

  getImages(): Record<string, W2FImageAsset> {
    return this.images;
  }

  getFonts(): W2FFont[] {
    return this.fonts;
  }

  /** Phase 1: Just record the image URL, don't fetch yet */
  collectImage(element: HTMLImageElement): string | null {
    try {
      const src = element.currentSrc || element.src;
      if (!src) return null;

      // Dedup
      const existing = this.collectedUrls.get(src);
      if (existing) return existing;

      const ref = `img_${++this.imageCounter}`;
      const w = element.naturalWidth || element.width || 1;
      const h = element.naturalHeight || element.height || 1;
      this.collectedUrls.set(src, ref);

      if (src.startsWith('data:')) {
        // Data URIs are already embedded
        const mimeMatch = src.match(/data:([^;,]+)/);
        this.images[ref] = {
          data: src,
          mimeType: (mimeMatch && mimeMatch[1]) || 'image/png',
          width: w,
          height: h,
        };
      } else {
        // Queue for batch fetch later
        this.pendingUrls.push({ ref, url: src, width: w, height: h });
        // Store placeholder for now
        this.images[ref] = {
          data: src, // URL as placeholder
          mimeType: this.guessMimeType(src),
          width: w,
          height: h,
        };
      }

      return ref;
    } catch {
      return null;
    }
  }

  /** Phase 1: Record background image URL */
  collectBackgroundImage(bgImage: string): string | null {
    const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (!urlMatch) return null;

    const url = urlMatch[1];
    if (!url || url.length < 10) return null;
    if (url.startsWith('data:image/svg+xml') && url.length < 200) return null;

    // Dedup
    const existing = this.collectedUrls.get(url);
    if (existing) return existing;

    const ref = `bg_${++this.imageCounter}`;
    this.collectedUrls.set(url, ref);

    if (url.startsWith('data:')) {
      const mimeMatch = url.match(/data:([^;,]+)/);
      this.images[ref] = {
        data: url,
        mimeType: (mimeMatch && mimeMatch[1]) || 'image/png',
        width: 0,
        height: 0,
      };
    } else {
      this.pendingUrls.push({ ref, url, width: 0, height: 0 });
      this.images[ref] = {
        data: url,
        mimeType: this.guessMimeType(url),
        width: 0,
        height: 0,
      };
    }

    return ref;
  }

  /**
   * Phase 2: Batch-fetch all pending image URLs via the background script.
   * Call this AFTER DOM traversal is complete.
   */
  async fetchAllImages(): Promise<void> {
    if (this.pendingUrls.length === 0) return;

    // Send all URLs to background script for parallel fetching
    const urls = this.pendingUrls.map((p) => p.url);

    try {
      const results: Record<string, string> = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'batch-fetch-images', urls },
          (response) => {
            if (chrome.runtime.lastError || !response || !response.results) {
              resolve({});
            } else {
              resolve(response.results);
            }
          },
        );
        // Timeout after 30 seconds
        setTimeout(() => resolve({}), 30000);
      });

      // Update images with fetched base64 data
      for (const pending of this.pendingUrls) {
        const data = results[pending.url];
        if (data) {
          this.images[pending.ref] = {
            data,
            mimeType: this.guessMimeType(pending.url),
            width: pending.width,
            height: pending.height,
          };
        }
        // If no data, the URL placeholder remains (Figma plugin will try to fetch)
      }
    } catch {
      // If batch fetch fails entirely, URLs remain as fallback
    }
  }

  collectFont(family: string, weight: number, style: 'normal' | 'italic'): void {
    const key = `${family}-${weight}-${style}`;
    if (this.fontSet.has(key)) return;
    this.fontSet.add(key);

    const isSystem = this.isSystemFont(family);
    const font: W2FFont = { family, weight, style, isSystem };

    if (!isSystem) {
      const url = this.findWebFontUrl(family);
      if (url) font.url = url;
    }

    this.fonts.push(font);
  }

  private isSystemFont(family: string): boolean {
    const systemFonts = new Set([
      'Arial', 'Helvetica', 'Times New Roman', 'Times', 'Courier New', 'Courier',
      'Verdana', 'Georgia', 'Palatino', 'Garamond', 'Comic Sans MS', 'Impact',
      'Trebuchet MS', 'Arial Black', 'Lucida Console', 'Tahoma', 'Geneva',
      'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
      'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
      'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
      'SF Pro', 'SF Pro Display', 'SF Pro Text', 'SF Mono',
    ]);
    return systemFonts.has(family);
  }

  private findWebFontUrl(family: string): string | undefined {
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSFontFaceRule) {
              const ruleFamily = rule.style.getPropertyValue('font-family').replace(/['"]/g, '');
              if (ruleFamily === family) {
                const src = rule.style.getPropertyValue('src');
                const urlMatch = src.match(/url\(["']?([^"')]+)["']?\)/);
                if (urlMatch) return urlMatch[1];
              }
            }
          }
        } catch { /* cross-origin stylesheet */ }
      }
    } catch { /* */ }
    return undefined;
  }

  private guessMimeType(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('.png')) return 'image/png';
    if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
    if (lower.includes('.gif')) return 'image/gif';
    if (lower.includes('.webp')) return 'image/webp';
    if (lower.includes('.svg')) return 'image/svg+xml';
    if (lower.includes('.avif')) return 'image/avif';
    return 'image/png';
  }
}
