import TrackPlayer, { Capability, Event, State } from 'react-native-track-player';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

let playerReady = false;
let playerInitPromise = null;
let listenersBound = false;
let activeSongId = null;
const songRegistry = new Map();
const activeSongListeners = new Set();

function notifyActiveSongChange(songId, isPlaying, position, duration) {
  for (const listener of activeSongListeners) {
    try {
      listener(songId, isPlaying, position, duration);
    } catch {}
  }
}

function extractState(playbackState) {
  return typeof playbackState === 'number' ? playbackState : playbackState?.state;
}

function getSongsInOrder() {
  return Array.from(songRegistry.values()).filter(song => !!song?.uri);
}

function hashString(value) {
  let hash = 0x811c9dc5;
  const input = String(value || '');
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

async function resolveArtworkUri(song) {
  try {
    if (!song?.cover) return undefined;
    if (!song.cover.startsWith('data:image/')) return song.cover;

    const mime = song.cover.substring(5, song.cover.indexOf(';')) || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const base64 = song.cover.split(',')[1];
    if (!base64) return undefined;

    const key = hashString(song.id || song.uri || song.title || 'artwork');
    const fileUri = `${FileSystem.cacheDirectory}artwork_${key}.${ext}`;
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) {
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    if (Platform.OS === 'android' && typeof FileSystem.getContentUriAsync === 'function') {
      try {
        return await FileSystem.getContentUriAsync(fileUri);
      } catch {}
    }
    return fileUri;
  } catch {
    return undefined;
  }
}

async function toTrack(song) {
  const artwork = await resolveArtworkUri(song);
  return {
    id: String(song.id),
    url: song.uri,
    title: song.title,
    artist: song.artist,
    album: song.album,
    artwork,
    duration: song.duration || undefined,
  };
}

/*updates the metadata of a track 
 (it helps to uptdate the notification info includind the cover)*/
async function updateTrackMetadata(song) {
  try {
    if (!song?.id) return;
    if (typeof TrackPlayer.updateMetadataForTrack !== 'function') return;

    const artwork = await resolveArtworkUri(song);
    await TrackPlayer.updateMetadataForTrack(String(song.id), {
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork,
    });
  } catch {}
}

async function ensurePlayer() {
  if (playerReady) return;

  if (!playerInitPromise) {
    playerInitPromise = (async () => {
      try {
        await TrackPlayer.setupPlayer();
      } catch (error) {
        const message = String(error?.message || error || '');
        if (!message.toLowerCase().includes('already been initialized')) {
          throw error;
        }
      }

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
    })().finally(() => {
      playerInitPromise = null;
    });
  }

  await playerInitPromise;
}

function bindGlobalListeners() {
  if (listenersBound) return;

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    if (!activeSongId) return;
    const song = songRegistry.get(activeSongId);
    if (song) {
      song.isPlaying = state === State.Playing;
      notifyActiveSongChange(activeSongId, song.isPlaying);
    }
  });

  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    if (!activeSongId) return;
    const song = songRegistry.get(activeSongId);
    if (!song) return;

    if (duration && !song.duration) {
      song.duration = duration;
    }
    if (song.onProgress) {
      song.onProgress(position || 0, duration || song.duration || 0);
    }
    notifyActiveSongChange(activeSongId, song.isPlaying, position || 0, duration || song.duration || 0);
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    if (!activeSongId) return;

    const song = songRegistry.get(activeSongId);
    if (!song) return;

    song.isPlaying = false;
    if (song.onEnded) song.onEnded(song);
    notifyActiveSongChange(activeSongId, false);
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
    if (!track?.id) return;

    activeSongId = String(track.id);
    for (const [id, song] of songRegistry.entries()) {
      if (id !== activeSongId) {
        song.isPlaying = false;
      }
    }
    notifyActiveSongChange(activeSongId);
  });

  listenersBound = true;
}

// class used to store the song information
export default class Song {
  static onActiveSongChange(listener) {
    activeSongListeners.add(listener);
    return () => activeSongListeners.delete(listener);
  }

  static async updateTrackMetadata(song) {
    await updateTrackMetadata(song);
  }

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

      const songs = getSongsInOrder();
      const targetIndex = songs.findIndex(song => song.id === this.id);
      if (targetIndex < 0) {
        await TrackPlayer.reset();
        await TrackPlayer.add(await toTrack(this));
      } else {
        const queue = [];
        for (const queueSong of songs) {
          queue.push(await toTrack(queueSong));
        }
        await TrackPlayer.reset();
        await TrackPlayer.add(queue);
        await TrackPlayer.skip(targetIndex);
      }

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
      notifyActiveSongChange(null, false);
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