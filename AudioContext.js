// React core and hooks used to create a context and run side effects.
import React, { createContext, useEffect } from 'react';
// Expo AV Audio API used to configure global audio behavior.
import { Audio } from 'expo-av';

// Create a context object for audio-related app state.
export const AudioContext = createContext();

// Context provider component that configures audio on mount.
export function AudioProvider({ children }) {
  useEffect(() => {
    // Async setup function to configure audio mode once.
    const setupAudio = async () => {
      try {
        // Prefer Expo constants, but fall back to numeric values if missing.
        const interruptionModeAndroid =
          Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX ?? 1;
        // Prefer Expo constants, but fall back to numeric values if missing.
        const interruptionModeIOS =
          Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX ?? 1;

        // Apply global audio configuration for background playback.
        await Audio.setAudioModeAsync({
          // Keep audio active when the app goes into the background.
          staysActiveInBackground: true,
          // Allow playback even if the iOS device is on silent mode.
          playsInSilentModeIOS: true,
          // Avoid ducking other audio sources on Android.
          shouldDuckAndroid: false,
          // Use interruption mode constants for Android.
          interruptionModeAndroid,
          // Use interruption mode constants for iOS.
          interruptionModeIOS,
          // Do not route audio through the earpiece on Android.
          playThroughEarpieceAndroid: false,
        });
        // Log success for debugging in development.
        console.log('Audio mode configured for background playback');
      } catch (e) {
        // Log any errors so misconfiguration is visible.
        console.error('Error setting audio mode:', e);
      }
    };
    
    // Invoke the async setup once after the component mounts.
    setupAudio();
  }, []);

  // Provide the context to children; value can be expanded later.
  return (
    <AudioContext.Provider value={{}}>
      {/* Render all nested components inside the provider. */}
      {children}
    </AudioContext.Provider>
  );
}
