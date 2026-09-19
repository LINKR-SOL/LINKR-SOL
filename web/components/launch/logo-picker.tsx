"use client";

import { useCallback, useRef, useState } from "react";
import { cx, Spinner } from "@/components/ui/primitives";

/** Click-to-choose or drag-and-drop a token logo. Uploads to /api/upload and hands back the public URL,
 *  which the coin's StonkFun metadata points at. Pasting a URL still works, in the same control. Whether a logo is
 *  required is the caller's business — the surrounding Field says so. */
export function LogoPicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setErr(null);
      if (!file.type.startsWith("image/")) return setErr("That file is not an image.");
      if (file.size > 2 * 1024 * 1024) return setErr("Images must be 2 MB or smaller.");
      setBusy(true);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !json.url) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
        onChange(json.url);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  return (
    <div className="studio-upload rounded-lg border border-border bg-surface-2 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a token logo"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        className={cx(
          "flex items-center gap-3 p-3 cursor-pointer transition-colors duration-150",
          dragging ? "bg-accent-soft" : "hover:bg-surface-3",
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-12 w-12 rounded-full object-cover bg-surface-2 shrink-0" />
        ) : (
          <span className="h-12 w-12 rounded-full bg-surface-2 grid place-items-center text-faint text-xl shrink-0">
            +
          </span>
        )}
        <span className="text-sm min-w-0">
          <span className="block font-medium">
            {busy ? "Uploading…" : value ? "Logo added — click to replace" : "Choose a file or drag one here"}
          </span>
          {/* Once set, the URL is visible in the field directly below; repeating it here says nothing. */}
          {!value && (
            <span className="block text-xs text-muted">
              Shown on StonkFun with the coin, so square artwork reads best.
            </span>
          )}
        </span>
        {busy && <Spinner className="ml-auto shrink-0" />}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />

      <input
        aria-label="Logo URL"
        className="w-full h-10 border-t border-border bg-transparent px-3 text-sm text-text placeholder:text-faint outline-none focus:bg-surface-3"
        placeholder="…or paste an image URL"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {err && <p className="text-xs text-danger px-3 pb-2">{err}</p>}
    </div>
  );
}
