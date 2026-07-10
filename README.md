https://www.horselock.us (see Old Reddit Posts, Jailbroken Erotica GPT for further information on red moderation)

https://spicywriter.com - if you want to just write what you want, NSFW or otherwise, without worrying about nannying ;)

Nov 4 update: Now prevents obnoxious "Help is available" moderation from removing the response. Toggle banner by setting SHOW_BANNERS at the top of the script =)

# PreMod
Unofficial (obviously) userscript that hides moderation visual effects. _Prevents_ the deletion of streaming responses after they fully come in and saves them locally. With DeMod and similar, you lose them when you leave the page. But when you come back and load a convo, PreMod intercepts the convo load and puts those saved message back in where there would be removed blanks, tricking the UI into thinking nothing redded. Thanks to lugia19 for the idea of how to inject messages back in!

**A note on terminology:** I call these moderation events **reds** (after the red warning the site throws up), used as both noun and verb - a message "reds", you get "a red". I deliberately avoid "blocked" and "flagged": both are hopelessly overloaded in AI land, and "blocked" is flat-out wrong for what happens - nothing stops the model from answering. It generates the full response; the site just hides it from you afterward. So throughout this README, a message that "reds" is simply one that moderation decided to hide.

The current red moderation message is:

> This content can’t be shown for safety reasons
> Learn more about our intended model behavior in our Model Spec.

**Note:** ChatGPT has started streaming some responses over a WebSocket ("stream handoff") rather than the old fetch stream - in my experience so far, around requests that red. The old fetch hook couldn't see that, so detection/saving of reds (both model responses and your own requests) had broken for those cases. 2.2.0 re-plumbs PreMod to hook the WebSocket too and restores it. In theory a double red (both your message AND the response red) is now salvageable too, since the response tokens still stream in full before the red verdict lands - though triggering one to prove it isn't worth the account risk.

# Installation
0. Ensure you do not have similar scripts/extensions installed (like CGPT "anti censorship" Chrome extension)
1. Ensure your browser's developer mode is enabled (google it for your browser)
2. Install ViolentMonkey browser extension. Mobile users can use Firefox, Edge, or some other browser that supports extensions. Chrome users may have to use TamperMonkey - not ideal as it's proprietary. iOS users should download Userscripts from the App Store and enable it in Safari (there may be a better way but this is the only one I know).
4. Go here and click install: https://github.com/horselock/ChatGPT-PreMod/raw/refs/heads/main/ChatGPT%20PreMod.user.js

As of version 1.1.0, there will be visual feedback to show it's running:

<img width="405" alt="image" src="https://github.com/user-attachments/assets/1ae944c2-c2e3-48ad-b6cd-6c86c7b0b5c8" />

Tampermonkey/Violentmonkey icon will also typically have a number next to it to indicating how many scripts are active

# How this works (IMPORTANT)
- These have NOTHING to do with whether the model refuses or not. The red system only hides messages from YOU - that's it. How the model decides to respond depends entirely on the context. It doesnt even know anything was hidden.
- Use CGPT as usual. Whenever a response finishes streaming, external moderation will scan it. If it reds, the website/app will attempt to remove the message. This script prevents that, and will save it to your ViolentMonkey extension's storage. Any time you load a conversation **on the same device/browser**, where the messages would have been blank, they will be there!
- If your own request reds, the response stream will be interrupted immediately - it'll stop like a word in, if that. It will continue generating on the server though. When done, if the response doesn't red, it shows as expected. If it does red, the message simply will never show. **(Update: as of 2.2.0 this "double red" may no longer be a lost cause - the response now, in my experience, streams over a WebSocket that PreMod intercepts, and the tokens come down in full before the red verdict lands, so PreMod can save/restore them in at least some cases. See the transport note above.)** Historically no script could do anything about it. However, you can ask it to repeat the last response - an innocent request like "repeat that last reponse please" won't red. This includes going back to stuff that redded before you installed PreMod, so PreMod will be free to save the response.
- Try to avoid your own requests redding - it can lead to bans. Too many reds in a row (some people say they've gotten it from just one) can lead to warning emails, and too many emails can lead to a ban. Exact numbers unknown (actually I've seen a recent report of a ban without warning email, though it did involve multiple request reds as expected). The categories that trigger this as `sexual/minors` and `self-harm/instructions`. The first category is VERY overly sensitive and prone to false positives, which is the only reason I'm writing this script. It can trip just from saying "young" or "girl" even, or mentions of family members, talking about personal trauma, etc. - even if you all caps insist that everyone's an adult, it's super dumb and might still go off. Just keep that in mind, and false positives on your requests will be a thing of the past.

# Why doesn't DeMod work like it used to?
DeMod at its peak basically walked right through red, it was like it did nothing. It worked so amazingly because the back end was still sending redded messages all the way to end users, basically with instructions for the front end to delete them. All they had to do was make a one-line code change to not send them, and that's probably all they did. It's shocking it took them until mid 2024 to fix it.

So, we're left with this workaround of simply preventing the removal of redded messages and saving them locally (cloud storage is an option, I could implement if demand is high), and inserting them back in the chat when loading. There are limits, but this is actually almost back to full power. 

Now the CGPT "anti censorship" extension also does prevents removal, but it's Chrome only and doesn't save/restore the messages. Other scrips are in a similar boat, and they break often just due to random changes they make to the site/app. I tried hard to keep my script simple and durable to change.

# Mobile?
Some mobile browsers like Firefox support extensions; you can install ViolentMonkey.

# Misc notes
If the main script breaks and you just need a quick fix (your messages NOT removed, but disappear when you leave the page), use the Simple Version.

Like I said, I can enhance this with cloud storage if demand is high enough. Retrieve your conversations, any device, any browser!

Official data export will still show deleted messages. It's GDPR mandated to have all your data, red or no. So nothing is ever truly lost, it's just not conveniently there for us to look at in their interface.

As of May 2025, you can still have redded responses read aloud as long as you're using an extension like this to hide the red warning.

# Changelog
- 2.2.0 - Re-plumbed for ChatGPT's new WebSocket "stream handoff" transport (seen so far around requests that red). Moderation detection and saving (redded responses and redded requests alike) had broken when that streaming moved off the fetch stream onto a WebSocket; PreMod now hooks the WebSocket too. Double reds are now theoretically salvageable. Also: on convo load, don't clear the red on a message we have no saved copy of (it was breaking scrolling).
- 2.1.2 - Updated disclaimer filtering for the new moderation stream format (handles visibility-hide ops within delta arrays; now strips all safety disclaimers from convo history, not just "Help is available").
- 2.1.1 - Fixed red message detection broken in 2.1.0. Popup now shows and messages are saved properly again.
- 2.1.0 - Added filtering for "Help is available" moderation removal. Added SHOW_BANNERS toggle. Added additional console debugging.
- 2.0.0 - iOS Safari support. People who previewed the 2.0.0-SNAPSHOT version, be warned that it used localStorage, which was a temporary workaround - messages saved won't be avaiable after upgrading. You can always look at your own localStrorage and save it.
