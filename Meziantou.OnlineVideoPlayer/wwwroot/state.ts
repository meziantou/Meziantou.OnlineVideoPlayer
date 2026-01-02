export interface VideoPlayerState {
    random: boolean | undefined;
    currentTrackIndex: number | undefined;
    randomPlaylistHistoryIndexes: number[] | undefined;
    randomPlaylistQueueIndexes: number[] | undefined;
    showRemainingTime: boolean | undefined;
    currentTime: number | undefined;
    volume: number | undefined;
}

export function persistPlayerState(state: VideoPlayerState) {
    localStorage.setItem("video-player-state", JSON.stringify(state));
}

export function loadPlayerState(): VideoPlayerState | null {
    const data = localStorage.getItem("video-player-state");
    if (data) {
        return JSON.parse(data);
    }

    return null;
}