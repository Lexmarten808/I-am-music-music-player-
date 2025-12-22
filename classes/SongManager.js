import Song from '../classes/Song';
import { StorageAccessFramework } from 'expo-file-system';

export default class SongManager {
  constructor(dbManager) {
    this.allSongs = [];
    this.db = dbManager;
  }

  async scanFolder(folderUri) {
    try {
      console.log("Iniciando escaneo de canciones...");
//debugging
      if (!StorageAccessFramework) {
          throw new Error("SAF es undefined. Revisa la instalación.");
      }

      const files = await StorageAccessFramework.readDirectoryAsync(folderUri);
      const audioFiles = files.filter(f => f.toLowerCase().endsWith('.mp3'));
      
      const songsEncontradas = [];

      console.log(`¡Éxito! Encontrados ${audioFiles.length} archivos.`);

      for (const fileUri of audioFiles) {
        const rawName = fileUri.split('%2F').pop();
        const cleanName = decodeURIComponent(rawName).replace(/\.mp3$/i, '');

        // CAMBIO CLAVE: Enviamos un solo objeto {} como espera tu constructor
        const songData = new Song({
          id: fileUri, 
          title: cleanName,
          artist: "Artista Desconocido", 
          album: "Álbum Desconocido", 
          uri: fileUri, 
          duration: 0,
          cover: null
        });

        // Guardamos en la base de datos
        if (this.db) {
          try {
            await this.db.saveSong(songData);
          } catch (dbErr) {
            console.error("Error al guardar en DB:", cleanName, dbErr.message);
          }
        }
        
        songsEncontradas.push(songData);
      }

      return songsEncontradas;
    } catch (error) {
      console.error("Error scanning:", error.message);
      throw error;
    }
  }
}