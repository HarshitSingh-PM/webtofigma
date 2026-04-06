/**
 * FontLoader — Handles font loading and fallback resolution for Figma.
 */

interface W2FFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  url?: string;
  isSystem: boolean;
}

const WEIGHT_STYLE_MAP: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

const FONT_FALLBACKS: Record<string, string> = {
  'system-ui': 'Inter',
  '-apple-system': 'Inter',
  'BlinkMacSystemFont': 'Inter',
  'Segoe UI': 'Inter',
  'Helvetica Neue': 'Inter',
  'Helvetica': 'Inter',
  'Arial': 'Inter',
  'sans-serif': 'Inter',
  'serif': 'Roboto Serif',
  'monospace': 'Roboto Mono',
  'Times New Roman': 'Roboto Serif',
  'Times': 'Roboto Serif',
  'Courier New': 'Roboto Mono',
  'Courier': 'Roboto Mono',
  'Georgia': 'Roboto Serif',
};

export class FontLoader {
  private loadedFonts = new Set<string>();
  private availableFonts = new Map<string, FontName[]>();

  async loadFonts(fonts: W2FFont[]): Promise<void> {
    // Always load Inter as the fallback
    try {
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      this.loadedFonts.add('Inter-Regular');
    } catch {
      // Inter should always be available
    }

    for (const font of fonts) {
      const fontName = this.resolveFontName(font.family, font.weight, font.style);
      const key = `${fontName.family}-${fontName.style}`;

      if (this.loadedFonts.has(key)) continue;

      try {
        await figma.loadFontAsync(fontName);
        this.loadedFonts.add(key);
      } catch {
        // Try fallback
        const fallbackFamily = FONT_FALLBACKS[font.family] || 'Inter';
        const fallbackName = this.resolveFontName(fallbackFamily, font.weight, font.style);
        const fallbackKey = `${fallbackName.family}-${fallbackName.style}`;

        if (!this.loadedFonts.has(fallbackKey)) {
          try {
            await figma.loadFontAsync(fallbackName);
            this.loadedFonts.add(fallbackKey);
          } catch {
            // Final fallback
            try {
              await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
            } catch {
              // Nothing we can do
            }
          }
        }
      }
    }
  }

  resolveFontName(family: string, weight: number, fontStyle: 'normal' | 'italic'): FontName {
    const resolvedFamily = FONT_FALLBACKS[family] || family;
    const weightName = WEIGHT_STYLE_MAP[weight] || 'Regular';
    const style = fontStyle === 'italic'
      ? (weightName === 'Regular' ? 'Italic' : `${weightName} Italic`)
      : weightName;

    return { family: resolvedFamily, style };
  }

  /** Try to load a font, attempting multiple weight/style variants */
  async tryLoadFont(family: string, weight: number, fontStyle: 'normal' | 'italic'): Promise<FontName> {
    const fontName = this.resolveFontName(family, weight, fontStyle);
    const key = fontName.family + '-' + fontName.style;
    if (this.loadedFonts.has(key)) return fontName;

    try {
      await figma.loadFontAsync(fontName);
      this.loadedFonts.add(key);
      return fontName;
    } catch {
      // Try Regular weight as fallback
      const regular = { family: fontName.family, style: 'Regular' };
      const regKey = regular.family + '-Regular';
      if (!this.loadedFonts.has(regKey)) {
        try {
          await figma.loadFontAsync(regular);
          this.loadedFonts.add(regKey);
          return regular;
        } catch { /* */ }
      } else {
        return regular;
      }
      // Final fallback: Inter Regular
      return { family: 'Inter', style: 'Regular' };
    }
  }
}
