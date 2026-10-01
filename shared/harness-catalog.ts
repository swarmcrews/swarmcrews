/** Explicit discovery semantics: singleton snapshots must not be mistaken for patches. */
export type HarnessCatalogMode = "snapshot" | "patch";
export interface HarnessCatalogMessage<Entry> {
  type: "harness_list";
  catalogMode: HarnessCatalogMode;
  harnesses: Entry[];
}
