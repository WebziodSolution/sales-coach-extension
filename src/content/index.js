/**
 * Content Script for Q4Magic Sales Coach
 */

const DETECTION_PATTERNS = {
  MEET: 'meet.google.com',
  TEAMS: 'teams.cloud.microsoft',
  TEAMS_LIVE: 'teams.live.com',
  WEBEX: 'webex.com',
  ZOOM: 'zoom.us'
};

let currentPlatform = null;
let sidebarRoot = null;
let lastCaptionText = "";
let lastBufferTime = Date.now();
let meetingWasActive = false;

// --- FRAME & SHADOW DOM UTILITIES ---
function querySelectorAcrossAll(selector, root = document) {
  try {
    const el = root.querySelector(selector);
    if (el) return el;
  } catch (e) {}

  try {
    const allElements = root.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        const shadowedEl = querySelectorAcrossAll(selector, element.shadowRoot);
        if (shadowedEl) return shadowedEl;
      }
    }
  } catch (e) {}

  if (root === document) {
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          if (iframe.contentDocument) {
            const iframeEl = querySelectorAcrossAll(selector, iframe.contentDocument);
            if (iframeEl) return iframeEl;
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  return null;
}

function querySelectorAllAcrossAll(selector, root = document) {
  let elements = [];
  try {
    elements = Array.from(root.querySelectorAll(selector));
  } catch (e) {}

  try {
    const allElements = root.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        const shadowedEls = querySelectorAllAcrossAll(selector, element.shadowRoot);
        elements = elements.concat(shadowedEls);
      }
    }
  } catch (e) {}

  if (root === document) {
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          if (iframe.contentDocument) {
            const iframeEls = querySelectorAllAcrossAll(selector, iframe.contentDocument);
            elements = elements.concat(iframeEls);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  return elements;
}

// --- PLATFORM & MEETING DETECTION ---
function detectPlatform() {
  const host = window.location.hostname;
  if (host.includes(DETECTION_PATTERNS.MEET)) return 'MEET';
  if (host.includes(DETECTION_PATTERNS.TEAMS) || host.includes(DETECTION_PATTERNS.TEAMS_LIVE)) return 'TEAMS';
  if (host.includes(DETECTION_PATTERNS.WEBEX)) return 'WEBEX';
  if (host.includes(DETECTION_PATTERNS.ZOOM)) return 'ZOOM';
  return null;
}

function isMeetingPage() {
  const path = window.location.pathname;
  const platform = detectPlatform();

  if (platform === 'MEET') {
    // Regex for meeting code like abc-defg-hij
    const isCode = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(path);
    if (!isCode) return false;

    // Check if we are in the lobby.
    // Standard lobby selectors, plus checks for buttons with "Join now", "Ask to join" or localized equivalents
    const isLobby = !!(
      document.querySelector('[jsname="Q8S7wb"]') ||
      document.querySelector('[jsname="j97Atc"]') ||
      Array.from(document.querySelectorAll('button, div[role="button"]')).some(el => {
        const text = (el.innerText || "").toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || "").toLowerCase();
        return text.includes("join now") || text.includes("ask to join") ||
          ariaLabel.includes("join now") || ariaLabel.includes("ask to join");
      })
    );

    // Check if we see meeting controls or buttons that indicate we are in an active meeting
    const isInMeeting = !!(
      document.querySelector('[jsname="CQm7mc"]') || // Leave button jsname fallback
      document.querySelector('[data-meeting-title]') ||
      document.querySelector('button[aria-label*="Leave"], button[aria-label*="leave"]') ||
      document.querySelector('[aria-label*="chat"], [aria-label*="Chat"]') ||
      document.querySelector('[aria-label*="people"], [aria-label*="People"]') ||
      document.querySelector('[aria-label*="everyone"], [aria-label*="everyone"]') ||
      document.querySelector('button[aria-label*="microphone"], button[aria-label*="Microphone"]') ||
      document.querySelector('button[aria-label*="camera"], button[aria-label*="Camera"]')
    );

    return isCode && isInMeeting && !isLobby;
  }

  if (platform === 'TEAMS') {
    const isMeetingPath = path.includes('meetup-join') || path.includes('/modern-stage/') || path.includes('/v2/meet/') || path.includes('/meet/');
    if (isMeetingPath) return true;

    // Fallback: if we are on '/v2/', check if an active call is running (Leave button is present)
    return !!findLeaveButton();
  }
  if (platform === 'WEBEX') {
    return path.includes('/meet/') || path.includes('/join/');
  }
  if (platform === 'ZOOM') {
    // Zoom pathname split by '/' should contain a numeric meeting ID (9 to 11 digits)
    const pathParts = path.split('/');
    const hasMeetingId = pathParts.some(part => /^\d{9,11}$/.test(part));
    if (!hasMeetingId) return false;

    // Check if we are in the active meeting (i.e. not the lobby/login screen or generic landing pages).
    // In the active meeting, we see zmmtg-root or specific meeting controls (mute, video, chat, participants, leave).
    const hasMeetingRoot = !!(
      querySelectorAcrossAll('#zmmtg-root') ||
      querySelectorAcrossAll('[id*="zmmtg-root"]') ||
      querySelectorAcrossAll('.meeting-info') ||
      querySelectorAcrossAll('.meeting-footer') ||
      querySelectorAcrossAll('#wc-container-right')
    );

    const hasControls = !!(
      findLeaveButton() ||
      querySelectorAcrossAll('[aria-label*="mute" i], [aria-label*="Mute" i], [aria-label*="unmute" i], [aria-label*="Unmute" i]') ||
      querySelectorAcrossAll('[aria-label*="video" i], [aria-label*="camera" i]') ||
      querySelectorAcrossAll('[aria-label*="chat" i], [aria-label*="Chat" i]') ||
      querySelectorAcrossAll('[aria-label*="participant" i]')
    );

    return hasMeetingRoot || hasControls;
  }
  return false;
}

// --- SIDEBAR INJECTION & CLEANUP ---
let shouldNeverShowAgain = false;

// --- SIDEBAR INJECTION & CLEANUP ---
function getSidebarRoot() {
  try {
    const targetDocument = (window.top && window.top.document) ? window.top.document : document;
    const root = targetDocument.getElementById('q4magic-coach-root');
    if (root && root.shadowRoot) {
      return root.shadowRoot.querySelector('iframe');
    }
  } catch (e) {}
  return null;
}

function injectSidebar() {
  let targetDocument = document;
  let targetWindow = window;
  try {
    if (window.top && window.top.document) {
      targetDocument = window.top.document;
      targetWindow = window.top;
    }
  } catch (e) {}

  if (shouldNeverShowAgain || targetDocument.getElementById('q4magic-coach-root')) return;

  const container = targetDocument.createElement('div');
  container.id = 'q4magic-coach-root';
  // ... (rest of style)
  container.style.position = 'fixed';
  container.style.right = '0';
  container.style.top = '0';
  container.style.width = '450px';
  container.style.height = '100vh';
  container.style.zIndex = '999999';
  container.style.backgroundColor = 'white';
  container.style.boxShadow = '-2px 0 10px rgba(0,0,0,0.1)';
  container.style.transition = 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
  container.style.overflow = 'hidden';

  const shadow = container.attachShadow({ mode: 'open' });
  const iframe = targetDocument.createElement('iframe');
  iframe.src = chrome.runtime.getURL('index.html');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  shadow.appendChild(iframe);

  targetDocument.body.appendChild(container);
  sidebarRoot = iframe;
}

// --- GLOBAL MESSAGE LISTENER ---
window.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  let targetDocument = document;
  try {
    if (window.top && window.top.document) {
      targetDocument = window.top.document;
    }
  } catch (e) {}

  if (event.data.type === 'SET_COLLAPSED') {
    const root = targetDocument.getElementById('q4magic-coach-root');
    if (root) {
      root.style.width = event.data.collapsed ? '48px' : '450px';
    }
  } else if (event.data.type === 'CLOSE_SIDEBAR') {
    console.log("[Q4Magic] Manual close requested. Removing sidebar permanently.");
    shouldNeverShowAgain = true;
    removeSidebar();
    stopScraping();
  } else if (event.data.type === 'SHOW_REG_MODAL') {
    showGlobalRegModal(event.data.email);
  }
});

function showGlobalRegModal(email) {
  let targetDocument = document;
  try {
    if (window.top && window.top.document) {
      targetDocument = window.top.document;
    }
  } catch (e) {}

  if (targetDocument.getElementById('q4magic-global-modal')) return;

  const modalOverlay = targetDocument.createElement('div');
  modalOverlay.id = 'q4magic-global-modal';
  Object.assign(modalOverlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '1000000',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    animation: 'q4magicFadeIn 0.3s ease-out'
  });

  const modalContent = targetDocument.createElement('div');
  Object.assign(modalContent.style, {
    backgroundColor: 'white',
    borderRadius: '24px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    maxWidth: '400px',
    width: '100%',
    padding: '32px',
    border: '1px solid #f1f5f9',
    textAlign: 'center',
    animation: 'q4magicSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
  });

  // Create Keyframes
  const styleSheet = targetDocument.createElement("style");
  styleSheet.innerText = `
    @keyframes q4magicFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes q4magicSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  `;
  targetDocument.head.appendChild(styleSheet);

  modalContent.innerHTML = `
    <div style="width: 64px; height: 64px; background-color: #fef2f2; border-radius: 9999px; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px;">
      <svg style="width: 32px; height: 32px; color: #ef4444;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
    </div>
    <h3 style="font-size: 18px; font-weight: 900; color: #0f172a; margin-bottom: 8px; text-transform: uppercase; letter-spacing: -0.025em; font-family: sans-serif;">Email Not Registered</h3>
    <p style="font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 32px; font-family: sans-serif;">
      The email <span style="font-weight: 700; color: #0f172a;">${email}</span> is not currently registered with <span style="font-weight: 700; color: #0f172a;">360Pipe</span>.
      <br><br>
      Please note that recorded meeting data will not be synchronized to the 360Pipe platform.
    </p>
    <button id="q4magic-modal-close" style="width: 100%; padding: 16px; background-color: #0f172a; color: white; border-radius: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; font-size: 10px; border: none; cursor: pointer; transition: all 0.2s; font-family: sans-serif;">
      OK
    </button>
  `;

  modalOverlay.appendChild(modalContent);
  targetDocument.body.appendChild(modalOverlay);

  targetDocument.getElementById('q4magic-modal-close').onclick = () => {
    modalOverlay.remove();
  };
}

function removeSidebar() {
  let targetDocument = document;
  try {
    if (window.top && window.top.document) {
      targetDocument = window.top.document;
    }
  } catch (e) {}

  const existing = targetDocument.getElementById('q4magic-coach-root');
  if (existing) {
    existing.remove();
    sidebarRoot = null;
  }
}

// --- ROBUST DETECTION HELPERS ---
function findCCButton() {
  if (currentPlatform === 'MEET') {
    const byJsName = document.querySelector('button[jsname="IBm91c"]');
    if (byJsName) return byJsName;
    const buttons = document.querySelectorAll('button[aria-label]');
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || "").toLowerCase();
      if (label.includes('caption') || label.includes('subtitle') || label.includes('closed caption')) {
        return btn;
      }
    }
  } else if (currentPlatform === 'TEAMS') {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || "").toLowerCase();
      if (label.includes('caption') || label.includes('subtitle') || label.includes('closed caption') || label.includes('turn on live captions')) {
        return btn;
      }
    }
  } else if (currentPlatform === 'ZOOM') {
    const candidates = querySelectorAllAcrossAll('button, div[role="button"], a, span');
    for (const btn of candidates) {
      const label = (btn.getAttribute('aria-label') || "").toLowerCase();
      const text = (btn.innerText || "").toLowerCase();
      if (label.includes('caption') || label.includes('subtitle') || label.includes('closed caption') || text.includes('caption') || text.includes('subtitle') || text.includes('cc')) {
        return btn;
      }
    }
  }
  return null;
}

function getSpeakerForCaptionNode(node, platform) {
  let parent = node.parentElement;
  if (platform === 'MEET') {
    // 1. Try known classes first
    while (parent) {
      if (parent.getAttribute('aria-label')?.includes('Captions')) break;
      const nameEl = parent.querySelector('.NWpY1d, .zs7s8d');
      if (nameEl && nameEl !== node) {
        return nameEl.innerText.trim();
      }
      parent = parent.parentElement;
    }

    // 2. Structural fallback: Find sibling container and extract short name text
    parent = node.parentElement;
    while (parent) {
      const isCaptionRegion = parent.getAttribute('aria-label')?.includes('Captions') ||
        parent.classList.contains('vNKgIf') ||
        parent.classList.contains('UDinHf');
      if (isCaptionRegion) break;

      for (const child of parent.children) {
        if (child.contains(node)) continue;
        const text = child.innerText.trim();
        if (text && text.length > 0 && text.length < 50 && !text.includes('\n')) {
          return text;
        }
      }
      parent = parent.parentElement;
    }
  } else if (platform === 'TEAMS') {
    // 1. Try known classes/attributes first
    while (parent) {
      if (parent.getAttribute('data-tid')?.includes('closed-caption-v2-virtual-list-content')) break;
      const nameEl = parent.querySelector('[data-tid="author"], [data-tid*="author"], .ui-chat__message__author');
      if (nameEl && nameEl !== node) {
        return nameEl.innerText.trim();
      }
      parent = parent.parentElement;
    }

    // 2. Structural fallback
    parent = node.parentElement;
    while (parent) {
      const isListContent = parent.getAttribute('data-tid')?.includes('closed-caption-v2-virtual-list-content') ||
        parent.classList.contains('closed-caption-renderer-wrapper');
      if (isListContent) break;

      for (const child of parent.children) {
        if (child.contains(node)) continue;
        const text = child.innerText.trim();
        if (text && text.length > 0 && text.length < 50 && !text.includes('\n')) {
          return text;
        }
      }
      parent = parent.parentElement;
    }
  } else if (platform === 'ZOOM') {
    while (parent) {
      if (parent.classList && (parent.classList.contains('live-transcription') || parent.getAttribute('class')?.includes('live-transcription'))) {
        break;
      }
      const nameEl = parent.querySelector('[class*="speaker" i], [class*="name" i], [class*="user" i], [class*="avatar" i]');
      if (nameEl && nameEl !== node) {
        const nameText = nameEl.innerText.trim();
        if (nameText && nameText.length > 0 && nameText.length < 50) {
          return nameText;
        }
      }
      parent = parent.parentElement;
    }

    // Fallback: parse speaker name from text (e.g., "John Doe: hello")
    const text = (node.innerText || "").trim();
    const colonIndex = text.indexOf(':');
    if (colonIndex > 0 && colonIndex < 40) {
      const speakerPart = text.substring(0, colonIndex).trim();
      if (!/^\d+$/.test(speakerPart) && !speakerPart.includes('http')) {
        return speakerPart;
      }
    }
  }
  return null;
}

function findCaptionText() {
  let nodes = [];
  if (currentPlatform === 'MEET') {
    const preciseSelectors = [
      '[aria-label="Captions"] .ygicle',
      '.ygicle.VbkSUe',
      '.ygicle',
      '.VbkSUe'
    ];
    nodes = Array.from(document.querySelectorAll(preciseSelectors.join(', ')));
  } else if (currentPlatform === 'TEAMS') {
    const preciseSelectors = [
      '[data-tid="closed-caption-text"]',
      '[data-tid*="closed-caption-text"]',
      '.closed-caption-text'
    ];
    nodes = Array.from(document.querySelectorAll(preciseSelectors.join(', ')));
  } else if (currentPlatform === 'ZOOM') {
    const preciseSelectors = [
      '.live-transcription-subtitle__item',
      '.live-transcription-subtitle',
      '[class*="live-transcription-subtitle__item"]',
      '[class*="live-transcription-subtitle"]'
    ];
    nodes = querySelectorAllAcrossAll(preciseSelectors.join(', '));
  }

  if (nodes.length === 0) return "";

  // Group consecutive nodes by speaker
  const groups = [];
  let currentGroup = null;

  for (const node of nodes) {
    const speaker = getSpeakerForCaptionNode(node, currentPlatform) || "Speaker";
    let text = (node.innerText || "").trim();
    if (!text) continue;

    // Strip speaker prefix if it is already in the text to avoid duplication
    if (speaker && speaker !== "Speaker" && text.toLowerCase().startsWith(speaker.toLowerCase() + ":")) {
      text = text.substring(speaker.length + 1).trim();
    }
    if (!text) continue;

    if (currentGroup && currentGroup.speaker === speaker) {
      currentGroup.texts.push(text);
    } else {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        speaker,
        texts: [text]
      };
    }
  }
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups.map(g => {
    const combinedText = g.texts.join(" ");
    return `${g.speaker}: ${combinedText}`;
  }).join("\n");
}

// --- CAPTION SCRAPING ---
let scrapingObservers = new Map(); // Map of targetNode -> MutationObserver

function startScraping() {
  currentPlatform = detectPlatform();
  if (!currentPlatform) return;

  const callback = () => {
    let newText = "";
    if (currentPlatform === 'MEET' || currentPlatform === 'TEAMS' || currentPlatform === 'ZOOM') {
      newText = findCaptionText();
    }
    if (newText && newText !== lastCaptionText) {
      processCaptions(newText);
      lastCaptionText = newText;
    }

    // Proactively check if new same-origin iframes have been added, and observe them
    if (currentPlatform === 'ZOOM') {
      observeAllIframes(callback);
    }
  };

  // Start observing main body
  observeNode(document.body, callback);
  
  if (currentPlatform === 'ZOOM') {
    observeAllIframes(callback);
  }
}

function observeNode(node, callback) {
  if (scrapingObservers.has(node)) return;
  try {
    const obs = new MutationObserver(callback);
    obs.observe(node, { childList: true, subtree: true, characterData: true });
    scrapingObservers.set(node, obs);
  } catch (e) {}
}

function observeAllIframes(callback) {
  try {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        if (iframe.contentDocument && iframe.contentDocument.body) {
          observeNode(iframe.contentDocument.body, callback);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

function stopScraping() {
  for (const obs of scrapingObservers.values()) {
    obs.disconnect();
  }
  scrapingObservers.clear();
}

function checkCaptionsStatus() {
  let ccActive = false;
  if (lastCaptionText && (Date.now() - lastBufferTime < 8000)) {
    ccActive = true;
  }
  if (!ccActive) {
    if (currentPlatform === 'MEET') {
      const ccButton = findCCButton();
      const ccRegion = document.querySelector('[aria-label="Captions"], .vNKgIf, .UDinHf');
      ccActive = (ccButton && ccButton.getAttribute('aria-pressed') === 'true') || !!ccRegion;
    } else if (currentPlatform === 'TEAMS') {
      const ccButton = findCCButton();
      const ccRegion = document.querySelector('[data-tid="closed-caption-renderer-wrapper"], [data-tid="closed-caption-v2-virtual-list-content"]');
      ccActive = (ccButton && (ccButton.getAttribute('aria-pressed') === 'true' || ccButton.getAttribute('aria-checked') === 'true')) || !!ccRegion;
    } else if (currentPlatform === 'ZOOM') {
      const ccButton = findCCButton();
      const ccRegion = querySelectorAcrossAll('.live-transcription, [class*="live-transcription"]');
      ccActive = (ccButton && (ccButton.getAttribute('aria-pressed') === 'true' || ccButton.getAttribute('aria-checked') === 'true' || ccButton.getAttribute('aria-expanded') === 'true')) || !!ccRegion;
    }
  }
  const root = getSidebarRoot();
  if (root && root.contentWindow) {
    root.contentWindow.postMessage({ type: 'CC_STATUS', active: ccActive }, '*');
  }
}

function processCaptions(text) {
  const now = Date.now();
  const isSentenceEnd = /[.!?]$/.test(text.trim());
  const timeDiff = now - lastBufferTime;
  if (isSentenceEnd || timeDiff > 10000) {
    const chunk = text.trim();
    if (chunk) {
      sendToSidebar(chunk);
      lastBufferTime = now;
    }
  }
}

function sendToSidebar(text) {
  const root = getSidebarRoot();
  if (root && root.contentWindow) {
    root.contentWindow.postMessage({ type: 'NEW_CAPTION', text }, '*');
  }
}

// --- MAIN CONTROLLER ---
function findLeaveButton() {
  if (currentPlatform === 'MEET') {
    // Red "Leave call" button in Google Meet (with translations support)
    const buttons = Array.from(document.querySelectorAll('button'));
    const leaveBtn = buttons.find(btn => {
      const label = (btn.getAttribute('aria-label') || "").toLowerCase();
      return label.includes('leave') || label.includes('quitter') || label.includes('salir') || label.includes('hang up');
    });
    if (leaveBtn) return leaveBtn;
    return document.querySelector('button[aria-label="Leave call"], [jsname="CQm7mc"]');
  } else if (currentPlatform === 'TEAMS') {
    // Leave button in Teams: usually has aria-label containing "leave" or "hang up" or id "hangup-button"
    const leaveBtn = document.querySelector('button[aria-label*="Leave"], button[aria-label*="leave"], button[id*="hangup"], button[data-tid*="hangup"]');
    if (leaveBtn) return leaveBtn;
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || "").toLowerCase();
      if (label.includes('leave') || label.includes('hang up') || label.includes('hangup')) {
        return btn;
      }
    }
  } else if (currentPlatform === 'ZOOM') {
    const leaveBtn = querySelectorAcrossAll('[aria-label*="Leave" i], [aria-label*="leave" i], [aria-label*="End" i], [aria-label*="end" i], [class*="leave" i], [class*="end-meeting" i], [id*="leave" i]');
    if (leaveBtn) return leaveBtn;
    
    const candidates = querySelectorAllAcrossAll('button, div[role="button"], a, span');
    for (const btn of candidates) {
      const label = (btn.getAttribute('aria-label') || "").toLowerCase();
      const text = (btn.innerText || "").toLowerCase();
      const className = (btn.className || "").toLowerCase();
      if (label.includes('leave') || label.includes('end') || text === 'leave' || text === 'end' || text === 'leave meeting' || text === 'end meeting' || className.includes('leave') || className.includes('end-btn')) {
        return btn;
      }
    }
  }
  return null;
}

function handleMeetingEnd() {
  const root = getSidebarRoot();
  if (meetingWasActive && root && root.contentWindow) {
    console.log("[Q4Magic] Meeting ended detected. Sending signal to sidebar.");
    root.contentWindow.postMessage({ type: 'MEETING_END' }, '*');
    meetingWasActive = false; // Prevent duplicate signals
  }
}

// Listen for tab close/refresh
window.addEventListener('beforeunload', handleMeetingEnd);

// Add listener to Leave button
function attachLeaveListener() {
  const leaveBtn = findLeaveButton();
  if (leaveBtn && !leaveBtn.dataset.q4magicListener) {
    leaveBtn.addEventListener('click', handleMeetingEnd);
    leaveBtn.dataset.q4magicListener = 'true';
  }
}

let lastDebugPlatform = null;
let lastDebugInMeeting = null;

function monitorMeetingState() {
  if (shouldNeverShowAgain) return;

  currentPlatform = detectPlatform();
  const inMeeting = isMeetingPage();

  if (currentPlatform !== lastDebugPlatform || inMeeting !== lastDebugInMeeting) {
    console.log(`[Q4Magic] Platform: ${currentPlatform}, InMeeting: ${inMeeting}`);
    lastDebugPlatform = currentPlatform;
    lastDebugInMeeting = inMeeting;
  }

  // Send meeting end signal when transitioning from true to false
  if (meetingWasActive && !inMeeting) {
    handleMeetingEnd();
  }

  if (inMeeting) {
    meetingWasActive = true;
    injectSidebar();
    startScraping();
    attachLeaveListener();

    // Send meeting code to sidebar
    let meetingCode = window.location.pathname.substring(1);
    if (currentPlatform === 'ZOOM') {
      const pathParts = window.location.pathname.split('/');
      const numericPart = pathParts.find(part => /^\d{9,11}$/.test(part));
      if (numericPart) {
        meetingCode = numericPart;
      }
    }
    const root = getSidebarRoot();
    if (root && root.contentWindow) {
      root.contentWindow.postMessage({ type: 'SET_MEETING_CODE', meetingCode }, '*');
    }
  } else {
    // DO NOT auto-remove anymore. The user will click "Submit" or "Close" in the sidebar.
    // The summary stays visible on the "You left" page.
  }
}

setInterval(monitorMeetingState, 2000);
setInterval(checkCaptionsStatus, 3000);
monitorMeetingState();
