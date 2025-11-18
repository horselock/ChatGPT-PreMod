// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      2.1.1
// @description  Hides moderation visual effects. Prevents deletion of streaming response. Saves responses to GM storage and injects them into loaded conversations based on message ID.
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

    const originalFetch = fetch;
    fetch = async function(...args) {
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (!requestUrl || !apiUrlPattern.test(requestUrl)) {
        return originalFetch.apply(this, args);
      }

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
                      if (payload.p && payload.p.includes('is_visually_hidden_from_conversation')) {
                        console.debug('[PreMod] Filtered out visibility hide delta:', payload);
                        showBanner('"Help is available" removal prevented', "#48bb78", 3000);
                        return '';
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
              // Filter out "Help is available" disclaimers
              if (Array.isArray(result.disclaimers)) {
                const originalLength = result.disclaimers.length;
                result.disclaimers = result.disclaimers.filter(d => !d.includes('Help is available'));
                if (result.disclaimers.length < originalLength) {
                  console.debug('[PreMod] Convo history: Removed Help is available disclaimer');
                  modified = true;
                }
              }

              if (unblockFlagged(result)) {
                console.debug('[PreMod] Convo history: Restoring blocked message:', result.message_id);
                modified = true;
                if (result.message_id) {
                  const messageNode = responseData.mapping?.[result.message_id]?.message;
                  if (messageNode?.content) {
                    const storedContent = await bridge('get', 'msg_' + result.message_id);
                    if (storedContent) {
                      messageNode.content.parts = [storedContent];
                      messageNode.content.content_type = 'text';
                    }
                  }
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
  })();`;

  const script = document.createElement('script');
  script.src = URL.createObjectURL(new Blob([inpageCode], { type: 'text/javascript' }));
  document.documentElement.appendChild(script);
  script.onload = () => {
    URL.revokeObjectURL(script.src);
    script.remove();
  };
})();
