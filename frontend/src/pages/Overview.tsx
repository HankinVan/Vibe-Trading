import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  RefreshCw,
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
} from "lucide-react";
import { api, type QuoteItem, type SearchCandidate } from "@/lib/api";
import { safeGet, safeSet } from "@/lib/storage";
import { cn } from "@/lib/utils";

// --- Constants ---

const A_INDEX_SYMBOLS = [
  { key: "ssei", symbol: "000001.SH" },
  { key: "csi300", symbol: "000300.SH" },
  { key: "chiNext", symbol: "399006.SZ" },
];

const US_INDEX_SYMBOLS = [
  { key: "nasdaq", symbol: "^IXIC" },
  { key: "sp500", symbol: "^GSPC" },
  { key: "dowJones", symbol: "^DJI" },
];

const WATCHLIST_A_KEY = "overview-watchlist-a";
const WATCHLIST_US_KEY = "overview-watchlist-us";

interface WatchlistItem {
  symbol: string;
  name: string;
}

// --- Helpers ---

function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function isAShare(symbol: string): boolean {
  return /\.(SH|SZ|BJ)$/i.test(symbol);
}

function isUSStock(symbol: string): boolean {
  return /\.US$/i.test(symbol);
}

// --- Index Card ---

function IndexCard({
  label,
  quote,
}: {
  label: string;
  quote?: QuoteItem;
}) {
  const change = quote?.change_percent ?? null;
  const isUp = change !== null && change > 0;
  const isDown = change !== null && change < 0;

  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-colors hover:border-border">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight">
        {formatNumber(quote?.price)}
      </span>
      <span
        className={cn(
          "mt-1 flex items-center gap-1 font-mono text-sm font-medium tabular-nums",
          isUp && "text-danger",
          isDown && "text-success",
          !isUp && !isDown && "text-muted-foreground",
        )}
      >
        {isUp && <TrendingUp className="h-3.5 w-3.5" />}
        {isDown && <TrendingDown className="h-3.5 w-3.5" />}
        {!isUp && !isDown && <Minus className="h-3.5 w-3.5" />}
        {formatPercent(change)}
      </span>
    </div>
  );
}

// --- Watchlist Row ---

function WatchlistRow({
  item,
  quote,
  onRemove,
}: {
  item: WatchlistItem;
  quote?: QuoteItem;
  onRemove: () => void;
}) {
  const change = quote?.change_percent ?? null;
  const isUp = change !== null && change > 0;
  const isDown = change !== null && change < 0;

  return (
    <div className="group flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{item.name || item.symbol}</span>
        </div>
        <div className="text-xs text-muted-foreground">{item.symbol}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div
            className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              isUp && "text-danger",
              isDown && "text-success",
              !isUp && !isDown && "text-foreground",
            )}
          >
            {formatNumber(quote?.price)}
          </div>
          <div
            className={cn(
              "font-mono text-xs tabular-nums",
              isUp && "text-danger",
              isDown && "text-success",
              !isUp && !isDown && "text-muted-foreground",
            )}
          >
            {formatPercent(change)}
          </div>
        </div>
        <button
          onClick={onRemove}
          className="opacity-0 transition-opacity group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive"
          title="移除"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// --- Add Dialog ---

function AddSymbolDialog({
  open,
  onClose,
  onAdd,
  marketFilter,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (candidate: SearchCandidate) => void;
  marketFilter: "a" | "us";
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.searchSymbol(query.trim(), 10);
        // Filter by market
        const filtered = data.candidates.filter((c) => {
          if (marketFilter === "a") return isAShare(c.symbol);
          if (marketFilter === "us") return isUSStock(c.symbol);
          return true;
        });
        setResults(filtered);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, marketFilter]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border/60 bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{t("overview.addStock")}</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("overview.searchPlaceholder")}
            className="w-full rounded-lg border border-border/60 bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="max-h-72 overflow-y-auto">
          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("overview.loading")}
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("overview.noResults")}
            </div>
          )}
          {!loading && results.length > 0 && (
            <ul className="space-y-1">
              {results.map((c) => (
                <li key={c.symbol}>
                  <button
                    onClick={() => {
                      onAdd(c);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <div>
                      <div className="font-medium">{c.name || c.symbol}</div>
                      <div className="text-xs text-muted-foreground">{c.symbol}</div>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && !query.trim() && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t("overview.searchPlaceholder")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Watchlist Column ---

function WatchlistColumn({
  title,
  items,
  quotes,
  onAdd,
  onRemove,
}: {
  title: string;
  items: WatchlistItem[];
  quotes: Record<string, QuoteItem>;
  onAdd: () => void;
  onRemove: (symbol: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("overview.add")}
        </button>
      </div>
      <div className="flex-1 p-2">
        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("overview.emptyWatchlist")}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.symbol}>
                <WatchlistRow
                  item={item}
                  quote={quotes[item.symbol]}
                  onRemove={() => onRemove(item.symbol)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- Main Overview Page ---

export function Overview() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteItem>>({});

  const [watchlistA, setWatchlistA] = useState<WatchlistItem[]>([]);
  const [watchlistUs, setWatchlistUs] = useState<WatchlistItem[]>([]);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogMarket, setAddDialogMarket] = useState<"a" | "us">("a");

  // Load watchlists from localStorage on mount
  useEffect(() => {
    try {
      const aRaw = safeGet(WATCHLIST_A_KEY);
      if (aRaw) setWatchlistA(JSON.parse(aRaw));
    } catch { /* ignore */ }
    try {
      const usRaw = safeGet(WATCHLIST_US_KEY);
      if (usRaw) setWatchlistUs(JSON.parse(usRaw));
    } catch { /* ignore */ }
  }, []);

  // Persist watchlists
  useEffect(() => {
    safeSet(WATCHLIST_A_KEY, JSON.stringify(watchlistA));
  }, [watchlistA]);

  useEffect(() => {
    safeSet(WATCHLIST_US_KEY, JSON.stringify(watchlistUs));
  }, [watchlistUs]);

  const allSymbols = useMemo(() => {
    const symbols: string[] = [];
    A_INDEX_SYMBOLS.forEach((s) => symbols.push(s.symbol));
    US_INDEX_SYMBOLS.forEach((s) => symbols.push(s.symbol));
    watchlistA.forEach((item) => symbols.push(item.symbol));
    watchlistUs.forEach((item) => symbols.push(item.symbol));
    return [...new Set(symbols)];
  }, [watchlistA, watchlistUs]);

  const fetchAllQuotes = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      if (allSymbols.length === 0) {
        setQuotes({});
        return;
      }
      const data = await api.getQuotes(allSymbols);
      setQuotes(data.quotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [allSymbols]);

  useEffect(() => {
    fetchAllQuotes();
  }, [fetchAllQuotes]);

  const handleAddA = () => {
    setAddDialogMarket("a");
    setAddDialogOpen(true);
  };

  const handleAddUs = () => {
    setAddDialogMarket("us");
    setAddDialogOpen(true);
  };

  const handleAddCandidate = (candidate: SearchCandidate) => {
    const item: WatchlistItem = {
      symbol: candidate.symbol,
      name: candidate.name,
    };

    if (isAShare(candidate.symbol)) {
      setWatchlistA((prev) =>
        prev.some((p) => p.symbol === item.symbol) ? prev : [...prev, item],
      );
    } else if (isUSStock(candidate.symbol)) {
      setWatchlistUs((prev) =>
        prev.some((p) => p.symbol === item.symbol) ? prev : [...prev, item],
      );
    }
  };

  const handleRemoveA = (symbol: string) => {
    setWatchlistA((prev) => prev.filter((p) => p.symbol !== symbol));
  };

  const handleRemoveUs = (symbol: string) => {
    setWatchlistUs((prev) => prev.filter((p) => p.symbol !== symbol));
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("overview.title")}</h1>
        </div>
        <button
          onClick={fetchAllQuotes}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          {loading ? t("overview.refreshing") : t("overview.refresh")}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Error banner */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t("overview.loadError")}: {error}
            </div>
          )}

          {/* A-Share Indices */}
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              {t("overview.aShareIndex")}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {A_INDEX_SYMBOLS.map((idx) => (
                <IndexCard
                  key={idx.symbol}
                  label={t(`overview.${idx.key}` as never)}
                  quote={quotes[idx.symbol]}
                />
              ))}
            </div>
          </section>

          {/* US Indices */}
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              {t("overview.usIndex")}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {US_INDEX_SYMBOLS.map((idx) => (
                <IndexCard
                  key={idx.symbol}
                  label={t(`overview.${idx.key}` as never)}
                  quote={quotes[idx.symbol]}
                />
              ))}
            </div>
          </section>

          {/* Watchlists */}
          <section>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <WatchlistColumn
                title={t("overview.aWatchlist")}
                items={watchlistA}
                quotes={quotes}
                onAdd={handleAddA}
                onRemove={handleRemoveA}
              />
              <WatchlistColumn
                title={t("overview.usWatchlist")}
                items={watchlistUs}
                quotes={quotes}
                onAdd={handleAddUs}
                onRemove={handleRemoveUs}
              />
            </div>
          </section>
        </div>
      </div>

      {/* Add Dialog */}
      <AddSymbolDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdd={handleAddCandidate}
        marketFilter={addDialogMarket}
      />
    </div>
  );
}
