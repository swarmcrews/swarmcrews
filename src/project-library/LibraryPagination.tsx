import { ChevronLeft, ChevronRight } from "lucide-react";
export const LIBRARY_PAGE_SIZE = 24;

export function LibraryPagination({ page, total, position, onPage }: { page: number; total: number; position: "top" | "bottom"; onPage: (page: number) => void }) {
  if (total <= LIBRARY_PAGE_SIZE) return null;
  return <nav className="pl-pagination" aria-label={`Project pages (${position})`}>
    <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /><span>Previous projects</span></button>
    <span aria-live={position === "top" ? "polite" : "off"} aria-atomic="true">{page * LIBRARY_PAGE_SIZE + 1}–{Math.min((page + 1) * LIBRARY_PAGE_SIZE, total)} of {total}</span>
    <button type="button" disabled={(page + 1) * LIBRARY_PAGE_SIZE >= total} onClick={() => onPage(page + 1)}><span>Next projects</span><ChevronRight size={16} aria-hidden="true" /></button>
  </nav>;
}
