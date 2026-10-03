"use client";

import { useId, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/media/limits";

type Props = {
  appId: string;
  /** Current image URL ("" = no image). */
  value: string;
  alt?: string;
  onChange: (url: string) => void;
};

/** Drag & drop (or click / keyboard / paste) image upload with progress and preview. */
export function ImageDropzone({ appId, value, alt = "", onChange }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null); // null = not uploading
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null;

  function upload(file: File) {
    setError(null);
    if (file.type && !ACCEPTED_IMAGE_TYPES.includes(file.type)) return setError("unsupportedType");
    if (file.size > MAX_UPLOAD_BYTES) return setError("tooLarge");

    const body = new FormData();
    body.append("file", file);
    body.append("appId", appId);
    // XMLHttpRequest (not fetch) because it reports upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status === 201 && xhr.response?.url) onChange(xhr.response.url);
      else setError(xhr.response?.error ?? "failed");
    };
    xhr.onerror = () => {
      setProgress(null);
      setError("failed");
    };
    setProgress(0);
    xhr.send(body);
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > 1) return setError("multiple");
    upload(files[0]);
  }

  const open = () => !uploading && inputRef.current?.click();
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <div className="space-y-1.5">
      <div
        role="button"
        tabIndex={0}
        aria-describedby={hintId}
        aria-busy={uploading}
        aria-label={value ? t.media.replace : `${t.media.drop} ${t.media.or} ${t.media.choose}`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
          if (file) {
            e.preventDefault();
            upload(file);
          }
        }}
        onDragEnter={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) handleFiles(e.dataTransfer.files);
        }}
        className={`group relative flex min-h-36 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-center transition outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
          dragging
            ? "border-violet-500 bg-violet-50"
            : error
              ? "border-red-300 bg-red-50/40"
              : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100"
        }`}
        data-testid="image-dropzone"
      >
        {value && !uploading ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
            <div
              className={`absolute inset-0 flex items-center justify-center gap-2 bg-black/45 transition ${dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
            >
              {dragging ? (
                <span className="font-medium text-white">{t.media.dropNow}</span>
              ) : (
                <>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-zinc-900">{t.media.replace}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setError(null);
                      onChange("");
                    }}
                    className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-white"
                  >
                    {t.media.remove}
                  </button>
                </>
              )}
            </div>
          </>
        ) : uploading ? (
          <div className="w-3/4 space-y-2">
            <p className="text-sm text-zinc-600">{t.media.uploading}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <div className="pointer-events-none space-y-1 px-4 py-5">
            <svg className={`mx-auto h-8 w-8 ${dragging ? "text-violet-600" : "text-zinc-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
            </svg>
            {dragging ? (
              <p className="text-sm font-medium text-violet-700">{t.media.dropNow}</p>
            ) : (
              <p className="text-sm text-zinc-700">
                <span className="font-medium">{t.media.drop}</span> {t.media.or}{" "}
                <span className="font-medium text-violet-700 underline underline-offset-2">{t.media.choose}</span>
              </p>
            )}
            <p id={hintId} className="text-xs text-zinc-500">{t.media.formats}</p>
          </div>
        )}
      </div>
      {/* Outside the drop area on purpose: its click must not bubble back into the area's onClick. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = ""; // allow choosing the same file again
        }}
        data-testid="image-file-input"
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {t.media.errors[error] ?? t.media.errors.failed}
        </p>
      )}
    </div>
  );
}
