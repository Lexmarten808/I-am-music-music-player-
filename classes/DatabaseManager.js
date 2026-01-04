import * as SQLite from 'expo-sqlite';

async function openDatabase(databaseName) {
  if (typeof SQLite.openDatabaseAsync === 'function') {
    return await SQLite.openDatabaseAsync(databaseName);
  }
  if (typeof SQLite.openDatabase === 'function') {
    return SQLite.openDatabase(databaseName);
  }
  throw new Error('No compatible SQLite open function found');
}

export default class DatabaseManager {
  constructor() {
    this.db = null;
    this._useMemoryFallback = false;
    this._memorySongs = [];
    this._ready = this._init();
  }

  async _init() {
    try {
      this.db = await openDatabase('music_player.db');
    } catch (e) {
      console.error('SQLite open failed:', e);
      this._useMemoryFallback = true;
      return true;
    }

    const create = `CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      artist TEXT,
      album TEXT,
      uri TEXT,
      duration REAL,
      cover TEXT
    );`;

    // Try multiple ways to create the table. If the native driver blows up
    // (some versions throw a NullPointerException deep in prepareAsync),
    // fall back to an in-memory store so the app remains usable.
    try {
      try {
        // Prefer explicit transaction 
        await new Promise((res, rej) => this.db.transaction(tx => tx.executeSql(create, [], () => res(true), (_, err) => rej(err))));
        console.log('Database initialized with transaction/executeSql');
        return true;
      } catch (txErr) {
        console.warn('transaction executeSql failed, trying execAsync/runAsync:', txErr);
        if (this.db.execAsync) {
          await this.db.execAsync(create);
          console.log('Database initialized with execAsync');
          return true;
        }
        if (this.db.runAsync) {
          // Some runAsync signatures expect (sql, argsArray)
          await this.db.runAsync(create, []);
          console.log('Database initialized with runAsync');
          return true;
        }
        throw txErr;
      }
    } catch (e) {
      console.error('DB init failed, enabling memory fallback:', e);
      this._useMemoryFallback = true;
      this._memorySongs = [];
      return true;
    }
  }

  async saveSong(song) {
    await this._ready;
    if (!song) return;

    if (this._useMemoryFallback || !this.db) {
      try {
        const existing = this._memorySongs.find(s => s.id === song.id || s.uri === song.uri);
        const entry = { id: String(song.id || song.uri || Date.now()), title: String(song.title || 'Unknown Title'), artist: String(song.artist || 'Unknown Artist'), album: String(song.album || 'Unknown Album'), uri: String(song.uri || ''), duration: Number(song.duration || 0), cover: song.cover || null };
        if (existing) Object.assign(existing, entry); else this._memorySongs.push(entry);
      } catch (memErr) { console.warn('Memory saveSong failed', memErr); }
      return;
    }

    const params = [
      String(song.id || song.uri || `id_${Date.now()}`),
      String(song.title || 'Unknown Title'),
      String(song.artist || 'Unknown Artist'),
      String(song.album || 'Unknown Album'),
      String(song.uri || ''),
      Number(song.duration || 0),
      song.cover || null
      
    ];

    const sql = 'INSERT OR REPLACE INTO songs (id, title, artist, album, uri, duration, cover) VALUES (?, ?, ?, ?, ?, ?, ?);';
    try {
      // Prefer runAsync with parameters when available
      if (typeof this.db.runAsync === 'function') {
        try {
          await this.db.runAsync(sql, params);
          console.log('DB insert via runAsync:', params[0]);
          return;
        } catch (e) {
          console.warn('runAsync insert failed, trying execAsync/transaction', e);
        }
      }
      if (typeof this.db.execAsync === 'function') {
        try {
          // pass params when supported
          const res = await this.db.execAsync(sql, params);
          console.log('DB insert via execAsync:', params[0]);
          return;
        } catch (e) {
          console.warn('execAsync insert failed, trying transaction', e);
        }
      }
      if (this.db.transaction) {
        await new Promise((res, rej) => this.db.transaction(tx => tx.executeSql(sql, params, () => res(true), (_, err) => rej(err))));
        console.log('DB insert via transaction:', params[0]);
        return;
      }
      throw new Error('No usable DB write API');
    } catch (error) {
      console.error('DB Save Error, falling back to memory:', error && (error.message || error));
      this._useMemoryFallback = true;
      try {
        const existing = this._memorySongs.find(s => s.id === song.id || s.uri === song.uri);
        const entry = { id: String(song.id || song.uri || Date.now()), title: String(song.title || 'Unknown Title'), artist: String(song.artist || 'Unknown Artist'), album: String(song.album || 'Unknown Album'), uri: String(song.uri || ''), duration: Number(song.duration || 0), cover: song.cover || null };
        if (existing) Object.assign(existing, entry); else this._memorySongs.push(entry);
      } catch (memErr) { console.warn('Memory save fallback failed', memErr); }
    }
  }

  async getAllSongs() {
    await this._ready;
    try {
      if (this._useMemoryFallback || !this.db) {
        return Array.from(this._memorySongs);
      }
      // Prefer higher-level async APIs when available
      if (typeof this.db.getAllAsync === 'function') {
        try {
          return await this.db.getAllAsync('SELECT * FROM songs');
        } catch (gErr) { console.warn('getAllAsync failed, falling back', gErr); }
      }

      if (typeof this.db.execAsync === 'function') {
        try {
          const res = await this.db.execAsync('SELECT * FROM songs');
          // Try several possible result shapes
          if (!res) return [];
          if (res.rows && typeof res.rows.length === 'number') {
            const rows = [];
            for (let i = 0; i < res.rows.length; i++) rows.push(res.rows.item(i));
            return rows;
          }
          if (Array.isArray(res) && res.length > 0) {
            const first = res[0];
            if (first && first.rows && typeof first.rows.length === 'number') {
              const rows = [];
              for (let i = 0; i < first.rows.length; i++) rows.push(first.rows.item(i));
              return rows;
            }
            if (Array.isArray(first)) return first;
          }
        } catch (execErr) { console.warn('execAsync select failed, falling back', execErr); }
      }

      if (typeof this.db.runAsync === 'function') {
        try {
          const maybe = await this.db.runAsync('SELECT * FROM songs', []);
          if (Array.isArray(maybe)) return maybe;
          // otherwise attempt to extract rows property
          if (maybe && maybe.rows && typeof maybe.rows.length === 'number') {
            const rows = [];
            for (let i = 0; i < maybe.rows.length; i++) rows.push(maybe.rows.item(i));
            return rows;
          }
        } catch (runErr) { console.warn('runAsync select failed, falling back', runErr); }
      }

      if (this.db.transaction) {
        const res = await new Promise((res, rej) => this.db.transaction(tx => tx.executeSql('SELECT * FROM songs', [], (_, r) => res(r), (_, e) => rej(e))));
        const rows = [];
        for (let i = 0; i < res.rows.length; i++) rows.push(res.rows.item(i));
        return rows;
      }

      throw new Error('No usable DB read API');
    } catch (error) {
      console.error('Error getting songs:', error);
      this._useMemoryFallback = true;
      return Array.from(this._memorySongs);
    }
  }
}