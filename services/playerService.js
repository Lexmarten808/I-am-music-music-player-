// Thin service adapter around the Song class playback API.
// Keeps UI code from calling Song methods directly in most places.
import Song from '../classes/Song';

function ensureSong(song, methodName) {
  if (!song || typeof song[methodName] !== 'function') {
    throw new Error(`playerService.${methodName} requires a Song instance`);
  }
}

const playerService = {
  load: async (song) => {
    ensureSong(song, 'load');
    return song.load();
  },
  play: async (song) => {
    ensureSong(song, 'play');
    return song.play();
  },
  pause: async (song) => {
    ensureSong(song, 'pause');
    return song.pause();
  },
  togglePlayPause: async (song) => {
    ensureSong(song, 'togglePlayPause');
    return song.togglePlayPause();
  },
  stop: async (song) => {
    ensureSong(song, 'stop');
    return song.stop();
  },
  seek: async (song, position) => {
    ensureSong(song, 'seek');
    return song.seek(position);
  },
  onActiveSongChange: (listener) => {
    if (Song && typeof Song.onActiveSongChange === 'function') {
      return Song.onActiveSongChange(listener);
    }
    return () => {};
  },
};

export default playerService;
