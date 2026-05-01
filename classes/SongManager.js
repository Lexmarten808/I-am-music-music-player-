// Buffer polyfill for base64 encoding/decoding in metadata extraction.
import { Buffer } from 'buffer';
// Modern FileSystem API for file operations.
import * as FileSystem from 'expo-file-system';
// Legacy FileSystem API for broader runtime compatibility.
import * as LegacyFileSystem from 'expo-file-system/legacy';
// ID3 tag parser for extracting metadata from MP3/WAV files.
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
// Song class for creating song instances.
import Song from './Song';
// Persistent storage for remembering the last selected folder.
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage key for persisting the last selected folder URI.
const LAST_FOLDER_KEY = 'last_music_folder';

// Metadata chunk sizes for efficient tag reading.
// 128 KB from the start of the file (covers most ID3v2 tags).
const START_CHUNK = 128 * 1024;
// 256 KB from the end of the file (fallback for ID3v1 or large artwork).
const END_CHUNK   = 256 * 1024;
// Number of concurrent workers for metadata extraction (Android safe limit).
const CONCURRENCY = 4;
// Storage Access Framework API with fallback to legacy version for compatibility.
const SAF = FileSystem.StorageAccessFramework || LegacyFileSystem.StorageAccessFramework;
// FileSystem API, preferring modern version if SAF is from modern FileSystem.
const FS = SAF === LegacyFileSystem.StorageAccessFramework ? LegacyFileSystem : FileSystem;



// Main class for managing song library: scanning folders, extracting metadata, and caching.
export default class SongManager {
  // --- Constructor ---
  constructor(dbManager) {
    // Database manager for persisting song metadata.
    this.db = dbManager;
    // Array of all songs discovered in the current folder scan.
    this.allSongs = [];
    // Callback function invoked when the song list updates (for UI refresh).
    this._onUpdate = null;
    // In-memory cache mapping song IDs to their metadata for fast lookups.
    this._metadataCache = new Map();
    // Flag indicating whether a scan is currently in progress.
    this._isScanning = false;
    // Token to invalidate stale scans if a new scan starts.
    this._scanToken = 0;
    // Timestamp of the last UI update (throttles frequent updates).
    this._lastUiUpdateAt = 0;
    // Callback for song change events.
    this._onSongChange = null;
  }

  // --- Folder Scanning ---
  // Fast initial scan: reads directory structure, filters audio files, and starts background metadata extraction.
  async scanFolder(folderUri, onUpdate) {
    try {
      // Check if StorageAccessFramework is available.
      if (!SAF?.readDirectoryAsync) {
        throw new Error('StorageAccessFramework is not available in this runtime');
      }
      // Clear old cached metadata to start fresh.
      this._metadataCache.clear();
      // Mark scanning as in progress.
      this._isScanning = true;
      // Increment scan token to invalidate any stale background jobs.
      const scanToken = ++this._scanToken;
      // Save the folder URI for auto-load on next app launch.
      await AsyncStorage.setItem(LAST_FOLDER_KEY, folderUri);
      // Read all files and folders in the selected directory.
      const files = await SAF.readDirectoryAsync(folderUri);
      // Filter to only MP3 and WAV audio files.
      const audioFiles = files.filter(
        f => f.toLowerCase().endsWith('.mp3') || f.toLowerCase().endsWith('.wav')
      );
      // If no audio files found, throw an error.
      if (!audioFiles.length) throw new Error('No audio files');

      // Create Song instances from audio file URIs with placeholder metadata.
      const songs = audioFiles.map(uri => {
        // Extract filename from the URI (split by encoded forward slash).
        const raw = uri.split('%2F').pop();
        // Decode filename and remove file extension.
        const name = decodeURIComponent(raw).replace(/\.(mp3|wav|Y2meta|.app)$/i, '');
        // Create Song object with initial placeholder data.
        return new Song({
          id: uri,
          title: name,
          artist: 'Loading...',
          uri
        });
      });
      // Store all songs in the instance.
      this.allSongs = songs;
      // Reset current playback index.
      this.currentIndex = 0;
      // Store the UI update callback for later notifications.
      this._onUpdate = onUpdate;
      // Notify UI with the initial song list (songs will have "Loading..." as artist initially).
      this._onUpdate?.([...this.allSongs]);

      // Start background metadata extraction in parallel workers.
      this.processMetadatosEnLotes(songs, scanToken);

      return songs;
    } catch (e) {
      // Log errors and return empty list if scan fails.
      console.error('scanFolder error:', e);
      return [];
    }
  }

  // --- Metadata Validation ---
  // Checks if metadata is incomplete and needs fallback or re-reading.
  isMetaIncomplete(meta) {
    // Metadata is incomplete if it lacks artist or cover art, or has default fallback values.
    return (
      !meta ||
      !meta.artist ||
      meta.artist === 'Unknown Artist' ||
      !meta.cover
    );
  }
  // --- UI Update Throttling ---
  // Throttles UI updates to avoid excessive re-renders; allows forcing immediate update.
  _notifyUpdate(force = false) {
    // Skip if no update callback is set.
    if (!this._onUpdate) return;
    // Get current timestamp.
    const now = Date.now();
    // If not forced and within throttle window (250ms), skip update.
    if (!force && now - this._lastUiUpdateAt < 250) return;
    // Update timestamp for next throttle check.
    this._lastUiUpdateAt = now;
    // Invoke callback with a shallow copy of the songs array.
    this._onUpdate([...this.allSongs]);
  }
  // --- Metadata Extraction from Files ---
  // Reads metadata (title, artist, album, cover) from a chunk of a file.
  async readChunk(uri, fileName, position, size) {
    try {
      // Attempt to read a file chunk; fall back to full-file read if partial reads aren't supported.
      let base64;
      try {
        // Try partial read starting at position for the given size.
        base64 = await FS.readAsStringAsync(uri, {
          encoding: FS.EncodingType.Base64,
          length: size,
          position
        });
      } catch (err) {
        // Partial read not supported on this runtime; read entire file as base64.
        base64 = await FS.readAsStringAsync(uri, {
          encoding: FS.EncodingType.Base64
        });
      }

      // Convert base64 string to byte array for jsmediatags.
      const bytes = Array.from(Buffer.from(base64, 'base64'));

      // Parse ID3 tags from the bytes.
      return await new Promise(resolve => {
        jsmediatags.read(bytes, {
          onSuccess: tag => {
            // Extract cover art if available.
            let cover = null;
            if (tag.tags?.picture) {
              const { data, format } = tag.tags.picture;
              // Convert binary picture data to a data URI for Track Player.
              cover = `data:${format};base64,${Buffer.from(data).toString('base64')}`;
            }

            // Return extracted metadata with fallbacks to filename if tags are missing.
            resolve({
              title: tag.tags?.title || fileName,
              artist: tag.tags?.artist || 'Unknown Artist',
              album: tag.tags?.album || 'Unknown Album',
              cover
            });
          },
          // Return null on parse error; will trigger fallback strategies.
          onError: () => resolve(null)
        });
      });
    } catch {
      // Return null on any file read or parsing error.
      return null;
    }
  }

  // Reads metadata from the end of a file (fallback for ID3v1 or large artwork tags).
  async readFromEnd(uri, fileName) {
    try {
      // Get file size to determine start position for end chunk.
      const info = await FS.getInfoAsync(uri);
      if (!info.size) return null;

      // Calculate start position: file end minus END_CHUNK size, but not negative.
      const pos = Math.max(0, info.size - END_CHUNK);
      // Read chunk starting at this position.
      return this.readChunk(uri, fileName, pos, END_CHUNK);
    } catch {
      // Return null on any error.
      return null;
    }
  }

  // --- Smart Metadata Reading ---
  // Intelligent tag reading: tries start chunk first, falls back to end, then merges results.
  async getTags(uri, fileName) {
    // Step 1: Try reading from the start (covers ~80% of cases with ID3v2).
    const startMeta = await this.readChunk(uri, fileName, 0, START_CHUNK);
    // If start has complete metadata, return it immediately.
    if (startMeta && !this.isMetaIncomplete(startMeta)) return startMeta;

    // Step 2: Try reading from the end as fallback (ID3v1 or large artwork).
    const endMeta = await this.readFromEnd(uri, fileName);
    // If end has complete metadata, return it.
    if (endMeta && !this.isMetaIncomplete(endMeta)) return endMeta;

    // Step 3: Merge the best data from both attempts, preferring start chunk.
    return {
      title: startMeta?.title || endMeta?.title || fileName,
      artist: startMeta?.artist || endMeta?.artist || 'Unknown Artist',
      album: startMeta?.album || endMeta?.album || 'Unknown Album',
      cover: startMeta?.cover || endMeta?.cover || null
    };
  }

  // --- Concurrent Metadata Processing ---
  // Processes metadata for all songs using multiple workers; updates UI progressively and saves to DB.
  async processMetadatosEnLotes(songs, scanToken = this._scanToken) {
    // Shared index for work distribution among workers.
    let index = 0;
    // Capture scan token to invalidate stale jobs if a new scan starts.
    const token = scanToken;

    // Worker function: processes songs concurrently.
    const worker = async () => {
      // Keep processing songs until the queue is empty.
      while (index < songs.length) {
        // Atomic increment-and-get to avoid duplicate processing.
        const i = index++;
        const song = songs[i];

        // If a new scan has started, stop this worker to avoid stale processing.
        if (token !== this._scanToken) return;

        // Extract metadata from the audio file.
        const meta = await this.getTags(song.uri, song.title);

        // Check again if the scan is still valid.
        if (token !== this._scanToken) return;

        // Merge extracted metadata with fallbacks to original song data.
        const merged = {
          title: meta?.title || song.title,
          artist: meta?.artist || song.artist || 'Unknown Artist',
          album: meta?.album || song.album || 'Unknown Album',
          cover: meta?.cover || song.cover || null
        };

        // Update the Song object with extracted metadata.
        song.setTitle(merged.title);
        song.setArtist(merged.artist);
        song.setAlbum(merged.album);
        song.setCover(merged.cover);

        // Update Track Player notification if this song is currently playing.
        Song.updateTrackMetadata(song).catch(() => {});

        // Cache metadata in memory for fast subsequent lookups.
        this._metadataCache.set(song.id, merged);

        // Prepare payload for database persistence.
        const payload = {
          id: song.id,
          title: merged.title,
          artist: merged.artist,
          album: merged.album,
          uri: song.uri,
          duration: song.duration,
          cover: merged.cover
        };

        // Save to database asynchronously without blocking worker.
        this.db?.saveSong(payload).catch(() => {});
        // Update UI with progress.
        this._notifyUpdate();
      }
    };

    try {
      // Start CONCURRENCY number of workers processing in parallel.
      await Promise.all(
        Array.from({ length: CONCURRENCY }, worker)
      );
    } finally {
      // Clean up after all workers complete (even if scan was cancelled).
      if (token === this._scanToken) {
        // Mark scan as complete.
        this._isScanning = false;
        // Force final UI update.
        this._notifyUpdate(true);
      }
    }
  }

  // --- Cache Loading ---
  // Loads previously scanned songs from the database.
  async loadFromCache(onUpdate) {
    // Retrieve all songs from the database.
    const cached = await this.db.getAllSongs();
    // If songs found, convert them to Song instances and notify UI.
    if (cached && cached.length) {
      this.allSongs = cached.map(s => new Song(s));
      onUpdate?.([...this.allSongs]);
      return this.allSongs;
    }
    // Return empty array if no cached songs.
    return [];
  }

  // --- Event Listeners ---
  // Registers a callback for song change events.
  setOnSongChange(callback) {
    this._onSongChange = callback;
  }

  // --- On-Demand Metadata Loading ---
  // Loads metadata for a single song (useful for UI list scrolling).
  // Uses multi-tier caching: memory → DB → file extraction.
  async loadCoverOnDemand(song) {
    try {
      // Tier 1: Check in-memory cache first (fastest, <1ms).\
      if (this._metadataCache.has(song.id)) {
        const cached = this._metadataCache.get(song.id);
        // Return if cached and not a placeholder.
        if (cached && cached.artist !== 'Loading...') {
          return {
            id: song.id,
            title: cached.title,
            artist: cached.artist,
            album: cached.album,
            uri: song.uri,
            cover: cached.cover
          };
        }
      }

      // Tier 2: Check database if not currently scanning (fast if DB is responsive).
      if (!this._isScanning) {
        const dbCached = await this.db.getSongById(song.id);
        if (dbCached && dbCached.artist && dbCached.artist !== 'Loading...') {
          // Populate memory cache for next lookup.
          this._metadataCache.set(song.id, {
            title: dbCached.title,
            artist: dbCached.artist,
            album: dbCached.album,
            cover: dbCached.cover
          });
          return dbCached;
        }
      }

      // Tier 3: Extract tags from file (slow, only when not in caches).
      const meta = await this.getTags(song.uri, song.title);

      // Merge extracted metadata with fallbacks.
      const merged = {
        title: meta?.title || song.title,
        artist: meta?.artist || song.artist || 'Unknown Artist',
        album: meta?.album || song.album || 'Unknown Album',
        cover: meta?.cover || song.cover || null
      };

      // Update Song object with new metadata.
      song.setTitle(merged.title);
      song.setArtist(merged.artist);
      song.setAlbum(merged.album);
      song.setCover(merged.cover);

      // Prepare payload for return and persistence.
      const result = {
        id: song.id,
        title: merged.title,
        artist: merged.artist,
        album: merged.album,
        uri: song.uri,
        cover: merged.cover 
      };

      // Tier 4: Cache in memory for next lookup.
      this._metadataCache.set(song.id, merged);

      // Note: Do NOT update Track Player notification from here.
      // Notification metadata should only update when the song becomes the active track.

      // Tier 5: Persist to database asynchronously (non-blocking).
      this.db?.saveSong(result).catch(() => {});

      return result;
    } catch (e) {
      // Log error and return null on failure.
      console.warn("Error en loadCoverOnDemand:", e);
      return null;
    }
  }

}

