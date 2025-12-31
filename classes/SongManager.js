import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import Song from './Song';

export default class SongManager {
  constructor(dbManager) {
    this.db = dbManager;
  }

  // quick scan of a folder to find audio files
  async scanFolder(folderUri, onUpdate) {
    
    try {
      // We use SAF to get the list of files (most compatible on Android)
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
      const audioFiles = files.filter(f => f.toLowerCase().endsWith('.mp3'));
      
      // 1. Quick mapping: file names so the user sees something immediately
      const songs = audioFiles.map(uri => {
        const rawName = uri.split('%2F').pop();
        const name = decodeURIComponent(rawName).replace(/\.mp3$/i, '');
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
    // Force UI update immediately for this item
      try { if (this._onUpdate) this._onUpdate([...this.allSongs || songs]); } catch (e) { /* ignore */ }
    return new Promise(async (resolve) => {
      try {
        // Read the file as base64
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64
        });

        // Decode to bytes and pass a plain JS array so jsmediatags' ArrayFileReader
        // can detect it in React Native environments.
        const byteBuffer = Buffer.from(base64, 'base64');
        const byteArray = Array.from(byteBuffer);

        try {
          new jsmediatags.Reader(byteArray).read({
            onSuccess: (tag) => {
              let cover = null;
              if (tag.tags && tag.tags.picture) {
                const { data, format } = tag.tags.picture;
                const base64String = Buffer.from(data).toString('base64');
                cover = `data:${format};base64,${base64String}`;
              }

              // Return cover for in-memory UI use. We will not persist it in DB.
              resolve({
                title: tag.tags && tag.tags.title ? tag.tags.title : fileName,
                artist: tag.tags && tag.tags.artist ? tag.tags.artist : "Unknown Artist",
                album: tag.tags && tag.tags.album ? tag.tags.album : "Unknown Album",
                cover
              });
            },
            onError: (error) => {
              // If parsing fails asynchronously, return safe defaults.
              resolve({ title: fileName, artist: "Unknown Artist", album: "Unknown Album", cover: null });
            }
          });
        } catch (syncErr) {
          // jsmediatags may throw synchronously in some RN setups; handle gracefully.
          resolve({ title: fileName, artist: "Unknown Artist", album: "Unknown Album", cover: null });
        }
      } catch (e) {
        resolve({ title: fileName, artist: "Read Error", album: "Unknown Album", cover: null });
      }
    });
    
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
      try { if (this._onUpdate) this._onUpdate([...this.allSongs || songs]); } catch (e) { /* ignore */ }
    }
  }
  
}