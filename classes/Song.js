// class used to store the song information
export default class Song {
    //------------ constructor ------------//
    constructor({ id, title, artist, album, duration, uri,cover }) {
        this.id = id;
        this.title = title || "unkwown title";
        this.artist = artist || "unknown artist";
        this.album = album || "unknown album";
        this.duration = duration || 0;
        this.cover = cover || null;
        this.uri = uri;
    }
    //------------ methods ------------//

    // method to get the duration in a formatted way (mm:ss)
    getFormattedDuration() {
        const minutes = Math.floor(this.duration / 60);
        const seconds = Math.floor(this.duration % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }


}