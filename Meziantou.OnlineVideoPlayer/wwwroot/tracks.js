import { loadPlayerState, persistPlayerState } from "./state.js";
export class TrackList {
    rootElement;
    tracksElement;
    searchElement;
    tracks = [];
    constructor(rootElement) {
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
                const state = loadPlayerState() || {};
                state.currentTrackIndex = this.tracks.indexOf(track);
                state.currentTime = 0;
                persistPlayerState(state);
            }
        });
        this.fetchAndRender();
    }
    async fetchAndRender() {
        const response = await fetch("/playlists");
        const playlists = await response.json();
        for (const playlist of playlists) {
            const response = await fetch(`/playlists/${encodeURIComponent(playlist)}/tracks`);
            this.tracks = (await response.json()) || [];
            this.render();
            return;
        }
    }
    render() {
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
    isFilteredOut(track) {
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
        function splitTokens(s) {
            return s.split(/\s+/).map(t => t.toLowerCase());
        }
    }
}
