import React, { createContext, useEffect } from 'react';
import { Audio } from 'expo-av';

export const AudioContext = createContext();

export function AudioProvider({ children }) {
  useEffect(() => {
    const setupAudio = async () => {
      try {
        const interruptionModeAndroid =
          Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX ?? 1;
        const interruptionModeIOS =
          Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX ?? 1;

        await Audio.setAudioModeAsync({
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          interruptionModeAndroid,
          interruptionModeIOS,
          playThroughEarpieceAndroid: false,
        });
        console.log('Audio mode configured for background playback');
      } catch (e) {
        console.error('Error setting audio mode:', e);
      }
    };
    
    setupAudio();
  }, []);

  return (
    <AudioContext.Provider value={{}}>
      {children}
    </AudioContext.Provider>
  );
}
