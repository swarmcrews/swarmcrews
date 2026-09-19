/** Paths always refer to the server filesystem, regardless of the browser OS. */
export interface RepositoryDirectory {
  name: string;
  path: string;
}

export interface RepositoryPathRequest {
  path?: string;
  mode?: "complete" | "browse";
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
}
