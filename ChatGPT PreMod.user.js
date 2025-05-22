// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      1.0.4
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

function isConversationRequest(requestInput) {
    let requestUrl = '';
    if (typeof requestInput === 'string') {
        requestUrl = requestInput;
    } else if (requestInput instanceof Request) {
        requestUrl = requestInput.url;
    } else if (requestInput && typeof requestInput.url === 'string') {
        requestUrl = requestInput.url;
    }
    return /\/backend-api\/conversation\b/.test(requestUrl);
}

const pageGlobal = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

const originalFetch = pageGlobal.fetch;
pageGlobal.fetch = async (...args) => {
    if (!isConversationRequest(args[0])) return originalFetch.call(pageGlobal, ...args);

    const originalResponse = await originalFetch.call(pageGlobal, ...args);
    const contentType = originalResponse.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
        if (!originalResponse.body) return originalResponse;

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
                                const processResult = clearFlagsInObject(dataObj);
                                if (processResult.wasBlockedOriginal) {
                                    if (!currentMessageId) {
                                        currentMessageId = dataObj.message_id;
                                        const requestMessage = JSON.parse(args[1].body).messages[0];
                                        if (currentMessageId === requestMessage.id) {
                                            accumulatedContent = requestMessage.content.parts[0];
                                            window.alert("Your request was BLOCKED (was still sent, just would be hidden from you if not for this script). It can lead to warning emails and bans, so careful. See README.md for details. Response will not be streamed, and if it also triggers BLOCKED, this script can't save it - you can ask ChatGPT to repeat its response though.");
                                        } else {
                                            window.alert("The response was BLOCKED, but Premod prevented removal and saved it userscript storage. It will be restored as long as you're on same browser with PreMod enabled. See README.md for details.");
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
