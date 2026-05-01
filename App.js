// App.js here's the logic
import DatabaseManager from './classes/DatabaseManager';
import SongManager from './classes/SongManager';
import React from 'react';
import MainScreen from './frontend/MainScreen'; // we import the ui 
import { AudioProvider } from './AudioContext';

export default function App() {
  return (
    <AudioProvider>
      <MainScreen />
    </AudioProvider>
  );
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
        //predeterminated space for music in the device
        console.log("Scanning files for the first time...");
        canciones = await miSongManager.scanFolder('storage/emulated/0/music');
    }

    console.log("songs ready to show:", canciones.length);
};