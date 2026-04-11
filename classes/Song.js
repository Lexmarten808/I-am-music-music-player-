import TrackPlayer, { Capability, Event, State } from 'react-native-track-player';

let playerReady = false;
let listenersBound = false;
let activeSongId = null;
const songRegistry = new Map();

function extractState(playbackState) {
  return typeof playbackState === 'number' ? playbackState : playbackState?.state;
}

async function ensurePlayer() {
  if (playerReady) return;

  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.Stop,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause, Capability.Stop],
    progressUpdateEventInterval: 1,
  });

  playerReady = true;
}

function bindGlobalListeners() {
  if (listenersBound) return;

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    if (!activeSongId) return;
    const song = songRegistry.get(activeSongId);
    if (song) {
      song.isPlaying = state === State.Playing;
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    if (!activeSongId) return;

    const song = songRegistry.get(activeSongId);
    if (!song) return;

    song.isPlaying = false;
    if (song.onEnded) song.onEnded(song);
  });

  listenersBound = true;
}

// class used to store the song information
export default class Song {
  //------------ constructor ------------//
  constructor({ id, title, artist, album, duration, uri, cover }) {
    this.id = id;
    this.title = title || 'unkwown title';
    this.artist = artist || 'unknown artist';
    this.album = album || 'unknown album';
    this.duration = duration || 0;
    this.cover = cover || null;
    this.uri = uri;

    this.sound = null;
    this.isPlaying = false;

    this.onProgress = null;
    this.onEnded = null;
    this._progressInterval = null;

    songRegistry.set(this.id, this);
  }

  //------------ getters/setters ------------//
  getId() { return this.id; }
  getTitle() { return this.title; }
  getArtist() { return this.artist; }
  getAlbum() { return this.album; }
  getDuration() { return this.duration; }
  getUri() { return this.uri; }
  getCover() { return this.cover; }

  //------------ setters ------------//
  setTitle(title) { this.title = title; }
  setArtist(artist) { this.artist = artist; }
  setAlbum(album) { this.album = album; }
  setDuration(duration) { this.duration = duration; }
  setCover(cover) { this.cover = cover; }

  //------------ playback ------------//
  async load() {
    try {
      await ensurePlayer();
      bindGlobalListeners();
    } catch (error) {
      console.error('Sound load error:', error);
    }
  }

  async play() {
    try {
      await ensurePlayer();
      bindGlobalListeners();

      if (activeSongId === this.id) {
        await TrackPlayer.play();
        this.isPlaying = true;
        return;
      }

      const previousSong = activeSongId ? songRegistry.get(activeSongId) : null;
      if (previousSong) previousSong.isPlaying = false;

      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: String(this.id),
        url: this.uri,
        title: this.title,
        artist: this.artist,
        album: this.album,
        artwork: this.cover || undefined,
        duration: this.duration || undefined,
      });
      await TrackPlayer.play();

      activeSongId = this.id;
      this.isPlaying = true;
    } catch (error) {
      console.error('Error en play():', error);
    }
  }

  async pause() {
    try {
      if (activeSongId !== this.id) return;
      await TrackPlayer.pause();
      this.isPlaying = false;
    } catch (error) {
      console.error('Error en pause():', error);
    }
  }

  async togglePlayPause() {
    try {
      await ensurePlayer();

      if (activeSongId !== this.id) {
        await this.play();
        return;
      }

      const playbackState = await TrackPlayer.getPlaybackState();
      const state = extractState(playbackState);
      if (state === State.Playing) {
        await this.pause();
      } else {
        await TrackPlayer.play();
        this.isPlaying = true;
      }
    } catch (error) {
      console.error('Error en togglePlayPause():', error);
    }
  }

  async stop() {
    try {
      if (activeSongId !== this.id) {
        this.isPlaying = false;
        return;
      }

      activeSongId = null;
      this.isPlaying = false;
      await TrackPlayer.stop();
      await TrackPlayer.reset();
    } catch {
      this.isPlaying = false;
    }
  }

  async seek(seconds) {
    try {
      if (activeSongId !== this.id) return;
      await TrackPlayer.seekTo(seconds);
    } catch (error) {
      console.error('Error en seek():', error);
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
    this.isPlaying = false;
    if (activeSongId === this.id) {
      await this.stop();
    }
  }
}