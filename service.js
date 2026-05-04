// Background playback service that handles system media controls.
import TrackPlayer, { Event } from 'react-native-track-player';
import Song from './classes/Song';

// Returns the currently active track index, using whichever Track Player API
// is available in the installed version.
async function getCurrentIndex() {
  if (typeof TrackPlayer.getActiveTrackIndex === 'function') {
    return await TrackPlayer.getActiveTrackIndex();
  }

  if (typeof TrackPlayer.getCurrentTrack === 'function') {
    return await TrackPlayer.getCurrentTrack();
  }

  return null;
}

// Registers remote control handlers used by Android/iOS notifications and lock screen.
export default async function playbackService() {
  // Resume playback when the user presses the play button in the notification.
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    try {
      await TrackPlayer.play();
    } catch {}
  });

  // Pause playback when the user presses the pause button.
  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    try {
      await TrackPlayer.pause();
    } catch {}
  });

  // Skip to the next track, wrapping to the beginning of the queue if needed.
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      if (typeof TrackPlayer.skipToNext === 'function') {
        await TrackPlayer.skipToNext();
        await TrackPlayer.play();
      } else {
        const queue = await TrackPlayer.getQueue();
        if (!queue?.length) return;

        const currentIndex = await getCurrentIndex();
        if (currentIndex == null) return;

        const nextIndex = currentIndex + 1 < queue.length ? currentIndex + 1 : 0;
        await TrackPlayer.skip(nextIndex);
        await TrackPlayer.play();

        const track = queue[nextIndex];
        const song = track?.id ? Song.getSongById(track.id) : null;
        if (song) {
          Song.updateTrackMetadata(song).catch(() => {});
        }
      }
    } catch {}
  });

  // Skip to the previous track, wrapping to the end of the queue if needed.
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      if (typeof TrackPlayer.skipToPrevious === 'function') {
        await TrackPlayer.skipToPrevious();
        await TrackPlayer.play();
      } else {
        const queue = await TrackPlayer.getQueue();
        if (!queue?.length) return;

        const currentIndex = await getCurrentIndex();
        if (currentIndex == null) return;

        const prevIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : queue.length - 1;
        await TrackPlayer.skip(prevIndex);
        await TrackPlayer.play();

        const track = queue[prevIndex];
        const song = track?.id ? Song.getSongById(track.id) : null;
        if (song) {
          Song.updateTrackMetadata(song).catch(() => {});
        }
      }
    } catch {}
  });

  // Stop playback entirely when the user presses the stop button.
  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    try {
      await TrackPlayer.stop();
    } catch {}
  });
}
