import { Audio } from 'expo-av';
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

        this.sound = null;        // audio instance
        this.isPlaying = false;

        this.onProgress = null;   // callback(currentTime, duration)
        this.onEnded = null;      // callback(thisSong)
        this._progressInterval = null;
    }
    //------------ getters/setters ------------//

    getId() {return this.id;}
    getTitle() {return this.title;}
    getArtist() {return this.artist;}
    getAlbum() {return this.album;}
    getDuration() {return this.duration;}
    getUri() {return this.uri;}
    getCover() {return this.cover;}

     //------------ setters ------------//
  setTitle(title) { this.title = title; }
  setArtist(artist) { this.artist = artist; }
  setAlbum(album) { this.album = album; }
  setDuration(duration) { this.duration = duration; }
  setCover(cover) { this.cover = cover; }

   //------------ playback ------------//
  async load() {
    if (!this.sound) {
      this.sound = new Audio.Sound();
      await this.sound.loadAsync({ uri: this.uri }, {}, true);
      const status = await this.sound.getStatusAsync();
      if (!this.duration && status.durationMillis) {
        this.duration = status.durationMillis / 1000;
      }
    }
  }

  async play() {
    await this.load();
    if (!this.isPlaying) {
      await this.sound.playAsync();
      this.isPlaying = true;

      this._progressInterval = setInterval(async () => {
        if (this.onProgress) {
          const status = await this.sound.getStatusAsync();
          this.onProgress(status.positionMillis / 1000, this.duration);
          if (status.didJustFinish) {
            this.isPlaying = false;
            clearInterval(this._progressInterval);
            if (this.onEnded) this.onEnded(this);
          }
        }
      }, 500);
    }
  }

  async pause() {
    if (this.sound && this.isPlaying) {
      await this.sound.pauseAsync();
      this.isPlaying = false;
      clearInterval(this._progressInterval);
    }
  }

  async stop() {
    if (this.sound) {
      await this.sound.stopAsync();
      this.isPlaying = false;
      clearInterval(this._progressInterval);
    }
  }

  async seek(seconds) {
    if (this.sound) {
      await this.sound.setPositionAsync(seconds * 1000);
    }
  }

  //------------ formatted duration ------------//
  getFormattedDuration() {
    const minutes = Math.floor(this.duration / 60);
    const seconds = Math.floor(this.duration % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  //------------ event setters ------------//
  setOnProgress(callback) { this.onProgress = callback; }
  setOnEnded(callback) { this.onEnded = callback; }

  //------------ unload ------------//
  async unload() {
    if (this.sound) {
      await this.sound.unloadAsync();
      this.sound = null;
      this.isPlaying = false;
      clearInterval(this._progressInterval);
    }
  }
}