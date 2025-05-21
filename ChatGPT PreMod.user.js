// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      1.0.1
// @description  Hides moderation visual effects. Prevents deletion of streaming response. Saves responses to GM storage and injects them into loaded conversations based on message ID.
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @downloadURL  https://github.com/rayzorium/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @updateURL    https://github.com/rayzorium/ChatGPT-PreMod/raw/main/ChatGPT%20PreMod.user.js
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

'use strict';

function clearFlagsInObject(obj) {
    let wasBlockedOriginal = false;
    let anyChangeMade = false;
    if (!obj || typeof obj !== 'object') return { wasBlockedOriginal, anyChangeMade };

    const target = obj.moderation_response ? obj.moderation_response : obj;

    if (target.blocked === true) {
        wasBlockedOriginal = true;
        target.blocked = false;
        anyChangeMade = true;
    }
    if (target.flagged === true) {
        target.flagged = false;
        anyChangeMade = true;
    }
    return { wasBlockedOriginal, anyChangeMade };
}

const pageGlobal = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

const originalFetch = pageGlobal.fetch;
pageGlobal.fetch = async (...args) => {
    const requestInput = args[0];
    let requestUrl = '';
    if (typeof requestInput === 'string') {
        requestUrl = requestInput;
    } else if (requestInput instanceof Request) {
        requestUrl = requestInput.url;
    } else if (requestInput && typeof requestInput.url === 'string') {
        requestUrl = requestInput.url;
    }

    if (!requestUrl.includes('backend-api/conversation') || requestUrl.endsWith('/abort')) {
        return originalFetch.call(pageGlobal, ...args);
    }

    const originalResponse = await originalFetch.call(pageGlobal, ...args);
    const contentType = originalResponse.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
        if (!originalResponse.body) return originalResponse;

        let currentMessageId = null;
        let accumulatedContent = "";
        let chunkHadBlockedEvent = false;

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
                    chunkHadBlockedEvent = false;

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonDataString = line.substring(5).trim();
                            try {
                                let dataObj = JSON.parse(jsonDataString);
                                const processResult = clearFlagsInObject(dataObj);
                                if (processResult.wasBlockedOriginal) {
                                    chunkHadBlockedEvent = true;
                                }

                                if (dataObj.v && typeof dataObj.v === 'string' && Object.keys(dataObj).length === 1) {
                                    accumulatedContent += dataObj.v;
                                } else if (dataObj.p === "" && dataObj.o === "patch" && Array.isArray(dataObj.v)) {
                                    for (const op of dataObj.v) {
                                        if (op.p?.startsWith("/message/content/parts/") && op.o === "append" && typeof op.v === 'string') {
                                            accumulatedContent += op.v;
                                        }
                                    }
                                }
                                if (dataObj.message_id && typeof dataObj.message_id === 'string') {
                                    currentMessageId = dataObj.message_id;
                                }
                                processedChunkLines.push('data: ' + JSON.stringify(dataObj));
                            } catch (e) { processedChunkLines.push(line); }
                        } else { processedChunkLines.push(line); }
                    }

                    const rawChunkIdMatch = rawChunk.match(/"message_id"\s*:\s*"([a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12})"/);
                    if (rawChunkIdMatch && rawChunkIdMatch[1]) { currentMessageId = rawChunkIdMatch[1]; }

                    if (chunkHadBlockedEvent) {
                        window.alert("Latest message BLOCKED, but Premod prevented removal and saved.\n\nIf Your REQUEST (not the response) triggered this response will not stream and may never show. However, you can ask ChatGPT to repeat its response which will stream.\n\nNote too any REQUEST triggers may lead to a ban. False positives are very common, but moderation THINKS it saw sexual/minors or self-harm/instructions.");
                    }
                    controller.enqueue(enc.encode(processedChunkLines.join('\n')));
                }
            }
        });
        return new Response(stream, { headers: originalResponse.headers, status: originalResponse.status, statusText: originalResponse.statusText });

    } else if (contentType.includes('application/json')) {
        if (!originalResponse.body) return originalResponse;

        const originalText = await originalResponse.text();
        try {
            let jsonData = JSON.parse(originalText);
            let modified = false;
            const idsToRestore = new Set();

            if (jsonData.moderation_results && Array.isArray(jsonData.moderation_results)) {
                jsonData.moderation_results.forEach(modResult => {
                    const processResult = clearFlagsInObject(modResult);
                    if (processResult.wasBlockedOriginal && modResult.message_id) {
                        idsToRestore.add(modResult.message_id);
                    }
                    modified = modified || processResult.anyChangeMade;
                });
            }

            if (jsonData.mapping && typeof jsonData.mapping === 'object') {
                for (const idToRestore of idsToRestore) {
                    const messageEntry = jsonData.mapping[idToRestore];
                    if (messageEntry?.message) {
                        const storedContent = await GM.getValue(`msg_${idToRestore}`);
                        if (storedContent) {
                            const messageNode = messageEntry.message;
                            if (!messageNode.content) {
                                messageNode.content = { parts: [storedContent], content_type: "text" };
                            } else {
                                messageNode.content.parts = [storedContent];
                                messageNode.content.content_type = "text";
                            }
                            modified = true;
                        }
                    }
                }
            }

            return new Response(modified ? JSON.stringify(jsonData) : originalText, { headers: originalResponse.headers, status: originalResponse.status, statusText: originalResponse.statusText});
        } catch (e) {
            console.error("ChatGPT PreMod: Error processing JSON", e);
            return new Response(originalText, { headers: originalResponse.headers, status: originalResponse.status, statusText: originalResponse.statusText });
        }
    }

    return originalResponse;
};
