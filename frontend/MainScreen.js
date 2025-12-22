import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image } from 'react-native';
// Importamos FileSystem para usar el selector de carpetas
import * as FileSystem from 'expo-file-system/legacy'; 
import SongManager from '../classes/SongManager';
import DatabaseManager from '../classes/DatabaseManager';

const db = new DatabaseManager();
const songManager = new SongManager(db);

export default function MainScreen() {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);

  const seleccionarCarpeta = async () => {
    try {
      // 1. Pedir permiso para acceder a una carpeta específica
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      
      if (permissions.granted) {
        setLoading(true);
        
        // 2. La URI de la carpeta seleccionada
        const folderUri = permissions.directoryUri;
        
        // 3. Escanear la carpeta (Asegúrate de haber cambiado el import en SongManager.js a /legacy)
        const cancionesEncontradas = await songManager.scanFolder(folderUri);
        
        setSongs(cancionesEncontradas);
        setLoading(false);
      }
    } catch (err) {
      console.log("Error al seleccionar carpeta:", err);
      setLoading(false);
    }
  };

  const renderItem = ({ item }) => (
    <View style={styles.songCard}>
      <Image 
        source={item.cover ? { uri: item.cover } : { uri: 'https://via.placeholder.com/50' }} 
        style={styles.albumArt} 
      />
      <View style={styles.songInfo}>
        <Text style={styles.title}>{item.title || "Canción desconocida"}</Text>
        <Text style={styles.artist}>{item.artist || "Artista desconocido"}</Text>
      </View>
      {/* Verificamos que getFormattedDuration exista antes de llamarlo */}
      <Text style={styles.duration}>
        {item.getFormattedDuration ? item.getFormattedDuration() : "0:00"}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Mi Reproductor</Text>
      
      <TouchableOpacity style={styles.button} onPress={seleccionarCarpeta}>
        <Text style={styles.buttonText}>
          {loading ? "Escaneando..." : "Seleccionar Carpeta de Música"}
        </Text>
      </TouchableOpacity>

      <FlatList
        data={songs}
        keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
        renderItem={renderItem}
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