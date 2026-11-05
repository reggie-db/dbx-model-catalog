import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@databricks/appkit-ui/react";
import { BrandLogo, BrandProvider } from "@dbx-tools/ui/branding/react";
import AlibabaCloud from "@lobehub/icons/es/AlibabaCloud";
import Anthropic from "@lobehub/icons/es/Anthropic";
import BAAI from "@lobehub/icons/es/BAAI";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Google from "@lobehub/icons/es/Google";
import Meta from "@lobehub/icons/es/Meta";
import Moonshot from "@lobehub/icons/es/Moonshot";
import OpenAI from "@lobehub/icons/es/OpenAI";
import TypeSafeAI from "@lobehub/icons/es/TypeSafeAI";
import XAI from "@lobehub/icons/es/XAI";
import Zhipu from "@lobehub/icons/es/Zhipu";
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingFn,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Columns3,
  Download,
  ExternalLink,
  Filter,
  RotateCcw,
  Search,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createCatalogClient,
  type CatalogClient,
  type CatalogModel,
  type CatalogModelRecord,
  type ModelCatalog as CatalogPayload,
} from "@regbo/dbx-model-catalog-common";

type Cloud = "aws" | "azure" | "gcp";
type Ranking = CatalogModel["rankings"][number];
type Benchmark = CatalogModel["benchmarks"][number];
type PublisherIcon = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
  size?: number | string;
}>;

interface CatalogRow extends CatalogModelRecord {
  searchRank: number;
  searchText: string;
}

interface EnumOption {
  label: string;
  value: string;
}

const capabilityLabels = {
  attachments: "Attachments",
  reasoning: "Reasoning",
  structured_output: "Structured output",
  tools: "Tools",
  web_search: "Web search",
} as const;
type CapabilityName = keyof typeof capabilityLabels;

const columnLabels: Record<string, string> = {
  aliases: "Aliases",
  benchmarks: "Top benchmark",
  categoryRank: "Best category rank",
  capabilities: "Capabilities",
  clouds: "Clouds",
  context: "Context",
  family: "Family",
  inputModalities: "Input modalities",
  inputLimit: "Input limit",
  knowledgeCutoff: "Knowledge cutoff",
  license: "License",
  model: "Model",
  openWeights: "Open weights",
  outputModalities: "Output modalities",
  outputLimit: "Output limit",
  publisher: "Publisher",
  overallRank: "Best overall rank",
  released: "Released",
  servingModes: "Serving modes",
  status: "Status",
  tasks: "Tasks",
  type: "Type",
  updated: "Updated",
  useCases: "Use cases",
};

const defaultColumnVisibility: VisibilityState = {
  aliases: false,
  categoryRank: false,
  inputModalities: false,
  inputLimit: false,
  knowledgeCutoff: false,
  license: false,
  openWeights: false,
  outputModalities: false,
  outputLimit: false,
  relevance: false,
  released: false,
  servingModes: false,
  tasks: false,
  type: false,
  updated: false,
  useCases: false,
};

const textFilter: FilterFn<CatalogRow> = (row, columnId, value) =>
  String(row.getValue(columnId) ?? "").toLocaleLowerCase().includes(String(value).trim().toLocaleLowerCase());

const minimumFilter: FilterFn<CatalogRow> = (row, columnId, value) => {
  const minimum = Number(value);
  const actual = row.getValue<number | undefined>(columnId);
  return !Number.isFinite(minimum) || (typeof actual === "number" && actual >= minimum);
};

const maximumFilter: FilterFn<CatalogRow> = (row, columnId, value) => {
  const maximum = Number(value);
  const actual = row.getValue<number | undefined>(columnId);
  return !Number.isFinite(maximum) || (typeof actual === "number" && actual <= maximum);
};

const enumFilter: FilterFn<CatalogRow> = (row, columnId, value) => {
  const selected = Array.isArray(value) ? value.map(String) : [];
  if (!selected.length) return true;
  const actual = row.getValue<unknown>(columnId);
  const values = Array.isArray(actual) ? actual.map(String) : [String(actual ?? "")];
  return selected.some(candidate => values.includes(candidate));
};

const numericSorting: SortingFn<CatalogRow> = (left, right, columnId) => {
  const leftValue = left.getValue<number | null | undefined>(columnId);
  const rightValue = right.getValue<number | null | undefined>(columnId);
  if (typeof leftValue !== "number") return typeof rightValue === "number" ? 1 : 0;
  if (typeof rightValue !== "number") return -1;
  return leftValue - rightValue;
};

const minimumFilterColumns = new Set(["context", "inputLimit", "outputLimit"]);
const maximumFilterColumns = new Set(["benchmarks", "categoryRank", "overallRank"]);

const publisherIcons: Record<string, PublisherIcon> = {
  "Alibaba Cloud": AlibabaCloud,
  Anthropic,
  BAAI,
  DeepSeek,
  Google,
  Meta,
  "Moonshot AI": Moonshot,
  OpenAI,
  "TypeSafe AI": TypeSafeAI,
  xAI: XAI,
  "Zhipu AI": Zhipu,
};

function activeCapabilities(model: CatalogModel) {
  return (Object.keys(capabilityLabels) as CapabilityName[])
    .filter(name => {
      const value = model.capabilities?.[name];
      return name === "reasoning" ? typeof value === "object" && value?.supported : value === true;
    })
    .map(name => capabilityLabels[name]);
}

function activeClouds(model: CatalogModel) {
  return (Object.entries(model.availability ?? {}) as Array<[Cloud, { status: string }]>)
    .filter(([, availability]) => availability?.status !== "retired")
    .map(([cloud]) => cloud);
}

function servingModes(model: CatalogModel) {
  return [...new Set(Object.values(model.availability).flatMap(availability => availability.serving_modes))];
}

function bestOverallRanking(model: CatalogModel) {
  return model.rankings
    .filter(ranking => ranking.category.toLocaleLowerCase() === "overall")
    .sort((left, right) => left.rank - right.rank)[0];
}

function bestCategoryRanking(model: CatalogModel) {
  return model.rankings
    .filter(ranking => ranking.category.toLocaleLowerCase() !== "overall")
    .sort((left, right) => left.rank - right.rank)[0];
}

function topBenchmark(model: CatalogModel) {
  return [...model.benchmarks].sort((left, right) => left.rank - right.rank)[0];
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function makeEnumOptions(
  values: Array<string | null | undefined>,
  label: (value: string) => string = titleCase,
): EnumOption[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(value => ({ label: label(value), value }));
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? new Intl.NumberFormat().format(value) : "—";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function catalogWebSocketUrl() {
  const baseUrl = new URL(window.location.href);
  baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString();
}

async function loadStaticCatalog(): Promise<CatalogPayload> {
  const response = await fetch("catalog.json", { cache: "no-cache" });
  if (response.ok) return await response.json() as CatalogPayload;
  throw new Error(`Catalog request failed with ${response.status}`);
}

function searchText(id: string, model: CatalogModel) {
  return [
    id,
    model.name,
    model.description,
    model.publisher,
    model.family,
    model.license,
    ...model.aliases,
    ...model.tasks,
    ...model.use_cases,
    ...model.modalities.input,
    ...model.modalities.output,
    ...activeCapabilities(model),
    ...activeClouds(model),
    ...servingModes(model),
    ...model.notices.flatMap(notice => [notice.kind, notice.title, notice.text]),
    ...model.rankings.flatMap(ranking => [ranking.domain, ranking.category]),
    ...model.benchmarks.map(benchmark => benchmark.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function Chips({ values, limit = 4 }: { values: string[]; limit?: number }) {
  if (!values.length) return <span className="muted">—</span>;
  const visible = values.slice(0, limit);
  return (
    <div className="chip-list">
      {visible.map(value => <Badge key={value}>{value}</Badge>)}
      {values.length > limit && <span className="more-count">+{values.length - limit}</span>}
    </div>
  );
}

function PublisherMark({ publisher }: { publisher: string | null | undefined }) {
  if (!publisher) return <span className="muted">—</span>;
  const Icon = publisherIcons[publisher];
  return (
    <span className="publisher-mark">
      {Icon
        ? <Icon aria-hidden className="publisher-logo" size={18} />
        : <span aria-hidden className="publisher-fallback">{publisher.at(0)}</span>}
      <span>{publisher}</span>
    </span>
  );
}

function SelectFilter({
  label,
  value,
  onValueChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  allLabel: string;
}) {
  return (
    <div className="filter-field">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{allLabel}</SelectItem>
          {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function HeaderFilter({
  column,
  label,
  options,
}: {
  column: Column<CatalogRow, unknown>;
  label: string;
  options?: EnumOption[];
}) {
  if (!column.getCanFilter()) return null;
  const current = column.getFilterValue();
  const selected = Array.isArray(current) ? current.map(String) : [];
  const isNumeric = minimumFilterColumns.has(column.id) || maximumFilterColumns.has(column.id);
  const prompt = minimumFilterColumns.has(column.id)
    ? "Minimum value"
    : maximumFilterColumns.has(column.id)
      ? "Maximum rank"
      : `Filter ${label.toLocaleLowerCase()}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`header-filter-trigger${column.getIsFiltered() ? " header-filter-active" : ""}`}
          aria-label={`Filter ${label}`}
          title={`Filter ${label}`}
        >
          <Filter aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="header-filter-menu" onCloseAutoFocus={event => event.preventDefault()}>
        <DropdownMenuLabel>Filter {label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options ? (
          <div className="header-filter-options">
            {options.map(option => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={selected.includes(option.value)}
                onSelect={event => event.preventDefault()}
                onCheckedChange={checked => {
                  const next = checked
                    ? [...selected, option.value]
                    : selected.filter(value => value !== option.value);
                  column.setFilterValue(next.length ? next : undefined);
                }}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        ) : (
          <div className="header-filter-control" onKeyDown={event => event.stopPropagation()}>
            <Input
              autoFocus
              inputMode={isNumeric ? "numeric" : "search"}
              min={isNumeric ? 0 : undefined}
              type={isNumeric ? "number" : "search"}
              value={String(current ?? "")}
              onChange={event => column.setFilterValue(event.target.value || undefined)}
              placeholder={prompt}
              aria-label={prompt}
            />
          </div>
        )}
        <div className="header-filter-footer">
          <Button variant="ghost" size="sm" disabled={!column.getIsFiltered()} onClick={() => column.setFilterValue(undefined)}>
            Clear
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="detail-section"><h3>{title}</h3>{children}</section>;
}

function AvailabilityDetails({ model }: { model: CatalogModel }) {
  const entries = Object.entries(model.availability);
  if (!entries.length) return <p className="muted">No availability published.</p>;
  return <ul className="metric-list">{entries.map(([cloud, availability]) => (
    <li key={cloud}>
      <strong>{cloud.toUpperCase()}</strong> · {titleCase(availability.status)}
      {availability.serving_modes.length ? ` · ${availability.serving_modes.map(titleCase).join(", ")}` : ""}
      {availability.details ? <span className="metric-detail">{availability.details}</span> : null}
    </li>
  ))}</ul>;
}

function PriceDetails({ model }: { model: CatalogModel }) {
  const prices = Object.entries(model.average_price);
  if (!prices.length) return <p className="muted">No normalized price published.</p>;
  return <ul className="metric-list">{prices.map(([currency, price]) => (
    <li key={currency}>
      <strong>{currency}</strong> · {titleCase(price.unit)} · {Object.entries(price.rates).map(([name, value]) => `${titleCase(name)} ${value}`).join(", ")}
    </li>
  ))}</ul>;
}

function ModelDetails({ model }: { model: CatalogRow }) {
  const rankings = [...model.rankings].sort((left, right) => left.rank - right.rank);
  const benchmarks = [...model.benchmarks].sort((left, right) => left.rank - right.rank);
  return (
    <>
      <DialogHeader>
        <p className="model-id">{model.id}</p>
        <DialogTitle>{model.name}</DialogTitle>
        <DialogDescription>{model.description || "No description is available."}</DialogDescription>
      </DialogHeader>
      <div className="model-dialog-body">
        <dl className="detail-grid">
          {([
            ["Status", titleCase(model.status)],
            ["Type", titleCase(model.type)],
            ["Publisher", <PublisherMark publisher={model.publisher} />],
            ["Family", model.family ?? "—"],
            ["License", model.license ?? "—"],
            ["Open weights", model.open_weights == null ? "—" : model.open_weights ? "Yes" : "No"],
            ["Context", model.limits?.context ? `${formatNumber(model.limits.context)} tokens` : "—"],
            ["Input limit", model.limits?.input ? `${formatNumber(model.limits.input)} tokens` : "—"],
            ["Output limit", model.limits?.output ? `${formatNumber(model.limits.output)} tokens` : "—"],
            ["Released", formatDate(model.release_date)],
            ["Updated", formatDate(model.last_updated)],
            ["Knowledge cutoff", formatDate(model.knowledge_cutoff)],
          ] satisfies Array<[string, ReactNode]>).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <div className="detail-columns">
          <DetailSection title="Capabilities"><Chips values={activeCapabilities(model)} limit={8} /></DetailSection>
          <DetailSection title="Cloud availability"><AvailabilityDetails model={model} /></DetailSection>
          <DetailSection title="Input modalities"><Chips values={model.modalities.input} /></DetailSection>
          <DetailSection title="Output modalities"><Chips values={model.modalities.output} /></DetailSection>
          <DetailSection title="Tasks"><Chips values={model.tasks} limit={8} /></DetailSection>
          <DetailSection title="Use cases"><Chips values={model.use_cases} limit={8} /></DetailSection>
          <DetailSection title="Average price"><PriceDetails model={model} /></DetailSection>
          <DetailSection title="Retirement">
            {model.retirement ? <ul className="metric-list">
              {model.retirement.schedules.map(schedule => <li key={schedule.offering}><strong>{schedule.offering}</strong> · {schedule.dates.map(formatDate).join(", ")}</li>)}
              {(model.retirement.replacement || model.retirement.replacement_name) && <li><strong>Replacement</strong> · {model.retirement.replacement ?? model.retirement.replacement_name}</li>}
            </ul> : <p className="muted">No retirement scheduled.</p>}
          </DetailSection>
          <DetailSection title="Rankings">
            {rankings.length ? <ul className="metric-list">{rankings.map(ranking => (
              <li key={`${ranking.domain}-${ranking.category}-${ranking.rank}`}>
                <strong>#{ranking.rank}</strong> {ranking.domain} · {ranking.category}
              </li>
            ))}</ul> : <p className="muted">No rankings published.</p>}
          </DetailSection>
          <DetailSection title="Benchmarks">
            {benchmarks.length ? <ul className="metric-list">{benchmarks.map(benchmark => (
              <li key={`${benchmark.name}-${benchmark.rank}`}>
                <strong>#{benchmark.rank}</strong> {benchmark.name} · {benchmark.score}
              </li>
            ))}</ul> : <p className="muted">No benchmarks published.</p>}
          </DetailSection>
          <DetailSection title="Aliases"><Chips values={model.aliases} limit={12} /></DetailSection>
          <DetailSection title="Notices">
            {model.notices.length ? <ul className="metric-list">{model.notices.map((notice, index) => (
              <li key={`${notice.kind}-${index}`}><strong>{notice.title ?? titleCase(notice.kind)}</strong><span className="metric-detail">{notice.text}</span></li>
            ))}</ul> : <p className="muted">No notices published.</p>}
          </DetailSection>
        </div>
      </div>
    </>
  );
}

function App() {
  const catalogClient = useRef<CatalogClient | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<{ query: string; records: CatalogModelRecord[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [cloud, setCloud] = useState("all");
  const [capability, setCapability] = useState("all");
  const [weights, setWeights] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "model", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(defaultColumnVisibility);
  const [selected, setSelected] = useState<CatalogRow | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => document.documentElement.classList.toggle("dark", media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let active = true;
    const staticCatalog = window.location.hostname.endsWith(".github.io");
    const client = staticCatalog ? null : createCatalogClient({ baseUrl: catalogWebSocketUrl() });
    catalogClient.current = client;
    const request = client ? client.catalog() : loadStaticCatalog();
    request
      .then(value => { if (active) setCatalog(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Could not load the catalog."); });
    return () => {
      active = false;
      client?.close();
      if (catalogClient.current === client) catalogClient.current = null;
    };
  }, []);

  const models = useMemo<CatalogRow[]>(() =>
    Object.entries(catalog?.models ?? {}).map(([id, model]) => ({
      ...model,
      id,
      searchRank: Number.MAX_SAFE_INTEGER,
      searchText: searchText(id, model),
    })),
  [catalog]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const hasSearch = Boolean(normalizedSearch);

  useEffect(() => {
    if (!normalizedSearch || !catalog) {
      setSearchResult(null);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timeout = window.setTimeout(() => {
      const client = catalogClient.current;
      const request = client
        ? client.list({ query: search.trim(), limit: 1_000 })
        : Promise.resolve(models.filter(model => model.searchText.includes(normalizedSearch)));
      request
        .then(records => {
          if (active) setSearchResult({ query: normalizedSearch, records });
        })
        .catch(() => {
          if (active) {
            setSearchResult({
              query: normalizedSearch,
              records: models.filter(model => model.searchText.includes(normalizedSearch)),
            });
          }
        })
        .finally(() => { if (active) setSearching(false); });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [catalog, models, normalizedSearch, search]);

  useEffect(() => {
    setSorting(current => {
      if (hasSearch && current.length === 1 && current[0]?.id === "model" && !current[0].desc) {
        return [{ id: "relevance", desc: false }];
      }
      if (!hasSearch && current.length === 1 && current[0]?.id === "relevance") {
        return [{ id: "model", desc: false }];
      }
      return current;
    });
  }, [hasSearch]);

  const candidates = useMemo<CatalogRow[]>(() => {
    if (!hasSearch) return models;
    if (searchResult?.query !== normalizedSearch) return [];
    return searchResult.records.map((model, searchRank) => ({
      ...model,
      searchRank,
      searchText: searchText(model.id, model),
    }));
  }, [hasSearch, models, normalizedSearch, searchResult]);

  const statuses = useMemo(() => [...new Set(models.map(model => model.status))].sort(), [models]);
  const types = useMemo(() => [...new Set(models.map(model => model.type))].sort(), [models]);

  const headerFilterOptions = useMemo<Record<string, EnumOption[]>>(() => ({
    capabilities: makeEnumOptions(models.flatMap(activeCapabilities), value => value),
    clouds: makeEnumOptions(models.flatMap(activeClouds), value => value.toUpperCase()),
    family: makeEnumOptions(models.map(model => model.family), value => value),
    inputModalities: makeEnumOptions(models.flatMap(model => model.modalities.input)),
    license: makeEnumOptions(models.map(model => model.license), value => value),
    openWeights: makeEnumOptions(["No", "Unknown", "Yes"], value => value),
    outputModalities: makeEnumOptions(models.flatMap(model => model.modalities.output)),
    publisher: makeEnumOptions(models.map(model => model.publisher), value => value),
    servingModes: makeEnumOptions(models.flatMap(servingModes)),
    status: makeEnumOptions(models.map(model => model.status)),
    tasks: makeEnumOptions(models.flatMap(model => model.tasks)),
    type: makeEnumOptions(models.map(model => model.type)),
    useCases: makeEnumOptions(models.flatMap(model => model.use_cases)),
  }), [models]);

  const filtered = useMemo(() => {
    return candidates.filter(model =>
      (status === "all" || model.status === status) &&
      (type === "all" || model.type === type) &&
      (cloud === "all" || activeClouds(model).includes(cloud as Cloud)) &&
      (capability === "all" || activeCapabilities(model).includes(capabilityLabels[capability as CapabilityName])) &&
      (weights === "all" || (weights === "open" ? model.open_weights === true : model.open_weights !== true)),
    );
  }, [candidates, capability, cloud, status, type, weights]);

  const columns = useMemo<ColumnDef<CatalogRow>[]>(() => [
    {
      id: "relevance",
      accessorKey: "searchRank",
      enableColumnFilter: false,
      enableHiding: false,
      header: "Relevance",
      sortingFn: numericSorting,
    },
    {
      id: "model",
      accessorFn: row => row.name,
      enableHiding: false,
      filterFn: (row, _columnId, value) => `${row.original.name} ${row.original.id}`.toLocaleLowerCase().includes(String(value).trim().toLocaleLowerCase()),
      header: "Model",
      cell: ({ row }) => (
        <button className="model-button" type="button" onClick={() => setSelected(row.original)}>
          <span>{row.original.name}</span>
          <code>{row.original.id}</code>
        </button>
      ),
    },
    { id: "status", accessorKey: "status", header: "Status", filterFn: enumFilter, cell: info => <span className={`status status-${info.getValue()}`}>{titleCase(String(info.getValue()))}</span> },
    { id: "publisher", accessorKey: "publisher", header: "Publisher", filterFn: enumFilter, cell: ({ row }) => <PublisherMark publisher={row.original.publisher} /> },
    { id: "family", accessorKey: "family", header: "Family", filterFn: enumFilter, cell: info => String(info.getValue() ?? "—") },
    { id: "license", accessorKey: "license", header: "License", filterFn: enumFilter, cell: info => String(info.getValue() ?? "—") },
    { id: "type", accessorKey: "type", header: "Type", filterFn: enumFilter, cell: info => titleCase(String(info.getValue())) },
    { id: "context", accessorFn: row => row.limits?.context, header: "Context", filterFn: minimumFilter, sortingFn: numericSorting, sortDescFirst: true, sortUndefined: "last", cell: info => formatNumber(info.getValue<number>()) },
    { id: "inputLimit", accessorFn: row => row.limits?.input, header: "Input limit", filterFn: minimumFilter, sortingFn: numericSorting, sortDescFirst: true, sortUndefined: "last", cell: info => formatNumber(info.getValue<number>()) },
    { id: "outputLimit", accessorFn: row => row.limits?.output, header: "Output limit", filterFn: minimumFilter, sortingFn: numericSorting, sortDescFirst: true, sortUndefined: "last", cell: info => formatNumber(info.getValue<number>()) },
    { id: "clouds", accessorFn: row => activeClouds(row), header: "Clouds", filterFn: enumFilter, cell: ({ row }) => <Chips values={activeClouds(row.original).map(value => value.toUpperCase())} /> },
    { id: "servingModes", accessorFn: row => servingModes(row), header: "Serving modes", filterFn: enumFilter, cell: ({ row }) => <Chips values={servingModes(row.original).map(titleCase)} limit={3} /> },
    { id: "capabilities", accessorFn: row => activeCapabilities(row), header: "Capabilities", filterFn: enumFilter, cell: ({ row }) => <Chips values={activeCapabilities(row.original)} limit={3} /> },
    { id: "inputModalities", accessorFn: row => row.modalities.input, header: "Input modalities", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.modalities.input} /> },
    { id: "outputModalities", accessorFn: row => row.modalities.output, header: "Output modalities", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.modalities.output} /> },
    { id: "tasks", accessorFn: row => row.tasks, header: "Tasks", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.tasks} /> },
    { id: "useCases", accessorFn: row => row.use_cases, header: "Use cases", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.use_cases} /> },
    { id: "overallRank", accessorFn: row => bestOverallRanking(row)?.rank, header: "Best overall rank", filterFn: maximumFilter, sortingFn: numericSorting, sortDescFirst: false, sortUndefined: "last", cell: ({ row }) => { const ranking = bestOverallRanking(row.original); return ranking ? <span><strong>#{ranking.rank}</strong> {titleCase(ranking.domain)}</span> : "—"; } },
    { id: "categoryRank", accessorFn: row => bestCategoryRanking(row)?.rank, header: "Best category rank", filterFn: maximumFilter, sortingFn: numericSorting, sortDescFirst: false, sortUndefined: "last", cell: ({ row }) => { const ranking = bestCategoryRanking(row.original); return ranking ? <span><strong>#{ranking.rank}</strong> {titleCase(ranking.domain)} · {titleCase(ranking.category)}</span> : "—"; } },
    { id: "benchmarks", accessorFn: row => topBenchmark(row)?.rank, header: "Top benchmark", filterFn: maximumFilter, sortingFn: numericSorting, sortDescFirst: false, sortUndefined: "last", cell: ({ row }) => { const benchmark = topBenchmark(row.original); return benchmark ? <span><strong>#{benchmark.rank}</strong> {benchmark.name} · {benchmark.score}</span> : "—"; } },
    { id: "openWeights", accessorFn: row => row.open_weights == null ? "Unknown" : row.open_weights ? "Yes" : "No", header: "Open weights", filterFn: enumFilter, cell: ({ row }) => row.original.open_weights == null ? "—" : row.original.open_weights ? "Yes" : "No" },
    { id: "released", accessorKey: "release_date", header: "Released", filterFn: textFilter, sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "updated", accessorKey: "last_updated", header: "Updated", filterFn: textFilter, sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "knowledgeCutoff", accessorKey: "knowledge_cutoff", header: "Knowledge cutoff", filterFn: textFilter, sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "aliases", accessorFn: row => row.aliases.join(", "), header: "Aliases", filterFn: textFilter, cell: ({ row }) => <Chips values={row.original.aliases} /> },
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const reset = () => {
    setSearch("");
    setStatus("all");
    setType("all");
    setCloud("all");
    setCapability("all");
    setWeights("all");
    setColumnFilters([]);
    setSorting([{ id: "model", desc: false }]);
  };

  const summary = {
    active: models.filter(model => model.status === "active").length,
    multiCloud: models.filter(model => activeClouds(model).length === 3).length,
    open: models.filter(model => model.open_weights === true).length,
    ranked: models.filter(model => model.rankings.length || model.benchmarks.length).length,
  };

  return (
    <BrandProvider applyToDocument>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-block">
            <BrandLogo className="brand-logo" />
            <span className="brand-divider" aria-hidden="true" />
            <div><h1>Model Catalog</h1><p>Databricks serving models</p></div>
          </div>
          <nav className="top-actions" aria-label="Catalog downloads">
            <Button asChild variant="outline" size="sm"><a href="catalog.json" download><Download /> JSON</a></Button>
            <Button asChild variant="outline" size="sm"><a href="catalog.json.br" download><Download /> Brotli</a></Button>
          </nav>
        </header>

        <main>
          <section className="summary-grid" aria-label="Catalog summary">
            {[
              ["Models", models.length],
              ["Active", summary.active],
              ["Open weights", summary.open],
              ["Multi-cloud", summary.multiCloud],
              ["Ranked / benchmarked", summary.ranked],
            ].map(([label, value]) => <div className="summary-item" key={label}><strong>{value}</strong><span>{label}</span></div>)}
          </section>

          <section className="filters" aria-label="Catalog filters">
            <div className="search-field">
              <Label htmlFor="catalog-search">Search</Label>
              <div className="search-control"><Search aria-hidden="true" /><Input id="catalog-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, ID, publisher, family, task…" /></div>
            </div>
            <SelectFilter label="Status" value={status} onValueChange={setStatus} allLabel="All statuses" options={statuses.map(value => ({ label: titleCase(value), value }))} />
            <SelectFilter label="Type" value={type} onValueChange={setType} allLabel="All types" options={types.map(value => ({ label: titleCase(value), value }))} />
            <SelectFilter label="Cloud" value={cloud} onValueChange={setCloud} allLabel="All clouds" options={["aws", "azure", "gcp"].map(value => ({ label: value.toUpperCase(), value }))} />
            <SelectFilter label="Capability" value={capability} onValueChange={setCapability} allLabel="All capabilities" options={Object.entries(capabilityLabels).map(([value, label]) => ({ label, value }))} />
            <SelectFilter label="Weights" value={weights} onValueChange={setWeights} allLabel="All models" options={[{ label: "Open weights", value: "open" }, { label: "Closed weights", value: "closed" }]} />
          </section>

          <section className="catalog-card" aria-busy={(!catalog && !error) || searching} aria-live="polite">
            <div className="table-toolbar">
              <div>
                <strong>{error ? "Catalog unavailable" : `${table.getFilteredRowModel().rows.length} ${table.getFilteredRowModel().rows.length === 1 ? "model" : "models"}`}</strong>
                <span>{searching ? "Ranking matches…" : catalog ? `Updated ${formatDateTime(catalog.updated_at)}` : error ?? "Loading catalog…"}</span>
              </div>
              <div className="table-actions">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Columns3 /> Columns</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="column-menu">
                    <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {table.getAllLeafColumns().filter(column => column.getCanHide()).map(column => (
                      <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onSelect={event => event.preventDefault()} onCheckedChange={value => column.toggleVisibility(Boolean(value))}>
                        {columnLabels[column.id] ?? column.id}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" onClick={reset}><RotateCcw /> Reset</Button>
              </div>
            </div>

            <div className="table-scroll">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map(group => (
                    <TableRow key={group.id}>
                      {group.headers.map(header => {
                        const sorted = header.column.getIsSorted();
                        return (
                          <TableHead key={header.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                            <div className="table-header-control">
                              <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()}>
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {sorted === "asc" ? <ArrowUp /> : sorted === "desc" ? <ArrowDown /> : <ChevronsUpDown className="sort-idle" />}
                              </button>
                              <HeaderFilter
                                column={header.column}
                                label={columnLabels[header.column.id] ?? header.column.id}
                                options={headerFilterOptions[header.column.id]}
                              />
                            </div>
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map(row => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map(cell => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {catalog && !searching && !table.getRowModel().rows.length && <div className="empty-state"><strong>No matching models</strong><span>Clear a filter or broaden the search.</span></div>}
            </div>
          </section>
        </main>

        <footer>
          <span>Schema v{catalog?.schema_version ?? "—"} · Python-normalized published dataset</span>
          <a href="https://github.com/reggie-db/dbx-model-catalog">Source repository <ExternalLink /></a>
        </footer>

        <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}>
          <DialogContent className="model-dialog">{selected && <ModelDetails model={selected} />}</DialogContent>
        </Dialog>
      </div>
    </BrandProvider>
  );
}

const root = document.querySelector("#root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
