// ==UserScript==
// @name         ChatGPT PreMod
// @namespace    HORSELOCK.chatgpt
// @version      1.0.6
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

function unBlock(moderationResult) {
    if (!moderationResult || !moderationResult.blocked) return false;
    const wasBlocked = moderationResult.blocked;
    moderationResult.blocked = false;
    return wasBlocked;
}

function isConversationRequest(requestInput) {
    let requestUrl = '';
    if (typeof requestInput === 'string') {
        requestUrl = requestInput;
    } else if (requestInput && typeof requestInput.url === 'string') {
        requestUrl = requestInput.url;
    }
    return /\/backend-api\/conversation(\/[a-f0-9-]{36})?$/.test(requestUrl);
}

const pageGlobal = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

const originalFetch = pageGlobal.fetch;
pageGlobal.fetch = async (...args) => {
    if (!isConversationRequest(args[0])) return originalFetch.call(pageGlobal, ...args);

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
        let jsonDataString = await originalResponse.text();
        let modified = false;
        try {
            let jsonData = JSON.parse(jsonDataString);

            for (const modResult of jsonData.moderation_results) {
                if (unBlock(modResult) && modResult.message_id) {
                    const messageEntry = jsonData.mapping[modResult.message_id];
                    const storedContent = await GM.getValue(`msg_${modResult.message_id}`);
                    if (storedContent) {
                        const messageNode = messageEntry.message;
                        messageNode.content.parts = [storedContent];
                        messageNode.content.content_type = "text";
                        modified = true;
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
