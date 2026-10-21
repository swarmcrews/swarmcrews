import { getLibraryActivity, getLibrarySummaries } from "./api.ts";
import { useLibraryBatch } from "./use-library-batch.ts";

export function useLibrarySummaries(ids: string[], version = 0) {
  return useLibraryBatch(ids, getLibrarySummaries, 2000, version);
}

export function useLibraryActivity(ids: string[], version = 0) {
  const { summaries, ...state } = useLibraryBatch(ids, getLibraryActivity, 10000, version);
  return { activity: summaries, ...state };
}
