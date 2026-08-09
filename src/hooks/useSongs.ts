import { useMemo } from 'react';
import { useUserData } from '../store';
import type { Song } from '../data/songs';
import { mergeSongs, findSong } from '../lib/songCatalog';

/**
 * Every song available to play: the built-in charts plus the user's own.
 *
 * The one place the catalogue is assembled. Components used to import the
 * `SONGS` constant directly, which quietly made "a song" mean "a song someone
 * shipped in the source"; routing every reader through here is what lets a
 * written chart behave like any other.
 */
export function useSongs(): Song[] {
  const userSongs = useUserData().userSongs;
  return useMemo(() => mergeSongs(userSongs), [userSongs]);
}

export function useSong(id: string | undefined): Song | undefined {
  const songs = useSongs();
  return useMemo(() => findSong(songs, id), [songs, id]);
}
