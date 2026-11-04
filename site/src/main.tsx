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
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
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
  RotateCcw,
  Search,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createCatalogRpcClient,
  type CatalogModel,
  type ModelCatalog as CatalogPayload,
} from "../../packages/node/src/rpc.ts";

type Cloud = "aws" | "azure" | "gcp";
type Ranking = CatalogModel["rankings"][number];
type Benchmark = CatalogModel["benchmarks"][number];

interface CatalogRow extends CatalogModel {
  id: string;
  searchText: string;
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
  capabilities: "Capabilities",
  clouds: "Clouds",
  context: "Context",
  inputLimit: "Input limit",
  knowledgeCutoff: "Knowledge cutoff",
  model: "Model",
  openWeights: "Open weights",
  outputLimit: "Output limit",
  publisher: "Publisher",
  rankings: "Best ranking",
  released: "Released",
  status: "Status",
  type: "Type",
  updated: "Updated",
};

const defaultColumnVisibility: VisibilityState = {
  aliases: false,
  benchmarks: false,
  inputLimit: false,
  knowledgeCutoff: false,
  openWeights: false,
  outputLimit: false,
  publisher: false,
  rankings: false,
  released: false,
  type: false,
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

function bestRanking(model: CatalogModel) {
  return [...model.rankings].sort((left, right) => left.rank - right.rank)[0];
}

function topBenchmark(model: CatalogModel) {
  return [...model.benchmarks].sort((left, right) => left.rank - right.rank)[0];
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
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

async function loadCatalog(): Promise<CatalogPayload> {
  const { data, error } = await createCatalogRpcClient().rpc.catalog.get();
  if (data) return data;

  if (window.location.hostname.endsWith(".github.io")) {
    const response = await fetch("catalog.json", { cache: "no-cache" });
    if (response.ok) return await response.json() as CatalogPayload;
  }

  throw new Error(`Catalog RPC failed (${error?.status ?? "unknown"})`);
}

function searchText(id: string, model: CatalogModel) {
  return [
    id,
    model.name,
    model.description,
    model.publisher,
    model.family,
    ...model.aliases,
    ...model.tasks,
    ...model.use_cases,
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

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="detail-section"><h3>{title}</h3>{children}</section>;
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
      <dl className="detail-grid">
        {[
          ["Status", titleCase(model.status)],
          ["Type", titleCase(model.type)],
          ["Publisher", model.publisher ?? "Unknown"],
          ["Context", model.limits?.context ? `${formatNumber(model.limits.context)} tokens` : "—"],
          ["Released", formatDate(model.release_date)],
          ["Updated", formatDate(model.last_updated)],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="detail-columns">
        <DetailSection title="Capabilities"><Chips values={activeCapabilities(model)} limit={8} /></DetailSection>
        <DetailSection title="Cloud availability"><Chips values={activeClouds(model).map(cloud => cloud.toUpperCase())} /></DetailSection>
        <DetailSection title="Input modalities"><Chips values={model.modalities.input} /></DetailSection>
        <DetailSection title="Output modalities"><Chips values={model.modalities.output} /></DetailSection>
        <DetailSection title="Tasks"><Chips values={model.tasks} limit={8} /></DetailSection>
        <DetailSection title="Use cases"><Chips values={model.use_cases} limit={8} /></DetailSection>
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
      </div>
    </>
  );
}

function App() {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [cloud, setCloud] = useState("all");
  const [capability, setCapability] = useState("all");
  const [weights, setWeights] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "model", desc: false }]);
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
    loadCatalog()
      .then(setCatalog)
      .catch(cause => setError(cause instanceof Error ? cause.message : "Could not load the catalog."));
  }, []);

  const models = useMemo<CatalogRow[]>(() =>
    Object.entries(catalog?.models ?? {}).map(([id, model]) => ({ ...model, id, searchText: searchText(id, model) })),
  [catalog]);

  const statuses = useMemo(() => [...new Set(models.map(model => model.status))].sort(), [models]);
  const types = useMemo(() => [...new Set(models.map(model => model.type))].sort(), [models]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return models.filter(model =>
      (!query || model.searchText.includes(query)) &&
      (status === "all" || model.status === status) &&
      (type === "all" || model.type === type) &&
      (cloud === "all" || activeClouds(model).includes(cloud as Cloud)) &&
      (capability === "all" || activeCapabilities(model).includes(capabilityLabels[capability as CapabilityName])) &&
      (weights === "all" || (weights === "open" ? model.open_weights === true : model.open_weights !== true)),
    );
  }, [capability, cloud, models, search, status, type, weights]);

  const columns = useMemo<ColumnDef<CatalogRow>[]>(() => [
    {
      id: "model",
      accessorFn: row => row.name,
      enableHiding: false,
      header: "Model",
      cell: ({ row }) => (
        <button className="model-button" type="button" onClick={() => setSelected(row.original)}>
          <span>{row.original.name}</span>
          <code>{row.original.id}</code>
        </button>
      ),
    },
    { id: "status", accessorKey: "status", header: "Status", cell: info => <span className={`status status-${info.getValue()}`}>{titleCase(String(info.getValue()))}</span> },
    { id: "publisher", accessorKey: "publisher", header: "Publisher", cell: info => String(info.getValue() ?? "—") },
    { id: "type", accessorKey: "type", header: "Type", cell: info => titleCase(String(info.getValue())) },
    { id: "context", accessorFn: row => row.limits?.context, header: "Context", cell: info => formatNumber(info.getValue<number>()) },
    { id: "inputLimit", accessorFn: row => row.limits?.input, header: "Input limit", cell: info => formatNumber(info.getValue<number>()) },
    { id: "outputLimit", accessorFn: row => row.limits?.output, header: "Output limit", cell: info => formatNumber(info.getValue<number>()) },
    { id: "clouds", accessorFn: row => activeClouds(row).length, header: "Clouds", cell: ({ row }) => <Chips values={activeClouds(row.original).map(value => value.toUpperCase())} /> },
    { id: "capabilities", accessorFn: row => activeCapabilities(row).length, header: "Capabilities", cell: ({ row }) => <Chips values={activeCapabilities(row.original)} limit={3} /> },
    { id: "rankings", accessorFn: row => bestRanking(row)?.rank, header: "Best ranking", sortUndefined: "last", cell: ({ row }) => { const ranking = bestRanking(row.original); return ranking ? <span><strong>#{ranking.rank}</strong> {ranking.category}</span> : "—"; } },
    { id: "benchmarks", accessorFn: row => topBenchmark(row)?.rank, header: "Top benchmark", sortUndefined: "last", cell: ({ row }) => { const benchmark = topBenchmark(row.original); return benchmark ? <span><strong>#{benchmark.rank}</strong> {benchmark.name} · {benchmark.score}</span> : "—"; } },
    { id: "openWeights", accessorFn: row => row.open_weights === true ? 1 : 0, header: "Open weights", cell: ({ row }) => row.original.open_weights == null ? "—" : row.original.open_weights ? "Yes" : "No" },
    { id: "released", accessorKey: "release_date", header: "Released", sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "updated", accessorKey: "last_updated", header: "Updated", sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "knowledgeCutoff", accessorKey: "knowledge_cutoff", header: "Knowledge cutoff", sortUndefined: "last", cell: info => formatDate(info.getValue<string>()) },
    { id: "aliases", accessorFn: row => row.aliases.join(", "), header: "Aliases", cell: ({ row }) => <Chips values={row.original.aliases} /> },
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const reset = () => {
    setSearch("");
    setStatus("all");
    setType("all");
    setCloud("all");
    setCapability("all");
    setWeights("all");
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
              <div className="search-control"><Search aria-hidden="true" /><Input id="catalog-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, ID, publisher, task…" /></div>
            </div>
            <SelectFilter label="Status" value={status} onValueChange={setStatus} allLabel="All statuses" options={statuses.map(value => ({ label: titleCase(value), value }))} />
            <SelectFilter label="Type" value={type} onValueChange={setType} allLabel="All types" options={types.map(value => ({ label: titleCase(value), value }))} />
            <SelectFilter label="Cloud" value={cloud} onValueChange={setCloud} allLabel="All clouds" options={["aws", "azure", "gcp"].map(value => ({ label: value.toUpperCase(), value }))} />
            <SelectFilter label="Capability" value={capability} onValueChange={setCapability} allLabel="All capabilities" options={Object.entries(capabilityLabels).map(([value, label]) => ({ label, value }))} />
            <SelectFilter label="Weights" value={weights} onValueChange={setWeights} allLabel="All models" options={[{ label: "Open weights", value: "open" }, { label: "Closed weights", value: "closed" }]} />
          </section>

          <section className="catalog-card" aria-busy={!catalog && !error} aria-live="polite">
            <div className="table-toolbar">
              <div>
                <strong>{error ? "Catalog unavailable" : `${filtered.length} ${filtered.length === 1 ? "model" : "models"}`}</strong>
                <span>{catalog ? `Updated ${formatDateTime(catalog.updated_at)}` : error ?? "Loading catalog…"}</span>
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
                            <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()}>
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === "asc" ? <ArrowUp /> : sorted === "desc" ? <ArrowDown /> : <ChevronsUpDown className="sort-idle" />}
                            </button>
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
              {catalog && !filtered.length && <div className="empty-state"><strong>No matching models</strong><span>Clear a filter or broaden the search.</span></div>}
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
