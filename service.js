import TrackPlayer, { Event } from 'react-native-track-player';

async function getCurrentIndex() {
  if (typeof TrackPlayer.getActiveTrackIndex === 'function') {
    return await TrackPlayer.getActiveTrackIndex();
  }

  if (typeof TrackPlayer.getCurrentTrack === 'function') {
    return await TrackPlayer.getCurrentTrack();
  }

  return null;
}

export default async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, async () => {
    try {
      await TrackPlayer.play();
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemotePause, async () => {
    try {
      await TrackPlayer.pause();
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try {
      const queue = await TrackPlayer.getQueue();
      if (!queue?.length) return;

      const currentIndex = await getCurrentIndex();
      if (currentIndex == null) return;

      const nextIndex = currentIndex + 1 < queue.length ? currentIndex + 1 : 0;
      await TrackPlayer.skip(nextIndex);
      await TrackPlayer.play();
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try {
      const queue = await TrackPlayer.getQueue();
      if (!queue?.length) return;

      const currentIndex = await getCurrentIndex();
      if (currentIndex == null) return;

      const prevIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : queue.length - 1;
      await TrackPlayer.skip(prevIndex);
      await TrackPlayer.play();
    } catch {}
  });

  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    try {
      await TrackPlayer.stop();
    } catch {}
  });
}
