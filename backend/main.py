
from datetime import datetime, timezone, timedelta
from functools import lru_cache
import math
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engines.lunar_sky import LunarSky
from engines.check_site import get_site_terrain, get_terrain_profile
from engines.terrain_engine import TerrainEngine
from engines.analysis_pipeline import AnalysisPipeline
from engines.grading_engine import (
    GradingEngine,
    PREDEFINED_MISSION_PROFILES,
    normalize_slope,
    normalize_roughness,
    normalize_hazards,
    normalize_sunlight,
    normalize_comm
)
from engines.rules_engine import RulesEngine
from database import (
    get_database_status,
    list_missions,
    list_features,
    list_saved_sites,
    create_saved_site,
    delete_saved_site,
    record_assessment,
    save_custom_profile,
    list_custom_profiles,
    get_custom_profile,
    delete_custom_profile
)


# ============================================================
# LUNASITE APPLICATION
# ============================================================

app = FastAPI(
    title="LunaSite Backend",
    description="Lunar Landing Site Navigator API",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Development only
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# LUNAR ENGINE INITIALIZATION
# ============================================================

@lru_cache(maxsize=1)
def get_lunar_engine():
    """
    Initialize the lunar astronomy engine once.
    Reuse loaded JPL ephemeris and lunar frame kernels.
    """
    return LunarSky()


@lru_cache(maxsize=1)
def get_terrain_engine():
    return TerrainEngine()


@lru_cache(maxsize=1)
def get_analysis_pipeline():
    return AnalysisPipeline(get_lunar_engine(), get_terrain_engine())


@lru_cache(maxsize=1)
def get_grading_engine():
    return GradingEngine()


@lru_cache(maxsize=1)
def get_rules_engine():
    return RulesEngine()


# ============================================================
# DATE AND TIME UTILITIES
# ============================================================

def parse_utc_time(value: str) -> datetime:
    """
    Parse ISO-8601 date/time and normalize to UTC.
    """

    if value.lower() == "now":
        return datetime.now(timezone.utc)

    parsed = datetime.fromisoformat(
        value.replace("Z", "+00:00")
    )

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


# ============================================================
# SUNRISE / SUNSET DETECTION
# ============================================================

def find_sun_horizon_crossings(
    results,
    engine,
    lat,
    lon,
    height_m=0.0
):
    """
    Detect geometric sunrise and sunset.

    Initial detection:
        Uses timeline samples.

    Refinement:
        Uses bisection to narrow the crossing interval
        to approximately one second.

    This detects zero-degree solar elevation only.
    """

    crossings = []

    for previous, current in zip(results, results[1:]):

        e1 = previous["sun"]["elevation_deg"]
        e2 = current["sun"]["elevation_deg"]

        # Check whether solar elevation crosses zero
        is_crossing = (
            (e1 < 0 <= e2)
            or
            (e1 >= 0 > e2)
        )

        if not is_crossing:
            continue

        left_time = datetime.fromisoformat(
            previous["time_utc"]
        )

        right_time = datetime.fromisoformat(
            current["time_utc"]
        )

        left_elevation = e1
        right_elevation = e2

        # Handle exact sampled zero crossings
        if e1 == 0:
            crossing_time = left_time

        elif e2 == 0:
            crossing_time = right_time

        else:

            # --------------------------------------------
            # BISECTION REFINEMENT
            # --------------------------------------------

            while (
                right_time - left_time
            ).total_seconds() > 1:

                middle_time = left_time + (
                    right_time - left_time
                ) / 2

                sky_time = engine.ts.from_datetime(
                    middle_time
                )

                calculated = engine.compute(
                    sky_time,
                    lat,
                    lon,
                    height_m,
                    aberration=False
                )

                middle_elevation = calculated[
                    "sun"
                ]["elevation_deg"]

                # Keep the interval containing zero
                if (
                    (left_elevation <= 0 <= middle_elevation)
                    or
                    (left_elevation >= 0 >= middle_elevation)
                ):

                    right_time = middle_time
                    right_elevation = middle_elevation

                else:

                    left_time = middle_time
                    left_elevation = middle_elevation

            crossing_time = left_time + (
                right_time - left_time
            ) / 2

        event_name = (
            "sunrise" if e2 > e1 else "sunset"
        )

        crossings.append({
            "event": event_name,
            "time_utc": crossing_time.isoformat(),
            "estimated_elevation_deg": 0.0,
            "refinement": "Bisection",
            "time_resolution_seconds": 1
        })

    return crossings


def compute_operational_windows(results):
    """
    Computes contiguous intervals and geometric availability percentages for:
    - Sun visibility (elevation > 0°)
    - Earth DTE visibility (elevation > 0°)
    - Simultaneous Sun and Earth visibility (both Sun and Earth > 0°)
    """
    if not results:
        return {
            "geometric_availability": {
                "sun_visibility_percent": 0.0,
                "dte_availability_percent": 0.0,
                "simultaneous_sun_earth_percent": 0.0
            },
            "sun_windows": [],
            "dte_windows": [],
            "simultaneous_sun_earth_windows": []
        }

    total = len(results)
    sun_count = 0
    earth_count = 0
    simul_count = 0

    def extract_intervals(condition_func):
        intervals = []
        in_interval = False
        start_time = None
        for i, item in enumerate(results):
            cond = condition_func(item)
            t = item["time_utc"]
            if cond and not in_interval:
                in_interval = True
                start_time = t
            elif not cond and in_interval:
                in_interval = False
                end_time = results[i - 1]["time_utc"]
                st = datetime.fromisoformat(start_time)
                et = datetime.fromisoformat(end_time)
                dur_h = round((et - st).total_seconds() / 3600.0, 2)
                intervals.append({
                    "start_utc": start_time,
                    "end_utc": end_time,
                    "duration_hours": dur_h
                })
        if in_interval:
            end_time = results[-1]["time_utc"]
            st = datetime.fromisoformat(start_time)
            et = datetime.fromisoformat(end_time)
            dur_h = round((et - st).total_seconds() / 3600.0, 2)
            intervals.append({
                "start_utc": start_time,
                "end_utc": end_time,
                "duration_hours": dur_h
            })
        return intervals

    for item in results:
        s_vis = item["sun"]["elevation_deg"] > 0.0
        e_vis = item["earth"]["elevation_deg"] > 0.0
        if s_vis:
            sun_count += 1
        if e_vis:
            earth_count += 1
        if s_vis and e_vis:
            simul_count += 1

    sun_windows = extract_intervals(lambda x: x["sun"]["elevation_deg"] > 0.0)
    dte_windows = extract_intervals(lambda x: x["earth"]["elevation_deg"] > 0.0)
    simul_windows = extract_intervals(lambda x: (x["sun"]["elevation_deg"] > 0.0) and (x["earth"]["elevation_deg"] > 0.0))

    return {
        "geometric_availability": {
            "sun_visibility_percent": round(100.0 * sun_count / total, 2),
            "dte_availability_percent": round(100.0 * earth_count / total, 2),
            "simultaneous_sun_earth_percent": round(100.0 * simul_count / total, 2)
        },
        "sun_windows": sun_windows,
        "dte_windows": dte_windows,
        "simultaneous_sun_earth_windows": simul_windows
    }


# ============================================================
# BASIC API ENDPOINTS
# ============================================================

@app.get("/")
def home():

    return {
        "project": "LunaSite",
        "status": "Running",
        "message": "Lunar Landing Site Navigator Backend"
    }


@app.get("/api/health")
def health_check():

    return {
        "status": "healthy",
        "backend": "online",
        "timestamp": datetime.now(
            timezone.utc
        ).isoformat()
    }


@app.get("/api/mission")
def mission_info():

    return {
        "mission": "Lunar Landing Site Analysis",
        "planet": "Moon",
        "status": "Development"
    }


# ============================================================
# SINGLE-TIME SUN / EARTH POSITION
# ============================================================

@app.get("/api/solar/position")
def solar_position(

    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    height_m: float = Query(
        0.0,
        ge=-10000,
        le=100000
    ),
    time: str = Query("now"),
    aberration: bool = Query(False)

):
    """
    Calculate Sun and Earth positions from
    a selected lunar surface location.
    """

    try:

        observation_time = parse_utc_time(time)

        engine = get_lunar_engine()

        sky_time = engine.ts.from_datetime(
            observation_time
        )

        result = engine.compute(
            sky_time,
            lat,
            lon,
            height_m,
            aberration
        )

        return {

            "status": "success",

            "reference_frame": "MOON_ME_DE421",

            "coordinates": {
                "latitude_deg": lat,
                "longitude_deg": lon,
                "height_m": height_m
            },

            "time_utc": observation_time.isoformat(),

            "sun": result["sun"],

            "earth": result["earth"]

        }

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=f"Invalid time or input: {error}"
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=f"Lunar calculation failed: {error}"
        )


# ============================================================
# TIME-BASED SUN / EARTH TIMELINE
# ============================================================

@app.get("/api/solar/timeline")
def solar_timeline(

    lat: float = Query(..., ge=-90, le=90),

    lon: float = Query(..., ge=-180, le=180),

    start: str = Query(...),

    end: str = Query(...),

    step_min: int = Query(
        60,
        ge=1,
        le=1440
    ),

    height_m: float = Query(
        0.0,
        ge=-10000,
        le=100000
    )

):
    """
    Calculate Sun and Earth positions at regular intervals.

    Also detects and refines geometric sunrise and sunset.
    """

    try:

        # --------------------------------------------
        # PARSE TIME RANGE
        # --------------------------------------------

        start_time = parse_utc_time(start)

        end_time = parse_utc_time(end)

        if end_time <= start_time:

            raise HTTPException(
                status_code=400,
                detail="End time must be later than start time."
            )

        interval = timedelta(
            minutes=step_min
        )

        total_points = int(
            (end_time - start_time) / interval
        ) + 1

        if total_points > 500:

            raise HTTPException(
                status_code=400,
                detail=(
                    "Maximum 500 time points allowed. "
                    "Increase step_min or reduce time range."
                )
            )

        # --------------------------------------------
        # INITIALIZE LUNAR ENGINE
        # --------------------------------------------

        engine = get_lunar_engine()

        results = []

        current_time = start_time

        # --------------------------------------------
        # CALCULATE TIMELINE
        # --------------------------------------------

        while current_time <= end_time:

            sky_time = engine.ts.from_datetime(
                current_time
            )

            calculated = engine.compute(
                sky_time,
                lat,
                lon,
                height_m,
                aberration=False
            )

            results.append({

                "time_utc": current_time.isoformat(),

                "sun": calculated["sun"],

                "earth": calculated["earth"]

            })

            current_time += interval

        # --------------------------------------------
        # DETECT AND REFINE SUNRISE / SUNSET
        # --------------------------------------------

        sun_crossings = find_sun_horizon_crossings(
            results,
            engine,
            lat,
            lon,
            height_m
        )

        # --------------------------------------------
        # COMPUTE OPERATIONAL & DTE WINDOWS
        # --------------------------------------------
        windows_info = compute_operational_windows(results)

        # --------------------------------------------
        # BUILD API RESPONSE
        # --------------------------------------------

        return {

            "status": "success",

            "reference_frame": "MOON_ME_DE421",

            "location": {

                "latitude_deg": lat,

                "longitude_deg": lon,

                "height_m": height_m

            },

            "interval_minutes": step_min,

            "number_of_points": len(results),

            "geometric_availability": windows_info["geometric_availability"],

            "dte_windows": windows_info["dte_windows"],

            "sun_windows": windows_info["sun_windows"],

            "simultaneous_sun_earth_windows": windows_info["simultaneous_sun_earth_windows"],

            "sun_horizon_crossings": sun_crossings,

            "crossing_method": (
                "Bisection refinement "
                "within sampled time intervals"
            ),

            "time_resolution_seconds": 1,

            "data": results

        }

    except HTTPException:
        raise

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=f"Invalid date or input: {error}"
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=f"Timeline calculation failed: {error}"
        )


# ============================================================
# SCIENTIFIC SITE ASSESSMENT
# ============================================================

@app.get("/api/assessment")
def site_assessment(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    height_m: float = Query(0.0, ge=-10000, le=100000),
    time: str = Query("now")
):
    """
    Perform a multi-variable scientific landing site assessment
    using JPL DE421 ephemeris, solar geometry, and direct-to-Earth communication links.
    """
    try:
        obs_time = parse_utc_time(time)
        engine = get_lunar_engine()
        sky_time = engine.ts.from_datetime(obs_time)
        computed = engine.compute(sky_time, lat, lon, height_m, aberration=False)

        sun = computed["sun"]
        earth = computed["earth"]

        # 1. Solar Illumination Analysis
        sun_elev = sun["elevation_deg"]
        if sun_elev > 1.5:
            lighting_status = "Direct Solar Illumination (Daylight)"
            lighting_score = 30.0
            solar_power_efficiency = min(1.0, max(0.1, math.sin(math.radians(sun_elev))))
        elif 0.0 <= sun_elev <= 1.5:
            lighting_status = "Grazing Low-Angle Sunlight (Polar Horizon)"
            lighting_score = 24.0
            solar_power_efficiency = 0.25
        elif -1.5 <= sun_elev < 0.0:
            lighting_status = "Penumbral Twilight / Ridge Shadow"
            lighting_score = 10.0
            solar_power_efficiency = 0.05
        else:
            lighting_status = "Lunar Night / Deep Surface Shadow"
            lighting_score = 0.0
            solar_power_efficiency = 0.0

        solar_flux_w_m2 = round(1361.0 * max(0.0, math.sin(math.radians(max(0.0, sun_elev)))), 1)

        # 2. Direct-to-Earth (DTE) Communication Link
        earth_elev = earth["elevation_deg"]
        comm_latency_sec = round(earth["range_km"] / 299792.458, 3)

        if earth_elev > 5.0:
            comm_status = "Direct-to-Earth Link Active (High Elevation)"
            comm_score = 30.0
            comm_quality = "OPTIMAL"
        elif 0.0 <= earth_elev <= 5.0:
            comm_status = "Low-Elevation DTE Link (Local Terrain Masking Risk)"
            comm_score = 18.0
            comm_quality = "MARGINAL"
        else:
            comm_status = "Lunar Farside / Earth Occluded (Relay Satellite Required)"
            comm_score = 0.0
            comm_quality = "OCCLUDED"

        # 3. Topography & Terrain Analysis (LOLA 80S DEM/Slope)
        terrain = get_site_terrain(lat, lon)
        slope_score = 10.0
        max_slope_score = 15.0

        if terrain["inside_coverage"]:
            slope = terrain["slope_deg"]
            if slope is not None:
                if slope <= 5.0:
                    slope_status = f"Flat Terrain ({slope}° slope - Optimal Stability)"
                    slope_score = 15.0
                elif slope <= 10.0:
                    slope_status = f"Moderate Incline ({slope}° slope - Acceptable)"
                    slope_score = 11.0
                elif slope <= 15.0:
                    slope_status = f"Steep Incline ({slope}° slope - High Risk)"
                    slope_score = 5.0
                else:
                    slope_status = f"Hazardous Slope ({slope}° slope - Unsuitable for Lander)"
                    slope_score = 0.0
            else:
                slope_status = "Elevation measured; slope data unavailable"
                slope_score = 10.0
        else:
            slope_status = "Outside 80°S LOLA High-Res Polar GeoTIFF Coverage"
            slope_score = 10.0

        # 4. Exploration Zone & Polar Context
        is_south_pole = lat <= -60.0
        is_north_pole = lat >= 60.0
        is_deep_polar = lat <= -80.0 or lat >= 80.0

        if is_deep_polar:
            region_name = "Deep Polar Volatile Exploration Zone (Near PSRs)"
            region_score = 25.0
            scientific_priority = "CRITICAL (Artemis III / ISRO / CLPS Ice Target)"
        elif is_south_pole:
            region_name = "South Pole High-Latitude Region"
            region_score = 22.0
            scientific_priority = "HIGH (Permanently Shadowed Region Proximity)"
        elif is_north_pole:
            region_name = "North Pole High-Latitude Region"
            region_score = 20.0
            scientific_priority = "HIGH"
        else:
            region_name = "Equatorial / Mid-Latitude Region"
            region_score = 16.0
            scientific_priority = "MODERATE (Standard Mare / Highland Science)"

        # 5. Total Suitability Score (0 - 100)
        total_score = round(lighting_score + comm_score + slope_score + region_score, 1)

        if total_score >= 80.0:
            suitability_rating = "EXCELLENT"
            rating_color = "#38bdf8"
        elif total_score >= 60.0:
            suitability_rating = "SUITABLE"
            rating_color = "#4ade80"
        elif total_score >= 40.0:
            suitability_rating = "MARGINAL"
            rating_color = "#fbbf24"
        else:
            suitability_rating = "HIGH RISK / UNSUITABLE"
            rating_color = "#f87171"

        # 6. Operational Recommendations
        recommendations = []
        if terrain["inside_coverage"]:
            elev = terrain["elevation_m"]
            slp = terrain["slope_deg"]
            if elev is not None:
                recommendations.append(f"LOLA 80S Ground Elevation measured at {elev} m relative to reference ellipsoid.")
            if slp is not None:
                if slp > 10.0:
                    recommendations.append(f"Surface slope is steep ({slp}°); evaluate landing gear clearance to prevent tip-over.")
                else:
                    recommendations.append(f"Surface slope ({slp}°) provides favorable landing stability.")

        if sun_elev <= 0.0:
            recommendations.append("Site is currently in shadow. Auxiliary battery or fuel-cell power required for immediate surface operations.")
        elif sun_elev < 3.0:
            recommendations.append("Low solar grazing angle; vertical or high-tilt solar arrays strongly recommended.")
        else:
            recommendations.append("Adequate direct illumination for standard top-mounted solar panels.")

        if earth_elev < 0.0:
            recommendations.append("Direct Earth radio communication is occluded by the lunar limb. An orbital communications relay (e.g., Lunar Gateway) is strictly mandatory.")
        elif earth_elev < 5.0:
            recommendations.append("Earth is close to the lunar horizon; verify LOLA horizon profile to ensure local crater rims do not block the RF path.")
        else:
            recommendations.append("Clear line-of-sight for direct X-band / Ka-band high-bandwidth telemetry to Deep Space Network (DSN).")

        if is_south_pole:
            recommendations.append("High-priority scientific interest: check proximity to water ice and volatile traps in adjacent Permanently Shadowed Regions (PSRs).")

        # 7. Nearby Historical Missions & Ground Truth Exploration Intelligence (Module 12)
        from engines.historical_engine import get_nearby_historical_missions, validate_against_historical
        nearby_historical = get_nearby_historical_missions(lat, lon, max_distance_km=3000.0, limit=4)
        validation_data = validate_against_historical(lat, lon, predicted_thermal_k=solar_flux_w_m2 / 4.0 + 40.0)

        return {
            "status": "success",
            "time_utc": obs_time.isoformat(),
            "target": {
                "latitude_deg": lat,
                "longitude_deg": lon,
                "height_m": height_m,
                "region_name": region_name,
                "scientific_priority": scientific_priority
            },
            "overall_suitability": {
                "score_percent": total_score,
                "rating": suitability_rating,
                "rating_color": rating_color
            },
            "illumination": {
                "sun_elevation_deg": round(sun["elevation_deg"], 3),
                "sun_azimuth_deg": round(sun["azimuth_deg"], 3),
                "sun_distance_km": round(sun["range_km"], 1),
                "status": lighting_status,
                "subscore": lighting_score,
                "max_subscore": 30.0,
                "solar_flux_w_m2": solar_flux_w_m2,
                "efficiency_factor": round(solar_power_efficiency, 2)
            },
            "direct_to_earth": {
                "earth_elevation_deg": round(earth["elevation_deg"], 3),
                "earth_azimuth_deg": round(earth["azimuth_deg"], 3),
                "earth_distance_km": round(earth["range_km"], 1),
                "status": comm_status,
                "quality": comm_quality,
                "subscore": comm_score,
                "max_subscore": 30.0,
                "latency_sec": comm_latency_sec
            },
            "topography": {
                "inside_lola_80s_coverage": terrain["inside_coverage"],
                "elevation_m": terrain["elevation_m"],
                "slope_deg": terrain["slope_deg"],
                "status": slope_status,
                "subscore": slope_score,
                "max_subscore": max_slope_score
            },
            "region": {
                "name": region_name,
                "priority": scientific_priority,
                "subscore": region_score,
                "max_subscore": 25.0
            },
            "operational_recommendations": recommendations,
            "nearby_historical_missions": nearby_historical,
            "historical_validation": validation_data
        }
    except ValueError as error:
        raise HTTPException(status_code=400, detail=f"Invalid time or input: {error}")
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Assessment failed: {error}")


@app.get("/api/terrain")
def site_terrain(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180)
):
    """
    Sample elevation (m) and slope (deg) from high-resolution LOLA South Pole 80S GeoTIFFs.
    """
    try:
        return get_site_terrain(lat, lon)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Terrain lookup failed: {error}")


@app.get("/api/terrain/profile")
def site_terrain_profile(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(2500.0, ge=100.0, le=50000.0),
    samples: int = Query(25, ge=5, le=100)
):
    """
    Generate a 2D cross-section terrain elevation profile centered on (lat, lon).
    Returns samples, min/max heights, and terrain relief.
    """
    try:
        return get_terrain_profile(lat, lon, radius_m, samples)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Profile generation failed: {error}")


# ============================================================
# LUNAR MISSIONS, FEATURES & DATABASE (SUPABASE / SQLITE)
# ============================================================

class SaveSiteRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    latitude_deg: Optional[float] = None
    longitude_deg: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    notes: Optional[str] = Field("", max_length=500)
    suitability_score: Optional[float] = None

    def get_lat(self) -> float:
        if self.latitude_deg is not None:
            return float(self.latitude_deg)
        if self.latitude is not None:
            return float(self.latitude)
        raise ValueError("Latitude is required")

    def get_lon(self) -> float:
        if self.longitude_deg is not None:
            return float(self.longitude_deg)
        if self.longitude is not None:
            return float(self.longitude)
        raise ValueError("Longitude is required")


@app.get("/api/database/status")
def database_status():
    """Check Supabase / SQLite database connectivity and record counts."""
    return get_database_status()


@app.get("/api/missions")
def get_missions(agency: Optional[str] = Query(None)):
    """Fetch canonical NASA, ISRO, and historical Moon missions."""
    return list_missions(agency=agency)


@app.get("/api/features")
def get_features(psr_only: bool = Query(False)):
    """Fetch key lunar features, craters, and Permanently Shadowed Regions (PSRs)."""
    return list_features(psr_only=psr_only)


@app.get("/api/saved-sites")
def get_saved_sites():
    """Fetch user's bookmarked lunar landing sites."""
    return list_saved_sites()


@app.post("/api/saved-sites")
def add_saved_site(payload: SaveSiteRequest):
    """Save a custom lunar target coordinate to the database."""
    try:
        lat = payload.get_lat()
        lon = payload.get_lon()
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return create_saved_site(
        name=payload.name,
        latitude=lat,
        longitude=lon,
        notes=payload.notes or ""
    )


@app.delete("/api/saved-sites/{site_id}")
def remove_saved_site(site_id: int):
    """Delete a saved landing site by ID."""
    success = delete_saved_site(site_id)
    if not success:
        raise HTTPException(status_code=404, detail="Saved site not found")
    return {"status": "success", "deleted_id": site_id}


# ============================================================
# GRADING ENGINE & ADVANCED SCIENTIFIC ANALYSIS ENDPOINTS
# ============================================================

class AnalysisRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=360)
    height_m: float = Field(0.0, ge=-10000, le=100000)
    time: str = "now"


class GradingRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=360)
    height_m: float = Field(0.0, ge=-10000, le=100000)
    time: str = "now"
    mission_id: str = "human_landing"
    custom_weights: Optional[Dict[str, float]] = None


class ComparisonRequest(BaseModel):
    locations: List[Dict[str, Any]]  # [{lat, lon, name, height_m?}]
    mission_id: str = "human_landing"


class CustomProfileRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    weights: Dict[str, float]


@app.post("/api/analysis")
def run_analysis(payload: AnalysisRequest):
    """Run the unified scientific analysis pipeline for a location."""
    try:
        obs_time = parse_utc_time(payload.time)
        pipeline = get_analysis_pipeline()
        result = pipeline.analyze(payload.lat, payload.lon, payload.height_m, obs_time)
        return result.model_dump()
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {error}")


@app.get("/api/analysis/{analysis_id}")
def get_analysis(analysis_id: str):
    """Retrieve a cached analysis result by ID."""
    pipeline = get_analysis_pipeline()
    result = pipeline.get_by_id(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found. Run POST /api/analysis first.")
    return result.model_dump()


@app.post("/api/grading")
def run_grading(payload: GradingRequest):
    """Grade a location against a mission profile with safety screening and findings."""
    try:
        obs_time = parse_utc_time(payload.time)
        pipeline = get_analysis_pipeline()
        analysis = pipeline.analyze(payload.lat, payload.lon, payload.height_m, obs_time)
        grader = get_grading_engine()
        grading = grader.evaluate_mission(analysis, payload.mission_id, payload.custom_weights)
        rules = get_rules_engine()
        findings = rules.generate_findings(analysis, payload.mission_id)
        risks = rules.generate_risks(analysis)
        return {
            "analysis_id": analysis.analysis_id,
            "location": analysis.location.model_dump(),
            "grading": grading.model_dump(),
            "findings": [f.model_dump() for f in findings],
            "risks": [r.model_dump() for r in risks],
            "data_coverage_percent": analysis.data_coverage_percent,
            "limitations": analysis.limitations,
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Grading failed: {error}")


@app.post("/api/grading/all-missions")
def run_grading_all_missions(payload: AnalysisRequest):
    """Grade a location against all predefined mission profiles."""
    try:
        obs_time = parse_utc_time(payload.time)
        pipeline = get_analysis_pipeline()
        analysis = pipeline.analyze(payload.lat, payload.lon, payload.height_m, obs_time)
        grader = get_grading_engine()
        all_results = {}
        for mission_id in PREDEFINED_MISSION_PROFILES:
            g = grader.evaluate_mission(analysis, mission_id)
            all_results[mission_id] = {
                "mission_name": g.mission_name,
                "score": g.overall_score,
                "grade": g.grade,
                "safety": g.safety_screening,
                "summary": g.summary_explanation,
            }
        return {
            "analysis_id": analysis.analysis_id,
            "location": analysis.location.model_dump(),
            "mission_scores": all_results,
            "data_coverage_percent": analysis.data_coverage_percent,
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Multi-mission grading failed: {error}")


@app.get("/api/mission-profiles")
def get_mission_profiles():
    """Return all predefined mission profiles with weights and mandatory checks, plus custom profiles."""
    return {
        "predefined": list(PREDEFINED_MISSION_PROFILES.values()),
        "custom": list_custom_profiles()
    }


@app.post("/api/mission-profiles/custom")
def create_custom_profile(payload: CustomProfileRequest):
    """Save a user-defined custom mission profile."""
    total = sum(max(0.0, v) for v in payload.weights.values())
    if total <= 0:
        raise HTTPException(status_code=422, detail="Weights must have at least one positive value.")
    return save_custom_profile(payload.name, payload.description, payload.weights)


@app.delete("/api/mission-profiles/custom/{profile_id}")
def remove_custom_profile(profile_id: int):
    """Delete a user-defined custom mission profile."""
    success = delete_custom_profile(profile_id)
    if not success:
        raise HTTPException(status_code=404, detail="Custom profile not found.")
    return {"status": "success", "deleted_id": profile_id}


@app.post("/api/assessment/findings")
def get_findings(payload: GradingRequest):
    """Generate pros/cons and risk findings for a location and mission."""
    try:
        obs_time = parse_utc_time(payload.time)
        pipeline = get_analysis_pipeline()
        analysis = pipeline.analyze(payload.lat, payload.lon, payload.height_m, obs_time)
        rules = get_rules_engine()
        findings = rules.generate_findings(analysis, payload.mission_id)
        risks = rules.generate_risks(analysis)
        return {
            "findings": [f.model_dump() for f in findings],
            "risks": [r.model_dump() for r in risks],
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Findings generation failed: {error}")


@app.post("/api/comparison")
def compare_sites(payload: ComparisonRequest):
    """Compare multiple locations side-by-side for a given mission profile."""
    try:
        if len(payload.locations) < 2:
            raise HTTPException(status_code=422, detail="At least 2 locations required for comparison.")
        if len(payload.locations) > 6:
            raise HTTPException(status_code=422, detail="Maximum 6 locations per comparison.")

        pipeline = get_analysis_pipeline()
        grader = get_grading_engine()
        obs_time = datetime.now(timezone.utc)

        results = []
        for loc in payload.locations:
            lat = float(loc.get("lat", loc.get("latitude_deg", 0)))
            lon = float(loc.get("lon", loc.get("longitude_deg", 0)))
            height_m = float(loc.get("height_m", 0.0))
            name = loc.get("name", f"Site ({lat:.2f}, {lon:.2f})")

            analysis = pipeline.analyze(lat, lon, height_m, obs_time)
            grading = grader.evaluate_mission(analysis, payload.mission_id)

            results.append({
                "name": name,
                "latitude": lat,
                "longitude": lon,
                "analysis_id": analysis.analysis_id,
                "score": grading.overall_score,
                "grade": grading.grade,
                "safety": grading.safety_screening,
                "summary": grading.summary_explanation,
                "parameter_scores": [ps.model_dump() for ps in grading.parameter_scores],
                "safety_checks": [sc.model_dump() for sc in grading.safety_checks],
                "terrain": {
                    "slope_deg": analysis.terrain.slope_deg.value,
                    "roughness_m": analysis.terrain.roughness_m.value,
                    "hazard_density": analysis.terrain.hazard_density.value,
                    "elevation_m": analysis.terrain.elevation_m.value,
                },
                "solar": {
                    "sunlight_pct": analysis.solar.sunlight_duration_percent.value,
                    "is_psr": analysis.solar.is_permanently_shadowed,
                    "is_sunlit": analysis.solar.is_sunlit,
                },
                "comm": {
                    "is_earth_visible": analysis.communication.is_earth_visible,
                    "clearance_deg": analysis.communication.terrain_clearance_deg.value,
                    "dte_status": analysis.communication.dte_status,
                },
                "thermal": {
                    "current_temp_k": analysis.thermal.current_temp_k.value,
                    "water_ice_evidence": analysis.thermal.water_ice_evidence.value,
                }
            })

        passing = [r for r in results if r["safety"] == "PASS"]
        ranked = sorted(passing if passing else results, key=lambda x: (x["score"] or 0), reverse=True)
        winner_name = ranked[0]["name"] if ranked else None

        return {
            "mission_id": payload.mission_id,
            "mission_name": PREDEFINED_MISSION_PROFILES.get(payload.mission_id, {}).get("name", payload.mission_id),
            "winner": winner_name,
            "results": results,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Comparison failed: {error}")


@app.get("/api/grading/normalization")
def get_normalization_tables():
    """Return normalization lookup tables for all scoring parameters."""
    slope_samples = [0, 2, 4, 6, 8, 10, 12, 15, 18, 20, 25]
    roughness_samples = [0, 2, 5, 8, 12, 20, 30, 40, 50]
    hazard_samples = [0, 5, 10, 15, 20, 25, 30, 40, 50]
    sunlight_samples = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]

    return {
        "slope_normalization": [
            {"slope_deg": s, "normalized_score": normalize_slope(s)} for s in slope_samples
        ],
        "roughness_normalization": [
            {"roughness_m": r, "normalized_score": normalize_roughness(r)} for r in roughness_samples
        ],
        "hazard_normalization": [
            {"hazard_density_pct": h, "normalized_score": normalize_hazards(h)} for h in hazard_samples
        ],
        "sunlight_normalization": [
            {"sunlight_pct": d, "normalized_score": normalize_sunlight(d)} for d in sunlight_samples
        ],
        "comm_normalization": [
            {"clearance_deg": c, "is_visible": True, "normalized_score": normalize_comm(c, True)}
            for c in [0, 1, 2, 3, 5, 7, 10, 15, 20]
        ],
        "grade_boundaries": [
            {"min_score": 90, "grade": "A+"},
            {"min_score": 80, "grade": "A"},
            {"min_score": 70, "grade": "B"},
            {"min_score": 60, "grade": "C"},
            {"min_score": 40, "grade": "D"},
            {"min_score": 0, "grade": "F"},
        ]
    }


# ============================================================
# MODULE 12: HISTORICAL LUNAR MISSION ENDPOINTS
# ============================================================

@app.get("/api/historical/missions")
def get_historical_missions_endpoint(
    search: Optional[str] = None,
    agency: Optional[str] = None,
    country: Optional[str] = None,
    era: Optional[str] = None,
    mission_type: Optional[str] = None,
    region: Optional[str] = None,
    verification_status: Optional[str] = None
):
    """
    Module 12 Section A & B: Fetch canonical historical lunar missions with rich scientific
    metadata, instruments, observations, datasets, and traceability.
    """
    from engines.historical_engine import list_historical_missions
    return list_historical_missions(
        search=search,
        agency=agency,
        country=country,
        era=era,
        mission_type=mission_type,
        region=region,
        verification_status=verification_status
    )


@app.get("/api/historical/missions/{mission_id}")
def get_historical_mission_endpoint(mission_id: str):
    """Module 12 Section A: Fetch full detailed dossier for a single historical mission."""
    from engines.historical_engine import get_historical_mission
    m = get_historical_mission(mission_id)
    if not m:
        raise HTTPException(status_code=404, detail=f"Historical mission '{mission_id}' not found in database.")
    return m


@app.get("/api/historical/nearby")
def get_nearby_historical_endpoint(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Target latitude in degrees"),
    lon: float = Query(..., ge=-180.0, le=360.0, description="Target longitude in degrees"),
    radius_km: float = 3500.0,
    limit: int = 6
):
    """
    Module 12 Section E: Calculate lunar spherical distances to nearby historical landing sites
    and exploration corridors, reporting distance, bearing, and observation quality.
    """
    from engines.historical_engine import get_nearby_historical_missions
    return get_nearby_historical_missions(
        latitude=lat,
        longitude=lon,
        max_distance_km=radius_km,
        limit=limit
    )


@app.get("/api/historical/compare")
def compare_historical_endpoint(
    id_a: str = Query(..., description="First mission ID (e.g. chandrayaan-3)"),
    id_b: str = Query(..., description="Second mission ID (e.g. apollo-11)")
):
    """
    Module 12 Section I: Generate a side-by-side scientific comparison between two historical
    lunar missions across instruments, samples returned, distance traversed, and terrain context.
    """
    from engines.historical_engine import compare_historical_missions
    result = compare_historical_missions(id_a, id_b)
    if not result:
        raise HTTPException(status_code=404, detail="One or both mission IDs were not found in the historical database.")
    return result


@app.get("/api/historical/validate")
def validate_historical_endpoint(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Target latitude in degrees"),
    lon: float = Query(..., ge=-180.0, le=360.0, description="Target longitude in degrees"),
    predicted_thermal_k: Optional[float] = None,
    predicted_solar_flux: Optional[float] = None
):
    """
    Module 12 Section G: Compare platform estimated values with authoritative in-situ historical
    observations (e.g., Chandrayaan-3 ChaSTE thermal probe at Shiv Shakti Point or Apollo HFE).
    """
    from engines.historical_engine import validate_against_historical
    return validate_against_historical(
        latitude=lat,
        longitude=lon,
        predicted_thermal_k=predicted_thermal_k,
        predicted_solar_flux_w_m2=predicted_solar_flux
    )


# ============================================================
# END OF LUNASITE BACKEND
# ============================================================
