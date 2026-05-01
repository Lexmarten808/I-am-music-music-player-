import * as SQLite from 'expo-sqlite';

// Helper that abstracts opening the SQLite database across different runtimes.
// Some SDKs provide `openDatabaseAsync`, others only `openDatabase`.
async function openDatabase(databaseName) {
  if (typeof SQLite.openDatabaseAsync === 'function') {
    return await SQLite.openDatabaseAsync(databaseName);
  }
  if (typeof SQLite.openDatabase === 'function') {
    return SQLite.openDatabase(databaseName);
  }
  throw new Error('No compatible SQLite open function found');
}

// DatabaseManager: thin wrapper around expo-sqlite with defensive fallbacks.
// Responsibilities:
// - Initialize the songs table (if SQLite is available).
// - Provide `saveSong`, `getAllSongs`, and `getSongById` with multiple API fallbacks.
// - If SQLite fails or is unavailable, keep an in-memory fallback store so the app
//   remains functional during the session.
export default class DatabaseManager {
  constructor() {
    // The underlying DB handle (may be null if fallback is used).
    this.db = null;
    // When true, use the in-memory array instead of the native DB.
    this._useMemoryFallback = false;
    // In-memory fallback store for songs (used when DB not available).
    this._memorySongs = [];
    // Promise that resolves when initialization completes.
    this._ready = this._init();
  }

  // Initialize DB and create the `songs` table. This method is defensive and
  // tries multiple API entry points that different SQLite wrappers expose.
  async _init() {
    try {
      this.db = await openDatabase('music_player.db');
    } catch (e) {
      // If opening the DB fails, enable memory fallback and continue.
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
      // Preferred async API (some wrappers add `runAsync`).
      if (typeof this.db.runAsync === 'function') {
        await this.db.runAsync(create, []);
        console.log('Database initialized with runAsync');
        return true;
      }

      // Alternative async exec API.
      if (typeof this.db.execAsync === 'function') {
        await this.db.execAsync(create);
        console.log('Database initialized with execAsync');
        return true;
      }

      // Classic callback-based transaction API from expo-sqlite.
      if (this.db.transaction) {
        await new Promise((res, rej) =>
          this.db.transaction(tx => tx.executeSql(create, [], () => res(true), (_, err) => rej(err)))
        );
        console.log('Database initialized with transaction/executeSql');
        return true;
      }

      throw new Error('No usable DB init API');
    } catch (e) {
      // If table creation fails, fall back to in-memory storage for resilience.
      console.error('DB init failed, enabling memory fallback:', e);
      this._useMemoryFallback = true;
      this._memorySongs = [];
      return true;
    }
  }

  // Save or update a song record. Uses memory fallback when needed and
  // tries multiple write APIs for maximum compatibility.
  async saveSong(song) {
    await this._ready;
    if (!song) return;

    // Memory fallback path: keep a sanitized copy in _memorySongs.
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

    // Prepare parameters for SQL insertion with safe fallbacks.
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
      // Try a variety of write APIs depending on what the DB wrapper offers.
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
      // If writing fails, log the error but do not throw — calling code shouldn't crash.
      console.error('DB Save Error:', error && (error.message || error));
    }
  }

  // Retrieve all saved songs. Returns memory cache on errors.
  async getAllSongs() {
    await this._ready;
    try {
      if (this._useMemoryFallback || !this.db) {
        return Array.from(this._memorySongs);
      }

      // If DB wrapper provides a helper, use it.
      if (typeof this.db.getAllAsync === 'function') {
        return await this.db.getAllAsync('SELECT * FROM songs');
      }

      // Exec style (may return different shapes depending on wrapper).
      if (typeof this.db.execAsync === 'function') {
        const res = await this.db.execAsync('SELECT * FROM songs');
        if (!res) return [];

        // Handle several possible return shapes (rows object, array of rows, etc.).
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

      // runAsync may return rows or arrays depending on shim implementation.
      if (typeof this.db.runAsync === 'function') {
        const maybe = await this.db.runAsync('SELECT * FROM songs', []);
        if (Array.isArray(maybe)) return maybe;
        if (maybe && maybe.rows && typeof maybe.rows.length === 'number') {
          const rows = [];
          for (let i = 0; i < maybe.rows.length; i++) rows.push(maybe.rows.item(i));
          return rows;
        }
      }

      // Finally, fallback to callback-based transaction API.
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
      // On any error, log and return in-memory cache so the app can continue.
      console.error('Error getting songs:', error);
      return Array.from(this._memorySongs);
    }
  }

  // Retrieve a single song by id. Tries multiple APIs and shapes like getAllSongs.
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
