/**
 * Import wizard for KML and CSV territory/address imports.
 * KML: file upload -> results
 * CSV: file upload -> preview -> column mapping -> confirm
 */
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import {
  Upload, ArrowLeft, CheckCircle2, AlertTriangle,
  XCircle, Loader2, ArrowRight, Table, Map,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import {
  importKml,
  previewCsv,
  confirmCsvImport,
  type ImportKmlResult,
  type CsvPreviewResult,
  type CsvImportResult,
} from "@/lib/territory-api";

type ImportMode = "select" | "kml" | "csv-upload" | "csv-preview" | "csv-confirm" | "done";

export function ImportWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const token = user?.access_token ?? "";

  const [mode, setMode] = useState<ImportMode>("select");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // KML state
  const [kmlResult, setKmlResult] = useState<ImportKmlResult | null>(null);

  // CSV state
  const [csvRawText, setCsvRawText] = useState<string>("");
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResult | null>(null);
  const [csvColumns, setCsvColumns] = useState<Record<string, string>>({});
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null);

  // ─── KML import ───────────────────────────────────────────────

  const handleKmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const result = await importKml(file, token);
      setKmlResult(result);
      setMode("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "KML import failed");
    } finally {
      setLoading(false);
    }
  };

  // ─── CSV preview ──────────────────────────────────────────────

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      setCsvRawText(text);
      const preview = await previewCsv(file, token);
      setCsvPreview(preview);
      setCsvColumns(preview.columns);
      setMode("csv-preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV preview failed");
    } finally {
      setLoading(false);
    }
  };

  // ─── CSV confirm ──────────────────────────────────────────────

  const handleCsvConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await confirmCsvImport({ csv: csvRawText, columns: csvColumns }, token);
      setCsvResult(result);
      setMode("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (mode === "select" || mode === "done") {
              navigate("/territories");
            } else {
              setMode("select");
              setError(null);
            }
          }}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="territories.import" defaultMessage="Import Territories" />
        </h1>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-[var(--radius)] bg-[#ef444414] border border-[var(--red)] text-sm text-[var(--red)] flex items-center gap-2">
          <XCircle size={16} />
          {error}
        </div>
      )}

      {/* Mode: select import type */}
      {mode === "select" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <button
            onClick={() => setMode("kml")}
            className="flex flex-col items-center gap-3 p-8 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <Map size={32} className="text-[var(--amber)]" />
            <span className="text-sm font-semibold text-[var(--text)]">KML Import</span>
            <span className="text-xs text-[var(--text-muted)] text-center">
              <FormattedMessage
                id="territories.kmlDescription"
                defaultMessage="Import territory boundaries from KML files"
              />
            </span>
          </button>

          <button
            onClick={() => setMode("csv-upload")}
            className="flex flex-col items-center gap-3 p-8 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <Table size={32} className="text-[var(--amber)]" />
            <span className="text-sm font-semibold text-[var(--text)]">CSV Import</span>
            <span className="text-xs text-[var(--text-muted)] text-center">
              <FormattedMessage
                id="territories.csvDescription"
                defaultMessage="Import addresses or territories from CSV spreadsheets"
              />
            </span>
          </button>
        </div>
      )}

      {/* Mode: KML upload */}
      {mode === "kml" && (
        <div className="max-w-md">
          <label className="flex flex-col items-center gap-4 p-12 border-2 border-dashed border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--amber)] transition-colors cursor-pointer">
            {loading ? (
              <>
                <Loader2 size={32} className="text-[var(--amber)] animate-spin" />
                <span className="text-sm text-[var(--text-muted)]">
                  <FormattedMessage id="territories.importing" defaultMessage="Importing..." />
                </span>
              </>
            ) : (
              <>
                <Upload size={32} className="text-[var(--text-muted)]" />
                <span className="text-sm text-[var(--text-muted)]">
                  <FormattedMessage
                    id="territories.uploadKml"
                    defaultMessage="Click to select a .kml file (max 10MB)"
                  />
                </span>
              </>
            )}
            <input
              type="file"
              accept=".kml,application/vnd.google-earth.kml+xml,application/xml,text/xml,text/plain"
              onChange={handleKmlUpload}
              disabled={loading}
              className="hidden"
            />
          </label>
        </div>
      )}

      {/* Mode: CSV upload */}
      {mode === "csv-upload" && (
        <div className="max-w-md">
          <label className="flex flex-col items-center gap-4 p-12 border-2 border-dashed border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--amber)] transition-colors cursor-pointer">
            {loading ? (
              <>
                <Loader2 size={32} className="text-[var(--amber)] animate-spin" />
                <span className="text-sm text-[var(--text-muted)]">
                  <FormattedMessage id="territories.previewing" defaultMessage="Analyzing..." />
                </span>
              </>
            ) : (
              <>
                <Upload size={32} className="text-[var(--text-muted)]" />
                <span className="text-sm text-[var(--text-muted)]">
                  <FormattedMessage
                    id="territories.uploadCsv"
                    defaultMessage="Click to select a .csv file (max 5MB, UTF-8)"
                  />
                </span>
              </>
            )}
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              disabled={loading}
              className="hidden"
            />
          </label>
        </div>
      )}

      {/* Mode: CSV preview & column mapping */}
      {mode === "csv-preview" && csvPreview && (
        <div className="max-w-2xl space-y-4">
          {/* Column mapping */}
          <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              <FormattedMessage id="territories.columnMapping" defaultMessage="Column Mapping" />
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              <FormattedMessage
                id="territories.columnMappingHint"
                defaultMessage="Verify or adjust the detected column mapping"
              />
            </p>

            <div className="grid grid-cols-2 gap-2">
              {Object.entries(csvColumns).map(([csvCol, mappedTo]) => (
                <div key={csvCol} className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)] w-28 truncate" title={csvCol}>
                    {csvCol}
                  </span>
                  <ArrowRight size={12} className="text-[var(--text-muted)] flex-shrink-0" />
                  <select
                    value={mappedTo}
                    onChange={(e) =>
                      setCsvColumns((prev) => ({ ...prev, [csvCol]: e.target.value }))
                    }
                    className="flex-1 px-2 py-1 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
                  >
                    <option value="">-- skip --</option>
                    <option value="streetAddress">Street Address</option>
                    <option value="apartment">Apartment</option>
                    <option value="city">City</option>
                    <option value="postalCode">Postal Code</option>
                    <option value="latitude">Latitude</option>
                    <option value="longitude">Longitude</option>
                    <option value="type">Type</option>
                    <option value="languageSpoken">Language</option>
                    <option value="notes">Notes</option>
                    <option value="territory_number">Territory Number</option>
                    <option value="territory_name">Territory Name</option>
                    <option value="wkt_boundary">WKT Boundary</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview table */}
          <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
            <div className="px-4 py-2 bg-[var(--bg-1)] border-b border-[var(--border)] flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[var(--text)]">
                <FormattedMessage id="territories.preview" defaultMessage="Preview" />
                <span className="ml-1 font-normal text-[var(--text-muted)]">
                  (first {csvPreview.preview.length} of {csvPreview.totalRows} rows)
                </span>
              </h3>
              {csvPreview.duplicateCount > 0 && (
                <span className="text-[10px] text-[var(--amber)] flex items-center gap-1">
                  <AlertTriangle size={10} />
                  {csvPreview.duplicateCount} duplicates
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[var(--bg)]">
                    {Object.keys(csvPreview.columns).map((col) => (
                      <th key={col} className="px-3 py-2 text-left font-medium text-[var(--text-muted)] whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {csvPreview.preview.map((row, i) => (
                    <tr key={i} className="hover:bg-[var(--glass)]">
                      {Object.keys(csvPreview.columns).map((col) => (
                        <td key={col} className="px-3 py-1.5 text-[var(--text)] whitespace-nowrap max-w-[200px] truncate">
                          {row[col] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Confirm button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setMode("csv-upload");
                setCsvPreview(null);
              }}
              className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
            >
              <FormattedMessage id="common.back" defaultMessage="Back" />
            </button>
            <button
              onClick={handleCsvConfirm}
              disabled={loading}
              className="px-6 py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              <FormattedMessage
                id="territories.confirmImport"
                defaultMessage="Confirm Import ({count} rows)"
                values={{ count: csvPreview.totalRows }}
              />
            </button>
          </div>
        </div>
      )}

      {/* Mode: done (results) */}
      {mode === "done" && (
        <div className="max-w-md space-y-4">
          {/* KML results */}
          {kmlResult && (
            <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--green)]">
                <CheckCircle2 size={18} />
                <FormattedMessage id="territories.importComplete" defaultMessage="Import Complete" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-[var(--radius-sm)] bg-[#22c55e14] text-center">
                  <div className="text-lg font-bold text-[var(--green)]">{kmlResult.created}</div>
                  <div className="text-[var(--text-muted)]">Created</div>
                </div>
                <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--glass)] text-center">
                  <div className="text-lg font-bold text-[var(--text-muted)]">{kmlResult.skipped}</div>
                  <div className="text-[var(--text-muted)]">Skipped</div>
                </div>
              </div>

              {kmlResult.skippedDetails.length > 0 && (
                <div className="text-xs text-[var(--text-muted)] space-y-1">
                  <p className="font-medium">Skipped:</p>
                  {kmlResult.skippedDetails.map((s, i) => (
                    <p key={i}>
                      {s.name} — {s.reason.replace("_", " ")}
                    </p>
                  ))}
                </div>
              )}

              {kmlResult.warnings.length > 0 && (
                <div className="text-xs text-[var(--amber)] space-y-1">
                  <p className="font-medium flex items-center gap-1">
                    <AlertTriangle size={12} />
                    Warnings:
                  </p>
                  {kmlResult.warnings.map((w, i) => (
                    <p key={i}>
                      {w.placemark} — {w.reason.replace("_", " ")}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CSV results */}
          {csvResult && (
            <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--green)]">
                <CheckCircle2 size={18} />
                <FormattedMessage id="territories.importComplete" defaultMessage="Import Complete" />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-[var(--radius-sm)] bg-[#22c55e14] text-center">
                  <div className="text-lg font-bold text-[var(--green)]">{csvResult.created}</div>
                  <div className="text-[var(--text-muted)]">Created</div>
                </div>
                <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--glass)] text-center">
                  <div className="text-lg font-bold text-[var(--text-muted)]">{csvResult.skipped}</div>
                  <div className="text-[var(--text-muted)]">Skipped</div>
                </div>
              </div>

              {csvResult.errors.length > 0 && (
                <div className="text-xs text-[var(--red)] space-y-1">
                  <p className="font-medium">Errors:</p>
                  {csvResult.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => navigate("/territories")}
            className="w-full py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <FormattedMessage id="territories.backToList" defaultMessage="Back to Territories" />
          </button>
        </div>
      )}
    </div>
  );
}
