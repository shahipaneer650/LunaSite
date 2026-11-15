from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class ParameterMetric(BaseModel):
    name: str
    value: Optional[float] = None
    unit: str
    source: str
    resolution_m: Optional[float] = None
    observation_period: Optional[str] = None
    confidence: str = "high"  # "high", "moderate", "low", "coarse", "unknown"
    status: str = "valid"  # "valid", "insufficient_data", "coarse_resolution", "not_applicable"
    calculation_method: Optional[str] = None
    description: Optional[str] = None


class LocationMetadata(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=360.0)
    height_m: float = 0.0
    region_name: str
    inside_highres_dem: bool = False
    feature_name: Optional[str] = None
    crater_proximity_km: Optional[float] = None


class TerrainProfileSample(BaseModel):
    distance_m: float
    height_m: float


class TerrainAnalysisResult(BaseModel):
    elevation_m: ParameterMetric
    slope_deg: ParameterMetric
    roughness_m: ParameterMetric
    hazard_density: ParameterMetric
    terrain_relief_m: ParameterMetric
    depressions_count: int = 0
    profile_samples: List[TerrainProfileSample] = []
    horizon_mask: Dict[int, float] = {}  # azimuth_deg -> max_horizon_elev_deg


class SolarAnalysisResult(BaseModel):
    sun_elevation_deg: ParameterMetric
    sun_azimuth_deg: ParameterMetric
    sun_distance_km: ParameterMetric
    solar_flux_w_m2: ParameterMetric
    terrain_clearance_deg: ParameterMetric
    is_sunlit: bool
    illumination_status: str
    sunlight_duration_percent: ParameterMetric
    is_permanently_shadowed: bool


class CommAnalysisResult(BaseModel):
    earth_elevation_deg: ParameterMetric
    earth_azimuth_deg: ParameterMetric
    earth_distance_km: ParameterMetric
    terrain_clearance_deg: ParameterMetric
    is_earth_visible: bool
    rf_latency_sec: ParameterMetric
    dte_status: str
    free_space_path_loss_db: Optional[ParameterMetric] = None
    rf_link_margin_db: Optional[ParameterMetric] = None


class ThermalAnalysisResult(BaseModel):
    current_temp_k: ParameterMetric
    diurnal_max_k: ParameterMetric
    diurnal_min_k: ParameterMetric
    thermal_environment: str
    water_ice_evidence: ParameterMetric


class UnifiedAnalysisResult(BaseModel):
    analysis_id: str
    time_utc: str
    location: LocationMetadata
    parameters: Dict[str, ParameterMetric]
    terrain: TerrainAnalysisResult
    solar: SolarAnalysisResult
    communication: CommAnalysisResult
    thermal: ThermalAnalysisResult
    data_coverage_percent: float
    limitations: List[str] = []


# ==============================================================================
# MISSION GRADING & DECISION MODELS
# ==============================================================================

class GradingScore(BaseModel):
    parameter_key: str
    parameter_name: str
    raw_value: Optional[float] = None
    unit: str
    normalized_score: Optional[float] = None  # 0 to 100
    weight_percent: float
    weighted_contribution: float
    status: str  # "valid", "insufficient_data"


class SafetyCheck(BaseModel):
    name: str
    criterion: str
    observed_value: str
    status: str  # "PASS", "FAIL", "INSUFFICIENT_DATA", "NOT_APPLICABLE"
    message: str


class MissionGradingResult(BaseModel):
    mission_id: str
    mission_name: str
    overall_score: Optional[float] = None  # 0 to 100
    grade: str  # "A+", "A", "B", "C", "D", "F", "INSUFFICIENT DATA"
    safety_screening: str  # "PASS", "FAIL", "INSUFFICIENT DATA"
    data_coverage_percent: float
    parameter_scores: List[GradingScore]
    safety_checks: List[SafetyCheck]
    summary_explanation: str
    pros: List[str] = []
    cons: List[str] = []


class FindingItem(BaseModel):
    title: str
    type: str  # "Advantage", "Disadvantage", "Opportunity", "Warning", "Unknown"
    severity: str  # "Critical", "High", "Moderate", "Low", "Informational"
    explanation: str
    supporting_measurement: str
    data_source: str
    confidence: str
    mission_relevance: str


class RiskItem(BaseModel):
    category: str  # "Terrain", "Slope", "Crater & Obstacle", "Thermal", "Illumination", "Communication", "Data Quality"
    description: str
    severity: str  # "Low", "Moderate", "High", "Critical", "Unknown"
    evidence: str
    affected_mission: str
    recommended_investigation: str
    confidence: str


class LocationComparisonItem(BaseModel):
    location_id: str
    name: str
    latitude: float
    longitude: float
    elevation_m: Optional[float]
    slope_deg: Optional[float]
    roughness_m: Optional[float]
    sunlight_duration_percent: Optional[float]
    earth_visible: bool
    water_ice_indicator: str
    mission_score: Optional[float]
    grade: str
    safety_status: str
    key_advantage: str
    key_disadvantage: str


class CustomMissionProfileRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    weights: Dict[str, float]  # parameter_key -> weight
    safety_criteria: Optional[Dict[str, float]] = None
