// App.js here's the logic
import DatabaseManager from './classes/DatabaseManager';
import SongManager from './classes/SongManager';
import React from 'react';
import MainScreen from './frontend/MainScreen'; // Importamos tu UI

export default function App() {
  return <MainScreen />;
}
// 1. initialize the database
const miBD = new DatabaseManager();

// 2. Pass the database to the song manager
const miSongManager = new SongManager(miBD);

// 3. When you want to load the songs:
const cargarApp = async () => {
    // First, try to read from the database (it's very fast)
    let canciones = await miBD.getAllSongs();

    if (canciones.length === 0) {
        // If the database is empty, scan the phone (this only happens the first time)
        console.log("Scanning files for the first time...");
        canciones = await miSongManager.scanFolder('ruta/a/tu/musica');
    }

    console.log("songs ready to show:", canciones.length);
};