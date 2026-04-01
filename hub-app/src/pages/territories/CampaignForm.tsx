import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Megaphone,
  ArrowLeft,
  ArrowRight,
  Check,
  Calendar,
  Tag,
  Map,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface Territory {
  id: string;
  number: string;
  name: string | null;
}

interface Campaign {
  id: string;
  title: string;
  template: string;
  status: string;
  startDate: string;
  endDate: string;
}

type Template = "gedaechtnismahl" | "kongress" | "predigtdienstaktion" | "custom";

const TEMPLATE_OPTIONS: { value: Template; label: string; description: string }[] = [
  { value: "gedaechtnismahl", label: "Memorial", description: "Memorial campaign with special territories" },
  { value: "kongress", label: "Convention", description: "Convention invitation campaign" },
  { value: "predigtdienstaktion", label: "Special Campaign", description: "Special preaching initiative" },
  { value: "custom", label: "Custom", description: "Custom campaign with flexible settings" },
];

export function CampaignForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const apiUrl = getApiUrl();
  const headers: HeadersInit = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const isEdit = !!id;
  const [step, setStep] = useState(isEdit ? -1 : 1); // -1 = edit mode (single page)
  const [saving, setSaving] = useState(false);

  // Form data
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<Template>("custom");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTerritories, setSelectedTerritories] = useState<string[]>([]);

  // Available territories
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [territorySearch, setTerritorySearch] = useState("");

  useEffect(() => {
    const fetchTerritories = async () => {
      try {
        const res = await fetch(`${apiUrl}/territories`, {
          headers: { Authorization: `Bearer ${user?.access_token}` },
        });
        if (res.ok) {
          setTerritories((await res.json()) as Territory[]);
        }
      } catch {
        // silently fail
      }
    };
    fetchTerritories();

    if (isEdit) {
      const fetchCampaign = async () => {
        try {
          const res = await fetch(`${apiUrl}/campaigns/${id}`, {
            headers: { Authorization: `Bearer ${user?.access_token}` },
          });
          if (res.ok) {
            const c = (await res.json()) as Campaign;
            setTitle(c.title);
            setTemplate(c.template as Template);
            setStartDate(c.startDate.split("T")[0] ?? "");
            setEndDate(c.endDate.split("T")[0] ?? "");
          }
        } catch {
          // silently fail
        }
      };
      fetchCampaign();
    }
  }, [apiUrl, id, isEdit, user?.access_token]);

  const filteredTerritories = territories.filter((t) => {
    if (!territorySearch) return true;
    const q = territorySearch.toLowerCase();
    return t.number.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q);
  });

  const toggleTerritory = (tid: string) => {
    setSelectedTerritories((prev) =>
      prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid],
    );
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const body = { title, template, startDate, endDate };

      if (isEdit) {
        await fetch(`${apiUrl}/campaigns/${id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(body),
        });
        navigate(`/field-service/campaigns/${id}`);
      } else {
        const res = await fetch(`${apiUrl}/campaigns`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const created = (await res.json()) as Campaign;
          navigate(`/field-service/campaigns/${created.id}`);
        }
      }
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const canProceedStep1 = title.trim() && template;
  const canProceedStep3 = startDate && endDate;

  // Edit mode: single page form
  if (isEdit || step === -1) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} className="text-[var(--text-muted)]" />
          </button>
          <Megaphone size={20} className="text-[var(--amber)]" />
          <h1 className="text-xl font-semibold text-[var(--text)]">
            {isEdit ? "Edit Campaign" : "New Campaign"}
          </h1>
        </div>

        <div className="space-y-5 p-6 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          {/* Title */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--text-muted)]">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Campaign title"
              className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>

          {/* Template */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--text-muted)]">Type</label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as Template)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            >
              {TEMPLATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-muted)]">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-muted)]">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
              />
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSubmit}
              disabled={saving || !title.trim() || !startDate || !endDate}
              className="px-6 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Wizard mode for creation
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/field-service/campaigns")}
          className="p-2 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} className="text-[var(--text-muted)]" />
        </button>
        <Megaphone size={20} className="text-[var(--amber)]" />
        <h1 className="text-xl font-semibold text-[var(--text)]">New Campaign</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                s < step
                  ? "bg-[var(--green)] text-white"
                  : s === step
                    ? "bg-[var(--amber)] text-black"
                    : "bg-[var(--glass-2)] text-[var(--text-muted)]"
              }`}
            >
              {s < step ? <Check size={14} /> : s}
            </div>
            {s < 3 && (
              <div className={`w-12 h-0.5 ${s < step ? "bg-[var(--green)]" : "bg-[var(--glass-2)]"}`} />
            )}
          </div>
        ))}
        <span className="ml-3 text-xs text-[var(--text-muted)]">
          {step === 1 ? "Name & Type" : step === 2 ? "Select Territories" : "Dates & Description"}
        </span>
      </div>

      {/* Step content */}
      <div className="p-6 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-5">
        {step === 1 && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Tag size={16} className="text-[var(--amber)]" />
              <h2 className="text-sm font-semibold text-[var(--text)]">Name & Type</h2>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-muted)]">Campaign Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Memorial Campaign 2026"
                className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-muted)]">Campaign Type</label>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTemplate(opt.value)}
                    className={`p-3 rounded-[var(--radius-sm)] border text-left transition-colors cursor-pointer ${
                      template === opt.value
                        ? "border-[var(--amber)] bg-[#d9770614]"
                        : "border-[var(--border)] hover:border-[var(--border-2)]"
                    }`}
                  >
                    <p className={`text-sm font-medium ${template === opt.value ? "text-[var(--amber)]" : "text-[var(--text)]"}`}>
                      {opt.label}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{opt.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Map size={16} className="text-[var(--amber)]" />
              <h2 className="text-sm font-semibold text-[var(--text)]">Select Territories</h2>
            </div>
            <input
              type="text"
              value={territorySearch}
              onChange={(e) => setTerritorySearch(e.target.value)}
              placeholder="Search territories..."
              className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)]"
            />
            <p className="text-xs text-[var(--text-muted)]">
              {selectedTerritories.length} selected
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1 border border-[var(--border)] rounded-[var(--radius-sm)] p-2">
              {filteredTerritories.map((t) => {
                const selected = selectedTerritories.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTerritory(t.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors cursor-pointer ${
                      selected
                        ? "bg-[#d9770614] text-[var(--amber)]"
                        : "text-[var(--text)] hover:bg-[var(--glass)]"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                      selected ? "bg-[var(--amber)] border-[var(--amber)]" : "border-[var(--border-2)]"
                    }`}>
                      {selected && <Check size={10} className="text-black" />}
                    </div>
                    <span className="font-medium">#{t.number}</span>
                    {t.name && <span className="text-[var(--text-muted)]">{t.name}</span>}
                  </button>
                );
              })}
              {filteredTerritories.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] text-center py-4">No territories found</p>
              )}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={16} className="text-[var(--amber)]" />
              <h2 className="text-sm font-semibold text-[var(--text)]">Dates & Description</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--text-muted)]">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--text-muted)]">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => step > 1 && setStep(step - 1)}
          disabled={step <= 1}
          className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <ArrowLeft size={14} /> Back
        </button>

        {step < 3 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={step === 1 ? !canProceedStep1 : false}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Next <ArrowRight size={14} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={saving || !canProceedStep3}
            className="flex items-center gap-2 px-6 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? "Creating..." : "Create Campaign"} <Check size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
