from typing import List
from models.schemas import UnifiedAnalysisResult, FindingItem, RiskItem


class RulesEngine:
    """
    Evidence-based Pros & Cons and Operational Risk Assessment Engine.
    Evaluates calculated scientific measurements against documented lunar mission rules.
    """

    def generate_findings(self, analysis: UnifiedAnalysisResult, mission_id: str = "human_landing") -> List[FindingItem]:
        findings: List[FindingItem] = []
        t = analysis.terrain
        s = analysis.solar
        c = analysis.communication
        th = analysis.thermal

        # 1. Slope Findings
        slope = t.slope_deg.value
        if slope is not None:
            if slope <= 5.0:
                findings.append(FindingItem(
                    title="Gentle Surface Incline",
                    type="Advantage",
                    severity="Low",
                    explanation=f"Measured slope of {slope}° provides excellent landing stability and minimal rover tip-over risk.",
                    supporting_measurement=f"Slope: {slope}°",
                    data_source=t.slope_deg.source,
                    confidence=t.slope_deg.confidence,
                    mission_relevance="Directly reduces landing gear mechanical stress and improves rover wheel traction."
                ))
            elif slope <= 10.0:
                findings.append(FindingItem(
                    title="Moderate Surface Incline",
                    type="Opportunity",
                    severity="Moderate",
                    explanation=f"Measured slope of {slope}° is within standard lander tolerance (<= 12°), but requires precision guidance.",
                    supporting_measurement=f"Slope: {slope}°",
                    data_source=t.slope_deg.source,
                    confidence=t.slope_deg.confidence,
                    mission_relevance="Acceptable for landing with Terrain Relative Navigation (TRN)."
                ))
            else:
                findings.append(FindingItem(
                    title="Steep Hazardous Slope",
                    type="Disadvantage",
                    severity="High" if slope <= 15.0 else "Critical",
                    explanation=f"Measured slope of {slope}° exceeds safe human/rover landing constraints. Severe tip-over or rover slide hazard.",
                    supporting_measurement=f"Slope: {slope}°",
                    data_source=t.slope_deg.source,
                    confidence=t.slope_deg.confidence,
                    mission_relevance="Violates standard Apollo/Artemis landing envelope. Abort or divert required."
                ))

        # 2. Surface Roughness
        roughness = t.roughness_m.value
        if roughness is not None:
            if roughness <= 5.0:
                findings.append(FindingItem(
                    title="Smooth Micro-Topography",
                    type="Advantage",
                    severity="Low",
                    explanation=f"Low surface roughness (RMS {roughness} m) indicates minimal boulder fields and smooth regolith.",
                    supporting_measurement=f"Roughness RMS: {roughness} m",
                    data_source=t.roughness_m.source,
                    confidence=t.roughness_m.confidence,
                    mission_relevance="Favorable for rover autonomous path planning and landing leg footpad placement."
                ))
            elif roughness > 20.0:
                findings.append(FindingItem(
                    title="Elevated Terrain Roughness",
                    type="Disadvantage",
                    severity="Moderate",
                    explanation=f"High surface roughness (RMS {roughness} m) suggests significant boulder distribution or crater rim debris.",
                    supporting_measurement=f"Roughness RMS: {roughness} m",
                    data_source=t.roughness_m.source,
                    confidence=t.roughness_m.confidence,
                    mission_relevance="Increases risk of rover high-centering and lander structural damage."
                ))

        # 3. Direct-to-Earth Communication
        if c.is_earth_visible:
            clearance = c.terrain_clearance_deg.value or 0.0
            findings.append(FindingItem(
                title="Direct-to-Earth Line-of-Sight Active",
                type="Advantage",
                severity="Low",
                explanation=f"Earth is visible at {c.earth_elevation_deg.value}° elevation with {clearance}° terrain rim clearance. Enables high-bandwidth direct telemetry to DSN.",
                supporting_measurement=f"Earth Elev: {c.earth_elevation_deg.value}°, Clearance: {clearance}°",
                data_source=c.earth_elevation_deg.source,
                confidence=c.earth_elevation_deg.confidence,
                mission_relevance="Eliminates strict dependency on lunar orbital relay satellites for real-time mission abort/ops."
            ))
        else:
            findings.append(FindingItem(
                title="Direct Earth Communication Occluded",
                type="Disadvantage",
                severity="Critical",
                explanation=f"Site lacks line-of-sight to Earth ({c.dte_status}). Direct radio telemetry is impossible.",
                supporting_measurement=f"Status: {c.dte_status}",
                data_source=c.earth_elevation_deg.source,
                confidence=c.earth_elevation_deg.confidence,
                mission_relevance="Strictly mandates an operational lunar communication relay satellite (e.g. Lunar Gateway, Queqiao)."
            ))

        # 4. Solar Illumination & PSR
        sun_pct = s.sunlight_duration_percent.value
        if s.is_permanently_shadowed:
            findings.append(FindingItem(
                title="Permanently Shadowed Region (PSR)",
                type="Opportunity" if mission_id in ["resource_exploration", "scientific_research"] else "Disadvantage",
                severity="High",
                explanation="Location experiences continuous darkness sheltered by surrounding crater walls. No direct solar flux.",
                supporting_measurement="Sunlight Duration: 0.0%",
                data_source=s.sunlight_duration_percent.source,
                confidence=s.sunlight_duration_percent.confidence,
                mission_relevance="Critical opportunity for volatile & water-ice science, but precludes solar photovoltaic power (nuclear/fuel cells mandatory)."
            ))
        elif sun_pct is not None and sun_pct >= 70.0:
            findings.append(FindingItem(
                title="Extended High-Duty Solar Illumination",
                type="Advantage",
                severity="Low",
                explanation=f"Location receives direct sunlight for {sun_pct}% of the lunar cycle, providing a robust power environment.",
                supporting_measurement=f"Sunlight: {sun_pct}%",
                data_source=s.sunlight_duration_percent.source,
                confidence=s.sunlight_duration_percent.confidence,
                mission_relevance="Ideal for primary solar-powered rover or surface habitat survival with reduced battery mass."
            ))

        # 5. Volatiles & Water Ice
        ice_val = th.water_ice_evidence.value
        if ice_val and ice_val >= 70.0:
            findings.append(FindingItem(
                title="Significant Cryogenic Volatile Signature",
                type="Advantage" if mission_id in ["resource_exploration", "scientific_research"] else "Opportunity",
                severity="Moderate",
                explanation=f"Thermal stability (<110 K) and spectroscopic indicators support potential water-ice preservation ({th.water_ice_evidence.description}).",
                supporting_measurement=f"Volatile Indicator: {ice_val}/100",
                data_source=th.water_ice_evidence.source,
                confidence=th.water_ice_evidence.confidence,
                mission_relevance="Primary scientific objective for in-situ resource utilization (ISRU) and propellant production."
            ))

        # 6. Data Coverage Warning
        if not analysis.location.inside_highres_dem:
            findings.append(FindingItem(
                title="Coarse Topographic Data Resolution",
                type="Warning",
                severity="Moderate",
                explanation="Location is outside 80°S LOLA High-Resolution Polar GeoTIFF coverage. Measurements derived from global altimetry model (~500m resolution).",
                supporting_measurement="Resolution: ~500m vs 80m",
                data_source=t.elevation_m.source,
                confidence="moderate",
                mission_relevance="Micro-obstacles, meter-scale slopes, and small craters cannot be resolved. Targeted high-res orbital survey required."
            ))

        return findings

    def generate_risks(self, analysis: UnifiedAnalysisResult, mission_id: str = "human_landing") -> List[RiskItem]:
        risks: List[RiskItem] = []
        t = analysis.terrain
        s = analysis.solar
        c = analysis.communication
        th = analysis.thermal

        # Terrain & Slope Risk
        slope = t.slope_deg.value or 0.0
        if slope > 12.0:
            risks.append(RiskItem(
                category="Slope",
                description="Severe landing gear tip-over risk during touchdown.",
                severity="Critical" if slope > 15.0 else "High",
                evidence=f"Local slope measured at {slope}° (safe limit <= 10.0°).",
                affected_mission="Human Landing, Rover Exploration",
                recommended_investigation="Select alternative touchdown waypoint with slope <= 6° using TRN hazard map.",
                confidence=t.slope_deg.confidence
            ))
        elif slope > 7.0:
            risks.append(RiskItem(
                category="Slope",
                description="Moderate surface gradient may cause rover wheel slippage.",
                severity="Moderate",
                evidence=f"Slope measured at {slope}°.",
                affected_mission="Rover Exploration",
                recommended_investigation="Verify wheel regolith sinkage and grousers torque margin.",
                confidence=t.slope_deg.confidence
            ))

        # Hazard Density Risk
        hazards = t.hazard_density.value or 0.0
        if hazards > 15.0:
            risks.append(RiskItem(
                category="Crater & Obstacle",
                description="Elevated density of steep micro-craters or boulders within landing footprint.",
                severity="High" if hazards > 25.0 else "Moderate",
                evidence=f"{hazards}% of local area exceeds 15° slope.",
                affected_mission="Human Landing, Rover Exploration",
                recommended_investigation="High-resolution LROC NAC stereo photogrammetry (0.5 m/px) targeted pass.",
                confidence=t.hazard_density.confidence
            ))

        # Communication Risk
        if not c.is_earth_visible:
            risks.append(RiskItem(
                category="Communication",
                description="Complete direct Earth radio occlusion.",
                severity="Critical",
                evidence=f"Earth elevation is {c.earth_elevation_deg.value}° with terrain status '{c.dte_status}'.",
                affected_mission="All Missions",
                recommended_investigation="Verify operational orbit and contact schedule of dedicated lunar relay satellite.",
                confidence="high"
            ))
        elif (c.terrain_clearance_deg.value or 0.0) < 2.0:
            risks.append(RiskItem(
                category="Communication",
                description="Low terrain clearance margin (<2°) creates severe RF multipath and crater rim masking risk.",
                severity="Moderate",
                evidence=f"Earth terrain clearance is only {c.terrain_clearance_deg.value}°.",
                affected_mission="All Missions",
                recommended_investigation="Perform RF ray-tracing against high-res DEM to model multipath fading.",
                confidence="high"
            ))

        # Thermal / Cryogenic Risk
        if th.current_temp_k.value and th.current_temp_k.value < 90.0:
            risks.append(RiskItem(
                category="Thermal",
                description="Extreme cryogenic temperature environment (<90 K / -183°C).",
                severity="High",
                evidence=f"Surface temperature estimated at {th.current_temp_k.value} K (diurnal min {th.diurnal_min_k.value} K).",
                affected_mission="Human Landing, Rover Exploration",
                recommended_investigation="Mandatory RHU (Radioisotope Heater Unit) or active thermal loop for batteries, lubricants, and electronics.",
                confidence="high"
            ))

        # Data Quality Risk
        if not analysis.location.inside_highres_dem:
            risks.append(RiskItem(
                category="Data Quality",
                description="Coarse resolution terrain dataset increases sub-pixel landing hazard uncertainty.",
                severity="Moderate",
                evidence="Site located outside 80°S LOLA High-Res Polar DEM coverage.",
                affected_mission="All Missions",
                recommended_investigation="Commission LROC NAC narrow-angle camera stereo DEM generation before committing to site.",
                confidence="moderate"
            ))

        return risks
