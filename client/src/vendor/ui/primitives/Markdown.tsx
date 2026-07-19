import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const HEADING_STYLE = {
  h1: { fontSize: "1.5em", margin: "18px 0 10px", fontWeight: 700 },
  h2: { fontSize: "1.25em", margin: "16px 0 8px", fontWeight: 700 },
  h3: { fontSize: "1.1em", margin: "14px 0 6px", fontWeight: 650 },
  h4: { fontSize: "1em", margin: "12px 0 6px", fontWeight: 650 },
  h5: { fontSize: "0.95em", margin: "10px 0 4px", fontWeight: 650 },
  h6: { fontSize: "0.9em", margin: "10px 0 4px", fontWeight: 650 },
} as const;

function heading(level: keyof typeof HEADING_STYLE) {
  const Tag = level;
  return function Heading({ children }: { children?: React.ReactNode }) {
    return (
      <Tag style={{ ...HEADING_STYLE[level], color: "var(--text-primary)", lineHeight: 1.3 }}>
        {children}
      </Tag>
    );
  };
}

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading("h1"),
          h2: heading("h2"),
          h3: heading("h3"),
          h4: heading("h4"),
          h5: heading("h5"),
          h6: heading("h6"),
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          ul: ({ children }) => (
            <ul style={{ margin: "0 0 10px", paddingLeft: 22, listStyle: "disc" }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: "0 0 10px", paddingLeft: 22, listStyle: "decimal" }}>
              {children}
            </ol>
          ),
          li: ({ children }) => <li style={{ margin: "0 0 4px" }}>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "0 0 10px",
                padding: "2px 14px",
                borderLeft: "3px solid var(--border-strong, var(--border))",
                color: "var(--text-secondary)",
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--border)" }} />
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
