from typing import Dict, List, Any, Optional, Tuple

from models.schemas import (
    UnifiedAnalysisResult,
    GradingScore,
    SafetyCheck,
    MissionGradingResult,
)

PREDEFINED_MISSION_PROFILES = {
    "scientific_research": {
        "id": "scientific_research",
        "name": "Scientific Research",
        "description": "Explores geological diversity, volatile cold-traps, impact melt sheets, and ancient crustal composition.",
        "weights": {
            "scientific_diversity": 25.0,
            "mineral_potential": 20.0,
            "water_ice_evidence": 20.0,
            "geological_features": 15.0,
            "temperature_suitability": 10.0,
            "accessibility": 10.0,
        },
        "mandatory_checks": [
            {"name": "Terrain Data Availability", "param": "elevation_m", "check": "is_valid", "label": "Valid elevation and geomorphological dataset"}
        ]
    },
    "rover_exploration": {
        "id": "rover_exploration",
        "name": "Rover Exploration",
        "description": "Prioritizes surface traversability, gentle slopes, low roughness, and continuous solar power for autonomous mobility.",
        "weights": {
            "surface_traversability": 25.0,
            "slope_suitability": 20.0,
            "crater_safety": 20.0,
            "communication_availability": 15.0,
            "sunlight_availability": 10.0,
            "scientific_opportunities": 10.0,
        },
        "mandatory_checks": [
            {"name": "Traversability Slope Limit", "param": "slope_deg", "max_val": 15.0, "fail_val": 18.0, "label": "Slope <= 15° (max limit 18°)"},
            {"name": "Crater Hazard Tolerance", "param": "hazard_density", "max_val": 25.0, "fail_val": 30.0, "label": "Hazard density <= 25%"}
        ]
    },
    "human_landing": {
        "id": "human_landing",
        "name": "Human Landing (Artemis / Crewed)",
        "description": "Mandates strict landing gear stability, hazard clearance, direct Earth telemetry, and life-support thermal margins.",
        "weights": {
            "landing_terrain_safety": 25.0,
            "slope_suitability": 20.0,
            "hazard_avoidance": 15.0,
            "thermal_conditions": 15.0,
            "communication_availability": 10.0,
            "illumination_power": 10.0,
            "resource_potential": 5.0,
        },
        "mandatory_checks": [
            {"name": "Lander Tilt-Over Slope Limit", "param": "slope_deg", "max_val": 10.0, "fail_val": 12.0, "label": "Landing Slope <= 10.0° (Lander tip-over constraint)"},
            {"name": "Direct Earth Comm or Relay", "param": "is_earth_visible", "check": "bool_true", "label": "Direct-to-Earth Line-of-Sight or Verified Relay"},
            {"name": "High-Resolution Terrain Coverage", "param": "elevation_m", "check": "is_valid", "label": "Verified LOLA Topographic Verification"}
        ]
    },
    "resource_exploration": {
        "id": "resource_exploration",
        "name": "Resource Exploration & ISRU",
        "description": "Targets potential water-ice volatiles, cryogenic cold-traps, mineral feedstock, and operational mining feasibility.",
        "weights": {
            "water_ice_evidence": 30.0,
            "resource_potential": 25.0,
            "scientific_confidence": 15.0,
            "temperature_conditions": 10.0,
            "surface_accessibility": 10.0,
            "communication": 5.0,
            "power_availability": 5.0,
        },
        "mandatory_checks": [
            {"name": "Volatile Trap or Resource Evidence", "param": "water_ice_evidence", "min_val": 20.0, "label": "Minimum volatile / water-ice evidence signature >= 20"}
        ]
    },
    "solar_power_and_comm": {
        "id": "solar_power_and_comm",
        "name": "Solar Power & Communications Node",
        "description": "Optimized for ridge peaks of eternal light, maximum annual illumination duty-cycle, and continuous DTE communication line-of-sight.",
        "weights": {
            "sunlight_duration": 30.0,
            "earth_visibility": 25.0,
            "terrain_horizon_conditions": 15.0,
            "temperature_suitability": 10.0,
            "surface_accessibility": 10.0,
            "scientific_value": 10.0,
        },
        "mandatory_checks": [
            {"name": "Sustained Sunlight Duty Cycle", "param": "sunlight_duration_percent", "min_val": 40.0, "label": "Annual illumination fraction >= 40%"},
            {"name": "Direct Earth Telemetry Link", "param": "is_earth_visible", "check": "bool_true", "label": "Direct-to-Earth Visibility (no terrain occlusion)"}
        ]
    }
}


def normalize_slope(slope_deg: Optional[float]) -> Optional[float]:
    """Slope normalization: 0° -> 100, 5° -> 90, 10° -> 70, 15° -> 40, >=20° -> 0."""
    if slope_deg is None:
        return None
    s = max(0.0, float(slope_deg))
    if s <= 3.0:
        return 100.0 - (s / 3.0) * 5.0
    elif s <= 8.0:
        return 95.0 - ((s - 3.0) / 5.0) * 15.0
    elif s <= 12.0:
        return 80.0 - ((s - 8.0) / 4.0) * 25.0
    elif s <= 18.0:
        return 55.0 - ((s - 12.0) / 6.0) * 45.0
    else:
        return max(0.0, 10.0 - (s - 18.0) * 2.0)


def normalize_roughness(roughness_m: Optional[float]) -> Optional[float]:
    """Roughness normalization: 0m -> 100, 5m -> 85, 15m -> 60, 30m -> 30, >=50m -> 0."""
    if roughness_m is None:
        return None
    r = max(0.0, float(roughness_m))
    if r <= 2.0:
        return 100.0 - (r / 2.0) * 5.0
    elif r <= 8.0:
        return 95.0 - ((r - 2.0) / 6.0) * 15.0
    elif r <= 20.0:
        return 80.0 - ((r - 8.0) / 12.0) * 35.0
    elif r <= 40.0:
        return 45.0 - ((r - 20.0) / 20.0) * 35.0
    else:
        return max(0.0, 10.0 - (r - 40.0))


def normalize_hazards(hazard_density: Optional[float]) -> Optional[float]:
    """Hazard density normalization: 0% -> 100, 5% -> 85, 15% -> 55, >=30% -> 0."""
    if hazard_density is None:
        return None
    h = max(0.0, min(100.0, float(hazard_density)))
    return max(0.0, round(100.0 - (h * 3.1), 1))


def normalize_sunlight(duration_pct: Optional[float]) -> Optional[float]:
    """Sunlight duration normalization: 0% -> 10, 50% -> 60, 75% -> 85, >=88% -> 100."""
    if duration_pct is None:
        return None
    d = max(0.0, min(100.0, float(duration_pct)))
    if d >= 80.0:
        return round(90.0 + ((d - 80.0) / 20.0) * 10.0, 1)
    elif d >= 50.0:
        return round(65.0 + ((d - 50.0) / 30.0) * 25.0, 1)
    elif d >= 20.0:
        return round(30.0 + ((d - 20.0) / 30.0) * 35.0, 1)
    else:
        return round(max(5.0, d * 1.5), 1)


def normalize_comm(earth_clearance_deg: Optional[float], is_visible: bool) -> float:
    """Earth communication normalization based on clearance above terrain horizon."""
    if not is_visible or earth_clearance_deg is None:
        return 0.0
    c = float(earth_clearance_deg)
    if c >= 10.0:
        return 100.0
    elif c >= 5.0:
        return round(80.0 + ((c - 5.0) / 5.0) * 20.0, 1)
    elif c > 0.0:
        return round(40.0 + (c / 5.0) * 40.0, 1)
    else:
        return 0.0


def score_to_grade(score: Optional[float]) -> str:
    if score is None:
        return "INSUFFICIENT DATA"
    if score >= 90.0:
        return "A+"
    elif score >= 80.0:
        return "A"
    elif score >= 70.0:
        return "B"
    elif score >= 60.0:
        return "C"
    elif score >= 40.0:
        return "D"
    else:
        return "F"


class GradingEngine:
    """
    Unified Dynamic Multi-Criteria Mission Decision & Grading Engine.
    Evaluates any location analysis against configured or custom mission weights
    and independently enforces mandatory safety screening constraints.
    """

    def evaluate_mission(
        self,
        analysis: UnifiedAnalysisResult,
        mission_id: str = "human_landing",
        custom_weights: Optional[Dict[str, float]] = None
    ) -> MissionGradingResult:
        # 1. Resolve Profile & Weights
        profile_def = PREDEFINED_MISSION_PROFILES.get(mission_id)
        if not profile_def:
            profile_def = PREDEFINED_MISSION_PROFILES["human_landing"]

        weights = custom_weights or profile_def["weights"]
        total_w = sum(max(0.0, w) for w in weights.values())
        if total_w <= 0.0:
            total_w = 1.0

        # 2. Extract and Normalize Parameters
        param_scores: List[GradingScore] = []
        valid_weight_sum = 0.0
        weighted_score_sum = 0.0

        # Mapping of criteria to normalized scores
        t = analysis.terrain
        s = analysis.solar
        c = analysis.communication
        th = analysis.thermal

        crit_map: Dict[str, Tuple[str, Optional[float], str, Optional[float]]] = {
            # key: (name, raw_value, unit, normalized_score)
            "slope_suitability": ("Surface Slope Suitability", t.slope_deg.value, "deg", normalize_slope(t.slope_deg.value)),
            "landing_terrain_safety": ("Landing Terrain Safety", t.terrain_relief_m.value, "m", normalize_roughness(t.terrain_relief_m.value)),
            "surface_traversability": ("Surface Traversability", t.roughness_m.value, "m", normalize_roughness(t.roughness_m.value)),
            "crater_safety": ("Crater & Obstacle Safety", t.hazard_density.value, "%", normalize_hazards(t.hazard_density.value)),
            "hazard_avoidance": ("Hazard Avoidance Clearance", t.hazard_density.value, "%", normalize_hazards(t.hazard_density.value)),
            "communication_availability": ("Direct-to-Earth Comm Link", c.terrain_clearance_deg.value, "deg", normalize_comm(c.terrain_clearance_deg.value, c.is_earth_visible)),
            "communication": ("Communications Visibility", c.terrain_clearance_deg.value, "deg", normalize_comm(c.terrain_clearance_deg.value, c.is_earth_visible)),
            "earth_visibility": ("Earth Visibility Window", c.terrain_clearance_deg.value, "deg", normalize_comm(c.terrain_clearance_deg.value, c.is_earth_visible)),
            "sunlight_availability": ("Sunlight / Power Availability", s.sunlight_duration_percent.value, "%", normalize_sunlight(s.sunlight_duration_percent.value)),
            "sunlight_duration": ("Annual Sunlight Duration", s.sunlight_duration_percent.value, "%", normalize_sunlight(s.sunlight_duration_percent.value)),
            "illumination_power": ("Illumination & Power Opportunity", s.solar_flux_w_m2.value, "W/m²", min(100.0, (s.solar_flux_w_m2.value or 0.0) / 13.61) if s.solar_flux_w_m2.value is not None else 20.0),
            "terrain_horizon_conditions": ("Terrain Horizon Elevation Mask", max(t.horizon_mask.values()) if t.horizon_mask else 0.0, "deg", max(0.0, 100.0 - (max(t.horizon_mask.values()) if t.horizon_mask else 0.0) * 3.5)),
            "water_ice_evidence": ("Water-Ice / Volatiles Potential", th.water_ice_evidence.value, "Index", th.water_ice_evidence.value),
            "resource_potential": ("Mineral & Volatile Resource Potential", th.water_ice_evidence.value, "Index", th.water_ice_evidence.value or 15.0),
            "scientific_diversity": ("Geological & Morphological Diversity", t.depressions_count, "Features", min(100.0, 45.0 + t.depressions_count * 15.0)),
            "mineral_potential": ("Mineral / Compositional Potential", 65.0, "Index", 65.0),
            "geological_features": ("Prominent Lunar Features", t.terrain_relief_m.value, "m", min(100.0, 30.0 + (t.terrain_relief_m.value or 0.0) * 0.4)),
            "scientific_opportunities": ("Scientific Research Opportunities", 70.0, "Index", 70.0),
            "scientific_confidence": ("Scientific Data Confidence", 85.0 if t.elevation_m.confidence == "high" else 60.0, "%", 85.0 if t.elevation_m.confidence == "high" else 60.0),
            "scientific_value": ("Scientific Value & Site Context", 75.0, "Index", 75.0),
            "temperature_suitability": ("Thermal Environment Suitability", th.current_temp_k.value, "K", 90.0 if (120.0 <= (th.current_temp_k.value or 0.0) <= 250.0) else 45.0),
            "temperature_conditions": ("Cryogenic Temperature Conditions", th.current_temp_k.value, "K", 90.0 if (th.current_temp_k.value or 300.0) < 110.0 else 70.0 if (th.current_temp_k.value or 300.0) < 150.0 else 20.0),
            "thermal_conditions": ("Thermal Life-Support Margins", th.current_temp_k.value, "K", 85.0 if (th.diurnal_max_k.value or 0.0) <= 260.0 else 40.0),
            "surface_accessibility": ("Surface Incline & Accessibility", t.slope_deg.value, "deg", normalize_slope(t.slope_deg.value)),
            "accessibility": ("Approach & Access Terrain", t.slope_deg.value, "deg", normalize_slope(t.slope_deg.value)),
            "power_availability": ("Solar Power Viability", s.sunlight_duration_percent.value, "%", normalize_sunlight(s.sunlight_duration_percent.value)),
        }

        for crit_key, raw_weight in weights.items():
            norm_w = (raw_weight / total_w) * 100.0
            crit_info = crit_map.get(crit_key, (crit_key.replace("_", " ").title(), None, "-", None))
            name, raw_v, unit, norm_s = crit_info

            if norm_s is not None:
                contrib = round((norm_s * (norm_w / 100.0)), 2)
                weighted_score_sum += contrib
                valid_weight_sum += norm_w
                status = "valid"
            else:
                contrib = 0.0
                status = "insufficient_data"

            param_scores.append(GradingScore(
                parameter_key=crit_key,
                parameter_name=name,
                raw_value=raw_v,
                unit=unit,
                normalized_score=round(norm_s, 1) if norm_s is not None else None,
                weight_percent=round(norm_w, 1),
                weighted_contribution=contrib,
                status=status
            ))

        coverage_pct = round(valid_weight_sum, 1)
        final_score = round(weighted_score_sum * (100.0 / valid_weight_sum), 1) if valid_weight_sum > 0 else None

        # 3. Mandatory Safety Screening Checks
        safety_checks: List[SafetyCheck] = []
        overall_safety_status = "PASS"

        for m_check in profile_def.get("mandatory_checks", []):
            chk_name = m_check["name"]
            param_key = m_check["param"]
            label = m_check["label"]

            # Evaluate specific check
            if param_key == "slope_deg":
                val = t.slope_deg.value
                obs_str = f"{val}° measured slope" if val is not None else "No data"
                if val is None:
                    c_status = "INSUFFICIENT_DATA"
                    msg = "LOLA slope data unavailable for mandatory safety evaluation."
                elif val > m_check.get("fail_val", 15.0):
                    c_status = "FAIL"
                    msg = f"Measured slope ({val}°) exceeds critical abort limit ({m_check.get('fail_val')}°). High tip-over risk."
                elif val > m_check.get("max_val", 10.0):
                    c_status = "MARGINAL"
                    msg = f"Measured slope ({val}°) is above ideal threshold ({m_check.get('max_val')}°) but below absolute abort limit."
                else:
                    c_status = "PASS"
                    msg = f"Measured slope ({val}°) is within landing gear envelope."

            elif param_key == "is_earth_visible":
                vis = c.is_earth_visible
                clearance = c.terrain_clearance_deg.value
                obs_str = f"Clearance: {clearance}° ({c.dte_status})"
                if not vis or (clearance is not None and clearance <= 0.0):
                    c_status = "FAIL"
                    msg = "Direct-to-Earth line-of-sight is occluded by lunar body or terrain rim. Dedicated orbital relay required."
                else:
                    c_status = "PASS"
                    msg = f"Direct Earth radio visibility confirmed with {clearance}° terrain clearance."

            elif param_key == "hazard_density":
                val = t.hazard_density.value
                obs_str = f"{val}% steep slope density" if val is not None else "No data"
                if val is None:
                    c_status = "INSUFFICIENT_DATA"
                    msg = "Local hazard density could not be evaluated from subgrid."
                elif val > m_check.get("fail_val", 30.0):
                    c_status = "FAIL"
                    msg = f"Crater and steep slope hazard density ({val}%) exceeds safe navigation limits."
                else:
                    c_status = "PASS"
                    msg = f"Hazard density ({val}%) is within autonomous avoidance limits."

            elif param_key == "sunlight_duration_percent":
                val = s.sunlight_duration_percent.value
                obs_str = f"{val}% illumination" if val is not None else "No data"
                if val is None:
                    c_status = "INSUFFICIENT_DATA"
                    msg = "Illumination timeline incomplete."
                elif val < m_check.get("min_val", 40.0):
                    c_status = "FAIL"
                    msg = f"Sunlight duty cycle ({val}%) is insufficient for continuous primary solar operations."
                else:
                    c_status = "PASS"
                    msg = f"Sunlight duty cycle ({val}%) meets mission operational threshold."

            elif param_key == "water_ice_evidence":
                val = th.water_ice_evidence.value
                obs_str = f"Indicator: {val}/100" if val is not None else "No data"
                if val is None or val < m_check.get("min_val", 20.0):
                    c_status = "FAIL"
                    msg = "No significant cryogenic cold-trap or volatile signature observed at this site."
                else:
                    c_status = "PASS"
                    msg = f"Volatile signature ({val}/100) satisfies target resource criteria."

            else:
                obs_str = "Verified"
                c_status = "PASS"
                msg = "Data verification requirement satisfied."

            safety_checks.append(SafetyCheck(
                name=chk_name,
                criterion=label,
                observed_value=obs_str,
                status=c_status,
                message=msg
            ))

            if c_status == "FAIL":
                overall_safety_status = "FAIL"
            elif c_status == "INSUFFICIENT_DATA" and overall_safety_status != "FAIL":
                overall_safety_status = "INSUFFICIENT DATA"

        grade = score_to_grade(final_score)
        if overall_safety_status == "FAIL":
            summary = f"Location achieved a score of {final_score}/100 (Grade {grade}), but FAILED mandatory safety screening ({[c.name for c in safety_checks if c.status == 'FAIL']}). Landing operations restricted."
        elif overall_safety_status == "INSUFFICIENT DATA":
            summary = f"Location scored {final_score}/100 (Grade {grade}), but mandatory safety parameters have insufficient data coverage. Requires higher-resolution verification."
        else:
            summary = f"Location scored {final_score}/100 (Grade {grade}) with all mandatory safety criteria PASSED. Promising candidate for {profile_def['name']}."

        pros: List[str] = []
        cons: List[str] = []

        if t.slope_deg.value is not None and t.slope_deg.value <= 10.0:
            pros.append(f"Gentle terrain slope ({t.slope_deg.value:.1f}°), well within safe landing stability limits (<= 10°).")
        if c.is_earth_visible and c.terrain_clearance_deg.value is not None and c.terrain_clearance_deg.value > 2.0:
            pros.append(f"Unobstructed Direct-to-Earth line-of-sight with +{c.terrain_clearance_deg.value:.1f}° terrain clearance margin.")
        if s.is_sunlit:
            pros.append(f"Currently illuminated by sunlight ({s.solar_flux_w_m2.value:.0f} W/m² solar flux) supporting solar arrays.")
        if th.water_ice_evidence.value is not None and th.water_ice_evidence.value >= 40.0:
            pros.append(f"Favorable volatile/cold-trap signature ({th.water_ice_evidence.value:.0f}/100) indicating potential resource deposits.")
        if t.depressions_count > 0:
            pros.append(f"Geological diversity: {t.depressions_count} distinct crater/depression feature(s) identified within 5.0 km baseline.")

        if t.slope_deg.value is not None and t.slope_deg.value > 12.0:
            cons.append(f"Steep terrain slope ({t.slope_deg.value:.1f}°), exceeding standard lander stability thresholds.")
        if not c.is_earth_visible:
            cons.append("Zero direct line-of-sight to Earth (farside or terrain blocked); orbital relay satellite is mandatory.")
        elif c.terrain_clearance_deg.value is not None and c.terrain_clearance_deg.value <= 2.0:
            cons.append(f"Marginal Earth line-of-sight (+{c.terrain_clearance_deg.value:.1f}° clearance); risk of multipath fading.")
        if not s.is_sunlit:
            cons.append(f"Currently in lunar shadow / night ({s.sun_elevation_deg.value:.1f}° Sun elevation); requires battery or RTG power.")
        if th.current_temp_k.value is not None and th.current_temp_k.value < 100.0:
            cons.append(f"Extreme cryogenic temperature ({th.current_temp_k.value:.0f} K); risk of component embrittlement.")

        for chk in safety_checks:
            if chk.status == "FAIL":
                cons.append(f"Safety Constraint Violation: {chk.name} ({chk.observed_value} vs limit {chk.criterion}).")

        return MissionGradingResult(
            mission_id=mission_id,
            mission_name=profile_def["name"],
            overall_score=final_score,
            grade=grade,
            safety_screening=overall_safety_status,
            data_coverage_percent=coverage_pct,
            parameter_scores=param_scores,
            safety_checks=safety_checks,
            summary_explanation=summary,
            pros=pros,
            cons=cons
        )
