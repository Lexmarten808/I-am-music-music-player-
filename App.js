import React from 'react';
import MainScreen from './frontend/MainScreen';
import { AudioProvider } from './AudioContext';
import { PlaybackProvider } from './frontend/PlaybackContext';

export default function App() {
  return (
    <AudioProvider>
      <PlaybackProvider>
        <MainScreen />
      </PlaybackProvider>
    </AudioProvider>
  );
}
