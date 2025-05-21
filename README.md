# ChatGPT-PreMod
#### Note: Demod has been updated to work again, but seems brittle to front end changes, OpenAI will just do tiny updates that break things. I try to keep things super simple, this will stay working more reliably. 
Hides moderation visual effects. _Prevents_ the deletion of streaming response after it fully comes in (we can no longer automatically restore previously removed messages, and even the ones we prevent from deleted are lost on reload).

To install, have TamperMonkey extension installed and go here: https://github.com/rayzorium/ChatGPT-PreMod/raw/refs/heads/main/ChatGPT%20PreMod.user.js

# How to use
- Use ChatGPT as usual. Whenever ChatGPT finishes writing a response, external moderation will scan it. If it triggers BLOCKED (red/removed), it will attempt to remove. This script prevents that. However, the response will still be lost on page reload. I put in an alert for this.
- If your own request is BLOCKED, the response stream will be interrupted immediately. Try to avoid this. I put in an alert.
- There's still hope even for the above situations: you can ask ChatGPT to just repeat what it said. The model has no idea what was or wasn't removed, they're just messages in the history.

# Why doesn't DeMod work anymore?

DeMod worked basically because OpenAI was still sending BLOCKED messages all the way to end users, basically with instructions for the front end to delete them. All they had to do was make a one-line code change to not send them. It's shocking it took them this long to fix it. 

So, we're left with this workaround of simply preventing the removal of blocked messages. The "ChatGPT anti censorship" extension also does these, but it's Chrome only. DeMod could trivially add it, but currently it doesn't, so fine_ill_do_it_myself.gif

# Mobile?
Mobile users reporting issues - I've only tested on desktop, sorry. Not sure if how it handles messages is different.

# Other options
The only thing we can really do better here is write additional code to save those BLOCKED messages locally, and intelligently populate conversations from that data when loading them. That's quite a bit more work that I'm not going to do anytime soon, but this is just an FYI for any motivated developers (or non-developers willing to learn or do a lot of back-and-forth with ChatGPT, lol)

And another option: do an official data export. It's GDPR mandated to have all your data, BLOCKED or no. So nothing is evertruly lost, it's just not conveniently there for us to look at in their interface. This could really amp up the above "populate from local data" option.

Also, for now, you can still have BLOCKED responses read aloud. Another goofy oversight.
