import { useCallback, useEffect, useState } from 'react';
import playerService from '../services/playerService';

export default function usePlayerControls() {
  const [activeSongId, setActiveSongId] = useState(null);

  useEffect(() => {
    const unsubscribe = playerService.onActiveSongChange((songId) => {
      setActiveSongId(songId || null);
    });

    return () => {
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, []);

  const loadAndPlay = useCallback(async (song) => {
    await playerService.play(song);
  }, []);

  const play = useCallback((song) => playerService.play(song), []);
  const pause = useCallback((song) => playerService.pause(song), []);
  const toggle = useCallback((song) => playerService.togglePlayPause(song), []);
  const stop = useCallback((song) => playerService.stop(song), []);
  const seek = useCallback((song, position) => playerService.seek(song, position), []);

  return {
    activeSongId,
    loadAndPlay,
    play,
    pause,
    toggle,
    stop,
    seek,
  };
}
