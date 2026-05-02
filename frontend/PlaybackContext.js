import React, { createContext, useContext, useEffect, useReducer } from 'react';
import playerService from '../services/playerService';

const initialState = {
  activeSongId: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  currentIndex: -1,
  history: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ACTIVE_SONG_ID':
      return { ...state, activeSongId: action.payload };
    case 'SET_PLAYING':
      return { ...state, isPlaying: !!action.payload };
    case 'SET_POSITION':
      return { ...state, position: action.payload || 0 };
    case 'SET_DURATION':
      return { ...state, duration: action.payload || 0 };
    case 'SET_INDEX':
      return { ...state, currentIndex: action.payload };
    case 'PUSH_HISTORY':
      return { ...state, history: state.history.concat(action.payload) };
    case 'CLEAR_HISTORY':
      return { ...state, history: [] };
    case 'RESET':
      return { ...initialState };
    default:
      return state;
  }
}

const PlaybackContext = createContext(null);

export function PlaybackProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const unsubscribe = playerService.onActiveSongChange((songId, playing, position, duration) => {
      if (!songId) {
        dispatch({ type: 'SET_ACTIVE_SONG_ID', payload: null });
        dispatch({ type: 'SET_PLAYING', payload: false });
        dispatch({ type: 'SET_POSITION', payload: 0 });
        return;
      }

      dispatch({ type: 'SET_ACTIVE_SONG_ID', payload: songId });
      if (typeof playing === 'boolean') {
        dispatch({ type: 'SET_PLAYING', payload: playing });
      }
      if (typeof position === 'number') {
        dispatch({ type: 'SET_POSITION', payload: position });
      }
      if (typeof duration === 'number') {
        dispatch({ type: 'SET_DURATION', payload: duration });
      }
    });

    return unsubscribe;
  }, []);

  const actions = {
    setActiveSongId: (id) => dispatch({ type: 'SET_ACTIVE_SONG_ID', payload: id }),
    setPlaying: (value) => dispatch({ type: 'SET_PLAYING', payload: value }),
    setPosition: (position) => dispatch({ type: 'SET_POSITION', payload: position }),
    setDuration: (duration) => dispatch({ type: 'SET_DURATION', payload: duration }),
    setIndex: (index) => dispatch({ type: 'SET_INDEX', payload: index }),
    pushHistory: (index) => dispatch({ type: 'PUSH_HISTORY', payload: index }),
    clearHistory: () => dispatch({ type: 'CLEAR_HISTORY' }),
    reset: () => dispatch({ type: 'RESET' }),
  };

  return (
    <PlaybackContext.Provider value={{ state, actions }}>
      {children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback() {
  const value = useContext(PlaybackContext);
  if (!value) {
    throw new Error('usePlayback must be used inside PlaybackProvider');
  }
  return value;
}

export default PlaybackContext;
