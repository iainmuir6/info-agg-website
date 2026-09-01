"""
weather.py

Lightweight wrapper around the Visual Crossing Timeline Weather API,
plus Plotly chart builders for temperature, precipitation, wind, and daily overview.

Chart builders default to **daily** resolution (``include=current,days`` on the API).
Pass ``resolution=\"hourly\"`` and supply data from ``timeline_to_hourly_df`` after
requesting ``include`` with ``hours``.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Literal, Optional

import requests
from dotenv import load_dotenv

# The plotting stack is OPTIONAL and must stay that way.
#
# This module has two halves: two thin fetchers the ETL uses
# (get_weather_api_key / fetch_weather_timeline, which need nothing but
# requests) and a set of Plotly chart builders used only from notebooks.
# requirements-dev.txt says of pandas/plotly "Not installed by the scheduled
# GitHub Actions runs", and requirements.txt lists neither — so importing them
# at module scope made the ENTIRE ETL unimportable without them.
#
# That went unnoticed because the Actions runner image happened to ship numpy,
# so the scheduled runs were quietly depending on an incidental system package.
# When that stopped being true every run died at import with
# "ModuleNotFoundError: No module named 'numpy'" before it could record a row
# in etl_runs — the daily and both intraday tiers at once.
#
# `from __future__ import annotations` above makes every annotation a string,
# so the type hints below cost nothing at runtime.
if TYPE_CHECKING:  # pragma: no cover
    import numpy as np
    import pandas as pd

try:
    import numpy as np
    import pandas as pd
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots

    _CHARTS_AVAILABLE = True
except ModuleNotFoundError:
    np = pd = go = make_subplots = None  # type: ignore[assignment]
    _CHARTS_AVAILABLE = False

load_dotenv()

ROOT_DIR = os.getenv("ROOT_DIR")

VISUAL_CROSSING_BASE_URL = (
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline"
)

TEXT_COLOR = "#00427A"
PLOT_BG = "#1e2d3d"
PAPER_BG = "#243445"
TEMP_LINE_COLOR = "#f1c40f"
RIBBON_FILL = "rgba(72, 209, 204, 0.35)"
DEFAULT_ICON_PATH = "/assets/misc/weather-icons/"

Resolution = Literal["daily", "hourly"]


def _require_charts() -> None:
    """Fail loudly, and usefully, if a chart helper is called without its deps.

    Without this the first use of `pd`/`np` raises a bare
    "NoneType has no attribute ...", which says nothing about the real fix.
    """
    if not _CHARTS_AVAILABLE:
        raise ModuleNotFoundError(
            "weather.py chart helpers need pandas/plotly, which the scheduled "
            "ETL deliberately does not install. Run `pip install -r "
            "requirements-dev.txt` for notebook use."
        )


def get_weather_api_key() -> str:
    """
    Get the Visual Crossing API key from environment variables.

    Expects WEATHER_API_KEY to be set in .env/.env.local.
    """
    api_key = os.getenv("WEATHER_API_KEY")
    if not api_key:
        raise ValueError("WEATHER_API_KEY must be set in environment variables")
    return api_key


def fetch_weather_timeline(
    location: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    unit_group: str = "us",
    include: str = "current,days",
    api_key: Optional[str] = None,
    extra_params: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch timeline weather data for a given location from Visual Crossing.

    Args:
        location: Location string (e.g. "New York,US" or "40.7128,-74.0060").
        start_date: Optional start date in YYYY-MM-DD; defaults to "today".
        end_date: Optional end date in YYYY-MM-DD; defaults to start_date.
        unit_group: "metric" or "us".
        include: Comma-separated include flags (e.g. "current,days").
        api_key: Optional explicit API key; falls back to WEATHER_API_KEY env var.
        extra_params: Additional query parameters to merge into the request.

    Returns:
        Parsed JSON dict on success, or None on error.
    """
    if api_key is None:
        try:
            api_key = get_weather_api_key()
        except ValueError as e:
            print(f"Weather API skipped: {e}")
            return None

    if start_date is None:
        start_date = datetime.utcnow().strftime("%Y-%m-%d")
    if end_date is None:
        end_date = start_date

    url = f"{VISUAL_CROSSING_BASE_URL}/{location}/{start_date}/{end_date}"

    params: Dict[str, Any] = {
        "key": api_key,
        "unitGroup": unit_group,
        "include": include,
        "contentType": "json",
    }

    if extra_params:
        params.update(extra_params)

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        data["fetched_at"] = datetime.utcnow().isoformat()
        return data

    except requests.exceptions.RequestException as e:
        print(f"Error fetching weather data from Visual Crossing: {e}")
        return None
    except ValueError as e:
        print(f"Error parsing weather data from Visual Crossing: {e}")
        return None


def timeline_to_hourly_df(data: Optional[Dict[str, Any]]) -> pd.DataFrame:
    """
    Flatten Visual Crossing timeline JSON into one row per hour.

    Expects ``days[].hours`` (request ``include`` with ``hours``).
    Adds ``date``, ``tempmin_day``, ``tempmax_day``, ``feelslikemin_day``, ``feelslikemax_day``
    from each parent day.
    """
    _require_charts()
    if not data:
        return pd.DataFrame()

    rows: List[Dict[str, Any]] = []
    for day in data.get("days") or []:
        day_date = (day.get("datetime") or "")[:10]
        tempmin = day.get("tempmin")
        tempmax = day.get("tempmax")
        flmin = day.get("feelslikemin")
        flmax = day.get("feelslikemax")
        for h in day.get("hours") or []:
            row = dict(h)
            row["date"] = day_date
            row["tempmin_day"] = tempmin
            row["tempmax_day"] = tempmax
            row["feelslikemin_day"] = flmin
            row["feelslikemax_day"] = flmax
            rows.append(row)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    if "datetime" in df.columns:
        df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    return df


def timeline_to_daily_df(data: Optional[Dict[str, Any]]) -> pd.DataFrame:
    """Build a DataFrame with one row per day from ``days``."""
    _require_charts()
    if not data or not data.get("days"):
        return pd.DataFrame()
    return pd.DataFrame(data["days"])


def _brand_axis_title(title: str) -> Dict[str, Any]:
    return dict(text=title, font=dict(color=TEXT_COLOR, size=13, family="Arial Black"))


def _apply_brand_layout(
    fig: go.Figure,
    *,
    height: Optional[int] = 420,
    title: Optional[str] = None,
    yaxis2: bool = False,
) -> go.Figure:
    fig.update_layout(
        paper_bgcolor=PAPER_BG,
        plot_bgcolor=PLOT_BG,
        font=dict(color=TEXT_COLOR, size=11),
        title=dict(text=title, font=dict(color=TEXT_COLOR, size=15)) if title else None,
        legend=dict(font=dict(color=TEXT_COLOR)),
        height=height,
        margin=dict(l=50, r=70, t=80 if title else 50, b=50),
    )
    axis_common = dict(
        gridcolor="rgba(255,255,255,0.12)",
        linecolor=TEXT_COLOR,
        tickfont=dict(color=TEXT_COLOR),
        zeroline=False,
    )
    fig.update_xaxes(**axis_common)
    fig.update_yaxes(**axis_common)
    if yaxis2:
        fig.update_yaxes(
            title=_brand_axis_title("Wind direction (°)"),
            secondary_y=True,
            tickmode="array",
            tickvals=[0, 90, 180, 270, 360],
            ticktext=["N", "E", "S", "W", "N"],
        )
    return fig


def _hours_since_midnight(series: pd.Series) -> np.ndarray:
    return (
        series.dt.hour.astype(float)
        + series.dt.minute.astype(float) / 60.0
        + series.dt.second.astype(float) / 3600.0
    )


def _diurnal_upper_lower(
    hours: np.ndarray,
    tmin: np.ndarray,
    tmax: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Smooth envelope: wide near local noon, narrow near midnight."""
    phase = 2.0 * np.pi * hours / 24.0
    span = np.asarray(tmax, dtype=float) - np.asarray(tmin, dtype=float)
    upper = np.asarray(tmin, dtype=float) + span * (0.5 - 0.5 * np.cos(phase))
    lower = np.asarray(tmin, dtype=float) + span * (0.5 - 0.5 * np.cos(phase)) * 0.35
    return upper, lower


def build_temperature_chart(
    df: pd.DataFrame,
    *,
    resolution: Resolution = "daily",
    series: Literal["temp", "feelslike"] = "temp",
    title: Optional[str] = None,
) -> go.Figure:
    """
    Temperature chart with min/max ribbon and spline main series.

    **resolution=\"daily\" (default):** one point per day. Ribbon is ``tempmin``–``tempmax``
    (or feels-like min/max). Main line uses daily ``temp`` / ``feelslike`` when present,
    else the midpoint of min/max.

    **resolution=\"hourly\":** one point per hour. Ribbon uses a diurnal envelope from each
    day's min/max (requires ``include`` with ``hours`` in the API request).
    """
    _require_charts()
    if df.empty or "datetime" not in df.columns:
        fig = go.Figure()
        _apply_brand_layout(fig, title=title or "Temperature")
        return fig

    df = df.sort_values("datetime").copy()
    x = df["datetime"]
    fig = go.Figure()

    if resolution == "daily":
        req = ("tempmax", "tempmin")
        if not all(c in df.columns for c in req):
            _apply_brand_layout(fig, title=title or "Temperature")
            return fig

        if series == "feelslike":
            upper = pd.to_numeric(
                df["feelslikemax"].combine_first(df["tempmax"]), errors="coerce"
            )
            lower = pd.to_numeric(
                df["feelslikemin"].combine_first(df["tempmin"]), errors="coerce"
            )
            if "feelslike" in df.columns:
                y_main = pd.to_numeric(df["feelslike"], errors="coerce")
            else:
                y_main = (upper + lower) / 2.0
        else:
            upper = pd.to_numeric(df["tempmax"], errors="coerce")
            lower = pd.to_numeric(df["tempmin"], errors="coerce")
            if "temp" in df.columns:
                y_main = pd.to_numeric(df["temp"], errors="coerce")
            else:
                y_main = (upper + lower) / 2.0

        fig.add_trace(
            go.Scatter(
                x=x,
                y=lower,
                mode="lines",
                line=dict(width=0),
                showlegend=False,
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=x,
                y=upper,
                mode="lines",
                line=dict(width=0),
                fill="tonexty",
                fillcolor=RIBBON_FILL,
                showlegend=False,
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=x,
                y=y_main,
                mode="lines",
                name="Temperature" if series == "temp" else "Feels like",
                line=dict(color=TEMP_LINE_COLOR, width=3, shape="spline"),
            )
        )

        tmax_series = upper.to_numpy()
        imax = int(np.nanargmax(tmax_series))
        peak_temp = float(tmax_series[imax])
        peak_label = "Today's High" if len(df) == 1 else "Period high"
        xaxis_title = "Date"
        tickformat = "%b %d"
        xaxis_extra = dict(
            gridcolor="rgba(255,255,255,0.15)",
            showgrid=True,
            gridwidth=1,
            griddash="dash",
        )
    else:
        col = "feelslike" if series == "feelslike" else "temp"
        if col not in df.columns:
            _apply_brand_layout(fig, title=title or "Temperature")
            return fig

        if series == "feelslike":
            tmin = df["feelslikemin_day"].combine_first(df["tempmin_day"])
            tmax = df["feelslikemax_day"].combine_first(df["tempmax_day"])
        else:
            tmin = df["tempmin_day"]
            tmax = df["tempmax_day"]

        tmin = pd.to_numeric(tmin, errors="coerce")
        tmax = pd.to_numeric(tmax, errors="coerce")
        y_main = pd.to_numeric(df[col], errors="coerce")

        hours = _hours_since_midnight(df["datetime"]).to_numpy()
        upper_a, lower_a = _diurnal_upper_lower(
            hours,
            tmin.to_numpy(),
            tmax.to_numpy(),
        )

        fig.add_trace(
            go.Scatter(
                x=x,
                y=lower_a,
                mode="lines",
                line=dict(width=0),
                showlegend=False,
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=x,
                y=upper_a,
                mode="lines",
                line=dict(width=0),
                fill="tonexty",
                fillcolor=RIBBON_FILL,
                showlegend=False,
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter(
                x=x,
                y=y_main,
                mode="lines",
                name="Temperature" if series == "temp" else "Feels like",
                line=dict(color=TEMP_LINE_COLOR, width=3, shape="spline"),
            )
        )

        y_arr = y_main.to_numpy()
        imax = int(np.nanargmax(y_arr))
        peak_temp = float(y_arr[imax])
        peak_label = "Today's High"
        xaxis_title = "Time"
        tickformat = "%I %p"
        xaxis_extra = dict(
            gridcolor="rgba(255,255,255,0.15)",
            showgrid=True,
            gridwidth=1,
            griddash="dash",
        )

    fig.add_trace(
        go.Scatter(
            x=[x.iloc[imax]],
            y=[peak_temp],
            mode="markers",
            marker=dict(color=TEMP_LINE_COLOR, size=10, line=dict(width=1, color=PAPER_BG)),
            name="Peak",
            showlegend=False,
        )
    )

    fig.add_annotation(
        x=0.02,
        y=0.98,
        xref="paper",
        yref="paper",
        text=f"{peak_label}<br><b style='font-size:22px'>{peak_temp:.0f}°</b>",
        showarrow=False,
        align="left",
        font=dict(color=TEXT_COLOR, size=12),
        bgcolor="rgba(0,0,0,0.2)",
        borderpad=6,
    )

    fig.update_layout(
        paper_bgcolor=PAPER_BG,
        plot_bgcolor=PLOT_BG,
        font=dict(color=TEXT_COLOR, size=11),
        title=dict(text=title, font=dict(color=TEXT_COLOR, size=15)) if title else None,
        height=420,
        margin=dict(l=50, r=70, t=80 if title else 50, b=50),
        legend=dict(font=dict(color=TEXT_COLOR)),
        xaxis=dict(
            title=_brand_axis_title(xaxis_title),
            linecolor=TEXT_COLOR,
            tickfont=dict(color=TEXT_COLOR),
            tickformat=tickformat,
            **xaxis_extra,
        ),
        yaxis=dict(
            title=_brand_axis_title("Temperature (°F)"),
            side="right",
            gridcolor="rgba(255,255,255,0.08)",
            linecolor=TEXT_COLOR,
            tickfont=dict(color=TEXT_COLOR),
        ),
    )
    return fig


PrecipMode = Literal["daily", "cumulative"]


def build_precipitation_chart(
    daily_df: pd.DataFrame,
    *,
    mode: PrecipMode = "daily",
    title: Optional[str] = None,
) -> go.Figure:
    """Bar chart of daily precipitation or cumulative total over the range."""
    _require_charts()
    fig = go.Figure()
    if daily_df.empty:
        _apply_brand_layout(fig, title=title or "Precipitation", height=380)
        return fig

    df = daily_df.copy()
    if "datetime" not in df.columns:
        _apply_brand_layout(fig, title=title or "Precipitation", height=380)
        return fig

    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    df = df.sort_values("datetime")
    precip = pd.to_numeric(df.get("precip"), errors="coerce").fillna(0.0)

    if mode == "cumulative":
        y = precip.cumsum()
        trace = go.Scatter(
            x=df["datetime"],
            y=y,
            mode="lines+markers",
            name="Cumulative precip",
            line=dict(color="#48d1cc", width=2),
            marker=dict(size=6),
        )
        fig.add_trace(trace)
        y_title = "Cumulative precipitation (in)"
    else:
        fig.add_trace(
            go.Bar(
                x=df["datetime"],
                y=precip,
                name="Daily precip",
                marker_color="#48d1cc",
            )
        )
        y_title = "Precipitation (in)"

    fig.update_layout(
        paper_bgcolor=PAPER_BG,
        plot_bgcolor=PLOT_BG,
        font=dict(color=TEXT_COLOR, size=11),
        title=dict(text=title, font=dict(color=TEXT_COLOR, size=15)) if title else None,
        height=380,
        margin=dict(l=50, r=55, t=80 if title else 50, b=50),
        legend=dict(font=dict(color=TEXT_COLOR)),
        xaxis=dict(
            title=_brand_axis_title("Date"),
            linecolor=TEXT_COLOR,
            tickfont=dict(color=TEXT_COLOR),
        ),
        yaxis=dict(
            title=_brand_axis_title(y_title),
            linecolor=TEXT_COLOR,
            tickfont=dict(color=TEXT_COLOR),
            gridcolor="rgba(255,255,255,0.12)",
        ),
    )
    return fig


def build_wind_chart(
    df: pd.DataFrame,
    *,
    resolution: Resolution = "daily",
    title: Optional[str] = None,
) -> go.Figure:
    """
    Wind speed and gusts (primary axis) and wind direction in degrees (secondary axis).

    **resolution=\"daily\" (default):** uses daily timeline rows (VC daily ``windspeed`` /
    ``windgust`` / ``winddir``).

    **resolution=\"hourly\":** uses flattened hourly rows (request API ``include`` with ``hours``).
    """
    _require_charts()
    fig = make_subplots(specs=[[{"secondary_y": True}]])

    if df.empty or "datetime" not in df.columns:
        _apply_brand_layout(fig, title=title or "Wind", yaxis2=True)
        return fig

    d = df.sort_values("datetime").copy()
    x = d["datetime"]
    ws = pd.to_numeric(d.get("windspeed"), errors="coerce")
    wg = pd.to_numeric(d.get("windgust"), errors="coerce")
    wd = pd.to_numeric(d.get("winddir"), errors="coerce")

    x_title = "Date" if resolution == "daily" else "Time"
    tickfmt = "%b %d" if resolution == "daily" else None

    fig.add_trace(
        go.Scatter(
            x=x,
            y=ws,
            name="Wind speed",
            line=dict(color="#5dade2", width=2, shape="spline"),
        ),
        secondary_y=False,
    )
    fig.add_trace(
        go.Scatter(
            x=x,
            y=wg,
            name="Wind gust",
            line=dict(color="#eb984e", width=2, dash="dot", shape="spline"),
        ),
        secondary_y=False,
    )
    fig.add_trace(
        go.Scatter(
            x=x,
            y=wd,
            name="Wind direction",
            mode="lines",
            line=dict(color="#aed6f1", width=1.5, shape="spline"),
            opacity=0.85,
        ),
        secondary_y=True,
    )

    fig.update_layout(
        paper_bgcolor=PAPER_BG,
        plot_bgcolor=PLOT_BG,
        font=dict(color=TEXT_COLOR, size=11),
        title=dict(text=title, font=dict(color=TEXT_COLOR, size=15)) if title else None,
        height=420,
        margin=dict(l=55, r=65, t=80 if title else 50, b=50),
        legend=dict(font=dict(color=TEXT_COLOR)),
        hovermode="x unified",
        xaxis=dict(
            title=_brand_axis_title(x_title),
            linecolor=TEXT_COLOR,
            tickfont=dict(color=TEXT_COLOR),
            gridcolor="rgba(255,255,255,0.12)",
            tickformat=tickfmt,
        ),
    )
    fig.update_yaxes(
        title=_brand_axis_title("Speed (mph)"),
        linecolor=TEXT_COLOR,
        tickfont=dict(color=TEXT_COLOR),
        gridcolor="rgba(255,255,255,0.12)",
        secondary_y=False,
    )
    fig.update_yaxes(
        title=_brand_axis_title("Wind direction (°)"),
        range=[0, 360],
        tickmode="array",
        tickvals=[0, 90, 180, 270, 360],
        ticktext=["N", "E", "S", "W", "N"],
        linecolor=TEXT_COLOR,
        tickfont=dict(color=TEXT_COLOR),
        secondary_y=True,
    )
    return fig


def _weather_icon_url(icon_id: Optional[str], icon_url_prefix: str) -> str:
    """Map API icon id to vendored SVG filename; fallback to cloudy."""
    base = icon_id.strip() if icon_id else "cloudy"
    if base.endswith(".svg"):
        name = base
    else:
        name = f"{base}.svg"
    return f"{icon_url_prefix.rstrip('/')}/{name}"


def _default_icon_url_prefix() -> str:
    site = os.getenv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000").rstrip("/")
    return f"{site}{DEFAULT_ICON_PATH}"


def build_daily_overview_chart(
    daily_df: pd.DataFrame,
    *,
    icon_url_prefix: Optional[str] = None,
    title: Optional[str] = None,
) -> go.Figure:
    """
    Stacked view: daily high/low temperature, precipitation bars, and weather icons.

    Icons load from ``icon_url_prefix`` (defaults to ``NEXT_PUBLIC_SITE_URL`` +
    ``/assets/misc/weather-icons/``) via layout images on the bottom subplot.
    """
    _require_charts()
    prefix = icon_url_prefix if icon_url_prefix is not None else _default_icon_url_prefix()

    fig = make_subplots(
        rows=3,
        cols=1,
        row_heights=[0.38, 0.28, 0.34],
        vertical_spacing=0.08,
        subplot_titles=(
            "Temperature (high / low)",
            "Precipitation",
            "Conditions",
        ),
    )

    if daily_df.empty or "datetime" not in daily_df.columns:
        fig.update_layout(
            paper_bgcolor=PAPER_BG,
            plot_bgcolor=PLOT_BG,
            font=dict(color=TEXT_COLOR),
            title=dict(text=title, font=dict(color=TEXT_COLOR)) if title else None,
            height=560,
        )
        return fig

    df = daily_df.copy()
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    df = df.sort_values("datetime")

    x = df["datetime"]
    tmax = pd.to_numeric(df.get("tempmax"), errors="coerce")
    tmin = pd.to_numeric(df.get("tempmin"), errors="coerce")
    precip = pd.to_numeric(df.get("precip"), errors="coerce").fillna(0.0)

    fig.add_trace(
        go.Scatter(
            x=x,
            y=tmax,
            name="High",
            mode="lines+markers",
            line=dict(color=TEMP_LINE_COLOR, width=2),
            marker=dict(size=5),
        ),
        row=1,
        col=1,
    )
    fig.add_trace(
        go.Scatter(
            x=x,
            y=tmin,
            name="Low",
            mode="lines+markers",
            line=dict(color="#5dade2", width=2),
            marker=dict(size=5),
        ),
        row=1,
        col=1,
    )

    fig.add_trace(
        go.Bar(x=x, y=precip, name="Precip", marker_color="#48d1cc", showlegend=False),
        row=2,
        col=1,
    )

    icons = df.get("icon", pd.Series([None] * len(df))).tolist()

    fig.add_trace(
        go.Scatter(
            x=x,
            y=[1.0] * len(df),
            mode="markers",
            marker=dict(size=28, opacity=0, color="rgba(0,0,0,0)"),
            showlegend=False,
            hovertext=df.get("conditions", ""),
            hoverinfo="text+x",
        ),
        row=3,
        col=1,
    )

    one_day_ms = 86_400_000.0
    layout_images: List[Dict[str, Any]] = []
    for ts, ic in zip(x, icons):
        url = _weather_icon_url(str(ic) if ic is not None else None, prefix)
        layout_images.append(
            dict(
                source=url,
                xref="x3",
                yref="y3",
                x=pd.Timestamp(ts),
                y=1.0,
                sizex=one_day_ms * 0.72,
                sizey=0.42,
                xanchor="center",
                yanchor="middle",
                layer="above",
            )
        )

    fig.update_layout(
        paper_bgcolor=PAPER_BG,
        plot_bgcolor=PLOT_BG,
        font=dict(color=TEXT_COLOR, size=11),
        title=dict(text=title, font=dict(color=TEXT_COLOR, size=15)) if title else None,
        height=560,
        margin=dict(l=50, r=40, t=90 if title else 60, b=40),
        legend=dict(font=dict(color=TEXT_COLOR), orientation="h", yanchor="bottom", y=1.02),
        images=layout_images,
    )

    for i in range(1, 4):
        fig.update_xaxes(
            linecolor=TEXT_COLOR,
            tickfont=dict(color=TEXT_COLOR),
            gridcolor="rgba(255,255,255,0.1)",
            row=i,
            col=1,
        )
        fig.update_yaxes(
            linecolor=TEXT_COLOR,
            tickfont=dict(color=TEXT_COLOR),
            gridcolor="rgba(255,255,255,0.1)",
            row=i,
            col=1,
        )

    fig.update_xaxes(title_text="", row=3, col=1)
    fig.update_yaxes(range=[0.35, 1.65], visible=False, row=3, col=1)
    fig.update_yaxes(title_text="in", row=2, col=1)
    fig.update_yaxes(title_text="°F", row=1, col=1)

    for a in fig.layout.annotations:
        a.font = dict(color=TEXT_COLOR, size=12, family="Arial Black")

    return fig


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Visual Crossing Weather API")
    print("=" * 60)

    coordinate = "40.74307624488753, -73.45501252699007"
    start_date = "2025-09-20"
    end_date = "2025-09-28"
    
    sample = fetch_weather_timeline(
        coordinate,
        start_date,
        end_date,
        extra_params={"include": "days,hours"},
    )
    if sample:
        coords = sample.get("latitude"), sample.get("longitude")
        daily = timeline_to_daily_df(sample)
        hourly = timeline_to_hourly_df(sample)
        daily.to_csv(f"{ROOT_DIR}/data/misc/daily.csv", index=False)
        hourly.to_csv(f"{ROOT_DIR}/data/misc/hourly.csv", index=False)

        print("Coordinates:", coords)
        print("Daily rows:", len(daily))
        print(daily.head())
        print("=" * 60)

        fig_temp = build_temperature_chart(daily, resolution="daily", title="Temperature (daily)")
        fig_temp.show()
        
        fig_precip = build_precipitation_chart(daily, mode="daily", title="Precipitation (daily)")
        fig_precip.show()
        
        fig_precip_cumulative = build_precipitation_chart(daily, mode="cumulative", title="Precipitation (cumulative)")
        fig_precip_cumulative.show()

        sample_h = fetch_weather_timeline(
            coordinate,
            start_date,
            end_date,
            extra_params={"include": "current,days,hours"},
        )
        if sample_h:
            hourly_h = timeline_to_hourly_df(sample_h)
            print("Hourly rows (with hours):", len(hourly_h))
            fig_h = build_temperature_chart(hourly_h, resolution="hourly", title="Temperature (hourly)")
            fig_h.show()
    else:
        print("No sample data (check WEATHER_API_KEY).")
