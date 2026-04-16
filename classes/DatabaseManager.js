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

    try {
      if (typeof this.db.runAsync === 'function') {
        await this.db.runAsync(create, []);
        console.log('Database initialized with runAsync');
        return true;
      }

      if (typeof this.db.execAsync === 'function') {
        await this.db.execAsync(create);
        console.log('Database initialized with execAsync');
        return true;
      }

      if (this.db.transaction) {
        await new Promise((res, rej) =>
          this.db.transaction(tx => tx.executeSql(create, [], () => res(true), (_, err) => rej(err)))
        );
        console.log('Database initialized with transaction/executeSql');
        return true;
      }

      throw new Error('No usable DB init API');
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
        const entry = {
          id: String(song.id || song.uri || Date.now()),
          title: String(song.title || 'Unknown Title'),
          artist: String(song.artist || 'Unknown Artist'),
          album: String(song.album || 'Unknown Album'),
          uri: String(song.uri || ''),
          duration: Number(song.duration || 0),
          cover: song.cover || null,
        };
        if (existing) Object.assign(existing, entry);
        else this._memorySongs.push(entry);
      } catch (memErr) {
        console.warn('Memory saveSong failed', memErr);
      }
      return;
    }

    const params = [
      String(song.id || song.uri || `id_${Date.now()}`),
      String(song.title || 'Unknown Title'),
      String(song.artist || 'Unknown Artist'),
      String(song.album || 'Unknown Album'),
      String(song.uri || ''),
      Number(song.duration || 0),
      song.cover || null,
    ];

    const sql = 'INSERT OR REPLACE INTO songs (id, title, artist, album, uri, duration, cover) VALUES (?, ?, ?, ?, ?, ?, ?);';

    try {
      if (typeof this.db.runAsync === 'function') {
        await this.db.runAsync(sql, params);
        return;
      }

      if (typeof this.db.execAsync === 'function') {
        await this.db.execAsync(sql, params);
        return;
      }

      if (this.db.transaction) {
        await new Promise((res, rej) =>
          this.db.transaction(tx => tx.executeSql(sql, params, () => res(true), (_, err) => rej(err)))
        );
        return;
      }

      throw new Error('No usable DB write API');
    } catch (error) {
      console.error('DB Save Error:', error && (error.message || error));
    }
  }

  async getAllSongs() {
    await this._ready;
    try {
      if (this._useMemoryFallback || !this.db) {
        return Array.from(this._memorySongs);
      }

      if (typeof this.db.getAllAsync === 'function') {
        return await this.db.getAllAsync('SELECT * FROM songs');
      }

      if (typeof this.db.execAsync === 'function') {
        const res = await this.db.execAsync('SELECT * FROM songs');
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
      }

      if (typeof this.db.runAsync === 'function') {
        const maybe = await this.db.runAsync('SELECT * FROM songs', []);
        if (Array.isArray(maybe)) return maybe;
        if (maybe && maybe.rows && typeof maybe.rows.length === 'number') {
          const rows = [];
          for (let i = 0; i < maybe.rows.length; i++) rows.push(maybe.rows.item(i));
          return rows;
        }
      }

      if (this.db.transaction) {
        const res = await new Promise((res, rej) =>
          this.db.transaction(tx => tx.executeSql('SELECT * FROM songs', [], (_, r) => res(r), (_, e) => rej(e)))
        );
        const rows = [];
        for (let i = 0; i < res.rows.length; i++) rows.push(res.rows.item(i));
        return rows;
      }

      throw new Error('No usable DB read API');
    } catch (error) {
      console.error('Error getting songs:', error);
      return Array.from(this._memorySongs);
    }
  }

  async getSongById(id) {
    await this._ready;
    try {
      if (this._useMemoryFallback || !this.db) {
        return this._memorySongs.find(s => s.id === id) || null;
      }

      if (typeof this.db.getFirstAsync === 'function') {
        return await this.db.getFirstAsync('SELECT * FROM songs WHERE id = ?', [id]);
      }

      if (typeof this.db.getAllAsync === 'function') {
        const results = await this.db.getAllAsync('SELECT * FROM songs WHERE id = ?', [id]);
        return results && results.length > 0 ? results[0] : null;
      }

      if (typeof this.db.execAsync === 'function') {
        const res = await this.db.execAsync('SELECT * FROM songs WHERE id = ?', [id]);
        if (!res) return null;
        if (res.rows && typeof res.rows.length === 'number' && res.rows.length > 0) {
          return res.rows.item(0);
        }
        if (Array.isArray(res) && res.length > 0) {
          const first = res[0];
          if (first && first.rows && typeof first.rows.length === 'number' && first.rows.length > 0) {
            return first.rows.item(0);
          }
          if (Array.isArray(first) && first.length > 0) return first[0];
        }
      }

      if (typeof this.db.runAsync === 'function') {
        const maybe = await this.db.runAsync('SELECT * FROM songs WHERE id = ?', [id]);
        if (Array.isArray(maybe) && maybe.length > 0) return maybe[0];
        if (maybe && maybe.rows && typeof maybe.rows.length === 'number' && maybe.rows.length > 0) {
          return maybe.rows.item(0);
        }
      }

      if (this.db.transaction) {
        const res = await new Promise((res, rej) =>
          this.db.transaction(tx => tx.executeSql('SELECT * FROM songs WHERE id = ?', [id], (_, r) => res(r), (_, e) => rej(e)))
        );
        if (res.rows.length > 0) return res.rows.item(0);
      }

      return null;
    } catch (error) {
      console.warn('Error getting song by id:', error);
      return null;
    }
  }
}
