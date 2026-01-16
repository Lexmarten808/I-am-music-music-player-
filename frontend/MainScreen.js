import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Platform } from 'react-native';
import SongItem from './SongItem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';


import TrackPlayer, { 
  Capability, 
  State, 
  Event, 
  usePlaybackState, 
  useTrackPlayerEvents,
  useActiveTrack
} from 'react-native-track-player';

import * as FileSystem from 'expo-file-system/legacy'; 
import SongManager from '../classes/SongManager';
import DatabaseManager from '../classes/DatabaseManager';

const db = new DatabaseManager();
const songManager = new SongManager(db);

export default function MainScreen() {
  const shuffleRef = useRef(false);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(new Set());
  const [scanCount, setScanCount] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);

  // Hooks from TrackPlayer to simplify state management
  const playbackState = usePlaybackState();
  const activeTrack = useActiveTrack(); // Current track automatically
  const isPlaying = playbackState.state === State.Playing;

  // 1. Initialize TrackPlayer
  useEffect(() => {
    const setup = async () => {
      try {
        await TrackPlayer.setupPlayer();
        await TrackPlayer.updateOptions({
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.Stop,
          ],
          compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
          notificationCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious],
        });
      } catch (e) {
        console.log("TrackPlayer ya estaba inicializado o error:", e);
      }
    };
    setup();
  }, []);

  // 2. Restore music
  useEffect(() => {
    const restore = async () => {
      const cached = await songManager.loadFromCache(setSongs);
      if (cached.length) {
        setScanCount(cached.length);
        return;
      }
      const lastFolder = await AsyncStorage.getItem('last_music_folder');
      if (lastFolder) {
        const songsList = await songManager.scanFolder(lastFolder, setSongs);
        setSongs(songsList);
        setScanCount(songsList.length);
      }
    };
    restore();
  }, []);

  // 3. Handle Playback
  const handleSongPress = async (song) => {
    // If it's the same song, toggle pause
    if (activeTrack && activeTrack.id === song.id) {
      if (isPlaying) await TrackPlayer.pause();
      else await TrackPlayer.play();
      return;
    }

    // If it's a new song, load the queue and skip to it
    await TrackPlayer.setQueue(songs);
    const index = songs.findIndex(s => s.id === song.id);
    await TrackPlayer.skip(index);
    await TrackPlayer.play();
  };

  const handleNext = () => TrackPlayer.skipToNext();
  const handlePrev = () => TrackPlayer.skipToPrevious();

  const seleccionarCarpeta = async () => {
    const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (permissions.granted) {
      setLoading(true);
      const folderUri = permissions.directoryUri;
      const initialSongs = await songManager.scanFolder(folderUri, (updatedList) => {
        setSongs(updatedList); 
        setScanCount(updatedList.length || 0);
      });
      setSongs(initialSongs);
      setScanCount(initialSongs.length || 0);
      setLoading(false);
    }
  };

  // 4. Load covers On Demand (Lazy Load)
  const pendingVisibleRef = useRef([]);
  const viewBufferRef = useRef(null);

  const processVisibleItems = async () => {
    const items = pendingVisibleRef.current.splice(0, pendingVisibleRef.current.length);
    for (const { item } of items) {
      if (!item || loadingRef.current.has(item.id)) continue;
      if (item.artist === 'Loading...') {
        loadingRef.current.add(item.id);
        try {
          const meta = await songManager.loadCoverOnDemand(item);
          if (meta) {
            item.title = meta.title;
            item.artist = meta.artist;
            item.album = meta.album;
            item.cover = meta.cover;
            setSongs(prev => [...prev]);
          }
        } catch (e) {
          console.warn('loadCoverOnDemand error', e);
        } finally {
          loadingRef.current.delete(item.id);
        }
      }
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    pendingVisibleRef.current = pendingVisibleRef.current.concat(viewableItems);
    if (viewBufferRef.current) clearTimeout(viewBufferRef.current);
    viewBufferRef.current = setTimeout(() => { processVisibleItems(); viewBufferRef.current = null; }, 150);
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const getItemLayout = (_data, index) => ({ length: 70, offset: 70 * index, index });

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Mi Reproductor</Text>
      <Text style={{color: '#ccc', textAlign: 'center', marginBottom: 8}}>Songs: {scanCount}</Text>
      
      <TouchableOpacity style={styles.button} onPress={seleccionarCarpeta}>
        <Text style={styles.buttonText}>
          {loading ? "Scanning..." : "Select Music Folder"}
        </Text>
      </TouchableOpacity>

      <FlatList
        data={songs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SongItem item={item} onPress={() => handleSongPress(item)} />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={getItemLayout}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={<Text style={{color: '#666', textAlign: 'center'}}>No songs loaded</Text>}
      />

      {activeTrack && (
        <View style={styles.playbackBar}>
          {activeTrack.cover ? (
            <Image source={{ uri: activeTrack.cover }} style={styles.barCover} />
          ) : (
            <View style={[styles.barCover, styles.noCover]} />
          )}

          <View style={styles.barInfo}>
            <Text style={styles.barTitle} numberOfLines={1}>{activeTrack.title}</Text>
            <Text style={styles.barArtist} numberOfLines={1}>{activeTrack.artist}</Text>
          </View>

          <View style={styles.barControls}>
            <TouchableOpacity onPress={handlePrev}>
              <Text style={styles.controlText}>⏮</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={async () => {
              const state = (await TrackPlayer.getPlaybackState()).state;
              state === State.Playing ? await TrackPlayer.pause() : await TrackPlayer.play();
            }}>
              <Text style={styles.controlText}>
                {isPlaying ? '⏸' : '▶️'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleNext}>
              <Text style={styles.controlText}>⏭</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={async () => {
              const nextShuffle = !isShuffle;
              setIsShuffle(nextShuffle);
              // TrackPlayer has its own native shuffle mode
              await TrackPlayer.setRepeatMode(nextShuffle ? 2 : 0); 
          }}>
            <MaterialIcons
              name="shuffle"
              size={24}
              color={isShuffle ? '#1DB954' : '#fff'}
            />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingTop: 50 },
  header: { fontSize: 24, color: '#fff', fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  button: { backgroundColor: '#1DB954', padding: 15, borderRadius: 25, marginHorizontal: 50, marginBottom: 20 },
  buttonText: { color: '#fff', fontWeight: 'bold', textAlign: 'center' },
  songCard: { flexDirection: 'row', padding: 10, alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#333' },
  albumArt: { width: 50, height: 50, borderRadius: 5, backgroundColor: '#333' },
  songInfo: { marginLeft: 15, flex: 1 },
  title: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  artist: { color: '#aaa', fontSize: 14 },
  duration: { color: '#666', fontSize: 12 }
  ,
  playbackBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 80,
    backgroundColor: '#181818',
    borderTopColor: '#222',
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 10,
    paddingBottom: 6
  },
  controlButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2b2b2b',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6
  },
  controlText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600'
  },
  barCover: {
  width: 50,
  height: 50,
  borderRadius: 6,
  backgroundColor: '#333'
},

noCover: {
  backgroundColor: '#222'
},

barInfo: {
  flex: 1,
  marginHorizontal: 10
},

barTitle: {
  color: '#fff',
  fontSize: 14,
  fontWeight: 'bold'
},

barArtist: {
  color: '#aaa',
  fontSize: 12
},

barControls: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12
},

});