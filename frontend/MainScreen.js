import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import SongItem from './SongItem';
// Importamos FileSystem para usar el selector de carpetas
import * as FileSystem from 'expo-file-system/legacy'; 
import SongManager from '../classes/SongManager';
import DatabaseManager from '../classes/DatabaseManager';
const db = new DatabaseManager();
const songManager = new SongManager(db);

export default function MainScreen() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(new Set());
  const [scanCount, setScanCount] = useState(0);
  

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

  const renderItem = ({ item }) => <SongItem item={item} />;
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
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={<Text style={{color: '#666', textAlign: 'center'}}>No hay canciones cargadas</Text>}
      />
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
});