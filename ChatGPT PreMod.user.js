// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      2.0.0
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
    const showBanner = (message, color = "#2c7a7b", duration = 2000) => {
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
                      if (unblockFlagged(payload.moderation_response)) {
                        if (!currentMessageId) {
                          currentMessageId = payload.message_id;
                          const requestBody = JSON.parse(args[1].body);
                          if (requestBody.messages && currentMessageId === requestBody.messages[0].id) {
                            accumulatedContent = requestBody.messages[0].content.parts[0];
                            showBanner("REQUEST RED. Be careful!", "#c53030", 5000);
                          } else {
                            showBanner("Response red, saved it for you =)", "#dd6b20");
                          }
                        }
                        jsonString = JSON.stringify(payload);
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

          if (Array.isArray(responseData.moderation_results)) {
            for (const result of responseData.moderation_results) {
              if (unblockFlagged(result)) {
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
