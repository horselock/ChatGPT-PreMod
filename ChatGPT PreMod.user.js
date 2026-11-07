// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      2.4.0
// @description  Hides moderation visual effects. Prevents deletion of streaming response (fetch + WebSocket stream-handoff). Saves responses to GM storage and injects them into loaded conversations based on message ID.
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @downloadURL  https://github.com/horselock/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @updateURL    https://github.com/horselock/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @grant        GM.addElement
// @grant        GM_addElement
// ==/UserScript==

(() => { "use strict";
  const messageHandler = async (event) => {
    const data = event.data;
    if (!data || data.type !== 'premod-bridge') return;

    let result;
    try {
      if (data.op === 'get') result = await GM.getValue(data.key);
      else if (data.op === 'set') { await GM.setValue(data.key, data.value); result = true; }
    } catch (e) {
      result = null;
    }

    window.postMessage({ type: 'premod-response', id: data.id, result }, '*');
  };

  window.addEventListener('message', messageHandler);

  const toggleSetting = async (key, label) => {
    const value = (await GM.getValue(key, true)) === false;
    await GM.setValue(key, value);
    window.postMessage({ type: 'premod-setting', key, value, label }, '*');
  };

  if (typeof GM.registerMenuCommand === 'function') {
    GM.registerMenuCommand('Toggle all banners', () => toggleSetting('showBanners', 'Banners'));
    GM.registerMenuCommand('Toggle "PreMod Active" startup banner', () => toggleSetting('showStartupBanner', 'Startup banner'));
    GM.registerMenuCommand('Toggle reloading when a restored red stays hidden', () => toggleSetting('reloadCachedReds', 'Reload to restore'));
  }

  const inpageCode = `(() => { "use strict";
    if (document.documentElement.dataset.premodInjected === '1') return;
    document.documentElement.dataset.premodInjected = '1';

    const settings = { showBanners: true, showStartupBanner: true, reloadCachedReds: true };
    const pendingBridgeRequests = new Map();

    const bridge = (operation, key, value) => new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      pendingBridgeRequests.set(id, resolve);
      window.postMessage({ type: 'premod-bridge', id, op: operation, key, value }, '*');
    });

    const settingsLoaded = Promise.all(Object.keys(settings).map(async (key) => {
      const value = await bridge('get', key);
      if (typeof value === 'boolean') settings[key] = value;
    }));

    const showBanner = async (message, color = "#2c7a7b", duration = 2000, force = false) => {
      await settingsLoaded;
      if (!force && !settings.showBanners) return;
      if (!document.body) return setTimeout(() => showBanner(message, color, duration, force), 100);

      document.getElementById('premod-banner')?.remove();
      const banner = document.createElement('div');
      banner.id = 'premod-banner';
      banner.textContent = message;
      Object.assign(banner.style, {position:"fixed",top:"15px",left:"50%",transform:"translateX(-50%)",padding:"8px 14px",borderRadius:"6px",color:"#fff",background:color,zIndex:999999,boxShadow:"0 3px 10px #0005",opacity:"0",transition:"opacity .25s, top .25s",pointerEvents:"none"});
      document.body.appendChild(banner);

      requestAnimationFrame(() => {
        banner.style.opacity = "1";
        banner.style.top = "25px";
      });

      setTimeout(() => {
        banner.style.opacity = "0";
        banner.style.top = "15px";
        setTimeout(() => banner.remove(), 250);
      }, duration);
    };

    settingsLoaded.then(() => {
      if (settings.showStartupBanner) showBanner("PreMod Active");
    });

    const messageListener = (event) => {
      const data = event.data;
      if (data?.type === 'premod-response' && pendingBridgeRequests.has(data.id)) {
        const resolve = pendingBridgeRequests.get(data.id);
        pendingBridgeRequests.delete(data.id);
        resolve(data.result);
      } else if (data?.type === 'premod-setting' && data.key in settings && typeof data.value === 'boolean') {
        settings[data.key] = data.value;
        showBanner(data.label + ': ' + (data.value ? 'ON' : 'OFF'), "#2c7a7b", 2000, true);
      }
    };

    window.addEventListener('message', messageListener);

    const apiUrlPattern = /\\/backend-api\\/(?:f\\/)?conversations?(?:\\/[a-f0-9-]{36}(?:\\/messages)?)?(?:\\?.*)?$/i;
    const unblockFlagged = (moderationObj) => moderationObj?.blocked && (moderationObj.blocked = false, true);

    // Your message text is only sent on the POST that starts a turn. Stash it here (same
    // source the old fetch path read from args[1].body) so the WebSocket hook can restore
    // it if the request gets blocked - the block verdict now arrives over the WebSocket.
    const pendingInputs = new Map(); // message_id -> content
    const rememberInput = (args) => {
      try {
        const body = args?.[1]?.body;
        if (typeof body !== 'string') return;
        const parsed = JSON.parse(body);
        if (!Array.isArray(parsed.messages)) return;
        if (pendingInputs.size > 100) pendingInputs.clear();
        for (const m of parsed.messages) {
          if (m?.id && typeof m.content?.parts?.[0] === 'string') pendingInputs.set(m.id, m.content.parts[0]);
        }
      } catch {}
    };

    // Follows the messages a turn streams (snapshots, appends and patch ops) so a blocked
    // one can be saved with its full text. Saves when the verdict arrives, then again
    // whenever more text follows it. Used by both the fetch stream and the WebSocket.
    const createCapture = (transport) => {
      const messages = new Map(); // message_id -> { role, channel, text }
      let activeId = null;
      let lastPath = '';
      let lastOperation = 'append';
      let unassignedText = '';
      const blockedIds = new Set();
      const saved = new Map(); // message_id -> text last written
      let saveQueue = Promise.resolve();

      const rememberMessage = (message) => {
        activeId = message.id;
        lastPath = '';
        lastOperation = 'append';
        const previous = messages.get(activeId);
        messages.set(activeId, {
          role: message.author?.role || previous?.role,
          channel: message.channel || previous?.channel,
          text: Array.isArray(message.content?.parts)
            ? message.content.parts.filter(part => typeof part === 'string').join('')
            : (previous?.text || '')
        });
        // A full message snapshot supersedes any text we couldn't attribute yet
        unassignedText = '';
      };

      const captureOperation = (op) => {
        if (!op || typeof op !== 'object') return;
        // Deltas omit p and o when they repeat the previous op's
        const path = typeof op.p === 'string' ? op.p : lastPath;
        const operation = op.o || lastOperation;
        lastPath = path;
        lastOperation = operation;
        if (op.v?.message?.id) return rememberMessage(op.v.message);
        if (path === '/message' && op.v?.id) return rememberMessage(op.v);
        const state = messages.get(activeId);
        if (path === '/message/channel' && state) { state.channel = op.v; return; }
        if (path === '/message/author/role' && state) { state.role = op.v; return; }
        // Metadata, status and tool updates must not become response text
        if (path && !/^\\/message\\/content(?:\\/parts(?:\\/\\d+)?)?$/.test(path)) return;
        if (operation === 'patch' && Array.isArray(op.v)) {
          for (const child of op.v) captureOperation(child);
          return;
        }
        let text;
        if (typeof op.v === 'string') text = op.v;
        else if (Array.isArray(op.v) && path === '/message/content/parts') text = op.v.filter(part => typeof part === 'string').join('');
        else if (Array.isArray(op.v?.parts)) text = op.v.parts.filter(part => typeof part === 'string').join('');
        if (text === undefined) return;
        if (operation !== 'append' && operation !== 'replace' && operation !== 'add') return;
        if (state) {
          if (state.role && state.role !== 'assistant') return;
          if (state.channel && state.channel !== 'final') return;
          state.text = operation === 'append' ? state.text + text : text;
        } else {
          unassignedText = operation === 'append' ? unassignedText + text : text;
        }
      };

      const capturePayload = (payload) => {
        if (payload.message?.id) rememberMessage(payload.message);
        if (payload.v?.message?.id) rememberMessage(payload.v.message);
        else if (Array.isArray(payload.v)) for (const op of payload.v) captureOperation(op);
        else if (Object.prototype.hasOwnProperty.call(payload, 'v')) captureOperation(payload);
      };

      const markBlocked = (id) => {
        if (!id) return;
        blockedIds.add(id);
        const isInput = pendingInputs.has(id);
        // A verdict for a message we never saw a snapshot of claims the text streamed so far
        if (!isInput && !messages.has(id) && (unassignedText || !activeId)) {
          messages.set(id, { role: 'assistant', channel: 'final', text: unassignedText });
          activeId = id;
          unassignedText = '';
        }
        console.debug('[PreMod] ' + transport + ': Detected blocked ' + (isInput ? 'input' : 'response') + ':', id);
        if (isInput) showBanner('REQUEST RED. Be careful!', '#c53030', 5000);
      };

      const persistBlocked = async () => {
        for (const id of blockedIds) {
          const isInput = pendingInputs.has(id);
          const text = isInput ? pendingInputs.get(id) : messages.get(id)?.text;
          if (!text || saved.get(id) === text) continue;
          if (await bridge('set', 'msg_' + id, text) !== true) {
            console.warn('[PreMod] ' + transport + ': Could not save blocked message:', id);
            continue;
          }
          if (!saved.has(id) && !isInput) showBanner('Response red, saved it for you =)', '#dd6b20');
          saved.set(id, text);
          console.debug('[PreMod] ' + transport + ': Saved blocked ' + (isInput ? 'input' : 'response') + ':', id, 'characters:', text.length);
        }
      };

      // Queued so an earlier, shorter snapshot can't overwrite newer text
      const persist = () => {
        if (blockedIds.size) saveQueue = saveQueue.then(persistBlocked);
        return saveQueue;
      };

      const warnUnsaved = () => {
        for (const id of blockedIds) {
          if (!saved.has(id)) console.warn('[PreMod] ' + transport + ': No text captured for blocked message:', id);
        }
      };

      return { capturePayload, markBlocked, persist, warnUnsaved };
    };

    const originalFetch = fetch;
    fetch = async function(...args) {
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (!requestUrl || !apiUrlPattern.test(requestUrl)) {
        return originalFetch.apply(this, args);
      }
      rememberInput(args);

      const apiResponse = await originalFetch.apply(this, args);
      const contentType = (apiResponse.headers.get('content-type') || '').toLowerCase();

      if (contentType.includes('text/event-stream') && apiResponse.body) {
        const capture = createCapture('Stream');

        // Rewrite one complete SSE event; null drops it
        const processEvent = (rawEvent) => {
          const lines = rawEvent.split(/\\r?\\n/);
          const dataLines = lines.filter(line => line.startsWith('data:'));
          if (!dataLines.length) return rawEvent;
          const data = dataLines.map(line => line.slice(5).replace(/^ /, '')).join('\\n');
          if (data.trim() === '[DONE]') return rawEvent;
          let payload;
          try { payload = JSON.parse(data); } catch { return rawEvent; }
          if (!payload || typeof payload !== 'object') return rawEvent;
          capture.capturePayload(payload);
          let changed = false;

          // Check for blocked messages FIRST before filtering anything
          if (unblockFlagged(payload.moderation_response)) {
            capture.markBlocked(payload.message_id);
            changed = true;
          }

          // Filter out type: "moderation" chunks (AFTER checking for blocked)
          if (payload.type === 'moderation') {
            console.debug('[PreMod] Filtered out moderation chunk:', payload);
            return null;
          }

          // Filter out is_visually_hidden_from_conversation delta (AFTER checking for blocked)
          if (Array.isArray(payload.v)) {
            const filtered = payload.v.filter(op => !op?.p?.includes('is_visually_hidden_from_conversation'));
            if (filtered.length < payload.v.length) {
              console.debug('[PreMod] Filtered out visibility hide op from delta:', payload);
              showBanner('Safety disclaimer bypassed', "#48bb78", 3000);
              if (filtered.length === 0) return null;
              payload.v = filtered;
              changed = true;
            }
          }

          if (!changed) return rawEvent;
          return lines.filter(line => !line.startsWith('data:')).concat('data: ' + JSON.stringify(payload)).join('\\n');
        };

        const reader = apiResponse.body.getReader();
        const modifiedStream = new ReadableStream({
          async start(controller) {
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            // Network chunks can split an event, so only process complete ones
            let buffer = '';
            const flushEvents = async (atEnd = false) => {
              let boundary;
              while ((boundary = /\\r?\\n\\r?\\n/.exec(buffer))) {
                const rewritten = processEvent(buffer.slice(0, boundary.index));
                buffer = buffer.slice(boundary.index + boundary[0].length);
                if (rewritten !== null) controller.enqueue(encoder.encode(rewritten + '\\n\\n'));
              }
              if (atEnd && buffer) {
                const rewritten = processEvent(buffer);
                buffer = '';
                if (rewritten !== null) controller.enqueue(encoder.encode(rewritten + '\\n\\n'));
              }
              await capture.persist();
            };

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                await flushEvents();
              }
              buffer += decoder.decode();
              await flushEvents(true);
              capture.warnUnsaved();
              controller.close();
            } catch (error) {
              await capture.persist();
              controller.error(error);
            }
          },
          cancel(reason) { return reader.cancel(reason); }
        });

        return new Response(modifiedStream, {
          headers: apiResponse.headers,
          status: apiResponse.status,
          statusText: apiResponse.statusText
        });
      }

      if (contentType.includes('application/json')) {
        let responseText = await apiResponse.text();
        try {
          const responseData = JSON.parse(responseText);
          let modified = false;

          // Full loads key messages by node under "mapping"; paginated loads
          // (/conversations/<id>/messages) list them under "messages", bare or in node wrappers.
          const slots = new Map(); // message_id -> message
          const addSlot = (message, fallbackId) => {
            if (!message || typeof message !== 'object') return;
            const id = message.id || fallbackId;
            if (typeof id === 'string' && !slots.has(id)) slots.set(id, message);
          };
          for (const [nodeId, node] of Object.entries(responseData.mapping || {})) addSlot(node?.message, nodeId);
          const walkMessages = (value, fallbackId) => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) {
              for (const item of value) walkMessages(item);
            } else if (value.message && typeof value.message === 'object') {
              addSlot(value.message, value.id || fallbackId);
            } else if ((value.id || fallbackId) && (value.author || value.content)) {
              addSlot(value, fallbackId);
            } else {
              for (const [key, child] of Object.entries(value)) {
                if (key !== 'metadata' && key !== 'content') walkMessages(child, key);
              }
            }
          };
          walkMessages(responseData.messages);

          // Verdicts can cover older messages that only arrive on a later page; look those up too
          const moderation = Array.isArray(responseData.moderation_results) ? responseData.moderation_results : [];
          const lookupIds = new Set([...slots.keys(), ...moderation.map(result => result.message_id).filter(Boolean)]);
          const savedText = new Map();
          await Promise.all([...lookupIds].map(async (id) => {
            const text = await bridge('get', 'msg_' + id);
            if (typeof text === 'string' && text) savedText.set(id, text);
          }));

          const restored = [];
          for (const [id, message] of slots) {
            if (savedText.has(id)) {
              console.debug('[PreMod] Convo history: Saved content found, restoring blocked message:', id);
              message.content = { ...(message.content || {}), content_type: 'text', parts: [savedText.get(id)] };
              restored.push(id);
              modified = true;
            }
            // Unset is_visually_hidden_from_conversation
            if (message.metadata?.is_visually_hidden_from_conversation && message.author?.role === 'assistant') {
              console.debug('[PreMod] Convo history: Unhiding message:', id);
              message.metadata.is_visually_hidden_from_conversation = false;
              modified = true;
            }
          }

          if (moderation.length) {
            responseData.moderation_results = moderation.filter((result) => {
              // Drop the whole verdict for anything we have text for, even if its message is on
              // a page not loaded yet; any leftover verdict field can still blank the message.
              if (savedText.has(result.message_id)) {
                modified = true;
                return false;
              }
              // Filter out safety disclaimers
              if (Array.isArray(result.disclaimers) && result.disclaimers.length > 0) {
                console.debug('[PreMod] Convo history: Removed disclaimer(s)');
                result.disclaimers = [];
                modified = true;
              }
              // Leave it blocked without saved text - an unblocked-but-empty message breaks the UI (can't scroll)
              if (result.blocked) console.debug('[PreMod] Convo history: No saved content, leaving blocked:', result.message_id);
              return true;
            });
          }

          const historyConversationId = responseData.conversation_id || requestUrl.match(/\\/conversations?\\/([a-f0-9-]{36})/i)?.[1];
          if (historyConversationId && restored.length) rememberRestored(historyConversationId, restored, responseData.current_node);

          if (modified) responseText = JSON.stringify(responseData);
        } catch (error) {
          console.warn('[PreMod] Convo history: Processing failed:', error);
        }

        return new Response(responseText, {
          headers: apiResponse.headers,
          status: apiResponse.status,
          statusText: apiResponse.statusText
        });
      }

      return apiResponse;
    };

    // ===== Cached verdict recovery =====
    // ChatGPT can show a conversation from its local cache and merge fresh moderation state
    // into it, so a blocked verdict we removed from the response can survive and blank a
    // message we restored. Loading with ?messageId= skips that cache, so if a restored
    // message still shows the safety notice, reload through that route once.
    const restoredByConversation = new Map(); // conversation_id -> { ids, currentNode, expires }
    let recoveryTimer = null;
    let recoveryStarted = false;

    const rememberRestored = (conversationId, ids, currentNode) => {
      const previous = restoredByConversation.get(conversationId);
      restoredByConversation.set(conversationId, {
        ids: new Set([...(previous?.ids || []), ...ids]),
        currentNode: currentNode || previous?.currentNode,
        expires: Date.now() + 30000
      });
      queueRecoveryCheck();
    };

    const queueRecoveryCheck = () => {
      if (recoveryStarted || recoveryTimer !== null || !restoredByConversation.size) return;
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        checkRecovery();
      }, 750);
    };

    const checkRecovery = () => {
      if (recoveryStarted || !settings.reloadCachedReds) return;
      const url = new URL(location.href);
      const conversationId = url.pathname.match(/\\/c\\/([a-f0-9-]{36})/i)?.[1];
      const state = restoredByConversation.get(conversationId);
      if (!state || state.expires < Date.now()) return;
      // Respect explicit message links, including our own retry URL
      if (url.searchParams.has('messageId') || url.searchParams.has('message')) return;

      const stillBlocked = [];
      for (const node of document.querySelectorAll('[data-chatgpt-selection-message-id]')) {
        if (node.getAttribute('data-chatgpt-selection-conversation-id') !== conversationId) continue;
        const id = node.getAttribute('data-chatgpt-selection-message-id');
        if (!state.ids.has(id)) continue;
        const notice = [...node.querySelectorAll('p')].some(p =>
          /This content can[\\u2019']t be shown for safety reasons/i.test(p.textContent || ''));
        if (notice) stillBlocked.push(id);
      }
      if (!stillBlocked.length) return;

      // Guard against reload loops if the retry doesn't help
      const guardKey = 'premod-recovery:' + conversationId;
      try {
        const lastAttempt = Number(sessionStorage.getItem(guardKey));
        if (lastAttempt && Date.now() - lastAttempt < 30000) {
          console.warn('[PreMod] Recovery: Already retried recently, not reloading again');
          return;
        }
        sessionStorage.setItem(guardKey, String(Date.now()));
      } catch {}

      recoveryStarted = true;
      const id = stillBlocked.includes(state.currentNode) ? state.currentNode : stillBlocked[stillBlocked.length - 1];
      url.searchParams.set('messageId', id);
      console.debug('[PreMod] Recovery: Restored message still shows the safety notice, reloading past the cache:', id);
      location.replace(url.href);
    };

    new MutationObserver(queueRecoveryCheck).observe(document.documentElement, { childList: true, subtree: true });

    // ===== WebSocket hook =====
    // Live turns now stream over ws.chatgpt.com via a "stream_handoff": the response
    // and its moderation verdict arrive as WS frames whose "encoded_item" is the exact
    // old SSE text. The fetch hook above never sees them, so we intercept here too.
    const TURN_TOPIC_PREFIX = 'conversation-turn-';
    const wsTurnState = new Map(); // topic_id -> per-turn capture

    const getWsState = (topicId) => {
      let state = wsTurnState.get(topicId);
      if (!state) {
        if (wsTurnState.size > 100) wsTurnState.clear(); // crude leak guard over a long session
        state = createCapture('WS');
        wsTurnState.set(topicId, state);
      }
      return state;
    };

    // Process one unwrapped SSE "encoded_item". Captures text and saves blocked messages, and
    // returns rewritten text if it changed anything, otherwise null (leave the frame untouched).
    const processEncodedItem = (text, capture) => {
      const lines = text.split('\\n');
      let touched = false;
      const kept = [];
      for (let line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') { kept.push(line); continue; }
        let payload;
        try { payload = JSON.parse(line.slice(6)); } catch { kept.push(line); continue; }
        capture.capturePayload(payload);

        // Block verdict: handled per message_id so a double-red saves both the request and the response.
        // A verdict can also ride on events other than standalone moderation ones, so rewrite those.
        if (unblockFlagged(payload.moderation_response)) {
          capture.markBlocked(payload.message_id);
          touched = true;
          line = 'data: ' + JSON.stringify(payload);
        }

        // Drop standalone moderation events entirely (no red flash)
        if (payload.type === 'moderation') { touched = true; continue; }

        // Strip visibility-hide ops (safety disclaimers) from delta arrays
        if (Array.isArray(payload.v)) {
          const filtered = payload.v.filter((op) => !(op && op.p && op.p.includes('is_visually_hidden_from_conversation')));
          if (filtered.length < payload.v.length) {
            touched = true;
            showBanner('Safety disclaimer bypassed', '#48bb78', 3000);
            if (filtered.length === 0) continue;
            payload.v = filtered;
            kept.push('data: ' + JSON.stringify(payload)); continue;
          }
        }

        kept.push(line);
      }
      capture.persist();
      return touched ? kept.join('\\n') : null;
    };

    // Walk a WS frame batch; rewrite any conversation-turn stream-items in place.
    const processWsData = (data) => {
      if (typeof data !== 'string' || data.indexOf('conversation-turn-stream') === -1) return data;
      let batch;
      try { batch = JSON.parse(data); } catch { return data; }
      if (!Array.isArray(batch)) return data;
      let changed = false;
      for (const item of batch) {
        try {
          if (!item || item.type !== 'message') continue;
          if (String(item.topic_id || '').indexOf(TURN_TOPIC_PREFIX) !== 0) continue;
          const streamItem = item.payload && item.payload.type === 'conversation-turn-stream' && item.payload.payload;
          if (!streamItem || streamItem.type !== 'stream-item' || typeof streamItem.encoded_item !== 'string') continue;
          const rewritten = processEncodedItem(streamItem.encoded_item, getWsState(item.topic_id));
          if (rewritten !== null) { streamItem.encoded_item = rewritten; changed = true; }
        } catch {}
      }
      if (!changed) return data;
      try { return JSON.stringify(batch); } catch { return data; }
    };

    // Deliver a possibly-rewritten copy of each frame to the site's listeners. We wrap
    // per-listener but cache by event so processWsData (which mutates state) runs once per frame.
    const premodProcessed = new WeakMap();
    const wrapWsListener = (listener) => function (event) {
      let newData;
      if (premodProcessed.has(event)) newData = premodProcessed.get(event);
      else { try { newData = processWsData(event.data); } catch { newData = event.data; } premodProcessed.set(event, newData); }
      if (newData === event.data) return listener.call(this, event);
      // Proxy the original event so target/currentTarget/etc. are preserved, overriding only .data
      const proxied = new Proxy(event, {
        get(target, prop) {
          if (prop === 'data') return newData;
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      return listener.call(this, proxied);
    };

    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, argList) {
        const ws = new target(...argList);
        const add = ws.addEventListener.bind(ws);
        const remove = ws.removeEventListener.bind(ws);
        const wrappedByOriginal = new WeakMap();
        ws.addEventListener = function (type, listener, options) {
          if (type === 'message' && typeof listener === 'function') {
            const wrapped = wrapWsListener(listener);
            wrappedByOriginal.set(listener, wrapped);
            return add('message', wrapped, options);
          }
          return add(type, listener, options);
        };
        ws.removeEventListener = function (type, listener, options) {
          if (type === 'message' && typeof listener === 'function' && wrappedByOriginal.has(listener)) {
            return remove('message', wrappedByOriginal.get(listener), options);
          }
          return remove(type, listener, options);
        };
        let onMessageHandler = null;
        let onMessageWrapped = null;
        Object.defineProperty(ws, 'onmessage', {
          configurable: true,
          enumerable: true,
          get() { return onMessageHandler; },
          set(fn) {
            if (onMessageWrapped) { remove('message', onMessageWrapped); onMessageWrapped = null; }
            onMessageHandler = typeof fn === 'function' ? fn : null;
            if (onMessageHandler) { onMessageWrapped = wrapWsListener(onMessageHandler); add('message', onMessageWrapped); }
          }
        });
        return ws;
      }
    });
  })();`;

  const isInjected = () => document.documentElement.dataset.premodInjected === '1';

  const findNonce = () => {
    for (const script of document.getElementsByTagName('script')) {
      const nonce = script.nonce || script.getAttribute('nonce');
      if (nonce) return nonce;
    }
    return '';
  };

  const injectWithNonce = (nonce) => {
    const script = document.createElement('script');
    script.nonce = nonce;
    script.textContent = inpageCode;
    document.documentElement.appendChild(script);
    script.remove();
    return isInjected();
  };

  const waitForNonce = () => {
    const observer = new MutationObserver(() => {
      if (isInjected()) return observer.disconnect();
      const nonce = findNonce();
      if (!nonce) return;
      observer.disconnect();
      injectWithNonce(nonce);
    });
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => observer.disconnect(), { once: true });
  };

  const injectWithBlob = () => {
    const script = document.createElement('script');
    script.src = URL.createObjectURL(new Blob([inpageCode], { type: 'text/javascript' }));
    document.documentElement.appendChild(script);
    script.onload = () => {
      URL.revokeObjectURL(script.src);
      script.remove();
    };
  };

  const injectWithAddElement = async () => {
    try {
      if (typeof GM_addElement === 'function') GM_addElement('script', { textContent: inpageCode });
      else if (typeof GM.addElement === 'function') await GM.addElement('script', { textContent: inpageCode });
    } catch {}
    return isInjected();
  };

  (async () => {
    if (await injectWithAddElement()) return;
    const nonce = findNonce();
    if (nonce && injectWithNonce(nonce)) return;
    injectWithBlob();
    waitForNonce();
  })();
})();
