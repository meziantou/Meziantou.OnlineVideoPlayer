import * as playerState from "./state.js";

export class VideoPlayer {
    private rootElement: HTMLElement;
    private videoElement: HTMLVideoElement;
    private progressElement: HTMLProgressElement;
    private currentTimeElement: HTMLElement;
    private totalTimeElement: HTMLElement;
    private trackNameElement: HTMLElement;
    private timerElement: HTMLElement;

    private playlist: string[] = [];
    private currentTrackIndex: number = -1;
    private currentTrackName: string | undefined;

    private random: boolean = true;
    private randomPlaylistHistoryIndexes: number[] = [];
    private randomPlaylistQueueIndexes: number[] = [];

    private displayRemainingTime: boolean = true;
    private mouseInactiveTimer: number | undefined;

    // Auto-pause after 1 hour tracking
    private totalPlaybackTime: number = 0; // in seconds
    private lastPlaybackTimestamp: number | undefined;
    private readonly maxPlaybackTime: number = 3600; // 1 hour in seconds

    // Track if we're waiting for the page to become visible to start playback
    private pendingAutoPlay: boolean = false;

    constructor(rootElement: HTMLElement) {
        this.rootElement = rootElement;
        this.videoElement = document.createElement("video");
        this.videoElement.controls = false;
        this.rootElement.appendChild(this.videoElement);

        rootElement.classList.add("video_player");

        this.trackNameElement = document.createElement("span");
        this.trackNameElement.classList.add("trackname");
        this.rootElement.appendChild(this.trackNameElement);

        this.timerElement = document.createElement("span");
        this.timerElement.classList.add("timer");
        this.rootElement.appendChild(this.timerElement);

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

    private setupVisibilityHandling() {
        // Handle page visibility changes
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && this.pendingAutoPlay) {
                // Page became visible and we have pending autoplay
                this.pendingAutoPlay = false;
                this.videoElement.play().catch(e => {
                    console.error("Failed to start autoplay:", e);
                });
            }
        });
    }

    private tryAutoPlay() {
        if (document.hidden) {
            // Tab is not visible, mark as pending and wait for visibility
            this.pendingAutoPlay = true;
        } else {
            // Tab is visible, start playing immediately
            this.videoElement.play().catch(e => {
                console.error("Failed to start autoplay:", e);
            });
        }
    }

    private displayTrackname() {
        this.updateTrackNameDisplay();
        this.updateTimerDisplay();
    }

    private updateTrackNameDisplay() {
        this.trackNameElement.textContent = this.currentTrackName || "";
    }

    private updateTimerDisplay() {
        const remainingTime = this.maxPlaybackTime - this.totalPlaybackTime;
        const minutes = Math.floor(remainingTime / 60);
        const seconds = Math.floor(remainingTime % 60);
        const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;
        
        this.timerElement.textContent = `⏱️ Auto-pause in ${timeString}`;
    }

    private displayCursor() {
        this.rootElement.classList.remove("mouse-idle");
        if (this.mouseInactiveTimer) {
            clearTimeout(this.mouseInactiveTimer);
        }

        this.mouseInactiveTimer = setTimeout(() => this.rootElement.classList.add("mouse-idle"), 3000);
    }

    private registerEvents() {
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
            this.videoElement.play();
        });

        this.rootElement.addEventListener("mousemove", () => this.displayCursor());
        this.rootElement.addEventListener("click", () => this.displayCursor());

        this.videoElement.addEventListener("ended", () => {
            this.nextTrack();
        });

        this.videoElement.addEventListener("click", () => {
            this.playPause();
        });

        this.videoElement.addEventListener("timeupdate", throttle(() => this.persistState(), 5000));

        this.videoElement.addEventListener("timeupdate", () => {
            this.updateTimeDisplay();
            this.trackPlaybackTime();
        });

        // Track when video starts playing
        this.videoElement.addEventListener("play", () => {
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

        document.addEventListener("keydown", (event) => {
            const nextTrack = (event: KeyboardEvent) => {
                if (event.shiftKey || event.ctrlKey) {
                    this.nextTrack(this.random ? "sequential" : "random");
                } else {
                    this.nextTrack();
                }
            };

            const previousTrack = (event: KeyboardEvent) => {
                if (event.shiftKey || event.ctrlKey) {
                    this.previousTrack(this.random ? "sequential" : "random");
                } else {
                    this.previousTrack();
                }
            };

            let handled = true;
            if (event.key === "Home") {
                this.videoElement.currentTime = 0;
            } else if (event.key === "End") {
                nextTrack(event);
            } else if (event.key === "MediaTrackPrevious") {
                previousTrack(event);
            } else if (event.key === "MediaTrackNext") {
                nextTrack(event);
            } else if (event.key === "n") {
                nextTrack(event);
            } else if (event.key === "p") {
                previousTrack(event);
            } else if (event.key === "Insert") {
                previousTrack(event);
            } else if (event.key === "PageDown") {
                this.advanceCurrentTime(clamp(this.videoElement.duration * 0.1, 0, 300));
            } else if (event.key === "PageUp") {
                this.advanceCurrentTime(-clamp(this.videoElement.duration * 0.1, 0, 300));
            } else if (event.ctrlKey && event.shiftKey && event.key === "ArrowRight") {
                this.advanceCurrentTime(300);
            } else if (event.ctrlKey && event.shiftKey && event.key === "ArrowLeft") {
                this.advanceCurrentTime(-300);
            } else if (event.ctrlKey && event.key === "ArrowRight") {
                this.advanceCurrentTime(60);
            } else if (event.ctrlKey && event.key === "ArrowLeft") {
                this.advanceCurrentTime(-60);
            } else if (event.shiftKey && event.key === "ArrowLeft") {
                this.advanceCurrentTime(-5);
            } else if (event.shiftKey && event.key === "ArrowRight") {
                this.advanceCurrentTime(5);
            } else if (event.key === "ArrowLeft") {
                this.advanceCurrentTime(-30);
            } else if (event.key === "ArrowRight") {
                this.advanceCurrentTime(30);
            } else if (event.key === "r") {
                this.setRandom(!this.random);
            } else if (event.key === "0") {
                this.setCurrentTime(0);
            } else if (event.key === "1") {
                this.setCurrentTime(this.videoElement.duration * 0.1);
            } else if (event.key === "2") {
                this.setCurrentTime(this.videoElement.duration * 0.2);
            } else if (event.key === "3") {
                this.setCurrentTime(this.videoElement.duration * 0.3);
            } else if (event.key === "4") {
                this.setCurrentTime(this.videoElement.duration * 0.4);
            } else if (event.key === "5") {
                this.setCurrentTime(this.videoElement.duration * 0.5);
            } else if (event.key === "6") {
                this.setCurrentTime(this.videoElement.duration * 0.6);
            } else if (event.key === "7") {
                this.setCurrentTime(this.videoElement.duration * 0.7);
            } else if (event.key === "8") {
                this.setCurrentTime(this.videoElement.duration * 0.8);
            } else if (event.key === "9") {
                this.setCurrentTime(this.videoElement.duration * 0.9);
            } else if (event.key === "Delete") {
                if (this.currentTrackName && confirm("delete " + this.currentTrackName)) {
                    const currentTrack = this.currentTrackName;
                    this.nextTrack();
                    fetch("/files/" + encodeURIComponent(currentTrack), { method: "DELETE" })
                        .then(response => {
                            if (response.status >= 200 && response.status < 300) {
                                return;
                            }

                            alert("Failed to delete " + currentTrack);
                        })
                        .catch(() => alert("Failed to delete " + currentTrack));
                }
            } else if (event.key === "t") {
                document.location.href = "/tracks";
            } else if (event.key === "b") {
                document.location.href = "/tracks";
            } else {
                handled = false;
            }

            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }

    private advanceCurrentTime(relativeTime: number) {
        this.videoElement.currentTime += relativeTime;
        this.updateTimeDisplay();
    }

    private setCurrentTime(seconds: number) {
        this.videoElement.currentTime = seconds;
        this.updateTimeDisplay();
    }

    private updateTimeDisplay() {
        if (isFinite(this.videoElement.duration)) {
            function formatTime(seconds: number) {
                return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
            }

            this.progressElement.value = this.videoElement.currentTime;
            this.progressElement.max = this.videoElement.duration;

            this.currentTimeElement.textContent = formatTime(this.videoElement.currentTime);

            if (this.displayRemainingTime) {
                this.totalTimeElement.textContent = "-" + formatTime(this.videoElement.duration - this.videoElement.currentTime);
                this.totalTimeElement.title = formatTime(this.videoElement.duration);
            } else {
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
            this.videoElement.play();
        } else {
            this.videoElement.pause();
        }
    }

    async fetchPlaylists() {
        const response = await fetch("/playlists");
        const playlists = await response.json();
        return playlists;
    }

    async fetchPlaylistItems(playlist: string) {
        const response = await fetch(`/playlists/${encodeURIComponent(playlist)}/tracks`);
        const tracks = await response.json();
        this.playlist = tracks || [];
    }

    setTrackIndex(trackIndex: number) {
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

        try {
            this.tryAutoPlay();
        } catch (e) {
            console.error(e);
        }

        this.persistState();
    }

    nextTrack(mode: undefined | "sequential" | "random" = undefined) {
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
        } else {
            this.setTrackIndex(this.currentTrackIndex + 1);
        }
    }

    private getTrackRandomIndex() {
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

    previousTrack(mode: undefined | "sequential" | "random" = undefined) {
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
        } else {
            this.setTrackIndex(this.currentTrackIndex - 1);
        }
    }

    setRandom(random: boolean) {
        this.random = random;
        if (!random) {
            this.randomPlaylistHistoryIndexes = [];
            this.randomPlaylistQueueIndexes = [];
        }
        this.updateDocumentTitle();
    }

    private updateDocumentTitle() {
        let value = this.currentTrackName || "";
        value = value.split("/").pop() || value; // Keep only the file name, not the full path

        if (this.random) {
            value = "🔀 " + value;
        }

        document.title = value;
    }

    private persistState() {
        playerState.persistPlayerState({
            random: this.random,
            currentTrackIndex: this.currentTrackIndex,
            randomPlaylistHistoryIndexes: this.randomPlaylistHistoryIndexes,
            randomPlaylistQueueIndexes: this.randomPlaylistQueueIndexes,
            showRemainingTime: this.displayRemainingTime,
            currentTime: this.videoElement.currentTime
        });
    }

    private restoreState() {
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

            if (typeof state.currentTrackIndex === "number") {
                this.setTrackIndex(state.currentTrackIndex);
            }

            if (typeof state.currentTime === "number") {
                this.videoElement.currentTime = state.currentTime;
            }
        }
    }

    private trackPlaybackTime() {
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

    private updatePlaybackTime() {
        if (this.lastPlaybackTimestamp !== undefined) {
            const now = Date.now();
            const elapsedSeconds = (now - this.lastPlaybackTimestamp) / 1000;
            this.totalPlaybackTime += elapsedSeconds;
            this.lastPlaybackTimestamp = now;
        }
    }

    private showAutoPauseMessage() {
        // Show a temporary message using the track name element
        this.trackNameElement.textContent = "⏸️ Auto-paused after 1 hour of playback";
        setTimeout(() => {
            this.updateTrackNameDisplay();
            this.updateTimerDisplay();
        }, 5000);
    }
}

function throttle(mainFunction: Function, delay: number) {
    let timerInstance: number | null = null;
    return (...args: any[]) => {
        if (timerInstance === null) {
            mainFunction(...args);
            timerInstance = setTimeout(() => {
                timerInstance = null;
            }, delay);
        }
    };
}

function debounce(func: Function, timeout: number) {
    let timer: number | undefined;
    return (...args: any[]) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func(...args); }, timeout);
    };
}

function clamp(number: number, min: number, max: number) {
    return Math.max(min, Math.min(number, max));
}
