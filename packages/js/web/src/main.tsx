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
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@databricks/appkit-ui/react";
import { BrandLogo, BrandProvider } from "@dbx-tools/ui/branding/react";
import { JsonBlock } from "@dbx-tools/ui/react";
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
import Aws from "@lobehub/icons/es/Aws";
import Azure from "@lobehub/icons/es/Azure";
import GoogleCloud from "@lobehub/icons/es/GoogleCloud";
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  type ColumnSizingState,
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
  AudioLines,
  ArrowDown,
  ArrowUp,
  Brain,
  Braces,
  ChevronsUpDown,
  Columns3,
  Database,
  Download,
  FileText,
  Filter,
  Github,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  MessageCircle,
  Paperclip,
  RotateCcw,
  Search,
  Table2,
  Type as TextIcon,
  Video,
  Wrench,
} from "lucide-react";
import { type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PUBLISHED_CATALOG_SEARCH_INDEX_URL,
  PUBLISHED_CATALOG_URL,
  createCatalogClient,
  type CatalogClient,
  type CatalogModel,
  type CatalogModelRecord,
  type CatalogSearchIndexPayload,
  type ModelCatalog as CatalogPayload,
  type SourceLink,
} from "@dbx-tools/dbx-model-catalog/browser";
import {
  evaluationVariantLabels,
  reasoningBudgetLabel,
  reasoningControlLabels,
  type EvaluationVariant,
} from "./evaluation.js";
import { searchStaticCatalog } from "./search.js";

declare const __DBX_MODEL_CATALOG_WEB_SOURCE__: "auto" | "github";

type Cloud = "aws" | "azure" | "gcp";
type Ranking = CatalogModel["rankings"][number];
type Benchmark = CatalogModel["benchmarks"][number];
type CatalogIcon = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
  size?: number | string;
}>;

interface CatalogRow extends CatalogModelRecord {
  searchRank: number;
}

interface EnumOption {
  label: string;
  value: string;
}

const capabilityLabels = {
  attachments: "Attachments",
  structured_output: "Structured output",
  tools: "Tools",
  web_search: "Web search",
} as const;
type CapabilityName = keyof typeof capabilityLabels;

const capabilityIcons: Record<string, CatalogIcon> = {
  Attachments: Paperclip,
  Reasoning: Brain,
  "Structured output": Braces,
  Tools: Wrench,
  "Web search": Globe2,
};

const modalityMeta: Record<string, { Icon: CatalogIcon; label: string }> = {
  "application/pdf": { Icon: FileText, label: "PDF" },
  audio: { Icon: AudioLines, label: "Audio" },
  image: { Icon: ImageIcon, label: "Image" },
  text: { Icon: TextIcon, label: "Text" },
  video: { Icon: Video, label: "Video" },
};

const typeMeta: Record<string, { Icon: CatalogIcon; label: string }> = {
  chat: { Icon: MessageCircle, label: "Chat" },
  embedding: { Icon: Database, label: "Embedding" },
  image: { Icon: ImageIcon, label: "Image" },
};

const cloudMeta: Record<Cloud, { Icon: CatalogIcon; label: string }> = {
  aws: { Icon: Aws.Color, label: "AWS" },
  azure: { Icon: Azure.Color, label: "Azure" },
  gcp: { Icon: GoogleCloud.Color, label: "GCP" },
};

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
  reasoningControls: "Reasoning controls",
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

interface TablePreferences {
  columnOrder: ColumnOrderState;
  columnSizing: ColumnSizingState;
  columnVisibility: VisibilityState;
}

interface ColumnDropTarget {
  id: string;
  position: "after" | "before";
}

const tablePreferencesKey = "dbx-model-catalog.table-preferences.v1";
const searchDebounceMs = 350;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadTablePreferences(): TablePreferences {
  const empty: TablePreferences = {
    columnOrder: [],
    columnSizing: {},
    columnVisibility: {},
  };
  if (typeof window === "undefined") return empty;

  try {
    const raw = window.localStorage.getItem(tablePreferencesKey);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return empty;

    const rawOrder = parsed.columnOrder;
    const rawSizing = parsed.columnSizing;
    const rawVisibility = parsed.columnVisibility;
    return {
      columnOrder: Array.isArray(rawOrder)
        ? rawOrder.filter((value): value is string => typeof value === "string")
        : [],
      columnSizing: isRecord(rawSizing)
        ? Object.fromEntries(Object.entries(rawSizing).filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0)) as ColumnSizingState
        : {},
      columnVisibility: isRecord(rawVisibility)
        ? Object.fromEntries(Object.entries(rawVisibility).filter(([, value]) => typeof value === "boolean")) as VisibilityState
        : {},
    };
  } catch {
    return empty;
  }
}

function mergeColumnOrder(saved: ColumnOrderState, available: ColumnOrderState) {
  const known = saved.filter(id => available.includes(id));
  return [...known, ...available.filter(id => !known.includes(id))];
}

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

const publisherIcons: Record<string, CatalogIcon> = {
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
    .filter(name => model.capabilities?.[name] === true)
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

function modelReasoningLabels(model: CatalogModel) {
  return reasoningControlLabels(model.capabilities.reasoning);
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

function humanizeEnum(value: string) {
  const modality = modalityMeta[value];
  if (modality) return modality.label;
  const normalized = value.replaceAll("_", " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  return normalized ? normalized[0].toLocaleUpperCase() + normalized.slice(1) : value;
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

function formatPrice(value: number | undefined) {
  return typeof value === "number"
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
    : "—";
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
  const response = await fetch(PUBLISHED_CATALOG_URL, { cache: "no-cache" });
  if (response.ok) return await response.json() as CatalogPayload;
  throw new Error(`Catalog request failed with ${response.status}`);
}

async function loadStaticSearchIndex(): Promise<CatalogSearchIndexPayload> {
  const response = await fetch(PUBLISHED_CATALOG_SEARCH_INDEX_URL, { cache: "no-cache" });
  if (response.ok) return await response.json() as CatalogSearchIndexPayload;
  throw new Error(`Search index request failed with ${response.status}`);
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
    ...(model.capabilities.reasoning?.supported ? ["reasoning", ...modelReasoningLabels(model)] : []),
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

function Chips({
  values,
  limit = 4,
  kind = "default",
  humanize = false,
}: {
  values: string[];
  limit?: number;
  kind?: "capability" | "default" | "modality";
  humanize?: boolean;
}) {
  if (!values.length) return <span className="muted">—</span>;
  const visible = values.slice(0, limit);
  return (
    <div className="chip-list">
      {visible.map(value => {
        const Icon = kind === "capability"
          ? capabilityIcons[value] ?? (value.toLocaleLowerCase().includes("reasoning") ? Brain : undefined)
          : kind === "modality"
            ? modalityMeta[value]?.Icon
            : undefined;
        const label = humanize || kind === "modality" ? humanizeEnum(value) : value;
        return <Badge className={`enum-chip enum-chip-${kind}`} key={value}>{Icon ? <Icon aria-hidden /> : null}<span>{label}</span></Badge>;
      })}
      {values.length > limit && <span className="more-count">+{values.length - limit}</span>}
    </div>
  );
}

function CloudMark({ cloud }: { cloud: Cloud }) {
  const { Icon, label } = cloudMeta[cloud];
  return <span className="cloud-mark"><Icon aria-hidden className="cloud-logo" size={16} /><span>{label}</span></span>;
}

function CloudChips({ clouds }: { clouds: Cloud[] }) {
  if (!clouds.length) return <span className="muted">—</span>;
  return <div className="chip-list">{clouds.map(cloud => <Badge className="enum-chip cloud-chip" key={cloud}><CloudMark cloud={cloud} /></Badge>)}</div>;
}

function StatusMark({ status }: { status: string }) {
  return <span className={`status status-${status.toLocaleLowerCase().replaceAll("_", "-")}`}>{humanizeEnum(status)}</span>;
}

function TypeMark({ type }: { type: string }) {
  const meta = typeMeta[type];
  if (!meta) return <span>{humanizeEnum(type)}</span>;
  const Icon = meta.Icon;
  return <span className="enum-mark"><Icon aria-hidden /><span>{meta.label}</span></span>;
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

function fieldSources(model: CatalogModel, field: keyof CatalogModel) {
  return model.sources[String(field)] ?? [];
}

function SourceLinks({ sources }: { sources: SourceLink[] }) {
  if (sources.length < 2) return null;
  return (
    <span className="source-links" role="group" aria-label="Sources">
      {sources.map((source, index) => (
        <a
          className="source-link"
          href={source.url}
          key={source.url}
          target="_blank"
          rel="noreferrer"
          title={`Open ${source.label}`}
          aria-label={`Open ${source.label}`}
        >
          <sup>{index + 1}</sup>
        </a>
      ))}
    </span>
  );
}

function SourcedText({ children, sources }: { children: ReactNode; sources: SourceLink[] }) {
  if (sources.length === 1) {
    const [source] = sources;
    return (
      <a className="sourced-text" href={source.url} target="_blank" rel="noreferrer" title={`Open ${source.label}`}>
        {children}
      </a>
    );
  }
  return <>{children}<SourceLinks sources={sources} /></>;
}

function TableSourceLink({ children, sources }: { children: ReactNode; sources: SourceLink[] }) {
  const source = sources[0];
  if (!source) return <>{children}</>;
  return (
    <a className="table-source-link" href={source.url} target="_blank" rel="noreferrer" title={`Open ${source.label}`}>
      {children}
    </a>
  );
}

function EvaluationVariantSummary({ variant }: { variant: EvaluationVariant | null | undefined }) {
  const labels = evaluationVariantLabels(variant);
  return labels.length ? <span className="metric-variant">{labels.join(" · ")}</span> : null;
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

function DetailSection({
  title,
  sources = [],
  wide = false,
  children,
}: {
  title: string;
  sources?: SourceLink[];
  wide?: boolean;
  children: ReactNode;
}) {
  return <section className={`detail-section${wide ? " detail-section-wide" : ""}`}><h3><SourcedText sources={sources}>{title}</SourcedText></h3>{children}</section>;
}

function DetailPair({ children }: { children: ReactNode }) {
  return <div className="detail-section-pair">{children}</div>;
}

function AvailabilityDetails({ model }: { model: CatalogModel }) {
  const entries = Object.entries(model.availability);
  if (!entries.length) return <p className="muted">No availability published.</p>;
  return <ul className="metric-list">{entries.map(([cloud, availability]) => (
    <li key={cloud}>
      <span className="availability-heading">
        <CloudMark cloud={cloud as Cloud} />
        <StatusMark status={availability.status} />
        {availability.serving_modes.length ? <span className="availability-modes">{availability.serving_modes.map(humanizeEnum).join(", ")}</span> : null}
      </span>
      {availability.details ? <span className="metric-detail">{availability.details}</span> : null}
    </li>
  ))}</ul>;
}

function PriceDetails({ model }: { model: CatalogModel }) {
  const prices = Object.entries(model.average_price);
  if (!prices.length) return <p className="muted">No normalized price published.</p>;

  const units = [...new Set(prices.map(([, price]) => price.unit))];
  return <div className="price-tables">{units.map(unit => {
    const unitPrices = prices.filter(([, price]) => price.unit === unit);
    const currencies = unitPrices.map(([currency]) => currency);
    const rateNames = [...new Set(unitPrices.flatMap(([, price]) => Object.keys(price.rates)))];
    const groups: Array<{
      context: string;
      key: string;
      plan: string;
      rows: Array<{ meter: string; rateName: string }>;
    }> = [];

    for (const rateName of rateNames) {
      const dimension = priceDimension(rateName);
      const key = `${dimension.plan}:${dimension.context}`;
      const current = groups.at(-1);
      const group = current?.key === key
        ? current
        : { ...dimension, key, rows: [] };
      if (group !== current) groups.push(group);
      group.rows.push({ meter: dimension.meter, rateName });
    }

    return (
      <div className="price-group" key={unit}>
        <p className="price-unit">{titleCase(unit)}</p>
        <div className="price-table-scroll" role="region" tabIndex={0} aria-label={`${titleCase(unit)} pricing table`}>
          <table className="price-table">
            <thead>
              <tr>
                <th scope="col">Plan</th>
                <th scope="col">Context</th>
                <th scope="col">Meter</th>
                {currencies.map(currency => <th className="price-currency" scope="col" key={currency}>{currency}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((group, groupIndex) => group.rows.map((row, rowIndex) => (
                <tr key={`${group.key}-${groupIndex}-${row.rateName}`}>
                  {rowIndex === 0 ? <th scope="rowgroup" rowSpan={group.rows.length}>{group.plan}</th> : null}
                  {rowIndex === 0 ? <th scope="rowgroup" rowSpan={group.rows.length}>{group.context}</th> : null}
                  <td>{row.meter}</td>
                  {unitPrices.map(([currency, price]) => (
                    <td className="price-number" key={currency}>{formatPrice(price.rates[row.rateName])}</td>
                  ))}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>
    );
  })}</div>;
}

function priceDimension(rateName: string) {
  let value = rateName;
  let plan = "Standard";
  let context = "Any";

  if (value.startsWith("priority_pay_per_token_")) {
    plan = "Priority";
    value = value.slice("priority_pay_per_token_".length);
  }
  if (value.startsWith("short_context_")) {
    context = "Short";
    value = value.slice("short_context_".length);
  } else if (value.startsWith("long_context_")) {
    context = "Long";
    value = value.slice("long_context_".length);
  }

  const meter = titleCase(value)
    .replace(" Tokens ", " ")
    .replace(" 1hr", " (1 hr)");
  return { context, meter, plan };
}

function ReasoningDetails({ model }: { model: CatalogModel }) {
  const reasoning = model.capabilities.reasoning;
  if (!reasoning?.supported) return null;

  const efforts = reasoning.effort ?? [];
  const budget = reasoningBudgetLabel(reasoning.budget);
  const hasDetails = Boolean(
    efforts.length
    || reasoning.default_effort
    || reasoning.toggle != null
    || budget
    || model.capabilities.interleaved_reasoning != null
    || reasoning.description,
  );
  if (!hasDetails) return <p>Supported</p>;

  return (
    <>
      <dl className="reasoning-details">
        {efforts.length ? <div><dt>Effort levels</dt><dd><Chips values={efforts} kind="capability" limit={8} /></dd></div> : null}
        {reasoning.default_effort ? <div><dt>Default effort</dt><dd>{reasoning.default_effort}</dd></div> : null}
        {reasoning.toggle != null ? <div><dt>Toggle</dt><dd>{reasoning.toggle ? "Supported" : "Not supported"}</dd></div> : null}
        {budget ? <div><dt>Token budget</dt><dd>{budget}</dd></div> : null}
        {model.capabilities.interleaved_reasoning != null ? <div><dt>Interleaved reasoning</dt><dd>{model.capabilities.interleaved_reasoning ? "Supported" : "Not supported"}</dd></div> : null}
      </dl>
      {reasoning.description ? <p className="reasoning-description">{reasoning.description}</p> : null}
    </>
  );
}

function ModelDetails({ model }: { model: CatalogRow }) {
  const [view, setView] = useState<"details" | "json">("details");
  const rankings = [...model.rankings].sort((left, right) => left.rank - right.rank);
  const benchmarks = [...model.benchmarks].sort((left, right) => left.rank - right.rank);
  const capabilities = activeCapabilities(model);
  const hasReasoning = model.capabilities.reasoning?.supported === true;
  const hasAvailability = Object.keys(model.availability).length > 0;
  const hasPrice = Object.keys(model.average_price).length > 0;
  const hasRetirement = Boolean(model.retirement && (
    model.retirement.schedules.length ||
    model.retirement.replacement ||
    model.retirement.replacement_name
  ));
  const rawJson = useMemo(() => {
    const { id, searchRank: _searchRank, ...record } = model;
    return JSON.stringify({ id, ...record }, null, 2);
  }, [model]);
  const jsonView = view === "json";
  const ViewIcon = jsonView ? Table2 : Braces;
  const viewLabel = jsonView ? "Show model details" : "Show raw JSON";
  return (
    <>
      <Button
        className="dialog-view-toggle"
        variant="ghost"
        size="icon"
        aria-label={viewLabel}
        aria-pressed={jsonView}
        title={viewLabel}
        onClick={() => setView(current => current === "details" ? "json" : "details")}
      >
        <ViewIcon aria-hidden="true" />
      </Button>
      <DialogHeader>
        <p className="model-id">{model.id}</p>
        <DialogTitle><SourcedText sources={fieldSources(model, "name")}>{model.name}</SourcedText></DialogTitle>
        <DialogDescription className={jsonView ? "visually-hidden" : undefined}>{model.description || "No description is available."}</DialogDescription>
      </DialogHeader>
      {jsonView ? (
        <div className="model-dialog-body model-dialog-json" role="region" tabIndex={0} aria-label={`${model.name} raw JSON`}>
          <JsonBlock className="model-json" json={rawJson} />
        </div>
      ) : <div className="model-dialog-body">
        <dl className="detail-grid">
          {([
            ["status", "Status", <StatusMark status={model.status} />],
            ["type", "Type", <TypeMark type={model.type} />],
            ["publisher", "Publisher", <PublisherMark publisher={model.publisher} />],
            ["family", "Family", model.family ?? "—"],
            ["license", "License", model.license ?? "—"],
            ["open_weights", "Open weights", model.open_weights == null ? "—" : model.open_weights ? "Yes" : "No"],
            ["limits", "Context", model.limits?.context ? `${formatNumber(model.limits.context)} tokens` : "—"],
            ["limits", "Input limit", model.limits?.input ? `${formatNumber(model.limits.input)} tokens` : "—"],
            ["limits", "Output limit", model.limits?.output ? `${formatNumber(model.limits.output)} tokens` : "—"],
            ["release_date", "Released", formatDate(model.release_date)],
            ["last_updated", "Updated", formatDate(model.last_updated)],
            ["knowledge_cutoff", "Knowledge cutoff", formatDate(model.knowledge_cutoff)],
          ] satisfies Array<[keyof CatalogModel, string, ReactNode]>).map(([field, label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="detail-source-row">
                <SourcedText sources={value === "—" ? [] : fieldSources(model, field)}>{value}</SourcedText>
              </dd>
            </div>
          ))}
        </dl>
        <div className="detail-columns">
          {model.aliases.length ? <DetailSection title="Aliases" sources={fieldSources(model, "aliases")} wide><Chips values={model.aliases} limit={12} /></DetailSection> : null}
          {capabilities.length ? <DetailSection title="Capabilities" sources={fieldSources(model, "capabilities")} wide><Chips values={capabilities} kind="capability" limit={8} /></DetailSection> : null}
          {(hasReasoning || hasAvailability) ? <DetailPair>
            {hasReasoning ? <DetailSection title="Reasoning controls" sources={fieldSources(model, "capabilities")}><ReasoningDetails model={model} /></DetailSection> : null}
            {hasAvailability ? <DetailSection title="Cloud availability" sources={fieldSources(model, "availability")}><AvailabilityDetails model={model} /></DetailSection> : null}
          </DetailPair> : null}
          {(model.modalities.input.length || model.modalities.output.length) ? <DetailPair>
            {model.modalities.input.length ? <DetailSection title="Input modalities" sources={fieldSources(model, "modalities")}><Chips values={model.modalities.input} kind="modality" /></DetailSection> : null}
            {model.modalities.output.length ? <DetailSection title="Output modalities" sources={fieldSources(model, "modalities")}><Chips values={model.modalities.output} kind="modality" /></DetailSection> : null}
          </DetailPair> : null}
          {(model.tasks.length || model.use_cases.length) ? <DetailPair>
            {model.tasks.length ? <DetailSection title="Tasks" sources={fieldSources(model, "tasks")}><Chips values={model.tasks} humanize limit={8} /></DetailSection> : null}
            {model.use_cases.length ? <DetailSection title="Use cases" sources={fieldSources(model, "use_cases")}><Chips values={model.use_cases} humanize limit={8} /></DetailSection> : null}
          </DetailPair> : null}
          {(rankings.length || benchmarks.length) ? <DetailPair>
            {rankings.length ? <DetailSection title="Rankings">
              <ul className="metric-list">{rankings.map(ranking => (
                <li key={`${ranking.domain}-${ranking.category}-${ranking.rank}`}>
                  <strong>#{ranking.rank}</strong>{" "}
                  <TableSourceLink sources={ranking.sources}>{titleCase(ranking.domain)}</TableSourceLink>
                  {ranking.category.toLocaleLowerCase() === "overall" ? null : <> · {titleCase(ranking.category)}</>}
                  <EvaluationVariantSummary variant={ranking.variant} />
                </li>
              ))}</ul>
            </DetailSection> : null}
            {benchmarks.length ? <DetailSection title="Benchmarks">
              <ul className="metric-list">{benchmarks.map(benchmark => (
                <li key={`${benchmark.name}-${benchmark.rank}`}>
                  <strong>#{benchmark.rank}</strong> <TableSourceLink sources={benchmark.sources}>{benchmark.name}</TableSourceLink> · {benchmark.score}
                  <EvaluationVariantSummary variant={benchmark.variant} />
                </li>
              ))}</ul>
            </DetailSection> : null}
          </DetailPair> : null}
          {hasPrice ? <DetailSection title="Average price" sources={fieldSources(model, "average_price")} wide><PriceDetails model={model} /></DetailSection> : null}
          {hasRetirement ? <DetailSection title="Retirement" sources={fieldSources(model, "retirement")} wide>
            {model.retirement ? <ul className="metric-list">
              {model.retirement.schedules.map(schedule => <li key={schedule.offering}><strong>{schedule.offering}</strong> · {schedule.dates.map(formatDate).join(", ")}</li>)}
              {(model.retirement.replacement || model.retirement.replacement_name) && <li><strong>Replacement</strong> · {model.retirement.replacement ?? model.retirement.replacement_name}</li>}
            </ul> : null}
          </DetailSection> : null}
          {model.notices.length ? <DetailSection title="Notices" wide>
            <ul className="metric-list">{model.notices.map((notice, index) => (
              <li key={`${notice.kind}-${index}`}>
                <span className="metric-heading"><strong>{notice.title ?? titleCase(notice.kind)}</strong></span>
                <span className="metric-detail">{notice.text}</span>
              </li>
            ))}</ul>
          </DetailSection> : null}
        </div>
      </div>}
    </>
  );
}

function App() {
  const catalogClient = useRef<CatalogClient | null>(null);
  const [initialTablePreferences] = useState(loadTablePreferences);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [staticSearchIndex, setStaticSearchIndex] = useState<CatalogSearchIndexPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState<{ query: string; records: CatalogModelRecord[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "model", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [columnDropTarget, setColumnDropTarget] = useState<ColumnDropTarget | null>(null);
  const [selected, setSelected] = useState<CatalogRow | null>(null);

  const openModel = (model: CatalogRow) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("model") !== model.id) {
      url.searchParams.set("model", model.id);
      window.history.pushState(null, "", url);
    }
    setSelected(model);
  };

  const closeModel = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("model");
    window.history.replaceState(null, "", url);
    setSelected(null);
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => document.documentElement.classList.toggle("dark", media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let active = true;
    const staticCatalog = __DBX_MODEL_CATALOG_WEB_SOURCE__ === "github"
      || window.location.hostname.endsWith(".github.io");
    const client = staticCatalog ? null : createCatalogClient({ baseUrl: catalogWebSocketUrl() });
    catalogClient.current = client;
    const request = client
      ? client.catalog()
      : Promise.all([loadStaticCatalog(), loadStaticSearchIndex()]).then(([value, searchIndex]) => {
          if (active) setStaticSearchIndex(searchIndex);
          return value;
        });
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
    })),
  [catalog]);

  useEffect(() => {
    const syncSelection = () => {
      const modelId = new URL(window.location.href).searchParams.get("model");
      setSelected(modelId ? models.find(model => model.id === modelId) ?? null : null);
    };
    syncSelection();
    window.addEventListener("popstate", syncSelection);
    return () => window.removeEventListener("popstate", syncSelection);
  }, [models]);

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
        : Promise.resolve(
            staticSearchIndex
              ? searchStaticCatalog(staticSearchIndex, models, search.trim())
              : models.filter(model => searchText(model.id, model).includes(normalizedSearch)),
          );
      request
        .then(records => {
          if (active) setSearchResult({ query: normalizedSearch, records });
        })
        .catch(() => {
          if (active) {
            setSearchResult({
              query: normalizedSearch,
              records: models.filter(model => searchText(model.id, model).includes(normalizedSearch)),
            });
          }
        })
        .finally(() => { if (active) setSearching(false); });
    }, searchDebounceMs);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [catalog, models, normalizedSearch, search, staticSearchIndex]);

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
    }));
  }, [hasSearch, models, normalizedSearch, searchResult]);

  const headerFilterOptions = useMemo<Record<string, EnumOption[]>>(() => ({
    capabilities: makeEnumOptions(models.flatMap(activeCapabilities), value => value),
    clouds: makeEnumOptions(models.flatMap(activeClouds), value => cloudMeta[value as Cloud]?.label ?? humanizeEnum(value)),
    family: makeEnumOptions(models.map(model => model.family), value => value),
    inputModalities: makeEnumOptions(models.flatMap(model => model.modalities.input), humanizeEnum),
    license: makeEnumOptions(models.map(model => model.license), value => value),
    openWeights: makeEnumOptions(["No", "Unknown", "Yes"], value => value),
    outputModalities: makeEnumOptions(models.flatMap(model => model.modalities.output), humanizeEnum),
    publisher: makeEnumOptions(models.map(model => model.publisher), value => value),
    reasoningControls: makeEnumOptions(models.flatMap(modelReasoningLabels), value => value),
    servingModes: makeEnumOptions(models.flatMap(servingModes), humanizeEnum),
    status: makeEnumOptions(models.map(model => model.status), humanizeEnum),
    tasks: makeEnumOptions(models.flatMap(model => model.tasks), humanizeEnum),
    type: makeEnumOptions(models.map(model => model.type), humanizeEnum),
    useCases: makeEnumOptions(models.flatMap(model => model.use_cases), humanizeEnum),
  }), [models]);

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
      minSize: 220,
      size: 280,
      maxSize: 560,
      filterFn: (row, _columnId, value) => `${row.original.name} ${row.original.id}`.toLocaleLowerCase().includes(String(value).trim().toLocaleLowerCase()),
      header: "Model",
      cell: ({ row }) => (
        <div className="model-cell">
          <button className="model-button" type="button" onClick={() => openModel(row.original)}>
            <span>{row.original.name}</span>
            <code>{row.original.id}</code>
          </button>
        </div>
      ),
    },
    { id: "status", accessorKey: "status", header: "Status", filterFn: enumFilter, cell: info => <StatusMark status={String(info.getValue())} /> },
    { id: "publisher", accessorKey: "publisher", header: "Publisher", filterFn: enumFilter, cell: ({ row }) => <PublisherMark publisher={row.original.publisher} /> },
    { id: "family", accessorKey: "family", header: "Family", filterFn: enumFilter, cell: info => String(info.getValue() ?? "—") },
    { id: "license", accessorKey: "license", header: "License", filterFn: enumFilter, cell: info => String(info.getValue() ?? "—") },
    { id: "type", accessorKey: "type", header: "Type", filterFn: enumFilter, cell: info => <TypeMark type={String(info.getValue())} /> },
    { id: "context", accessorFn: row => row.limits?.context, header: "Context", filterFn: minimumFilter, sortingFn: numericSorting, sortDescFirst: true, sortUndefined: "last", cell: info => formatNumber(info.getValue<number>()) },
    { id: "inputLimit", accessorFn: row => row.limits?.input, header: "Input limit", filterFn: minimumFilter, sortingFn: numericSorting, sortDescFirst: true, sortUndefined: "last", cell: info => formatNumber(info.getValue<number>()) },
    { id: "outputLimit", accessorFn: row => row.limits?.output, header: "Output limit", filterFn: minimumFilter, sortingFn: numericSorting, sortDescFirst: true, sortUndefined: "last", cell: info => formatNumber(info.getValue<number>()) },
    { id: "clouds", accessorFn: row => activeClouds(row), header: "Clouds", filterFn: enumFilter, cell: ({ row }) => <CloudChips clouds={activeClouds(row.original)} /> },
    { id: "servingModes", accessorFn: row => servingModes(row), header: "Serving modes", filterFn: enumFilter, cell: ({ row }) => <Chips values={servingModes(row.original)} humanize limit={3} /> },
    { id: "capabilities", accessorFn: row => activeCapabilities(row), header: "Capabilities", filterFn: enumFilter, cell: ({ row }) => <Chips values={activeCapabilities(row.original)} kind="capability" limit={3} /> },
    { id: "reasoningControls", accessorFn: row => modelReasoningLabels(row), header: "Reasoning controls", filterFn: enumFilter, cell: ({ row }) => <Chips values={modelReasoningLabels(row.original)} kind="capability" limit={5} /> },
    { id: "inputModalities", accessorFn: row => row.modalities.input, header: "Input modalities", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.modalities.input} kind="modality" /> },
    { id: "outputModalities", accessorFn: row => row.modalities.output, header: "Output modalities", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.modalities.output} kind="modality" /> },
    { id: "tasks", accessorFn: row => row.tasks, header: "Tasks", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.tasks} humanize /> },
    { id: "useCases", accessorFn: row => row.use_cases, header: "Use cases", filterFn: enumFilter, cell: ({ row }) => <Chips values={row.original.use_cases} humanize /> },
    { id: "overallRank", accessorFn: row => bestOverallRanking(row)?.rank, header: "Best overall rank", filterFn: maximumFilter, sortingFn: numericSorting, sortDescFirst: false, sortUndefined: "last", cell: ({ row }) => { const ranking = bestOverallRanking(row.original); return ranking ? <span className="metric-cell"><TableSourceLink sources={ranking.sources}><strong>#{ranking.rank}</strong> {titleCase(ranking.domain)}</TableSourceLink><EvaluationVariantSummary variant={ranking.variant} /></span> : "—"; } },
    { id: "categoryRank", accessorFn: row => bestCategoryRanking(row)?.rank, header: "Best category rank", filterFn: maximumFilter, sortingFn: numericSorting, sortDescFirst: false, sortUndefined: "last", cell: ({ row }) => { const ranking = bestCategoryRanking(row.original); return ranking ? <span className="metric-cell"><TableSourceLink sources={ranking.sources}><strong>#{ranking.rank}</strong> {titleCase(ranking.domain)} · {titleCase(ranking.category)}</TableSourceLink><EvaluationVariantSummary variant={ranking.variant} /></span> : "—"; } },
    { id: "benchmarks", accessorFn: row => topBenchmark(row)?.rank, header: "Top benchmark", filterFn: maximumFilter, sortingFn: numericSorting, sortDescFirst: false, sortUndefined: "last", cell: ({ row }) => { const benchmark = topBenchmark(row.original); return benchmark ? <span className="metric-cell"><TableSourceLink sources={benchmark.sources}><strong>#{benchmark.rank}</strong> {benchmark.name} · {benchmark.score}</TableSourceLink><EvaluationVariantSummary variant={benchmark.variant} /></span> : "—"; } },
    { id: "openWeights", accessorFn: row => row.open_weights == null ? "Unknown" : row.open_weights ? "Yes" : "No", header: "Open weights", filterFn: enumFilter, cell: ({ row }) => row.original.open_weights == null ? "—" : row.original.open_weights ? "Yes" : "No" },
    { id: "released", accessorKey: "release_date", header: "Released", filterFn: textFilter, sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "updated", accessorKey: "last_updated", header: "Updated", filterFn: textFilter, sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "knowledgeCutoff", accessorKey: "knowledge_cutoff", header: "Knowledge cutoff", filterFn: textFilter, sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "aliases", accessorFn: row => row.aliases.join(", "), header: "Aliases", filterFn: textFilter, cell: ({ row }) => <Chips values={row.original.aliases} /> },
  ], []);

  const defaultColumnOrder = useMemo(
    () => columns.map(column => column.id).filter((id): id is string => Boolean(id)),
    [columns],
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => mergeColumnOrder(initialTablePreferences.columnOrder, defaultColumnOrder));
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(initialTablePreferences.columnSizing);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => ({
    ...defaultColumnVisibility,
    ...initialTablePreferences.columnVisibility,
  }));

  useEffect(() => {
    try {
      window.localStorage.setItem(tablePreferencesKey, JSON.stringify({
        columnOrder,
        columnSizing,
        columnVisibility,
      } satisfies TablePreferences));
    } catch {
      // Browsing remains functional when storage is unavailable.
    }
  }, [columnOrder, columnSizing, columnVisibility]);

  const table = useReactTable({
    data: candidates,
    columns,
    state: { sorting, columnFilters, columnOrder, columnSizing, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    columnResizeMode: "onChange",
    defaultColumn: {
      minSize: 80,
      size: 150,
      maxSize: 560,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const visibilityColumns = defaultColumnOrder
    .map(id => table.getColumn(id))
    .filter((column): column is Column<CatalogRow, unknown> => Boolean(column && column.id !== "relevance"));

  const reorderColumn = (sourceId: string, targetId: string, position: ColumnDropTarget["position"]) => {
    if (sourceId === targetId) return;
    setColumnOrder(current => {
      const next = mergeColumnOrder(current, defaultColumnOrder);
      const sourceIndex = next.indexOf(sourceId);
      const targetIndex = next.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [source] = next.splice(sourceIndex, 1);
      const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      next.splice(adjustedTargetIndex + (position === "after" ? 1 : 0), 0, source);
      return next;
    });
  };

  const moveVisibleColumn = (columnId: string, offset: -1 | 1) => {
    const ids = table.getVisibleLeafColumns().map(column => column.id);
    const index = ids.indexOf(columnId);
    const target = ids[index + offset];
    if (!target) return;
    reorderColumn(columnId, target, offset === -1 ? "before" : "after");
  };

  const startColumnDrag = (event: ReactPointerEvent<HTMLButtonElement>, sourceId: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let target: ColumnDropTarget | null = null;

    event.currentTarget.focus();

    const clear = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDraggedColumnId(null);
      setColumnDropTarget(null);
    };

    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      if (!active && Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) < 4) return;

      active = true;
      pointerEvent.preventDefault();
      setDraggedColumnId(sourceId);

      const header = document
        .elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        ?.closest<HTMLElement>("th[data-column-id]");
      const targetId = header?.dataset.columnId;
      if (!header || !targetId || targetId === sourceId) {
        target = null;
        setColumnDropTarget(null);
        return;
      }

      const bounds = header.getBoundingClientRect();
      target = {
        id: targetId,
        position: pointerEvent.clientX < bounds.left + bounds.width / 2 ? "before" : "after",
      };
      setColumnDropTarget(target);
    };

    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      if (active && target) reorderColumn(sourceId, target.id, target.position);
      clear();
    };

    const cancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) clear();
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const reset = () => {
    setSearch("");
    setColumnFilters([]);
    setSorting([{ id: "model", desc: false }]);
    setColumnOrder(defaultColumnOrder);
    setColumnSizing({});
    setColumnVisibility(defaultColumnVisibility);
  };

  return (
    <BrandProvider applyToDocument>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand-block">
            <BrandLogo className="brand-logo" />
            <h1 className="brand-subtitle">Model Catalog</h1>
          </div>
          <div className="header-search" role="search">
            <Label className="visually-hidden" htmlFor="catalog-search">Search catalog</Label>
            <InputGroup className="search-control">
              <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput id="catalog-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, ID, publisher, family, task…" />
            </InputGroup>
          </div>
          <nav className="top-actions" aria-label="Catalog actions">
            <span className="schema-version">v{catalog?.schema_version ?? "—"}</span>
            <Button asChild variant="ghost" size="icon"><a href="https://github.com/reggie-db/dbx-model-catalog" aria-label="Open the GitHub repository" title="GitHub repository"><Github /></a></Button>
            <Button asChild variant="ghost" size="icon"><a href={PUBLISHED_CATALOG_URL} aria-label="Download catalog JSON" title="Download catalog JSON"><Download /></a></Button>
          </nav>
        </header>

        <main>
          <section className="catalog-card" aria-busy={(!catalog && !error) || searching} aria-live="polite">
            <div className="table-toolbar">
              <div>
                <strong>{error ? "Catalog unavailable" : `${table.getFilteredRowModel().rows.length} ${table.getFilteredRowModel().rows.length === 1 ? "model" : "models"}`}</strong>
                <span>{searching ? "Ranking matches…" : catalog ? `Updated ${formatDateTime(catalog.updated_at)}` : error ?? "Loading catalog…"}</span>
              </div>
              <div className="table-actions">
                <Popover>
                  <PopoverTrigger asChild><Button variant="outline" size="sm"><Columns3 /> Columns</Button></PopoverTrigger>
                  <PopoverContent align="end" className="column-menu">
                    <div className="column-menu-heading">Columns</div>
                    <div className="column-menu-separator" />
                    <div className="column-menu-list">
                      {visibilityColumns.map(column => (
                        <div className="column-menu-row" key={column.id}>
                          <button
                            type="button"
                            className="column-toggle"
                            role="checkbox"
                            aria-checked={column.getIsVisible()}
                            disabled={!column.getCanHide()}
                            onPointerDown={event => event.stopPropagation()}
                            onClick={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              column.toggleVisibility();
                            }}
                          >
                            <span className="column-toggle-indicator" aria-hidden="true">
                              {column.getIsVisible() ? "✓" : ""}
                            </span>
                            <span className="column-toggle-label">{columnLabels[column.id] ?? column.id}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="sm" onClick={reset}><RotateCcw /> Reset</Button>
              </div>
            </div>

            <div className="table-scroll">
              <Table className="catalog-table" style={{ width: table.getTotalSize() }}>
                <TableHeader>
                  {table.getHeaderGroups().map(group => (
                    <TableRow key={group.id}>
                      {group.headers.map(header => {
                        const sorted = header.column.getIsSorted();
                        const label = columnLabels[header.column.id] ?? header.column.id;
                        return (
                          <TableHead
                            className="resizable-header"
                            data-column-id={header.column.id}
                            data-dragging={draggedColumnId === header.column.id || undefined}
                            data-drop-position={columnDropTarget?.id === header.column.id ? columnDropTarget.position : undefined}
                            key={header.id}
                            aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                            style={{ width: header.getSize() }}
                          >
                            <div className="table-header-control">
                              <button
                                type="button"
                                className="header-drag-handle"
                                aria-label={`Reorder ${label} column. Drag or use Left and Right Arrow keys.`}
                                title="Drag to reorder · Use Left/Right Arrow keys"
                                onPointerDown={event => startColumnDrag(event, header.column.id)}
                                onKeyDown={event => {
                                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                  event.preventDefault();
                                  moveVisibleColumn(header.column.id, event.key === "ArrowLeft" ? -1 : 1);
                                }}
                              >
                                <GripVertical aria-hidden="true" />
                              </button>
                              <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()}>
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {sorted === "asc" ? <ArrowUp /> : sorted === "desc" ? <ArrowDown /> : <ChevronsUpDown className="sort-idle" />}
                              </button>
                              <HeaderFilter
                                column={header.column}
                                label={label}
                                options={headerFilterOptions[header.column.id]}
                              />
                            </div>
                            {header.column.getCanResize() ? (
                              <button
                                type="button"
                                className={`column-resizer${header.column.getIsResizing() ? " column-resizer-active" : ""}`}
                                aria-label={`Resize ${label}; double-click to reset width`}
                                title="Drag to resize · Double-click to reset width"
                                onClick={event => event.stopPropagation()}
                                onDoubleClick={event => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  header.column.resetSize();
                                }}
                                onMouseDown={header.getResizeHandler()}
                                onTouchStart={header.getResizeHandler()}
                              />
                            ) : null}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map(row => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map(cell => (
                        <TableCell data-column-id={cell.column.id} key={cell.id} style={{ width: cell.column.getSize() }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {catalog && !searching && !table.getRowModel().rows.length && <div className="empty-state"><strong>No matching models</strong><span>Clear a filter or broaden the search.</span></div>}
            </div>
          </section>
        </main>

        <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) closeModel(); }}>
          <DialogContent className="model-dialog">{selected && <ModelDetails model={selected} />}</DialogContent>
        </Dialog>
      </div>
    </BrandProvider>
  );
}

const root = document.querySelector("#root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
