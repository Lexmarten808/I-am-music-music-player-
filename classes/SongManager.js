import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';
import Song from './Song';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_FOLDER_KEY = 'last_music_folder';


const START_CHUNK = 128 * 1024; // rápido
const END_CHUNK   = 256 * 1024; // fallback seguro
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
      // save the last folder
      await AsyncStorage.setItem(LAST_FOLDER_KEY, folderUri);
      //reads the directory
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
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

      // background processing
      this.processMetadatosEnLotes(songs);

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

  async readChunk(uri, fileName, position, size) {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        length: size,
        position
      });

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
      const info = await FileSystem.getInfoAsync(uri);
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
    // 1️⃣ fast read (start)
    const startMeta = await this.readChunk(uri, fileName, 0, START_CHUNK);
    if (startMeta && !this.isMetaIncomplete(startMeta)) return startMeta;

    // 2️⃣ fallback (end)
    const endMeta = await this.readFromEnd(uri, fileName);
    if (endMeta && !this.isMetaIncomplete(endMeta)) return endMeta;

    // 3️⃣ merge best of both
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
  async processMetadatosEnLotes(songs) {
    let index = 0;

    const worker = async () => {
      while (index < songs.length) {
        const i = index++;
        const song = songs[i];

        const meta = await this.getTags(song.uri, song.title);

        song.setTitle(meta.title);
        song.setArtist(meta.artist);
        song.setAlbum(meta.album);
        song.setCover(meta.cover);

        this.db?.saveSong(song).catch(() => {});
      }
    };

    await Promise.all(
      Array.from({ length: CONCURRENCY }, worker)
    );

    // 🔥 single UI update
    this._onUpdate?.([...this.allSongs]);
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




}

