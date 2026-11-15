import uuid
import math
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List, Tuple

from models.schemas import (
    UnifiedAnalysisResult,
    LocationMetadata,
    ParameterMetric,
)
from engines.lunar_sky import LunarSky
from engines.terrain_engine import TerrainEngine
from engines.environmental_engine import EnvironmentalEngine
from engines.communication_engine import CommunicationEngine
from database import list_features


class AnalysisPipeline:
    """
    Central Scientific Analysis Pipeline.
    Integrates terrain, ephemeris, environmental, and communication engines
    to generate a complete, standardized location analysis.
    """

    def __init__(self, lunar_sky: LunarSky, terrain_engine: TerrainEngine):
        self.sky = lunar_sky
        self.terrain = terrain_engine
        self.env = EnvironmentalEngine(lunar_sky)
        self.comm = CommunicationEngine(lunar_sky)
        self._cache: Dict[str, UnifiedAnalysisResult] = {}

    def analyze(
        self,
        latitude: float,
        longitude: float,
        height_m: float = 0.0,
        obs_time: Optional[datetime] = None
    ) -> UnifiedAnalysisResult:
        if obs_time is None:
            obs_time = datetime.now(timezone.utc)

        time_str = obs_time.isoformat()
        cache_key = f"{latitude:.5f}_{longitude:.5f}_{height_m:.1f}_{time_str[:13]}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        # 1. Location and Landmark Identification
        inside_polar = self.terrain.is_inside_polar_coverage(latitude, longitude)
        region_name, feature_name, crater_dist = self._identify_region(latitude, longitude)

        location_meta = LocationMetadata(
            latitude=latitude,
            longitude=longitude,
            height_m=height_m,
            region_name=region_name,
            inside_highres_dem=inside_polar,
            feature_name=feature_name,
            crater_proximity_km=crater_dist
        )

        # 2. Terrain Analysis
        terrain_res = self.terrain.analyze_location_terrain(latitude, longitude)

        # 3. Solar & Illumination Analysis (with terrain horizon masking)
        solar_res = self.env.evaluate_solar_and_illumination(
            latitude, longitude, height_m, terrain_res.horizon_mask, obs_time
        )

        # 4. Communication & DTE Line-of-Sight
        comm_res = self.comm.evaluate_communication(
            latitude, longitude, height_m, terrain_res.horizon_mask, obs_time
        )

        # 5. Thermal & Volatiles Analysis
        thermal_res = self.env.evaluate_thermal_environment(
            latitude, longitude, solar_res
        )

        # 6. Standardized Parameter Dictionary
        parameters: Dict[str, ParameterMetric] = {
            "elevation_m": terrain_res.elevation_m,
            "slope_deg": terrain_res.slope_deg,
            "roughness_m": terrain_res.roughness_m,
            "hazard_density": terrain_res.hazard_density,
            "terrain_relief_m": terrain_res.terrain_relief_m,
            "sun_elevation_deg": solar_res.sun_elevation_deg,
            "sun_azimuth_deg": solar_res.sun_azimuth_deg,
            "sun_distance_km": solar_res.sun_distance_km,
            "solar_flux_w_m2": solar_res.solar_flux_w_m2,
            "terrain_clearance_sun_deg": solar_res.terrain_clearance_deg,
            "sunlight_duration_percent": solar_res.sunlight_duration_percent,
            "earth_elevation_deg": comm_res.earth_elevation_deg,
            "earth_azimuth_deg": comm_res.earth_azimuth_deg,
            "earth_distance_km": comm_res.earth_distance_km,
            "terrain_clearance_earth_deg": comm_res.terrain_clearance_deg,
            "rf_latency_sec": comm_res.rf_latency_sec,
            "current_temp_k": thermal_res.current_temp_k,
            "diurnal_max_k": thermal_res.diurnal_max_k,
            "diurnal_min_k": thermal_res.diurnal_min_k,
            "water_ice_evidence": thermal_res.water_ice_evidence,
        }

        # 7. Limitations & Data Coverage
        limitations: List[str] = [
            "Decision-support pre-mission assessment only. Does not certify landing safety or replace onboard autonomous Terrain Relative Navigation (TRN)."
        ]
        if not inside_polar:
            limitations.append(
                "Location is outside 80°S LOLA High-Resolution Polar GeoTIFF coverage. Elevation and slope derived from global heritage models with ~500m spatial resolution."
            )
        else:
            limitations.append(
                "High-resolution 80m/px LOLA Polar GeoTIFF applied. Sub-meter boulder obstacles require high-resolution optical imagery (LROC NAC) verification."
            )

        if not comm_res.is_earth_visible:
            limitations.append(
                "Earth is occluded. Direct telemetry is unavailable; mission feasibility relies strictly on lunar communication relay infrastructure."
            )

        # Calculate coverage percent
        valid_count = sum(1 for p in parameters.values() if p.status == "valid")
        coverage_pct = round((valid_count / len(parameters)) * 100.0, 1)

        analysis_id = f"loc_{uuid.uuid4().hex[:8]}"

        result = UnifiedAnalysisResult(
            analysis_id=analysis_id,
            time_utc=time_str,
            location=location_meta,
            parameters=parameters,
            terrain=terrain_res,
            solar=solar_res,
            communication=comm_res,
            thermal=thermal_res,
            data_coverage_percent=coverage_pct,
            limitations=limitations
        )

        self._cache[cache_key] = result
        self._cache[analysis_id] = result
        return result

    def get_by_id(self, analysis_id: str) -> Optional[UnifiedAnalysisResult]:
        return self._cache.get(analysis_id)

    def _identify_region(self, lat: float, lon: float) -> Tuple[str, Optional[str], Optional[float]]:
        """Identifies lunar region and proximity to known features/craters."""
        features_resp = list_features()
        features = features_resp if isinstance(features_resp, list) else features_resp.get("features", [])

        closest_feat = None
        min_dist_km = 99999.0

        for f in features:
            f_lat = f["latitude_deg"]
            f_lon = f["longitude_deg"]
            d_lat = lat - f_lat
            d_lon = (lon - f_lon) * math.cos(math.radians((lat + f_lat) / 2))
            dist_km = math.sqrt(d_lat**2 + d_lon**2) * 30.3
            if dist_km < min_dist_km:
                min_dist_km = dist_km
                closest_feat = f

        feature_name = None
        crater_dist = None
        if closest_feat and min_dist_km <= (closest_feat.get("diameter_km") or 50.0):
            feature_name = closest_feat["name"]
            crater_dist = round(min_dist_km, 1)

        # Region classification
        if lat <= -80.0:
            reg = "Deep Lunar South Pole Exploration Zone"
            if feature_name:
                reg += f" ({feature_name} Vicinity)"
        elif lat <= -60.0:
            reg = "South Polar High-Latitude Highlands"
        elif lat >= 80.0:
            reg = "Deep Lunar North Pole Exploration Zone"
        elif lat >= 60.0:
            reg = "North Polar High-Latitude Highlands"
        elif abs(lon) < 90.0:
            reg = "Lunar Nearside Mare / Highland Basin"
        else:
            reg = "Lunar Farside Terrain / South Pole-Aitken Basin"

        return reg, feature_name, crater_dist
