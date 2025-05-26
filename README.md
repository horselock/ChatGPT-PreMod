https://www.reddit.com/user/HORSELOCKSPACEPIRATE/
# ChatGPT-PreMod
Hides moderation visual effects. _Prevents_ the deletion of streaming response after they fully comes in and saves them locally. And injects them back into your chats when loading them! Thanks to lugia19 for the idea of how to inject them! He wrote one too (Unmod) but it broke with a random website update, so now I'm just doing my own take

# Installation
1. Install ViolentMonkey browser extension (No longer officially supported on Chrome due to V2 manifest, can use TamperMonkey instead. However there's still a working workaround as of May 26 - you can install it on mobile Chrome, then go to desktop and it'll be there)
2. Go here and click install: https://github.com/rayzorium/ChatGPT-PreMod/raw/refs/heads/main/ChatGPT%20PreMod.user.js

# How this works (IMPORTANT)
- These have NOTHING to do with whether the model refuses or not. The flagging system only hides messages from YOU - that's it. How the model decides to respond depends entirely on the context.
- Use ChatGPT as usual. Whenever ChatGPT finishes writing a response, external moderation will scan it. If it triggers BLOCKED (red/removed), the ChatGPT platform will attempt to remove the message. This script prevents that, and will save it to your TamperMonkey extension's storage. Any time you load a conversation **on the same device/browser**, where the messages would have been blank, they will be there!
- If your own request is BLOCKED, the response stream will be interrupted immediately - it'll stop like a word in, if that. It will continue generating on the server though. When done, if the response also triggers BLOCKED, it simply won't show. No script can do anything about it. However, you can ask it to repeat the last response - that request is obviously clean and won't be BLOCKED, so PreMod will be free to save the response.
- Try to avoid your own requests getting BLOCKED - it can lead to bans. Too many BLOCKED in a row (some people say they've gotten it from just one) can lead to warning emails, and too many emails can lead to a ban. Exact numbers unknown. The categories that trigger this as `sexual/minors` and `self-harm/instructions`. The first category is VERY overly sensitive and prone to false positives, which is the only reason I'm writing this script. It can trip just from saying "young" or "girl" even, or mentions of family members, etc. - even if you all caps insist that everyone's an adult, it's super dumb and might still go off. Just keep that in mind, and false positives on your requests will be a thing of the past.

# Why doesn't DeMod work like it used to?
DeMod at its peak basically walked right through red, it was like it did nothing. It worked so amazingly because OpenAI was still sending BLOCKED messages all the way to end users, basically with instructions for the front end to delete them. All they had to do was make a one-line code change to not send them, and that's probably all they did. It's shocking it took them until mid 2024 to fix it.

So, we're left with this workaround of simply preventing the removal of blocked messages and saving them locally (cloud storage is an option, I could implement if demand is high), and inserting them back in the chat when loading. There are limits, but this is actually almost back to full power. 

Now whe "ChatGPT anti censorship" extension also does prevents removal, but it's Chrome only and doesn't save/restore the messages. Other scrips are in a similar boat, and they break often just due to random changes made on ChatGPT. I tried hard to keep my script simple and durable to change.

# Mobile?
Some mobile browsers support extensions like TamperMonkey. I hear good things about Kiwi. Maybe Firefox Focus or something? IDK.

# Misc notes
If the main script breaks and you just need a quick fix (your messages NOT removed, but disappear when you leave the page), use the Simple Version.

Like I said, I can enhance this with cloud storage if demand is high enough. Retrieve your conversations, any device, any browser!

Official data export will still show deleted messages. It's GDPR mandated to have all your data, BLOCKED or no. So nothing is ever truly lost, it's just not conveniently there for us to look at in their interface.

As of May 2025, you can still have BLOCKED responses read aloud as long as you're using an extension like this to hide the red warning.
