import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';

function SongItem({ item, onPress }) {
  const [imgError, setImgError] = useState(false);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <View style={styles.songCard}>
        {item.cover && !imgError ? (
          <Image
            source={{ uri: item.cover }}
            style={styles.albumArt}
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.albumArt, styles.placeholder]}>
            <Text style={styles.placeholderText}>No Art</Text>
          </View>
        )}

        <View style={styles.songInfo}>
          <Text style={styles.title} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {item.artist}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  songCard: {
    flexDirection: 'row',
    padding: 10,
    alignItems: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: '#333'
  },
  albumArt: {
    width: 50,
    height: 50,
    borderRadius: 5,
    backgroundColor: '#333'
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  placeholderText: {
    color: '#666',
    fontSize: 10
  },
  songInfo: {
    marginLeft: 15,
    flex: 1
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  },
  artist: {
    color: '#aaa',
    fontSize: 14
  }
});

export default React.memo(SongItem);
