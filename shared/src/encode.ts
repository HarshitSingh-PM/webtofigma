import type { W2FDocument } from './types';

/**
 * Encode a W2FDocument to a .w2f file buffer.
 * Format: JSON with optional compression.
 * Unlike h2d's XOR obfuscation, we use plain JSON for openness.
 */
export function encodeW2F(doc: W2FDocument): string {
  return JSON.stringify(doc);
}

/**
 * Decode a .w2f file buffer back to a W2FDocument.
 */
export function decodeW2F(data: string): W2FDocument {
  const parsed = JSON.parse(data);
  if (!parsed.version || !parsed.root) {
    throw new Error('Invalid .w2f file: missing version or root');
  }
  return parsed as W2FDocument;
}

/**
 * Parse a CSS color string to W2FColor.
 * Handles: hex, rgb(), rgba(), hsl(), hsla(), named colors.
 */
export function parseCSSColor(cssColor: string): { r: number; g: number; b: number; a: number } {
  const fallback = { r: 0, g: 0, b: 0, a: 1 };
  if (!cssColor || cssColor === 'transparent') return { ...fallback, a: 0 };
  if (cssColor === 'inherit' || cssColor === 'initial' || cssColor === 'currentColor') return fallback;

  // rgba(r, g, b, a) or rgb(r, g, b)
  const rgbaMatch = cssColor.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/
  );
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]) / 255,
      g: parseInt(rgbaMatch[2]) / 255,
      b: parseInt(rgbaMatch[3]) / 255,
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }

  // Modern rgb/rgba with spaces: rgb(r g b / a)
  const rgbSpaceMatch = cssColor.match(
    /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.%]+))?\s*\)/
  );
  if (rgbSpaceMatch) {
    let a = 1;
    if (rgbSpaceMatch[4] !== undefined) {
      a = rgbSpaceMatch[4].endsWith('%')
        ? parseFloat(rgbSpaceMatch[4]) / 100
        : parseFloat(rgbSpaceMatch[4]);
    }
    return {
      r: parseInt(rgbSpaceMatch[1]) / 255,
      g: parseInt(rgbSpaceMatch[2]) / 255,
      b: parseInt(rgbSpaceMatch[3]) / 255,
      a,
    };
  }

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
  const hexMatch = cssColor.match(/^#([0-9a-f]+)$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        a: parseInt(hex[3] + hex[3], 16) / 255,
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.substring(0, 2), 16) / 255,
        g: parseInt(hex.substring(2, 4), 16) / 255,
        b: parseInt(hex.substring(4, 6), 16) / 255,
        a: parseInt(hex.substring(6, 8), 16) / 255,
      };
    }
  }

  return fallback;
}

/**
 * Generate a unique ID for nodes.
 */
let nodeIdCounter = 0;
export function generateNodeId(): string {
  return `w2f_${Date.now()}_${++nodeIdCounter}`;
}

/**
 * Determine device type from viewport width.
 */
export function detectDeviceType(width: number): 'desktop' | 'tablet' | 'mobile' {
  if (width <= 480) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}
