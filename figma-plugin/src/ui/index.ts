/**
 * Web2Fig Figma Plugin UI
 * Handles file upload, device selection, and communicates with the plugin sandbox.
 */

let loadedDocument: any = null;
let selectedDevice: 'desktop' | 'tablet' | 'mobile' = 'desktop';

// DOM elements
const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const fileInfo = document.getElementById('file-info')!;
const fileName = document.getElementById('file-name')!;
const fileMeta = document.getElementById('file-meta')!;
const importBtn = document.getElementById('import-btn') as HTMLButtonElement;
const statusDiv = document.getElementById('status')!;
const statusText = document.getElementById('status-text')!;
const progressFill = document.getElementById('progress-fill')!;
const screenshotPreview = document.getElementById('screenshot-preview') as HTMLImageElement;

// File drop/select handling
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

// Device selector
document.querySelectorAll('.device-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const target = e.currentTarget as HTMLElement;
    document.querySelectorAll('.device-btn').forEach((b) => b.classList.remove('active'));
    target.classList.add('active');
    selectedDevice = target.dataset.device as 'desktop' | 'tablet' | 'mobile';
  });
});

// Import button
importBtn.addEventListener('click', () => {
  if (!loadedDocument) return;

  importBtn.disabled = true;
  showStatus('Starting import...', 'processing', 0);

  parent.postMessage({
    pluginMessage: {
      type: 'import',
      document: loadedDocument,
      deviceType: selectedDevice,
      pageName: loadedDocument.title || 'Web2Fig Import',
    },
  }, '*');
});

// Listen for messages from plugin
window.onmessage = (event) => {
  const msg = event.data.pluginMessage;
  if (!msg) return;

  if (msg.type === 'status') {
    showStatus(msg.text, 'processing', msg.progress);
  }

  if (msg.type === 'complete') {
    showStatus(`${msg.text} (${msg.nodeCount} layers)`, 'success', 100);
    importBtn.disabled = false;
  }

  if (msg.type === 'error') {
    showStatus(`Error: ${msg.text}`, 'error', 0);
    importBtn.disabled = false;
  }

  // MCP-initiated import (file data passed directly)
  if (msg.type === 'mcp-import') {
    loadedDocument = msg.document;
    selectedDevice = msg.deviceType || 'desktop';
    updateFileInfo();
    importBtn.click();
  }
};

function loadFile(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target?.result as string;
      const doc = JSON.parse(text);

      if (!doc.version || !doc.root) {
        throw new Error('Invalid .w2f file format');
      }

      loadedDocument = doc;
      updateFileInfo();
      importBtn.disabled = false;

      // Auto-select device based on captured viewport
      if (doc.metadata?.deviceType) {
        selectedDevice = doc.metadata.deviceType;
        document.querySelectorAll('.device-btn').forEach((b) => {
          b.classList.toggle('active', (b as HTMLElement).dataset.device === selectedDevice);
        });
      }

    } catch (err: any) {
      showStatus(`Invalid file: ${err.message}`, 'error', 0);
    }
  };
  reader.readAsText(file);
}

function updateFileInfo() {
  if (!loadedDocument) return;

  fileName.textContent = loadedDocument.title || 'Untitled';
  fileMeta.textContent = [
    loadedDocument.url,
    `${loadedDocument.viewport?.width || '?'}x${loadedDocument.viewport?.height || '?'}`,
    loadedDocument.metadata?.deviceType || 'unknown',
  ].join(' · ');

  fileInfo.classList.add('visible');

  // Show screenshot preview
  if (loadedDocument.screenshot) {
    screenshotPreview.src = loadedDocument.screenshot;
    screenshotPreview.classList.add('visible');
  }
}

function showStatus(text: string, type: 'processing' | 'success' | 'error', progress: number) {
  statusDiv.className = `status visible ${type}`;
  statusText.textContent = text;
  progressFill.style.width = `${progress}%`;
}
