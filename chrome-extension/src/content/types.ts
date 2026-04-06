// Inline types for the content script bundle (avoids workspace dependency issues)
// These mirror @web2fig/shared types exactly.

export type W2FNodeType = 'FRAME' | 'TEXT' | 'IMAGE' | 'SVG' | 'VECTOR' | 'GROUP' | 'COMPONENT';
export type DeviceType = 'desktop' | 'tablet' | 'mobile';

export interface W2FColor { r: number; g: number; b: number; a: number; }

export interface W2FGradientStop { position: number; color: W2FColor; }

export interface W2FSolidFill { type: 'SOLID'; color: W2FColor; }
export interface W2FGradientFill { type: 'LINEAR_GRADIENT' | 'RADIAL_GRADIENT'; stops: W2FGradientStop[]; angle?: number; }
export interface W2FImageFill { type: 'IMAGE'; imageRef: string; scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'; }
export type W2FFill = W2FSolidFill | W2FGradientFill | W2FImageFill;

export interface W2FStroke { color: W2FColor; weight: number; position: 'INSIDE' | 'OUTSIDE' | 'CENTER'; }

export interface W2FShadow { type: 'DROP_SHADOW' | 'INNER_SHADOW'; color: W2FColor; offsetX: number; offsetY: number; blur: number; spread: number; }
export interface W2FBlur { type: 'LAYER_BLUR' | 'BACKGROUND_BLUR'; radius: number; }
export type W2FEffect = W2FShadow | W2FBlur;

export interface W2FBorderRadius { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number; }

export interface W2FTextStyle {
  fontFamily: string; fontWeight: number; fontSize: number;
  lineHeight: number | 'auto'; letterSpacing: number;
  textAlign: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textDecoration: 'NONE' | 'UNDERLINE' | 'LINE_THROUGH';
  textTransform: 'NONE' | 'UPPERCASE' | 'LOWERCASE' | 'CAPITALIZE';
  color: W2FColor; fontStyle: 'normal' | 'italic';
}

export interface W2FAutoLayout {
  direction: 'HORIZONTAL' | 'VERTICAL'; spacing: number;
  paddingTop: number; paddingRight: number; paddingBottom: number; paddingLeft: number;
  mainAxisAlignment: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  crossAxisAlignment: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  wrap: boolean;
}

export interface W2FConstraints {
  horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
  vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
}

export interface W2FNode {
  id: string; type: W2FNodeType; name: string; semanticTag?: string;
  x: number; y: number; width: number; height: number; rotation?: number;
  visible: boolean; opacity: number; clipContent?: boolean; overflow?: 'visible' | 'hidden' | 'scroll';
  fills: W2FFill[]; strokes: W2FStroke[]; borderRadius?: W2FBorderRadius;
  effects: W2FEffect[];
  autoLayout?: W2FAutoLayout;
  constraints?: W2FConstraints;
  textContent?: string; textStyle?: W2FTextStyle;
  textSegments?: Array<{ start: number; end: number; style: Partial<W2FTextStyle>; }>;
  imageRef?: string; imageScaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  svgContent?: string;
  children: W2FNode[];
  htmlTag?: string; htmlClass?: string; htmlId?: string;
  ariaLabel?: string; href?: string;
}

export interface W2FFont {
  family: string; weight: number; style: 'normal' | 'italic';
  url?: string; isSystem: boolean;
}

export interface W2FImageAsset {
  data: string; mimeType: string; width: number; height: number;
}

export interface W2FViewport {
  width: number; height: number; devicePixelRatio: number; deviceType: DeviceType;
}

export interface W2FDocument {
  version: string; generator: string; capturedAt: string;
  url: string; title: string;
  viewport: W2FViewport; screenshot?: string;
  root: W2FNode;
  assets: { images: Record<string, W2FImageAsset>; fonts: W2FFont[]; };
  colorPalette: Array<{ name: string; color: W2FColor; count: number; }>;
  metadata: {
    captureMode: 'full-page' | 'viewport' | 'selection';
    deviceType: DeviceType; theme?: 'light' | 'dark'; userAgent?: string;
  };
}
