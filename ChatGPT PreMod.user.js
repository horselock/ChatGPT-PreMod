// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      2.2.0
// @description  Hides moderation visual effects. Prevents deletion of streaming response (fetch + WebSocket stream-handoff). Saves responses to GM storage and injects them into loaded conversations based on message ID.
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @downloadURL  https://github.com/horselock/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @updateURL    https://github.com/horselock/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
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

  const inpageCode = `(() => { "use strict";
    const SHOW_BANNERS = true; // Set to false to disable banners

    const showBanner = (message, color = "#2c7a7b", duration = 2000) => {
      if (!SHOW_BANNERS) return;
      if (!document.body) return setTimeout(() => showBanner(message, color, duration), 100);

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

    showBanner("PreMod Active");

    const pendingBridgeRequests = new Map();

    const messageListener = (event) => {
      const data = event.data;
      if (data?.type === 'premod-response' && pendingBridgeRequests.has(data.id)) {
        const resolve = pendingBridgeRequests.get(data.id);
        pendingBridgeRequests.delete(data.id);
        resolve(data.result);
      }
    };

    window.addEventListener('message', messageListener);

    const bridge = (operation, key, value) => new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      pendingBridgeRequests.set(id, resolve);
      window.postMessage({ type: 'premod-bridge', id, op: operation, key, value }, '*');
    });

    const apiUrlPattern = /\\/backend-api\\/(?:f\\/)?conversation(?:\\/[a-f0-9-]{36})?(?:\\?.*)?$/i;
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

    const originalFetch = fetch;
    fetch = async function(...args) {
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (!requestUrl || !apiUrlPattern.test(requestUrl)) {
        return originalFetch.apply(this, args);
      }
      rememberInput(args);

      const apiResponse = await originalFetch.apply(this, args);
      const contentType = (apiResponse.headers.get('content-type') || '').toLowerCase();

      if (contentType.includes('text/event-stream')) {
        let currentMessageId = null;
        let accumulatedContent = '';

        const modifiedStream = new ReadableStream({
          async start(controller) {
            const reader = apiResponse.body.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  if (currentMessageId && accumulatedContent) {
                    await bridge('set', 'msg_' + currentMessageId, accumulatedContent);
                  }
                  controller.close();
                  break;
                }

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\\n').map(line => {
                  if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    let jsonString = line.slice(6).trim();
                    try {
                      const payload = JSON.parse(jsonString);

                      // Check for blocked messages FIRST before filtering anything
                      if (unblockFlagged(payload.moderation_response)) {
                        console.debug('[PreMod] Stream: Detected blocked=true, unblocking:', payload.message_id);
                        if (!currentMessageId) {
                          currentMessageId = payload.message_id;
                          const requestBody = JSON.parse(args[1].body);
                          if (requestBody.messages && currentMessageId === requestBody.messages[0].id) {
                            accumulatedContent = requestBody.messages[0].content.parts[0];
                            console.debug('[PreMod] Stream: Input message blocked');
                            showBanner("REQUEST RED. Be careful!", "#c53030", 5000);
                          } else {
                            console.debug('[PreMod] Stream: Response blocked');
                            showBanner("Response red, saved it for you =)", "#dd6b20");
                          }
                        }
                        jsonString = JSON.stringify(payload);
                      }

                      // Filter out type: "moderation" chunks (AFTER checking for blocked)
                      if (payload.type === 'moderation') {
                        console.debug('[PreMod] Filtered out moderation chunk:', payload);
                        return '';
                      }

                      // Filter out is_visually_hidden_from_conversation delta (AFTER checking for blocked)
                      if (Array.isArray(payload.v)) {
                        const filtered = payload.v.filter(op => !op?.p?.includes('is_visually_hidden_from_conversation'));
                        if (filtered.length < payload.v.length) {
                          console.debug('[PreMod] Filtered out visibility hide op from delta:', payload);
                          showBanner('Safety disclaimer bypassed', "#48bb78", 3000);
                          if (filtered.length === 0) return '';
                          payload.v = filtered;
                          jsonString = JSON.stringify(payload);
                        }
                      }

                      const content = payload.v;
                      if (content && !currentMessageId) {
                        if (typeof content === 'string') {
                          accumulatedContent += content;
                        } else if (Array.isArray(content)) {
                          for (const chunk of content) {
                            if (chunk?.o === 'append' && typeof chunk.v === 'string') {
                              accumulatedContent += chunk.v;
                            }
                          }
                        }
                      }
                    } catch {}
                    return 'data: ' + jsonString;
                  }
                  return line;
                });

                controller.enqueue(encoder.encode(lines.join('\\n')));
              }
            } catch (error) {
              controller.error(error);
            }
          }
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

          // Unset is_visually_hidden_from_conversation in mapping
          if (responseData.mapping) {
            for (const uuid in responseData.mapping) {
              const msg = responseData.mapping[uuid];
              if (msg?.message?.metadata?.is_visually_hidden_from_conversation &&
                  msg?.message?.author?.role === 'assistant') {
                console.debug('[PreMod] Convo history: Unhiding message:', uuid);
                msg.message.metadata.is_visually_hidden_from_conversation = false;
                modified = true;
              }
            }
          }

          if (Array.isArray(responseData.moderation_results)) {
            for (const result of responseData.moderation_results) {
              // Filter out safety disclaimers
              if (Array.isArray(result.disclaimers) && result.disclaimers.length > 0) {
                console.debug('[PreMod] Convo history: Removed disclaimer(s)');
                result.disclaimers = [];
                modified = true;
              }

              // Only unblock if we actually have the saved content to put back. Otherwise
              // leave it blocked - an unblocked-but-empty message breaks the UI (can't scroll).
              if (result.blocked && result.message_id) {
                const messageNode = responseData.mapping?.[result.message_id]?.message;
                const storedContent = messageNode?.content ? await bridge('get', 'msg_' + result.message_id) : null;
                if (storedContent) {
                  console.debug('[PreMod] Convo history: Restoring blocked message:', result.message_id);
                  messageNode.content.parts = [storedContent];
                  messageNode.content.content_type = 'text';
                  result.blocked = false;
                  modified = true;
                } else {
                  console.debug('[PreMod] Convo history: No saved content, leaving blocked:', result.message_id);
                }
              }
            }
          }

          if (modified) responseText = JSON.stringify(responseData);
        } catch {}

        return new Response(responseText, {
          headers: apiResponse.headers,
          status: apiResponse.status,
          statusText: apiResponse.statusText
        });
      }

      return apiResponse;
    };

    // ===== WebSocket hook =====
    // Live turns now stream over ws.chatgpt.com via a "stream_handoff": the response
    // and its moderation verdict arrive as WS frames whose "encoded_item" is the exact
    // old SSE text. The fetch hook above never sees them, so we intercept here too.
    const TURN_TOPIC_PREFIX = 'conversation-turn-';
    const wsTurnState = new Map(); // topic_id -> per-turn accumulation

    const getWsState = (topicId) => {
      let state = wsTurnState.get(topicId);
      if (!state) {
        if (wsTurnState.size > 100) wsTurnState.clear(); // crude leak guard over a long session
        state = { accumulatedContent: '', sawFinal: false };
        wsTurnState.set(topicId, state);
      }
      return state;
    };

    // Process one unwrapped SSE "encoded_item". Mutates state (saves content), and returns
    // rewritten text if it stripped anything, otherwise null (leave the frame untouched).
    const processEncodedItem = (text, state) => {
      const lines = text.split('\\n');
      let touched = false;
      const kept = [];
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') { kept.push(line); continue; }
        let payload;
        try { payload = JSON.parse(line.slice(6)); } catch { kept.push(line); continue; }

        // Once the visible ("final") assistant message is added, start accumulating its text
        if (payload.v && payload.v.message && payload.v.message.channel === 'final') {
          state.sawFinal = true;
          try {
            const parts = payload.v.message.content.parts;
            if (Array.isArray(parts) && typeof parts[0] === 'string') state.accumulatedContent = parts[0];
          } catch {}
        }

        // Block verdict: save the real content (input echo, or accumulated response) then drop the cue.
        // Handled per message_id so a double-red saves both the request and the response.
        if (payload.moderation_response && payload.moderation_response.blocked) {
          const blockedId = payload.message_id;
          const inputContent = blockedId ? pendingInputs.get(blockedId) : undefined;
          const isInput = inputContent !== undefined;
          const content = isInput ? inputContent : state.accumulatedContent;
          if (blockedId && content) {
            bridge('set', 'msg_' + blockedId, content);
            console.debug('[PreMod] WS: Saved blocked ' + (isInput ? 'input' : 'response') + ':', blockedId);
          }
          showBanner(isInput ? 'REQUEST RED. Be careful!' : 'Response red, saved it for you =)', isInput ? '#c53030' : '#dd6b20', isInput ? 5000 : 2000);
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

        // Accumulate streamed response text (bare-string appends after the final message appears)
        if (state.sawFinal && typeof payload.v === 'string') state.accumulatedContent += payload.v;

        kept.push(line);
      }
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

  const script = document.createElement('script');
  script.src = URL.createObjectURL(new Blob([inpageCode], { type: 'text/javascript' }));
  document.documentElement.appendChild(script);
  script.onload = () => {
    URL.revokeObjectURL(script.src);
    script.remove();
  };
})();
