// ============================================================
// Web2Fig Shared Types — .w2f file format specification
// ============================================================

/** Node types in the captured DOM tree */
export type W2FNodeType =
  | 'FRAME'
  | 'TEXT'
  | 'IMAGE'
  | 'SVG'
  | 'VECTOR'
  | 'GROUP'
  | 'COMPONENT';

/** Device viewport presets */
export type DeviceType = 'desktop' | 'tablet' | 'mobile';

/** Color in RGBA format (0-1 range) */
export interface W2FColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Gradient stop */
export interface W2FGradientStop {
  position: number;
  color: W2FColor;
}

/** Fill types */
export interface W2FSolidFill {
  type: 'SOLID';
  color: W2FColor;
}

export interface W2FGradientFill {
  type: 'LINEAR_GRADIENT' | 'RADIAL_GRADIENT';
  stops: W2FGradientStop[];
  angle?: number;
}

export interface W2FImageFill {
  type: 'IMAGE';
  imageRef: string; // key into assets.images
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
}

export type W2FFill = W2FSolidFill | W2FGradientFill | W2FImageFill;

/** Stroke/border */
export interface W2FStroke {
  color: W2FColor;
  weight: number;
  position: 'INSIDE' | 'OUTSIDE' | 'CENTER';
}

/** Shadow/effect */
export interface W2FShadow {
  type: 'DROP_SHADOW' | 'INNER_SHADOW';
  color: W2FColor;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
}

/** Blur effect */
export interface W2FBlur {
  type: 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  radius: number;
}

export type W2FEffect = W2FShadow | W2FBlur;

/** Border radius */
export interface W2FBorderRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/** Text style properties */
export interface W2FTextStyle {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number | 'auto';
  letterSpacing: number;
  textAlign: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textDecoration: 'NONE' | 'UNDERLINE' | 'LINE_THROUGH';
  textTransform: 'NONE' | 'UPPERCASE' | 'LOWERCASE' | 'CAPITALIZE';
  color: W2FColor;
  fontStyle: 'normal' | 'italic';
}

/** Auto-layout (flexbox) properties */
export interface W2FAutoLayout {
  direction: 'HORIZONTAL' | 'VERTICAL';
  spacing: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  mainAxisAlignment: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  crossAxisAlignment: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH';
  wrap: boolean;
}

/** Grid layout properties */
export interface W2FGridLayout {
  columns: number;
  rows: number;
  columnGap: number;
  rowGap: number;
}

/** Constraints for responsive behavior */
export interface W2FConstraints {
  horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
  vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
}

/** A single node in the design tree */
export interface W2FNode {
  id: string;
  type: W2FNodeType;
  name: string;
  semanticTag?: string; // Original HTML tag (header, nav, main, etc.)

  // Geometry
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;

  // Visibility
  visible: boolean;
  opacity: number;
  clipContent?: boolean;
  overflow?: 'visible' | 'hidden' | 'scroll';

  // Fills & Strokes
  fills: W2FFill[];
  strokes: W2FStroke[];
  borderRadius?: W2FBorderRadius;

  // Effects
  effects: W2FEffect[];

  // Layout
  autoLayout?: W2FAutoLayout;
  gridLayout?: W2FGridLayout;
  constraints?: W2FConstraints;

  // Text-specific
  textContent?: string;
  textStyle?: W2FTextStyle;
  textSegments?: Array<{
    start: number;
    end: number;
    style: Partial<W2FTextStyle>;
  }>;

  // Image-specific
  imageRef?: string;
  imageScaleMode?: 'FILL' | 'FIT' | 'CROP' | 'TILE';

  // SVG-specific
  svgContent?: string;

  // Hierarchy
  children: W2FNode[];

  // Metadata
  htmlTag?: string;
  htmlClass?: string;
  htmlId?: string;
  ariaLabel?: string;
  href?: string;
}

/** Font descriptor */
export interface W2FFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  url?: string; // Web font URL
  isSystem: boolean;
}

/** Image asset */
export interface W2FImageAsset {
  data: string; // base64 encoded
  mimeType: string;
  width: number;
  height: number;
}

/** Capture viewport info */
export interface W2FViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
  deviceType: DeviceType;
}

/** The complete .w2f file format */
export interface W2FDocument {
  version: string; // Format version (e.g., "1.0.0")
  generator: string; // "web2fig-chrome-extension"
  capturedAt: string; // ISO timestamp
  url: string; // Source page URL
  title: string; // Page title

  viewport: W2FViewport;
  screenshot?: string; // base64 WebP of full page

  // The design tree
  root: W2FNode;

  // Shared assets
  assets: {
    images: Record<string, W2FImageAsset>;
    fonts: W2FFont[];
  };

  // Color palette extracted from the page
  colorPalette: Array<{
    name: string;
    color: W2FColor;
    count: number; // Usage frequency
  }>;

  // Metadata for MCP
  metadata: {
    captureMode: 'full-page' | 'viewport' | 'selection';
    deviceType: DeviceType;
    theme?: 'light' | 'dark';
    userAgent?: string;
  };
}

/** MCP messages between Chrome extension and Figma plugin */
export interface MCPCaptureRequest {
  action: 'capture';
  url: string;
  deviceType?: DeviceType;
  theme?: 'light' | 'dark';
  captureMode?: 'full-page' | 'viewport' | 'selection';
}

export interface MCPCaptureResponse {
  action: 'capture-complete';
  success: boolean;
  filePath?: string;
  document?: W2FDocument;
  error?: string;
}

export interface MCPImportRequest {
  action: 'import';
  document: W2FDocument;
  targetDeviceType: DeviceType;
  pageName?: string;
}

export interface MCPImportResponse {
  action: 'import-complete';
  success: boolean;
  figmaUrl?: string;
  error?: string;
}
