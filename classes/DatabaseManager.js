import * as SQLite from 'expo-sqlite';

export default class DatabaseManager {
  constructor() {
    this.db = null;
    this.init();
  }

  async init() {
    try {
      // Abrimos la base de datos de forma asíncrona (más seguro en SDK 54)
      this.db = await SQLite.openDatabaseAsync('music_db.db');
      
      // Creamos la tabla si no existe
      await this.db.execAsync(`
        CREATE TABLE IF NOT EXISTS songs (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT,
          artist TEXT,
          album TEXT,
          uri TEXT,
          duration REAL,
          cover TEXT
        );
      `);
      console.log("Base de datos inicializada correctamente");
    } catch (error) {
      console.error("Error inicializando base de datos:", error);
    }
  }

  async saveSong(song) {
    if (!this.db) {
      console.log("Esperando a que la DB se inicie...");
      return;
    }
    
    try {
      await this.db.runAsync(
        'INSERT OR REPLACE INTO songs (id, title, artist, album, uri, duration, cover) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [song.id, song.title, song.artist, song.album, song.uri, song.duration, song.cover]
      );
    } catch (error) {
      console.error("Error al guardar canción:", error);
    }
  }

  async getAllSongs() {
    if (!this.db) return [];
    try {
      return await this.db.getAllAsync('SELECT * FROM songs');
    } catch (error) {
      console.error("Error al obtener canciones:", error);
      return [];
    }
  }
}