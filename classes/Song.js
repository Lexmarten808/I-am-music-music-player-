// React Native Track Player for audio playback and notifications.
import TrackPlayer, { Capability, Event, State } from 'react-native-track-player';
// FileSystem API for caching artwork to internal app cache.
import * as FileSystem from 'expo-file-system/legacy';

// Tracks whether the Track Player has been initialized.
let playerReady = false;
// Stores the promise for player setup to avoid duplicate initialization.
let playerInitPromise = null;
// Flag to ensure global listeners are bound only once.
let listenersBound = false;
// ID of the currently playing song.
let activeSongId = null;
// Cache version for the playable song registry.
let songRegistryVersion = 0;
// Cached playable songs and their indexes for quick skips.
let cachedPlayableSongs = null;
let cachedPlayableIndexById = new Map();
let cachedPlayableSongsVersion = -1;
// Cache signature for the TrackPlayer queue.
let playableQueueSignature = null;
// Map of all song instances indexed by ID for quick lookups.
const songRegistry = new Map();
// Set of callback functions that listen for active song changes.
const activeSongListeners = new Set();

// Notifies all listeners when the active song changes or playback state updates.
function notifyActiveSongChange(songId, isPlaying, position, duration) {
  for (const listener of activeSongListeners) {
    try {
      listener(songId, isPlaying, position, duration);
    } catch {}
  }
}

// Extracts the numeric state from the playback state object (handles both formats).
function extractState(playbackState) {
  return typeof playbackState === 'number' ? playbackState : playbackState?.state;
}

// Returns all registered songs that have valid URIs (playable songs).
function getSongsInOrder() {
  return Array.from(songRegistry.values()).filter(song => !!song?.uri);
}

function getPlayableSongInfo(targetSongId) {
  if (cachedPlayableSongsVersion !== songRegistryVersion || !cachedPlayableSongs) {
    cachedPlayableSongs = getSongsInOrder();
    cachedPlayableIndexById = new Map();
    for (let i = 0; i < cachedPlayableSongs.length; i++) {
      cachedPlayableIndexById.set(String(cachedPlayableSongs[i].id), i);
    }
    cachedPlayableSongsVersion = songRegistryVersion;
  }

  return {
    songs: cachedPlayableSongs,
    targetIndex: cachedPlayableIndexById.get(String(targetSongId)) ?? -1,
  };
}

function getQueueSignature(songs) {
  return songs.map(song => String(song.id)).join('|');
}

async function ensurePlayableQueue(songs) {
  const signature = getQueueSignature(songs);
  if (playableQueueSignature === signature) return;

  const queue = songs.map(song => ({
    id: String(song.id),
    url: song.uri,
    title: song.title,
    artist: song.artist,
    album: song.album,
    artwork: undefined,
    duration: song.duration || undefined,
  }));

  await TrackPlayer.reset();
  await TrackPlayer.add(queue);
  playableQueueSignature = signature;
}

// Generates a stable, short hash from a string for use in filenames.
function hashString(value) {
  // Use FNV-1a hash algorithm for fast, stable results.
  let hash = 0x811c9dc5;
  const input = String(value || '');
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

// Resolves artwork cover art to a file URI in the app's internal cache.
// FileSystem.cacheDirectory points to /data/user/0/com.app/cache/ (internal to app),
// which MediaSession can access without permission issues.
async function resolveArtworkUri(song) {
  try {
    // Return undefined if no cover art is available.
    if (!song?.cover) return undefined;
    // Return non-data URIs as-is (already file or http URLs).
    if (!song.cover.startsWith('data:image/')) return song.cover;

    // Extract MIME type from the data URI.
    const mime = song.cover.substring(5, song.cover.indexOf(';')) || 'image/jpeg';
    // Determine file extension based on MIME type.
    const ext = mime.includes('png') ? 'png' : 'jpg';
    // Extract base64 content from the data URI.
    const base64 = song.cover.split(',')[1];
    // Return undefined if the base64 data is missing.
    if (!base64) return undefined;

    // Generate a short, stable filename using hash.
    const key = hashString(song.id || song.uri || song.title || 'artwork');
    const fileName = `cover_${key}.${ext}`;
    // Use Expo's internal cache directory (accessible by MediaSession).
    const cacheDir = FileSystem.cacheDirectory ?? 'file:///data/user/0/com.yourapp/cache/';
    const filePath = `${cacheDir}${fileName}`;
    
    // Check if the cached file already exists.
    const info = await FileSystem.getInfoAsync(filePath);
    // Write base64 artwork to cache directory if it doesn't exist.
    if (!info.exists) {
      await FileSystem.writeAsStringAsync(filePath, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    // Return the file URI directly (points to /data/user/0/com.app/cache/).
    return filePath;
  } catch (e) {
    console.error('resolveArtworkUri FAILED:', e);
    return undefined;
  }
}

// Converts a Song instance to a Track Player track object format.
async function toTrack(song, includeArtwork = true) {
  const artwork = includeArtwork ? await resolveArtworkUri(song) : undefined;
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

// Updates an existing track's metadata in Track Player, including artwork and title.
// This refreshes the notification display when metadata becomes available.
async function updateTrackMetadata(song) {
  try {
    // Skip if the song lacks an ID.
    if (!song?.id) return;
    // Skip if the API method is not available (older Track Player versions).
    if (typeof TrackPlayer.updateMetadataForTrack !== 'function') return;

    // Resolve artwork to a file or content URI.
    const artwork = await resolveArtworkUri(song);
    const queue = await TrackPlayer.getQueue();
    const index = queue.findIndex(track => String(track.id) === String(song.id));

    if (index < 0) return;

    // Update the track with new metadata.
    await TrackPlayer.updateMetadataForTrack(index, {
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork,
    });
  } catch (error) {
    console.error('updateTrackMetadata error:', error);
  }
}

// Ensures the Track Player is initialized and ready for playback.
// Prevents duplicate initialization by using a shared promise.
async function ensurePlayer() {
  // Return immediately if player is already ready.
  if (playerReady) return;

  // Set up the player only once using a shared promise.
  if (!playerInitPromise) {
    playerInitPromise = (async () => {
      try {
        // Initialize the Track Player.
        await TrackPlayer.setupPlayer();
      } catch (error) {
        // Ignore "already initialized" errors; other errors are re-thrown.
        const message = String(error?.message || error || '');
        if (!message.toLowerCase().includes('already been initialized')) {
          throw error;
        }
      }

      // Configure player capabilities for notifications and controls.
      await TrackPlayer.updateOptions({
        // Full set of controls available in expanded notification.
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          
        ],
        // Simplified controls for compact notification view.
        compactCapabilities: [Capability.Play, Capability.Pause, Capability.Stop],
        // Update progress bar every 1 second.
        progressUpdateEventInterval: 1,
      });

      // Mark player as ready.
      playerReady = true;
    })().finally(() => {
      // Clear the init promise after completion.
      playerInitPromise = null;
    });
  }

  // Wait for the initialization to complete.
  await playerInitPromise;
}

// Binds global Track Player event listeners for playback state, progress, and track changes.
function bindGlobalListeners() {
  // Skip if listeners are already bound.
  if (listenersBound) return;

  // Listen for play/pause state changes.
  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    if (!activeSongId) return;
    const song = songRegistry.get(activeSongId);
    if (song) {
      // Update the song's playback state.
      song.isPlaying = state === State.Playing;
      // Notify UI listeners of the change.
      notifyActiveSongChange(activeSongId, song.isPlaying);
    }
  });

  // Listen for playback progress updates.
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
    if (!activeSongId) return;
    const song = songRegistry.get(activeSongId);
    if (!song) return;

    // Cache duration if just received from the track.
    if (duration && !song.duration) {
      song.duration = duration;
    }
    // Invoke progress callback if set.
    if (song.onProgress) {
      song.onProgress(position || 0, duration || song.duration || 0);
    }
    // Notify UI with current position and duration.
    notifyActiveSongChange(activeSongId, song.isPlaying, position || 0, duration || song.duration || 0);
  });

  // Listen for when the current track ends.
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    if (!activeSongId) return;

    const song = songRegistry.get(activeSongId);
    if (!song) return;

    // Mark song as stopped.
    song.isPlaying = false;
    // Invoke end callback if set.
    if (song.onEnded) song.onEnded(song);
    // Notify UI that playback ended.
    notifyActiveSongChange(activeSongId, false);
  });

  // Listen for when a different track becomes active (e.g., skip, notification click).
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
    if (!track?.id) return;

    // Update the active song ID.
    activeSongId = String(track.id);
    // Mark all other songs as not playing.
    for (const [id, song] of songRegistry.entries()) {
      if (id !== activeSongId) {
        song.isPlaying = false;
      }
    }

    const activeSong = songRegistry.get(activeSongId);
    if (activeSong) {
      activeSong.isPlaying = true;
      updateTrackMetadata(activeSong).catch(() => {});
      notifyActiveSongChange(activeSongId, true, 0, activeSong.duration || 0);
      return;
    }

    // Notify UI of the track change.
    notifyActiveSongChange(activeSongId, true);
  });

  // Mark listeners as bound to avoid re-binding.
  listenersBound = true;
}

// Main Song class: represents a single audio track with playback controls.
export default class Song {
  // Registers a listener for active song changes and returns an unsubscribe function.
  static onActiveSongChange(listener) {
    activeSongListeners.add(listener);
    return () => activeSongListeners.delete(listener);
  }

  // Returns a registered Song instance by ID.
  static getSongById(id) {
    return songRegistry.get(String(id)) || null;
  }

  // Static wrapper to update an existing track's metadata in the player.
  static async updateTrackMetadata(song) {
    await updateTrackMetadata(song);
  }

  // --- Constructor ---
  constructor({ id, title, artist, album, duration, uri, cover }) {
    // Unique identifier for the song.
    this.id = id;
    // Display title with fallback to 'unknown title'.
    this.title = title || 'unkwown title';
    // Artist name with fallback.
    this.artist = artist || 'unknown artist';
    // Album name with fallback.
    this.album = album || 'unknown album';
    // Duration in seconds, defaults to 0.
    this.duration = duration || 0;
    // Cover artwork URI (data URI, file URI, or HTTP URL).
    this.cover = cover || null;
    // File or stream URI for playback.
    this.uri = uri;

    // Sound object (not currently used with Track Player, kept for compatibility).
    this.sound = null;
    // Whether the song is currently playing.
    this.isPlaying = false;

    // Callback invoked when playback progress updates.
    this.onProgress = null;
    // Callback invoked when the song ends.
    this.onEnded = null;
    // Interval ID for progress tracking (if needed).
    this._progressInterval = null;

    // Register this song instance in the global registry.
    songRegistry.set(this.id, this);
    songRegistryVersion += 1;
    cachedPlayableSongs = null;
    cachedPlayableIndexById = new Map();
  }

  // --- Getter Methods ---
  // Returns the song's unique identifier.
  getId() { return this.id; }
  // Returns the song's title.
  getTitle() { return this.title; }
  // Returns the artist name.
  getArtist() { return this.artist; }
  // Returns the album name.
  getAlbum() { return this.album; }
  // Returns the duration in seconds.
  getDuration() { return this.duration; }
  // Returns the playback URI.
  getUri() { return this.uri; }
  // Returns the cover artwork URI.
  getCover() { return this.cover; }

  // --- Setter Methods ---
  // Updates the song's title.
  setTitle(title) { this.title = title; }
  // Updates the artist name.
  setArtist(artist) { this.artist = artist; }
  // Updates the album name.
  setAlbum(album) { this.album = album; }
  // Updates the duration in seconds.
  setDuration(duration) { this.duration = duration; }
  // Updates the cover artwork URI.
  setCover(cover) { this.cover = cover; }

  // --- Playback Controls ---
  // Initializes the player and binds event listeners.
  async load() {
    try {
      // Ensure Track Player is ready.
      await ensurePlayer();
      // Bind global event listeners.
      bindGlobalListeners();
    } catch (error) {
      console.error('Sound load error:', error);
    }
  }

  // Plays this song; if already active, resumes playback.
  async play() {
    try {
      // Ensure player is initialized.
      await ensurePlayer();
      // Ensure listeners are bound.
      bindGlobalListeners();

      // If this song is already active, just resume playback.
      if (activeSongId === this.id) {
        await TrackPlayer.play();
        this.isPlaying = true;
        return;
      }
       

      // Stop the previously active song.
      const previousSong = activeSongId ? songRegistry.get(activeSongId) : null;
      if (previousSong) previousSong.isPlaying = false;

      // Get cached playable songs and this song's queue index.
      const { songs, targetIndex } = getPlayableSongInfo(this.id);

      
      // If this song is not in the registry, add it as a standalone track.
      if (targetIndex < 0) {
        await TrackPlayer.reset();
        await TrackPlayer.add(await toTrack(this, true));
      } else {
        await ensurePlayableQueue(songs);
        await TrackPlayer.skip(targetIndex);
      }

      // Start playback.
      await TrackPlayer.play();

      // Update the active song.
      activeSongId = this.id;
      this.isPlaying = true;

      // Refresh notification metadata after playback starts so cover art and
      // labels appear without blocking the initial tap-to-play path.
      Song.updateTrackMetadata(this).catch(error => console.error('updateTrackMetadata failed:', error));
    } catch (error) {
      console.error('Error en play():', error);
    }
  }

  // Pauses playback if this song is currently active.
  async pause() {
    try {
      // Only pause if this is the active song.
      if (activeSongId !== this.id) return;
      await TrackPlayer.pause();
      this.isPlaying = false;
    } catch (error) {
      console.error('Error en pause():', error);
    }
  }

  // Toggles between play and pause; plays this song if it's not active.
  async togglePlayPause() {
    try {
      // Ensure player is initialized.
      await ensurePlayer();

      // If this song is not active, play it.
      if (activeSongId !== this.id) {
        await this.play();
        return;
      }

      // Get the current playback state.
      const playbackState = await TrackPlayer.getPlaybackState();
      const state = extractState(playbackState);
      // Toggle between play and pause.
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

  // Stops playback if this song is currently active.
  async stop() {
    try {
      // If this song is not active, just mark it as not playing.
      if (activeSongId !== this.id) {
        this.isPlaying = false;
        return;
      }

      // Clear the active song ID.
      activeSongId = null;
      this.isPlaying = false;
      // Stop the Track Player.
      await TrackPlayer.stop();
      // Notify listeners that nothing is playing.
      notifyActiveSongChange(null, false);
    } catch {
      this.isPlaying = false;
    }
  }

  // Seeks to a specific position in seconds if this song is active.
  async seek(seconds) {
    try {
      // Only seek if this is the active song.
      if (activeSongId !== this.id) return;
      // Move playback to the specified time.
      await TrackPlayer.seekTo(seconds);
    } catch (error) {
      console.error('Error en seek():', error);
    }
  }

  // --- Duration Formatting ---
  // Returns the duration as a formatted string (mm:ss).
  getFormattedDuration() {
    // Convert total seconds to minutes.
    const minutes = Math.floor(this.duration / 60);
    // Get remaining seconds.
    const seconds = Math.floor(this.duration % 60);
    // Format with leading zero for seconds if needed.
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  // --- Event Callback Setters ---
  // Registers a callback to be invoked during playback progress updates.
  setOnProgress(callback) { this.onProgress = callback; }
  // Registers a callback to be invoked when the song ends.
  setOnEnded(callback) { this.onEnded = callback; }

  // --- Cleanup ---
  // Stops playback if active and cleans up resources.
  async unload() {
    // Mark as not playing.
    this.isPlaying = false;
    // Stop the track if it's currently active.
    if (activeSongId === this.id) {
      await this.stop();
    }
  }
}