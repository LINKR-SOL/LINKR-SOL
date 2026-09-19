"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy } from "@/components/ui/icons";
import { TOKEN, TOKEN_IS_LIVE, TOKEN_MINT } from "@/lib/token";

/** The clipboard API, with the old select-and-copy for browsers that refuse it (an embedded webview, say). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** $LINKR's contract address under the hero: one click copies it. Until the coin launches it says so instead. */
export function ContractAddress() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="ref-ca">
      <span className="ref-ca-label">${TOKEN.symbol} · CONTRACT ADDRESS</span>
      {TOKEN_IS_LIVE ? (
        <button
          type="button"
          className={`ref-ca-field${copied ? " is-copied" : ""}`}
          onClick={async () => setCopied(await copyText(TOKEN_MINT))}
          aria-label={`Copy the $${TOKEN.symbol} contract address`}
        >
          <code>
            <span className="ca-full">{TOKEN_MINT}</span>
            <span className="ca-short">{`${TOKEN_MINT.slice(0, 6)}…${TOKEN_MINT.slice(-6)}`}</span>
          </code>
          <span className="ref-ca-action" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copied ? "copied" : "copy"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
      ) : (
        <div className="ref-ca-field is-soon">
          <i aria-hidden="true" />
          <span>Launching soon on StonkFun</span>
        </div>
      )}
    </div>
  );
}
