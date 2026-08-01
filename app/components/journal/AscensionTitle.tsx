"use client";

import { useEffect, useState } from "react";
import { loadAscensionDemoState } from "../../lib/ascensionDemoStorage";

type AscensionTitleProps = {
  ascensionId: string;
  automaticTitle: string;
  availableIds: readonly string[];
  className?: string;
};

export default function AscensionTitle({
  ascensionId,
  automaticTitle,
  availableIds,
  className,
}: AscensionTitleProps) {
  const [title, setTitle] = useState(automaticTitle);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTitle(
        loadAscensionDemoState(availableIds).customTitles[ascensionId] ?? automaticTitle,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ascensionId, automaticTitle, availableIds]);

  return <h1 className={className}>{title}</h1>;
}
