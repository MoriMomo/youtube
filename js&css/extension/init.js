/*-------------------------------------------------------------- // Section banner for this file
>>> INITIALIZATION                                            // Everything below wires up the content script on YouTube pages
--------------------------------------------------------------*/
extension.features.youtubeHomePage('init'); // Prime homepage-specific logic in a special "init" pass

document.documentElement.setAttribute('it-pathname', location.pathname); // Expose current path to CSS/other scripts

window.addEventListener('yt-navigate-finish', function () { // YouTube SPA navigation finished
	document.documentElement.setAttribute('it-pathname', location.pathname); // Keep path attribute in sync

	extension.features.trackWatchedVideos(); // Re-apply watched tracking per navigation
	extension.features.thumbnailsQuality();  // Re-apply thumbnail quality tweaks per navigation
});

extension.messages.create();   // Prepare message channel (content ↔ background/popup)
extension.messages.listener(); // Attach message listeners for incoming messages

extension.events.on('init', function (resolve) { // Async init gate: wait until storage is loaded
	extension.storage.listener();               // Watch for settings changes
	extension.storage.load(function () {        // Load persisted settings to memory
		resolve();                               // Continue with initialization
	});
}, {
	async: true                                 // Mark this init handler as asynchronous
});

function bodyReady() { // Run UI-affecting features only when both flags are true
	if (extension.ready && extension.domReady) { // ready: scripts injected; domReady: DOMContentLoaded
		extension.features.addScrollToTop();                  // Add "scroll to top" utility
		extension.features.font();                            // Apply custom font if configured
		extension.features.changeThumbnailsPerRow?.();        // Optional: adjust grid density
		extension.features.clickableLinksInVideoDescriptions(); // Make plain URLs clickable
	}
}

extension.events.on('init', function () { // Main init after storage is available
	extension.features.bluelight();                    // Blue light filter
	extension.features.dim();                          // Dim background/ambient mode
	extension.features.youtubeHomePage();              // Homepage layout tweaks
	extension.features.collapseOfSubscriptionSections(); // Collapse sections in Subscriptions
	extension.features.confirmationBeforeClosing();    // Confirm before closing if enabled
	extension.features.defaultContentCountry();        // Force default content country
	extension.features.popupWindowButtons();           // Add popup window buttons to player
	extension.features.disableThumbnailPlayback();     // Disable hover playback of thumbnails
	extension.features.markWatchedVideos();            // Mark watched videos in lists
	extension.features.relatedVideos();                // Tweak related videos section
	extension.features.comments();                     // Comments-related features
	extension.features.openNewTab();                   // Control link target behavior
	extension.features.removeListParamOnNewTab();      // Clean URL list params on new tab
	bodyReady();                                       // If DOM is ready too, run UI features
});

chrome.runtime.sendMessage({              // Handshake with background to register this tab
	action: 'tab-connected'
}, function (response) {
	if (response) {
		extension.tabId = response.tabId; // Store tabId if provided by background
	}
});

extension.inject([ // Inject page-side scripts into YouTube page context
	'/js&css/web-accessible/core.js',
	'/js&css/web-accessible/functions.js',
	'/js&css/web-accessible/www.youtube.com/appearance.js',
	'/js&css/web-accessible/www.youtube.com/themes.js',
	'/js&css/web-accessible/www.youtube.com/player.js',
	'/js&css/web-accessible/www.youtube.com/playlist.js',
	'/js&css/web-accessible/www.youtube.com/channel.js',
	'/js&css/web-accessible/www.youtube.com/shortcuts.js',
	'/js&css/web-accessible/www.youtube.com/blocklist.js',
	'/js&css/web-accessible/www.youtube.com/settings.js',
	'/js&css/web-accessible/init.js'
], function () {        // Callback after all scripts are injected
	extension.ready = true;             // Signal that injection is complete

	extension.events.trigger('init');   // Trigger init handlers now that we're ready
});

document.addEventListener('DOMContentLoaded', function () { // DOM is fully parsed
	extension.domReady = true;  // Set DOM readiness flag

	bodyReady();               // If scripts are ready too, run UI features
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) { // Handle background → content commands
	if (request.action === 'focus') {                 // Bring player into focus
		extension.messages.send({ focus: true });
	} else if (request.action === 'blur') {           // Blur player
		extension.messages.send({ blur: true });
	} else if (request.action === 'pause') {          // Pause playback
		extension.messages.send({ pause: true });
	} else if (request.action === 'set-volume') {     // Set player volume
		extension.messages.send({ setVolume: request.value });
	} else if (request.action === 'set-playback-speed') { // Set playback rate
		extension.messages.send({ setPlaybackSpeed: request.value });
	} else if (request.action === 'mixer') {          // Open/handle audio mixer
		extension.messages.send({ mixer: true }, sendResponse, 'mixer');

		return true;                                   // Keep message channel open for async reply
	} else if (request.action === 'delete-youtube-cookies') { // Clear YT cookies
		extension.messages.send({ deleteCookies: true });
	} else if (request.action === "another-video-started-playing") { // Enforce single playing instance
		extension.features.onlyOnePlayerInstancePlaying();
	}
});

document.addEventListener('it-message-from-youtube', function () { // Bridge: messages from page context arrive via hidden node
	var provider = document.querySelector('#it-messages-from-youtube'); // Node carrying serialized JSON

	if (provider) {
		var message = provider.textContent; // Read raw JSON string

		document.dispatchEvent(new CustomEvent('it-message-from-youtube--readed')); // Ack so page can clear it

		try {
			message = JSON.parse(message); // Parse payload
		} catch (error) {
			console.log(error);            // Log parse issues (non-fatal)
		}

		//console.log(message);           // Useful for debugging payloads

		if (message.requestOptionsUrl === true) {       // Page requests options URL
			extension.messages.send({ responseOptionsUrl: chrome.runtime.getURL('menu/index.html') });
		} else if (message.onlyOnePlayer === true) {    // Enforce only one player playing globally
			chrome.runtime.sendMessage({ name: 'only-one-player' });
		} else if (message.action === 'fixPopup') {     // Resize/fix popup window
			chrome.runtime.sendMessage({
				action: 'fixPopup',
				width: message.width,
				height: message.height,
				title: message.title,
			});
		} else if (message.action === 'analyzer') {     // Record usage analytics if enabled
			if (extension.storage.data.analyzer_activation === true) {
				var data = message.name,
					date = new Date().toDateString(),
					hours = new Date().getHours() + ':00';

				if (!extension.storage.data.analyzer) { extension.storage.data.analyzer = {}; } // Ensure root
				if (!extension.storage.data.analyzer[date]) { extension.storage.data.analyzer[date] = {}; } // By date
				if (!extension.storage.data.analyzer[date][hours]) { extension.storage.data.analyzer[date][hours] = {}; } // By hour
				if (!extension.storage.data.analyzer[date][hours][data]) { extension.storage.data.analyzer[date][hours][data] = 0; } // Init counter

				extension.storage.data.analyzer[date][hours][data]++; // Increment

				chrome.storage.local.set({ analyzer: extension.storage.data.analyzer }); // Persist
			}
		} else if (message.action === 'blocklist') {    // Update blocklist for channel/video
			if (!extension.storage.data.blocklist || typeof extension.storage.data.blocklist !== 'object') {
				extension.storage.data.blocklist = { videos: {}, channels: {} }; // Ensure structure
			}

			switch (message.type) {
				case 'channel':
					if (!extension.storage.data.blocklist.channels || typeof extension.storage.data.blocklist.channels !== 'object') {
						extension.storage.data.blocklist.channels = {}; // Ensure sub-structure
					}
					if (message.added) { // Add channel to blocklist
						extension.storage.data.blocklist.channels[message.id] = {
							title: message.title,
							preview: message.preview,
							when: message.when
						}
					} else {             // Remove channel from blocklist
						delete extension.storage.data.blocklist.channels[message.id];
					}
					break

				case 'video':
					if (!extension.storage.data.blocklist.videos || typeof extension.storage.data.blocklist.videos !== 'object') {
						extension.storage.data.blocklist.videos = {}; // Ensure sub-structure
					}
					if (message.added) { // Add video to blocklist
						extension.storage.data.blocklist.videos[message.id] = {
							title: message.title,
							when: message.when
						}
					} else {             // Remove video from blocklist
						delete extension.storage.data.blocklist.videos[message.id];
					}
					break
			}

			chrome.storage.local.set({ blocklist: extension.storage.data.blocklist }); // Persist blocklist
		} else if (message.action === 'watched') {      // Update watched list
			if (!extension.storage.data.watched || typeof extension.storage.data.watched !== 'object') {
				extension.storage.data.watched = {}; // Ensure structure
			}

			if (message.type === 'add') {               // Mark as watched
				extension.storage.data.watched[message.id] = { title: message.title };
			}

			if (message.type === 'remove') {            // Unmark watched
				delete extension.storage.data.watched[message.id];
			}

			chrome.storage.local.set({ watched: extension.storage.data.watched }); // Persist watched map
		} else if (message.action === 'set') {          // Generic set/remove in storage
			if (message.value) {
				chrome.storage.local.set({ [message.key]: message.value });
			} else {
				chrome.storage.local.remove([message.key]);
			}
		}
	}
});

document.addEventListener('it-play', function () { // Page signaled that playback started
	// var videos = document.querySelectorAll('video'); // (Example probe kept commented)
	try { chrome.runtime.sendMessage({ action: 'play' }) } // Notify background immediately
	catch (error) {                                       // If messaging isn’t ready yet
		console.log(error);
		setTimeout(function () {                          // Retry shortly with optional response log
			try { chrome.runtime.sendMessage({ action: 'play' }, function (response) { console.log(response) }); } catch { }
		}, 321)
	}
});