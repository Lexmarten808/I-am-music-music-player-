import { getAll } from 'react-native-get-music-files';
import Song from './Song';

export default class SongManager {
  constructor(db) {
    this.db = db;
    this.allSongs = [];
  }

  async scanFolder(_, onUpdate) {
    try {
      const response = await getAll({
        id: true,
        artist: true,
        album: true,
        title: true,
        duration: true,
        cover: true,
        path: true,
        minimumSongDuration: 1000,
      });

      const songsArray = response?.results || [];

      const mapped = songsArray.map(s => new Song({
        id: String(s.id),
        title: s.title || 'Unknown Title',
        artist: s.artist || 'Unknown Artist',
        album: s.album || 'Unknown Album',
        uri: s.path,
        duration: s.duration || 0,
        cover: s.cover ? `file://${s.cover}` : null,
      }));

      this.allSongs = mapped;
      onUpdate([...mapped]);

      // save to DB async
      mapped.forEach(song => {
        this.db?.saveSong(song).catch(() => {});
      });

      return mapped;
    } catch (e) {
      console.error('Music scan failed:', e);
      return [];
    }
  }

  async loadCoverOnDemand(song) {
    return song; // already loaded by MediaStore
  }
}
