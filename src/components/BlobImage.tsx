"use client";

import { useEffect, useState } from "react";

export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [entry, setEntry] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // Object URLs must be created and revoked alongside the blob, so this lives in an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return blob && entry?.blob === blob ? entry.url : null;
}

export function BlobImage({ blob, alt, className }: { blob: Blob | null | undefined; alt: string; className?: string }) {
  const url = useObjectUrl(blob);
  if (!url) return <div className={`${className} bg-stone-200`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} />;
}
