# 🌕 LunaSite: Autonomous Lunar Geospatial Intelligence Platform

> **NASA Space Apps Challenge 2026**  
> *Deterministic multi-criteria landing site selection, ephemeris-based celestial geometry, and terrain hazard evaluation for lunar exploration.*

---

## 🎯 Executive Overview & The 3 Core Lunar Hazards Solved

Landing at the lunar South Pole is one of the most perilous engineering challenges in space exploration. LunaSite directly solves the **3 fatal hazards** that threaten spacecraft survival:

1. **Terrain Slope & Tip-Over Risk (The Odysseus / SLIM Hazard):**
   * *Problem:* Slopes $>10^\circ$ cause landers to tip over upon touchdown, destroying solar arrays and communications gear.
   * *LunaSite Solution:* Ingests NASA LOLA 80-meter laser elevation models to derive spatial gradients ($\partial z/\partial x, \partial z/\partial y$) on the fly. Real-time safety gates trigger an unconditional **FAIL / RED ALERT** for any landing site exceeding stability envelopes.
2. **Cryogenic Crater Shadows & Freezing:**
   * *Problem:* Polar crater temperatures plunge below $-180^\circ\text{C}$ (90 K) in permanent shadows, freezing batteries and killing landers within hours.
   * *LunaSite Solution:* Integrates the NASA JPL DE421 ephemeris with 360-degree azimuthal horizon raycasting to map true sunlit ridges ("Peaks of Eternal Light") and validate regolith thermal models against in-situ data from Chandrayaan-3's ChaSTE probe.
3. **Direct-to-Earth (DTE) Communication Blackouts:**
   * *Problem:* At high polar latitudes, Earth sits near the lunar horizon ($0^\circ\text{--}8^\circ$), where crater rims frequently block direct radio line-of-sight.
   * *LunaSite Solution:* Computes topocentric Earth vectors accounting for lunar physical libration (wobble). Calculates ITU-R P.525 Free Space Path Loss (FSPL) and NASA Deep Space Network (DSN 810-005) link budgets to find simultaneous solar charging and radio downlink windows.

---

## 🚀 Key Platform Capabilities

* **Interactive 3D Planetary Geodesy:** Built on **CesiumJS (WebGL)** with accurate ellipsoidal lunar coordinates ($R = 1,737.4\text{ km}$), spherical orbital camera controls, and dynamic solar illumination.
* **NASA LOLA Topographic Analysis:** Real-time 5-kilometer cross-sectional elevation graphs, slope distribution histograms, and crater hazard density modeling.
* **MCDA Mission Grading Engine:** Evaluates candidate sites against 5 specialized mission profiles:
  * ☀️ **Solar Power & Communications Node**
  * 🚗 **Rover Exploration (Pragyan / VIPER class)**
  * 👨‍🚀 **Human Landing (Artemis / Crewed)**
  * 🔬 **Scientific Research (Volatile Cold-Traps)**
  * ⛏️ **Resource Exploration & ISRU**
* **Hard Safety Gates:** Strict veto mechanism where high science scores cannot override physical tipping or communication failures.
* **Authoritative 28-Mission Historical Catalog:** Fully searchable database of Apollo, Surveyor, Luna, Chang'e, and Chandrayaan-3 landing sites with verified NASA LROC Narrow Angle Camera (NAC) coordinates ($\pm 5\text{ m}$ precision).
* **Deterministic Physics Pipeline:** 100% reproducible bit-for-bit execution across backend services with zero hallucinated parameters.

---

## 🛠️ Technology Stack & Scientific Roles

| Technology | Role & Practical Function |
| :--- | :--- |
| **CesiumJS (WebGL)** | Renders the interactive 3D Moon globe with real-time lighting and spherical camera orbit. |
| **NASA LOLA Altimeter** | Laser altimetry dataset (PDS 80m DEM) used to compute surface slopes and horizon masks. |
| **JPL DE421 / SPICE** | NASA ephemeris kernel providing exact orbital positions of Sun and Earth from lunar observer. |
| **Skyfield (Python)** | Astronomy engine projecting topocentric ENU vectors and modeling lunar physical libration. |
| **FastAPI (Python 3.11)** | High-performance asynchronous REST API serving deterministic assessment and grading endpoints. |
| **Rasterio & NumPy** | Geospatial engines that sample large Moon GeoTIFFs and derive slope gradients on the fly. |
| **ITU-R P.525 & DSN 810-005** | Telecommunications standards calculating Free Space Path Loss (FSPL) and RF link margins. |
| **ChaSTE (Chandrayaan-3)** | In-situ thermal probe used as ground truth to validate our regolith temperature calculations. |
| **SQLite / Supabase** | Hybrid storage for bookmarks, custom weights, and 28 historical missions. |

---

## 🏁 Quickstart Guide

### 1. Backend Setup (FastAPI & Astronomy Engine)

```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install required dependencies
pip install -r requirements.txt

# Start the FastAPI engine
uvicorn main:app --reload --port 8000
```

The API documentation will be accessible at `http://localhost:8000/docs`.

### 2. Frontend Setup (Interactive 3D Workspace)

The frontend runs with standard modern web standards (HTML5, CSS3, JavaScript ES6+, WebGL via CesiumJS).

```bash
# Serve frontend using any static web server (e.g., Python http.server or VS Code Live Server)
cd frontend
python -m http.server 5500
```

Open `http://localhost:5500` in any modern web browser (Chrome, Edge, Brave, Firefox).

---

## 🧪 Scientific Verification Suite (20 / 20 Criteria)

Run our automated 20-point scientific validation script to verify physics integrity, ephemeris calculations, and deterministic reproducibility:

```bash
python backend/verify_all_20.py
```

**Expected Result:** `20 / 20 ITEMS VERIFIED AND FULLY OPERATIONAL` with `0.000000%` determinism variance.

---

## 📄 License & Attribution

* Built for the **NASA International Space Apps Challenge 2026**.
* Datasets and ephemerides courtesy of **NASA PDS, NASA LRO, JPL Solar System Dynamics, and ISRO**.
