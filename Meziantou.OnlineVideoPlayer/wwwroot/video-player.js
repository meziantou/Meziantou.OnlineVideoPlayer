import * as playerState from "./state.js";
export class VideoPlayer {
    rootElement;
    videoElement;
    progressElement;
    currentTimeElement;
    totalTimeElement;
    trackNameElement;
    timerElement;
    volumeElement;
    autoplayPromptElement;
    shortcutsHelpElement;
    audioContext = null;
    gainNode = null;
    sourceNode = null;
    channelSplitterNode = null;
    channelMergerNode = null;
    stereoLeftGainNode = null;
    stereoRightGainNode = null;
    monoLeftGainNode = null;
    monoRightGainNode = null;
    currentVolume = 1.0;
    monoAudio = false;
    hideVolumeIndicatorTimer;
    showShortcutsHelp = false;
    playlist = [];
    currentTrackIndex = -1;
    currentTrackName;
    random = true;
    randomPlaylistHistoryIndexes = [];
    randomPlaylistQueueIndexes = [];
    displayRemainingTime = true;
    mouseInactiveTimer;
    // Auto-pause after 1 hour tracking
    totalPlaybackTime = 0; // in seconds
    lastPlaybackTimestamp;
    maxPlaybackTime = 3600; // 1 hour in seconds
    // Track if we're waiting for the page to become visible to start playback
    pendingAutoPlay = false;
    autoplayBlocked = false;
    constructor(rootElement) {
        this.rootElement = rootElement;
        this.videoElement = document.createElement("video");
        this.videoElement.controls = false;
        this.rootElement.appendChild(this.videoElement);
        rootElement.classList.add("video_player");
        // Initialize Web Audio API for volume amplification
        this.initAudioContext();
        this.trackNameElement = document.createElement("span");
        this.trackNameElement.classList.add("trackname");
        this.rootElement.appendChild(this.trackNameElement);
        this.timerElement = document.createElement("span");
        this.timerElement.classList.add("timer");
        this.rootElement.appendChild(this.timerElement);
        this.volumeElement = document.createElement("span");
        this.volumeElement.classList.add("volume");
        this.rootElement.appendChild(this.volumeElement);
        this.autoplayPromptElement = document.createElement("span");
        this.autoplayPromptElement.classList.add("autoplay-prompt");
        this.rootElement.appendChild(this.autoplayPromptElement);
        this.shortcutsHelpElement = document.createElement("div");
        this.shortcutsHelpElement.classList.add("shortcut-help");
        this.shortcutsHelpElement.innerHTML = this.getShortcutsHelpHtml();
        this.rootElement.appendChild(this.shortcutsHelpElement);
        const controls = document.createElement("div");
        controls.classList.add("controls");
        this.rootElement.appendChild(controls);
        this.currentTimeElement = document.createElement("span");
        this.totalTimeElement = document.createElement("span");
        this.progressElement = document.createElement("progress");
        controls.appendChild(this.currentTimeElement);
        controls.appendChild(this.progressElement);
        controls.appendChild(this.totalTimeElement);
        this.registerEvents();
        this.setupVisibilityHandling();
        this.fetchPlaylists().then(playlists => {
            if (playlists.length > 0) {
                this.fetchPlaylistItems(playlists[0]).then(() => {
                    this.restoreState();
                    if (this.currentTrackIndex === -1) {
                        this.nextTrack();
                    }
                });
            }
        });
    }
    setupVisibilityHandling() {
        // Handle page visibility changes
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                this.recoverAudioOutput();
            }
            if (!document.hidden && this.pendingAutoPlay) {
                // Page became visible and we have pending autoplay
                this.pendingAutoPlay = false;
                this.startPlayback(true);
            }
        });
        window.addEventListener("focus", () => {
            this.recoverAudioOutput();
        });
        const mediaDevices = navigator.mediaDevices;
        if (mediaDevices && typeof mediaDevices.addEventListener === "function") {
            mediaDevices.addEventListener("devicechange", () => {
                this.recoverAudioOutput();
            });
        }
    }
    tryAutoPlay() {
        if (document.hidden) {
            // Tab is not visible, mark as pending and wait for visibility
            this.pendingAutoPlay = true;
        }
        else {
            // Tab is visible, start playing immediately
            this.startPlayback(true);
        }
    }
    startPlayback(isAutoplayAttempt) {
        this.recoverAudioOutput();
        const startPromise = this.audioContext && this.audioContext.state === "suspended"
            ? this.audioContext.resume().then(() => this.videoElement.play())
            : this.videoElement.play();
        startPromise
            .then(() => {
            this.hideAutoplayPrompt();
        })
            .catch(error => {
            if (isAutoplayAttempt && this.isExpectedAutoplayError(error)) {
                this.showAutoplayPrompt();
                return;
            }
            console.error("Failed to start playback:", error);
        });
    }
    isExpectedAutoplayError(error) {
        return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotSupportedError");
    }
    showAutoplayPrompt() {
        this.autoplayBlocked = true;
        this.autoplayPromptElement.textContent = "▶️ Autoplay blocked. Click to play.";
        this.autoplayPromptElement.classList.add("visible");
    }
    hideAutoplayPrompt() {
        this.autoplayBlocked = false;
        this.autoplayPromptElement.classList.remove("visible");
    }
    retryPlaybackIfBlocked() {
        if (!this.autoplayBlocked) {
            return false;
        }
        this.startPlayback(false);
        return true;
    }
    displayTrackname() {
        this.updateTrackNameDisplay();
        this.updateTimerDisplay();
    }
    initAudioContext() {
        try {
            this.audioContext = new AudioContext();
            this.sourceNode = this.audioContext.createMediaElementSource(this.videoElement);
            this.gainNode = this.audioContext.createGain();
            this.channelSplitterNode = this.audioContext.createChannelSplitter(2);
            this.channelMergerNode = this.audioContext.createChannelMerger(2);
            this.stereoLeftGainNode = this.audioContext.createGain();
            this.stereoRightGainNode = this.audioContext.createGain();
            this.monoLeftGainNode = this.audioContext.createGain();
            this.monoRightGainNode = this.audioContext.createGain();
            this.sourceNode.connect(this.gainNode);
            this.gainNode.connect(this.channelSplitterNode);
            this.channelSplitterNode.connect(this.stereoLeftGainNode, 0);
            this.channelSplitterNode.connect(this.stereoRightGainNode, 1);
            this.stereoLeftGainNode.connect(this.channelMergerNode, 0, 0);
            this.stereoRightGainNode.connect(this.channelMergerNode, 0, 1);
            this.channelSplitterNode.connect(this.monoLeftGainNode, 0);
            this.channelSplitterNode.connect(this.monoRightGainNode, 1);
            this.monoLeftGainNode.connect(this.channelMergerNode, 0, 0);
            this.monoLeftGainNode.connect(this.channelMergerNode, 0, 1);
            this.monoRightGainNode.connect(this.channelMergerNode, 0, 0);
            this.monoRightGainNode.connect(this.channelMergerNode, 0, 1);
            this.channelMergerNode.connect(this.audioContext.destination);
            // Set initial volume
            this.gainNode.gain.value = this.currentVolume;
            this.applyAudioChannelMode();
        }
        catch (error) {
            console.error("Failed to initialize Web Audio API:", error);
            // Fall back to regular video volume control
            this.audioContext = null;
            this.sourceNode = null;
            this.gainNode = null;
            this.channelSplitterNode = null;
            this.channelMergerNode = null;
            this.stereoLeftGainNode = null;
            this.stereoRightGainNode = null;
            this.monoLeftGainNode = null;
            this.monoRightGainNode = null;
        }
    }
    recoverAudioOutput() {
        this.videoElement.defaultMuted = false;
        this.videoElement.muted = false;
        if (this.gainNode) {
            this.gainNode.gain.value = this.currentVolume;
            this.applyAudioChannelMode();
        }
        else {
            this.videoElement.volume = Math.min(1, this.currentVolume);
        }
        if (this.audioContext && this.audioContext.state === "suspended" && !this.videoElement.paused) {
            this.audioContext.resume().catch(error => {
                if (!this.isExpectedAutoplayError(error)) {
                    console.error("Failed to resume audio context during output recovery:", error);
                }
            });
        }
    }
    setVolume(volume, showIndicator = true) {
        // Clamp volume between 0 and 2 (0% to 200%)
        volume = Math.max(0, Math.min(2, volume));
        this.currentVolume = volume;
        if (this.gainNode) {
            this.gainNode.gain.value = volume;
        }
        else {
            // Fallback to video element volume (capped at 1)
            this.videoElement.volume = Math.min(1, volume);
        }
        if (showIndicator) {
            this.showVolumeIndicator();
        }
        this.persistState();
    }
    setMonoAudio(value, showIndicator = true) {
        this.monoAudio = value;
        this.applyAudioChannelMode();
        if (showIndicator) {
            this.showStatusIndicator(this.monoAudio ? "🎚️ Mono audio" : "🎚️ Stereo audio");
        }
        this.persistState();
    }
    applyAudioChannelMode() {
        if (!this.stereoLeftGainNode || !this.stereoRightGainNode || !this.monoLeftGainNode || !this.monoRightGainNode) {
            return;
        }
        if (this.monoAudio) {
            this.stereoLeftGainNode.gain.value = 0;
            this.stereoRightGainNode.gain.value = 0;
            this.monoLeftGainNode.gain.value = 0.5;
            this.monoRightGainNode.gain.value = 0.5;
        }
        else {
            this.stereoLeftGainNode.gain.value = 1;
            this.stereoRightGainNode.gain.value = 1;
            this.monoLeftGainNode.gain.value = 0;
            this.monoRightGainNode.gain.value = 0;
        }
    }
    toggleMonoAudio() {
        this.setMonoAudio(!this.monoAudio);
    }
    adjustVolume(delta) {
        const newVolume = this.currentVolume + delta;
        this.setVolume(newVolume);
    }
    showVolumeIndicator() {
        const volumePercent = Math.round(this.currentVolume * 100);
        this.showStatusIndicator(`🔊 ${volumePercent}%`);
    }
    showStatusIndicator(value) {
        this.volumeElement.textContent = value;
        this.volumeElement.classList.add("visible");
        if (this.hideVolumeIndicatorTimer !== undefined) {
            clearTimeout(this.hideVolumeIndicatorTimer);
        }
        this.hideVolumeIndicatorTimer = setTimeout(() => {
            this.volumeElement.classList.remove("visible");
            this.hideVolumeIndicatorTimer = undefined;
        }, 2000);
    }
    toggleShortcutsHelp() {
        this.showShortcutsHelp = !this.showShortcutsHelp;
        this.shortcutsHelpElement.classList.toggle("visible", this.showShortcutsHelp);
    }
    getShortcutsHelpHtml() {
        return `
      <strong>Keyboard shortcuts</strong>
      <ul>
        <li><kbd>Space</kbd> Play/Pause</li>
        <li><kbd>?</kbd> Show/Hide this help</li>
        <li><kbd>A</kbd> Toggle mono audio</li>
        <li><kbd>R</kbd> Toggle random mode</li>
        <li><kbd>N</kbd> / <kbd>P</kbd> Next/Previous track</li>
        <li><kbd>Shift+N</kbd> / <kbd>Shift+P</kbd> Invert random/sequential mode for next/previous</li>
        <li><kbd>]</kbd> / <kbd>[</kbd> Invert random/sequential mode for next/previous</li>
        <li><kbd>Ctrl+N</kbd> / <kbd>Ctrl+P</kbd> Invert random/sequential mode for next/previous</li>
        <li><kbd>MediaTrackNext</kbd> / <kbd>MediaTrackPrevious</kbd> Next/Previous track</li>
        <li><kbd>Home</kbd> Go to start, <kbd>End</kbd> Next track, <kbd>Insert</kbd> Previous track</li>
        <li><kbd>ArrowLeft</kbd> / <kbd>ArrowRight</kbd> Seek -30s / +30s</li>
        <li><kbd>Shift+ArrowLeft</kbd> / <kbd>Shift+ArrowRight</kbd> Seek -5s / +5s</li>
        <li><kbd>Ctrl+ArrowLeft</kbd> / <kbd>Ctrl+ArrowRight</kbd> Seek -60s / +60s</li>
        <li><kbd>Cmd+ArrowLeft/Right</kbd> or <kbd>Option+ArrowLeft/Right</kbd> (macOS) Seek -60s / +60s</li>
        <li><kbd>PageUp</kbd>, <kbd>,</kbd>, <kbd>Ctrl+Shift+ArrowLeft</kbd>, <kbd>AltGr+ArrowLeft</kbd> Seek backward 10%</li>
        <li><kbd>PageDown</kbd>, <kbd>.</kbd>, <kbd>Ctrl+Shift+ArrowRight</kbd>, <kbd>AltGr+ArrowRight</kbd> Seek forward 10%</li>
        <li><kbd>0</kbd>-<kbd>9</kbd> Jump to 0%-90%</li>
        <li><kbd>ArrowUp</kbd> / <kbd>ArrowDown</kbd> Volume +5% / -5%</li>
        <li><kbd>Delete</kbd> / <kbd>Backspace</kbd> Delete current file</li>
        <li><kbd>T</kbd> / <kbd>B</kbd> Open tracks page</li>
      </ul>`;
    }
    updateTrackNameDisplay() {
        this.trackNameElement.textContent = this.currentTrackName || "";
    }
    updateTimerDisplay() {
        const remainingTime = this.maxPlaybackTime - this.totalPlaybackTime;
        const minutes = Math.floor(remainingTime / 60);
        const seconds = Math.floor(remainingTime % 60);
        const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;
        this.timerElement.textContent = `⏱️ Auto-pause in ${timeString}`;
    }
    displayCursor() {
        this.rootElement.classList.remove("mouse-idle");
        if (this.mouseInactiveTimer) {
            clearTimeout(this.mouseInactiveTimer);
        }
        this.mouseInactiveTimer = setTimeout(() => this.rootElement.classList.add("mouse-idle"), 3000);
    }
    registerEvents() {
        this.totalTimeElement.addEventListener("click", () => {
            this.displayRemainingTime = !this.displayRemainingTime;
            this.updateTimeDisplay();
            this.persistState();
        });
        this.progressElement.addEventListener("click", (e) => {
            let offset = e.pageX - this.progressElement.offsetLeft;
            if (this.progressElement.offsetParent instanceof HTMLElement) {
                offset = offset - this.progressElement.offsetParent.offsetLeft;
            }
            const pos = offset / this.progressElement.offsetWidth;
            this.videoElement.currentTime = pos * this.videoElement.duration;
            this.startPlayback(false);
        });
        this.rootElement.addEventListener("mousemove", () => this.displayCursor());
        this.rootElement.addEventListener("click", (event) => {
            this.displayCursor();
            if (event.target !== this.videoElement) {
                this.retryPlaybackIfBlocked();
            }
        });
        // Mouse wheel for volume control
        this.rootElement.addEventListener("wheel", (event) => {
            event.preventDefault();
            const delta = event.deltaY > 0 ? -0.05 : 0.05; // Scroll down = quieter, scroll up = louder
            this.adjustVolume(delta);
        }, { passive: false });
        this.videoElement.addEventListener("ended", () => {
            this.nextTrack();
        });
        this.videoElement.addEventListener("click", () => {
            if (this.retryPlaybackIfBlocked()) {
                return;
            }
            this.recoverAudioOutput();
            this.playPause();
        });
        this.videoElement.addEventListener("timeupdate", throttle(() => this.persistState(), 5000));
        this.videoElement.addEventListener("timeupdate", () => {
            this.updateTimeDisplay();
            this.trackPlaybackTime();
        });
        // Track when video starts playing
        this.videoElement.addEventListener("play", () => {
            this.hideAutoplayPrompt();
            this.recoverAudioOutput();
            this.lastPlaybackTimestamp = Date.now();
        });
        // Track when video pauses
        this.videoElement.addEventListener("pause", () => {
            this.updatePlaybackTime();
        });
        document.addEventListener("keypress", (event) => {
            if (event.code === "Space") {
                this.playPause();
                event.preventDefault();
            }
        });
        const isMacOS = navigator.platform.toLowerCase().includes("mac");
        document.addEventListener("keydown", (event) => {
            const nextTrack = (event) => {
                if (event.shiftKey || event.ctrlKey) {
                    this.nextTrack(this.random ? "sequential" : "random");
                }
                else {
                    this.nextTrack();
                }
            };
            const previousTrack = (event) => {
                if (event.shiftKey || event.ctrlKey) {
                    this.previousTrack(this.random ? "sequential" : "random");
                }
                else {
                    this.previousTrack();
                }
            };
            const isLargeSeekModifierPressed = event.ctrlKey || (isMacOS && (event.metaKey || event.altKey));
            const invertedMode = this.random ? "sequential" : "random";
            let handled = true;
            if (event.key === "Home") {
                this.videoElement.currentTime = 0;
            }
            else if (event.key === "End") {
                nextTrack(event);
            }
            else if (event.key === "MediaTrackPrevious") {
                previousTrack(event);
            }
            else if (event.key === "MediaTrackNext") {
                nextTrack(event);
            }
            else if (event.key === "n") {
                nextTrack(event);
            }
            else if (event.key === "p") {
                previousTrack(event);
            }
            else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "]") {
                this.nextTrack(invertedMode);
            }
            else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "[") {
                this.previousTrack(invertedMode);
            }
            else if (event.key === "Insert") {
                previousTrack(event);
            }
            else if (event.key === "PageDown" || event.key === "." || (((event.ctrlKey && event.shiftKey) || event.getModifierState("AltGraph")) && event.key === "ArrowRight")) {
                this.advanceCurrentTime(clamp(this.videoElement.duration * 0.1, 0, 300));
            }
            else if (event.key === "PageUp" || event.key === "," || (((event.ctrlKey && event.shiftKey) || event.getModifierState("AltGraph")) && event.key === "ArrowLeft")) {
                this.advanceCurrentTime(-clamp(this.videoElement.duration * 0.1, 0, 300));
            }
            else if (isLargeSeekModifierPressed && event.key === "ArrowRight") {
                this.advanceCurrentTime(60);
            }
            else if (isLargeSeekModifierPressed && event.key === "ArrowLeft") {
                this.advanceCurrentTime(-60);
            }
            else if (event.shiftKey && event.key === "ArrowLeft") {
                this.advanceCurrentTime(-5);
            }
            else if (event.shiftKey && event.key === "ArrowRight") {
                this.advanceCurrentTime(5);
            }
            else if (event.key === "ArrowLeft") {
                this.advanceCurrentTime(-30);
            }
            else if (event.key === "ArrowRight") {
                this.advanceCurrentTime(30);
            }
            else if (event.key === "r") {
                this.setRandom(!this.random);
            }
            else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "a") {
                this.toggleMonoAudio();
            }
            else if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "?" || (event.key === "/" && event.shiftKey))) {
                this.toggleShortcutsHelp();
            }
            else if (event.key === "0") {
                this.setCurrentTime(0);
            }
            else if (event.key === "1") {
                this.setCurrentTime(this.videoElement.duration * 0.1);
            }
            else if (event.key === "2") {
                this.setCurrentTime(this.videoElement.duration * 0.2);
            }
            else if (event.key === "3") {
                this.setCurrentTime(this.videoElement.duration * 0.3);
            }
            else if (event.key === "4") {
                this.setCurrentTime(this.videoElement.duration * 0.4);
            }
            else if (event.key === "5") {
                this.setCurrentTime(this.videoElement.duration * 0.5);
            }
            else if (event.key === "6") {
                this.setCurrentTime(this.videoElement.duration * 0.6);
            }
            else if (event.key === "7") {
                this.setCurrentTime(this.videoElement.duration * 0.7);
            }
            else if (event.key === "8") {
                this.setCurrentTime(this.videoElement.duration * 0.8);
            }
            else if (event.key === "9") {
                this.setCurrentTime(this.videoElement.duration * 0.9);
            }
            else if (event.key === "Delete" || event.key === "Backspace") {
                if (this.currentTrackName) {
                    const currentTrack = this.currentTrackName;
                    if (confirm("Delete " + currentTrack + "?")) {
                        void this.deleteTrack(currentTrack);
                    }
                }
            }
            else if (event.key === "t") {
                document.location.href = "/tracks";
            }
            else if (event.key === "b") {
                document.location.href = "/tracks";
            }
            else if (event.key === "ArrowUp") {
                this.adjustVolume(0.05); // Increase by 5%
            }
            else if (event.key === "ArrowDown") {
                this.adjustVolume(-0.05); // Decrease by 5%
            }
            else {
                handled = false;
            }
            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
    advanceCurrentTime(relativeTime) {
        this.videoElement.currentTime += relativeTime;
        this.updateTimeDisplay();
    }
    setCurrentTime(seconds) {
        this.videoElement.currentTime = seconds;
        this.updateTimeDisplay();
    }
    updateTimeDisplay() {
        if (isFinite(this.videoElement.duration)) {
            function formatTime(seconds) {
                return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
            }
            this.progressElement.value = this.videoElement.currentTime;
            this.progressElement.max = this.videoElement.duration;
            this.currentTimeElement.textContent = formatTime(this.videoElement.currentTime);
            if (this.displayRemainingTime) {
                this.totalTimeElement.textContent = "-" + formatTime(this.videoElement.duration - this.videoElement.currentTime);
                this.totalTimeElement.title = formatTime(this.videoElement.duration);
            }
            else {
                this.totalTimeElement.textContent = formatTime(this.videoElement.duration);
                this.totalTimeElement.title = "";
            }
        }
        else {
            this.progressElement.value = 0;
            this.progressElement.max = 0;
        }
    }
    playPause() {
        if (this.videoElement.paused || this.videoElement.ended) {
            this.startPlayback(false);
        }
        else {
            this.videoElement.pause();
        }
    }
    async fetchPlaylists() {
        const response = await fetch("/playlists");
        const playlists = await response.json();
        return playlists;
    }
    async deleteTrack(trackPath) {
        try {
            const response = await fetch("/files/" + encodeURIComponent(trackPath), { method: "DELETE" });
            if (response.status >= 200 && response.status < 300) {
                if (this.currentTrackName === trackPath) {
                    this.nextTrack();
                }
                return;
            }
            await this.handleDeleteFailure(trackPath);
        }
        catch (error) {
            console.error("Failed to delete track:", error);
            await this.handleDeleteFailure(trackPath);
        }
    }
    async handleDeleteFailure(trackPath) {
        const copiedToClipboard = await this.copyToClipboard(trackPath);
        if (copiedToClipboard) {
            alert("Failed to delete " + trackPath + ". The path was copied to the clipboard.");
        }
        else {
            alert("Failed to delete " + trackPath + ". Unable to copy the path to the clipboard.");
        }
    }
    async copyToClipboard(value) {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
            return false;
        }
        try {
            await navigator.clipboard.writeText(value);
            return true;
        }
        catch (error) {
            console.error("Failed to copy path to clipboard:", error);
            return false;
        }
    }
    async fetchPlaylistItems(playlist) {
        const response = await fetch(`/playlists/${encodeURIComponent(playlist)}/tracks`);
        const tracks = await response.json();
        this.playlist = tracks || [];
    }
    setTrackIndex(trackIndex) {
        if (trackIndex < 0) {
            trackIndex = this.playlist.length - trackIndex;
        }
        if (trackIndex < 0) {
            trackIndex = 0;
        }
        trackIndex = trackIndex % this.playlist.length;
        const url = this.playlist[trackIndex];
        this.currentTrackIndex = trackIndex;
        this.currentTrackName = url;
        this.updateTrackNameDisplay();
        this.videoElement.src = "files/" + encodeURIComponent(url);
        this.updateDocumentTitle();
        this.displayTrackname();
        this.displayCursor(); // Show title for idle period when track changes
        // Clear time display while waiting for new track to load
        this.currentTimeElement.textContent = "--:--";
        this.totalTimeElement.textContent = "--:--";
        this.totalTimeElement.title = "";
        this.progressElement.value = 0;
        this.progressElement.max = 0;
        this.hideAutoplayPrompt();
        try {
            this.tryAutoPlay();
        }
        catch (e) {
            console.error(e);
        }
        this.persistState();
    }
    nextTrack(mode = undefined) {
        if (this.playlist.length === 0) {
            return;
        }
        const finalMode = mode || (this.random ? "random" : "sequential");
        if (finalMode === "random") {
            this.randomPlaylistHistoryIndexes.push(this.currentTrackIndex);
            let newIndex = this.randomPlaylistQueueIndexes.shift();
            if (newIndex !== undefined) {
                this.setTrackIndex(newIndex);
                return;
            }
            newIndex = this.getTrackRandomIndex();
            this.setTrackIndex(newIndex);
        }
        else {
            this.setTrackIndex(this.currentTrackIndex + 1);
        }
    }
    getTrackRandomIndex() {
        // If we've played all tracks, clear history except the current track
        if (this.randomPlaylistHistoryIndexes.length >= this.playlist.length - 1) {
            const currentTrack = this.randomPlaylistHistoryIndexes[this.randomPlaylistHistoryIndexes.length - 1];
            this.randomPlaylistHistoryIndexes = currentTrack !== undefined ? [currentTrack] : [];
        }
        // Find a random track that hasn't been played recently
        let index = Math.floor(Math.random() * this.playlist.length);
        let attempts = 0;
        const maxAttempts = this.playlist.length * 2;
        while (this.randomPlaylistHistoryIndexes.indexOf(index) !== -1 && attempts < maxAttempts) {
            index = Math.floor(Math.random() * this.playlist.length);
            attempts++;
        }
        return index;
    }
    previousTrack(mode = undefined) {
        const finalMode = mode || (this.random ? "random" : "sequential");
        if (finalMode === "random") {
            this.randomPlaylistQueueIndexes.unshift(this.currentTrackIndex);
            var previous = this.randomPlaylistHistoryIndexes.pop();
            if (previous !== undefined) {
                this.setTrackIndex(previous);
                return;
            }
            const newIndex = this.getTrackRandomIndex();
            this.setTrackIndex(newIndex);
        }
        else {
            this.setTrackIndex(this.currentTrackIndex - 1);
        }
    }
    setRandom(random) {
        this.random = random;
        if (!random) {
            this.randomPlaylistHistoryIndexes = [];
            this.randomPlaylistQueueIndexes = [];
        }
        this.updateDocumentTitle();
    }
    updateDocumentTitle() {
        let value = this.currentTrackName || "";
        value = value.split("/").pop() || value; // Keep only the file name, not the full path
        if (this.random) {
            value = "🔀 " + value;
        }
        document.title = value;
    }
    persistState() {
        playerState.persistPlayerState({
            random: this.random,
            currentTrackIndex: this.currentTrackIndex,
            currentTrackPath: this.currentTrackIndex >= 0 ? this.playlist[this.currentTrackIndex] : undefined,
            randomPlaylistHistoryIndexes: this.randomPlaylistHistoryIndexes,
            randomPlaylistQueueIndexes: this.randomPlaylistQueueIndexes,
            showRemainingTime: this.displayRemainingTime,
            currentTime: this.videoElement.currentTime,
            volume: this.currentVolume,
            monoAudio: this.monoAudio
        });
    }
    restoreState() {
        const state = playerState.loadPlayerState();
        if (state) {
            if (typeof state.random === "boolean") {
                this.random = state.random;
            }
            if (typeof state.showRemainingTime === "boolean") {
                this.displayRemainingTime = state.showRemainingTime;
            }
            if (Array.isArray(state.randomPlaylistQueueIndexes)) {
                this.randomPlaylistQueueIndexes = state.randomPlaylistQueueIndexes;
            }
            if (Array.isArray(state.randomPlaylistHistoryIndexes)) {
                this.randomPlaylistHistoryIndexes = state.randomPlaylistHistoryIndexes;
            }
            let trackIndexToRestore;
            if (typeof state.currentTrackPath === "string") {
                const trackIndexFromPath = this.playlist.indexOf(state.currentTrackPath);
                if (trackIndexFromPath !== -1) {
                    trackIndexToRestore = trackIndexFromPath;
                }
            }
            if (trackIndexToRestore === undefined && typeof state.currentTrackIndex === "number") {
                trackIndexToRestore = state.currentTrackIndex;
            }
            if (typeof trackIndexToRestore === "number") {
                this.setTrackIndex(trackIndexToRestore);
            }
            if (typeof state.currentTime === "number") {
                this.videoElement.currentTime = state.currentTime;
            }
            if (typeof state.volume === "number") {
                this.setVolume(state.volume, false);
            }
            if (typeof state.monoAudio === "boolean") {
                this.setMonoAudio(state.monoAudio, false);
            }
        }
    }
    trackPlaybackTime() {
        if (!this.videoElement.paused && this.lastPlaybackTimestamp !== undefined) {
            this.updatePlaybackTime();
            this.updateTimerDisplay();
            // Check if we've exceeded the max playback time
            if (this.totalPlaybackTime >= this.maxPlaybackTime) {
                this.videoElement.pause();
                this.showAutoPauseMessage();
            }
        }
    }
    updatePlaybackTime() {
        if (this.lastPlaybackTimestamp !== undefined) {
            const now = Date.now();
            const elapsedSeconds = (now - this.lastPlaybackTimestamp) / 1000;
            this.totalPlaybackTime += elapsedSeconds;
            this.lastPlaybackTimestamp = now;
        }
    }
    showAutoPauseMessage() {
        // Show a temporary message using the track name element
        this.trackNameElement.textContent = "⏸️ Auto-paused after 1 hour of playback";
        setTimeout(() => {
            this.updateTrackNameDisplay();
            this.updateTimerDisplay();
        }, 5000);
    }
}
function throttle(mainFunction, delay) {
    let timerInstance = null;
    return (...args) => {
        if (timerInstance === null) {
            mainFunction(...args);
            timerInstance = setTimeout(() => {
                timerInstance = null;
            }, delay);
        }
    };
}
function debounce(func, timeout) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func(...args); }, timeout);
    };
}
function clamp(number, min, max) {
    return Math.max(min, Math.min(number, max));
}
