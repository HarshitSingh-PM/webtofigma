/**
 * StyleExtractor — Extracts CSS computed styles and converts to W2F format.
 */

import type {
  W2FFill, W2FStroke, W2FEffect, W2FTextStyle, W2FBorderRadius, W2FColor,
} from './types';

export class StyleExtractor {

  extractFills(style: CSSStyleDeclaration, element: Element): W2FFill[] {
    const fills: W2FFill[] = [];

    // Background color
    const bg = style.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      const color = this.parseCSSColor(bg);
      if (color.a > 0) {
        fills.push({ type: 'SOLID', color });
      }
    }

    // Background gradient
    const bgImage = style.backgroundImage;
    if (bgImage && bgImage !== 'none') {
      const gradient = this.parseGradient(bgImage);
      if (gradient) fills.push(gradient);
    }

    return fills;
  }

  extractStrokes(style: CSSStyleDeclaration): W2FStroke[] {
    const strokes: W2FStroke[] = [];

    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
    const widths = sides.map(s => parseFloat(style.getPropertyValue(`border-${s.toLowerCase()}-width`)) || 0);
    const colors = sides.map(s => style.getPropertyValue(`border-${s.toLowerCase()}-color`));
    const styles = sides.map(s => style.getPropertyValue(`border-${s.toLowerCase()}-style`));

    // Check if all borders are the same
    const allSame = widths.every(w => w === widths[0]) &&
                    colors.every(c => c === colors[0]) &&
                    styles.every(s => s === styles[0]);

    if (allSame && widths[0] > 0 && styles[0] !== 'none') {
      const color = this.parseCSSColor(colors[0]);
      strokes.push({ color, weight: widths[0], position: 'INSIDE' });
    } else {
      // Add individual borders that exist
      for (let i = 0; i < 4; i++) {
        if (widths[i] > 0 && styles[i] !== 'none') {
          const color = this.parseCSSColor(colors[i]);
          strokes.push({ color, weight: widths[i], position: 'INSIDE' });
          break; // Figma doesn't support per-side borders natively, use the dominant one
        }
      }
    }

    // Outline
    const outlineWidth = parseFloat(style.outlineWidth) || 0;
    const outlineStyle = style.outlineStyle;
    if (outlineWidth > 0 && outlineStyle !== 'none') {
      const color = this.parseCSSColor(style.outlineColor);
      strokes.push({ color, weight: outlineWidth, position: 'OUTSIDE' });
    }

    return strokes;
  }

  extractEffects(style: CSSStyleDeclaration): W2FEffect[] {
    const effects: W2FEffect[] = [];

    // Box shadow
    const boxShadow = style.boxShadow;
    if (boxShadow && boxShadow !== 'none') {
      const shadows = this.parseBoxShadows(boxShadow);
      effects.push(...shadows);
    }

    // Filter: blur
    const filter = style.filter;
    if (filter && filter !== 'none') {
      const blurMatch = filter.match(/blur\(([\d.]+)px\)/);
      if (blurMatch) {
        effects.push({ type: 'LAYER_BLUR', radius: parseFloat(blurMatch[1]) });
      }
    }

    // Backdrop filter: blur
    const backdropFilter = style.backdropFilter || (style as any).webkitBackdropFilter;
    if (backdropFilter && backdropFilter !== 'none') {
      const blurMatch = backdropFilter.match(/blur\(([\d.]+)px\)/);
      if (blurMatch) {
        effects.push({ type: 'BACKGROUND_BLUR', radius: parseFloat(blurMatch[1]) });
      }
    }

    return effects;
  }

  extractBorderRadius(style: CSSStyleDeclaration): W2FBorderRadius | undefined {
    const tl = parseFloat(style.borderTopLeftRadius) || 0;
    const tr = parseFloat(style.borderTopRightRadius) || 0;
    const br = parseFloat(style.borderBottomRightRadius) || 0;
    const bl = parseFloat(style.borderBottomLeftRadius) || 0;

    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined;

    return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
  }

  extractTextStyle(style: CSSStyleDeclaration): W2FTextStyle {
    const fontWeight = this.parseFontWeight(style.fontWeight);
    const fontSize = parseFloat(style.fontSize) || 16;
    const lineHeight = style.lineHeight === 'normal' ? 'auto' as const :
      parseFloat(style.lineHeight) || 'auto' as const;
    const letterSpacing = parseFloat(style.letterSpacing) || 0;

    const textAlignMap: Record<string, W2FTextStyle['textAlign']> = {
      'left': 'LEFT', 'start': 'LEFT',
      'center': 'CENTER',
      'right': 'RIGHT', 'end': 'RIGHT',
      'justify': 'JUSTIFIED',
    };

    const decorationMap: Record<string, W2FTextStyle['textDecoration']> = {
      'none': 'NONE', 'underline': 'UNDERLINE', 'line-through': 'LINE_THROUGH',
    };

    const transformMap: Record<string, W2FTextStyle['textTransform']> = {
      'none': 'NONE', 'uppercase': 'UPPERCASE', 'lowercase': 'LOWERCASE', 'capitalize': 'CAPITALIZE',
    };

    return {
      fontFamily: this.cleanFontFamily(style.fontFamily),
      fontWeight,
      fontSize,
      lineHeight,
      letterSpacing,
      textAlign: textAlignMap[style.textAlign] || 'LEFT',
      textDecoration: decorationMap[style.textDecorationLine || style.textDecoration] || 'NONE',
      textTransform: transformMap[style.textTransform] || 'NONE',
      color: this.parseCSSColor(style.color),
      fontStyle: style.fontStyle === 'italic' ? 'italic' : 'normal',
    };
  }

  extractRotation(style: CSSStyleDeclaration): number {
    const transform = style.transform;
    if (!transform || transform === 'none') return 0;

    // matrix(a, b, c, d, tx, ty) — rotation = atan2(b, a)
    const matrixMatch = transform.match(/matrix\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)/);
    if (matrixMatch) {
      const a = parseFloat(matrixMatch[1]);
      const b = parseFloat(matrixMatch[2]);
      const angle = Math.atan2(b, a) * (180 / Math.PI);
      return Math.round(angle * 100) / 100;
    }

    // rotate(Xdeg)
    const rotateMatch = transform.match(/rotate\(\s*([-\d.]+)deg\s*\)/);
    if (rotateMatch) {
      return parseFloat(rotateMatch[1]);
    }

    return 0;
  }

  // ---- Private helpers ----

  parseCSSColor(cssColor: string): W2FColor {
    const fallback: W2FColor = { r: 0, g: 0, b: 0, a: 1 };
    if (!cssColor || cssColor === 'transparent') return { ...fallback, a: 0 };

    // rgba(r, g, b, a)
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

    // Modern rgb(r g b / a)
    const rgbSpace = cssColor.match(
      /rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.%]+))?\s*\)/
    );
    if (rgbSpace) {
      let a = 1;
      if (rgbSpace[4]) {
        a = rgbSpace[4].endsWith('%') ? parseFloat(rgbSpace[4]) / 100 : parseFloat(rgbSpace[4]);
      }
      return {
        r: parseInt(rgbSpace[1]) / 255,
        g: parseInt(rgbSpace[2]) / 255,
        b: parseInt(rgbSpace[3]) / 255,
        a,
      };
    }

    // Hex
    const hexMatch = cssColor.match(/^#([0-9a-f]+)$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3 || hex.length === 4) {
        return {
          r: parseInt(hex[0] + hex[0], 16) / 255,
          g: parseInt(hex[1] + hex[1], 16) / 255,
          b: parseInt(hex[2] + hex[2], 16) / 255,
          a: hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1,
        };
      }
      if (hex.length === 6 || hex.length === 8) {
        return {
          r: parseInt(hex.substring(0, 2), 16) / 255,
          g: parseInt(hex.substring(2, 4), 16) / 255,
          b: parseInt(hex.substring(4, 6), 16) / 255,
          a: hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1,
        };
      }
    }

    return fallback;
  }

  private parseGradient(bgImage: string): W2FFill | null {
    const linearMatch = bgImage.match(/linear-gradient\(([^)]+)\)/);
    if (linearMatch) {
      const content = linearMatch[1];
      const stops = this.parseGradientStops(content);
      const angleMatch = content.match(/([\d.]+)deg/);
      return {
        type: 'LINEAR_GRADIENT',
        stops,
        angle: angleMatch ? parseFloat(angleMatch[1]) : 180,
      };
    }

    const radialMatch = bgImage.match(/radial-gradient\(([^)]+)\)/);
    if (radialMatch) {
      const stops = this.parseGradientStops(radialMatch[1]);
      return { type: 'RADIAL_GRADIENT', stops };
    }

    return null;
  }

  private parseGradientStops(content: string): Array<{ position: number; color: W2FColor }> {
    const colorStopRegex = /(rgba?\([^)]+\)|#[0-9a-f]{3,8}|\w+)\s*([\d.]+%)?/gi;
    const stops: Array<{ position: number; color: W2FColor }> = [];
    let match;

    while ((match = colorStopRegex.exec(content)) !== null) {
      const color = this.parseCSSColor(match[1]);
      const position = match[2] ? parseFloat(match[2]) / 100 : stops.length === 0 ? 0 : 1;
      stops.push({ position, color });
    }

    if (stops.length === 0) {
      stops.push({ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } });
      stops.push({ position: 1, color: { r: 1, g: 1, b: 1, a: 1 } });
    }

    return stops;
  }

  private parseBoxShadows(boxShadow: string): W2FEffect[] {
    const effects: W2FEffect[] = [];

    // Split multiple shadows (handle commas inside rgba)
    const shadows = this.splitShadows(boxShadow);

    for (const shadow of shadows) {
      const inset = shadow.includes('inset');
      const cleaned = shadow.replace('inset', '').trim();

      // Extract color
      let color: W2FColor = { r: 0, g: 0, b: 0, a: 0.25 };
      const colorRgba = cleaned.match(/rgba?\([^)]+\)/);
      const colorHex = cleaned.match(/#[0-9a-f]{3,8}/i);
      if (colorRgba) {
        color = this.parseCSSColor(colorRgba[0]);
      } else if (colorHex) {
        color = this.parseCSSColor(colorHex[0]);
      }

      // Extract numeric values (offsetX, offsetY, blur, spread)
      const withoutColor = cleaned
        .replace(/rgba?\([^)]+\)/, '')
        .replace(/#[0-9a-f]{3,8}/i, '')
        .trim();
      const nums = withoutColor.match(/-?[\d.]+/g)?.map(Number) || [];

      effects.push({
        type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color,
        offsetX: nums[0] || 0,
        offsetY: nums[1] || 0,
        blur: nums[2] || 0,
        spread: nums[3] || 0,
      });
    }

    return effects;
  }

  private splitShadows(str: string): string[] {
    const results: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of str) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && depth === 0) {
        results.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) results.push(current.trim());
    return results;
  }

  private parseFontWeight(weight: string): number {
    const map: Record<string, number> = {
      'normal': 400, 'bold': 700,
      'lighter': 300, 'bolder': 700,
      '100': 100, '200': 200, '300': 300, '400': 400,
      '500': 500, '600': 600, '700': 700, '800': 800, '900': 900,
    };
    return map[weight] || parseInt(weight) || 400;
  }

  private cleanFontFamily(fontFamily: string): string {
    // Take the first font in the stack, strip quotes
    const first = fontFamily.split(',')[0].trim();
    return first.replace(/['"]/g, '');
  }
}
