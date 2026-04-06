/**
 * Web2Fig Popup Script
 * Handles UI interactions and communicates with the background service worker.
 */

export {};

let selectedDevice: 'desktop' | 'tablet' | 'mobile' = 'desktop';

document.addEventListener('DOMContentLoaded', () => {
  // Capture buttons
  document.getElementById('btn-full')?.addEventListener('click', () => {
    startCapture('full-page');
  });

  document.getElementById('btn-viewport')?.addEventListener('click', () => {
    startCapture('viewport');
  });

  document.getElementById('btn-selection')?.addEventListener('click', () => {
    startCapture('selection');
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

  // Listen for state updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'state-update') {
      updateUI(message);
    }
  });

  // Check current state
  chrome.runtime.sendMessage({ action: 'get-status' }, (response) => {
    if (response) updateUI(response);
  });
});

function startCapture(mode: 'full-page' | 'viewport' | 'selection') {
  showStatus('Capturing...', 0);

  chrome.runtime.sendMessage({
    action: 'start-capture',
    captureMode: mode,
    deviceType: selectedDevice,
  }, (response) => {
    if (response?.success) {
      showStatus('Capture complete! File saved.', 100, 'success');
    } else {
      showStatus(response?.error || 'Capture failed', 0, 'error');
    }
  });
}

function showStatus(text: string, progress: number, type?: 'success' | 'error') {
  const statusBar = document.getElementById('status-bar')!;
  const statusText = document.getElementById('status-text')!;
  const progressFill = document.getElementById('progress-fill')!;

  statusBar.classList.add('visible');
  statusText.textContent = text;
  statusText.className = 'status-text' + (type ? ` ${type}` : '');
  progressFill.style.width = `${progress}%`;
}

function updateUI(state: { status: string; progress: number; error?: string }) {
  const statusMap: Record<string, string> = {
    idle: '',
    capturing: 'Capturing page...',
    processing: 'Processing design data...',
    downloading: 'Preparing download...',
    complete: 'Capture complete! File saved.',
    error: state.error || 'An error occurred',
  };

  if (state.status === 'idle') {
    document.getElementById('status-bar')?.classList.remove('visible');
    return;
  }

  const type = state.status === 'complete' ? 'success' :
               state.status === 'error' ? 'error' : undefined;

  showStatus(statusMap[state.status] || state.status, state.progress, type);
}
