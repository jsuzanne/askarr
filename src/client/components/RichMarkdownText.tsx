import React from 'react';

interface Props {
  text: string;
}

function renderInlineFormatting(line: string): React.ReactNode[] {
  // Parse **bold** and *italic* and `code` cleanly
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const parts = line.split(tokenRegex);

  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-bold text-amber-100 drop-shadow-[0_1px_8px_rgba(251,191,36,0.18)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic text-amber-300/95">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded-md bg-red-950/60 border border-amber-500/35 px-2 py-0.5 text-xs sm:text-sm font-mono text-amber-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const RichMarkdownText: React.FC<Props> = ({ text }) => {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let currentList: string[] = [];

  const flushList = (keyPrefix: string) => {
    if (currentList.length === 0) return;
    blocks.push(
      <ul key={`list-${keyPrefix}`} className="my-2.5 sm:my-3 space-y-2 sm:space-y-2.5 pl-1">
        {currentList.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-[15px] sm:text-base lg:text-[17px] leading-relaxed lg:leading-[1.75] text-stone-100"
          >
            <span className="mt-2 h-2 w-2 rotate-45 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] shrink-0" />
            <span className="flex-1">{renderInlineFormatting(item)}</span>
          </li>
        ))}
      </ul>
    );
    currentList = [];
  };

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList(String(idx));
      return;
    }

    const bulletMatch = trimmed.match(/^[-•*]\s+(.*)$/);
    if (bulletMatch) {
      currentList.push(bulletMatch[1]);
      return;
    }

    flushList(String(idx));

    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h4
          key={idx}
          className="mt-3 mb-1.5 text-base sm:text-lg lg:text-xl font-bold text-amber-300 tracking-wide flex items-center gap-2"
        >
          <span className="inline-block w-1.5 h-4 rounded-full bg-red-500" />
          <span>{renderInlineFormatting(trimmed.slice(4))}</span>
        </h4>
      );
      return;
    }

    blocks.push(
      <p
        key={idx}
        className="text-[15px] sm:text-base lg:text-[17px] leading-relaxed lg:leading-[1.75] text-stone-100"
      >
        {renderInlineFormatting(trimmed)}
      </p>
    );
  });

  flushList('end');

  return <div className="space-y-2.5 sm:space-y-3.5">{blocks}</div>;
};
