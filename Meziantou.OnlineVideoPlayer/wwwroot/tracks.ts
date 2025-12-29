import { loadPlayerState, persistPlayerState, VideoPlayerState } from "./state.js";

export class TrackList {
    private rootElement: HTMLElement;
    private tracksElement: HTMLElement;
    private searchElement: HTMLInputElement;
    private tracks: string[] = [];

    constructor(rootElement: HTMLElement) {
        this.rootElement = rootElement;
        this.searchElement = document.createElement("input");
        this.searchElement.type = "search";
        this.searchElement.placeholder = "Search tracks";
        this.rootElement.appendChild(this.searchElement);
        this.searchElement.focus();

        this.searchElement.addEventListener("input", () => {
            this.render();
        });

        this.tracksElement = document.createElement("ul");
        this.rootElement.appendChild(this.tracksElement);
        this.tracksElement.addEventListener("click", e => {
            if (e.target instanceof HTMLAnchorElement) {
                const track = e.target.textContent || "";

                const state = loadPlayerState() || ({} as VideoPlayerState);
                state.currentTrackIndex = this.tracks.indexOf(track);
                state.currentTime = 0;
                persistPlayerState(state);
            }
        });

        this.fetchAndRender();
    }

    private async fetchAndRender() {
        const response = await fetch("/playlists");
        const playlists = await response.json();
        for (const playlist of playlists) {
            const response = await fetch(`/playlists/${encodeURIComponent(playlist)}/tracks`);
            this.tracks = (await response.json()) || [];
            this.render();
            return;
        }
    }

    private render() {
        this.tracksElement.innerHTML = "";

        for (const track of this.tracks) {
            if (this.isFilteredOut(track)) {
                continue;
            }

            const trackElement = document.createElement("li");
            this.tracksElement.appendChild(trackElement);

            const trackLink = document.createElement("a");
            trackLink.href = "/";
            trackLink.textContent = track;
            trackElement.appendChild(trackLink);
        }
    }

    private isFilteredOut(track: string) {
        if (!this.searchElement.value) {
            return false;
        }

        const searchTokens = splitTokens(this.searchElement.value);
        const trackTokens = splitTokens(track);

        return !searchTokens.every(searchToken => {
            return trackTokens.some(trackToken => {
                return trackToken.indexOf(searchToken) !== -1;
            });
        });

        function splitTokens(s: string) {
            return s.split(/\s+/).map(t => t.toLowerCase());
        }
    }
}
