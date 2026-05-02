import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import songLibraryService from '../services/songLibraryService';

export default function useMusicLibrary() {
  const [songs, setSongs] = useState([]);
  const [scanning, setScanning] = useState(false);

  const reload = useCallback(async () => {
    const cachedSongs = await songLibraryService.loadFromCache();
    setSongs(cachedSongs);
    return cachedSongs;
  }, []);

  const scanFolder = useCallback(async (folderUri, onUpdate) => {
    setScanning(true);
    try {
      const updatedSongs = await songLibraryService.scanFolder(folderUri, (list) => {
        const normalized = Array.isArray(list) ? list : [];
        setSongs(normalized);
        onUpdate?.(normalized);
      });
      setSongs(updatedSongs);
      return updatedSongs;
    } finally {
      setScanning(false);
    }
  }, []);

  const loadCover = useCallback(async (songOrId) => {
    return songLibraryService.loadCoverOnDemand(songOrId);
  }, []);

  useEffect(() => {
    const restore = async () => {
      const cachedSongs = await songLibraryService.loadFromCache();
      if (cachedSongs.length) {
        setSongs(cachedSongs);
        return;
      }

      const lastFolder = await AsyncStorage.getItem('last_music_folder');
      if (lastFolder) {
        const restoredSongs = await songLibraryService.scanFolder(lastFolder, (list) => {
          setSongs(Array.isArray(list) ? list : []);
        });
        setSongs(restoredSongs);
      }
    };

    restore().catch(() => {});
  }, [reload]);

  return {
    songs,
    scanning,
    scanFolder,
    reload,
    loadCover,
    setSongs,
  };
}
