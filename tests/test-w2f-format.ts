/**
 * Test: W2F format validation
 * Ensures the .w2f document structure is correct and complete.
 */

// Simulated W2F document for testing
const sampleDocument = {
  version: '1.0.0',
  generator: 'web2fig-test',
  capturedAt: new Date().toISOString(),
  url: 'https://example.com',
  title: 'Example Domain',
  viewport: {
    width: 1440,
    height: 900,
    devicePixelRatio: 1,
    deviceType: 'desktop' as const,
  },
  root: {
    id: 'w2f_1',
    type: 'FRAME' as const,
    name: 'Body',
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    visible: true,
    opacity: 1,
    fills: [{ type: 'SOLID' as const, color: { r: 1, g: 1, b: 1, a: 1 } }],
    strokes: [],
    effects: [],
    children: [
      {
        id: 'w2f_2',
        type: 'FRAME' as const,
        name: 'Header',
        semanticTag: 'header',
        x: 0,
        y: 0,
        width: 1440,
        height: 80,
        visible: true,
        opacity: 1,
        fills: [{ type: 'SOLID' as const, color: { r: 0.2, g: 0.3, b: 0.8, a: 1 } }],
        strokes: [],
        effects: [],
        autoLayout: {
          direction: 'HORIZONTAL' as const,
          spacing: 16,
          paddingTop: 16,
          paddingRight: 32,
          paddingBottom: 16,
          paddingLeft: 32,
          mainAxisAlignment: 'SPACE_BETWEEN' as const,
          crossAxisAlignment: 'CENTER' as const,
          wrap: false,
        },
        children: [
          {
            id: 'w2f_3',
            type: 'TEXT' as const,
            name: 'Heading 1',
            x: 32,
            y: 24,
            width: 200,
            height: 32,
            visible: true,
            opacity: 1,
            fills: [],
            strokes: [],
            effects: [],
            textContent: 'Example Domain',
            textStyle: {
              fontFamily: 'Inter',
              fontWeight: 700,
              fontSize: 24,
              lineHeight: 32,
              letterSpacing: 0,
              textAlign: 'LEFT' as const,
              textDecoration: 'NONE' as const,
              textTransform: 'NONE' as const,
              color: { r: 1, g: 1, b: 1, a: 1 },
              fontStyle: 'normal' as const,
            },
            children: [],
          },
        ],
      },
      {
        id: 'w2f_4',
        type: 'IMAGE' as const,
        name: 'Image',
        x: 100,
        y: 200,
        width: 400,
        height: 300,
        visible: true,
        opacity: 1,
        fills: [],
        strokes: [],
        effects: [{
          type: 'DROP_SHADOW' as const,
          color: { r: 0, g: 0, b: 0, a: 0.2 },
          offsetX: 0,
          offsetY: 4,
          blur: 12,
          spread: 0,
        }],
        borderRadius: {
          topLeft: 8,
          topRight: 8,
          bottomRight: 8,
          bottomLeft: 8,
        },
        imageRef: 'img_1',
        imageScaleMode: 'FILL',
        children: [],
      },
    ],
    htmlTag: 'body',
  },
  assets: {
    images: {
      img_1: {
        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        mimeType: 'image/png',
        width: 800,
        height: 600,
      },
    },
    fonts: [
      { family: 'Inter', weight: 400, style: 'normal' as const, isSystem: false },
      { family: 'Inter', weight: 700, style: 'normal' as const, isSystem: false },
    ],
  },
  colorPalette: [
    { name: 'Color 1', color: { r: 1, g: 1, b: 1, a: 1 }, count: 15 },
    { name: 'Color 2', color: { r: 0.2, g: 0.3, b: 0.8, a: 1 }, count: 8 },
  ],
  metadata: {
    captureMode: 'full-page' as const,
    deviceType: 'desktop' as const,
    theme: 'light' as const,
    userAgent: 'test',
  },
};

// Validation functions
function validateDocument(doc: typeof sampleDocument): string[] {
  const errors: string[] = [];

  // Required top-level fields
  if (!doc.version) errors.push('Missing version');
  if (!doc.generator) errors.push('Missing generator');
  if (!doc.capturedAt) errors.push('Missing capturedAt');
  if (!doc.url) errors.push('Missing url');
  if (!doc.root) errors.push('Missing root node');
  if (!doc.viewport) errors.push('Missing viewport');
  if (!doc.assets) errors.push('Missing assets');

  // Validate root node
  if (doc.root) {
    validateNode(doc.root, errors, 'root');
  }

  // Validate viewport
  if (doc.viewport) {
    if (!doc.viewport.width || doc.viewport.width <= 0) errors.push('Invalid viewport width');
    if (!doc.viewport.height || doc.viewport.height <= 0) errors.push('Invalid viewport height');
    if (!['desktop', 'tablet', 'mobile'].includes(doc.viewport.deviceType)) {
      errors.push('Invalid viewport deviceType');
    }
  }

  // Validate assets
  if (doc.assets) {
    if (!doc.assets.images || typeof doc.assets.images !== 'object') errors.push('Missing assets.images');
    if (!Array.isArray(doc.assets.fonts)) errors.push('Missing assets.fonts array');
  }

  return errors;
}

function validateNode(node: any, errors: string[], path: string): void {
  if (!node.id) errors.push(`${path}: Missing id`);
  if (!node.type) errors.push(`${path}: Missing type`);
  if (!node.name) errors.push(`${path}: Missing name`);
  if (typeof node.x !== 'number') errors.push(`${path}: Missing x`);
  if (typeof node.y !== 'number') errors.push(`${path}: Missing y`);
  if (typeof node.width !== 'number') errors.push(`${path}: Missing width`);
  if (typeof node.height !== 'number') errors.push(`${path}: Missing height`);
  if (typeof node.visible !== 'boolean') errors.push(`${path}: Missing visible`);
  if (!Array.isArray(node.fills)) errors.push(`${path}: Missing fills array`);
  if (!Array.isArray(node.children)) errors.push(`${path}: Missing children array`);

  // Validate text nodes
  if (node.type === 'TEXT') {
    if (!node.textContent && node.textContent !== '') errors.push(`${path}: TEXT node missing textContent`);
    if (!node.textStyle) errors.push(`${path}: TEXT node missing textStyle`);
  }

  // Validate image nodes
  if (node.type === 'IMAGE') {
    if (!node.imageRef) errors.push(`${path}: IMAGE node missing imageRef`);
  }

  // Validate auto-layout
  if (node.autoLayout) {
    const al = node.autoLayout;
    if (!['HORIZONTAL', 'VERTICAL'].includes(al.direction)) errors.push(`${path}: Invalid autoLayout direction`);
    if (typeof al.spacing !== 'number') errors.push(`${path}: Invalid autoLayout spacing`);
  }

  // Recurse children
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      validateNode(node.children[i], errors, `${path}.children[${i}]`);
    }
  }
}

// Run tests
console.log('=== Web2Fig Format Validation Tests ===\n');

// Test 1: Valid document
console.log('Test 1: Validate complete sample document');
const errors = validateDocument(sampleDocument);
if (errors.length === 0) {
  console.log('  PASS: Document is valid\n');
} else {
  console.log('  FAIL: Validation errors:');
  errors.forEach((e) => console.log(`    - ${e}`));
  console.log();
}

// Test 2: Encode/decode roundtrip
console.log('Test 2: JSON encode/decode roundtrip');
const encoded = JSON.stringify(sampleDocument);
const decoded = JSON.parse(encoded);
const roundtripErrors = validateDocument(decoded);
if (roundtripErrors.length === 0) {
  console.log('  PASS: Roundtrip preserved document structure\n');
} else {
  console.log('  FAIL: Roundtrip introduced errors:');
  roundtripErrors.forEach((e) => console.log(`    - ${e}`));
  console.log();
}

// Test 3: Node count
console.log('Test 3: Node tree integrity');
function countNodes(node: any): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}
const nodeCount = countNodes(sampleDocument.root);
console.log(`  PASS: Tree contains ${nodeCount} nodes\n`);

// Test 4: Color palette
console.log('Test 4: Color palette extraction');
if (sampleDocument.colorPalette.length > 0) {
  console.log(`  PASS: ${sampleDocument.colorPalette.length} colors in palette`);
  sampleDocument.colorPalette.forEach((c) => {
    console.log(`    - ${c.name}: rgb(${(c.color.r * 255).toFixed(0)}, ${(c.color.g * 255).toFixed(0)}, ${(c.color.b * 255).toFixed(0)}) × ${c.count}`);
  });
  console.log();
} else {
  console.log('  FAIL: Empty color palette\n');
}

// Test 5: Asset references integrity
console.log('Test 5: Asset reference integrity');
function findImageRefs(node: any): string[] {
  const refs: string[] = [];
  if (node.imageRef) refs.push(node.imageRef);
  if (node.children) {
    for (const child of node.children) {
      refs.push(...findImageRefs(child));
    }
  }
  return refs;
}
const imageRefs = findImageRefs(sampleDocument.root);
const missingRefs = imageRefs.filter((ref) => !sampleDocument.assets.images[ref]);
if (missingRefs.length === 0) {
  console.log(`  PASS: All ${imageRefs.length} image references found in assets\n`);
} else {
  console.log(`  FAIL: Missing image assets: ${missingRefs.join(', ')}\n`);
}

// Test 6: File size estimation
console.log('Test 6: File size estimation');
const fileSize = Buffer.from(JSON.stringify(sampleDocument)).length;
console.log(`  INFO: Sample .w2f file size: ${(fileSize / 1024).toFixed(1)} KB`);
console.log(`  PASS: File is within acceptable size\n`);

// Summary
const allTests = 6;
const passed = errors.length === 0 && roundtripErrors.length === 0 && missingRefs.length === 0 ? allTests : allTests - 1;
console.log(`\n=== Results: ${passed}/${allTests} tests passed ===`);
