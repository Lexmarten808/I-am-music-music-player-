// High-level service for loading and scanning the music library.
import DatabaseManager from '../classes/DatabaseManager';
import SongManager from '../classes/SongManager';
import Song from '../classes/Song';

let dbInstance = null;
let songManagerInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseManager();
  }
  return dbInstance;
}

function getSongManager() {
  if (!songManagerInstance) {
    songManagerInstance = new SongManager(getDb());
  }
  return songManagerInstance;
}

function toSongInstance(song) {
  if (!song) return null;
  if (song instanceof Song) return song;
  return new Song(song);
}

const songLibraryService = {
  async scanFolder(folderUri, onUpdate) {
    const songs = await getSongManager().scanFolder(folderUri, onUpdate);
    return Array.isArray(songs) ? songs.map(toSongInstance).filter(Boolean) : [];
  },

  async loadFromCache(onUpdate) {
    const songs = await getSongManager().loadFromCache(onUpdate);
    return Array.isArray(songs) ? songs.map(toSongInstance).filter(Boolean) : [];
  },

  async getAllSongs() {
    const songs = await getDb().getAllSongs();
    return Array.isArray(songs) ? songs.map(toSongInstance).filter(Boolean) : [];
  },

  async getSongById(id) {
    const song = await getDb().getSongById(id);
    return toSongInstance(song);
  },

  async saveSong(song) {
    return getDb().saveSong(song);
  },

  async loadCoverOnDemand(song) {
    const songInstance = typeof song === 'string' ? await this.getSongById(song) : toSongInstance(song);
    if (!songInstance) return null;
    return getSongManager().loadCoverOnDemand(songInstance);
  },

  getDb,
  getSongManager,
};

export default songLibraryService;
