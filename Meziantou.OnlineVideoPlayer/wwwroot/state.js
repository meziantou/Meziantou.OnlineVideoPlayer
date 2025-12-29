export function persistPlayerState(state) {
    localStorage.setItem("video-player-state", JSON.stringify(state));
}
export function loadPlayerState() {
    const data = localStorage.getItem("video-player-state");
    if (data) {
        return JSON.parse(data);
    }
    return null;
}
