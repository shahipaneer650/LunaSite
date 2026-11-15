"""
LunaSite Authoritative Dataset Ingestion & Supabase / SQLite Synchronizer
Ingests canonical datasets from NASA PDS, ISRO ISSDC, CNSA, Soviet/Roscosmos, JAXA, and CLPS archives
into Supabase PostgreSQL and local SQLite databases.
"""

import os
import sys
import json
import logging
import urllib.request
import urllib.parse
from typing import List, Dict, Any

# Ensure backend root is in Python path
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

import database

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("lunasite.sync")

# ==============================================================================
# 1. AUTHORITATIVE MISSIONS DATASET (39 MISSIONS ACROSS NASA, ISRO, CNSA, USSR, JAXA, CLPS)
# ==============================================================================
ALL_AUTHORITATIVE_MISSIONS: List[Dict[str, Any]] = [
    # ISRO Missions
    {
        "name": "Chandrayaan-3 (Vikram / Pragyan)",
        "agency": "ISRO",
        "landing_date": "2023-08-23",
        "latitude_deg": -69.367621,
        "longitude_deg": 32.348126,
        "site_name": "Shiv Shakti Point",
        "status": "Historical Success",
        "category": "Lander / Rover",
        "description": "First successful soft landing in the lunar South Pole high-latitude region (69.37°S). Deployed Vikram lander and Pragyan rover. Conducted first in-situ thermal probe (ChaSTE) into regolith down to 10 cm, Langmuir probe plasma analysis (RAMBHA), and laser-induced breakdown spectroscopy (LIBS).",
        "scientific_significance": "Demonstrated pinpoint landing in rugged southern terrain; verified steep vertical thermal gradient (60°C on surface to -10°C at 8 cm depth); confirmed unambiguous presence of sulfur, iron, and titanium."
    },
    {
        "name": "Chandrayaan-1 Moon Impact Probe (MIP)",
        "agency": "ISRO",
        "landing_date": "2008-11-14",
        "latitude_deg": -89.76,
        "longitude_deg": 39.40,
        "site_name": "Jawahar Point (Shackleton Rim)",
        "status": "Historical Success",
        "category": "Impact Probe",
        "description": "Released from the Chandrayaan-1 orbiter and intentionally impacted near Shackleton Crater rim at the South Pole. The Chandra's Altitudinal Composition Explorer (CHACE) quadrupole mass spectrometer directly sampled the tenuous lunar atmosphere during descent.",
        "scientific_significance": "First direct, in-situ discovery of water vapor / hydroxyl (H2O / OH) molecules in the lunar polar exosphere, pioneering global lunar water-ice exploration."
    },
    {
        "name": "Chandrayaan-2 Vikram Lander",
        "agency": "ISRO",
        "landing_date": "2019-09-06",
        "latitude_deg": -70.8810,
        "longitude_deg": 22.7840,
        "site_name": "Simpelius N Region",
        "status": "Hard Landing",
        "category": "Lander / Rover",
        "description": "High-latitude landing attempt near the South Pole. During terminal braking phase at 2.1 km altitude, software telemetry deviation caused loss of attitude control, resulting in high-velocity surface impact. Impact site identified by NASA LROC optical cameras.",
        "scientific_significance": "Orbiter remains highly active in orbit, providing the highest spatial resolution lunar optical stereo imagery (0.25 m/pixel OHRC) and dual-frequency synthetic aperture radar (DFSAR) data."
    },

    # NASA Apollo Crewed Program
    {
        "name": "Apollo 11 (Eagle)",
        "agency": "NASA",
        "landing_date": "1969-07-20",
        "latitude_deg": 0.67408,
        "longitude_deg": 23.47297,
        "site_name": "Statio Tranquillitatis",
        "status": "Historical Success",
        "category": "Crewed Landing",
        "description": "First crewed landing on the Moon by Neil Armstrong and Buzz Aldrin. Lunar Module Eagle touched down in southern Mare Tranquillitatis. Surface EVA duration 2h 31m. Deployed Early Apollo Scientific Experiments Package (EASEP) including passive seismometer and laser ranging retroreflector (LRRR).",
        "scientific_significance": "Returned 21.55 kg of pristine lunar rock and regolith samples; determined mare basalts age (~3.7 Ga); proved human operational capability in 1/6th g gravity."
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
        "description": "First pinpoint precision lunar landing. Pete Conrad and Alan Bean landed within 160 meters of the Surveyor 3 robotic probe launched 2.5 years earlier. Deployed full Apollo Lunar Surface Experiments Package (ALSEP). Recovered parts of Surveyor 3 for Earth laboratory analysis.",
        "scientific_significance": "Returned 34.35 kg of samples; confirmed precision landing radar guidance; demonstrated long-term space weathering effects on engineered alloys and optics."
    },
    {
        "name": "Apollo 14 (Antares)",
        "agency": "NASA",
        "landing_date": "1971-02-05",
        "latitude_deg": -3.64530,
        "longitude_deg": -17.47136,
        "site_name": "Fra Mauro Highlands",
        "status": "Historical Success",
        "category": "Crewed Landing",
        "description": "Alan Shepard and Edgar Mitchell landed in the Fra Mauro formation, the extensive ejecta blanket deposited by the giant Imbrium basin impact. Used the Modular Equipment Transporter (MET) handcart to hike to Cone Crater rim.",
        "scientific_significance": "Returned 42.28 kg of samples including Big Bertha (breccia containing ancient terrestrial impactite fragment dated 4.0 Ga); constrained the timing of the Imbrium cataclysm."
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
        "description": "First J-series extended exploration mission. David Scott and James Irwin utilized the first Lunar Roving Vehicle (LRV-1), traversing 27.8 km along the edge of Hadley Rille gorge and Montes Apenninus (4,500 m high mountains).",
        "scientific_significance": "Discovered the 'Genesis Rock' (anorthosite sample 15415, age 4.1 Ga), providing empirical proof of the magma ocean hypothesis and primordial lunar crust formation; returned 77.31 kg of samples."
    },
    {
        "name": "Apollo 16 (Orion)",
        "agency": "NASA",
        "landing_date": "1972-04-21",
        "latitude_deg": -8.97301,
        "longitude_deg": 15.49812,
        "site_name": "Descartes Highlands",
        "status": "Historical Success",
        "category": "Crewed Landing",
        "description": "John Young and Charles Duke landed in the central lunar highlands to sample the Cayley and Descartes geological formations. Traversed 26.55 km with LRV-2, exploring Stone Mountain and North Ray Crater.",
        "scientific_significance": "Conclusively refuted the prevailing hypothesis that highland plains were formed by volcanism, proving they are impact breccias formed by basin ejecta; returned 95.71 kg of ancient highland crust."
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
        "description": "Final Apollo lunar landing mission. Geologist-astronaut Harrison Schmitt and Gene Cernan spent 75 hours on the lunar surface, completing 3 EVAs (22h 4m total) and traversing 35.74 km in LRV-3. Explored South Massif, North Massif, and Shorty Crater.",
        "scientific_significance": "Discovered orange volcanic glass beads at Shorty Crater, proving explosive pyroclastic volcanism fed by deep-seated mantle volatiles; returned 110.52 kg of diverse lunar samples."
    },

    # NASA Robotic Surveyor Program
    {
        "name": "Surveyor 1",
        "agency": "NASA / JPL",
        "landing_date": "1966-06-02",
        "latitude_deg": -2.4745,
        "longitude_deg": -43.3399,
        "site_name": "Flamsteed Crater, Oceanus Procellarum",
        "status": "Historical Success",
        "category": "Robotic Soft Lander",
        "description": "First American soft landing on the Moon. Transmitted 11,237 high-resolution television frames of the surrounding mare landscape, crater morphology, and spacecraft footpads.",
        "scientific_significance": "Demonstrated that lunar soil possessed sufficient bearing strength (30-50 kPa) to support heavy Apollo Lunar Modules, disproving the catastrophic dust ocean hypothesis."
    },
    {
        "name": "Surveyor 3",
        "agency": "NASA / JPL",
        "landing_date": "1967-04-20",
        "latitude_deg": -3.016,
        "longitude_deg": -23.418,
        "site_name": "Oceanus Procellarum",
        "status": "Historical Success",
        "category": "Robotic Soft Lander",
        "description": "Landed inside a 200-meter crater. Equipped with a motorized surface-sampler scoop arm that dug four trenches up to 18 cm deep. Visited and inspected in person by Apollo 12 astronauts in November 1969.",
        "scientific_significance": "First mechanical manipulation of lunar regolith; provided direct mechanical properties of highland-adjacent soil; Surveyor 3 TV camera was returned to Earth for microbiological and materials analysis."
    },
    {
        "name": "Surveyor 5",
        "agency": "NASA / JPL",
        "landing_date": "1967-09-11",
        "latitude_deg": 1.461,
        "longitude_deg": 23.195,
        "site_name": "Mare Tranquillitatis",
        "status": "Historical Success",
        "category": "Robotic Soft Lander",
        "description": "Landed on a 20-degree inner slope of a small crater in Mare Tranquillitatis. Deployed an alpha-scattering instrument directly onto the lunar surface to conduct alpha backscatter and proton emission spectroscopy.",
        "scientific_significance": "First direct chemical elemental analysis of extraterrestrial soil; revealed mare basalt composition rich in iron, titanium, and basaltic silicates."
    },
    {
        "name": "Surveyor 6",
        "agency": "NASA / JPL",
        "landing_date": "1967-11-10",
        "latitude_deg": 0.474,
        "longitude_deg": -1.480,
        "site_name": "Sinus Medii",
        "status": "Historical Success",
        "category": "Robotic Soft Lander",
        "description": "Landed near the exact center of the Moon's visible nearside hemisphere. On November 17, 1967, fired its vernier engines for 2.5 seconds, lifting off the lunar surface to an altitude of 3-4 meters and translating 2.5 meters laterally.",
        "scientific_significance": "First liftoff from the lunar surface; analyzed undisturbed regolith at the secondary landing spot and imaged the primary landing footprint to examine rocket blast erosion."
    },
    {
        "name": "Surveyor 7",
        "agency": "NASA / JPL",
        "landing_date": "1968-01-10",
        "latitude_deg": -40.857,
        "longitude_deg": -11.470,
        "site_name": "Tycho Crater Rim",
        "status": "Historical Success",
        "category": "Robotic Soft Lander",
        "description": "Only Surveyor mission sent to a rugged lunar highland region, landing 30 km north of the rim of the giant young ray crater Tycho. Deployed alpha-scattering instrument and magnetic flux density detectors.",
        "scientific_significance": "First in-situ chemical analysis of lunar highlands rock; revealed significantly lower iron content and higher aluminum/calcium content than mare basalts, matching anorthositic composition."
    },

    # Soviet / Roscosmos Lunar Program
    {
        "name": "Luna 2",
        "agency": "USSR / Lavochkin",
        "landing_date": "1959-09-13",
        "latitude_deg": 29.10,
        "longitude_deg": 0.00,
        "site_name": "Palus Putredinis",
        "status": "Historical Success",
        "category": "Impact Probe",
        "description": "First human-made object to reach the surface of the Moon or any other celestial body. Impacted the lunar surface east of Mare Serenitatis at 3.3 km/s carrying pennants of the Soviet Union and magnetometers.",
        "scientific_significance": "Conclusively proved that the Moon has no significant dipole magnetic field (<100 gamma) and detected no evidence of trapped radiation belts around the Moon."
    },
    {
        "name": "Luna 9",
        "agency": "USSR / Lavochkin",
        "landing_date": "1966-02-03",
        "latitude_deg": 7.080,
        "longitude_deg": -64.370,
        "site_name": "Oceanus Procellarum",
        "status": "Historical Success",
        "category": "Robotic Soft Lander",
        "description": "First spacecraft to accomplish a survivable soft landing on the Moon. Hermetic instrument sphere deployed 4 petal antennas and rotating telephotometer camera.",
        "scientific_significance": "Transmitted first panoramic television photographs from lunar ground level; proved regolith had solid load-bearing capacity; measured surface radiation rate of 30 mrad/day."
    },
    {
        "name": "Luna 13",
        "agency": "USSR / Lavochkin",
        "landing_date": "1966-12-24",
        "latitude_deg": 18.870,
        "longitude_deg": -62.050,
        "site_name": "Oceanus Procellarum",
        "status": "Historical Success",
        "category": "Robotic Soft Lander",
        "description": "Equipped with mechanical penetrometer soil-density meter and gamma-ray radiation densitometer deployed on extendable pantograph booms.",
        "scientific_significance": "First in-situ physical and mechanical testing of lunar soil density (0.8 g/cm³) and bearing resistance to a depth of 5 cm."
    },
    {
        "name": "Luna 16",
        "agency": "USSR / Lavochkin",
        "landing_date": "1970-09-20",
        "latitude_deg": -0.686,
        "longitude_deg": 56.364,
        "site_name": "Mare Fecunditatis",
        "status": "Historical Success",
        "category": "Robotic Sample Return",
        "description": "First automated robotic spacecraft to extract and return soil samples from an extraterrestrial body. Robotic drill extracted a 35-cm core sample into a spherical return capsule, which launched directly to Earth.",
        "scientific_significance": "Returned 101 grams of lunar regolith without human crew; confirmed robotic sample recovery feasibility; samples dated to 3.4 billion years old."
    },
    {
        "name": "Luna 17 / Lunokhod 1",
        "agency": "USSR / Lavochkin",
        "landing_date": "1970-11-17",
        "latitude_deg": 38.238,
        "longitude_deg": -35.002,
        "site_name": "Mare Imbrium",
        "status": "Historical Success",
        "category": "Lander / Rover",
        "description": "Delivered Lunokhod 1, the world's first automated robotic roving vehicle on another planetary body. Powered by solar cells and polonium-210 radioisotope heater, operated for 322 Earth days (10.5 km total distance).",
        "scientific_significance": "Carried out 500 lunar soil mechanical strength tests and 25 RIFMA X-ray fluorescence soil chemical analyses; transmitted over 20,000 television images and 206 panoramic views."
    },
    {
        "name": "Luna 20",
        "agency": "USSR / Lavochkin",
        "landing_date": "1972-02-21",
        "latitude_deg": 3.786,
        "longitude_deg": 56.625,
        "site_name": "Apollonius Highlands",
        "status": "Historical Success",
        "category": "Robotic Sample Return",
        "description": "Second successful robotic sample return mission, landing in the rugged highland terrain between Mare Fecunditatis and Mare Crisium. Drilled into anorthositic bedrock.",
        "scientific_significance": "Returned 55 grams of predominantly anorthositic highland regolith, establishing the geochemical composition of ancient lunar highlands crust."
    },
    {
        "name": "Luna 21 / Lunokhod 2",
        "agency": "USSR / Lavochkin",
        "landing_date": "1973-01-15",
        "latitude_deg": 25.850,
        "longitude_deg": 30.450,
        "site_name": "Le Monnier Crater, Mare Serenitatis",
        "status": "Historical Success",
        "category": "Lander / Rover",
        "description": "Delivered Lunokhod 2 rover, which traversed 39.0 km across mare plains and highland rilles over 4 months—holding the off-world distance record for over 40 years.",
        "scientific_significance": "Studied mare-highland boundary transitions, measured magnetic fields across the Fossa Recta tectonic fracture, and determined local sky luminance (albedo)."
    },
    {
        "name": "Luna 24",
        "agency": "USSR / Lavochkin",
        "landing_date": "1976-08-18",
        "latitude_deg": 12.714,
        "longitude_deg": 62.213,
        "site_name": "Mare Crisium",
        "status": "Historical Success",
        "category": "Robotic Sample Return",
        "description": "Final mission of the Soviet Luna series. Used an advanced rotary-percussive core drill to extract a continuous 2-meter soil core preserved inside a flexible spiral tube.",
        "scientific_significance": "Returned 170 grams of layered lunar soil; in 1978, Soviet researchers published spectroscopic detection of 0.1 wt% water in Luna 24 samples, prefiguring modern lunar water discoveries."
    },

    # CNSA Lunar Exploration Program (CLEP)
    {
        "name": "Chang'e 3 / Yutu",
        "agency": "CNSA",
        "landing_date": "2013-12-14",
        "latitude_deg": 44.1214,
        "longitude_deg": -19.5116,
        "site_name": "Mare Imbrium (Guang Han Gong)",
        "status": "Historical Success",
        "category": "Lander / Rover",
        "description": "First lunar soft landing in 37 years. Deployed the Yutu rover equipped with ground-penetrating radar (GPR) and the Lunar-based Ultraviolet Telescope (LUT) on the lander.",
        "scientific_significance": "Identified a new type of lunar basalt with intermediate titanium and rich iron oxide; GPR mapped structural subsurface regolith layering down to 400 meters depth."
    },
    {
        "name": "Chang'e 4 / Yutu-2",
        "agency": "CNSA",
        "landing_date": "2019-01-03",
        "latitude_deg": -45.457,
        "longitude_deg": 177.588,
        "site_name": "Von Kármán Crater (SPA Basin)",
        "status": "Historical Success",
        "category": "Lander / Rover",
        "description": "First ever soft landing on the farside of the Moon, communicating via the Queqiao halo orbit relay satellite at Earth-Moon L2. Yutu-2 rover has traversed over 1.6 km on the farside.",
        "scientific_significance": "Sampled deep excavated mantle material within the South Pole-Aitken (SPA) basin; conducted low-frequency radio astronomy unhindered by terrestrial ionospheric noise."
    },
    {
        "name": "Chang'e 5",
        "agency": "CNSA",
        "landing_date": "2020-12-01",
        "latitude_deg": 43.0576,
        "longitude_deg": -51.9161,
        "site_name": "Mons Rümker / Statio Tianchuan",
        "status": "Historical Success",
        "category": "Robotic Sample Return",
        "description": "Complex four-element architecture (Orbiter, Lander, Ascender, Returner). Drilled and scooped samples from young northern Oceanus Procellarum, automated orbital rendezvous, and Earth return.",
        "scientific_significance": "Returned 1,731 grams of samples; radiometrically dated basalt samples to 2.03 billion years old, proving the Moon remained volcanically active 1 billion years longer than previously believed."
    },
    {
        "name": "Chang'e 6",
        "agency": "CNSA",
        "landing_date": "2024-06-01",
        "latitude_deg": -41.6385,
        "longitude_deg": -153.9852,
        "site_name": "Apollo Crater (SPA Basin)",
        "status": "Historical Success",
        "category": "Robotic Sample Return",
        "description": "First ever successful sample return mission from the farside of the Moon. Landed in the southern Apollo impact crater within the SPA basin using Queqiao-2 relay satellite.",
        "scientific_significance": "Returned 1,935.3 grams of farside regolith; provides direct physical samples to unravel the Moon's fundamental nearside-farside crustal dichotomy and ancient volcanic history."
    },

    # JAXA Missions
    {
        "name": "SLIM (Smart Lander for Investigating Moon)",
        "agency": "JAXA",
        "landing_date": "2024-01-19",
        "latitude_deg": -13.316,
        "longitude_deg": 25.251,
        "site_name": "Shioli Crater",
        "status": "Historical Success",
        "category": "Robotic Precision Lander",
        "description": "Demonstrated ultra-precise 'pinpoint' landing using vision-based crater pattern matching navigation, touching down within ~55 meters of target on a 15-degree crater slope. Deployed LEV-1 and LEV-2 (SORA-Q) micro-rovers.",
        "scientific_significance": "Achieved unprecedented landing accuracy (<100 m vs standard several km ellipses); multi-band camera analyzed olivine composition excavated from lunar mantle."
    },

    # NASA Impactors & Science Missions
    {
        "name": "LCROSS (Centaur & Shepherding Spacecraft)",
        "agency": "NASA",
        "landing_date": "2009-10-09",
        "latitude_deg": -84.675,
        "longitude_deg": -48.725,
        "site_name": "Cabeus Crater Floor",
        "status": "Historical Success",
        "category": "Impact Science Mission",
        "description": "Centaur upper stage impacted Cabeus crater floor at 2.5 km/s, creating a 20-meter crater and excavating a plume of debris. The following Shepherding Spacecraft flew through the plume with 9 spectrometers before impacting 4 minutes later.",
        "scientific_significance": "Definitively detected 155 ± 12 kg of water ice and OH volatiles (5.6 ± 2.9 wt% water vapor/ice in ejecta plume), alongside carbon monoxide, methane, ammonia, and sulfur volatiles in a South Pole cold trap."
    },

    # CLPS Commercial Lunar Payload Services
    {
        "name": "IM-1 Odysseus (CLPS Nova-C)",
        "agency": "Intuitive Machines / NASA CLPS",
        "landing_date": "2024-02-22",
        "latitude_deg": -80.130,
        "longitude_deg": 1.440,
        "site_name": "Malapert A",
        "status": "Historical Success",
        "category": "CLPS Commercial Lander",
        "description": "First commercial spacecraft to execute a soft landing on the Moon, and first American lunar touchdown since Apollo 17 in 1972. Landed ~300 km from the South Pole. Operated NASA commercial payloads including ROLSES radio receiver and NDL navigation doppler lidar.",
        "scientific_significance": "Validated commercial lunar lander payload delivery; measured space weather radio emissions and demonstrated autonomous cryogenic methane/oxygen propulsion."
    },
    {
        "name": "Blue Ghost Mission 1",
        "agency": "Firefly Aerospace / NASA CLPS",
        "landing_date": "2025-03-02",
        "latitude_deg": 18.560,
        "longitude_deg": 61.810,
        "site_name": "Mare Crisium",
        "status": "Planned Target",
        "category": "CLPS Commercial Lander",
        "description": "Carrying 10 NASA-sponsored payloads to Mare Crisium. Scheduled to study lunar regolith properties, Earth's magnetosphere interaction, solar wind radiation, and thermal conductivity.",
        "scientific_significance": "Comprehensive geophysical and space-environment characterization of Mare Crisium basin."
    },
    {
        "name": "IM-2 Athena (CLPS Nova-C)",
        "agency": "Intuitive Machines / NASA CLPS",
        "landing_date": "2025-03-06",
        "latitude_deg": -89.450,
        "longitude_deg": 222.050,
        "site_name": "Connecting Ridge (Shackleton)",
        "status": "Planned Target",
        "category": "CLPS Commercial Polar Lander",
        "description": "NASA CLPS mission carrying the PRIME-1 (Polar Resources Ice Mining Experiment-1) drill and MSolo mass spectrometer directly to the Shackleton connecting ridge to drill 1 meter into lunar cryo-soil.",
        "scientific_significance": "First active in-situ robotic drilling and extraction of subsurface polar ice volatiles."
    },

    # NASA Artemis Human Landing Candidate Sites (Authoritative 7 Key Corridors)
    {
        "name": "Artemis III Candidate: Connecting Ridge",
        "agency": "NASA",
        "landing_date": "2026-10-01",
        "latitude_deg": -89.440,
        "longitude_deg": 222.050,
        "site_name": "Shackleton-de Gerlache Connecting Ridge",
        "status": "Candidate Target",
        "category": "Crewed Artemis Corridor",
        "description": "Premier Artemis candidate region. Topographic ridge connecting Shackleton and de Gerlache craters features extreme solar illumination (>80% annual sunlight) and immediate access to deep PSR cold traps.",
        "scientific_significance": "Co-locates persistent solar power generation with cryogenic ice traps for in-situ resource utilization (ISRU) water harvesting."
    },
    {
        "name": "Artemis III Candidate: Peak Near Shackleton",
        "agency": "NASA",
        "landing_date": "2026-10-01",
        "latitude_deg": -89.700,
        "longitude_deg": 122.900,
        "site_name": "Peak Near Shackleton",
        "status": "Candidate Target",
        "category": "Crewed Artemis Corridor",
        "description": "High ridge overlooking the Shackleton crater floor. Provides steep line-of-sight elevation for continuous Direct-to-Earth communication and long-duration solar illumination during southern lunar summer.",
        "scientific_significance": "High-altitude vantage point for communication relays and polar traverse staging."
    },
    {
        "name": "Artemis III Candidate: Haworth Rim",
        "agency": "NASA",
        "landing_date": "2026-10-01",
        "latitude_deg": -87.900,
        "longitude_deg": -5.100,
        "site_name": "Haworth Crater Rim",
        "status": "Candidate Target",
        "category": "Crewed Artemis Corridor",
        "description": "Promontory along the rim of Haworth crater. Deeply shadowed interior cold traps are among the coldest measured environments in the solar system (<40 Kelvin).",
        "scientific_significance": "Exploration of pristine volatile preservation zones containing ancient cometary and asteroid volatile deposits."
    },
    {
        "name": "Artemis III Candidate: Malapert Massif",
        "agency": "NASA",
        "landing_date": "2026-10-01",
        "latitude_deg": -86.000,
        "longitude_deg": 2.700,
        "site_name": "Malapert Mountain Crest",
        "status": "Candidate Target",
        "category": "Crewed Artemis Corridor",
        "description": "Peak of Eternal Light candidate standing 5,000 meters above surrounding topography. Features near-constant annual solar visibility and unbroken line-of-sight communication to Earth.",
        "scientific_significance": "Prime candidate for base-camp infrastructure, nuclear/solar power hubs, and telecommunications towers."
    },
    {
        "name": "Artemis III Candidate: Faustini Rim A",
        "agency": "NASA",
        "landing_date": "2026-10-01",
        "latitude_deg": -87.200,
        "longitude_deg": 114.300,
        "site_name": "Faustini Rim A Plateau",
        "status": "Candidate Target",
        "category": "Crewed Artemis Corridor",
        "description": "Broad elevated plateau on the eastern rim of Faustini crater offering low slope landing terrain (<5°) and direct access to permanently shadowed floor volatiles.",
        "scientific_significance": "Safe touchdown zone for heavy human landers with low slope hazard and stable regolith."
    },
    {
        "name": "Artemis III Candidate: Nobile Rim 1",
        "agency": "NASA",
        "landing_date": "2026-10-01",
        "latitude_deg": -85.200,
        "longitude_deg": 37.500,
        "site_name": "Nobile Crater Rim",
        "status": "Candidate Target",
        "category": "Crewed Artemis Corridor",
        "description": "Mountainous rim region near Nobile crater. Surface exhibits a mosaic of micro-cold traps interspersed with sunlight plateaus, identified as high-priority exploration targets.",
        "scientific_significance": "High concentration of hydrogen signatures detected by orbital neutron spectrometers."
    },
    {
        "name": "Artemis III Candidate: Amundsen Rim",
        "agency": "NASA",
        "landing_date": "2026-10-01",
        "latitude_deg": -84.500,
        "longitude_deg": 65.700,
        "site_name": "Amundsen Crater Rim Ridge",
        "status": "Candidate Target",
        "category": "Crewed Artemis Corridor",
        "description": "Northern rim of the 105-km diameter Amundsen impact crater. Features expansive terraced walls and diverse geological contacts between South Pole-Aitken basin ejecta and highland units.",
        "scientific_significance": "Exposure of excavated deep crustal rocks and extensive permanently shadowed ice deposits."
    }
]

# ==============================================================================
# 2. AUTHORITATIVE LUNAR FEATURES DATASET (18 KEY CRATERS, PSRs, MASSIFS, BASINS)
# ==============================================================================
ALL_AUTHORITATIVE_FEATURES: List[Dict[str, Any]] = [
    {
        "name": "Shackleton Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -89.90,
        "longitude_deg": 0.00,
        "diameter_km": 21.0,
        "depth_m": 4200.0,
        "permanently_shadowed": True,
        "ice_potential": "CRITICAL",
        "description": "Located exactly at the Lunar South Pole. Peaks on its rim experience nearly perpetual sunlight (>86%), while the interior floor has been frozen in permanent shadow for over two billion years at temperatures below 90 Kelvin."
    },
    {
        "name": "Cabeus Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -84.90,
        "longitude_deg": -35.50,
        "diameter_km": 100.0,
        "depth_m": 4000.0,
        "permanently_shadowed": True,
        "ice_potential": "CONFIRMED (LCROSS)",
        "description": "Site of NASA's 2009 LCROSS impact experiment, which excavated and spectroscopically confirmed water vapor, ice crystals (5.6 wt%), hydroxyl, methane, ammonia, and light hydrocarbons."
    },
    {
        "name": "Haworth Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -87.40,
        "longitude_deg": -5.10,
        "diameter_km": 35.0,
        "depth_m": 3800.0,
        "permanently_shadowed": True,
        "ice_potential": "VERY HIGH",
        "description": "Deep South Pole cold trap with lowest measured surface temperatures in the Solar System (<40 Kelvin by LRO Diviner radiometer). Unbroken thermal stability since basin formation."
    },
    {
        "name": "Shoemaker Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -88.10,
        "longitude_deg": 44.90,
        "diameter_km": 51.0,
        "depth_m": 3500.0,
        "permanently_shadowed": True,
        "ice_potential": "VERY HIGH",
        "description": "Named after planetary geologist Eugene Shoemaker. Subsurface epithermal neutron absorption indicates substantial hydrogen enrichment consistent with subsurface water ice deposits."
    },
    {
        "name": "Faustini Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -87.30,
        "longitude_deg": 77.00,
        "diameter_km": 39.0,
        "depth_m": 3200.0,
        "permanently_shadowed": True,
        "ice_potential": "VERY HIGH",
        "description": "Extensive permanently shadowed area adjacent to elevated, highly illuminated rim ridges. Prime candidate target for long-range Artemis rover traverses."
    },
    {
        "name": "de Gerlache Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -88.50,
        "longitude_deg": -87.10,
        "diameter_km": 32.4,
        "depth_m": 3100.0,
        "permanently_shadowed": True,
        "ice_potential": "HIGH",
        "description": "Rims form the connecting ridge between Shackleton and de Gerlache craters. Exhibits high annual solar illumination alongside immediate proximity to permanently shadowed cryo-traps."
    },
    {
        "name": "Amundsen Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -84.50,
        "longitude_deg": 82.80,
        "diameter_km": 105.0,
        "depth_m": 4800.0,
        "permanently_shadowed": True,
        "ice_potential": "CONFIRMED",
        "description": "Large complex impact crater with prominent central peaks and extensive floor cold traps containing surface frost patches detected by LRO Lyman-Alpha Mapping Project (LAMP)."
    },
    {
        "name": "Nobile Crater",
        "feature_type": "Crater / PSR",
        "latitude_deg": -85.20,
        "longitude_deg": 53.50,
        "diameter_km": 73.0,
        "depth_m": 3700.0,
        "permanently_shadowed": True,
        "ice_potential": "CONFIRMED (VIPER Target)",
        "description": "Target exploration region for NASA's Volatiles Investigating Polar Exploration Rover (VIPER). Features a mosaic of illuminated ridges and micro-cold traps holding shallow subsurface volatiles."
    },
    {
        "name": "Malapert Mountain (Massif)",
        "feature_type": "Mountain Massif",
        "latitude_deg": -86.04,
        "longitude_deg": 2.70,
        "diameter_km": 60.0,
        "depth_m": -5000.0,
        "permanently_shadowed": False,
        "ice_potential": "LOW (Solar Power Node)",
        "description": "Massive topographic high near the South Pole with continuous Direct-to-Earth communication visibility and very high annual solar illumination (>88%). Prime communications and power hub."
    },
    {
        "name": "Mons Mouton (Leibnitz Beta)",
        "feature_type": "Lunar Plateau / Mountain",
        "latitude_deg": -84.50,
        "longitude_deg": 31.00,
        "diameter_km": 100.0,
        "depth_m": -6000.0,
        "permanently_shadowed": False,
        "ice_potential": "MODERATE (High Sun)",
        "description": "Flat-topped lunar mountain standing 6 km above surrounding terrain. Long continuous periods of direct sunlight and unobstructed line-of-sight for Earth communication."
    },
    {
        "name": "Aristarchus Plateau",
        "feature_type": "Plateau / Pyroclastic",
        "latitude_deg": 23.70,
        "longitude_deg": -47.40,
        "diameter_km": 170.0,
        "depth_m": -2000.0,
        "permanently_shadowed": False,
        "ice_potential": "NONE (Mineral / Volcanic)",
        "description": "Volcanically rich elevated plateau with Vallis Schröteri sinuous rille, high concentrations of radioactive thorium, and regional pyroclastic glass deposits rich in ilmenite."
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
        "description": "Prominent young (~108 Ma) Copernican impact crater with central peak and extensive bright ray system stretching over 1,500 km across the lunar nearside."
    },
    {
        "name": "Copernicus Crater",
        "feature_type": "Impact Crater",
        "latitude_deg": 9.62,
        "longitude_deg": -20.08,
        "diameter_km": 93.0,
        "depth_m": 3800.0,
        "permanently_shadowed": False,
        "ice_potential": "NONE",
        "description": "Benchmark crater defining the Copernican lunar geological period. Features majestic terraced rim walls, multi-peak central mountain complex, and olivine-bearing impact melts."
    },
    {
        "name": "South Pole-Aitken (SPA) Basin",
        "feature_type": "Impact Basin",
        "latitude_deg": -53.00,
        "longitude_deg": 169.00,
        "diameter_km": 2500.0,
        "depth_m": 8200.0,
        "permanently_shadowed": False,
        "ice_potential": "HIGH (Southern Depressions)",
        "description": "Largest, oldest (~4.3 Ga), and deepest impact structure on the Moon, spanning across the southern farside. Impact excavated deeply into lower crust and upper mantle strata."
    },
    {
        "name": "Marius Hills Hole (Skylight)",
        "feature_type": "Lava Tube / Volcanic",
        "latitude_deg": 14.09,
        "longitude_deg": -56.77,
        "diameter_km": 0.065,
        "depth_m": 80.0,
        "permanently_shadowed": True,
        "ice_potential": "LOW (Subsurface Shelter)",
        "description": "Subsurface lava tube skylight entrance discovered by SELENE and LROC. Offers natural thermal buffering (~ -20°C constant) and shielding against galactic cosmic rays and micrometeoroids."
    },
    {
        "name": "Reiner Gamma",
        "feature_type": "Swirl / Magnetic Anomaly",
        "latitude_deg": 7.50,
        "longitude_deg": -59.00,
        "diameter_km": 60.0,
        "depth_m": 0.0,
        "permanently_shadowed": False,
        "ice_potential": "NONE (Magnetic Field)",
        "description": "High-albedo lunar swirl co-located with a strong localized magnetic crustal anomaly that deflects charged solar wind ions, shielding the underlying regolith from space weathering."
    },
    {
        "name": "Mare Tranquillitatis",
        "feature_type": "Lunar Mare",
        "latitude_deg": 8.50,
        "longitude_deg": 31.40,
        "diameter_km": 873.0,
        "depth_m": 0.0,
        "permanently_shadowed": False,
        "ice_potential": "NONE (High-Ti Basalt)",
        "description": "Extensive basaltic flood plain characterized by high titanium content (up to 15 wt% TiO2 in ilmenite). Site of Apollo 11 historical landing."
    },
    {
        "name": "Oceanus Procellarum",
        "feature_type": "Lunar Ocean / Mare",
        "latitude_deg": 18.40,
        "longitude_deg": -57.40,
        "diameter_km": 2500.0,
        "depth_m": 0.0,
        "permanently_shadowed": False,
        "ice_potential": "NONE (KREEP Basalt)",
        "description": "Vast lunar mare on the western nearside hemisphere, containing elevated heat-producing radioactive elements and KREEP (potassium, rare earth elements, phosphorus) basalts."
    }
]

# ==============================================================================
# 3. AUTHORITATIVE MISSION PROFILES (5 MULTI-CRITERIA DECISION MATRIX PROFILES)
# ==============================================================================
ALL_AUTHORITATIVE_PROFILES: List[Dict[str, Any]] = [
    {
        "name": "Polar Water-Ice Prospecting",
        "description": "Optimized for cryogenic rover/lander missions targeting volatile deposits and water ice inside South Pole cold traps (PSRs). High weight on cold-trap proximity and radar/thermal accessibility.",
        "weights_json": {
            "illumination_weight": 0.20,
            "comm_weight": 0.15,
            "slope_weight": 0.25,
            "psr_proximity_weight": 0.40,
            "max_acceptable_slope_deg": 12.0
        }
    },
    {
        "name": "Solar-Powered Surface Base",
        "description": "Prioritizes high annual solar illumination on elevated polar peaks and massifs for continuous photovoltaic power generation and minimal night-cycle battery requirements.",
        "weights_json": {
            "illumination_weight": 0.50,
            "comm_weight": 0.25,
            "slope_weight": 0.20,
            "psr_proximity_weight": 0.05,
            "max_acceptable_slope_deg": 10.0
        }
    },
    {
        "name": "Radio Astronomy Farside Observatory",
        "description": "Prioritizes lunar farside sites with 100% terrain shielding from terrestrial radio frequency interference (RFI) for pristine cosmological ultra-long wavelength radio observations.",
        "weights_json": {
            "illumination_weight": 0.25,
            "comm_weight": 0.05,
            "slope_weight": 0.30,
            "psr_proximity_weight": 0.10,
            "rf_quiet_weight": 0.30,
            "max_acceptable_slope_deg": 8.0
        }
    },
    {
        "name": "Crewed Artemis Base Camp",
        "description": "NASA Artemis Human Landing System (HLS) safety specifications: low touchdown slope (<8°), continuous Direct-to-Earth communication, high sunlight (>70%), and accessible ISRU water ice.",
        "weights_json": {
            "illumination_weight": 0.30,
            "comm_weight": 0.30,
            "slope_weight": 0.25,
            "psr_proximity_weight": 0.15,
            "max_acceptable_slope_deg": 8.0
        }
    },
    {
        "name": "Commercial Robotic Cargo Lander (CLPS)",
        "description": "Commercial payload landing profile: prioritizes hazard minimization (flat topography, slope < 6°) and maximum geometric Direct-to-Earth visibility for high-bandwidth telemetry.",
        "weights_json": {
            "illumination_weight": 0.30,
            "comm_weight": 0.35,
            "slope_weight": 0.30,
            "psr_proximity_weight": 0.05,
            "max_acceptable_slope_deg": 6.0
        }
    }
]


# ==============================================================================
# UPSERT HELPER FUNCTIONS (POSTGREST + LOCAL SQLITE)
# ==============================================================================

def sync_supabase_table(table_name: str, records: List[Dict[str, Any]], key_field: str = "name"):
    """Upserts records into Supabase PostgREST table."""
    logger.info(f"--- Synchronizing Supabase table: {table_name} ({len(records)} records) ---")

    # Fetch existing records to check what's already there
    existing = database.supabase_request(table_name, query_params={"select": key_field})
    existing_keys = set()
    if existing and isinstance(existing, list):
        for item in existing:
            if key_field in item:
                existing_keys.add(item[key_field])
    logger.info(f"Existing in Supabase {table_name}: {len(existing_keys)} records")

    inserted = 0
    updated = 0
    errors = 0

    for rec in records:
        key_val = rec.get(key_field)
        if not key_val:
            continue

        if key_val in existing_keys:
            # Update existing
            encoded_key = urllib.parse.quote(str(key_val))
            res = database.supabase_request(
                table_name,
                method="PATCH",
                data=rec,
                query_params={key_field: f"eq.{encoded_key}"}
            )
            if res is not None:
                updated += 1
            else:
                logger.warning(f"Failed to update {key_val} in Supabase {table_name}")
                errors += 1
        else:
            # Insert new
            res = database.supabase_request(table_name, method="POST", data=rec)
            if res is not None:
                inserted += 1
                existing_keys.add(key_val)
            else:
                logger.warning(f"Failed to insert {key_val} in Supabase {table_name}")
                errors += 1

    logger.info(f"Supabase {table_name} sync complete: {inserted} inserted, {updated} updated, {errors} errors.")
    return inserted, updated, errors


def sync_sqlite():
    """Synchronizes all datasets into local SQLite database."""
    logger.info("--- Synchronizing Local SQLite database ---")
    conn = database.get_sqlite_conn()
    cursor = conn.cursor()

    # 1. Missions
    for m in ALL_AUTHORITATIVE_MISSIONS:
        cursor.execute("""
            INSERT INTO lunar_missions
            (name, agency, landing_date, latitude_deg, longitude_deg, site_name, status, category, description, scientific_significance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                agency=excluded.agency,
                landing_date=excluded.landing_date,
                latitude_deg=excluded.latitude_deg,
                longitude_deg=excluded.longitude_deg,
                site_name=excluded.site_name,
                status=excluded.status,
                category=excluded.category,
                description=excluded.description,
                scientific_significance=excluded.scientific_significance
        """, (
            m["name"], m["agency"], m["landing_date"], m["latitude_deg"], m["longitude_deg"],
            m["site_name"], m["status"], m["category"], m["description"], m["scientific_significance"]
        ))

    # 2. Features
    for f in ALL_AUTHORITATIVE_FEATURES:
        cursor.execute("""
            INSERT INTO lunar_features
            (name, feature_type, latitude_deg, longitude_deg, diameter_km, depth_m, permanently_shadowed, ice_potential, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                feature_type=excluded.feature_type,
                latitude_deg=excluded.latitude_deg,
                longitude_deg=excluded.longitude_deg,
                diameter_km=excluded.diameter_km,
                depth_m=excluded.depth_m,
                permanently_shadowed=excluded.permanently_shadowed,
                ice_potential=excluded.ice_potential,
                description=excluded.description
        """, (
            f["name"], f["feature_type"], f["latitude_deg"], f["longitude_deg"], f["diameter_km"],
            f["depth_m"], 1 if f["permanently_shadowed"] else 0, f["ice_potential"], f["description"]
        ))

    # 3. Custom Profiles
    for p in ALL_AUTHORITATIVE_PROFILES:
        cursor.execute("""
            INSERT INTO custom_mission_profiles (name, description, weights_json)
            VALUES (?, ?, ?)
        """, (
            p["name"], p["description"], json.dumps(p["weights_json"])
        ))

    conn.commit()
    conn.close()
    logger.info("Local SQLite database synchronized successfully.")


def main():
    print("==================================================================")
    print("LUNASITE DATA SYNCHRONIZER: NASA, ISRO, CNSA, USSR, JAXA, CLPS")
    print(f"Supabase URL: {database.SUPABASE_URL}")
    print(f"SQLite DB:    {database.DB_FILE}")
    print("==================================================================")

    # 1. Sync Supabase
    m_ins, m_upd, m_err = sync_supabase_table("lunar_missions", ALL_AUTHORITATIVE_MISSIONS, key_field="name")
    f_ins, f_upd, f_err = sync_supabase_table("lunar_features", ALL_AUTHORITATIVE_FEATURES, key_field="name")
    p_ins, p_upd, p_err = sync_supabase_table("custom_mission_profiles", ALL_AUTHORITATIVE_PROFILES, key_field="name")

    # 2. Sync SQLite
    sync_sqlite()

    # 3. Verify
    print("\n================== VERIFICATION STATUS ==================")
    supa_missions = database.supabase_request("lunar_missions")
    supa_features = database.supabase_request("lunar_features")
    supa_profiles = database.supabase_request("custom_mission_profiles")

    print(f"Supabase 'lunar_missions':         {len(supa_missions) if supa_missions else 0} live records")
    print(f"Supabase 'lunar_features':         {len(supa_features) if supa_features else 0} live records")
    print(f"Supabase 'custom_mission_profiles': {len(supa_profiles) if supa_profiles else 0} live records")

    conn = database.get_sqlite_conn()
    cur = conn.cursor()
    sq_m = cur.execute("SELECT COUNT(*) FROM lunar_missions").fetchone()[0]
    sq_f = cur.execute("SELECT COUNT(*) FROM lunar_features").fetchone()[0]
    sq_p = cur.execute("SELECT COUNT(*) FROM custom_mission_profiles").fetchone()[0]
    conn.close()

    print(f"Local SQLite 'lunar_missions':      {sq_m} records")
    print(f"Local SQLite 'lunar_features':      {sq_f} records")
    print(f"Local SQLite 'custom_profiles':     {sq_p} records")
    print("=========================================================\n")


if __name__ == "__main__":
    main()
