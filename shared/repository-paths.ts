/** Paths always refer to the server filesystem, regardless of the browser OS. */
export interface RepositoryDirectory {
  name: string;
  path: string;
}

export interface RepositoryPathRequest {
  path?: string;
  mode?: "complete" | "browse";
  /** Filter folder names within the browse directory; never interpreted as a full path. */
  query?: string;
}

export interface RepositoryPathSuggestions {
  platform: "win32" | "posix";
  separator: "/" | "\\";
  roots: RepositoryDirectory[];
  directory: string | null;
  parent: string | null;
  breadcrumbs: RepositoryDirectory[];
  entries: RepositoryDirectory[];
  truncated: boolean;
  /** A checked missing child directory; discovery never creates it. */
  newDirectory?: RepositoryDirectory;
}
