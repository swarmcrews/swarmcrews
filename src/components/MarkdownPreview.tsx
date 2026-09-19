import {
  createElement,
  memo,
  useMemo,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  parseMarkdownPreviewBlocks,
  type MarkdownPreviewBlock,
} from "../markdown/markdown-preview-blocks.ts";

export { parseMarkdownPreviewBlocks };
export type { MarkdownPreviewBlock };

const INLINE_TOKEN_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_TOKEN_RE.lastIndex = 0;
  while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const raw = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (raw.startsWith("`")) {
      parts.push(
        <code key={key} className="md-inline-code">
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith("**")) {
      parts.push(
        <strong key={key} className="md-bold">
          {raw.slice(2, -2)}
        </strong>,
      );
    } else {
      parts.push(<em key={key}>{raw.slice(1, -1)}</em>);
    }

    lastIndex = INLINE_TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function sourceRangeAttrs(block: { id: string; from: number; to: number }) {
  return {
    "data-md-block-id": block.id,
    "data-md-source-from": block.from,
    "data-md-source-to": block.to,
  };
}

function headingSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** A source-position suffix makes repeated heading labels safe to target. */
export function markdownPreviewHeadingId(
  block: Extract<MarkdownPreviewBlock, { type: "heading" }>,
  idPrefix: string,
): string {
  return `${idPrefix}-${headingSlug(block.text)}-${block.from}`;
}

interface RenderOptions {
  headingOffset: number;
  standaloneHeadings: boolean;
  idPrefix: string | undefined;
}

function renderBlock(
  block: MarkdownPreviewBlock,
  { headingOffset, standaloneHeadings, idPrefix }: RenderOptions,
): ReactElement {
  switch (block.type) {
    case "heading": {
      const displayLevel = standaloneHeadings
        ? block.level
        : Math.min(block.level, 3);
      const className =
        displayLevel === 1 ? "md-h1" : displayLevel === 2 ? "md-h2" : "md-h3";
      const children = renderInline(block.text, block.id);
      const headingLevel = Math.min(6, displayLevel + (standaloneHeadings ? 0 : headingOffset));
      const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const headingId = idPrefix ? markdownPreviewHeadingId(block, idPrefix) : undefined;
      return createElement(
        Heading,
        {
          key: block.id,
          id: headingId,
          tabIndex: headingId ? -1 : undefined,
          className,
          ...sourceRangeAttrs(block),
        },
        children,
      );
    }

    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={block.id} className="md-list" {...sourceRangeAttrs(block)}>
          {block.items.map((item) => (
            <li
              key={item.id}
              data-md-item-id={item.id}
              data-md-source-from={item.from}
              data-md-source-to={item.to}
            >
              {renderInline(item.text, item.id)}
            </li>
          ))}
        </ListTag>
      );
    }

    case "code":
      return (
        <pre key={block.id} className="md-code-block" {...sourceRangeAttrs(block)}>
          <code>{block.text}</code>
        </pre>
      );

    case "blockquote":
      return (
        <blockquote key={block.id} className="md-blockquote" {...sourceRangeAttrs(block)}>
          {renderInline(block.text, block.id)}
        </blockquote>
      );

    case "rule":
      return <hr key={block.id} className="md-hr" {...sourceRangeAttrs(block)} />;

    case "spacer":
      return (
        <div
          key={block.id}
          className="md-spacer"
          aria-hidden="true"
          {...sourceRangeAttrs(block)}
        />
      );

    case "paragraph":
    default:
      return (
        <p key={block.id} className="md-p" {...sourceRangeAttrs(block)}>
          {renderInline(block.text, block.id)}
        </p>
      );
  }
}

export interface MarkdownPreviewProps
  extends Pick<HTMLAttributes<HTMLDivElement>, "onMouseDown" | "onDoubleClick"> {
  content: string;
  className?: string;
  /** Offset embedded headings so a preview never competes with its host title. */
  headingOffset?: number;
  /** Render source heading levels directly (h1 through h6). */
  standaloneHeadings?: boolean;
  /** Prefix deterministic heading ids for in-document navigation. */
  idPrefix?: string;
}

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  className = "md-preview",
  headingOffset = 2,
  standaloneHeadings = false,
  idPrefix,
  onMouseDown,
  onDoubleClick,
}: MarkdownPreviewProps) {
  const blocks = useMemo(() => parseMarkdownPreviewBlocks(content), [content]);

  return (
    <div
      className={className}
      data-no-drag
      data-scroll-capture
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
    >
      {blocks.map((block) => renderBlock(block, { headingOffset, standaloneHeadings, idPrefix }))}
    </div>
  );
});
