import { useEffect, useMemo, useState } from "react";
import {
  MarkdownPreview,
  markdownPreviewHeadingId,
  parseMarkdownPreviewBlocks,
  type MarkdownPreviewBlock,
} from "../components/MarkdownPreview.tsx";
import "./file-document-preview.css";

const HEADING_ID_PREFIX = "file-document-heading";

type HeadingBlock = Extract<MarkdownPreviewBlock, { type: "heading" }>;

function outlineLabel(text: string): string {
  return text.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim() || "Untitled section";
}

interface OutlineProps {
  headings: HeadingBlock[];
  activeId: string | null;
  onNavigate: (id: string) => void;
  className?: string;
}

function Outline({ headings, activeId, onNavigate, className = "" }: OutlineProps) {
  return (
    <nav className={`file-document__outline ${className}`.trim()} aria-label="On this page">
      <p className="file-document__outline-title">On this page</p>
      <ol>
        {headings.map((heading) => {
          const id = markdownPreviewHeadingId(heading, HEADING_ID_PREFIX);
          return (
            <li key={id} style={{ "--file-document-depth": Math.min(heading.level - 1, 3) } as React.CSSProperties}>
              <button
                type="button"
                className={activeId === id ? "is-active" : undefined}
                aria-current={activeId === id ? "location" : undefined}
                onClick={() => onNavigate(id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onNavigate(id);
                  }
                }}
              >
                {outlineLabel(heading.text)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface FileDocumentPreviewProps {
  content: string;
}

/** Standalone, accessible markdown reading surface for file previews. */
export function FileDocumentPreview({ content }: FileDocumentPreviewProps) {
  const headings = useMemo(
    () => parseMarkdownPreviewBlocks(content).filter(
      (block): block is HeadingBlock => block.type === "heading",
    ),
    [content],
  );
  const headingIds = useMemo(
    () => headings.map((heading) => markdownPreviewHeadingId(heading, HEADING_ID_PREFIX)),
    [headings],
  );
  const [activeId, setActiveId] = useState<string | null>(headingIds[0] ?? null);

  useEffect(() => {
    setActiveId(headingIds[0] ?? null);
    if (headingIds.length === 0 || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible?.target instanceof HTMLElement) setActiveId(visible.target.id);
    }, { rootMargin: "-16% 0px -70% 0px" });

    const elements = headingIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [headingIds]);

  const navigate = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    setActiveId(id);
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  const hasOutline = headings.length > 0;
  return (
    <section className={`file-document ${hasOutline ? "file-document--with-outline" : ""}`} aria-label="Document preview">
      {hasOutline && <Outline headings={headings} activeId={activeId} onNavigate={navigate} className="file-document__outline--desktop" />}
      {hasOutline && (
        <details className="file-document__outline-disclosure">
          <summary>On this page</summary>
          <Outline headings={headings} activeId={activeId} onNavigate={navigate} />
        </details>
      )}
      <article className="file-document__article">
        <MarkdownPreview
          content={content}
          className="file-document__markdown"
          standaloneHeadings
          idPrefix={HEADING_ID_PREFIX}
        />
      </article>
    </section>
  );
}
