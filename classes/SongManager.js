
import * as FileSystem from 'expo-file-system';
import Song from './Song';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_FOLDER_KEY = 'last_music_folder';


const START_CHUNK = 128 * 1024; // amount to read from start
const END_CHUNK   = 256 * 1024; // amount to read from end
const CONCURRENCY = 4;          // Android safe



export default class SongManager {
  constructor(dbManager) {
    this.db = dbManager;
    this.allSongs = [];
    this._onUpdate = null;


    
    //callbacks
    this._onSongChange = null;
  }

  /* =========================
     SCAN FOLDER (FAST)
  ========================== */
  async scanFolder(folderUri, onUpdate) {
    try {
      await AsyncStorage.setItem(LAST_FOLDER_KEY, folderUri);
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
      const audioFiles = files.filter(
        f => f.toLowerCase().endsWith('.mp3') || f.toLowerCase().endsWith('.wav')
      );
      if (!audioFiles.length) throw new Error('No audio files');

      const songs = audioFiles.map(uri => {
        const raw = uri.split('%2F').pop();
        const name = decodeURIComponent(raw).replace(/\.(mp3|wav|Y2meta|.app)$/i, '');
        
        // returns a compatible track object for Track Player
        return {
          id: uri,
          url: uri, // Track Player needs 'url' property
          title: name,
          artist: 'Loading...',
          cover: null,
          album: 'Unknown Album'
        };
      });

      this.allSongs = songs;
      this._onUpdate = onUpdate;
      this.processMetadatosEnLotes(songs);
      return songs;
    } catch (e) {
      console.error('scanFolder error:', e);
      return [];
    }
  }

  async processMetadatosEnLotes(songs) {
    let index = 0;
    const worker = async () => {
      while (index < songs.length) {
        const i = index++;
        const song = songs[i];

        // We use song.url because that's where we store the path
        const meta = await this.getTags(song.url, song.title);

        // Change: Modify the plain object directly
        song.title = meta.title;
        song.artist = meta.artist;
        song.album = meta.album;
        song.cover = meta.cover;

        this.db?.saveSong(song).catch(() => {});
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    this._onUpdate?.([...this.allSongs]);
  }

  async loadFromCache(onUpdate) {
    const cached = await this.db.getAllSongs();
    if (cached && cached.length) {
      // Change: Ensure they have the 'url' property
      this.allSongs = cached.map(s => ({
        ...s,
        url: s.uri || s.url // Safety mapping
      }));
      onUpdate?.([...this.allSongs]);
      return this.allSongs;
    }
    return [];
  }

  async loadCoverOnDemand(song) {
    try {
      const cached = await this.db.getSongById(song.id);
      if (cached && cached.artist !== 'Loading...') {
        return { ...cached, url: cached.uri || cached.url };
      }

      const meta = await this.getTags(song.url, song.title);
      
      const result = {
        id: song.id,
        url: song.url,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        cover: meta.cover 
      };

      this.db?.saveSong(result).catch(() => {});
      return result;
    } catch (e) {
      console.warn("Error en loadCoverOnDemand:", e);
      return null;
    }
  }
}