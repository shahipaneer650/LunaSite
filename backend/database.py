"""
LunaSite Database Module — NASA Lunar Datasets & Supabase / SQLite Integration
Supports Supabase (PostgreSQL / PostgREST) with automatic local SQLite fallback.
"""

import os
import sqlite3
import json
import logging
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

logger = logging.getLogger("lunasite.database")

# Auto-load .env file if present
def _load_env_file():
    env_paths = [
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
    ]
    for p in env_paths:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k and k not in os.environ:
                            os.environ[k] = v

_load_env_file()

# Environment / Supabase Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
DB_FILE = os.path.join(os.path.dirname(__file__), "lunasite.db")


def supabase_request(
    endpoint: str,
    method: str = "GET",
    data: Any = None,
    query_params: Optional[Dict[str, str]] = None
) -> Optional[Any]:
    """Execute authenticated PostgREST request to Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None

    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{endpoint}"
    if query_params:
        url += f"?{urllib.parse.urlencode(query_params)}"

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    req_body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=req_body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            res_data = response.read().decode("utf-8")
            return json.loads(res_data) if res_data else []
    except Exception as err:
        logger.warning(f"Supabase request failed ({method} {endpoint}): {err}. Falling back to SQLite.")
        return None

# ==============================================================================
# CANONICAL NASA & HISTORICAL MOON MISSION DATASET
# ==============================================================================
INITIAL_MISSIONS = [
    {
        "name": "Chandrayaan-3 (Vikram / Pragyan)",
        "agency": "ISRO",
        "landing_date": "2023-08-23",
        "latitude_deg": -69.367621,
        "longitude_deg": 32.348126,
        "site_name": "Shiv Shakti Point",
        "status": "Success",
        "category": "Lander / Rover",
        "description": "First successful soft landing in the lunar South Pole region. Measured in-situ soil thermophysical properties (ChaSTE), plasma density (RAMBHA), and elemental composition (APXS / LIBS).",
        "scientific_significance": "Demonstrated lunar south polar high-latitude landing precision; confirmed sulfur, iron, and titanium presence in southern highlands."
    },
    {
        "name": "Apollo 11 (Eagle)",
        "agency": "NASA",
        "landing_date": "1969-07-20",
        "latitude_deg": 0.67408,
        "longitude_deg": 23.47297,
        "site_name": "Statio Tranquillitatis",
        "status": "Historical Success",
        "category": "Crewed Landing",
        "description": "First crewed lunar landing by Neil Armstrong and Buzz Aldrin. Returned 21.5 kg of lunar regolith and rock samples from Mare Tranquillitatis.",
        "scientific_significance": "Established baseline lunar mare basalts age (~3.7 billion years) and high titanium content."
    },
    {
        "name": "Apollo 12 (Intrepid)",
        "agency": "NASA",
        "landing_date": "1969-11-19",
        "latitude_deg": -3.01239,
        "longitude_deg": -23.42157,
        "site_name": "Oceanus Procellarum",
        "status": "Historical Success",
        "category": "Crewed Landing",
        "description": "Pinpoint landing within walking distance of the robotic Surveyor 3 spacecraft. Deployed the first ALSEP scientific geophysical station.",
        "scientific_significance": "Proved precision landing capability and recovered space-exposed hardware after 2.5 years."
    },
    {
        "name": "Apollo 15 (Falcon)",
        "agency": "NASA",
        "landing_date": "1971-07-30",
        "latitude_deg": 26.13222,
        "longitude_deg": 3.63386,
        "site_name": "Hadley-Apennine",
        "status": "Historical Success",
        "category": "Crewed Landing",
        "description": "First J-mission with Lunar Roving Vehicle (LRV). Explored Hadley Rille and the foot of the Montes Apenninus mountain range.",
        "scientific_significance": "Sampled the 'Genesis Rock' (anorthosite), confirming the magma ocean hypothesis for the ancient lunar crust."
    },
    {
        "name": "Apollo 17 (Challenger)",
        "agency": "NASA",
        "landing_date": "1972-12-11",
        "latitude_deg": 20.19080,
        "longitude_deg": 30.77168,
        "site_name": "Taurus-Littrow Valley",
        "status": "Historical Success",
        "category": "Crewed Landing",
        "description": "Final Apollo lunar surface mission. Geologist Harrison Schmitt and Gene Cernan spent 75 hours on the surface, discovering orange pyroclastic soil.",
        "scientific_significance": "Direct evidence of explosive volcanic eruptions and deep-seated lunar mantle volatiles."
    },
    {
        "name": "Chang'e 4 (Yutu-2)",
        "agency": "CNSA",
        "landing_date": "2019-01-03",
        "latitude_deg": -45.457,
        "longitude_deg": 177.588,
        "site_name": "Von Kármán Crater (SPA Basin)",
        "status": "Success",
        "category": "Lander / Rover",
        "description": "First soft landing on the lunar farside via Queqiao relay satellite. Exploring the South Pole-Aitken (SPA) impact structure.",
        "scientific_significance": "Revealed deep mantle material excavated by the giant SPA impact basin and long-wavelength radio astronomy from lunar farside."
    },
    {
        "name": "Chang'e 6",
        "agency": "CNSA",
        "landing_date": "2024-06-01",
        "latitude_deg": -41.638,
        "longitude_deg": -153.985,
        "site_name": "Apollo Crater (SPA Basin)",
        "status": "Success",
        "category": "Sample Return",
        "description": "First successful sample return mission from the lunar farside, returning 1,935.3 grams of farside material to Earth.",
        "scientific_significance": "Provides first-ever direct isotopic age and composition of ancient farside volcanism and crustal dichotomy."
    },
    {
        "name": "Luna 9",
        "agency": "Roscosmos / USSR",
        "landing_date": "1966-02-03",
        "latitude_deg": 7.08,
        "longitude_deg": -64.37,
        "site_name": "Oceanus Procellarum",
        "status": "Historical Success",
        "category": "Lander",
        "description": "First spacecraft to achieve a survivable soft landing on another celestial body. Transmitted the first close-up surface panoramas.",
        "scientific_significance": "Disproved the catastrophic 'dust ocean' theory by proving lunar regolith could support a spacecraft's weight."
    },
    {
        "name": "Artemis III Candidate: Shackleton Connecting Ridge",
        "agency": "NASA",
        "landing_date": "2026-2027 (Planned)",
        "latitude_deg": -89.44,
        "longitude_deg": 222.05,
        "site_name": "Connecting Ridge (Shackleton-de Gerlache)",
        "status": "Candidate Target",
        "category": "Crewed Landing",
        "description": "Premier Artemis candidate region featuring high solar illumination (>80% annual sunlight) and immediate access to deep Shackleton PSR cold traps.",
        "scientific_significance": "Proximity to permanently shadowed water ice volatiles combined with elevated solar power generation ridges."
    },
    {
        "name": "IM-1 Odysseus (CLPS Nova-C)",
        "agency": "Intuitive Machines / NASA",
        "landing_date": "2024-02-22",
        "latitude_deg": -80.13,
        "longitude_deg": 1.44,
        "site_name": "Malapert A",
        "status": "Success",
        "category": "CLPS Commercial Lander",
        "description": "First American lunar landing in over 50 years and first commercial lander to operate on the Moon. Landed ~300 km from lunar South Pole.",
        "scientific_significance": "Pioneered commercial lunar delivery services and demonstrated NASA radio frequency mass gauges (RFMG) and navigation lidar."
    }
]

# ==============================================================================
# CANONICAL LUNAR FEATURES & PERMANENTLY SHADOWED REGIONS (PSRs)
# ==============================================================================
INITIAL_FEATURES = [
    {
        "name": "Shackleton Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -89.9,
        "longitude_deg": 0.0,
        "diameter_km": 21.0,
        "depth_m": 4200.0,
        "permanently_shadowed": True,
        "ice_potential": "CRITICAL",
        "description": "Located exactly at the Lunar South Pole. Peaks on its rim experience nearly perpetual sunlight, while the interior floor has been frozen in darkness for billions of years at <90 Kelvin."
    },
    {
        "name": "Cabeus Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -84.9,
        "longitude_deg": -35.5,
        "diameter_km": 100.0,
        "depth_m": 4000.0,
        "permanently_shadowed": True,
        "ice_potential": "CONFIRMED (LCROSS)",
        "description": "Site of NASA's 2009 LCROSS impact experiment, which excavated and spectroscopically confirmed water vapor, ice grains (5.6 wt%), hydroxyl, and organic hydrocarbons."
    },
    {
        "name": "Malapert Mountain (Peak of Eternal Light)",
        "feature_type": "Mountain Massif",
        "latitude_deg": -86.04,
        "longitude_deg": 2.7,
        "diameter_km": 60.0,
        "depth_m": -5000.0,
        "permanently_shadowed": False,
        "ice_potential": "LOW (Solar Power Node)",
        "description": "Massive topographic high near the South Pole with continuous Direct-to-Earth communication visibility and very high annual solar illumination (>88%). Prime communications relay hub."
    },
    {
        "name": "Aristarchus Plateau",
        "feature_type": "Plateau / Pyroclastic",
        "latitude_deg": 23.7,
        "longitude_deg": -47.4,
        "diameter_km": 170.0,
        "depth_m": -2000.0,
        "permanently_shadowed": False,
        "ice_potential": "NONE (Mineral / Volcanic)",
        "description": "Extremely bright impact crater and elevated plateau covered in rich regional pyroclastic glass deposits, Vallis Schröteri sinuous rille, and high concentrations of thorium and ilmenite."
    },
    {
        "name": "Tycho Crater",
        "feature_type": "Impact Crater",
        "latitude_deg": -43.31,
        "longitude_deg": -11.36,
        "diameter_km": 85.0,
        "depth_m": 4800.0,
        "permanently_shadowed": False,
        "ice_potential": "NONE",
        "description": "Prominent young (~108 Ma) impact crater with central peak and extensive bright ray system stretching over 1,500 km across the lunar nearside."
    }
]


# ==============================================================================
# LOCAL SQLITE ENGINE & SCHEMA SETUP
# ==============================================================================
def get_sqlite_conn():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_sqlite_db():
    """Initializes tables and seeds NASA datasets in local SQLite."""
    conn = get_sqlite_conn()
    cursor = conn.cursor()

    # 1. Lunar Missions Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lunar_missions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            agency TEXT NOT NULL,
            landing_date TEXT,
            latitude_deg REAL NOT NULL,
            longitude_deg REAL NOT NULL,
            site_name TEXT,
            status TEXT NOT NULL,
            category TEXT,
            description TEXT,
            scientific_significance TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # 2. Lunar Features Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lunar_features (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            feature_type TEXT NOT NULL,
            latitude_deg REAL NOT NULL,
            longitude_deg REAL NOT NULL,
            diameter_km REAL,
            depth_m REAL,
            permanently_shadowed INTEGER DEFAULT 0,
            ice_potential TEXT,
            description TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # 3. User Saved Sites Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS saved_sites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            latitude_deg REAL NOT NULL,
            longitude_deg REAL NOT NULL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # 4. Site Assessments History Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS site_assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            site_name TEXT,
            latitude_deg REAL NOT NULL,
            longitude_deg REAL NOT NULL,
            overall_score REAL NOT NULL,
            suitability_rating TEXT NOT NULL,
            illumination_score REAL,
            comm_score REAL,
            slope_score REAL,
            recommendations TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # 5. Custom Mission Profiles Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS custom_mission_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            weights_json TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # 6. Historical Lunar Missions Table (Module 12)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS historical_missions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            agency TEXT NOT NULL,
            country TEXT NOT NULL,
            launch_date TEXT,
            landing_date TEXT,
            latitude_deg REAL NOT NULL,
            longitude_deg REAL NOT NULL,
            site_name TEXT,
            region TEXT NOT NULL,
            era TEXT NOT NULL,
            coordinate_system TEXT NOT NULL,
            coordinate_accuracy TEXT,
            mission_type TEXT NOT NULL,
            landing_outcome TEXT NOT NULL,
            lander_rover_info TEXT,
            scientific_instruments TEXT,
            scientific_observations TEXT,
            available_datasets TEXT,
            original_source TEXT,
            source_reliability TEXT,
            verification_status TEXT NOT NULL,
            notes_and_limitations TEXT,
            samples_returned_kg REAL DEFAULT 0.0,
            distance_traversed_km REAL DEFAULT 0.0,
            ground_truth_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # Seed Historical Missions (Module 12: 28 Canonical Lunar Missions)
    try:
        from engines.historical_engine import HISTORICAL_MISSIONS_DATASET
        for hm in HISTORICAL_MISSIONS_DATASET:
            cursor.execute("""
                INSERT OR REPLACE INTO historical_missions
                (id, name, agency, country, launch_date, landing_date, latitude_deg, longitude_deg,
                 site_name, region, era, coordinate_system, coordinate_accuracy, mission_type,
                 landing_outcome, lander_rover_info, scientific_instruments, scientific_observations,
                 available_datasets, original_source, source_reliability, verification_status,
                 notes_and_limitations, samples_returned_kg, distance_traversed_km, ground_truth_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                hm["id"], hm["name"], hm["agency"], hm["country"], hm.get("launch_date"),
                hm.get("landing_date"), hm["latitude_deg"], hm["longitude_deg"],
                hm.get("site_name"), hm.get("region"), hm.get("era"),
                hm.get("coordinate_system"), hm.get("coordinate_accuracy"),
                hm.get("mission_type"), hm.get("landing_outcome"),
                hm.get("lander_rover_info"), json.dumps(hm.get("scientific_instruments", [])),
                hm.get("scientific_observations"), json.dumps(hm.get("available_datasets", [])),
                hm.get("original_source"), hm.get("source_reliability"),
                hm.get("verification_status"), hm.get("notes_and_limitations"),
                hm.get("samples_returned_kg", 0.0), hm.get("distance_traversed_km", 0.0),
                json.dumps(hm.get("ground_truth_observations", {}))
            ))

            # Also ensure all 28 appear in lunar_missions for backward compatibility
            cursor.execute("""
                INSERT OR IGNORE INTO lunar_missions
                (name, agency, landing_date, latitude_deg, longitude_deg, site_name, status, category, description, scientific_significance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                hm["name"], hm["agency"], hm["landing_date"], hm["latitude_deg"], hm["longitude_deg"],
                hm["site_name"], hm["landing_outcome"], hm["mission_type"],
                hm["scientific_observations"], f"Instruments: {len(hm.get('scientific_instruments', []))} payload systems; Status: {hm['verification_status']}"
            ))
    except Exception as e:
        logger.warning(f"Failed to seed historical missions: {e}")

    # Seed Missions
    for m in INITIAL_MISSIONS:
        cursor.execute("""
            INSERT OR IGNORE INTO lunar_missions
            (name, agency, landing_date, latitude_deg, longitude_deg, site_name, status, category, description, scientific_significance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            m["name"], m["agency"], m["landing_date"], m["latitude_deg"], m["longitude_deg"],
            m["site_name"], m["status"], m["category"], m["description"], m["scientific_significance"]
        ))

    # Seed Features
    for f in INITIAL_FEATURES:
        cursor.execute("""
            INSERT OR IGNORE INTO lunar_features
            (name, feature_type, latitude_deg, longitude_deg, diameter_km, depth_m, permanently_shadowed, ice_potential, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            f["name"], f["feature_type"], f["latitude_deg"], f["longitude_deg"], f["diameter_km"],
            f["depth_m"], 1 if f["permanently_shadowed"] else 0, f["ice_potential"], f["description"]
        ))

    conn.commit()
    conn.close()
    logger.info("Local SQLite database initialized & NASA datasets seeded.")


# Initialize on import
init_sqlite_db()


# ==============================================================================
# DATABASE SERVICE API (SUPABASE + SQLITE HYBRID)
# ==============================================================================

def get_database_status() -> Dict[str, Any]:
    """Returns connectivity, active provider, and record counts."""
    supabase_active = bool(SUPABASE_URL and SUPABASE_KEY)
    supabase_connected = False
    supabase_counts = {}

    if supabase_active:
        res_m = supabase_request("lunar_missions", query_params={"select": "id"})
        if res_m is not None:
            supabase_connected = True
            supabase_counts["lunar_missions"] = len(res_m)
            res_f = supabase_request("lunar_features", query_params={"select": "id"})
            supabase_counts["lunar_features"] = len(res_f) if res_f is not None else 0
            res_p = supabase_request("custom_mission_profiles", query_params={"select": "id"})
            supabase_counts["custom_mission_profiles"] = len(res_p) if res_p is not None else 0
            res_s = supabase_request("saved_sites", query_params={"select": "id"})
            supabase_counts["saved_sites"] = len(res_s) if res_s is not None else 0
            res_a = supabase_request("site_assessments", query_params={"select": "id"})
            supabase_counts["site_assessments"] = len(res_a) if res_a is not None else 0

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    sqlite_counts = {
        "lunar_missions": cursor.execute("SELECT COUNT(*) FROM lunar_missions").fetchone()[0],
        "lunar_features": cursor.execute("SELECT COUNT(*) FROM lunar_features").fetchone()[0],
        "saved_sites": cursor.execute("SELECT COUNT(*) FROM saved_sites").fetchone()[0],
        "site_assessments": cursor.execute("SELECT COUNT(*) FROM site_assessments").fetchone()[0],
        "custom_mission_profiles": cursor.execute("SELECT COUNT(*) FROM custom_mission_profiles").fetchone()[0]
    }
    conn.close()

    return {
        "status": "online",
        "provider": "supabase" if (supabase_active and supabase_connected) else "sqlite_local",
        "supabase_configured": supabase_active,
        "supabase_connected": supabase_connected,
        "supabase_url": SUPABASE_URL if supabase_active else None,
        "database_file": DB_FILE,
        "counts": supabase_counts if supabase_connected else sqlite_counts,
        "supabase_counts": supabase_counts,
        "sqlite_counts": sqlite_counts
    }


def list_missions(agency: Optional[str] = None) -> List[Dict[str, Any]]:
    supabase_missions = []
    if SUPABASE_URL and SUPABASE_KEY:
        query = {"order": "landing_date.asc"}
        if agency:
            query["agency"] = f"eq.{agency}"
        res = supabase_request("lunar_missions", query_params=query)
        if res is not None and isinstance(res, list):
            supabase_missions = res

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    if agency:
        rows = cursor.execute("SELECT * FROM lunar_missions WHERE agency = ? ORDER BY landing_date ASC", (agency,)).fetchall()
    else:
        rows = cursor.execute("SELECT * FROM lunar_missions ORDER BY landing_date ASC").fetchall()
    sqlite_missions = [dict(r) for r in rows]
    conn.close()

    if not supabase_missions:
        return sqlite_missions

    # Merge authoritative SQLite missions with Supabase records (Supabase takes precedence)
    merged = {m["name"]: m for m in sqlite_missions}
    for m in supabase_missions:
        merged[m["name"]] = m
    return list(merged.values())


def list_features(psr_only: bool = False) -> List[Dict[str, Any]]:
    supabase_features = []
    if SUPABASE_URL and SUPABASE_KEY:
        query = {"order": "latitude_deg.asc"}
        if psr_only:
            query["permanently_shadowed"] = "eq.true"
        res = supabase_request("lunar_features", query_params=query)
        if res is not None and isinstance(res, list):
            supabase_features = res

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    if psr_only:
        rows = cursor.execute("SELECT * FROM lunar_features WHERE permanently_shadowed = 1 ORDER BY latitude_deg ASC").fetchall()
    else:
        rows = cursor.execute("SELECT * FROM lunar_features ORDER BY name ASC").fetchall()
    sqlite_features = [dict(r) for r in rows]
    conn.close()

    if not supabase_features:
        return sqlite_features

    merged = {f["name"]: f for f in sqlite_features}
    for f in supabase_features:
        merged[f["name"]] = f
    return list(merged.values())


def list_saved_sites() -> List[Dict[str, Any]]:
    if SUPABASE_URL and SUPABASE_KEY:
        res = supabase_request("saved_sites", query_params={"order": "created_at.desc"})
        if res is not None and isinstance(res, list):
            return res

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    rows = cursor.execute("SELECT * FROM saved_sites ORDER BY created_at DESC").fetchall()
    sites = [dict(r) for r in rows]
    conn.close()
    return sites


def create_saved_site(name: str, latitude: float, longitude: float, notes: str = "") -> Dict[str, Any]:
    # Sync with Supabase if active
    if SUPABASE_URL and SUPABASE_KEY:
        payload = {
            "name": name,
            "latitude_deg": latitude,
            "longitude_deg": longitude,
            "notes": notes
        }
        res = supabase_request("saved_sites", method="POST", data=payload)
        if res and isinstance(res, list) and len(res) > 0:
            site = res[0]
            # Also keep local SQLite updated
            try:
                conn = get_sqlite_conn()
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO saved_sites (name, latitude_deg, longitude_deg, notes) VALUES (?, ?, ?, ?)",
                    (name, latitude, longitude, notes)
                )
                conn.commit()
                conn.close()
            except Exception:
                pass
            return site

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO saved_sites (name, latitude_deg, longitude_deg, notes)
        VALUES (?, ?, ?, ?)
    """, (name, latitude, longitude, notes))
    site_id = cursor.lastrowid
    conn.commit()
    row = cursor.execute("SELECT * FROM saved_sites WHERE id = ?", (site_id,)).fetchone()
    site = dict(row)
    conn.close()
    return site


def delete_saved_site(site_id: int) -> bool:
    if SUPABASE_URL and SUPABASE_KEY:
        supabase_request("saved_sites", method="DELETE", query_params={"id": f"eq.{site_id}"})

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM saved_sites WHERE id = ?", (site_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


def record_assessment(
    latitude: float,
    longitude: float,
    overall_score: float,
    suitability_rating: str,
    illumination_score: float,
    comm_score: float,
    slope_score: float,
    site_name: str = "Evaluated Site",
    recommendations: List[str] = None
) -> int:
    rec_json = recommendations or []
    if SUPABASE_URL and SUPABASE_KEY:
        payload = {
            "site_name": site_name,
            "latitude_deg": latitude,
            "longitude_deg": longitude,
            "overall_score": overall_score,
            "suitability_rating": suitability_rating,
            "illumination_score": illumination_score,
            "comm_score": comm_score,
            "slope_score": slope_score,
            "recommendations": rec_json
        }
        supabase_request("site_assessments", method="POST", data=payload)

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO site_assessments
        (site_name, latitude_deg, longitude_deg, overall_score, suitability_rating, illumination_score, comm_score, slope_score, recommendations)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        site_name, latitude, longitude, overall_score, suitability_rating,
        illumination_score, comm_score, slope_score, json.dumps(rec_json)
    ))
    record_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return record_id


# ==============================================================================
# CUSTOM MISSION PROFILES
# ==============================================================================

def save_custom_profile(name: str, description: str, weights: dict) -> dict:
    if SUPABASE_URL and SUPABASE_KEY:
        payload = {
            "name": name,
            "description": description,
            "weights_json": weights
        }
        res = supabase_request("custom_mission_profiles", method="POST", data=payload)
        if res and isinstance(res, list) and len(res) > 0:
            p = res[0]
            if isinstance(p.get("weights_json"), str):
                p["weights"] = json.loads(p["weights_json"])
            else:
                p["weights"] = p.get("weights_json", weights)
            return p

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO custom_mission_profiles (name, description, weights_json) VALUES (?, ?, ?)",
        (name, description, json.dumps(weights))
    )
    profile_id = cursor.lastrowid
    conn.commit()
    row = cursor.execute("SELECT * FROM custom_mission_profiles WHERE id = ?", (profile_id,)).fetchone()
    result = dict(row)
    conn.close()
    result["weights"] = json.loads(result["weights_json"])
    return result


def list_custom_profiles() -> list:
    if SUPABASE_URL and SUPABASE_KEY:
        res = supabase_request("custom_mission_profiles", query_params={"order": "created_at.desc"})
        if res is not None and isinstance(res, list):
            profiles = []
            seen_names = set()
            for r in res:
                p = dict(r)
                if p.get("name") in seen_names:
                    continue
                seen_names.add(p.get("name"))
                if isinstance(p.get("weights_json"), str):
                    p["weights"] = json.loads(p["weights_json"])
                else:
                    p["weights"] = p.get("weights_json", {})
                profiles.append(p)
            return profiles

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    rows = cursor.execute("SELECT * FROM custom_mission_profiles ORDER BY created_at DESC").fetchall()
    profiles = []
    seen_names = set()
    for r in rows:
        p = dict(r)
        if p.get("name") in seen_names:
            continue
        seen_names.add(p.get("name"))
        p["weights"] = json.loads(p["weights_json"])
        profiles.append(p)
    conn.close()
    return profiles


def get_custom_profile(profile_id: int) -> Optional[dict]:
    if SUPABASE_URL and SUPABASE_KEY:
        res = supabase_request("custom_mission_profiles", query_params={"id": f"eq.{profile_id}"})
        if res and isinstance(res, list) and len(res) > 0:
            p = dict(res[0])
            if isinstance(p.get("weights_json"), str):
                p["weights"] = json.loads(p["weights_json"])
            else:
                p["weights"] = p.get("weights_json", {})
            return p

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    row = cursor.execute("SELECT * FROM custom_mission_profiles WHERE id = ?", (profile_id,)).fetchone()
    conn.close()
    if not row:
        return None
    p = dict(row)
    p["weights"] = json.loads(p["weights_json"])
    return p


def delete_custom_profile(profile_id: int) -> bool:
    sb_deleted = False
    if SUPABASE_URL and SUPABASE_KEY:
        res = supabase_request("custom_mission_profiles", method="DELETE", query_params={"id": f"eq.{profile_id}"})
        if res is not None:
            sb_deleted = True

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM custom_mission_profiles WHERE id = ?", (profile_id,))
    deleted = cursor.rowcount > 0 or sb_deleted
    conn.commit()
    conn.close()
    return deleted


# ==============================================================================
# MODULE 12: HISTORICAL MISSIONS DB API
# ==============================================================================

def list_historical_missions_db() -> List[Dict[str, Any]]:
    """Retrieves all 28 canonical historical missions from SQLite."""
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    rows = cursor.execute("SELECT * FROM historical_missions ORDER BY landing_date ASC").fetchall()
    missions = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("scientific_instruments"), str):
            try:
                d["scientific_instruments"] = json.loads(d["scientific_instruments"])
            except Exception:
                d["scientific_instruments"] = []
        if isinstance(d.get("available_datasets"), str):
            try:
                d["available_datasets"] = json.loads(d["available_datasets"])
            except Exception:
                d["available_datasets"] = []
        if isinstance(d.get("ground_truth_json"), str):
            try:
                d["ground_truth_observations"] = json.loads(d["ground_truth_json"])
            except Exception:
                d["ground_truth_observations"] = {}
        missions.append(d)
    conn.close()
    return missions


def get_historical_mission_db(mission_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a single historical mission by ID from SQLite."""
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    row = cursor.execute("SELECT * FROM historical_missions WHERE id = ?", (mission_id.strip().lower(),)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if isinstance(d.get("scientific_instruments"), str):
        try:
            d["scientific_instruments"] = json.loads(d["scientific_instruments"])
        except Exception:
            d["scientific_instruments"] = []
    if isinstance(d.get("available_datasets"), str):
        try:
            d["available_datasets"] = json.loads(d["available_datasets"])
        except Exception:
            d["available_datasets"] = []
    if isinstance(d.get("ground_truth_json"), str):
        try:
            d["ground_truth_observations"] = json.loads(d["ground_truth_json"])
        except Exception:
            d["ground_truth_observations"] = {}
    return d



