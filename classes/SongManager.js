import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import Song from './Song';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_FOLDER_KEY = 'last_music_folder';


const START_CHUNK = 128 * 1024; // amount to read from start
const END_CHUNK   = 256 * 1024; // amount to read from end
const CONCURRENCY = 4;          // Android safe
const SAF = FileSystem.StorageAccessFramework || LegacyFileSystem.StorageAccessFramework;
const FS = SAF === LegacyFileSystem.StorageAccessFramework ? LegacyFileSystem : FileSystem;



export default class SongManager {
  constructor(dbManager) {
    this.db = dbManager;
    this.allSongs = [];
    this._onUpdate = null;
    this._metadataCache = new Map(); // In-memory cache for fast lookups
    this._isScanning = false;
    this._scanToken = 0;
    this._lastUiUpdateAt = 0;
    
    //callbacks
    this._onSongChange = null;
  }

  /* =========================
     SCAN FOLDER (FAST)
  ========================== */
  async scanFolder(folderUri, onUpdate) {
    try {
      if (!SAF?.readDirectoryAsync) {
        throw new Error('StorageAccessFramework is not available in this runtime');
      }
      this._metadataCache.clear();
      this._isScanning = true;
      const scanToken = ++this._scanToken;
      // save the last folder
      await AsyncStorage.setItem(LAST_FOLDER_KEY, folderUri);
      //reads the directory
      const files = await SAF.readDirectoryAsync(folderUri);
      //filter audio files (only reads mp3 and wav for now)
      const audioFiles = files.filter(
        f => f.toLowerCase().endsWith('.mp3') || f.toLowerCase().endsWith('.wav')
      );
      // in case no audio files found
      if (!audioFiles.length) throw new Error('No audio files');

      const songs = audioFiles.map(uri => {
        const raw = uri.split('%2F').pop();
        //remove the extencion from the name
        const name = decodeURIComponent(raw).replace(/\.(mp3|wav|Y2meta|.app)$/i, '');
        return new Song({
          id: uri,
          title: name,
          artist: 'Loading...',
          uri
        });
      });
      // store all songs
      this.allSongs = songs;
      // reset current index
      this.currentIndex = 0;
      // store the onUpdate callback
      this._onUpdate = onUpdate;
      this._onUpdate?.([...this.allSongs]);

      // background processing
      this.processMetadatosEnLotes(songs, scanToken);

      return songs;
    } catch (e) {
      console.error('scanFolder error:', e);
      return [];
    }
  }

  /* =========================
     TAG HELPERS
  ========================== */
  isMetaIncomplete(meta) {
    return (
      !meta ||
      !meta.artist ||
      meta.artist === 'Unknown Artist' ||
      !meta.cover
    );
  }

  _notifyUpdate(force = false) {
    if (!this._onUpdate) return;
    const now = Date.now();
    if (!force && now - this._lastUiUpdateAt < 250) return;
    this._lastUiUpdateAt = now;
    this._onUpdate([...this.allSongs]);
  }

  async readChunk(uri, fileName, position, size) {
    try {
      // Try a partial read (some runtimes expose position/length),
      // but fall back to a full-file read if not supported.
      let base64;
      try {
        base64 = await FS.readAsStringAsync(uri, {
          encoding: FS.EncodingType.Base64,
          length: size,
          position
        });
      } catch (err) {
        // Partial read not supported — read whole file as base64
        base64 = await FS.readAsStringAsync(uri, {
          encoding: FS.EncodingType.Base64
        });
      }

      const bytes = Array.from(Buffer.from(base64, 'base64'));

      return await new Promise(resolve => {
        jsmediatags.read(bytes, {
          onSuccess: tag => {
            let cover = null;
            if (tag.tags?.picture) {
              const { data, format } = tag.tags.picture;
              cover = `data:${format};base64,${Buffer.from(data).toString('base64')}`;
            }

            resolve({
              title: tag.tags?.title || fileName,
              artist: tag.tags?.artist || 'Unknown Artist',
              album: tag.tags?.album || 'Unknown Album',
              cover
            });
          },
          onError: () => resolve(null)
        });
      });
    } catch {
      return null;
    }
  }

  async readFromEnd(uri, fileName) {
    try {
      const info = await FS.getInfoAsync(uri);
      if (!info.size) return null;

      const pos = Math.max(0, info.size - END_CHUNK);
      return this.readChunk(uri, fileName, pos, END_CHUNK);
    } catch {
      return null;
    }
  }

  /* =========================
     SMART TAG READER
  ========================== */
  async getTags(uri, fileName) {
    // 1️ fast read (start) - this covers ~80% of cases
    const startMeta = await this.readChunk(uri, fileName, 0, START_CHUNK);
    if (startMeta && !this.isMetaIncomplete(startMeta)) return startMeta;

    // 2️ fallback (end) - only if start didn't have complete data
    const endMeta = await this.readFromEnd(uri, fileName);
    if (endMeta && !this.isMetaIncomplete(endMeta)) return endMeta;

    // 3️ merge best of both
    return {
      title: startMeta?.title || endMeta?.title || fileName,
      artist: startMeta?.artist || endMeta?.artist || 'Unknown Artist',
      album: startMeta?.album || endMeta?.album || 'Unknown Album',
      cover: startMeta?.cover || endMeta?.cover || null
    };
  }

  /* =========================
     CONCURRENT PROCESSING
  ========================== */
  async processMetadatosEnLotes(songs, scanToken = this._scanToken) {
    let index = 0;
    const token = scanToken;

    const worker = async () => {
      while (index < songs.length) {
        const i = index++;
        const song = songs[i];

        if (token !== this._scanToken) return;

        const meta = await this.getTags(song.uri, song.title);

        if (token !== this._scanToken) return;

        const merged = {
          title: meta?.title || song.title,
          artist: meta?.artist || song.artist || 'Unknown Artist',
          album: meta?.album || song.album || 'Unknown Album',
          cover: meta?.cover || song.cover || null
        };

        song.setTitle(merged.title);
        song.setArtist(merged.artist);
        song.setAlbum(merged.album);
        song.setCover(merged.cover);

        Song.updateTrackMetadata(song).catch(() => {}); // Update notification metadata if needed

        // Cache in memory for fast lookups
        this._metadataCache.set(song.id, merged);

        const payload = {
          id: song.id,
          title: merged.title,
          artist: merged.artist,
          album: merged.album,
          uri: song.uri,
          duration: song.duration,
          cover: merged.cover
        };

        this.db?.saveSong(payload).catch(() => {});
        this._notifyUpdate();
      }
    };

    try {
      await Promise.all(
        Array.from({ length: CONCURRENCY }, worker)
      );
    } finally {
      if (token === this._scanToken) {
        this._isScanning = false;
        this._notifyUpdate(true);
      }
    }
  }

  async loadFromCache(onUpdate) {
  const cached = await this.db.getAllSongs();
  if (cached && cached.length) {
    this.allSongs = cached.map(s => new Song(s));
    onUpdate?.([...this.allSongs]);
    return this.allSongs;
  }
  return [];
}

//ui listeners
setOnSongChange(callback) {
  this._onSongChange = callback;
}


async loadCoverOnDemand(song) {
  try {
    // 1. Check in-memory cache first (fastest)
    if (this._metadataCache.has(song.id)) {
      const cached = this._metadataCache.get(song.id);
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

    // 2. Check DB for previously processed songs (fast if ready)
    if (!this._isScanning) {
      const dbCached = await this.db.getSongById(song.id);
      if (dbCached && dbCached.artist && dbCached.artist !== 'Loading...') {
        // Cache it in memory too
        this._metadataCache.set(song.id, {
          title: dbCached.title,
          artist: dbCached.artist,
          album: dbCached.album,
          cover: dbCached.cover
        });
        return dbCached;
      }
    }

    // 3. Read tags from file (only if not cached)
    const meta = await this.getTags(song.uri, song.title);

    const merged = {
      title: meta?.title || song.title,
      artist: meta?.artist || song.artist || 'Unknown Artist',
      album: meta?.album || song.album || 'Unknown Album',
      cover: meta?.cover || song.cover || null
    };

    song.setTitle(merged.title);
    song.setArtist(merged.artist);
    song.setAlbum(merged.album);
    song.setCover(merged.cover);

    const result = {
      id: song.id,
      title: merged.title,
      artist: merged.artist,
      album: merged.album,
      uri: song.uri,
      cover: merged.cover 
    };

    // 4. Cache in memory
    this._metadataCache.set(song.id, merged);

    Song.updateTrackMetadata(song).catch(() => {}); // Update notification metadata if needed

    // 5. Save to DB without blocking
    this.db?.saveSong(result).catch(() => {});

    return result;
  } catch (e) {
    console.warn("Error en loadCoverOnDemand:", e);
    return null;
  }
}

}

