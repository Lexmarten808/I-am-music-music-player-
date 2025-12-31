import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

function SongItem({ item }) {
  const [imgError, setImgError] = useState(false);
  return (
    <View style={styles.songCard}>
      {item.cover && !imgError ? (
        <Image source={{ uri: item.cover }} style={styles.albumArt} onError={() => setImgError(true)} />
      ) : (
        <View style={[styles.albumArt, { backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{color: '#666', fontSize: 10}}>No Art</Text>
        </View>
      )}
      <View style={styles.songInfo}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.artist} numberOfLines={1}>{item.artist}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  songCard: { flexDirection: 'row', padding: 10, alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: '#333' },
  albumArt: { width: 50, height: 50, borderRadius: 5, backgroundColor: '#333' },
  songInfo: { marginLeft: 15, flex: 1 },
  title: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  artist: { color: '#aaa', fontSize: 14 }
});

export default React.memo(SongItem, (prev, next) => {
  // Re-render only when key fields change
  const a = prev.item;
  const b = next.item;
  return a.id === b.id && a.title === b.title && a.artist === b.artist && a.cover === b.cover;
});

