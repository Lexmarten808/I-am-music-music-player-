// Local HTTP server for serving artwork files to TrackPlayer and notifications.
// Avoids permission issues and process boundary problems on Android.
import StaticServer from 'react-native-static-server';
import RNFS from 'react-native-fs';

let server = null;
let serverUrl = null;

// Starts the local HTTP server that serves files from the cache directory.
// Safe to call multiple times; returns immediately if already running.
export async function startArtworkServer() {
  if (server) return serverUrl;

  try {
    const cacheDir = RNFS.CachesDirectoryPath;

    // Create a static HTTP server on port 8888 serving the cache directory.
    // keepAlive: true ensures the server stays running.
    server = new StaticServer(8888, cacheDir, { keepAlive: true });
    serverUrl = await server.start();

    console.log('Artwork server running at:', serverUrl);
    return serverUrl; // "http://localhost:8888"
  } catch (error) {
    console.error('Error starting artwork server:', error);
    server = null;
    serverUrl = null;
    throw error;
  }
}

// Stops the local HTTP server.
export async function stopArtworkServer() {
  if (server) {
    try {
      await server.stop();
    } catch (error) {
      console.error('Error stopping artwork server:', error);
    }
    server = null;
    serverUrl = null;
  }
}

// Returns a full HTTP URL for a cached artwork file.
export function getArtworkUrl(fileName) {
  if (!serverUrl) return null;
  return `${serverUrl}/${fileName}`;
}
