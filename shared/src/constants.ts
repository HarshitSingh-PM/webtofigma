import type { DeviceType } from './types';

export const W2F_VERSION = '1.0.0';
export const W2F_FILE_EXTENSION = '.w2f';
export const W2F_MIME_TYPE = 'application/json';
export const GENERATOR_NAME = 'web2fig-chrome-extension';

export const DEVICE_PRESETS: Record<DeviceType, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

export const FIGMA_FRAME_PRESETS: Record<DeviceType, { width: number; name: string }> = {
  desktop: { width: 1440, name: 'Desktop - 1440px' },
  tablet: { width: 768, name: 'Tablet - 768px' },
  mobile: { width: 375, name: 'Mobile - 375px' },
};

/** Semantic HTML tags that map to meaningful Figma layer names */
export const SEMANTIC_TAG_NAMES: Record<string, string> = {
  header: 'Header',
  nav: 'Navigation',
  main: 'Main Content',
  footer: 'Footer',
  aside: 'Sidebar',
  section: 'Section',
  article: 'Article',
  form: 'Form',
  button: 'Button',
  input: 'Input',
  textarea: 'Text Area',
  select: 'Select',
  a: 'Link',
  ul: 'List',
  ol: 'Ordered List',
  li: 'List Item',
  table: 'Table',
  thead: 'Table Header',
  tbody: 'Table Body',
  tr: 'Table Row',
  td: 'Table Cell',
  th: 'Table Header Cell',
  img: 'Image',
  video: 'Video',
  audio: 'Audio',
  canvas: 'Canvas',
  dialog: 'Dialog',
  details: 'Details',
  summary: 'Summary',
  figure: 'Figure',
  figcaption: 'Caption',
  blockquote: 'Blockquote',
  code: 'Code',
  pre: 'Preformatted',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  h4: 'Heading 4',
  h5: 'Heading 5',
  h6: 'Heading 6',
  p: 'Paragraph',
  span: 'Text',
  div: 'Container',
  label: 'Label',
};

/** Tags to skip during capture */
export const SKIP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'head', 'noscript',
  'template', 'slot', 'br', 'wbr',
]);

/** Tags that are always invisible */
export const INVISIBLE_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'head', 'title', 'base',
]);

/** MCP Server info */
export const MCP_SERVER_NAME = 'web2fig';
export const MCP_SERVER_VERSION = '1.0.0';
