// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      1.1.1
// @description  Hides moderation visual effects. Prevents deletion of streaming response. Saves responses to GM storage and injects them into loaded conversations based on message ID.
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @downloadURL  https://github.com/rayzorium/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @updateURL    https://github.com/rayzorium/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(function() {
    'use strict';

    function showBanner(message, { color = '#4A5568', duration = 4000 } = {}) {
        document.getElementById('premod-banner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'premod-banner';
        banner.textContent = message;
        banner.style.backgroundColor = color;
        document.body.appendChild(banner);

        setTimeout(() => banner.classList.add('visible'), 10);

        setTimeout(() => {
            banner.classList.remove('visible');
            banner.addEventListener('transitionend', () => banner.remove());
        }, duration);
    }

    function whenReady(callback) {
        if (document.readyState !== 'loading') callback();
        else document.addEventListener('DOMContentLoaded', callback);
    }

    whenReady(() => {
        const style = document.createElement('style');
        style.textContent = `#premod-banner{position:fixed;top:15px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:6px;color:#fff;box-shadow:0 3px 10px #0005;z-index:9999;opacity:0;transition:opacity .4s ease,top .4s ease;pointer-events:none}#premod-banner.visible{top:25px;opacity:1}`;
        document.head.appendChild(style);
        showBanner('PreMod Active', { color: '#2c7a7b', duration: 3000 });
    });

    function unBlock(moderationResult) {
        if (!moderationResult || !moderationResult.blocked) return false;
        const wasBlocked = moderationResult.blocked;
        moderationResult.blocked = false;
        return wasBlocked;
    }

    const pageGlobal = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    const originalFetch = pageGlobal.fetch;

    pageGlobal.fetch = async function(...args) {
        const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url;
        if (!url || !/\/backend-api\/(f\/)?conversation(\/[a-f0-9-]{36})?$/.test(url)) {
            return originalFetch.call(pageGlobal, ...args);
        }

        const originalResponse = await originalFetch.call(pageGlobal, ...args);
        const contentType = originalResponse.headers.get('content-type') || '';

        if (contentType.includes('text/event-stream')) {
            let currentMessageId = null;
            let accumulatedContent = "";

            const stream = new ReadableStream({
                async start(controller) {
                    const reader = originalResponse.body.getReader();
                    const dec = new TextDecoder();
                    const enc = new TextEncoder();

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            if (currentMessageId && accumulatedContent) {
                                try {
                                    await GM.setValue(`msg_${currentMessageId}`, accumulatedContent);
                                } catch (e) {
                                    console.error("ChatGPT PreMod: Error saving to GM storage", e);
                                }
                            }
                            controller.close();
                            break;
                        }

                        const rawChunk = dec.decode(value, { stream: true });
                        const lines = rawChunk.split('\n');
                        const processedChunkLines = [];
                        for (const line of lines) {
                            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                let jsonDataString = line.substring(5).trim();
                                try {
                                    let dataObj = JSON.parse(jsonDataString);
                                    if (unBlock(dataObj.moderation_response)) {
                                        if (!currentMessageId) { // Keep the first we encounter
                                            currentMessageId = dataObj.message_id;
                                            const requestBody = JSON.parse(args[1].body);
                                            if (requestBody.messages && currentMessageId === requestBody.messages[0].id) {
                                                accumulatedContent = requestBody.messages[0].content.parts[0];
                                                showBanner('REQUEST RED. Be careful!', { color: '#c53030', duration: 5000 });
                                            } else {
                                                showBanner('Response red, saved it for you =)', { color: '#dd6b20' });
                                            }
                                            jsonDataString = JSON.stringify(dataObj);
                                        }
                                    }

                                    if (dataObj.v && !currentMessageId) {
                                        if (typeof dataObj.v === 'string') {
                                            accumulatedContent += dataObj.v;
                                        } else if (Array.isArray(dataObj.v)) {
                                            for (const op of dataObj.v) {
                                                if (op.o === "append" && typeof op.v === 'string') accumulatedContent += op.v;
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.error('line: ' + line, e);
                                } finally {
                                    processedChunkLines.push('data: ' + jsonDataString);
                                }
                            } else { processedChunkLines.push(line); }
                        }
                        controller.enqueue(enc.encode(processedChunkLines.join('\n')));
                    }
                }
            });
            return new Response(stream, { headers: originalResponse.headers, status: originalResponse.status, statusText: originalResponse.statusText });

        } else if (contentType.includes('application/json')) {
            let jsonDataString = await originalResponse.text();
            let modified = false;
            try {
                let jsonData = JSON.parse(jsonDataString);

                for (const modResult of jsonData.moderation_results) {
                    if (unBlock(modResult)) {
                        modified = true;
                        if (modResult.message_id) {
                            const messageEntry = jsonData.mapping[modResult.message_id];
                            const storedContent = await GM.getValue(`msg_${modResult.message_id}`);
                            if (storedContent) {
                                const messageNode = messageEntry.message;
                                messageNode.content.parts = [storedContent];
                                messageNode.content.content_type = "text";
                            }
                        }
                    }
                }

                if (modified) jsonDataString = JSON.stringify(jsonData);
            } catch (e) {
                console.error("ChatGPT PreMod: Error processing JSON", e);
            } finally {
                return new Response(jsonDataString, { headers: originalResponse.headers, status: originalResponse.status, statusText: originalResponse.statusText});
            }
        }

        return originalResponse;
    };
})();
