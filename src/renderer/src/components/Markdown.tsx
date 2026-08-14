import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { codeToHtml } from "shiki";

const htmlCache = new Map<string, string>();

function CodeBlock({ code, language }: { code: string; language: string }): React.JSX.Element {
  const cacheKey = `${language}\u0000${code}`;
  const [html, setHtml] = useState<string | undefined>(htmlCache.get(cacheKey));

  useEffect(() => {
    if (htmlCache.has(cacheKey)) {
      setHtml(htmlCache.get(cacheKey));
      return;
    }
    let cancelled = false;
    codeToHtml(code, {
      lang: language,
      themes: { light: "github-light-default", dark: "github-dark-default" },
      defaultColor: false,
    })
      .then((result) => {
        if (htmlCache.size > 500) htmlCache.clear();
        htmlCache.set(cacheKey, result);
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        // Unknown language: keep plain rendering
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, language]);

  if (html) {
    // eslint-disable-next-line react/no-danger
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <pre>
      <code>{code}</code>
    </pre>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown selectable">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className ?? "");
            const code = String(children).replace(/\n$/, "");
            if (match && code.includes("\n")) {
              return <CodeBlock code={code} language={match[1]} />;
            }
            if (!match && code.includes("\n")) {
              return <CodeBlock code={code} language="text" />;
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
