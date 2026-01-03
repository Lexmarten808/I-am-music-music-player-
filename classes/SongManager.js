import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import Song from './Song';

export default class SongManager {
  constructor(dbManager) {
    this.db = dbManager;
    this.queuedSongs = [];
  }
  

  // quick scan of a folder to find audio files
  async scanFolder(folderUri, onUpdate) {
    
    try {
      // We use SAF to get the list of files (most compatible on Android)
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
      const audioFiles = files.filter(f => f.toLowerCase().endsWith('.mp3')|| f.toLowerCase().endsWith('.wav'));

      if (audioFiles.length === 0) {
        throw new Error("No audio files found in " + folderUri);
      }
      
      // 1. Quick mapping: file names so the user sees something immediately
      const songs = audioFiles.map(uri => {
        const rawName = uri.split('%2F').pop();
        const name = decodeURIComponent(rawName).replace(/\.mp3$/i, '')|| decodeURIComponent(rawName).replace(/\.wav$/i, '');
        return new Song({ 
          id: uri, 
          title: name, 
          artist: 'Loading...', 
          uri: uri 
        });
      });

      // Keep a reference to the list and the update callback so we can force
      // UI updates when individual metadata items finish.
      this.allSongs = songs;
      this._onUpdate = onUpdate;

      // 2. Start the heavy process in the background
      this.processMetadatosEnLotes(songs, onUpdate);

      return songs;
    } catch (e) {
      console.error("Error en scanFolder:", e);
      return [];
    }
  }

  
async getTags(uri, fileName) {
  try {
    // Read only the first 64 KB
    const CHUNK_SIZE = 256 * 1024;

    const base64Chunk = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      length: CHUNK_SIZE,
      position: 0
    });

    const byteArray = Array.from(Buffer.from(base64Chunk, 'base64'));

    return await new Promise((resolve) => {
      jsmediatags.read(byteArray, {
        onSuccess: (tag) => {
          let cover = null;

          if (tag.tags?.picture) {
            const { data, format } = tag.tags.picture;
            cover = `data:${format};base64,${Buffer.from(data).toString('base64')}`;
          }

          resolve({
            title: tag.tags?.title || fileName,
            artist: tag.tags?.artist || "Unknown Artist",
            album: tag.tags?.album || "Unknown Album",
            cover
          });
        },
        onError: () => {
          resolve({
            title: fileName,
            artist: "Unknown Artist",
            album: "Unknown Album",
            cover: null
          });
        }
      });
    });
  } catch {
    return {
      title: fileName,
      artist: "Unknown Artist",
      album: "Unknown Album",
      cover: null
    };
  }
}

  // the list updates slowly, so we process them in batches
  async processMetadatosEnLotes(songs, onUpdate) {
    for (let i = 0; i < songs.length; i++) {   
      const meta = await this.getTags(songs[i].uri, songs[i].title);

      // Update the in-memory list item (create new ref so React notices)
      const updated = new Song({ id: songs[i].id || songs[i].uri, title: meta.title, artist: meta.artist, album: meta.album, uri: songs[i].uri, duration: songs[i].duration, cover: meta.cover });
      songs[i] = updated;
      if (this.allSongs && Array.isArray(this.allSongs)) {
        const idx = this.allSongs.findIndex(s => s.id === updated.id);
        if (idx >= 0) this.allSongs[idx] = updated;
      }

      // Save metadata (note: DatabaseManager is not storing cover)
      if (this.db) {
        this.db.saveSong(updated).catch(e => console.log("Error guardando:", e));
      }

      // Force UI update immediately for this item
      if (this._onUpdate) this._onUpdate([...this.allSongs]);
    }
  }
  
}