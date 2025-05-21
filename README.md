# ChatGPT-PreMod (WIP BROKEN RIGGHT NOW DON'T @ ME)
Hides moderation visual effects. _Prevents_ the deletion of streaming response after it fully comes in and saves them locally. Thanks to lugia19 for the idea! He wrote one too but it broke with a random update, so now I'm just doing my own take

To install, have TamperMonkey extension installed and go here: https://github.com/rayzorium/ChatGPT-PreMod/raw/refs/heads/main/ChatGPT%20PreMod.user.js

# How to use
- Use ChatGPT as usual. Whenever ChatGPT finishes writing a response, external moderation will scan it. If it triggers BLOCKED (red/removed), it will attempt to remove. This script prevents that, and will save it locally. Any time you load a conversation on the same device/browser, the messages will be restored.
- If your own request is BLOCKED, the response stream will be interrupted immediately. It will continue generating on the server. When done, if it's also BLOCKED, no script can do anything about it. Try to avoid this, your own requests getting BLOCKED can lead to bans. I put in an alert.
- There's still hope even for the above situation: you can ask ChatGPT to just repeat what it said. The model has no idea what was or wasn't removed and can see them fine, they're just messages in the history.

# Why doesn't DeMod work like it used to?

DeMod worked amazingly because OpenAI was still sending BLOCKED messages all the way to end users, basically with instructions for the front end to delete them. All they had to do was make a one-line code change to not send them. It's shocking it took them until mid 2024 to fix it.

So, we're left with this workaround of simply preventing the removal of blocked messages and saving them locally (cloud storage is an option, I could implement if demand is high). The "ChatGPT anti censorship" extension also does prevents removal, but it's Chrome only and doesn't save/restore the messages. Other scrips are in a similar boat, and they break often just due to random changes made on ChatGPT. I tried hard to keep my script simple and durable to change.

# Mobile?
Some mobile browsers support extensions like Tampermonkey. I hear good things about Kiwi.

# Other options
Like I said, I can enhance this with cloud storage if demand is high enough. Retrieve your conversations, any device, any browser!

And another option: do an official data export. It's GDPR mandated to have all your data, BLOCKED or no. So nothing is ever truly lost, it's just not conveniently there for us to look at in their interface.

Also, for now, you can still have BLOCKED responses read aloud. Another goofy oversight.
