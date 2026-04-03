/**
 * ExportDropdown — reusable dropdown for territory polygon export.
 * Supports single-territory and bulk (multi-territory) usage.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { FormattedMessage } from "react-intl";
import { Download, Loader2, ChevronDown } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import type { TerritoryListItem } from "@/lib/territory-api";
import { exportPdf } from "@/lib/territory-api";
import {
  exportToKml,
  exportToGeoJson,
  exportToGpx,
  downloadFile,
  territoryFilename,
  bulkFilename,
} from "@/lib/territory-export";

interface ExportDropdownProps {
  /** Territories to export. Single item for detail page, multiple for bulk. */
  territories: TerritoryListItem[];
  /** Compact style (icon only) vs full button with label. */
  compact?: boolean;
}

export default function ExportDropdown({ territories, compact }: ExportDropdownProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isSingle = territories.length === 1;

  const handleExport = useCallback(
    (format: "kml" | "geojson" | "gpx") => {
      const withBoundaries = territories.filter(
        (t) => t.boundaries && typeof t.boundaries === "object",
      );
      if (withBoundaries.length === 0) return;

      let content: string;
      let filename: string;
      let mime: string;

      switch (format) {
        case "kml":
          content = exportToKml(withBoundaries);
          filename = isSingle ? territoryFilename(withBoundaries[0]!, "kml") : bulkFilename("kml");
          mime = "application/vnd.google-earth.kml+xml";
          break;
        case "geojson":
          content = exportToGeoJson(withBoundaries);
          filename = isSingle
            ? territoryFilename(withBoundaries[0]!, "geojson")
            : bulkFilename("geojson");
          mime = "application/geo+json";
          break;
        case "gpx":
          content = exportToGpx(withBoundaries);
          filename = isSingle ? territoryFilename(withBoundaries[0]!, "gpx") : bulkFilename("gpx");
          mime = "application/gpx+xml";
          break;
      }

      downloadFile(content, filename, mime);
      setOpen(false);
    },
    [territories, isSingle],
  );

  const handlePdfExport = useCallback(async () => {
    if (!user?.access_token) return;
    const ids = territories.map((t) => t.id);
    if (ids.length === 0) return;

    setPdfLoading(true);
    setOpen(false);

    try {
      const blob = await exportPdf(ids, user.access_token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = isSingle
        ? territoryFilename(territories[0]!, "zip")
        : `territories-maps-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[export] PDF export failed:", err);
    } finally {
      setPdfLoading(false);
    }
  }, [territories, user, isSingle]);

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  const menuItems: { id: string; action: () => void; disabled?: boolean }[] = [
    { id: "territory.export.kml", action: () => handleExport("kml") },
    { id: "territory.export.geojson", action: () => handleExport("geojson") },
    { id: "territory.export.gpx", action: () => handleExport("gpx") },
    { id: "territory.export.pdf", action: handlePdfExport, disabled: isOffline },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={pdfLoading}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors shadow-lg cursor-pointer ${
          "bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
        }`}
      >
        {pdfLoading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {!compact && (
          <>
            <FormattedMessage id="territory.export.button" defaultMessage="Export" />
            <ChevronDown size={11} />
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)] shadow-lg z-50 py-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={item.action}
              disabled={item.disabled}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                item.disabled
                  ? "text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                  : "text-[var(--text)] hover:bg-[var(--glass)] cursor-pointer"
              }`}
              title={item.disabled ? "PDF export requires internet connection" : undefined}
            >
              <FormattedMessage id={item.id} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
