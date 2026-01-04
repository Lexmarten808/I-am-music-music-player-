import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList,Image } from 'react-native';
import SongItem from './SongItem';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';

// Importamos FileSystem para usar el selector de carpetas
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
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isShuffle, setIsShuffle] = useState(false);
  const [history, setHistory] = useState([]);

  


 useEffect(() => {
  const setupAudio = async () => {
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
    });
  };

  setupAudio();
}, []); 
useEffect(() => {
  const restore = async () => {
    // 1️⃣ try DB first
    const cached = await songManager.loadFromCache(setSongs);
    if (cached.length) return;

    // 2️⃣ fallback to last folder
    const lastFolder = await AsyncStorage.getItem('last_music_folder');
    if (lastFolder) {
      const songs = await songManager.scanFolder(lastFolder, setSongs);
      setSongs(songs);
    }
  };

  restore();
}, []);
const handleSongPress = async (song) => {
  const index = songs.findIndex(s => s.id === song.id);

  // same song → toggle
  if (currentIndex === index) {
    await song.togglePlayPause();
    setIsPlaying(song.isPlaying);
    return;
  }

  // stop old song
  if (currentSong) {
    await currentSong.stop();
  }

  // play new song
  await song.play();
  song.setOnEnded(handleNext);

  setCurrentSong(song);
  setCurrentIndex(index);
  setIsPlaying(true);
};

// next button logig
const handleNext = async () => {
  if (!songs.length) return;

  let nextIndex;

  if (shuffleRef.current) {
    do {
    nextIndex = Math.floor(Math.random() * songs.length);
  } while (nextIndex === currentIndex && songs.length > 1);

    setHistory(prev => [...prev, currentIndex]);
  } else {
    nextIndex = (currentIndex + 1) % songs.length;
  }

  const nextSong = songs[nextIndex];

  if (currentSong) await currentSong.stop();

  await nextSong.play();
  nextSong.setOnEnded(handleNext);

  setCurrentSong(nextSong);
  setCurrentIndex(nextIndex);
  setIsPlaying(true);
};

//prev button logic

const handlePrev = async () => {
  if (!songs.length) return;

  let prevIndex;

  if (shuffleRef.current && history.length) {
    prevIndex = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
  } else {
    prevIndex =
      currentIndex === 0 ? songs.length - 1 : currentIndex - 1;
  }

  const prevSong = songs[prevIndex];

  if (currentSong) await currentSong.stop();

  await prevSong.play();
  prevSong.setOnEnded(handleNext);

  setCurrentSong(prevSong);
  setCurrentIndex(prevIndex);
  setIsPlaying(true);
};


const seleccionarCarpeta = async () => {
  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  
  if (permissions.granted) {
    setLoading(true);
    const folderUri = permissions.directoryUri;
    
    // we send 'setSongs' as the "notifier" (onUpdate)
    // So, each time SongManager finishes a song, it will automatically call setSongs
    const initialSongs = await songManager.scanFolder(folderUri, (updatedList) => {
        setSongs(updatedList); 
        setScanCount(updatedList.length || 0);
    });
    
    setSongs(initialSongs);
    setScanCount(initialSongs.length || 0);
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

  const processVisibleItems = async () => {
    const items = pendingVisibleRef.current.splice(0, pendingVisibleRef.current.length);
    for (const { item } of items) {
      if (!item) continue;
      if (loadingRef.current.has(item.id)) continue;
      if (!item.cover || item.artist === 'Leyendo...' || item.artist === 'Artista Desconocido') {
        loadingRef.current.add(item.id);
        try {
          const updated = await songManager.loadCoverOnDemand(item);
          setSongs(prev => prev.map(s => (s.id === updated.id ? updated : s)));
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

// ... (los estilos se mantienen igual)
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