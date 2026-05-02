// Main screen: displays song list, playback bar, and folder selection.
// React and React Native primitives used across the component.
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList,Image } from 'react-native';

// UI sub-component that renders each song row.
import SongItem from './SongItem';

// Persistent storage for remembering last selected folder.
import AsyncStorage from '@react-native-async-storage/async-storage';

// Icon set used for the shuffle control.
import { MaterialIcons } from '@expo/vector-icons';

// Legacy FileSystem used to request directory permissions via SAF.
import * as FileSystem from 'expo-file-system/legacy';

// Refactored state/services for playback and library access.
import useMusicLibrary from '../hooks/useMusicLibrary';
import usePlayerControls from '../hooks/usePlayerControls';
import { usePlayback } from './PlaybackContext';


export default function MainScreen() {
  const shuffleRef = useRef(false);
  const songsRef = useRef([]);
  const handleNextRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(new Set());
  const [scanCount, setScanCount] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);
  const { state: playback, actions: playbackActions } = usePlayback();
  const { songs, scanning, scanFolder, reload, loadCover } = useMusicLibrary();
  const player = usePlayerControls();

  const currentSong = songs.find(s => String(s.id) === String(playback.activeSongId)) || null;
  const currentIndex = playback.currentIndex;
  const history = playback.history;
  const isPlaying = playback.isPlaying;
  const currentPosition = playback.position;
  const currentDuration = playback.duration;

  const bindSongCallbacks = (song) => {
    if (!song) return;
    if (typeof song.setOnEnded === 'function') {
      song.setOnEnded(async () => {
        if (handleNextRef.current) {
          await handleNextRef.current();
        }
      });
    }
    if (typeof song.setOnProgress === 'function') {
      song.setOnProgress((position, duration) => {
        playbackActions.setPosition(position || 0);
        if (duration) {
          playbackActions.setDuration(duration);
        }
      });
    }
  };

  const formatTime = (seconds) => {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  


useEffect(() => {
  songsRef.current = songs;
  setScanCount(songs.length || 0);
}, [songs]);

const handleSongPress = async (song) => {
  const index = songs.findIndex(s => s.id === song.id);

  // same song → toggle
  if (currentIndex === index) {
    playbackActions.setPlaying(!playback.isPlaying);
    player.toggle(song).catch(() => {});
    return;
  }

  // play new song
  bindSongCallbacks(song);
  playbackActions.setActiveSongId(song.id);
  playbackActions.setIndex(index);
  playbackActions.setPlaying(true);
  playbackActions.setPosition(0);
  playbackActions.setDuration(song.duration || 0);
  player.loadAndPlay(song).catch(() => {});
};

// Next button logic: advances to the next track or picks a random one when shuffle is active.
const handleNext = async () => {
  if (!songs.length) return;

  let nextIndex;

  if (shuffleRef.current) {
    do {
    nextIndex = Math.floor(Math.random() * songs.length);
  } while (nextIndex === currentIndex && songs.length > 1);

    playbackActions.pushHistory(currentIndex);
  } else {
    nextIndex = (currentIndex + 1) % songs.length;
  }

  const nextSong = songs[nextIndex];

  bindSongCallbacks(nextSong);
  playbackActions.setActiveSongId(nextSong.id);
  playbackActions.setIndex(nextIndex);
  playbackActions.setPlaying(true);
  playbackActions.setPosition(0);
  playbackActions.setDuration(nextSong.duration || 0);
  player.loadAndPlay(nextSong).catch(() => {});
};

// Previous button logic: uses history when shuffling or steps back in the list.

const handlePrev = async () => {
  if (!songs.length) return;

  let prevIndex;

  if (shuffleRef.current && history.length) {
    prevIndex = history[history.length - 1];
    playbackActions.clearHistory();
  } else {
    prevIndex =
      currentIndex === 0 ? songs.length - 1 : currentIndex - 1;
  }

  const prevSong = songs[prevIndex];

  bindSongCallbacks(prevSong);
  playbackActions.setActiveSongId(prevSong.id);
  playbackActions.setIndex(prevIndex);
  playbackActions.setPlaying(true);
  playbackActions.setPosition(0);
  playbackActions.setDuration(prevSong.duration || 0);
  player.loadAndPlay(prevSong).catch(() => {});
};

handleNextRef.current = handleNext;


// Folder selector: requests SAF directory permissions and triggers a fast scan.
const seleccionarCarpeta = async () => {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  
  if (permissions.granted) {
    setLoading(true);
    const folderUri = permissions.directoryUri;
    
    await scanFolder(folderUri, (updatedList) => {
      setScanCount(updatedList.length || 0);
    });
    setLoading(false);
  }
};




  const renderItem = ({ item }) => (
  <SongItem 
    item={item}
    onPress={() => handleSongPress(item)}
  />
);

  // Debounced view handler to avoid flooding with loads while scrolling
  const viewBufferRef = useRef(null);
  const pendingVisibleRef = useRef([]);

// Dentro de MainScreen.js, modifica processVisibleItems:

const processVisibleItems = async () => {
  const items = pendingVisibleRef.current.splice(0, pendingVisibleRef.current.length);
  
  for (const { item } of items) {
    if (!item || loadingRef.current.has(item.id)) continue;

    // Solo cargar si realmente dice "Loading..."
    if (item.artist === 'Loading...') {
      loadingRef.current.add(item.id);
      
      try {
        const meta = await loadCover(item);
        
        if (meta) {
          // IMPORTANTE: Actualizamos las propiedades del objeto EXISTENTE
          // en lugar de crear un objeto Song nuevo.
          item.title = meta.title;
          item.artist = meta.artist;
          item.album = meta.album;
          item.cover = meta.cover;

          // Forzamos un re-render simple de la lista
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
    // accumulate and debounce
    pendingVisibleRef.current = pendingVisibleRef.current.concat(viewableItems);
    if (viewBufferRef.current) clearTimeout(viewBufferRef.current);
    viewBufferRef.current = setTimeout(() => { processVisibleItems(); viewBufferRef.current = null; }, 150);
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;

  // Improve FlatList virtualization by providing item layout (fixed height)
  const ITEM_HEIGHT = 70; // matches songCard padding + albumArt size
  const getItemLayout = (_data, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index });
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
        keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
        renderItem={renderItem}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={getItemLayout}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={<Text style={{color: '#666', textAlign: 'center'}}>No hay canciones cargadas</Text>}
      />
      {currentSong && (
  <View style={styles.playbackBar}>
    
    {/* Cover */}
    {currentSong.cover ? (
      <View>
        <Text />
        <Image
          source={{ uri: currentSong.cover }}
          style={styles.barCover}
        />
      </View>
    ) : (
      <View style={[styles.barCover, styles.noCover]} />
    )}

    {/* Song info */}
    <View style={styles.barInfo}>
      <Text style={styles.barTitle} numberOfLines={1}>
        {currentSong.title}
      </Text>
      <Text style={styles.barArtist} numberOfLines={1}>
        {currentSong.artist}
      </Text>
      <Text style={styles.barTime} numberOfLines={1}>
        {formatTime(currentPosition)} / {formatTime(currentDuration || currentSong.duration || 0)}
      </Text>
    </View>

    {/* Controls */}
    <View style={styles.barControls}>
      <TouchableOpacity onPress={handlePrev}>
        <Text style={styles.controlText}>⏮</Text>
      </TouchableOpacity>


      <TouchableOpacity
        onPress={async () => {
          await currentSong.togglePlayPause();
          setIsPlaying(currentSong.isPlaying);
        }}
      >
        <Text style={styles.controlText}>
          {isPlaying ? '⏸' : '▶️'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleNext}>
        <Text style={styles.controlText}>⏭</Text>
      </TouchableOpacity>

    </View>
      <TouchableOpacity
        onPress={() => {
          setIsShuffle(s => {
            const next = !s;
            shuffleRef.current = next;
            return next;
          });
        }}
      >
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

// STYLES...
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

barTime: {
  color: '#8f8f8f',
  fontSize: 11,
  marginTop: 2
},

barControls: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12
},

});