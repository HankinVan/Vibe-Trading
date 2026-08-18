"""Market data HTTP routes — quote snapshots and symbol search.

Mounted by ``agent/api_server.py`` via ``register_market_routes(app)``.

Lightweight read-only endpoints for the dashboard / overview page:
- ``GET /api/quote`` — latest price + change for a batch of symbols
- ``GET /api/search-symbol`` — resolve a name/ticker to candidate symbols
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ============================================================================
# Pydantic Models
# ============================================================================


class QuoteItem(BaseModel):
    """Single symbol quote snapshot."""
    symbol: str = Field(..., description="Normalized symbol code")
    name: Optional[str] = Field(None, description="Display name (if available)")
    price: Optional[float] = Field(None, description="Latest close price")
    prev_close: Optional[float] = Field(None, description="Previous close price")
    change: Optional[float] = Field(None, description="Absolute change (price - prev_close)")
    change_percent: Optional[float] = Field(None, description="Percentage change")


class QuoteResponse(BaseModel):
    """Batch quote response."""
    quotes: Dict[str, QuoteItem] = Field(..., description="Map of symbol -> quote data")
    failed: List[str] = Field(default_factory=list, description="Symbols that could not be resolved")


class SearchCandidate(BaseModel):
    """A single search result candidate."""
    symbol: str = Field(..., description="Normalized symbol code")
    name: str = Field("", description="Company / instrument name")
    market: str = Field("", description="Market / exchange")
    type: str = Field("", description="Security type (stock/index/etf/...)")


class SearchResponse(BaseModel):
    """Symbol search response."""
    query: str
    count: int
    candidates: List[SearchCandidate]


# ============================================================================
# Helpers
# ============================================================================


def _is_us_index(symbol: str) -> bool:
    """Return True if symbol is a Yahoo-style US index (^GSPC, ^DJI, ^IXIC)."""
    return symbol.startswith("^")


def _fetch_latest_quotes(symbols: List[str]) -> Dict[str, Any]:
    """Fetch the most recent two bars for each symbol and compute change.

    Returns a dict with ``quotes`` and ``failed`` keys.
    """
    from src.market_data import fetch_market_data

    end = datetime.now().strftime("%Y-%m-%d")
    # 10 calendar days of history so weekends/holidays never leave us with
    # fewer than two bars (needed for change calculation).
    start = (datetime.now() - timedelta(days=15)).strftime("%Y-%m-%d")

    # Split into groups so we can apply the right source per group.
    index_symbols: List[str] = []
    regular_symbols: List[str] = []
    for s in symbols:
        if _is_us_index(s):
            index_symbols.append(s)
        else:
            regular_symbols.append(s)

    all_results: Dict[str, Any] = {}

    # Regular symbols — auto source detection
    if regular_symbols:
        try:
            result = fetch_market_data(
                codes=regular_symbols,
                start_date=start,
                end_date=end,
                source="auto",
                max_rows=2,
            )
            all_results.update(result)
        except Exception as exc:
            logger.warning("quote fetch failed for regular symbols: %s", exc)

    # US index symbols — explicit yfinance source (^ prefix not in auto patterns)
    if index_symbols:
        try:
            result = fetch_market_data(
                codes=index_symbols,
                start_date=start,
                end_date=end,
                source="yfinance",
                max_rows=2,
            )
            all_results.update(result)
        except Exception as exc:
            logger.warning("quote fetch failed for US index symbols: %s", exc)

    quotes: Dict[str, QuoteItem] = {}
    failed: List[str] = []

    for symbol in symbols:
        bars = all_results.get(symbol)
        # Handle truncated envelope format
        if isinstance(bars, dict) and "data" in bars:
            bars = bars["data"]

        if not bars or not isinstance(bars, list) or len(bars) < 1:
            failed.append(symbol)
            continue

        last_bar = bars[-1]
        price = last_bar.get("close")

        if price is None:
            failed.append(symbol)
            continue

        prev_close = None
        change = None
        change_percent = None

        if len(bars) >= 2:
            prev_bar = bars[-2]
            prev_close = prev_bar.get("close")
            if prev_close is not None and prev_close != 0:
                change = price - prev_close
                change_percent = (change / prev_close) * 100

        quotes[symbol] = QuoteItem(
            symbol=symbol,
            name=None,
            price=price,
            prev_close=prev_close,
            change=change,
            change_percent=change_percent,
        )

    return {"quotes": quotes, "failed": failed}


def _search_symbols(query: str, limit: int = 10) -> SearchResponse:
    """Search for symbols by name/ticker using SymbolSearchTool."""
    from src.tools.symbol_search_tool import SymbolSearchTool

    tool = SymbolSearchTool()
    raw = tool.execute(query=query, limit=limit)
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=500, detail="Search response parse error")

    if not payload.get("ok"):
        raise HTTPException(status_code=400, detail=payload.get("error", "Search failed"))

    data = payload.get("data", {})
    raw_candidates = data.get("candidates", [])

    candidates: List[SearchCandidate] = []
    for c in raw_candidates:
        candidates.append(SearchCandidate(
            symbol=str(c.get("symbol", "")),
            name=str(c.get("name", "")),
            market=str(c.get("market", "")),
            type=str(c.get("type", "")),
        ))

    return SearchResponse(
        query=query,
        count=len(candidates),
        candidates=candidates,
    )


# ============================================================================
# Route registration
# ============================================================================


def register_market_routes(app: FastAPI) -> None:
    """Register market data endpoints on the FastAPI app."""

    @app.get(
        "/api/quote",
        response_model=QuoteResponse,
        tags=["market"],
        summary="Get latest quote snapshots for a list of symbols",
    )
    async def get_quote(
        symbols: str = Query(..., description="Comma-separated list of symbol codes"),
    ):
        """Return latest price and change% for one or more symbols.

        Supports A-shares (600519.SH), HK (00700.HK), US (AAPL.US),
        US indices (^GSPC, ^DJI, ^IXIC), crypto (BTC-USDT), etc.
        """
        symbol_list = [s.strip() for s in symbols.split(",") if s.strip()]
        if not symbol_list:
            raise HTTPException(status_code=400, detail="At least one symbol is required")
        if len(symbol_list) > 50:
            raise HTTPException(status_code=400, detail="Maximum 50 symbols per request")

        result = _fetch_latest_quotes(symbol_list)
        return QuoteResponse(
            quotes=result["quotes"],
            failed=result["failed"],
        )

    @app.get(
        "/api/search-symbol",
        response_model=SearchResponse,
        tags=["market"],
        summary="Search symbols by name or ticker",
    )
    async def search_symbol(
        query: str = Query(..., min_length=1, description="Search query (name or ticker)"),
        limit: int = Query(10, ge=1, le=50, description="Max number of results"),
    ):
        """Search for trading symbols by company name or ticker fragment.

        Sources: Eastmoney (A-shares / HK / US), Yahoo (global).
        """
        return _search_symbols(query, limit)
