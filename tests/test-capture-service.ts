/**
 * Test: Capture Service Integration Test
 * Tests the Puppeteer-based capture against a real URL.
 */

import { CaptureService } from '../mcp-server/src/capture-service.js';
import * as fs from 'fs';
import * as path from 'path';

async function runTests() {
  console.log('=== Capture Service Integration Tests ===\n');

  const captureService = new CaptureService();

  try {
    // Test 1: Capture example.com (simple, fast page)
    console.log('Test 1: Capture example.com (desktop)');
    const result = await captureService.capture({
      url: 'https://example.com',
      deviceType: 'desktop',
      fullPage: true,
      waitFor: 1000,
    });

    console.log(`  Title: ${result.title}`);
    console.log(`  Nodes: ${result.nodeCount}`);
    console.log(`  Images: ${result.imageCount}`);
    console.log(`  Fonts: ${result.fontCount}`);
    console.log(`  File: ${result.filePath}`);

    // Verify file was created
    if (fs.existsSync(result.filePath)) {
      const fileSize = fs.statSync(result.filePath).size;
      console.log(`  File size: ${(fileSize / 1024).toFixed(1)} KB`);
      console.log('  PASS: Capture completed successfully\n');
    } else {
      console.log('  FAIL: File not created\n');
    }

    // Validate the document structure
    const doc = result.document;
    const checks = [
      ['Has version', !!doc.version],
      ['Has root', !!doc.root],
      ['Has viewport', !!doc.viewport],
      ['Has assets', !!doc.assets],
      ['Root has children', doc.root?.children?.length > 0],
      ['Has screenshot', !!doc.screenshot],
      ['Has URL', doc.url === 'https://example.com'],
      ['Device type matches', doc.metadata?.deviceType === 'desktop'],
    ];

    console.log('Test 2: Validate captured document structure');
    let allPassed = true;
    for (const [name, passed] of checks) {
      console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${name}`);
      if (!passed) allPassed = false;
    }
    console.log();

    // Test 3: Capture mobile version
    console.log('Test 3: Capture example.com (mobile)');
    const mobileResult = await captureService.capture({
      url: 'https://example.com',
      deviceType: 'mobile',
      fullPage: true,
      waitFor: 1000,
    });

    console.log(`  Viewport: ${mobileResult.document.viewport.width}x${mobileResult.document.viewport.height}`);
    console.log(`  Device type: ${mobileResult.document.metadata.deviceType}`);
    if (mobileResult.document.viewport.width === 375) {
      console.log('  PASS: Mobile viewport correct\n');
    } else {
      console.log('  FAIL: Mobile viewport incorrect\n');
    }

    // Test 4: Verify .w2f file can be parsed back
    console.log('Test 4: .w2f file round-trip');
    const fileContent = fs.readFileSync(result.filePath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    if (parsed.version && parsed.root && parsed.assets) {
      console.log('  PASS: File parses correctly\n');
    } else {
      console.log('  FAIL: Parsed file missing fields\n');
    }

    console.log('=== All capture tests completed ===');

  } catch (err: any) {
    console.error('Test error:', err.message);
  } finally {
    await captureService.cleanup();
  }
}

runTests();
