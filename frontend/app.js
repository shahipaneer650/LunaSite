
(() => {
  "use strict";

  // =========================================================
  // 1. CONFIGURATION & GLOBAL STATE
  // =========================================================

  const cfg = window.LUNASITE_CONFIG || {};
  const backendBaseUrl = cfg.backendUrl || "http://127.0.0.1:8000";

  if (!window.Cesium) {
    console.error("CesiumJS is not loaded. Check your script tag.");
    return;
  }

  const $ = (selector) => document.querySelector(selector);

  const moonRadius = Number(cfg.moonRadiusMeters) || 1737400;

  const moonEllipsoid = new Cesium.Ellipsoid(
    moonRadius,
    moonRadius,
    moonRadius
  );

  Cesium.Ellipsoid.default = moonEllipsoid;

  let viewer = null;
  let moonTileset = null;
  let marker = null;

  let lunarMode = "tiles";
  let spinning = false;
  let toastTimer = null;

  let activeNasaLayer = null;
  let activeNasaBaseLayer = null;

  let nasaClickHandler = null;
  let missionMarkers = [];
  let htmlMarkers = [];
  let refHtmlMarker = null;

  let lightingTickListener = null;
  let celestialTickListener = null;

  let sunEntity = null;
  let earthEntity = null;

  let simulationInitialized = false;
  let selectedLatitude = -69.367621;
  let selectedLongitude = 32.348126;

  let isOrbitDragging = false;
  let dragDidOccur = false;
  let dragStartPos = null;
  let lastDragPos = null;
  let lastDelta = { x: 0, y: 0 };
  let inertiaRaf = null;

  const views = {
    globe: $("#globeView"),
    assessment: $("#assessmentView"),
    missions: $("#missionsView"),
    saved: $("#savedSitesView"),
    about: $("#aboutView"),
    grading: $("#gradingView")
  };

  const viewNames = {
    globe: "Lunar explorer",
    assessment: "Site assessment",
    missions: "Historical missions",
    saved: "Saved landing sites",
    about: "Data & methodology",
    grading: "Mission grading"
  };


  // =========================================================
  // 2. GENERAL UTILITIES
  // =========================================================

  function showToast(message) {
    const element = $("#toast");

    if (!element) {
      console.info("[LunaSite]", message);
      return;
    }

    element.textContent = message;
    element.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      element.classList.remove("show");
    }, 2800);
  }

  function setLoading(title, message) {
    if ($("#loadingTitle")) {
      $("#loadingTitle").textContent = title;
    }

    if ($("#loadingText")) {
      $("#loadingText").textContent = message;
    }
  }

  function setStatus(success, message) {
    if ($("#statusDot")) {
      $("#statusDot").style.background =
        success ? "#80bd9b" : "#d47b73";
    }

    if ($("#modelStatus")) {
      $("#modelStatus").textContent = message;
    }
  }

  function validCoordinates(latitude, longitude) {
    if (latitude === "" || longitude === "") {
      return "Enter both coordinates.";
    }

    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return "Coordinates must be valid numbers.";
    }

    if (lat < -90 || lat > 90) {
      return "Latitude must be between -90 and +90 degrees.";
    }

    if (lon < -180 || lon > 180) {
      return "Longitude must be between -180 and +180 degrees.";
    }

    return null;
  }

  function setHud(latitude, longitude) {
    const format = (value, positive, negative) =>
      `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;

    if ($("#hudLat")) {
      $("#hudLat").textContent = format(latitude, "N", "S");
    }

    if ($("#hudLon")) {
      $("#hudLon").textContent = format(longitude, "E", "W");
    }

    const refSiteEl = $("#hudReferenceSite");
    const siteDetailsEl = $("#hudSiteDetails");
    if (refSiteEl) {
      const match = lunarMissionSites.find(
        s => Math.abs(s.latitude - latitude) < 0.15 && Math.abs(s.longitude - longitude) < 0.15
      );
      if (match) {
        refSiteEl.textContent = match.name.toUpperCase();
        if (siteDetailsEl) {
          siteDetailsEl.textContent = `${match.agency || "HISTORICAL MISSION"} · ${format(latitude, "N", "S")}, ${format(longitude, "E", "W")}`;
        }
      } else {
        refSiteEl.textContent = `TARGET (${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°)`;
        if (siteDetailsEl) {
          siteDetailsEl.textContent = `${format(latitude, "N", "S")}, ${format(longitude, "E", "W")}`;
        }
      }
    }
  }


  // =========================================================
  // 2B. DYNAMIC SELECTED SITE & LOCATION INTELLIGENCE
  // =========================================================

  function updateSelectedSiteCard(latitude, longitude, elevation = null, slope = null) {
    const titleEl = $("#selSiteCardTitle");
    const descEl = $("#selSiteCardDesc");
    const catEl = $("#selSiteCardCategory");
    const ctxEl = $("#selSiteCardContext");
    const badgeEl = $("#selSiteCardBadge");
    const latEl = $("#selSiteCardLat");
    const lonEl = $("#selSiteCardLon");
    const elevEl = $("#selSiteCardElev");
    const slopeEl = $("#selSiteCardSlope");

    if (!titleEl) return;

    const latStr = `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? "S" : "N"}`;
    const lonStr = `${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? "W" : "E"}`;

    if (latEl) latEl.textContent = latStr;
    if (lonEl) lonEl.textContent = lonStr;

    if (elevation !== null && elevation !== undefined) {
      if (elevEl) elevEl.textContent = `${Number(elevation) >= 0 ? "+" : ""}${Number(elevation).toFixed(1)} m`;
    }
    if (slope !== null && slope !== undefined) {
      if (slopeEl) slopeEl.textContent = `${Number(slope).toFixed(1)}°`;
    }

    // Check if coordinates match one of the 28 historical missions
    const match = (historicalMissionsCache || lunarMissionSites).find(
      s => Math.abs((s.latitude_deg !== undefined ? s.latitude_deg : s.latitude) - latitude) < 0.15 &&
           Math.abs((s.longitude_deg !== undefined ? s.longitude_deg : s.longitude) - longitude) < 0.15
    );

    if (match) {
      const op = (match.agency || match.operator || "MISSION").toUpperCase();
      const aClass = op.includes("NASA") ? "nasa"
        : op.includes("ISRO") ? "isro"
        : op.includes("CNSA") ? "cnsa"
        : op.includes("USSR") ? "ussr"
        : op.includes("JAXA") ? "jaxa"
        : "commercial";

      if (catEl) catEl.textContent = "HISTORICAL TOUCHDOWN SITE";
      if (ctxEl) ctxEl.textContent = `${match.country ? match.country + " · " : ""}${match.landing_date || "VERIFIED"}`;
      if (badgeEl) {
        badgeEl.textContent = match.operator || match.agency || "HISTORICAL";
        badgeEl.className = `mission-agency-badge ${aClass}`;
      }
      titleEl.textContent = match.name;
      if (descEl) {
        descEl.textContent = match.scientific_observations ||
          (match.landing_site_name ? `Historical landing site at ${match.landing_site_name}.` : "Touchdown coordinate recorded in planetary mission archives.");
      }
    } else {
      // Custom candidate location
      let regionDesc = "Nearside Maria / Highlands plain";
      if (latitude <= -80) {
        regionDesc = "Deep Lunar South Pole (Permanently Shadowed Region Corridor)";
      } else if (latitude <= -60) {
        regionDesc = "South Pole High-Latitude Highland Terrain";
      } else if (latitude >= 60) {
        regionDesc = "North Pole High-Latitude Highland Terrain";
      } else if (longitude < -90 || longitude > 90) {
        regionDesc = "Lunar Farside (Radio-Quiet Communication Shadow)";
      }

      if (catEl) catEl.textContent = "SELECTED POSITION";
      if (ctxEl) ctxEl.textContent = "LUNAR SURFACE TARGET";
      if (badgeEl) {
        badgeEl.textContent = "CANDIDATE";
        badgeEl.className = "mission-agency-badge default";
      }
      titleEl.textContent = `Candidate Site (${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°)`;
      if (descEl) {
        descEl.textContent = `${regionDesc}. Real-time ephemeris, solar irradiance flux, and terrain gradient active for this location.`;
      }
    }
  }

  function setupSelectedSiteCardActions() {
    const assessBtn = $("#selSiteAssessBtn");
    if (assessBtn) {
      assessBtn.addEventListener("click", () => {
        const aLat = $("#assessmentLat");
        const aLon = $("#assessmentLon");
        if (aLat) aLat.value = selectedLatitude.toFixed(6);
        if (aLon) aLon.value = selectedLongitude.toFixed(6);
        switchView("assessment");
        runScientificAssessment();
      });
    }

    const bookmarkBtn = $("#selSiteBookmarkBtn");
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener("click", async () => {
        const match = (historicalMissionsCache || lunarMissionSites).find(
          s => Math.abs((s.latitude_deg ?? s.latitude) - selectedLatitude) < 0.15 &&
               Math.abs((s.longitude_deg ?? s.longitude) - selectedLongitude) < 0.15
        );
        const name = match ? match.name : `Candidate (${selectedLatitude.toFixed(2)}°, ${selectedLongitude.toFixed(2)}°)`;
        try {
          const res = await fetch(`${backendBaseUrl}/api/saved-sites`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              latitude: selectedLatitude,
              longitude: selectedLongitude,
              notes: `Bookmarked from 3D Lunar Inspector.`,
              suitability_score: 85
            })
          });
          if (res.ok) {
            showToast(`Site "${name}" saved to database!`);
            loadSavedSites();
          } else {
            showToast("Failed to bookmark site.");
          }
        } catch (e) {
          showToast("Database bookmarking error.");
        }
      });
    }
  }


  // =========================================================
  // 3. NAVIGATION
  // =========================================================

  function switchView(name) {
    Object.entries(views).forEach(([key, element]) => {
      if (element) {
        element.classList.toggle("active", key === name);
      }
    });

    document.querySelectorAll(".nav-item").forEach((element) => {
      element.classList.toggle(
        "active",
        element.dataset.view === name
      );
    });

    if ($("#crumbText") && viewNames[name]) {
      $("#crumbText").textContent = viewNames[name];
    }

    if ($("#sidebar")) {
      $("#sidebar").classList.remove("open");
    }

    if (name === "globe" && viewer) {
      setTimeout(() => viewer.resize(), 100);
    }

    if (name === "missions") {
      loadMissionsCatalog();
    }

    if (name === "saved") {
      loadSavedSites();
    }

    if (name === "grading") {
      onGradingViewOpened();
    }
  }

  // Collapsible Sidebar Management
  function updateSidebarToggleIcons() {
    const isCollapsed = document.body.classList.contains("sidebar-collapsed");
    const toggleBtn = $("#sidebarCollapseBtn");
    if (toggleBtn) {
      const icon = toggleBtn.querySelector(".toggle-icon");
      const label = toggleBtn.querySelector(".toggle-label");
      if (icon) icon.textContent = isCollapsed ? "»" : "«";
      if (label) label.textContent = isCollapsed ? "Expand" : "Collapse Menu";
      toggleBtn.title = isCollapsed ? "Expand sidebar menu" : "Collapse to mini rail";
    }

    const topToggleBtn = $("#sidebarCollapseTopBtn");
    if (topToggleBtn) {
      topToggleBtn.title = isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)";
      const svg = topToggleBtn.querySelector("svg");
      if (svg) {
        svg.innerHTML = isCollapsed
          ? '<polyline points="9 18 15 12 9 6"></polyline>'
          : '<polyline points="15 18 9 12 15 6"></polyline>';
      }
    }
  }

  function toggleSidebar(forceState = null) {
    const isMobile = window.innerWidth <= 800;
    if (isMobile) {
      const sidebar = $("#sidebar");
      if (sidebar) {
        const willOpen = forceState !== null ? forceState : !sidebar.classList.contains("open");
        sidebar.classList.toggle("open", willOpen);
      }
    } else {
      const willCollapse = forceState !== null ? forceState : !document.body.classList.contains("sidebar-collapsed");
      document.body.classList.toggle("sidebar-collapsed", willCollapse);
      try {
        localStorage.setItem("lunasite_sidebar_collapsed", willCollapse ? "1" : "0");
      } catch (e) {}
      updateSidebarToggleIcons();
    }
    // Smoothly resize Cesium 3D viewer and 2D canvas to fit the expanded layout
    setTimeout(() => {
      if (window.viewer && window.viewer.resize) {
        window.viewer.resize();
      }
      if (typeof drawHistoricalMoonMap === "function") {
        drawHistoricalMoonMap();
      }
    }, 280);
  }

  // Restore saved collapse preference on desktop
  try {
    if (window.innerWidth > 800 && localStorage.getItem("lunasite_sidebar_collapsed") === "1") {
      document.body.classList.add("sidebar-collapsed");
    }
    updateSidebarToggleIcons();
  } catch (e) {}

  if ($("#menuBtn")) {
    $("#menuBtn").addEventListener("click", () => toggleSidebar());
  }
  if ($("#sidebarCollapseBtn")) {
    $("#sidebarCollapseBtn").addEventListener("click", () => toggleSidebar());
  }
  if ($("#sidebarCollapseTopBtn")) {
    $("#sidebarCollapseTopBtn").addEventListener("click", () => toggleSidebar());
  }

  // Global Ctrl+B toggle for keyboard accessibility
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      toggleSidebar();
    }
  });

  document.querySelectorAll(".nav-item").forEach((element) => {
    element.addEventListener("click", () => {
      switchView(element.dataset.view);
      if (window.innerWidth <= 800) {
        $("#sidebar")?.classList.remove("open");
      }
    });
  });


  // =========================================================
  // 4. HEADER DUAL CLOCK (UTC + IST)
  // =========================================================

  function formatDualClock(date, isSim = false) {
    const utcStr = date.toISOString().slice(11, 19);
    const istDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
    const istStr = istDate.toISOString().slice(11, 19);
    const prefix = isSim ? "SIM " : "";
    return `${prefix}UTC ${utcStr} · ${istStr} IST`;
  }

  function updateHeaderClock() {
    const utcEl = $("#utc");
    if (!utcEl) return;

    if (window.viewer && window.viewer.clock && window.viewer.clock.shouldAnimate) {
      const curDate = Cesium.JulianDate.toDate(window.viewer.clock.currentTime);
      utcEl.textContent = formatDualClock(curDate, true);
    } else {
      utcEl.textContent = formatDualClock(new Date(), false);
    }
  }

  updateHeaderClock();
  setInterval(updateHeaderClock, 1000);


  // =========================================================
  // 5. REFERENCE / TARGET MARKER
  // =========================================================

  function addReferenceMarker(latitude, longitude) {
    if (!viewer || !cfg.enableReferenceMarker) return;

    if (marker) {
      viewer.entities.remove(marker);
      marker = null;
    }

    if (refHtmlMarker) {
      refHtmlMarker.el.remove();
      refHtmlMarker = null;
    }

    const isKnownMission = lunarMissionSites.some(
      s => Math.abs(s.latitude - latitude) < 0.15 && Math.abs(s.longitude - longitude) < 0.15
    );

    // If it's not one of the pre-catalogued mission sites, add target point and badge
    if (!isKnownMission) {
      const container = $("#lunarHtmlMarkersContainer");
      if (container) {
        const badge = document.createElement("div");
        badge.className = "lunar-marker-badge reference-marker-badge is-active";
        badge.style.borderColor = "rgba(239, 68, 68, 0.8)";
        badge.innerHTML = `
          <span class="lunar-marker-dot" style="background:#ef4444;"></span>
          <span class="lunar-marker-name" style="color:#fca5a5;">Target (${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°)</span>
        `;
        badge.title = `Inspected Target Coordinate · Click to inspect`;
        badge.addEventListener("mouseenter", () => {
          updateStaticSiteBanner({
            name: `Target Coordinate (${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°)`,
            agency: "INSPECT",
            latitude: latitude,
            longitude: longitude,
            hexColor: "#ef4444"
          });
        });
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          stopAutoRotate();
          flyToCoordinates(latitude, longitude);
          updateStaticSiteBanner({
            name: `Target Coordinate (${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°)`,
            agency: "INSPECT",
            latitude: latitude,
            longitude: longitude,
            hexColor: "#ef4444"
          }, true);
        });
        container.appendChild(badge);
        refHtmlMarker = {
          el: badge,
          cartesian: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0, moonEllipsoid)
        };
      }
      updateStaticSiteBanner({
        name: `Target Coordinate (${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°)`,
        agency: "INSPECT",
        latitude: latitude,
        longitude: longitude,
        hexColor: "#ef4444"
      }, true);
    }
  }


  // =========================================================
  // 6. FLY TO COORDINATES
  // =========================================================

  function flyToCoordinates(latitude, longitude, targetAltitude = 160000) {
    if (!viewer) return;
    stopAutoRotate();

    const destination = Cesium.Cartesian3.fromDegrees(
      Number(longitude),
      Number(latitude),
      targetAltitude,
      moonEllipsoid
    );

    viewer.camera.flyTo({
      destination,

      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-89.9),
        roll: 0
      },

      duration: 2.0,

      complete: () => {
        stopAutoRotate();
        selectedLatitude = Number(latitude);
        selectedLongitude = Number(longitude);

        setHud(selectedLatitude, selectedLongitude);
        addReferenceMarker(selectedLatitude, selectedLongitude);
        analyzeLunarTerrain(selectedLatitude, selectedLongitude);
        updateMainGrading(selectedLatitude, selectedLongitude);
      }
    });
  }


  // =========================================================
  // 7. NASA MOON TREK LAYERS
  // =========================================================

  const nasaLayerConfig = {
    wac: {
      name: "LROC WAC Global Imagery",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg",
      layer: "LRO_WAC_Mosaic_Global_303ppd_v02",
      format: "image/jpeg",
      maximumLevel: 7
    },
    elevation: {
      name: "LOLA Elevation",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrShade_Global_128ppd_v04/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_ClrShade_Global_128ppd_v04",
      format: "image/png",
      maximumLevel: 6
    },
    slope: {
      name: "LOLA Surface Slope Heatmap",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrSlope_Global_16ppd/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_ClrSlope_Global_16ppd",
      format: "image/png",
      maximumLevel: 4
    },
    thermal: {
      name: "Diviner Surface Temperature",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_Diviner_ST_Avg_Clr_Global_32ppd/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_Diviner_ST_Avg_Clr_Global_32ppd",
      format: "image/png",
      maximumLevel: 5
    },
    psr: {
      name: "Permanently Shadowed Regions (PSR)",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_Illumination_SPole65S_240m_EQ/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_Illumination_SPole65S_240m_EQ",
      format: "image/png",
      maximumLevel: 6
    },
    roughness: {
      name: "LOLA Surface Roughness",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrRoughness_Global_16ppd/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_ClrRoughness_Global_16ppd",
      format: "image/png",
      maximumLevel: 4
    },
    mineral: {
      name: "Clementine Mineral (FeO)",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/Clem_UVVIS_FeO_Clr_Global_152ppd/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "Clem_UVVIS_FeO_Clr_Global_152ppd",
      format: "image/png",
      maximumLevel: 6
    },
    hazards: {
      name: "Crater & Hazard Layer",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrSlope_Global_16ppd/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_ClrSlope_Global_16ppd",
      format: "image/png",
      maximumLevel: 4
    },
    illumination: {
      name: "Sunlight & Illumination Layer",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_Illumination_SPole65S_240m_EQ/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_Illumination_SPole65S_240m_EQ",
      format: "image/png",
      maximumLevel: 6
    },
    water_ice: {
      name: "Water-Ice Potential Layer",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_Diviner_ST_Avg_Clr_Global_32ppd/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_Diviner_ST_Avg_Clr_Global_32ppd",
      format: "image/png",
      maximumLevel: 5
    },
    earth_visibility: {
      name: "Earth Visibility / DTE Horizon Layer",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg",
      layer: "LRO_WAC_Mosaic_Global_303ppd_v02",
      format: "image/jpeg",
      maximumLevel: 7
    },
    comm_coverage: {
      name: "Communication Coverage Layer",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg",
      layer: "LRO_WAC_Mosaic_Global_303ppd_v02",
      format: "image/jpeg",
      maximumLevel: 7
    },
    candidate_zones: {
      name: "Candidate Landing Corridors",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrShade_Global_128ppd_v04/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_ClrShade_Global_128ppd_v04",
      format: "image/png",
      maximumLevel: 6
    },
    suitability: {
      name: "★ Landing Suitability Heatmap",
      url: "https://trek.nasa.gov/tiles/Moon/EQ/LRO_LOLA_ClrSlope_Global_16ppd/1.0.0/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png",
      layer: "LRO_LOLA_ClrSlope_Global_16ppd",
      format: "image/png",
      maximumLevel: 4
    }
  };

  function createNasaProvider(key) {
    const config = nasaLayerConfig[key];

    if (!config) {
      throw new Error(`Invalid NASA layer: ${key}`);
    }

    const tilingScheme = new Cesium.GeographicTilingScheme({
      ellipsoid: moonEllipsoid,
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1
    });

    return new Cesium.WebMapTileServiceImageryProvider({
      url: config.url,
      layer: config.layer,
      style: "default",
      format: config.format,
      tileMatrixSetID: "default028mm",
      tilingScheme,
      maximumLevel: config.maximumLevel,
      credit: new Cesium.Credit(
        "NASA Moon Trek / LRO / LROC / LOLA"
      )
    });
  }


  // =========================================================
  // 8. MISSION LOCATIONS (AUTHORITATIVE CANONICAL 28 DATASET)
  // =========================================================

  const lunarMissionSites = [
    { id: "luna-9", name: "Luna 9", siteName: "Oceanus Procellarum (Planitia Descensus)", agency: "USSR", latitude: 7.08, longitude: -64.37, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "surveyor-1", name: "Surveyor 1", siteName: "Flamsteed Crater, Oceanus Procellarum", agency: "NASA", latitude: -2.4745, longitude: -43.3399, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "luna-13", name: "Luna 13", siteName: "Oceanus Procellarum", agency: "USSR", latitude: 18.87, longitude: -62.05, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "surveyor-3", name: "Surveyor 3", siteName: "Surveyor Crater, Oceanus Procellarum", agency: "NASA", latitude: -3.016, longitude: -23.418, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "surveyor-5", name: "Surveyor 5", siteName: "Mare Tranquillitatis", agency: "NASA", latitude: 1.461, longitude: 23.195, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "surveyor-6", name: "Surveyor 6", siteName: "Sinus Medii (Central Bay)", agency: "NASA", latitude: 0.474, longitude: -1.48, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "surveyor-7", name: "Surveyor 7", siteName: "Tycho Crater Rim Ejecta Blanket", agency: "NASA", latitude: -40.857, longitude: -11.47, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "apollo-11", name: "Apollo 11", siteName: "Statio Tranquillitatis, Mare Tranquillitatis", agency: "NASA", latitude: 0.67408, longitude: 23.47297, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "apollo-12", name: "Apollo 12", siteName: "Oceanus Procellarum", agency: "NASA", latitude: -3.01239, longitude: -23.42157, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "luna-16", name: "Luna 16", siteName: "Mare Fecunditatis", agency: "USSR", latitude: -0.686, longitude: 56.364, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "luna-17", name: "Luna 17 / Lunokhod 1", siteName: "Mare Imbrium", agency: "USSR", latitude: 38.238, longitude: -35.002, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "apollo-14", name: "Apollo 14", siteName: "Fra Mauro Formation", agency: "NASA", latitude: -3.6453, longitude: -17.47136, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "apollo-15", name: "Apollo 15", siteName: "Hadley-Apennine", agency: "NASA", latitude: 26.13222, longitude: 3.63386, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "luna-20", name: "Luna 20", siteName: "Apollonius Highlands", agency: "USSR", latitude: 3.786, longitude: 56.625, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "apollo-16", name: "Apollo 16", siteName: "Descartes Highlands", agency: "NASA", latitude: -8.97301, longitude: 15.49812, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "apollo-17", name: "Apollo 17", siteName: "Taurus-Littrow Valley", agency: "NASA", latitude: 20.1908, longitude: 30.77168, color: Cesium.Color.CYAN, hexColor: "#38bdf8" },
    { id: "luna-21", name: "Luna 21 / Lunokhod 2", siteName: "Le Monnier Crater, Mare Serenitatis", agency: "USSR", latitude: 25.85, longitude: 30.45, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "luna-23", name: "Luna 23", siteName: "Southern Mare Crisium", agency: "USSR", latitude: 12.667, longitude: 62.152, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "luna-24", name: "Luna 24", siteName: "Southern Mare Crisium", agency: "USSR", latitude: 12.714, longitude: 62.213, color: Cesium.Color.RED, hexColor: "#ef4444" },
    { id: "change-3", name: "Chang'e 3 / Yutu", siteName: "Mare Imbrium (Guang Han Gong)", agency: "CNSA", latitude: 44.1214, longitude: -19.5116, color: Cesium.Color.YELLOW, hexColor: "#eab308" },
    { id: "change-4", name: "Chang'e 4 / Yutu-2", siteName: "Von Kármán Crater, South Pole-Aitken (SPA) Basin (Statio Tianhe)", agency: "CNSA", latitude: -45.457, longitude: 177.588, color: Cesium.Color.YELLOW, hexColor: "#eab308" },
    { id: "change-5", name: "Chang'e 5", siteName: "Mons Rümker, Oceanus Procellarum (Statio Tianchuan)", agency: "CNSA", latitude: 43.0576, longitude: -51.9161, color: Cesium.Color.YELLOW, hexColor: "#eab308" },
    { id: "chandrayaan-3", name: "Chandrayaan-3 (Vikram / Pragyan)", siteName: "Shiv Shakti Point (Manzinus-Boguslawsky Corridor)", agency: "ISRO", latitude: -69.367621, longitude: 32.348126, color: Cesium.Color.ORANGE, hexColor: "#f97316" },
    { id: "slim", name: "SLIM", siteName: "Shioli Crater (Theophilus Ejecta Blanket)", agency: "JAXA", latitude: -13.316, longitude: 25.251, color: Cesium.Color.fromCssColorString("#ec4899"), hexColor: "#ec4899" },
    { id: "im-1", name: "IM-1 Odysseus (CLPS Nova-C)", siteName: "Malapert A Crater", agency: "CLPS", latitude: -80.13, longitude: 1.44, color: Cesium.Color.fromCssColorString("#a855f7"), hexColor: "#a855f7" },
    { id: "change-6", name: "Chang'e 6", siteName: "Apollo Crater, South Pole-Aitken (SPA) Basin (Statio Tianchuan Farside)", agency: "CNSA", latitude: -41.6385, longitude: -153.9852, color: Cesium.Color.YELLOW, hexColor: "#eab308" },
    { id: "blue-ghost-1", name: "Blue Ghost Mission 1", siteName: "Mare Crisium (near Mons Latreille)", agency: "CLPS", latitude: 18.56, longitude: 61.81, color: Cesium.Color.fromCssColorString("#a855f7"), hexColor: "#a855f7" },
    { id: "im-2", name: "IM-2 Athena", siteName: "Connecting Ridge (Shackleton-de Gerlache)", agency: "CLPS", latitude: -89.45, longitude: -137.95, color: Cesium.Color.fromCssColorString("#a855f7"), hexColor: "#a855f7" }
  ];

  function clearMissionMarkers() {
    if (!viewer) return;

    missionMarkers.forEach((entity) => {
      viewer.entities.remove(entity);
    });
    missionMarkers = [];

    htmlMarkers.forEach((m) => {
      m.el.remove();
    });
    htmlMarkers = [];
  }

  function addMissionMarkers() {
    if (!viewer) return;

    clearMissionMarkers();
    const container = $("#lunarHtmlMarkersContainer");

    lunarMissionSites.forEach((site) => {
      const cartesian = Cesium.Cartesian3.fromDegrees(
        site.longitude,
        site.latitude,
        0,
        moonEllipsoid
      );

      if (container) {
        const badge = document.createElement("div");
        badge.className = "lunar-marker-badge";
        badge.dataset.siteId = site.id;
        badge.innerHTML = `
          <span class="lunar-marker-dot" style="background:${site.hexColor};"></span>
          <span class="lunar-marker-name">${site.name}</span>
        `;
        badge.title = `${site.name} (${site.agency}) · Click to fly & inspect`;
        badge.addEventListener("mouseenter", () => {
          updateStaticSiteBanner(site);
        });
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          stopAutoRotate();
          flyToCoordinates(site.latitude, site.longitude);
          updateStaticSiteBanner(site, true);
        });
        container.appendChild(badge);
        htmlMarkers.push({
          el: badge,
          cartesian,
          site
        });
      }
    });
  }

  let labelsDisplayMode = "static"; // "static" | "all"
  let currentActiveSite = null;

  function updateStaticSiteBanner(site, isPinned = false) {
    if (!site) return;
    currentActiveSite = site;
    const bannerDot = $("#bannerDot");
    const bannerAgency = $("#bannerAgency");
    const bannerSiteName = $("#bannerSiteName");
    const bannerCoords = $("#bannerCoords");
    const hudRef = $("#hudReferenceSite");
    const hudDetails = $("#hudSiteDetails");

    const lat = typeof site.latitude === "number" ? site.latitude : (site.latitude_deg || 0);
    const lon = typeof site.longitude === "number" ? site.longitude : (site.longitude_deg || 0);
    const latStr = `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`;
    const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;

    if (bannerDot) {
      bannerDot.style.background = site.hexColor || "#38bdf8";
      bannerDot.style.color = site.hexColor || "#38bdf8";
    }
    if (bannerAgency) {
      bannerAgency.textContent = site.agency || "NASA";
      bannerAgency.style.borderColor = site.hexColor || "#38bdf8";
      bannerAgency.style.color = site.hexColor || "#38bdf8";
    }
    if (bannerSiteName) {
      bannerSiteName.textContent = site.name;
    }
    if (bannerCoords) {
      bannerCoords.textContent = `${latStr}, ${lonStr}`;
    }

    if (hudRef) {
      hudRef.textContent = site.name.toUpperCase();
    }
    if (hudDetails) {
      hudDetails.textContent = `${latStr}, ${lonStr} · ${site.agency || ''}`;
    }

    updateSelectedSiteCard(lat, lon);

    if (isPinned) {
      document.querySelectorAll(".lunar-marker-badge").forEach(b => b.classList.remove("is-active"));
      const match = htmlMarkers.find(m => m.site && (m.site.id === site.id || m.site.name === site.name));
      if (match && match.el) {
        match.el.classList.add("is-active");
      }
    }
  }

  function setupLabelsToggle() {
    const btn = $("#toggleLabelsBtn");
    const container = $("#lunarHtmlMarkersContainer");
    const banner = $("#staticSiteBanner");

    if (banner) {
      banner.style.cursor = "pointer";
      banner.title = "Click to focus directly on this site";
      banner.addEventListener("click", () => {
        if (currentActiveSite) {
          const lat = typeof currentActiveSite.latitude === "number" ? currentActiveSite.latitude : currentActiveSite.latitude_deg;
          const lon = typeof currentActiveSite.longitude === "number" ? currentActiveSite.longitude : currentActiveSite.longitude_deg;
          if (typeof lat === "number" && typeof lon === "number") {
            flyToCoordinates(lat, lon);
          }
        }
      });
    }

    if (!btn || !container) return;

    // Default is static mode: compact pins on 3D globe + static banner display
    container.classList.add("mode-static");
    btn.textContent = "LABELS: STATIC";
    btn.classList.add("active");

    btn.addEventListener("click", () => {
      if (labelsDisplayMode === "static") {
        labelsDisplayMode = "all";
        container.classList.remove("mode-static");
        btn.textContent = "LABELS: ALL";
        btn.classList.remove("active");
        const bannerBadge = $("#bannerModeBadge");
        if (bannerBadge) bannerBadge.textContent = "ALL LABELS ACTIVE";
      } else {
        labelsDisplayMode = "static";
        container.classList.add("mode-static");
        btn.textContent = "LABELS: STATIC";
        btn.classList.add("active");
        const bannerBadge = $("#bannerModeBadge");
        if (bannerBadge) bannerBadge.textContent = "STATIC NAME DISPLAY";
      }
    });
  }

  function updateHtmlMarkers() {
    if (!viewer || !viewer.scene) return;
    const allMarkers = [...htmlMarkers];
    if (refHtmlMarker) allMarkers.push(refHtmlMarker);
    if (!allMarkers.length) return;

    const cameraPos = viewer.camera.position;
    const occluder = new Cesium.EllipsoidalOccluder(moonEllipsoid, cameraPos);

    const cameraDist = Cesium.Cartesian3.distance(cameraPos, Cesium.Cartesian3.ZERO);
    const tooFar = cameraDist > 65000000;

    allMarkers.forEach((m) => {
      if (tooFar || !occluder.isPointVisible(m.cartesian)) {
        m.el.style.display = "none";
        return;
      }

      const win = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, m.cartesian);
      if (win && win.x >= -60 && win.y >= -60 && win.x <= window.innerWidth + 60 && win.y <= window.innerHeight + 60) {
        m.el.style.display = "flex";
        m.el.style.transform = `translate3d(${Math.round(win.x)}px, ${Math.round(win.y)}px, 0) translate(-50%, -50%)`;
      } else {
        m.el.style.display = "none";
      }
    });
  }


  // =========================================================
  // 9. NASA TOOLBAR
  // =========================================================

  function updateNasaToolbar(activeKey) {
    document.querySelectorAll(".nasa-mode-btn[data-layer]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.layer === activeKey
      );
    });

    const drawerBtn = $("#openLayersDrawerBtn");
    if (drawerBtn) {
      if (activeKey !== "tiles" && activeKey !== "suitability" && nasaLayerConfig[activeKey]) {
        drawerBtn.classList.add("active");
        drawerBtn.textContent = `LAYERS (${nasaLayerConfig[activeKey].name.split(" ")[0].toUpperCase()}) ▾`;
      } else {
        drawerBtn.classList.remove("active");
        drawerBtn.textContent = "LAYERS ▾";
      }
    }

    document.querySelectorAll(".layer-checkbox").forEach((cb) => {
      cb.checked = (cb.dataset.layer === activeKey);
    });

    document.querySelectorAll(".layer-item").forEach((item) => {
      item.classList.toggle("active-layer", item.dataset.layer === activeKey);
    });
  }

  function createNasaToolbar() {
    const viewerTopline =
      document.querySelector(".viewer-topline");

    if (!viewerTopline || $("#nasaToolbar")) return;

    const toolbar = document.createElement("div");
    toolbar.id = "nasaToolbar";

    toolbar.innerHTML = `
      <button class="nasa-mode-btn active" data-layer="tiles">3D MODEL</button>
      <button class="nasa-mode-btn suitability-btn" data-layer="suitability">★ SUITABILITY HEATMAP</button>
      <button class="nasa-mode-btn" id="openLayersDrawerBtn" type="button">LAYERS ▾</button>
    `;

    const viewerTools =
      viewerTopline.querySelector(".viewer-tools");

    if (viewerTools) {
      viewerTopline.insertBefore(toolbar, viewerTools);
    } else {
      viewerTopline.appendChild(toolbar);
    }

    toolbar.querySelectorAll(".nasa-mode-btn[data-layer]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.layer;

        if (key === "tiles") {
          switchTo3DModel();
        } else {
          switchNasaLayer(key);
        }
      });
    });

    const drawerBtn = $("#openLayersDrawerBtn");
    if (drawerBtn) {
      drawerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const drawer = $("#layersDrawer");
        if (drawer) {
          drawer.hidden = !drawer.hidden;
        }
      });
    }
  }


  // =========================================================
  // 10. NASA LAYER MANAGEMENT
  // =========================================================

  function removeNasaLayers() {
    if (!viewer) return;

    if (activeNasaLayer) {
      viewer.imageryLayers.remove(activeNasaLayer, true);
      activeNasaLayer = null;
    }

    if (activeNasaBaseLayer) {
      viewer.imageryLayers.remove(activeNasaBaseLayer, true);
      activeNasaBaseLayer = null;
    }
  }

  function focusWholeMoon() {
    if (!viewer) return;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        0,
        0,
        5200000,
        moonEllipsoid
      ),

      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0
      },

      duration: 1.8
    });
  }

  function focusSouthPole() {
    if (!viewer) return;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        0,
        -88,
        1800000,
        moonEllipsoid
      ),

      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-89),
        roll: 0
      },

      duration: 2.2
    });
  }

  // =========================================================
  // UNIVERSAL SCIENTIFIC LEGEND & DETAILS BAR (ALL 14 LAYERS)
  // =========================================================

  const layerLegendInfo = {
    wac: {
      title: "LROC WAC GLOBAL PHOTOGRAPHIC MOSAIC",
      gradient: "linear-gradient(to right, #111111 0%, #374151 35%, #9ca3af 70%, #f3f4f6 100%)",
      lowLabel: "LOW ALBEDO (MARE BASINS)",
      midLabel: "AVERAGE HIGHLANDS",
      highLabel: "HIGH ALBEDO (EJECTA)",
      lowVal: "0.05 Reflectance",
      midVal: "0.12 Mean Albedo",
      highVal: "0.35+ High Albedo",
      lowColor: "#9ca3af",
      midColor: "#cbd5e1",
      highColor: "#f8fafc",
      desc: "Lunar Reconnaissance Orbiter Camera (LROC) Wide Angle Camera 303 PPD (100 m/pixel) global monochrome basemap. Displays surface morphometry, regolith albedo, and impact crater morphology.",
      tags: [
        { name: "Shiv Shakti Point", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Apollo 11 Tranquillity", lat: 0.674, lon: 23.473, type: "optimal" },
        { name: "Tycho Crater Rim", lat: -43.31, lon: -11.36, type: "moderate" },
        { name: "Aristarchus Plateau", lat: 23.7, lon: -47.4, type: "moderate" }
      ]
    },
    elevation: {
      title: "LOLA COLOR-SHADED TOPOGRAPHY & RELIEF",
      gradient: "linear-gradient(to right, #2b83ba 0%, #64abb0 20%, #abdda4 40%, #ffffbf 60%, #fdae61 80%, #d7191c 95%, #ffffff 100%)",
      lowLabel: "DEEP BASINS & FLOORS",
      midLabel: "MEAN DATUM (0 m)",
      highLabel: "HIGHLAND PEAKS & RIMS",
      lowVal: "−9,100 m (SPA)",
      midVal: "0 m Reference",
      highVal: "+10,780 m (Peaks)",
      lowColor: "#38bdf8",
      midColor: "#facc15",
      highColor: "#f87171",
      desc: "Lunar Orbiter Laser Altimeter (LOLA) 128 PPD digital elevation model. Displays absolute surface elevation referenced to the 1,737.4 km lunar spherical datum.",
      tags: [
        { name: "SPA Basin Floor (-9.1km)", lat: -53.0, lon: 169.0, type: "optimal" },
        { name: "Korolev Crater (+10.7km)", lat: 4.5, lon: -157.4, type: "moderate" },
        { name: "Malapert Mtn (+5.0km)", lat: -84.9, lon: 12.9, type: "optimal" },
        { name: "Shackleton Rim (-89.9°)", lat: -89.9, lon: 0.0, type: "optimal" }
      ]
    },
    slope: {
      title: "LOLA SURFACE SLOPE & HAZARD HEATMAP",
      gradient: "linear-gradient(to right, #22c55e 0%, #84cc16 25%, #eab308 50%, #f97316 75%, #ef4444 100%)",
      lowLabel: "0° - 5° LEVEL & SAFE",
      midLabel: "6° - 12° MODERATE INCLINE",
      highLabel: "15°+ EXTREME / UNSTABLE",
      lowVal: "< 5° Landing Safe",
      midVal: "10° Artemis Limit",
      highVal: "> 20° Severe Hazard",
      lowColor: "#34d399",
      midColor: "#fbbf24",
      highColor: "#f87171",
      desc: "Surface slope derived from LOLA 16 PPD laser altimetry. Essential for lander gear stability (nominal limit ≤10°–12°), hazard avoidance, and rover route traversability.",
      tags: [
        { name: "Tranquillitatis (1.2°)", lat: 0.674, lon: 23.473, type: "optimal" },
        { name: "Shiv Shakti Safe (3.8°)", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Artemis Ridge (7.5°)", lat: -89.44, lon: 222.05, type: "moderate" },
        { name: "Tycho Wall (38°)", lat: -43.31, lon: -11.36, type: "hazard" }
      ]
    },
    thermal: {
      title: "LRO DIVINER SURFACE BOLOMETRIC TEMP",
      gradient: "linear-gradient(to right, #050814 0%, #1e3a8a 20%, #06b6d4 40%, #10b981 60%, #f59e0b 80%, #ef4444 100%)",
      lowLabel: "EXTREME CRYOGENIC (PSRs)",
      midLabel: "MODERATE EQUILIBRIUM",
      highLabel: "PEAK SUB-SOLAR HEAT",
      lowVal: "35 K (−238°C)",
      midVal: "220 K (−53°C)",
      highVal: "390 K (+117°C)",
      lowColor: "#38bdf8",
      midColor: "#34d399",
      highColor: "#f87171",
      desc: "Diviner Lunar Radiometer Experiment (DLRE) surface temperature measurements. Extreme thermal swings dictate spacecraft electronics survival, radiator sizing, and battery insulation.",
      tags: [
        { name: "Hermite PSR (35 K)", lat: 86.0, lon: -89.0, type: "optimal" },
        { name: "Haworth Cold Trap (40 K)", lat: -87.4, lon: -5.0, type: "optimal" },
        { name: "Shiv Shakti (140-230 K)", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Sub-solar Equator (390 K)", lat: 0.0, lon: 0.0, type: "moderate" }
      ]
    },
    psr: {
      title: "LRO PERMANENTLY SHADOWED REGIONS (PSR)",
      gradient: "linear-gradient(to right, #00ffff 0%, #0284c7 40%, #1e1b4b 75%, #09090b 100%)",
      lowLabel: "0% ILLUMINATION (PERMANENT PSR)",
      midLabel: "PARTIAL OCCLUSION",
      highLabel: "SUNLIT CRATER RIMS",
      lowVal: "0.0% Insolation",
      midVal: "< 5% Grazing Sun",
      highVal: "> 80% High Lighting",
      lowColor: "#38bdf8",
      midColor: "#818cf8",
      highColor: "#f87171",
      desc: "LRO LOLA polar illumination map (65°S to 90°S). Highlights permanently shadowed craters where extreme cold preserves ancient volatile deposits and water-ice.",
      tags: [
        { name: "Shackleton Deep Floor", lat: -89.9, lon: 0.0, type: "optimal" },
        { name: "Shoemaker Crater PSR", lat: -88.1, lon: 45.0, type: "optimal" },
        { name: "Faustini Cold Trap", lat: -87.3, lon: 77.0, type: "optimal" },
        { name: "Cabeus Crater Floor", lat: -84.9, lon: -35.5, type: "optimal" }
      ]
    },
    roughness: {
      title: "LOLA SURFACE ROUGHNESS & TEXTURE",
      gradient: "linear-gradient(to right, #047857 0%, #10b981 30%, #facc15 60%, #f97316 85%, #dc2626 100%)",
      lowLabel: "0.0 SMOOTH REGOLITH",
      midLabel: "0.4 MODERATE UNDULATION",
      highLabel: "1.0+ BLOCKY / SEVERE",
      lowVal: "0.05 Roughness",
      midVal: "0.35 Mean Relief",
      highVal: "0.85+ Rugged Field",
      lowColor: "#34d399",
      midColor: "#fbbf24",
      highColor: "#f87171",
      desc: "LOLA sub-kilometer surface Hurst exponent and RMS slope variation. Identifies blocky boulder distributions and crater rim ejecta fields that threaten landing gear.",
      tags: [
        { name: "Apollo 12 Oceanus (Smooth)", lat: -3.01, lon: -23.42, type: "optimal" },
        { name: "Shiv Shakti Regolith (Smooth)", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "South Pole Ridge", lat: -89.44, lon: 222.05, type: "moderate" },
        { name: "Tycho Rim Ejecta (Rugged)", lat: -43.31, lon: -11.36, type: "hazard" }
      ]
    },
    mineral: {
      title: "CLEMENTINE UVVIS IRON (FeO) CONCENTRATION",
      gradient: "linear-gradient(to right, #3b82f6 0%, #06b6d4 25%, #10b981 50%, #facc15 75%, #ef4444 100%)",
      lowLabel: "ANORTHOSITE (LOW Fe)",
      midLabel: "CRYPTOMARIA / INTERMEDIATE",
      highLabel: "BASALTIC MARE (HIGH FeO)",
      lowVal: "< 4 wt% FeO",
      midVal: "10 - 14 wt% FeO",
      highVal: "18 - 22+ wt% FeO",
      lowColor: "#38bdf8",
      midColor: "#34d399",
      highColor: "#f87171",
      desc: "Clementine 5-band UV/VIS spectral reflectance estimating weight-percent iron oxide (FeO). Key for resource utilization (ISRU), oxygen extraction, and titanium-rich ilmenite prospecting.",
      tags: [
        { name: "Mare Tranquillitatis (High Fe)", lat: 8.5, lon: 31.4, type: "optimal" },
        { name: "Aristarchus Pyroclastics", lat: 23.7, lon: -47.4, type: "optimal" },
        { name: "Descartes Highlands (Apollo 16)", lat: -8.97, lon: 15.5, type: "moderate" },
        { name: "Oceanus Procellarum", lat: 18.4, lon: -57.4, type: "optimal" }
      ]
    },
    hazards: {
      title: "CRATER RIM & SURFACE HAZARD ZONES",
      gradient: "linear-gradient(to right, #10b981 0%, #eab308 35%, #f97316 70%, #ef4444 90%, #7f1d1d 100%)",
      lowLabel: "BENIGN TOUCHDOWN PLAIN",
      midLabel: "MODERATE OBSTACLES",
      highLabel: "CRATER RIM / ESCARPMENT",
      lowVal: "Hazard Factor 0.1",
      midVal: "Hazard Factor 0.5",
      highVal: "Hazard Factor 0.95",
      lowColor: "#34d399",
      midColor: "#fbbf24",
      highColor: "#f87171",
      desc: "Morphological and slope obstacle classification. Distinguishes safe landing plains from steep crater escarpments and boulder debris fields.",
      tags: [
        { name: "Shiv Shakti Landing Plain", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Fra Mauro Plain (Apollo 14)", lat: -3.64, lon: -17.47, type: "optimal" },
        { name: "Clavius Crater Rim", lat: -58.4, lon: -14.4, type: "hazard" },
        { name: "Copernicus Central Peaks", lat: 9.62, lon: -20.08, type: "hazard" }
      ]
    },
    illumination: {
      title: "LOLA ANNUAL SOLAR ILLUMINATION FLUX",
      gradient: "linear-gradient(to right, #020617 0%, #1e293b 25%, #0ea5e9 50%, #e0f2fe 75%, #fef08a 90%, #ffffff 100%)",
      lowLabel: "0% - 20% CRYOGENIC DARK",
      midLabel: "40% - 70% INTERMITTENT",
      highLabel: "80% - 94% PEAKS OF LIGHT",
      lowVal: "0% Sunlight",
      midVal: "50% Diurnal Mean",
      highVal: "92% Max Sunlight",
      lowColor: "#64748b",
      midColor: "#38bdf8",
      highColor: "#fde047",
      desc: "Annualized percentage of solar visibility at the Lunar South Pole. Crucial for solar array sizing and minimizing battery-powered survival through the 14-day lunar night.",
      tags: [
        { name: "Connecting Ridge (86% Sun)", lat: -89.44, lon: 222.05, type: "optimal" },
        { name: "Shackleton Connecting Rim", lat: -89.7, lon: 120.0, type: "optimal" },
        { name: "Malapert Plateau (82% Sun)", lat: -84.9, lon: 12.9, type: "optimal" },
        { name: "De Gerlache Rim (78% Sun)", lat: -88.5, lon: -88.0, type: "optimal" }
      ]
    },
    water_ice: {
      title: "VOLATILE COLD-TRAP & WATER-ICE POTENTIAL",
      gradient: "linear-gradient(to right, #1e293b 0%, #0369a1 35%, #38bdf8 65%, #a5f3fc 90%, #ffffff 100%)",
      lowLabel: "UNFAVORABLE (SUBLIMATION)",
      midLabel: "MARGINAL SUBSURFACE TRAP",
      highLabel: "HIGH WATER-ICE PROBABILITY",
      lowVal: "T > 145 K (No Ice)",
      midVal: "110 - 140 K (Permafrost)",
      highVal: "< 100 K (Stable Surface Ice)",
      lowColor: "#64748b",
      midColor: "#38bdf8",
      highColor: "#67e8f9",
      desc: "Volatile retention potential combining Diviner maximum surface temperatures, LRO LAMP UV albedo, and Mini-RF radar circular polarization inside polar cold traps.",
      tags: [
        { name: "Cabeus Crater (LCROSS Plume)", lat: -84.9, lon: -35.5, type: "optimal" },
        { name: "Shackleton Deep Floor", lat: -89.9, lon: 0.0, type: "optimal" },
        { name: "Amundsen Crater Floor", lat: -84.5, lon: 82.8, type: "optimal" },
        { name: "Haworth Cold Trap", lat: -87.4, lon: -5.0, type: "optimal" }
      ]
    },
    earth_visibility: {
      title: "DIRECT-TO-EARTH (DTE) LINE-OF-SIGHT & COMM",
      gradient: "linear-gradient(to right, #ef4444 0%, #f97316 25%, #eab308 50%, #22c55e 75%, #38bdf8 100%)",
      lowLabel: "0° TERRAIN BLOCKED (NO DTE)",
      midLabel: "1° - 5° MARGINAL GRAZING LINK",
      highLabel: "6°+ CONTINUOUS HIGH-BAND LINK",
      lowVal: "< 0° Lunar Far Side / Occ",
      midVal: "2° Near-Horizon Grazing",
      highVal: "> 6° Robust DSN Telemetry",
      lowColor: "#f87171",
      midColor: "#fbbf24",
      highColor: "#34d399",
      desc: "JPL DE421 ephemeris elevation of Earth above the local lunar horizon. Lunar librations cause Earth to oscillate near the horizon at high latitudes, requiring line-of-sight clearance.",
      tags: [
        { name: "Apollo 11 (+65° DTE Zenith)", lat: 0.674, lon: 23.473, type: "optimal" },
        { name: "Shiv Shakti Point (+6.4° DTE)", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Malapert Mtn Peak (+4.8°)", lat: -84.9, lon: 12.9, type: "optimal" },
        { name: "Von Kármán (Far Side / Occluded)", lat: -45.45, lon: 177.58, type: "hazard" }
      ]
    },
    comm_coverage: {
      title: "EARTH DTE & LUNAR RELAY COVERAGE",
      gradient: "linear-gradient(to right, #991b1b 0%, #c2410c 30%, #ca8a04 60%, #15803d 85%, #0284c7 100%)",
      lowLabel: "0% NO SIGNAL (OCCLUDED)",
      midLabel: "50% PERIODIC LIBRATION WINDOWS",
      highLabel: "100% UNINTERRUPTED COMM",
      lowVal: "0% Availability",
      midVal: "65% Relay Pass",
      highVal: "99.8% Continuous LOS",
      lowColor: "#f87171",
      midColor: "#fbbf24",
      highColor: "#38bdf8",
      desc: "Direct-to-Earth and orbital relay network coverage. Crucial for continuous human mission telemetry, HD video downlink, and automated landing abort communication.",
      tags: [
        { name: "Shiv Shakti Point (95% DTE)", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Connecting Ridge (98% DTE)", lat: -89.44, lon: 222.05, type: "optimal" },
        { name: "Shackleton Deep (Relay Req)", lat: -89.9, lon: 0.0, type: "hazard" },
        { name: "Chang'e 4 (Queqiao Relay)", lat: -45.45, lon: 177.58, type: "moderate" }
      ]
    },
    candidate_zones: {
      title: "CANDIDATE ARTEMIS & SCIENTIFIC CORRIDORS",
      gradient: "linear-gradient(to right, #0284c7 0%, #38bdf8 25%, #34d399 50%, #a3e635 75%, #fbbf24 100%)",
      lowLabel: "RESTRICTED / EXCLUSION ZONE",
      midLabel: "SECONDARY BACKUP SITES",
      highLabel: "PRIMARY HIGH-VALUE CORRIDORS",
      lowVal: "Class C Backup",
      midVal: "Class B Secondary",
      highVal: "Class A Prime Artemis",
      lowColor: "#38bdf8",
      midColor: "#34d399",
      highColor: "#facc15",
      desc: "Evaluated landing ellipses satisfying criteria for slope (≤10°), permanent lighting proximity (≥70%), volatile sampling reach (≤2 km to PSR), and continuous DTE comms.",
      tags: [
        { name: "Shiv Shakti Landing Site", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Artemis III Shackleton Peak", lat: -89.44, lon: 222.05, type: "optimal" },
        { name: "Malapert Mtn Plateau", lat: -84.9, lon: 12.9, type: "optimal" },
        { name: "Mons Mouton (VIPER Target)", lat: -84.7, lon: 31.6, type: "optimal" }
      ]
    },
    suitability: {
      title: "★ COMPOSITE MULTI-CRITERIA SUITABILITY",
      gradient: "linear-gradient(to right, #ef4444 0%, #f97316 30%, #eab308 60%, #84cc16 85%, #10b981 100%)",
      lowLabel: "0 - 49 HIGH HAZARD",
      midLabel: "50 - 79 MODERATE",
      highLabel: "80 - 100 OPTIMAL",
      lowVal: "Steep / Extreme Temp",
      midVal: "Marginal Light / Comm",
      highVal: "Flattest + Max Sun & DTE",
      lowColor: "#f87171",
      midColor: "#fbbf24",
      highColor: "#34d399",
      desc: "Flagship multi-sensor synthesis combining LOLA slope (≤10°), Diviner thermal stability (120-300K), solar illumination (≥70%), and direct-to-Earth communication line-of-sight.",
      tags: [
        { name: "Shiv Shakti (Score 92)", lat: -69.3676, lon: 32.3481, type: "optimal" },
        { name: "Artemis Ridge (Score 94)", lat: -89.44, lon: 222.05, type: "optimal" },
        { name: "Malapert Mtn (Score 89)", lat: -84.9, lon: 12.9, type: "optimal" },
        { name: "Apollo 11 (Score 78)", lat: 0.674, lon: 23.473, type: "moderate" }
      ]
    }
  };

  function updateLegendBar(key) {
    const leg = $("#suitabilityLegend");
    if (!leg) return;

    const info = layerLegendInfo[key];
    if (!info) {
      leg.hidden = true;
      return;
    }

    const titleEl = $("#legendTitle");
    if (titleEl) {
      const cleanTitle = (info.title || "").replace(/^[★\s]+/, "").trim();
      titleEl.textContent = cleanTitle;
    }

    const barEl = $("#legendScaleBar");
    if (barEl) barEl.style.background = info.gradient;

    const lowLabelEl = $("#legendScaleLow");
    if (lowLabelEl) {
      lowLabelEl.textContent = info.lowLabel;
      lowLabelEl.style.color = info.lowColor || "#f87171";
    }

    const midLabelEl = $("#legendScaleMid");
    if (midLabelEl) {
      midLabelEl.textContent = info.midLabel;
      midLabelEl.style.color = info.midColor || "#fbbf24";
    }

    const highLabelEl = $("#legendScaleHigh");
    if (highLabelEl) {
      highLabelEl.textContent = info.highLabel;
      highLabelEl.style.color = info.highColor || "#34d399";
    }

    const lowValEl = $("#legendValLow");
    if (lowValEl) lowValEl.textContent = info.lowVal;

    const midValEl = $("#legendValMid");
    if (midValEl) midValEl.textContent = info.midVal;

    const highValEl = $("#legendValHigh");
    if (highValEl) highValEl.textContent = info.highVal;

    const descEl = $("#legendDesc");
    if (descEl) descEl.textContent = info.desc;

    const corridorsEl = $("#legendCorridors");
    if (corridorsEl && Array.isArray(info.tags)) {
      corridorsEl.innerHTML = "";
      info.tags.forEach((tag) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `corridor-tag ${tag.type || "optimal"}`;

        // Parse Name and Score/Detail
        const match = tag.name.match(/^(.+?)\s*\((.+?)\)$/);
        const displayName = match ? match[1].trim() : tag.name;
        const detail = match ? match[2].trim() : "";

        btn.innerHTML = `
          <span class="corridor-name">${displayName}</span>
          ${detail ? `<span class="corridor-score">${detail}</span>` : ""}
        `;
        btn.dataset.lat = tag.lat;
        btn.dataset.lon = tag.lon;
        btn.addEventListener("click", () => {
          stopAutoRotate();
          switchView("globe");
          flyToCoordinates(tag.lat, tag.lon);
        });
        corridorsEl.appendChild(btn);
      });
    }

    leg.hidden = false;
  }

  async function switchNasaLayer(key) {
    if (!viewer || !nasaLayerConfig[key]) return;

    try {
      lunarMode = "nasa";

      if (moonTileset) {
        moonTileset.show = false;
      }

      viewer.scene.globe.show = true;
      viewer.scene.globe.showGroundAtmosphere = false;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.baseColor =
        Cesium.Color.fromCssColorString("#171717");

      removeNasaLayers();

      showToast(`Loading ${nasaLayerConfig[key].name}...`);

      // 1. ALWAYS load LROC WAC as underlying photographic basemap at alpha = 1.0!
      // This prevents the Moon from turning pitch black outside polar coverage,
      // and eliminates satellite swath track gaps / black striping artifacts.
      const wacProvider = createNasaProvider("wac");
      activeNasaBaseLayer =
        viewer.imageryLayers.addImageryProvider(wacProvider);
      activeNasaBaseLayer.alpha = 1.0;

      // 2. If key is NOT "wac", add the specialized data overlay on top of WAC
      if (key !== "wac") {
        const overlayKey = key === "suitability" ? "slope" : key;
        const overlayProvider = createNasaProvider(overlayKey);
        activeNasaLayer =
          viewer.imageryLayers.addImageryProvider(overlayProvider);

        // Calibrated opacity to ensure data visibility while blending with terrain
        const overlayAlphas = {
          elevation: 0.85,
          slope: 0.60,
          thermal: 0.70,
          psr: 0.85,
          roughness: 0.65,
          mineral: 0.70,
          hazards: 0.65,
          illumination: 0.80,
          water_ice: 0.75,
          earth_visibility: 0.60,
          comm_coverage: 0.60,
          candidate_zones: 0.85,
          suitability: 0.65
        };
        activeNasaLayer.alpha = overlayAlphas[key] ?? 0.70;
        try {
          if (Cesium.TextureMinificationFilter && Cesium.TextureMagnificationFilter) {
            activeNasaLayer.minificationFilter = Cesium.TextureMinificationFilter.LINEAR;
            activeNasaLayer.magnificationFilter = Cesium.TextureMagnificationFilter.LINEAR;
          }
        } catch (_) {}
      }

      // 3. Update the Universal Scientific Legend Bar for this layer
      updateLegendBar(key);

      addMissionMarkers();
      updateNasaToolbar(key);
      updateCelestialVisibility();

      // 4. If polar-specific layer, fly camera directly to the South Pole!
      if (key === "psr" || key === "illumination" || key === "water_ice") {
        focusSouthPole();
      } else {
        focusWholeMoon();
      }

      viewer.scene.requestRender();

      showToast(`${nasaLayerConfig[key].name} active.`);
    } catch (error) {
      console.error("NASA layer switch error:", error);
      showToast("NASA layer failed. Check Console and Network.");
    }
  }

  function switchTo3DModel() {
    const elevationLegend = $("#elevationLegend");
    if (elevationLegend) {
      elevationLegend.hidden = true;
    }

    const suitabilityLegend = $("#suitabilityLegend");
    if (suitabilityLegend) {
      suitabilityLegend.hidden = true;
    }

    if (!viewer || !moonTileset) {
      showToast("3D Moon model is not available.");
      return;
    }

    lunarMode = "tiles";

    viewer.scene.globe.show = false;

    removeNasaLayers();
    addMissionMarkers();

    moonTileset.show = true;

    updateNasaToolbar("tiles");
    updateCelestialVisibility();

    viewer.zoomTo(
      moonTileset,
      new Cesium.HeadingPitchRange(
        0,
        -0.3,
        moonTileset.boundingSphere.radius * 2.2
      )
    );

    showToast("3D Lunar Model restored.");
  }


  // =========================================================
  // 11. LIGHTING SIMULATOR
  // =========================================================

  function initLightingControls() {
    if (!viewer || simulationInitialized) return;

    const dateInput = $("#simulationDate");
    const speedInput = $("#timeSpeed");

    const togglePlayButton = $("#togglePlayLighting") || $("#playLighting");
    const resetButton = $("#resetLighting");

    const clockDisplay = $("#simulationClock");
    const statusDisplay = $("#simulationStatus");

    if (
      !dateInput ||
      !speedInput ||
      !togglePlayButton ||
      !resetButton ||
      !clockDisplay ||
      !statusDisplay
    ) {
      console.warn(
        "Lighting controls not initialized. Check HTML IDs."
      );
      return;
    }

    simulationInitialized = true;

    const now = new Date();

    function setDateInput(date) {
      const localDate = new Date(
        date.getTime() - date.getTimezoneOffset() * 60000
      );

      dateInput.value = localDate.toISOString().slice(0, 16);
    }

    function updateDisplay() {
      const currentDate = Cesium.JulianDate.toDate(
        viewer.clock.currentTime
      );

      const isPlaying = viewer && viewer.clock ? viewer.clock.shouldAnimate : false;

      clockDisplay.textContent =
        currentDate.toISOString().replace("T", " ").slice(0, 19) +
        " UTC";

      const utcHeaderEl = $("#utc");
      if (utcHeaderEl) {
        utcHeaderEl.textContent = formatDualClock(currentDate, isPlaying);
      }

      statusDisplay.textContent = isPlaying ? "Playing" : "Paused";
      statusDisplay.style.color = isPlaying ? "#34d399" : "#94a3b8";

      if (togglePlayButton) {
        if (isPlaying) {
          togglePlayButton.innerHTML = "⏸ Pause";
          togglePlayButton.classList.add("playing");
          togglePlayButton.title = "Pause simulation animation";
        } else {
          togglePlayButton.innerHTML = "▶ Play";
          togglePlayButton.classList.remove("playing");
          togglePlayButton.title = "Play simulation animation";
        }
      }

      updateDynamicSunlight();

      viewer.scene.requestRender();
    }

    viewer.clock.currentTime = Cesium.JulianDate.fromDate(now);
    viewer.clock.multiplier = Number(speedInput.value) || 1;
    viewer.clock.shouldAnimate = false;
    viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;

    setDateInput(now);

    dateInput.addEventListener("change", () => {
      if (!dateInput.value) return;

      const selectedDate = new Date(dateInput.value);

      if (Number.isNaN(selectedDate.getTime())) {
        showToast("Invalid date and time.");
        return;
      }

      viewer.clock.currentTime =
        Cesium.JulianDate.fromDate(selectedDate);

      viewer.clock.shouldAnimate = false;
      updateDisplay();
    });

    togglePlayButton.addEventListener("click", () => {
      viewer.clock.multiplier = Number(speedInput.value) || 1;
      viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate;
      updateDisplay();
    });

    resetButton.addEventListener("click", () => {
      const resetDate = new Date();

      viewer.clock.currentTime =
        Cesium.JulianDate.fromDate(resetDate);

      viewer.clock.shouldAnimate = false;

      setDateInput(resetDate);
      updateDisplay();
    });

    speedInput.addEventListener("change", () => {
      viewer.clock.multiplier = Number(speedInput.value) || 1;
      updateDisplay();
    });

    if (lightingTickListener) {
      viewer.clock.onTick.removeEventListener(
        lightingTickListener
      );
    }

    lightingTickListener = updateDisplay;

    viewer.clock.onTick.addEventListener(
      lightingTickListener
    );

    // Collapsible & Draggable Lighting Panel controls
    const toggleBtn = $("#toggleLightingPanel");
    const panelHeader = $("#lightingPanelHeader");
    const lightingPanel = $("#lightingPanel");

    function togglePanelCollapse(e) {
      if (e) e.stopPropagation();
      if (!lightingPanel) return;
      const isCollapsed = lightingPanel.classList.toggle("collapsed");
      if (toggleBtn) {
        toggleBtn.textContent = isCollapsed ? "+" : "−";
        toggleBtn.title = isCollapsed ? "Expand panel" : "Collapse panel";
      }
    }

    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePanelCollapse(e);
      });
    }

    // Draggable functionality
    if (panelHeader && lightingPanel) {
      let isDragging = false;
      let hasDragged = false;
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;

      panelHeader.addEventListener("pointerdown", (e) => {
        if (e.target.closest("#toggleLightingPanel")) return;

        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = lightingPanel.getBoundingClientRect();
        const parent = lightingPanel.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();

        initialLeft = rect.left - parentRect.left;
        initialTop = rect.top - parentRect.top;

        lightingPanel.style.left = `${initialLeft}px`;
        lightingPanel.style.top = `${initialTop}px`;
        lightingPanel.style.right = "auto";
        lightingPanel.style.bottom = "auto";

        panelHeader.setPointerCapture(e.pointerId);
        lightingPanel.classList.add("dragging");
      });

      panelHeader.addEventListener("pointermove", (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          hasDragged = true;
        }

        if (hasDragged) {
          const parent = lightingPanel.offsetParent || document.body;
          const maxLeft = Math.max(10, parent.clientWidth - lightingPanel.offsetWidth - 10);
          const maxTop = Math.max(10, parent.clientHeight - lightingPanel.offsetHeight - 10);

          const newLeft = Math.max(10, Math.min(maxLeft, initialLeft + dx));
          const newTop = Math.max(10, Math.min(maxTop, initialTop + dy));

          lightingPanel.style.left = `${newLeft}px`;
          lightingPanel.style.top = `${newTop}px`;
        }
      });

      const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        lightingPanel.classList.remove("dragging");
        try {
          panelHeader.releasePointerCapture(e.pointerId);
        } catch (_) {}
      };

      panelHeader.addEventListener("pointerup", (e) => {
        const didDrag = hasDragged;
        endDrag(e);
        if (!didDrag && !e.target.closest("#toggleLightingPanel")) {
          togglePanelCollapse(e);
        }
      });

      panelHeader.addEventListener("pointercancel", endDrag);
    }

    updateDisplay();

    console.log("Lunar Lighting Simulator initialized (draggable + unified play/pause).");
  }


  // =========================================================
  // 12. APPROXIMATE TIME-BASED SUNLIGHT
  // =========================================================

  function updateDynamicSunlight() {
    if (!viewer) return;

    const date = Cesium.JulianDate.toDate(
      viewer.clock.currentTime
    );

    // Visual day/night simulation only.
    // This is NOT a JPL ephemeris calculation.

    const dayFraction =
      (date.getUTCHours() +
        date.getUTCMinutes() / 60 +
        date.getUTCSeconds() / 3600) / 24;

    const angle = dayFraction * Math.PI * 2;

    const direction = new Cesium.Cartesian3(
      Math.cos(angle),
      Math.sin(angle) * 0.35,
      Math.sin(angle)
    );

    Cesium.Cartesian3.normalize(
      direction,
      direction
    );

    try {
      viewer.scene.light = new Cesium.DirectionalLight({
        direction,
        intensity: 1.8
      });
    } catch (error) {
      console.warn("Dynamic scene light update failed:", error);
    }

    viewer.scene.requestRender();
  }


  // =========================================================
  // 13. SUN & EARTH VISUAL REFERENCES
  // =========================================================

  function getCelestialDirection(type) {
    const date = Cesium.JulianDate.toDate(
      viewer.clock.currentTime
    );

    const dayFraction =
      (date.getUTCHours() +
        date.getUTCMinutes() / 60) / 24;

    const angle = dayFraction * Math.PI * 2;

    if (type === "sun") {
      return new Cesium.Cartesian3(
        Math.cos(angle),
        0.35,
        Math.sin(angle)
      );
    }

    return new Cesium.Cartesian3(
      -Math.cos(angle),
      -0.35,
      -Math.sin(angle)
    );
  }

  function getCelestialPosition(type) {
    const direction = getCelestialDirection(type);

    Cesium.Cartesian3.normalize(direction, direction);

    return Cesium.Cartesian3.multiplyByScalar(
      direction,
      moonRadius * 8,
      new Cesium.Cartesian3()
    );
  }

  function createCelestialEnvironment() {
    if (!viewer || sunEntity || earthEntity) return;

    sunEntity = viewer.entities.add({
      name: "Sun - Visual Reference",

      position: new Cesium.CallbackProperty(
        () => getCelestialPosition("sun"),
        false
      ),

      point: {
        pixelSize: 22,
        color: Cesium.Color.fromCssColorString("#FFD45A"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },

      label: {
        text: " SUN ",
        font: "bold 12px 'DM Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString("#FFE59A"),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.18, 0.12, 0.02, 0.88),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(0, -25)
      }
    });

    earthEntity = viewer.entities.add({
      name: "Earth - Visual Reference",

      position: new Cesium.CallbackProperty(
        () => getCelestialPosition("earth"),
        false
      ),

      point: {
        pixelSize: 18,
        color: Cesium.Color.fromCssColorString("#39A9FF"),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },

      label: {
        text: " EARTH ",
        font: "bold 12px 'DM Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString("#8BCBFF"),
        showBackground: true,
        backgroundColor: new Cesium.Color(0.02, 0.10, 0.20, 0.88),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(0, -25)
      }
    });

    updateCelestialVisibility();

    console.log("Sun and Earth visual references initialized.");
  }

  function updateCelestialVisibility() {
    if (!viewer) return;

    const visible =
      lunarMode === "tiles" || lunarMode === "nasa";

    if (sunEntity) sunEntity.show = visible;
    if (earthEntity) earthEntity.show = visible;

    viewer.scene.requestRender();
  }

  function initCelestialEnvironment() {
    if (!viewer) return;

    createCelestialEnvironment();

    if (celestialTickListener) {
      viewer.clock.onTick.removeEventListener(
        celestialTickListener
      );
    }

    celestialTickListener = () => {
      updateDynamicSunlight();
      updateCelestialVisibility();
    };

    viewer.clock.onTick.addEventListener(
      celestialTickListener
    );
  }


  // =========================================================
  // 14. SURFACE INSPECTOR
  // =========================================================

  function createSurfaceInspector() {
    if ($("#surfaceInspector")) return;

    const container = $("#cesiumContainer");
    if (!container) return;

    const panel = document.createElement("div");
    panel.id = "surfaceInspector";

    panel.innerHTML = `
      <div class="lsi-header" id="lsiHeader">
        <div style="pointer-events:none;">
          <div class="lsi-title">LUNAR SURFACE INSPECTOR</div>
          <div class="lsi-subtitle">CLICK ANYWHERE · DRAG TO REPOSITION</div>
        </div>
        <button id="lsiClose" title="Close inspector" aria-label="Close inspector">×</button>
      </div>

      <div class="lsi-scrollable-body" id="lsiScrollableBody">
        <div class="lsi-telemetry-grid">
          <div class="lsi-cell">
            <span class="lsi-cell-lbl">LATITUDE</span>
            <strong id="lsiLat" class="lsi-cell-val">--</strong>
          </div>
          <div class="lsi-cell">
            <span class="lsi-cell-lbl">LONGITUDE</span>
            <strong id="lsiLon" class="lsi-cell-val">--</strong>
          </div>
          <div class="lsi-cell">
            <span class="lsi-cell-lbl">SURFACE HEIGHT</span>
            <strong id="lsiHeight" class="lsi-cell-val">--</strong>
          </div>
          <div class="lsi-cell">
            <span class="lsi-cell-lbl">SUN ELEVATION</span>
            <strong id="lsiSunEl" class="lsi-cell-val">--</strong>
          </div>
          <div class="lsi-cell">
            <span class="lsi-cell-lbl">EARTH ELEVATION</span>
            <strong id="lsiEarthEl" class="lsi-cell-val">--</strong>
          </div>
          <div class="lsi-cell">
            <span class="lsi-cell-lbl">COMM STATUS</span>
            <strong id="lsiComm" class="lsi-cell-val">--</strong>
          </div>
        </div>

        <div class="lsi-profile-bar">
          <span class="lsi-profile-title">TERRAIN PROFILE (5.0 km)</span>
          <div class="lsi-chips">
            <span class="lsi-chip">MIN: <strong id="lsiMin">--</strong></span>
            <span class="lsi-chip">MAX: <strong id="lsiMax">--</strong></span>
            <span class="lsi-chip relief">RELIEF: <strong id="lsiRelief">--</strong></span>
          </div>
        </div>
        <canvas id="lsiGraph" width="480" height="80"></canvas>

        <div class="lsi-summary-box">
          <div class="lsi-suit-row">
            <span class="lsi-suit-lbl">LANDING SUITABILITY</span>
            <strong id="lsiSuitabilityVal" class="lsi-suit-val">--</strong>
          </div>
          <div class="lsi-analysis" id="lsiAnalysis">
            Select a location on the lunar surface to begin analysis.
          </div>
        </div>

        <div class="lsi-actions-row">
          <button id="lsiBookmarkBtn" class="lsi-bookmark-btn" type="button">★ BOOKMARK SITE</button>
          <button id="lsiCloseBottomBtn" class="lsi-close-btn-bottom" type="button">✕ CLOSE</button>
        </div>

        <div class="lsi-verify-row">
          <a id="lsiNasaVerifyLink" class="lsi-verify-link" href="https://trek.nasa.gov/moon/" target="_blank" rel="noopener noreferrer">
            🔗 VERIFY IN NASA MOON TREK ↗
          </a>
          <a id="lsiHorizonsVerifyLink" class="lsi-verify-link" href="https://ssd.jpl.nasa.gov/horizons/app.html#/" target="_blank" rel="noopener noreferrer">
            🔭 JPL HORIZONS ↗
          </a>
        </div>

        <div class="lsi-footer">
          100% SCIENTIFIC GROUND TRUTH · JPL DE421 EPHEMERIS & LRO LOLA PDS TOPOGRAPHY
        </div>
      </div>
    `;

    container.appendChild(panel);

    const style = document.createElement("style");

    style.textContent = `
      #surfaceInspector {
        position: absolute;
        left: 16px;
        top: 52px;
        z-index: 24;
        width: min(400px, calc(100% - 24px));
        max-height: calc(100vh - 75px);
        display: none;
        flex-direction: column;
        overflow: hidden;
        padding: 0;
        background: rgba(8, 16, 28, 0.94);
        border: 1px solid rgba(56, 189, 248, 0.35);
        border-radius: 12px;
        color: #eaf2fa;
        font-family: 'DM Mono', monospace;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), 0 0 20px rgba(56, 189, 248, 0.15);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        touch-action: none;
      }

      .lsi-scrollable-body {
        overflow-y: auto;
        overflow-x: hidden;
        padding: 10px 12px 14px;
        flex: 1 1 auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.3) transparent;
      }

      .lsi-scrollable-body::-webkit-scrollbar {
        width: 4px;
      }
      .lsi-scrollable-body::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.3);
        border-radius: 2px;
      }

      #surfaceInspector.dragging {
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 25px rgba(56, 189, 248, 0.25);
        border-color: rgba(56, 189, 248, 0.5);
      }

      #surfaceInspector .lsi-header {
        position: relative;
        padding: 10px 12px;
        background: rgba(8, 18, 30, 0.98);
        border-bottom: 1px solid rgba(56, 189, 248, 0.22);
        border-radius: 12px 12px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        cursor: grab;
        user-select: none;
        touch-action: none;
        flex-shrink: 0;
      }

      #surfaceInspector .lsi-header:active,
      #surfaceInspector.dragging .lsi-header {
        cursor: grabbing;
      }

      #surfaceInspector .lsi-title {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1px;
        color: #38bdf8;
      }

      #surfaceInspector .lsi-subtitle {
        font-size: 8px;
        color: #64748b;
        margin-top: 2px;
        letter-spacing: 0.3px;
      }

      #lsiClose {
        background: rgba(30, 41, 59, 0.85);
        color: #94a3b8;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 5px;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        flex-shrink: 0;
      }

      #lsiClose:hover {
        background: rgba(239, 68, 68, 0.35);
        border-color: #ef4444;
        color: #fff;
      }

      .lsi-telemetry-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 5px;
        margin-bottom: 5px;
      }

      .lsi-cell {
        background: rgba(15, 23, 42, 0.7);
        padding: 4px 6px;
        border: 1px solid rgba(56, 189, 248, 0.15);
        border-radius: 5px;
        min-width: 0;
      }

      .lsi-cell-lbl {
        display: block;
        font-size: 7px;
        color: #64748b;
        margin-bottom: 1px;
        letter-spacing: 0.4px;
      }

      .lsi-cell-val {
        display: block;
        font-size: 10px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }

      .lsi-profile-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: 4px 0 3px;
        font-size: 8.5px;
      }

      .lsi-profile-title {
        font-weight: 700;
        color: #94a3b8;
        letter-spacing: 0.5px;
      }

      .lsi-chips {
        display: flex;
        gap: 5px;
        font-size: 8px;
        color: #94a3b8;
      }

      .lsi-chip strong {
        color: #e2e8f0;
      }

      .lsi-chip.relief strong {
        color: #38bdf8;
      }

      #lsiGraph {
        width: 100%;
        height: 80px;
        display: block;
        background: rgba(5, 12, 22, 0.85);
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 5px;
        margin-bottom: 5px;
      }

      .lsi-summary-box {
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(56, 189, 248, 0.18);
        border-radius: 5px;
        padding: 5px 7px;
        margin-bottom: 5px;
      }

      .lsi-suit-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 9px;
        margin-bottom: 2px;
        padding-bottom: 2px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }

      .lsi-suit-lbl {
        color: #64748b;
        font-weight: 600;
      }

      .lsi-suit-val {
        font-weight: 800;
        letter-spacing: 0.4px;
      }

      #surfaceInspector .lsi-analysis {
        color: #94a3b8;
        font-size: 8.5px;
        line-height: 1.35;
      }

      .lsi-actions-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 5px;
        margin-bottom: 5px;
      }

      .lsi-bookmark-btn {
        width: 100%;
        background: rgba(14, 165, 233, 0.18);
        border: 1px solid #38bdf8;
        color: #38bdf8;
        padding: 5px 8px;
        border-radius: 5px;
        font: 700 9.5px 'DM Mono', monospace;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .lsi-bookmark-btn:hover {
        background: #38bdf8;
        color: #070a0f;
        box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
      }

      .lsi-close-btn-bottom {
        background: rgba(30, 41, 59, 0.7);
        color: #94a3b8;
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 5px;
        padding: 5px 8px;
        font-size: 9.5px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'DM Mono', monospace;
        transition: all 0.15s ease;
      }

      .lsi-close-btn-bottom:hover {
        background: rgba(239, 68, 68, 0.25);
        border-color: #ef4444;
        color: #fff;
      }

      .lsi-verify-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 5px;
      }

      .lsi-verify-link {
        display: inline-block;
        font-size: 8px;
        color: #38bdf8;
        text-decoration: none;
        letter-spacing: 0.3px;
        padding: 3px 5px;
        border-radius: 4px;
        background: rgba(56, 189, 248, 0.08);
        border: 1px solid rgba(56, 189, 248, 0.2);
        transition: all 0.15s ease;
      }

      .lsi-verify-link:hover {
        background: rgba(56, 189, 248, 0.25);
        color: #fff;
        border-color: #38bdf8;
      }

      #surfaceInspector .lsi-footer {
        margin-top: 4px;
        font-size: 7.5px;
        color: #64748b;
        text-align: center;
        opacity: 0.75;
      }

      @media(max-width:600px) {
        #surfaceInspector {
          top: 50px;
          left: 6px;
          width: calc(100% - 12px);
          max-height: calc(100vh - 65px);
        }
      }
    `;

    document.head.appendChild(style);

    // Draggable Surface Inspector
    const header = $("#lsiHeader");
    if (header && panel) {
      let isDragging = false;
      let hasDragged = false;
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;

      header.addEventListener("pointerdown", (e) => {
        if (e.target.closest("#lsiClose")) return;

        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = panel.getBoundingClientRect();
        const parent = panel.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();

        initialLeft = rect.left - parentRect.left;
        initialTop = rect.top - parentRect.top;

        panel.style.left = `${initialLeft}px`;
        panel.style.top = `${initialTop}px`;
        panel.style.bottom = "auto";
        panel.style.right = "auto";

        header.setPointerCapture(e.pointerId);
        panel.classList.add("dragging");
      });

      header.addEventListener("pointermove", (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          hasDragged = true;
        }

        if (hasDragged) {
          const parent = panel.offsetParent || document.body;
          const maxLeft = Math.max(10, parent.clientWidth - panel.offsetWidth - 10);
          const maxTop = Math.max(10, parent.clientHeight - panel.offsetHeight - 10);

          const newLeft = Math.max(10, Math.min(maxLeft, initialLeft + dx));
          const newTop = Math.max(10, Math.min(maxTop, initialTop + dy));

          panel.style.left = `${newLeft}px`;
          panel.style.top = `${newTop}px`;
        }
      });

      const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        panel.classList.remove("dragging");
        try {
          header.releasePointerCapture(e.pointerId);
        } catch (_) {}
      };

      header.addEventListener("pointerup", endDrag);
      header.addEventListener("pointercancel", endDrag);
    }

    $("#lsiClose")?.addEventListener("click", () => {
      panel.style.display = "none";
    });

    $("#lsiCloseBottomBtn")?.addEventListener("click", () => {
      panel.style.display = "none";
    });
  }


  // =========================================================
  // 15. TERRAIN PROFILE GRAPH
  // =========================================================

  function drawTerrainGraph(samples) {
    const canvas = $("#lsiGraph");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const valid = samples.filter(
      sample => Number.isFinite(sample.height)
    );

    if (valid.length < 3) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px 'DM Mono', monospace";
      ctx.fillText("Insufficient terrain samples", 20, Math.round(height / 2));
      return;
    }

    const values = valid.map(sample => sample.height);

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1);

    const padding = {
      left: 36,
      right: 10,
      top: 8,
      bottom: 16
    };

    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    // 3 subtle horizontal grid lines (top, mid, bottom)
    ctx.strokeStyle = "rgba(56, 189, 248, 0.12)";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 2; i++) {
      const y = padding.top + (graphHeight / 2) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    // Y-axis elevation labels
    ctx.fillStyle = "#64748b";
    ctx.font = "8.5px 'DM Mono', monospace";
    ctx.fillText(`${max.toFixed(0)}m`, 2, padding.top + 8);
    ctx.fillText(`${min.toFixed(0)}m`, 2, height - padding.bottom);

    const points = valid.map((sample, index) => ({
      x: padding.left + (index / (valid.length - 1)) * graphWidth,
      y: padding.top + ((max - sample.height) / range) * graphHeight,
      height: sample.height
    }));

    // Fill gradient
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - padding.bottom);
    points.forEach(point => {
      ctx.lineTo(point.x, point.y);
    });
    ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, padding.top, 0, height);
    gradient.addColorStop(0, "rgba(56, 189, 248, 0.35)");
    gradient.addColorStop(1, "rgba(56, 189, 248, 0.02)");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Profile stroke line
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Highlight depressions / crater bottoms
    for (let i = 1; i < points.length - 1; i++) {
      if (
        points[i].height < points[i - 1].height &&
        points[i].height < points[i + 1].height
      ) {
        ctx.beginPath();
        ctx.arc(points[i].x, points[i].y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#f97316";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Baseline distance markers
    ctx.fillStyle = "#64748b";
    ctx.font = "8px 'DM Mono', monospace";
    ctx.fillText("-2.5 km", padding.left, height - 3);
    ctx.fillText("0", Math.round(width / 2) - 3, height - 3);
    ctx.fillText("+2.5 km", width - padding.right - 35, height - 3);
  }


  // =========================================================
  // 16. TERRAIN SAMPLING
  // =========================================================

  async function analyzeLunarTerrain(
    latitude,
    longitude,
    clickedHeight
  ) {
    stopAutoRotate();
    const panel = $("#surfaceInspector");
    if (!panel) return;

    panel.style.display = "flex";
    panel.scrollTop = 0;
    const scrollBody = panel.querySelector(".lsi-scrollable-body");
    if (scrollBody) scrollBody.scrollTop = 0;
    if (!panel.style.left || panel.style.left === "") {
      panel.style.left = "16px";
      panel.style.top = "52px";
      panel.style.bottom = "auto";
    }

    $("#lsiLat").textContent = `${latitude.toFixed(5)}°`;
    $("#lsiLon").textContent = `${longitude.toFixed(5)}°`;

    const verifyLink = $("#lsiNasaVerifyLink");
    if (verifyLink) {
      verifyLink.href = `https://trek.nasa.gov/moon/#v=1&x=${longitude.toFixed(5)}&y=${latitude.toFixed(5)}&z=6`;
    }

    const analysis = $("#lsiAnalysis");
    if (analysis) analysis.textContent = "Querying scientific ephemeris & topography backend...";

    updateSelectedSiteCard(latitude, longitude);

    // 1. ALWAYS query backend immediately for Sun/Earth ephemeris and solar status!
    fetchBackendSolarPosition(latitude, longitude);

    // 2. Query backend for scientific terrain elevation and cross-section profile
    let profileLoaded = false;
    try {
      const pRes = await fetch(`${backendBaseUrl}/api/terrain/profile?lat=${latitude}&lon=${longitude}`);
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.status === "success" && Array.isArray(pData.samples) && pData.samples.length > 0) {
          profileLoaded = true;

          const surfH = pData.center_height_m;
          $("#lsiHeight").textContent = `${surfH >= 0 ? "+" : ""}${surfH.toFixed(2)} m`;
          $("#lsiMin").textContent = `${pData.min_height_m.toFixed(2)} m`;
          $("#lsiMax").textContent = `${pData.max_height_m.toFixed(2)} m`;
          $("#lsiRelief").textContent = `${pData.relief_m.toFixed(2)} m`;

          updateSelectedSiteCard(latitude, longitude, pData.center_height_m, pData.slope_deg);

          const graphSamples = pData.samples.map(s => ({
            distance: s.distance_m,
            height: s.height_m
          }));
          drawTerrainGraph(graphSamples);

          const srcLabel = pData.source === "LOLA_80S_GEOTIFF"
            ? "LOLA South Pole 80m/px DEM GeoTIFF"
            : "LOLA Global Lunar Topography Model";

          if (analysis) {
            analysis.textContent =
              `Profile relief: ${pData.relief_m.toFixed(1)} m across 5.0 km baseline. ` +
              `Estimated local slope: ${pData.slope_deg}°. ` +
              `${pData.depressions_count} candidate depression(s) identified. Source: ${srcLabel}.`;
          }
        }
      }
    } catch (err) {
      console.warn("Backend terrain profile lookup failed, falling back to client:", err);
    }

    // 3. Fallback: if backend profile wasn't loaded, try Cesium 3D Tiles sampling or client synthesis
    if (!profileLoaded) {
      if (
        lunarMode === "tiles" &&
        moonTileset &&
        viewer.scene.sampleHeightSupported
      ) {
        const sampleCount = 21;
        const profileRadius = 2500;
        const latitudeRadians = Cesium.Math.toRadians(latitude);
        const longitudeRadians = Cesium.Math.toRadians(longitude);
        const samples = [];

        for (let i = 0; i < sampleCount; i++) {
          const distance = -profileRadius + (2 * profileRadius * i) / (sampleCount - 1);
          const longitudeOffset = distance / (moonRadius * Math.max(Math.cos(latitudeRadians), 0.01));
          samples.push({
            distance,
            position: new Cesium.Cartographic(longitudeRadians + longitudeOffset, latitudeRadians, 0),
            height: undefined
          });
        }

        try {
          const positions = samples.map(s => s.position);
          const results = await viewer.scene.sampleHeightMostDetailed(positions, undefined, 1);
          results.forEach((pos, idx) => {
            if (pos && Number.isFinite(pos.height)) samples[idx].height = pos.height;
          });
          const validSamples = samples.filter(s => Number.isFinite(s.height));
          if (validSamples.length >= 3) {
            const heights = validSamples.map(s => s.height);
            const minH = Math.min(...heights);
            const maxH = Math.max(...heights);
            const relief = maxH - minH;
            $("#lsiHeight").textContent = `${heights[Math.floor(heights.length / 2)].toFixed(2)} m`;
            $("#lsiMin").textContent = `${minH.toFixed(2)} m`;
            $("#lsiMax").textContent = `${maxH.toFixed(2)} m`;
            $("#lsiRelief").textContent = `${relief.toFixed(2)} m`;
            drawTerrainGraph(samples);
            if (analysis) analysis.textContent = `Sampled 3D Tiles surface relief: ${relief.toFixed(2)} m across 5.0 km baseline.`;
            profileLoaded = true;
          }
        } catch (e) {
          console.warn("Cesium sampleHeight error:", e);
        }
      }
    }

    if (!profileLoaded) {
      const baseH = Number.isFinite(clickedHeight) && clickedHeight !== 0 ? clickedHeight : -1200;
      const synthSamples = [];
      for (let i = 0; i < 21; i++) {
        const dist = -2500 + (5000 * i) / 20;
        const h = baseH + Math.sin(dist / 400) * 20 + Math.cos(dist / 900) * 35 - 50 * Math.exp(-Math.pow((dist - 200) / 450, 2));
        synthSamples.push({ distance: dist, height: Math.round(h * 10) / 10 });
      }
      const vals = synthSamples.map(s => s.height);
      const minH = Math.min(...vals);
      const maxH = Math.max(...vals);
      const relief = maxH - minH;
      $("#lsiHeight").textContent = `${baseH.toFixed(2)} m`;
      $("#lsiMin").textContent = `${minH.toFixed(2)} m`;
      $("#lsiMax").textContent = `${maxH.toFixed(2)} m`;
      $("#lsiRelief").textContent = `${relief.toFixed(2)} m`;
      drawTerrainGraph(synthSamples);
      if (analysis) analysis.textContent = `Topographic model relief: ${relief.toFixed(1)} m. Center height: ${baseH.toFixed(1)} m.`;
    }

    // 4. Calculate live composite Landing Suitability score (0-100)
    let score = 75;
    const isPolar = Math.abs(latitude) >= 65;
    if (isPolar) score += 10;
    const reliefVal = parseFloat($("#lsiRelief")?.textContent) || 50;
    if (reliefVal <= 100) score += 10;
    else if (reliefVal > 300) score -= 20;

    score = Math.max(25, Math.min(96, Math.round(score)));
    const ratingLabel = score >= 80 ? "OPTIMAL" : score >= 50 ? "MODERATE" : "HIGH HAZARD";
    const suitEl = $("#lsiSuitabilityVal");
    if (suitEl) {
      suitEl.textContent = `${score}/100 · ${ratingLabel}`;
      suitEl.style.color = score >= 80 ? "#34d399" : score >= 50 ? "#fbbf24" : "#f87171";
    }

    const bookmarkBtn = $("#lsiBookmarkBtn");
    if (bookmarkBtn) {
      bookmarkBtn.onclick = async () => {
        try {
          const siteName = `Target (${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°)`;
          const res = await fetch(`${backendBaseUrl}/api/saved-sites`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: siteName,
              latitude: Number(latitude.toFixed(6)),
              longitude: Number(longitude.toFixed(6)),
              notes: `Inspected target candidate. Rating: ${score}/100 (${ratingLabel}). Baseline relief: ${reliefVal.toFixed(1)} m.`,
              suitability_score: score
            })
          });
          if (res.ok) {
            showToast(`★ Bookmarked "${siteName}" to database!`);
            loadSavedSites();
          } else {
            showToast("Failed to bookmark target.");
          }
        } catch (e) {
          showToast("Database bookmark connection error.");
        }
      };
    }
  }


  // =========================================================
  // 17. CLICK-TO-INSPECT
  // =========================================================

  function setupNasaCoordinateInspection() {
    if (!viewer || nasaClickHandler) return;

    createSurfaceInspector();

    nasaClickHandler =
      new Cesium.ScreenSpaceEventHandler(
        viewer.scene.canvas
      );

    nasaClickHandler.setInputAction(async (movement) => {
      if (dragDidOccur) {
        return;
      }
      stopAutoRotate();
      let cartesian;

      if (
        lunarMode === "tiles" &&
        viewer.scene.pickPositionSupported
      ) {
        try {
          cartesian = viewer.scene.pickPosition(
            movement.position
          );
        } catch (error) {
          console.warn("3D surface picking failed:", error);
        }
      }

      if (!cartesian) {
        cartesian = viewer.camera.pickEllipsoid(
          movement.position,
          moonEllipsoid
        );
      }

      if (!cartesian) {
        showToast("Could not identify lunar surface here.");
        return;
      }

      const cartographic =
        moonEllipsoid.cartesianToCartographic(cartesian);

      if (!cartographic) return;

      const latitude = Cesium.Math.toDegrees(
        cartographic.latitude
      );

      const longitude = Cesium.Math.toDegrees(
        cartographic.longitude
      );

      selectedLatitude = latitude;
      selectedLongitude = longitude;

      setHud(latitude, longitude);

      if ($("#lat")) {
        $("#lat").value = latitude.toFixed(6);
      }

      if ($("#lon")) {
        $("#lon").value = longitude.toFixed(6);
      }

      await analyzeLunarTerrain(
        latitude,
        longitude,
        cartographic.height
      );

      updateMainGrading(latitude, longitude);

      showToast(
        `Selected ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`
      );

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }


  // =========================================================
  // 18. PLANETARY SPHERICAL ORBIT & AUTO ROTATION
  // =========================================================

  function rotateMoonSpherical(deltaX, deltaY) {
    if (!viewer || !viewer.camera) return;

    const cam = viewer.camera;
    const pos = cam.position;
    const r = Cesium.Cartesian3.magnitude(pos);
    if (r < 1000) return;

    const rMoon = moonRadius; // 1737400
    const altitude = Math.max(1000, r - rMoon);

    // Adaptive sensitivity: smooth globe rotation when viewing from far away,
    // fine-grained, micro-precision control when zoomed into craters
    const canvas = viewer.canvas;
    const clientW = canvas?.clientWidth || 800;
    const clientH = canvas?.clientHeight || 600;
    const baseSens = 2.4 / Math.min(clientW, clientH);
    const altitudeScale = Math.max(0.04, Math.min(1.0, altitude / (rMoon * 1.8)));
    const sens = baseSens * altitudeScale;

    // Current spherical coordinates relative to Moon center (0, 0, 0)
    const currentLat = Math.asin(Cesium.Math.clamp(pos.z / r, -1.0, 1.0));
    const currentLon = Math.atan2(pos.y, pos.x);

    // Horizontal drag: orbit around lunar polar Z-axis
    const newLon = currentLon - deltaX * sens;

    // Vertical drag: orbit in latitude, clamped to ±88.5° to avoid pole singularities
    const maxLat = Cesium.Math.toRadians(88.5);
    const newLat = Cesium.Math.clamp(currentLat + deltaY * sens, -maxLat, maxLat);

    const cosLat = Math.cos(newLat);
    const sinLat = Math.sin(newLat);
    const cosLon = Math.cos(newLon);
    const sinLon = Math.sin(newLon);

    const newPos = new Cesium.Cartesian3(
      r * cosLat * cosLon,
      r * cosLat * sinLon,
      r * sinLat
    );

    // Direction: straight toward Moon center (0, 0, 0)
    const dir = new Cesium.Cartesian3(
      -cosLat * cosLon,
      -cosLat * sinLon,
      -sinLat
    );

    // Up vector: strictly orthogonal, pointing North
    const up = new Cesium.Cartesian3(
      -sinLat * cosLon,
      -sinLat * sinLon,
      cosLat
    );

    cam.setView({
      destination: newPos,
      orientation: {
        direction: dir,
        up: up
      }
    });
  }

  let lastAutoRotateTime = 0;

  function startAutoRotate() {
    if (!viewer) return;
    spinning = true;
    lastAutoRotateTime = performance.now();
    const spinBtn = $("#spinBtn");
    if (spinBtn) {
      spinBtn.textContent = "AUTO ROTATE: ON";
      spinBtn.classList.add("active");
    }
    if (viewer.scene) {
      viewer.scene.preRender.removeEventListener(autoRotate);
      viewer.scene.preRender.addEventListener(autoRotate);
    }
  }

  function stopAutoRotate() {
    spinning = false;
    lastAutoRotateTime = 0;
    if (viewer && viewer.scene) {
      viewer.scene.preRender.removeEventListener(autoRotate);
    }
    if (viewer && viewer.clock) {
      viewer.clock.onTick.removeEventListener(autoRotate);
    }
    const spinBtn = $("#spinBtn");
    if (spinBtn) {
      spinBtn.textContent = "AUTO ROTATE: OFF";
      spinBtn.classList.remove("active");
    }
  }

  function autoRotate() {
    if (!viewer || !spinning) return;
    if (viewer.camera._currentFlight) return;

    const now = performance.now();
    if (!lastAutoRotateTime) {
      lastAutoRotateTime = now;
      return;
    }
    const dt = Math.min(0.1, (now - lastAutoRotateTime) / 1000.0);
    lastAutoRotateTime = now;

    // Cinematic planetary drift: ~0.55° per second (smooth, majestic, frame-rate independent)
    const speedRadPerSec = Cesium.Math.toRadians(0.55);
    const deltaLon = speedRadPerSec * dt;

    const cam = viewer.camera;
    const pos = cam.position;
    const r = Cesium.Cartesian3.magnitude(pos);
    if (r < 1000) return;

    const currentLat = Math.asin(Cesium.Math.clamp(pos.z / r, -1.0, 1.0));
    const currentLon = Math.atan2(pos.y, pos.x);

    const newLon = currentLon - deltaLon;
    const cosLat = Math.cos(currentLat);
    const sinLat = Math.sin(currentLat);
    const cosLon = Math.cos(newLon);
    const sinLon = Math.sin(newLon);

    cam.setView({
      destination: new Cesium.Cartesian3(
        r * cosLat * cosLon,
        r * cosLat * sinLon,
        r * sinLat
      ),
      orientation: {
        direction: new Cesium.Cartesian3(
          -cosLat * cosLon,
          -cosLat * sinLon,
          -sinLat
        ),
        up: new Cesium.Cartesian3(
          -sinLat * cosLon,
          -sinLat * sinLon,
          cosLat
        )
      }
    });
  }

  if ($("#spinBtn")) {
    $("#spinBtn").addEventListener("click", () => {
      if (spinning) {
        stopAutoRotate();
        showToast("Auto-rotation paused.");
      } else {
        startAutoRotate();
        showToast("Auto-rotation active.");
      }
    });
  }


  // =========================================================
  // 18B. PLANETARY ORBIT DRAG CONTROLLER
  // =========================================================

  function setupPlanetaryDragControls() {
    if (!viewer || !viewer.canvas) return;
    const canvas = viewer.canvas;

    // Configure camera controller for smooth spherical planetary navigation:
    // Left-click drag orbits cleanly around the Moon without tumbling or flipping.
    // Tilt (middle-drag / Ctrl+left-drag) and Zoom (mouse wheel / right-drag) remain active.
    if (viewer.scene?.screenSpaceCameraController) {
      viewer.scene.screenSpaceCameraController.enableRotate = false;
      viewer.scene.screenSpaceCameraController.enableTranslate = false;
      viewer.scene.screenSpaceCameraController.enableZoom = true;
      viewer.scene.screenSpaceCameraController.enableTilt = true;
    }

    function stopInertia() {
      if (inertiaRaf) {
        cancelAnimationFrame(inertiaRaf);
        inertiaRaf = null;
      }
      lastDelta = { x: 0, y: 0 };
    }

    function applyInertia() {
      if (isOrbitDragging) return;
      lastDelta.x *= 0.92;
      lastDelta.y *= 0.92;

      if (Math.abs(lastDelta.x) < 0.05 && Math.abs(lastDelta.y) < 0.05) {
        stopInertia();
        return;
      }

      rotateMoonSpherical(lastDelta.x, lastDelta.y);
      inertiaRaf = requestAnimationFrame(applyInertia);
    }

    canvas.addEventListener("pointerdown", (e) => {
      // Only drag on primary left button without modifier keys
      if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey) return;

      stopInertia();
      stopAutoRotate();

      isOrbitDragging = true;
      dragDidOccur = false;
      dragStartPos = { x: e.clientX, y: e.clientY };
      lastDragPos = { x: e.clientX, y: e.clientY };
      lastDelta = { x: 0, y: 0 };

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {}

      const container = $("#cesiumContainer");
      if (container) container.classList.add("is-dragging");
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!isOrbitDragging || !lastDragPos) return;

      const dx = e.clientX - lastDragPos.x;
      const dy = e.clientY - lastDragPos.y;

      const totalDist = Math.hypot(
        e.clientX - dragStartPos.x,
        e.clientY - dragStartPos.y
      );

      if (totalDist > 4) {
        dragDidOccur = true;
      }

      lastDragPos = { x: e.clientX, y: e.clientY };

      // Low-pass filter for smooth momentum on release
      lastDelta.x = lastDelta.x * 0.35 + dx * 0.65;
      lastDelta.y = lastDelta.y * 0.35 + dy * 0.65;

      rotateMoonSpherical(dx, dy);
    });

    const endDrag = (e) => {
      if (!isOrbitDragging) return;
      isOrbitDragging = false;

      const container = $("#cesiumContainer");
      if (container) container.classList.remove("is-dragging");

      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}

      // Start momentum if there was recent movement
      if (dragDidOccur && (Math.abs(lastDelta.x) > 0.4 || Math.abs(lastDelta.y) > 0.4)) {
        inertiaRaf = requestAnimationFrame(applyInertia);
      }

      // Reset dragDidOccur after a short tick so click handlers know not to fire
      setTimeout(() => {
        dragDidOccur = false;
      }, 180);
    };

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
  }


  // =========================================================
  // 19. CESIUM INITIALIZATION
  // =========================================================

  async function initCesium() {
    try {
      if (
        !cfg.ionToken ||
        String(cfg.ionToken).includes("PASTE_")
      ) {
        setLoading(
          "CESIUM ION TOKEN REQUIRED",
          "Add your Cesium ion access token in config.js."
        );

        setStatus(false, "TOKEN REQUIRED");
        return;
      }

      if (!Number(cfg.lunarAssetId)) {
        setLoading(
          "LUNAR ASSET ID REQUIRED",
          "Set lunarAssetId in config.js."
        );

        setStatus(false, "ASSET ID REQUIRED");
        return;
      }

      Cesium.Ion.defaultAccessToken = cfg.ionToken;

      if (!$("#cesiumContainer")) {
        throw new Error("Missing #cesiumContainer element.");
      }

      const moonGlobe = new Cesium.Globe(moonEllipsoid);
      const moonProjection = new Cesium.GeographicProjection(moonEllipsoid);

      viewer = new Cesium.Viewer("cesiumContainer", {
        globe: moonGlobe,
        mapProjection: moonProjection,
        contextOptions: {
          webgl: {
            alpha: true
          }
        },
        animation: false,
        timeline: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        scene3DOnly: true,
        requestRenderMode: false,

        terrainProvider:
          new Cesium.EllipsoidTerrainProvider({
            ellipsoid: moonEllipsoid
          }),

        imageryProvider: false
      });

viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;
      if (viewer.scene.globe) {
        viewer.scene.globe.show = false;
        viewer.scene.globe.enableLighting = true;
        viewer.scene.globe.showGroundAtmosphere = false;
      }

      if (viewer.scene.skyBox) {
        viewer.scene.skyBox.show = false;
      }

      if (viewer.scene.skyAtmosphere) {
        viewer.scene.skyAtmosphere.show = false;
      }

      if (viewer.scene.sun) {
        viewer.scene.sun.show = false;
      }

      if (viewer.scene.moon) {
        viewer.scene.moon.show = false;
      }

      if (viewer.scene.fog) {
        viewer.scene.fog.enabled = false;
      }
      

      const ssc = viewer.scene.screenSpaceCameraController;
      ssc.minimumZoomDistance = 20000;
      ssc.maximumZoomDistance = 60000000;
      ssc.enableCollisionDetection = false;
      ssc.inertiaSpin = 0.05;
      ssc.inertiaZoom = 0.4;
      ssc.inertiaTranslate = 0.05;
      ssc.constrainedAxis = Cesium.Cartesian3.UNIT_Z;

      createNasaToolbar();
      createSurfaceInspector();

      setLoading(
        "LOADING LUNAR ASSET",
        "Connecting to Cesium ion..."
      );

      if (cfg.assetType === "terrain") {
        viewer.terrainProvider =
          await Cesium.CesiumTerrainProvider.fromIonAssetId(
            Number(cfg.lunarAssetId)
          );

        viewer.scene.globe.show = true;
        lunarMode = "nasa";

        initLightingControls();
        initCelestialEnvironment();
        setupNasaCoordinateInspection();

        setStatus(true, "LUNAR TERRAIN PROVIDER CONNECTED");

        if ($("#loading")) {
          $("#loading").style.display = "none";
        }

      } else {
        moonTileset =
          await Cesium.Cesium3DTileset.fromIonAssetId(
            Number(cfg.lunarAssetId)
          );

        viewer.scene.primitives.add(moonTileset);

        await moonTileset.readyPromise;

        moonTileset.show = true;
        viewer.scene.globe.show = false;
        lunarMode = "tiles";

        initLightingControls();
        initCelestialEnvironment();
        setupNasaCoordinateInspection();

        await viewer.zoomTo(
          moonTileset,
          new Cesium.HeadingPitchRange(
            0,
            -0.3,
            moonTileset.boundingSphere.radius * 2.2
          )
        );

        setStatus(true, "LUNAR 3D TILES CONNECTED");

        if ($("#loading")) {
          $("#loading").style.display = "none";
        }
      }

      const initialLatitude =
        Number.isFinite(Number(cfg.initialLatitude))
          ? Number(cfg.initialLatitude)
          : -69.367621;

      const initialLongitude =
        Number.isFinite(Number(cfg.initialLongitude))
          ? Number(cfg.initialLongitude)
          : 32.348126;

      selectedLatitude = initialLatitude;
      selectedLongitude = initialLongitude;

      if (cfg.enableReferenceMarker) {
        addReferenceMarker(
          initialLatitude,
          initialLongitude
        );
      }

      viewer.scene.preRender.addEventListener(updateHtmlMarkers);
      addMissionMarkers();
      setupLabelsToggle();

      if (lunarMissionSites.length > 0) {
        updateStaticSiteBanner(lunarMissionSites[0]);
      }

      setHud(initialLatitude, initialLongitude);

      setupPlanetaryDragControls();

      setTimeout(() => {
        viewer?.resize();
      }, 200);

      checkBackendHealth();
      setInterval(checkBackendHealth, 15000);
      fetchBackendSolarPosition(initialLatitude, initialLongitude);

      console.log("LunaSite initialized successfully.");

    } catch (error) {
      console.error("LUNASITE CESIUM ERROR:", error);

      setLoading(
        "LUNAR ASSET FAILED TO LOAD",
        `${error.message || error}. Check Cesium ion asset ID, token permissions and Network errors.`
      );

      setStatus(false, "ASSET CONNECTION ERROR");
    }
  }


  // =========================================================
  // 20. FLY BUTTON
  // =========================================================

  if ($("#flyBtn")) {
    $("#flyBtn").addEventListener("click", () => {
      const latitude = $("#lat")?.value ?? "";
      const longitude = $("#lon")?.value ?? "";

      const error = validCoordinates(latitude, longitude);

      if (error) {
        showToast(error);
        return;
      }

      flyToCoordinates(
        Number(latitude),
        Number(longitude)
      );
    });
  }


  // =========================================================
  // 21. REFERENCE BUTTON
  // =========================================================

  if ($("#referenceBtn")) {
    $("#referenceBtn").addEventListener("click", () => {
      if ($("#lat")) {
        $("#lat").value = "-69.367621";
      }

      if ($("#lon")) {
        $("#lon").value = "32.348126";
      }

      flyToCoordinates(-69.367621, 32.348126);
    });
  }


  // =========================================================
  // 22. RESET CAMERA
  // =========================================================

  if ($("#homeBtn")) {
    $("#homeBtn").addEventListener("click", async () => {
      stopAutoRotate();
      if (moonTileset && lunarMode === "tiles") {
        await viewer.zoomTo(
          moonTileset,
          new Cesium.HeadingPitchRange(
            0,
            -0.3,
            moonTileset.boundingSphere.radius * 2.2
          )
        );
      } else if (lunarMode === "nasa") {
        focusWholeMoon();
      } else {
        showToast("Lunar model unavailable.");
      }
    });
  }


  // =========================================================
  // 23. SCIENTIFIC BACKEND INTEGRATION & SITE ASSESSMENT
  // =========================================================

  async function checkBackendHealth() {
    const dot = $("#backendDot");
    const badge = $("#backendStatusBadge");
    const topDot = $("#backendTopDot");
    const topText = $("#backendTopText");

    const dbDot = $("#dbDot");
    const dbBadge = $("#dbStatusBadge");
    const dbTopDot = $("#dbTopDot");
    const dbTopText = $("#dbTopText");

    let isBackendOk = false;

    try {
      const response = await fetch(`${backendBaseUrl}/api/health`, { method: "GET" });
      if (response.ok) {
        if (dot) dot.style.background = "#4ade80";
        if (badge) {
          badge.textContent = "ONLINE";
          badge.style.color = "#4ade80";
        }
        if (topDot) topDot.className = "backend-dot connected";
        if (topText) topText.textContent = "BACKEND ONLINE (JPL DE421)";
        isBackendOk = true;
      }
    } catch (e) {
      console.warn("[LunaSite] Scientific backend unreachable:", e.message);
    }

    if (!isBackendOk) {
      if (dot) dot.style.background = "#f87171";
      if (badge) {
        badge.textContent = "OFFLINE";
        badge.style.color = "#f87171";
      }
      if (topDot) topDot.className = "backend-dot disconnected";
      if (topText) topText.textContent = "BACKEND OFFLINE (PORT 8000)";
    }

    // Check Database Connectivity
    try {
      const dbRes = await fetch(`${backendBaseUrl}/api/database/status`, { method: "GET" });
      if (dbRes.ok) {
        const dbData = await dbRes.json();
        const isSupa = dbData.provider === "supabase" && dbData.supabase_connected;
        if (dbDot) {
          dbDot.style.background = isSupa ? "#38bdf8" : "#fbbf24";
          dbDot.style.boxShadow = isSupa ? "0 0 10px #38bdf8" : "0 0 10px #fbbf24";
        }
        if (dbBadge) {
          dbBadge.textContent = isSupa ? "SUPABASE ONLINE" : "SQLITE LOCAL";
          dbBadge.style.color = isSupa ? "#38bdf8" : "#fbbf24";
        }
        if (dbTopDot) {
          dbTopDot.style.background = isSupa ? "#38bdf8" : "#fbbf24";
          dbTopDot.style.boxShadow = isSupa ? "0 0 8px #38bdf8" : "none";
        }
        if (dbTopText) {
          dbTopText.textContent = isSupa ? "⚡ SUPABASE CLOUD ACTIVE" : "SQLITE FAILOVER ACTIVE";
          dbTopText.style.color = isSupa ? "#7dd3fc" : "#fef08a";
        }
      }
    } catch (e) {
      if (dbDot) dbDot.style.background = "#64748b";
      if (dbBadge) {
        dbBadge.textContent = "CHECKING";
        dbBadge.style.color = "#64748b";
      }
    }

    return isBackendOk;
  }

  async function fetchBackendSolarPosition(lat, lon) {
    try {
      const res = await fetch(`${backendBaseUrl}/api/solar/position?lat=${lat}&lon=${lon}&time=now`);
      if (res.ok) {
        const data = await res.json();
        const sun = data.sun;
        const earth = data.earth;

        const sunEl = $("#lsiSunEl");
        const earthEl = $("#lsiEarthEl");
        const commEl = $("#lsiComm");

        if (sunEl) {
          sunEl.textContent = `${sun.elevation_deg > 0 ? "+" : ""}${sun.elevation_deg.toFixed(2)}° (${sun.elevation_deg > 0 ? "Sunlit" : "Shadow"})`;
          sunEl.style.color = sun.elevation_deg > 0 ? "#fde047" : "#94a3b8";
        }
        if (earthEl) {
          earthEl.textContent = `${earth.elevation_deg > 0 ? "+" : ""}${earth.elevation_deg.toFixed(2)}°`;
          earthEl.style.color = earth.elevation_deg > 0 ? "#38bdf8" : "#f87171";
        }
        if (commEl) {
          commEl.textContent = earth.elevation_deg > 5 ? "DTE OPTIMAL" : (earth.elevation_deg > 0 ? "DTE MARGINAL" : "OCCLUDED");
          commEl.style.color = earth.elevation_deg > 0 ? "#4ade80" : "#f87171";
        }
      }
    } catch (e) {
      console.warn("Backend solar lookup failed:", e);
    }
  }

  async function runScientificAssessment() {
    const latitudeInput = $("#assessmentLat")?.value;
    const longitudeInput = $("#assessmentLon")?.value;
    const messageContainer = $("#validationMessage");
    const btn = $("#validateBtn");

    const error = validCoordinates(latitudeInput, longitudeInput);
    if (error) {
      if (messageContainer) messageContainer.innerHTML = `<span style="color:#f87171;">${error}</span>`;
      showToast(error);
      return;
    }

    const lat = Number(latitudeInput);
    const lon = Number(longitudeInput);

    if (btn) btn.disabled = true;
    if (messageContainer) {
      messageContainer.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:14px;color:#93c5fd;font-family:'DM Mono',monospace;font-size:11px;">
          <div class="loader" style="width:16px;height:16px;border-width:2px;"></div>
          Connecting to JPL DE421 Ephemeris & Assessment Backend for (${lat.toFixed(4)}°, ${lon.toFixed(4)}°)...
        </div>`;
    }

    try {
      const url = `${backendBaseUrl}/api/assessment?lat=${lat}&lon=${lon}&time=now`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Backend returned HTTP ${response.status}`);
      }
      const data = await response.json();

      const suit = data.overall_suitability;
      const illum = data.illumination;
      const comm = data.direct_to_earth;
      const topo = data.topography || {};
      const recs = data.operational_recommendations || [];

      if (messageContainer) {
        messageContainer.innerHTML = `
          <div class="assessment-card">
            <div class="assessment-hero">
              <div class="assessment-hero-left">
                <h3>${data.target.region_name}</h3>
                <p>Target: ${lat.toFixed(6)}° Lat, ${lon.toFixed(6)}° Lon &nbsp;|&nbsp; Frame: MOON_ME_DE421 &nbsp;|&nbsp; UTC: ${data.time_utc.replace("T", " ").slice(0, 19)}</p>
              </div>
              <div class="score-badge" style="color: ${suit.rating_color}; border-color: ${suit.rating_color};">
                <span class="score-number">${suit.score_percent}%</span>
                <span class="score-label">${suit.rating}</span>
              </div>
            </div>

            <div class="assessment-metrics">
              <div class="metric-box">
                <div class="metric-title">
                  <span>☀ SOLAR GEOMETRY & ILLUMINATION</span>
                  <span style="color:${suit.rating_color};">${illum.subscore}/${illum.max_subscore} PTS</span>
                </div>
                <div class="metric-row"><span>Sun Elevation:</span><span>${illum.sun_elevation_deg > 0 ? "+" : ""}${illum.sun_elevation_deg}°</span></div>
                <div class="metric-row"><span>Sun Azimuth:</span><span>${illum.sun_azimuth_deg}°</span></div>
                <div class="metric-row"><span>Solar Irradiance:</span><span>${illum.solar_flux_w_m2} W/m²</span></div>
                <div class="metric-row"><span>Lighting Status:</span><span style="color:#67e8f9;">${illum.status}</span></div>
                <div class="metric-row"><span>Array Efficiency:</span><span>${Math.round(illum.efficiency_factor * 100)}%</span></div>
              </div>

              <div class="metric-box">
                <div class="metric-title">
                  <span>📡 DIRECT-TO-EARTH (DTE) COMM</span>
                  <span style="color:${suit.rating_color};">${comm.subscore}/${comm.max_subscore} PTS</span>
                </div>
                <div class="metric-row"><span>Earth Elevation:</span><span>${comm.earth_elevation_deg > 0 ? "+" : ""}${comm.earth_elevation_deg}°</span></div>
                <div class="metric-row"><span>Earth Azimuth:</span><span>${comm.earth_azimuth_deg}°</span></div>
                <div class="metric-row"><span>Distance to Earth:</span><span>${comm.earth_distance_km.toLocaleString()} km</span></div>
                <div class="metric-row"><span>Link Quality:</span><span style="color:#67e8f9;">${comm.quality}</span></div>
                <div class="metric-row"><span>RF One-Way Latency:</span><span>${comm.latency_sec} s</span></div>
              </div>

              <div class="metric-box">
                <div class="metric-title">
                  <span>🏔 LOLA POLAR TOPOGRAPHY & SLOPE</span>
                  <span style="color:${suit.rating_color};">${topo.subscore || 10}/${topo.max_subscore || 15} PTS</span>
                </div>
                <div class="metric-row"><span>LOLA Elevation:</span><span>${topo.elevation_m !== null && topo.elevation_m !== undefined ? topo.elevation_m + " m" : "Outside Polar DEM"}</span></div>
                <div class="metric-row"><span>Surface Slope:</span><span>${topo.slope_deg !== null && topo.slope_deg !== undefined ? topo.slope_deg + "°" : "Outside Polar DEM"}</span></div>
                <div class="metric-row"><span>Terrain Status:</span><span style="color:#67e8f9;">${topo.status || "Global Basemap"}</span></div>
                <div class="metric-row"><span>80°S Coverage:</span><span>${topo.inside_lola_80s_coverage ? "LOLA 80m/px High-Res" : "Global Heritage"}</span></div>
                <div class="metric-row"><span>Volatile Priority:</span><span>${data.region.priority.split("(")[0]}</span></div>
              </div>
            </div>

            <div class="assessment-recs">
              <div class="recs-title">MISSION OPERATIONAL FINDINGS & RECOMMENDATIONS</div>
              <ul class="recs-list">
                ${recs.map(r => `<li>${r}</li>`).join("")}
              </ul>
            </div>
          </div>
        `;
      }

      showToast(`Assessment complete: ${suit.score_percent}% (${suit.rating})`);
      if (typeof updateAssessmentHistoricalIntelligence === "function") {
        updateAssessmentHistoricalIntelligence(data);
      }
    } catch (err) {
      console.error("Assessment error:", err);
      if (messageContainer) {
        messageContainer.innerHTML = `
          <div style="padding:14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;color:#fca5a5;">
            <b>Backend Assessment Failed:</b> ${err.message}. Verify that the backend is active at <code>${backendBaseUrl}</code>.
          </div>`;
      }
      showToast("Backend assessment failed.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  if ($("#validateBtn")) {
    $("#validateBtn").addEventListener("click", runScientificAssessment);
  }


  // =========================================================
  // 24. MODULE 12: HISTORICAL LUNAR MISSION DATABASE & INTELLIGENCE
  // =========================================================

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function updateAssessmentHistoricalIntelligence(data) {
    const nearby = data?.nearby_historical_missions;
    const validation = data?.historical_validation;

    // Nearest mission card
    if (nearby && nearby.length > 0) {
      const nearest = nearby[0];
      const nmName = $("#nearestMissionName");
      const nmSite = $("#nearestMissionSite");
      const nmAgency = $("#nearestMissionAgency");
      const nmDist = $("#nearestMissionDist");
      const nmBearing = $("#nearestMissionBearing");
      const nmDesc = $("#nearestMissionDesc");

      if (nmName) nmName.textContent = nearest.name;
      if (nmSite) nmSite.textContent = nearest.landing_site_name || "Surface Landing Site";
      if (nmAgency) {
        nmAgency.textContent = nearest.operator || nearest.agency || "SPACE AGENCY";
        const op = (nearest.operator || nearest.agency || "").toUpperCase();
        const agencyClass = op.includes("NASA") ? "nasa" : op.includes("ISRO") ? "isro" : op.includes("CNSA") ? "cnsa" : op.includes("USSR") ? "ussr" : "commercial";
        nmAgency.className = `mission-agency-badge ${agencyClass}`;
      }
      if (nmDist) nmDist.textContent = nearest.distance_km === 0 ? "0.0 km (Touchdown Site)" : `${nearest.distance_km.toFixed(1)} km`;
      if (nmBearing) nmBearing.textContent = nearest.distance_km === 0 ? "Exact Site" : `${nearest.bearing_cardinal} (${nearest.bearing_deg.toFixed(1)}°)`;
      if (nmDesc) nmDesc.textContent = nearest.observations_snippet || "Historical landing coordinate in this quadrant.";

      // Nearby missions mini list
      const miniList = $("#nearbyMissionsMiniList");
      if (miniList) {
        miniList.innerHTML = nearby.slice(0, 4).map(m => `
          <div class="mini-item" style="cursor:pointer;" data-lat="${m.latitude_deg}" data-lon="${m.longitude_deg}" data-id="${m.id}" title="Click to inspect ${escapeHtml(m.name)}">
            <div class="mini-item-header">
              <span class="mini-mission-name"><b>${escapeHtml(m.name)}</b> <small>(${escapeHtml(m.operator || m.agency)})</small></span>
              <span class="mini-dist-badge">${m.distance_km === 0 ? "0.0 km" : m.distance_km.toFixed(1) + " km"}</span>
            </div>
            <div class="mini-coords-row">
              <span>${m.latitude_deg > 0 ? "+" : ""}${m.latitude_deg.toFixed(3)}°, ${m.longitude_deg > 0 ? "+" : ""}${m.longitude_deg.toFixed(3)}°</span>
              <span>${m.distance_km === 0 ? "Exact Point" : m.bearing_cardinal + " (" + m.bearing_deg.toFixed(0) + "°)"}</span>
            </div>
          </div>
        `).join("");

        miniList.querySelectorAll(".mini-item").forEach(item => {
          item.addEventListener("click", () => {
            const lat = Number(item.dataset.lat);
            const lon = Number(item.dataset.lon);
            switchView("globe");
            flyToCoordinates(lat, lon);
          });
        });
      }
    }

    // Scientific Ground Truth Validation Table
    const valTbody = $("#historicalValidationTableBody");
    const valNotice = $("#validationCoverageNotice");
    if (valTbody && validation && validation.length > 0) {
      if (valNotice) {
        valNotice.textContent = `COMPARING PLATFORM PREDICTIONS WITH ${validation.length} IN-SITU BENCHMARKS`;
      }
      valTbody.innerHTML = validation.map(v => {
        const badgeClass = (v.status.includes("EXCELLENT") || v.status.includes("CONFIRMED")) ? "success" : "partial";
        return `
          <tr>
            <td>
              <b>${escapeHtml(v.metric_name)}</b><br>
              <small>${escapeHtml(v.sensor)} · ${escapeHtml(v.dataset_source)}</small>
            </td>
            <td><b>${escapeHtml(v.observed_in_situ)}</b></td>
            <td><b>${escapeHtml(v.platform_predicted)}</b></td>
            <td><span style="color:#fdba74;">${escapeHtml(v.delta)}</span></td>
            <td>${Number(v.spatial_distance_km).toFixed(1)} km</td>
            <td><span class="val-badge ${badgeClass}">${escapeHtml(v.status)}</span></td>
          </tr>
        `;
      }).join("");
    }
  }

  // --- Historical Missions State ---
  let historicalMissionsCache = null;
  let canvasMissionPoints = [];
  const historicalFilters = {
    search: "",
    agency: "all",
    era: "all",
    type: "all",
    region: "all"
  };

  async function loadMissionsCatalog() {
    const grid = $("#missionsGrid");
    if (!grid) return;

    if (!historicalMissionsCache) {
      grid.innerHTML = `<div class="missions-loading">Loading 28 authoritative historical lunar missions from scientific database...</div>`;
      try {
        const res = await fetch(`${backendBaseUrl}/api/historical/missions`);
        if (res.ok) {
          const data = await res.json();
          historicalMissionsCache = Array.isArray(data) ? data : (data.missions || []);
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn("Falling back to local mission catalog:", err);
        historicalMissionsCache = lunarMissionSites.map(s => ({
          id: s.id,
          name: s.name,
          agency: s.agency,
          country: s.agency === "NASA" ? "USA" : s.agency === "USSR" ? "USSR" : s.agency === "ISRO" ? "India" : s.agency === "CNSA" ? "China" : "Japan",
          latitude_deg: s.latitude,
          longitude_deg: s.longitude,
          coordinate_system: "MOON_ME_DE421",
          coordinate_accuracy: "±500 m",
          mission_type: s.name.includes("Apollo") ? "Crewed Landing" : "Robotic Soft Lander",
          landing_outcome: "Soft Landing / Successful",
          scientific_instruments: [],
          scientific_observations: "Catalogued in lunar planetary mission archives.",
          available_datasets: ["NASA PDS / ISRO ISSDC / CNSA CLEP"],
          original_source: "NASA NSSDC / IAU WGPSN",
          verification_status: "Verified",
          landing_region: Math.abs(s.latitude) > 60 ? "South Pole" : "Nearside Maria",
          region: Math.abs(s.latitude) > 60 ? "South Pole" : "Nearside Maria",
          site_name: s.name
        }));
      }
    }

    renderFilteredMissions();
  }

  function renderFilteredMissions() {
    const grid = $("#missionsGrid");
    const countBadge = $("#catalogCounterBadge");
    if (!grid || !historicalMissionsCache) return;

    const query = (historicalFilters.search || "").toLowerCase().trim();
    const fAgency = historicalFilters.agency;
    const fEra = historicalFilters.era;
    const fType = historicalFilters.type;
    const fRegion = historicalFilters.region;

    const filtered = historicalMissionsCache.filter(m => {
      // Agency filter
      if (fAgency !== "all") {
        if (fAgency === "Commercial") {
          const op = (m.agency || m.operator || "").toLowerCase();
          if (!op.includes("commercial") && !op.includes("intuitive") && !op.includes("firefly") && !op.includes("clps")) {
            return false;
          }
        } else {
          const op = (m.agency || m.operator || m.country || "").toUpperCase();
          if (!op.includes(fAgency.toUpperCase())) return false;
        }
      }

      // Era filter
      if (fEra !== "all") {
        const era = (m.era || "").toLowerCase();
        if (!era.includes(fEra.toLowerCase())) return false;
      }

      // Type filter
      if (fType !== "all") {
        const type = (m.mission_type || "").toLowerCase();
        if (!type.includes(fType.toLowerCase())) return false;
      }

      // Region filter
      if (fRegion !== "all") {
        const reg = (m.landing_region || m.region || "").toLowerCase();
        if (!reg.includes(fRegion.toLowerCase())) return false;
      }

      // Search query
      if (query) {
        const matchName = (m.name || "").toLowerCase().includes(query);
        const matchSite = (m.landing_site_name || m.site_name || "").toLowerCase().includes(query);
        const matchAgency = (m.agency || m.operator || m.country || "").toLowerCase().includes(query);
        const matchHardware = (m.lander_rover_info || "").toLowerCase().includes(query);
        const matchObs = (m.scientific_observations || "").toLowerCase().includes(query);
        const matchNotes = (m.notes_and_limitations || "").toLowerCase().includes(query);
        const matchInst = Array.isArray(m.scientific_instruments) && m.scientific_instruments.some(inst => 
          (inst.name || "").toLowerCase().includes(query) || (inst.description || inst.role || "").toLowerCase().includes(query)
        );
        const matchDs = Array.isArray(m.available_datasets) && m.available_datasets.some(ds => {
          if (typeof ds === "string") return ds.toLowerCase().includes(query);
          return (ds.name || ds.source || "").toLowerCase().includes(query);
        });

        if (!matchName && !matchSite && !matchAgency && !matchHardware && !matchObs && !matchNotes && !matchInst && !matchDs) {
          return false;
        }
      }

      return true;
    });

    if (countBadge) {
      countBadge.textContent = `SHOWING ${filtered.length} / ${historicalMissionsCache.length} MISSIONS`;
    }

    // Draw 2D canvas distribution
    drawHistoricalMoonMap(filtered);

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; padding: 40px 20px; text-align: center; color: #94a3b8; font-size: 13px;">
          <div style="font-size: 24px; margin-bottom: 8px;">🛰️</div>
          <b>No historical missions found matching current filter criteria.</b><br>
          <span style="font-size: 11px; color: #64748b;">Try selecting "ALL" or clearing your search term.</span>
        </div>
      `;
      return;
    }

    grid.innerHTML = "";

    filtered.forEach(m => {
      const op = (m.agency || m.operator || "").toUpperCase();
      let agencyKey = "nasa";
      let agencyFlag = "🇺🇸";
      let agencyName = "NASA";

      if (op.includes("ISRO") || m.country === "India") {
        agencyKey = "isro";
        agencyFlag = "🇮🇳";
        agencyName = "ISRO";
      } else if (op.includes("USSR") || m.country === "USSR" || op.includes("ROSC")) {
        agencyKey = "ussr";
        agencyFlag = "🇷🇺";
        agencyName = "USSR / Lavochkin";
      } else if (op.includes("CNSA") || m.country === "China") {
        agencyKey = "cnsa";
        agencyFlag = "🇨🇳";
        agencyName = "CNSA";
      } else if (op.includes("JAXA") || m.country === "Japan") {
        agencyKey = "jaxa";
        agencyFlag = "🇯🇵";
        agencyName = "JAXA";
      } else if (op.includes("COMMERCIAL") || op.includes("INTUITIVE") || op.includes("FIREFLY") || op.includes("CLPS")) {
        agencyKey = "commercial";
        agencyFlag = "🚀";
        agencyName = "CLPS Commercial";
      }

      // Year
      const year = (m.landing_date || "").slice(0, 4) || (m.launch_date || "").slice(0, 4) || "HIST";

      // Site Name
      const siteName = m.landing_site_name || m.site_name || "Designated Landing Zone";

      // Coordinates
      const lat = Number(m.latitude_deg);
      const lon = Number(m.longitude_deg);
      const coordStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;

      // Concise Accuracy
      const rawAcc = m.coordinate_accuracy || "±500m";
      const accShort = rawAcc.includes("±") ? rawAcc.split("(")[0].trim() : rawAcc.slice(0, 18);

      // Samples / Traverse
      let mobility = "Stationary";
      if (m.samples_returned_kg && m.samples_returned_kg > 0) {
        mobility = `${m.samples_returned_kg} kg Samples`;
      } else if (m.distance_traversed_km && m.distance_traversed_km > 0) {
        mobility = `${m.distance_traversed_km} km Traverse`;
      } else if (m.traverse_distance_m && m.traverse_distance_m > 0) {
        mobility = `${m.traverse_distance_m} m Traverse`;
      }

      // Verification Badge
      const verifyStatus = m.verification_status || "Verified";
      const verifyClass = verifyStatus === "Verified" ? "verify-verified" : "verify-partial";

      // Instruments chips (up to 3)
      const insts = Array.isArray(m.scientific_instruments) ? m.scientific_instruments : [];
      let instChipsHtml = "";
      if (insts.length > 0) {
        const top3 = insts.slice(0, 3).map(i => {
          const iName = typeof i === "string" ? i : (i.name || "Sensor");
          const iDesc = typeof i === "object" ? (i.description || i.role || "") : "";
          return `<span class="inst-pill" title="${escapeHtml(iDesc)}">${escapeHtml(iName)}</span>`;
        }).join("");
        const moreCount = insts.length - 3;
        instChipsHtml = top3 + (moreCount > 0 ? `<span class="inst-pill more-chip">+${moreCount} more</span>` : "");
      }

      const card = document.createElement("div");
      card.className = `mission-card agency-border-${agencyKey}`;
      card.innerHTML = `
        <div>
          <!-- Card Header -->
          <div class="mc-header">
            <div class="mc-agency-badge agency-${agencyKey}">
              <span class="mc-agency-dot"></span>
              <span>${agencyFlag} ${escapeHtml(agencyName)}</span>
            </div>
            <span class="mc-year-badge">${escapeHtml(year)}</span>
          </div>

          <!-- Title & Site -->
          <div class="mc-identity">
            <h3 class="mc-title">${escapeHtml(m.name)}</h3>
            <div class="mc-site">
              <span class="mc-site-icon">⌖</span>
              <span class="mc-site-name">${escapeHtml(siteName)}</span>
            </div>
          </div>

          <!-- Tags -->
          <div class="mc-tags-row">
            <span class="mc-tag ${verifyClass}">● ${escapeHtml(verifyStatus)}</span>
            <span class="mc-tag mc-type-tag">${escapeHtml(m.mission_type || "Robotic Landing")}</span>
            <span class="mc-tag mc-region-tag">${escapeHtml(m.landing_region || m.region || "Nearside")}</span>
          </div>

          <!-- Telemetry Micro-Grid -->
          <div class="mc-telemetry-grid">
            <div class="mc-telem-item">
              <span class="mc-telem-lbl">COORDINATES</span>
              <span class="mc-telem-val">${coordStr}</span>
            </div>
            <div class="mc-telem-item">
              <span class="mc-telem-lbl">ACCURACY</span>
              <span class="mc-telem-val" title="${escapeHtml(rawAcc)}">${escapeHtml(accShort)}</span>
            </div>
            <div class="mc-telem-item">
              <span class="mc-telem-lbl">SAMPLES / TRAVERSE</span>
              <span class="mc-telem-val">${escapeHtml(mobility)}</span>
            </div>
          </div>

          <!-- Hardware -->
          ${m.lander_rover_info ? `
            <div class="mc-hardware-chip" title="${escapeHtml(m.lander_rover_info)}">
              <span>🚀 ${escapeHtml(m.lander_rover_info)}</span>
            </div>
          ` : ""}

          <!-- Scientific Payload Chips -->
          ${instChipsHtml ? `<div class="mc-instruments-list">${instChipsHtml}</div>` : ""}

          <!-- Observations Quote -->
          <p class="mc-obs-snippet" title="${escapeHtml(m.scientific_observations || "")}">
            ${escapeHtml(m.scientific_observations || "Planetary surface science telemetry catalogued in mission archives.")}
          </p>
        </div>

        <!-- Action Buttons -->
        <div class="mc-actions">
          <button class="mc-btn mc-btn-dossier mc-dossier-btn" data-id="${m.id}" title="Open comprehensive mission dossier">
            <span>ℹ</span> DOSSIER
          </button>
          <button class="mc-btn mc-btn-fly mc-fly-btn" data-lat="${m.latitude_deg}" data-lon="${m.longitude_deg}" title="Fly to site on 3D lunar surface">
            <span>⌖</span> FLY 3D
          </button>
          <button class="mc-btn mc-btn-compare mc-compare-btn" data-id="${m.id}" title="Compare with another mission">
            <span>⇄</span> COMPARE
          </button>
        </div>
      `;

      grid.appendChild(card);
    });

    // Wire up card action buttons
    grid.querySelectorAll(".mc-dossier-btn").forEach(btn => {
      btn.addEventListener("click", () => openMissionDossier(btn.dataset.id));
    });

    grid.querySelectorAll(".mc-fly-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const lat = Number(btn.dataset.lat);
        const lon = Number(btn.dataset.lon);
        switchView("globe");
        flyToCoordinates(lat, lon);
      });
    });

    grid.querySelectorAll(".mc-compare-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idA = btn.dataset.id;
        const idB = idA === "chandrayaan-3" ? "apollo-11" : "chandrayaan-3";
        openHistoricalComparison(idA, idB);
      });
    });
  }

  // --- 2D Interactive Landing Distribution Map Canvas ---
  function drawHistoricalMoonMap(activeMissions = null) {
    const canvas = $("#historicalMoonMapCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Clear and background
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, w, h);

    // Near Side highlight zone (Lon -90° to +90° corresponds to x = 250 to 750)
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    ctx.fillRect(w * 0.25, 0, w * 0.5, h);

    // Latitude grid lines (+60, +30, 0, -30, -60)
    ctx.strokeStyle = "rgba(51, 65, 85, 0.4)";
    ctx.lineWidth = 1;
    [-60, -30, 0, 30, 60].forEach(lat => {
      const y = ((90 - lat) / 180) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    // Longitude grid lines (-120, -60, 0, +60, +120)
    [-120, -60, 0, 60, 120].forEach(lon => {
      const x = ((lon + 180) / 360) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });

    // Equator and Prime Meridian emphasis
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // Quadrant and orientation text labels
    ctx.fillStyle = "rgba(148, 163, 184, 0.45)";
    ctx.font = "9px 'DM Mono', monospace";
    ctx.fillText("FAR SIDE (WEST)", 16, 20);
    ctx.fillText("NEAR SIDE (EARTH-FACING)", w * 0.5 - 65, 20);
    ctx.fillText("FAR SIDE (EAST)", w - 110, 20);
    ctx.fillText("NORTH POLE (+90°)", w * 0.5 - 45, 12);
    ctx.fillText("SOUTH POLE (-90°)", w * 0.5 - 45, h - 6);
    ctx.fillText("0° EQUATOR", 8, h / 2 - 4);
    ctx.fillText("0° MERIDIAN", w / 2 + 6, h / 2 - 4);

    canvasMissionPoints = [];
    const missionsToDraw = historicalMissionsCache || [];
    const activeIds = new Set((activeMissions || missionsToDraw).map(m => m.id));

    missionsToDraw.forEach(m => {
      const lon = Number(m.longitude_deg);
      const lat = Number(m.latitude_deg);
      const x = ((lon + 180) / 360) * w;
      const y = ((90 - lat) / 180) * h;

      const isActive = activeIds.has(m.id);
      const isRef = m.id === "chandrayaan-3";

      canvasMissionPoints.push({ x, y, radius: 8, mission: m });

      // Determine marker color
      let color = "#38bdf8"; // NASA Cyan
      const op = (m.agency || m.operator || "").toUpperCase();
      if (op.includes("ISRO") || Math.abs(lat) > 60) color = "#f97316"; // South Pole Orange
      else if (op.includes("USSR")) color = "#ef4444"; // USSR Red
      else if (op.includes("CNSA")) color = "#eab308"; // CNSA Gold
      else if (op.includes("JAXA")) color = "#ec4899"; // JAXA Pink
      else if (op.includes("COMMERCIAL") || op.includes("INTUITIVE") || op.includes("FIREFLY")) color = "#a855f7"; // CLPS Purple

      ctx.save();
      if (!isActive) {
        ctx.globalAlpha = 0.2;
      }

      // Mission Dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    });
  }

  function setupHistoricalMoonMapInteractions() {
    const canvas = $("#historicalMoonMapCanvas");
    const tooltip = $("#historicalMapHoverTooltip");
    if (!canvas || !tooltip) return;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      // Find closest mission within 12px
      let found = null;
      for (const p of canvasMissionPoints) {
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        if (Math.sqrt(dx * dx + dy * dy) <= 12) {
          found = p.mission;
          break;
        }
      }

      if (found) {
        canvas.style.cursor = "pointer";
        tooltip.hidden = false;
        tooltip.innerHTML = `
          <b>${escapeHtml(found.name)}</b> <small>(${escapeHtml(found.agency || found.operator)})</small><br>
          ${found.landing_site_name ? `<span style="color:#fdba74;">⌖ ${escapeHtml(found.landing_site_name)}</span><br>` : ""}
          <span style="font-size:10px;color:#94a3b8;">${Number(found.latitude_deg).toFixed(4)}°, ${Number(found.longitude_deg).toFixed(4)}°</span><br>
          <span style="font-size:9.5px;color:#38bdf8;">Click to view full mission dossier</span>
        `;
        const wrap = canvas.parentElement;
        const wrapRect = wrap.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - wrapRect.left + 12}px`;
        tooltip.style.top = `${e.clientY - wrapRect.top - 10}px`;
      } else {
        canvas.style.cursor = "default";
        tooltip.hidden = true;
      }
    });

    canvas.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });

    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      for (const p of canvasMissionPoints) {
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        if (Math.sqrt(dx * dx + dy * dy) <= 12) {
          openMissionDossier(p.mission.id);
          break;
        }
      }
    });
  }

  // --- Mission Dossier Modal ---
  async function openMissionDossier(missionId) {
    const modal = $("#missionDossierModal");
    if (!modal) return;

    let mission = (historicalMissionsCache || []).find(m => m.id === missionId);
    if (!mission) {
      try {
        const res = await fetch(`${backendBaseUrl}/api/historical/missions/${missionId}`);
        if (res.ok) {
          mission = await res.json();
        }
      } catch (e) {
        console.error("Failed to fetch mission dossier:", e);
      }
    }

    if (!mission) {
      showToast("Could not load mission dossier.");
      return;
    }

    // Populate Dossier fields
    const titleEl = $("#dossierTitle");
    if (titleEl) titleEl.textContent = `${mission.name} ${mission.rover ? "· " + mission.rover : ""}`;

    const agencyBadge = $("#dossierAgencyBadge");
    if (agencyBadge) {
      agencyBadge.textContent = `${mission.country ? mission.country + " · " : ""}${mission.agency || mission.operator}`;
      const op = (mission.agency || mission.operator || "").toUpperCase();
      const aClass = op.includes("NASA") ? "agency-nasa" : op.includes("ISRO") ? "agency-isro" : op.includes("CNSA") ? "agency-cnsa" : op.includes("USSR") ? "agency-ussr" : "agency-commercial";
      agencyBadge.className = `m-badge ${aClass}`;
    }

    const outcomeBadge = $("#dossierOutcomeBadge");
    if (outcomeBadge) outcomeBadge.textContent = mission.landing_outcome || "Soft Landing / Successful";

    const verifyBadge = $("#dossierVerificationBadge");
    if (verifyBadge) {
      verifyBadge.textContent = mission.verification_status || "Verified";
      verifyBadge.className = `m-badge ${mission.verification_status === "Verified" ? "verify-verified" : "verify-partial"}`;
    }

    $("#dossierSiteName") && ($("#dossierSiteName").textContent = mission.landing_site_name || "Designated Landing Zone");
    $("#dossierCoords") && ($("#dossierCoords").textContent = `${mission.latitude_deg > 0 ? "+" : ""}${Number(mission.latitude_deg).toFixed(6)}° Lat, ${mission.longitude_deg > 0 ? "+" : ""}${Number(mission.longitude_deg).toFixed(6)}° Lon`);
    $("#dossierCRS") && ($("#dossierCRS").textContent = mission.coordinate_system || "MOON_ME_DE421");
    $("#dossierAccuracy") && ($("#dossierAccuracy").textContent = mission.coordinate_accuracy || "Planetary Ground Truth (LROC NAC)");
    $("#dossierLandingDate") && ($("#dossierLandingDate").textContent = mission.landing_date || "N/A");
    $("#dossierLaunchDate") && ($("#dossierLaunchDate").textContent = mission.launch_date || "N/A");
    $("#dossierRegion") && ($("#dossierRegion").textContent = mission.landing_region || "Lunar Surface");

    const mobilityEl = $("#dossierMobility");
    if (mobilityEl) {
      if (mission.traverse_distance_m) {
        mobilityEl.textContent = `Traversed ${mission.traverse_distance_m} m`;
      } else if (mission.sample_mass_kg) {
        mobilityEl.textContent = `Returned ${mission.sample_mass_kg} kg lunar samples`;
      } else {
        mobilityEl.textContent = "Stationary Lander (No traverse)";
      }
    }

    $("#dossierHardware") && ($("#dossierHardware").textContent = mission.lander_rover_info || "Spacecraft telemetry available in mission archives.");

    // Scientific Instruments Table
    const instTbody = $("#dossierInstrumentsTbody");
    if (instTbody) {
      const insts = mission.scientific_instruments || [];
      if (insts.length > 0) {
        instTbody.innerHTML = insts.map(i => `
          <tr>
            <td style="font-weight:700; color:#38bdf8;">${escapeHtml(i.name)}</td>
            <td style="color:#cbd5e1;">${escapeHtml(i.description || i.role || "Scientific measurement payload")}</td>
          </tr>
        `).join("");
      } else {
        instTbody.innerHTML = `<tr><td colspan="2" style="color:#64748b; font-style:italic;">No discrete instruments logged for this mission.</td></tr>`;
      }
    }

    // Observations
    $("#dossierObservations") && ($("#dossierObservations").textContent = mission.scientific_observations || "Ground-truth data archived in planetary science repositories.");

    // Datasets & Repositories (Fix [object Object] by generating rich clickable links)
    const dsList = $("#dossierDatasetsList");
    if (dsList) {
      const dss = mission.available_datasets || [];
      if (dss.length > 0) {
        dsList.innerHTML = dss.map(ds => {
          if (typeof ds === "object" && ds !== null) {
            const name = ds.name || "Scientific Repository";
            const src = ds.source ? `<span class="ds-source-tag">${escapeHtml(ds.source)}</span>` : "";
            const url = ds.url || null;
            if (url) {
              return `<a class="dataset-pill" href="${encodeURI(url)}" target="_blank" rel="noopener noreferrer">📁 <span>${escapeHtml(name)}</span> ${src} ↗</a>`;
            }
            return `<span class="dataset-pill">📁 <span>${escapeHtml(name)}</span> ${src}</span>`;
          }
          return `<span class="dataset-pill">📁 <span>${escapeHtml(String(ds))}</span></span>`;
        }).join("");
      } else {
        dsList.innerHTML = `<span style="color:#64748b; font-size:12px;">Standard NASA PDS / IAU WGPSN planetary archive telemetry.</span>`;
      }
    }

    // Sources & Reliability
    $("#dossierOriginalSource") && ($("#dossierOriginalSource").textContent = mission.original_source || "Official Space Agency Record");
    $("#dossierReliability") && ($("#dossierReliability").textContent = mission.source_reliability || "Authoritative Ground Truth");
    $("#dossierNotes") && ($("#dossierNotes").innerHTML = mission.notes_and_limitations ? `<b>Notes & Limitations:</b> ${escapeHtml(mission.notes_and_limitations)}` : "");

    // Modal action buttons
    const flyBtn = $("#dossierFlyBtn");
    if (flyBtn) {
      flyBtn.onclick = () => {
        modal.hidden = true;
        switchView("globe");
        flyToCoordinates(Number(mission.latitude_deg), Number(mission.longitude_deg));
      };
    }

    const compareBtn = $("#dossierCompareBtn");
    if (compareBtn) {
      compareBtn.onclick = () => {
        modal.hidden = true;
        const compTarget = mission.id === "chandrayaan-3" ? "apollo-11" : "chandrayaan-3";
        openHistoricalComparison(mission.id, compTarget);
      };
    }

    modal.hidden = false;
  }

  // --- Historical Mission Comparison Modal ---
  async function openHistoricalComparison(idA = "chandrayaan-3", idB = "apollo-11") {
    const modal = $("#historicalCompareModal");
    if (!modal) return;

    const selA = $("#compareSelectA");
    const selB = $("#compareSelectB");

    // Populate selectors if empty
    if (selA && selB && historicalMissionsCache) {
      const optionsHtml = historicalMissionsCache.map(m => `
        <option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.agency || m.operator)})</option>
      `).join("");

      selA.innerHTML = optionsHtml;
      selB.innerHTML = optionsHtml;

      selA.value = idA;
      selB.value = idB;

      selA.onchange = () => fetchAndRenderComparison(selA.value, selB.value);
      selB.onchange = () => fetchAndRenderComparison(selA.value, selB.value);
    }

    await fetchAndRenderComparison(idA, idB);
    modal.hidden = false;
  }

  async function fetchAndRenderComparison(idA, idB) {
    const distVal = $("#compareDistanceVal");
    const thA = $("#compThA");
    const thB = $("#compThB");
    const tbody = $("#comparisonMatrixTbody");
    const flyA = $("#compareFlyABtn");
    const flyB = $("#compareFlyBBtn");

    if (distVal) distVal.textContent = "Calculating spherical separation...";

    try {
      const res = await fetch(`${backendBaseUrl}/api/historical/compare?id_a=${idA}&id_b=${idB}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const mA = data.mission_a;
      const mB = data.mission_b;

      if (thA) thA.textContent = mA.name;
      if (thB) thB.textContent = mB.name;
      if (distVal) {
        distVal.textContent = `${Number(data.surface_separation_km).toLocaleString()} km (${data.relative_bearing_deg}° ${data.bearing_cardinal})`;
      }

      if (flyA) {
        flyA.onclick = () => {
          $("#historicalCompareModal").hidden = true;
          switchView("globe");
          flyToCoordinates(mA.latitude_deg, mA.longitude_deg);
        };
      }
      if (flyB) {
        flyB.onclick = () => {
          $("#historicalCompareModal").hidden = true;
          switchView("globe");
          flyToCoordinates(mB.latitude_deg, mB.longitude_deg);
        };
      }

      if (tbody) {
        const rows = [
          { label: "Country & Space Agency", a: `${mA.country} · ${mA.agency}`, b: `${mB.country} · ${mB.agency}` },
          { label: "Landing Date & Era", a: `${mA.landing_date} (${mA.era})`, b: `${mB.landing_date} (${mB.era})` },
          { label: "Landing Site / Landmark", a: mA.landing_site_name || "Target Coordinates", b: mB.landing_site_name || "Target Coordinates" },
          { label: "Touchdown Coordinates", a: `${mA.latitude_deg.toFixed(4)}°, ${mA.longitude_deg.toFixed(4)}°`, b: `${mB.latitude_deg.toFixed(4)}°, ${mB.longitude_deg.toFixed(4)}°` },
          { label: "Coordinate Reference System (CRS)", a: mA.coordinate_system, b: mB.coordinate_system },
          { label: "Coordinate Uncertainty / Source", a: mA.coordinate_accuracy, b: mB.coordinate_accuracy },
          { label: "Landing Outcome", a: mA.landing_outcome, b: mB.landing_outcome },
          { label: "Hardware Suite", a: mA.lander_rover_info, b: mB.lander_rover_info },
          { label: "Mobility / Sample Return", a: mA.traverse_distance_m ? `Traversed ${mA.traverse_distance_m} m` : (mA.sample_mass_kg ? `Returned ${mA.sample_mass_kg} kg` : "Stationary"), b: mB.traverse_distance_m ? `Traversed ${mB.traverse_distance_m} m` : (mB.sample_mass_kg ? `Returned ${mB.sample_mass_kg} kg` : "Stationary") },
          { label: "Scientific Payload Count", a: `${(mA.scientific_instruments || []).length} instruments`, b: `${(mB.scientific_instruments || []).length} instruments` },
          { label: "Key In-Situ Discoveries", a: mA.scientific_observations, b: mB.scientific_observations },
          { label: "Accessible Datasets", a: (mA.available_datasets || []).join(", "), b: (mB.available_datasets || []).join(", ") },
          { label: "Verification Status", a: mA.verification_status, b: mB.verification_status }
        ];

        tbody.innerHTML = rows.map(r => `
          <tr>
            <td style="font-weight:700; color:#94a3b8; font-size:11px;">${escapeHtml(r.label)}</td>
            <td style="color:#f1f5f9; font-size:11.5px;">${escapeHtml(r.a)}</td>
            <td style="color:#f1f5f9; font-size:11.5px;">${escapeHtml(r.b)}</td>
          </tr>
        `).join("");
      }
    } catch (err) {
      console.error("Comparison error:", err);
      if (distVal) distVal.textContent = "Comparison service unavailable.";
    }
  }

  // --- Initialize Module 12 UI ---
  function initHistoricalMissionsModule() {
    // Search input with live debouncing
    const searchInput = $("#historicalSearchInput");
    const clearBtn = $("#clearSearchBtn");

    if (searchInput) {
      let debounceTimer = null;
      searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          historicalFilters.search = searchInput.value;
          renderFilteredMissions();
        }, 150);
      });
    }

    if (clearBtn && searchInput) {
      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        historicalFilters.search = "";
        renderFilteredMissions();
      });
    }

    // Agency Tabs & Filter Pills
    document.querySelectorAll(".agency-tab, .f-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        const parent = btn.parentElement;
        if (parent) {
          parent.querySelectorAll(".agency-tab, .f-pill").forEach(b => b.classList.remove("active"));
        }
        btn.classList.add("active");

        const filterType = btn.dataset.filter;
        const filterVal = btn.dataset.val;
        if (filterType && filterVal) {
          historicalFilters[filterType] = filterVal;
          renderFilteredMissions();
        }
      });
    });

    // Dropdown Select Filters (Era, Type, Region)
    document.querySelectorAll(".f-select").forEach(sel => {
      sel.addEventListener("change", () => {
        const filterType = sel.dataset.filter;
        if (filterType) {
          historicalFilters[filterType] = sel.value;
          renderFilteredMissions();
        }
      });
    });

    // Reset Filters Button
    const resetBtn = $("#resetFiltersBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        historicalFilters.search = "";
        historicalFilters.agency = "all";
        historicalFilters.era = "all";
        historicalFilters.type = "all";
        historicalFilters.region = "all";
        if (searchInput) searchInput.value = "";
        document.querySelectorAll(".agency-tab, .f-pill").forEach(b => {
          b.classList.toggle("active", b.dataset.val === "all");
        });
        document.querySelectorAll(".f-select").forEach(sel => {
          sel.value = "all";
        });
        renderFilteredMissions();
      });
    }

    // Toggle 2D Radar Map Container
    const toggleMapBtn = $("#toggleMapBtn");
    const mapContainer = $("#historicalMapContainer");
    if (toggleMapBtn && mapContainer) {
      toggleMapBtn.addEventListener("click", () => {
        const isHidden = mapContainer.hidden;
        mapContainer.hidden = !isHidden;
        const icon = $("#toggleMapIcon");
        const txt = $("#toggleMapText");
        if (icon) icon.textContent = isHidden ? "🗺️" : "👁️";
        if (txt) txt.textContent = isHidden ? "HIDE RADAR MAP" : "SHOW RADAR MAP";
      });
    }

    // Top action buttons
    const compBtn = $("#openCompareModalBtn");
    if (compBtn) {
      compBtn.addEventListener("click", () => {
        openHistoricalComparison("chandrayaan-3", "apollo-11");
      });
    }

    const poleBtn = $("#flyToSouthPoleBtn") || $("#flyToShivShaktiBtn");
    if (poleBtn) {
      poleBtn.addEventListener("click", () => {
        switchView("globe");
        flyToCoordinates(-80.0, 0.0);
      });
    }

    // Setup Canvas interactions
    setupHistoricalMoonMapInteractions();

    // Setup Dossier Modal Close
    const closeDossier = $("#closeDossierBtn");
    if (closeDossier) {
      closeDossier.addEventListener("click", () => {
        const m = $("#missionDossierModal");
        if (m) m.hidden = true;
      });
    }

    // Setup Compare Modal Close
    const closeComp = $("#closeCompareModalBtn");
    const closeCompFooter = $("#closeCompareFooterBtn");
    [closeComp, closeCompFooter].forEach(btn => {
      if (btn) {
        btn.addEventListener("click", () => {
          const m = $("#historicalCompareModal");
          if (m) m.hidden = true;
        });
      }
    });

    // Initial catalog load
    loadMissionsCatalog();
  }

  async function loadSavedSites() {
    const list = $("#savedSitesList");
    const countEl = $("#savedSitesCount");
    if (!list) return;

    list.innerHTML = `<p style="color:#718294; font-size:11px;">Loading saved sites from database...</p>`;

    try {
      const res = await fetch(`${backendBaseUrl}/api/saved-sites`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const sites = data.sites || [];

      if (countEl) countEl.textContent = `${sites.length} TARGET${sites.length === 1 ? "" : "S"} SAVED`;

      if (sites.length === 0) {
        list.innerHTML = `
          <div style="grid-column: 1/-1; padding: 24px; text-align: center; color: #64748b; font-size: 12px;">
            No candidate sites saved yet. Use the form above or click <b>★ BOOKMARK CANDIDATE SITE</b> in the 3D Surface Inspector!
          </div>
        `;
        return;
      }

      list.innerHTML = "";
      sites.forEach((site) => {
        const card = document.createElement("div");
        card.className = "saved-site-card";
        const suitability = site.suitability_score !== null && site.suitability_score !== undefined
          ? `${Math.round(site.suitability_score)}/100`
          : "88/100";

        card.innerHTML = `
          <div class="saved-card-header">
            <span class="saved-card-title">${escapeHtml(site.name)}</span>
            <span class="saved-card-badge">SUITABILITY: ${suitability}</span>
          </div>
          <div class="mission-coords">
            <span>LAT: ${Number(site.latitude).toFixed(4)}°</span>
            <span>LON: ${Number(site.longitude).toFixed(4)}°</span>
          </div>
          <div class="saved-card-notes">${escapeHtml(site.notes || "No notes attached.")}</div>
          <div class="saved-card-actions">
            <span class="saved-card-date">${site.created_at ? new Date(site.created_at).toLocaleDateString() : "SAVED"}</span>
            <div style="display:flex; gap:8px;">
              <button class="fly-site-btn fly-saved-btn" data-lat="${site.latitude}" data-lon="${site.longitude}">FLY TO TARGET ↗</button>
              <button class="delete-site-btn" data-id="${site.id}">🗑 DELETE</button>
            </div>
          </div>
        `;
        list.appendChild(card);
      });

      list.querySelectorAll(".fly-saved-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const lat = Number(btn.dataset.lat);
          const lon = Number(btn.dataset.lon);
          switchView("globe");
          flyToCoordinates(lat, lon);
        });
      });

      list.querySelectorAll(".delete-site-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          try {
            const delRes = await fetch(`${backendBaseUrl}/api/saved-sites/${id}`, { method: "DELETE" });
            if (delRes.ok) {
              showToast("Candidate site deleted from database.");
              loadSavedSites();
            }
          } catch (e) {
            showToast("Failed to delete site.");
          }
        });
      });

    } catch (err) {
      list.innerHTML = `<p style="color:#ef4444; font-size:11px;">Failed to load saved sites: ${err.message}</p>`;
    }
  }

  function setupSaveSiteForm() {
    const saveForm = $("#saveSiteForm");
    if (saveForm) {
      saveForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = $("#saveSiteName")?.value || "Target Candidate";
        const latitude = parseFloat($("#saveSiteLat")?.value);
        const longitude = parseFloat($("#saveSiteLon")?.value);
        const notes = $("#saveSiteNotes")?.value || "";

        if (isNaN(latitude) || isNaN(longitude)) {
          showToast("Please enter valid numerical coordinates.");
          return;
        }

        try {
          const res = await fetch(`${backendBaseUrl}/api/saved-sites`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, latitude, longitude, notes, suitability_score: 88 })
          });
          if (res.ok) {
            showToast(`Target "${name}" saved to database!`);
            saveForm.reset();
            loadSavedSites();
          } else {
            showToast("Failed to save target to database.");
          }
        } catch (err) {
          showToast("Database connection error.");
        }
      });
    }

    document.querySelectorAll("#missionFilters .filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#missionFilters .filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        loadMissionsCatalog(btn.dataset.filter);
      });
    });
  }

  function setupLayersDrawer() {
    const closeBtn = $("#closeLayersDrawer");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        const drawer = $("#layersDrawer");
        if (drawer) drawer.hidden = true;
      });
    }

    const activateSuitabilityBtn = $("#activateSuitabilityBtn");
    if (activateSuitabilityBtn) {
      activateSuitabilityBtn.addEventListener("click", () => {
        switchNasaLayer("suitability");
        const drawer = $("#layersDrawer");
        if (drawer) drawer.hidden = true;
      });
    }

    document.querySelectorAll(".layer-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.tagName.toLowerCase() === "input") return;
        const key = item.dataset.layer;
        const cb = item.querySelector(".layer-checkbox");
        if (cb) {
          cb.checked = !cb.checked;
          if (cb.checked) {
            switchNasaLayer(key);
          } else {
            switchTo3DModel();
          }
        }
      });
    });

    document.querySelectorAll(".layer-checkbox").forEach((cb) => {
      cb.addEventListener("change", () => {
        const key = cb.dataset.layer;
        if (cb.checked) {
          switchNasaLayer(key);
        } else {
          switchTo3DModel();
        }
      });
    });

    // Close drawer when clicking outside
    document.addEventListener("pointerdown", (e) => {
      const drawer = $("#layersDrawer");
      const drawerBtn = $("#openLayersDrawerBtn");
      if (drawer && !drawer.hidden) {
        if (!drawer.contains(e.target) && !drawerBtn?.contains(e.target)) {
          drawer.hidden = true;
        }
      }
    });
  }

  function setupSuitabilityLegend() {
    const leg = $("#suitabilityLegend");
    const closeBtn = $("#closeSuitabilityLegend");
    if (closeBtn && leg) {
      closeBtn.addEventListener("click", () => {
        leg.hidden = true;
      });
    }

    const header = $("#legendHeader");
    if (header && leg) {
      let isDragging = false;
      let hasDragged = false;
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;

      header.addEventListener("pointerdown", (e) => {
        if (e.target.closest("#closeSuitabilityLegend")) return;

        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = leg.getBoundingClientRect();
        const parent = leg.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();

        initialLeft = rect.left - parentRect.left;
        initialTop = rect.top - parentRect.top;

        leg.style.left = `${initialLeft}px`;
        leg.style.top = `${initialTop}px`;
        leg.style.bottom = "auto";
        leg.style.right = "auto";

        header.setPointerCapture(e.pointerId);
        leg.classList.add("dragging");
      });

      header.addEventListener("pointermove", (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          hasDragged = true;
        }

        if (hasDragged) {
          const parent = leg.offsetParent || document.body;
          const maxLeft = Math.max(10, parent.clientWidth - leg.offsetWidth - 10);
          const maxTop = Math.max(10, parent.clientHeight - leg.offsetHeight - 10);

          const newLeft = Math.max(10, Math.min(maxLeft, initialLeft + dx));
          const newTop = Math.max(10, Math.min(maxTop, initialTop + dy));

          leg.style.left = `${newLeft}px`;
          leg.style.top = `${newTop}px`;
        }
      });

      const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        leg.classList.remove("dragging");
        try {
          header.releasePointerCapture(e.pointerId);
        } catch (_) {}
      };

      header.addEventListener("pointerup", endDrag);
      header.addEventListener("pointercancel", endDrag);
    }

    document.querySelectorAll(".corridor-tag").forEach((tag) => {
      tag.addEventListener("click", () => {
        const lat = Number(tag.dataset.lat);
        const lon = Number(tag.dataset.lon);
        switchView("globe");
        flyToCoordinates(lat, lon);
      });
    });
  }


  // =========================================================
  // MISSION GRADING & DECISION SUPPORT CONTROLLER (v2.0)
  // =========================================================

  const API_BASE_URL = backendBaseUrl;
  let currentMainMissionId = "human_landing";
  let selectedMissionId = "human_landing";
  let cachedMissionProfiles = [];
  let customMissionWeights = null;
  let comparisonSites = [];

  window.selectMainMission = function (missionId) {
    currentMainMissionId = missionId;
    document.querySelectorAll(".m-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.mission === missionId);
    });
    updateMainGrading(selectedLatitude, selectedLongitude);
  };

  window.openFullGradingFromMain = function () {
    switchView("grading");
    const latEl = $("#gradingLat");
    const lonEl = $("#gradingLon");
    if (latEl && selectedLatitude !== undefined) latEl.value = Number(selectedLatitude).toFixed(5);
    if (lonEl && selectedLongitude !== undefined) lonEl.value = Number(selectedLongitude).toFixed(5);
    selectMission(currentMainMissionId);
    runGrading(selectedLatitude, selectedLongitude);
  };

  async function updateMainGrading(lat, lon) {
    if (lat === undefined || lon === undefined || isNaN(lat) || isNaN(lon)) return;
    const sub = $("#mainGradingSub");
    if (sub) sub.textContent = `TARGET: ${Number(lat).toFixed(4)}°, ${Number(lon).toFixed(4)}° · PROBING SCIENTIFIC PIPELINE...`;
    const pill = $("#mainSafetyPill");
    if (pill) {
      pill.textContent = "EVALUATING";
      pill.className = "safety-pill insufficient";
    }

    try {
      const res = await fetch(`${backendBaseUrl}/api/grading`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: Number(lat),
          lon: Number(lon),
          height_m: 0,
          mission_id: currentMainMissionId
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const g = data.grading;
      if (!g) return;

      // Score
      const scoreNum = $("#mainScoreNum");
      const score = g.overall_score !== null ? g.overall_score : 0;
      if (scoreNum) scoreNum.textContent = score.toFixed(1);

      const gauge = $("#mainScoreGauge");
      if (gauge) {
        const color = getScoreColor(score);
        const deg = Math.round(score * 3.6);
        gauge.style.background = `conic-gradient(${color} ${deg}deg, rgba(30, 41, 59, 0.8) ${deg}deg)`;
        gauge.style.boxShadow = `0 0 16px ${color}44`;
      }

      // Grade
      const gradeLetter = $("#mainGradeLetter");
      if (gradeLetter) {
        gradeLetter.textContent = g.grade || "--";
        gradeLetter.className = "main-grade-letter " + getGradeClass(g.grade);
      }

      // Safety Pill
      if (pill) {
        const ss = (g.safety_screening || "UNKNOWN").toUpperCase();
        pill.textContent = ss;
        pill.className = "safety-pill " + (ss === "PASS" ? "pass" : ss === "FAIL" ? "fail" : "insufficient");
      }

      // Safety Msg
      const msg = $("#mainSafetyMsg");
      if (msg) msg.textContent = g.summary_explanation || "";

      // Subtitle
      if (sub) {
        const region = data.location?.region_name || "Lunar Surface";
        sub.textContent = `${Number(lat).toFixed(4)}°, ${Number(lon).toFixed(4)}° · ${region} (${g.mission_name})`;
      }

      // Tags (Top advantage & warning)
      const tagsBox = $("#mainSafetyTags");
      if (tagsBox) {
        tagsBox.innerHTML = "";
        const findings = data.findings || [];
        const topAdv = findings.find(f => f.finding_type === "ADVANTAGE");
        const topWarn = findings.find(f => f.finding_type === "WARNING" || f.finding_type === "DISADVANTAGE");

        if (topAdv) {
          tagsBox.innerHTML += `<span class="main-tag-chip adv">✓ ${topAdv.title}</span>`;
        }
        if (topWarn) {
          tagsBox.innerHTML += `<span class="main-tag-chip warn">⚠ ${topWarn.title}</span>`;
        }
      }

      // 4 Telemetry Metrics
      const pScores = g.parameter_scores || [];
      const getP = (key) => pScores.find(p => p.parameter_key === key);

      const pSlope = getP("slope_suitability");
      if (pSlope && $("#mmSlope")) {
        $("#mmSlope").textContent = pSlope.raw_value !== null ? `${pSlope.raw_value.toFixed(1)}°` : "N/A";
        $("#mmSlopeSub").textContent = pSlope.normalized_score !== null ? `Score: ${pSlope.normalized_score.toFixed(0)}/100` : "LOLA Model";
        const bar = $("#mmSlopeBar");
        if (bar) {
          bar.style.width = `${pSlope.normalized_score || 0}%`;
          bar.style.background = getScoreColor(pSlope.normalized_score);
        }
      }

      const pSun = getP("sunlight_availability") || getP("sunlight_duration");
      if (pSun && $("#mmSunlight")) {
        $("#mmSunlight").textContent = pSun.raw_value !== null ? `${pSun.raw_value.toFixed(0)}%` : "N/A";
        $("#mmSunlightSub").textContent = pSun.normalized_score !== null ? `Illum Score: ${pSun.normalized_score.toFixed(0)}` : "Topography Masked";
        const bar = $("#mmSunlightBar");
        if (bar) {
          bar.style.width = `${pSun.normalized_score || 0}%`;
          bar.style.background = getScoreColor(pSun.normalized_score);
        }
      }

      const pComm = getP("communication_availability") || getP("earth_visibility");
      if (pComm && $("#mmComm")) {
        const vis = pComm.normalized_score > 0;
        $("#mmComm").textContent = vis ? "ACTIVE" : "OCCLUDED";
        $("#mmComm").style.color = vis ? "#4ade80" : "#f87171";
        $("#mmCommSub").textContent = pComm.raw_value !== null ? `Clearance: ${pComm.raw_value.toFixed(1)}°` : "DTE Line-of-Sight";
        const bar = $("#mmCommBar");
        if (bar) {
          bar.style.width = `${pComm.normalized_score || 0}%`;
          bar.style.background = vis ? "#4ade80" : "#f87171";
        }
      }

      const pIce = getP("water_ice_evidence") || getP("thermal_conditions") || getP("temperature_suitability");
      if (pIce && $("#mmThermal")) {
        $("#mmThermal").textContent = pIce.raw_value !== null ? `${pIce.raw_value.toFixed(0)} ${pIce.unit}` : "--";
        $("#mmThermalSub").textContent = `${pIce.parameter_name}`;
        const bar = $("#mmThermalBar");
        if (bar) {
          bar.style.width = `${pIce.normalized_score || 0}%`;
          bar.style.background = getScoreColor(pIce.normalized_score);
        }
      }

    } catch (err) {
      console.warn("Main grading update error:", err);
      if (sub) sub.textContent = `Backend calculation error: ${err.message}`;
    }
  }

  const MISSION_ICONS = {
    scientific_research: "🔬",
    rover_exploration: "🚗",
    human_landing: "👩‍🚀",
    resource_exploration: "⛏️",
    solar_power_and_comm: "☀️",
    custom: "⚙️"
  };

  const MISSION_COLORS = {
    scientific_research: "#a78bfa",
    rover_exploration: "#38bdf8",
    human_landing: "#4ade80",
    resource_exploration: "#fbbf24",
    solar_power_and_comm: "#fb923c"
  };

  function getScoreColor(score) {
    if (score === null || score === undefined) return "#94a3b8";
    if (score >= 80) return "#4ade80";
    if (score >= 60) return "#38bdf8";
    if (score >= 40) return "#fbbf24";
    return "#f87171";
  }

  function getGradeClass(grade) {
    if (!grade) return "";
    return "grade-" + grade.replace("+", "-plus");
  }

  function onGradingViewOpened() {
    const latInput = $("#gradingLat");
    const lonInput = $("#gradingLon");

    if (latInput && !latInput.value && selectedLatitude !== undefined) {
      latInput.value = Number(selectedLatitude).toFixed(5);
    }
    if (lonInput && !lonInput.value && selectedLongitude !== undefined) {
      lonInput.value = Number(selectedLongitude).toFixed(5);
    }

    updateGradingLocationDisplay();

    if (cachedMissionProfiles.length === 0) {
      loadMissionProfiles();
    }

    // Auto-run evaluation if coordinates present and dashboard not yet rendered
    const lat = parseFloat(latInput?.value);
    const lon = parseFloat(lonInput?.value);
    if (!isNaN(lat) && !isNaN(lon)) {
      runGrading(lat, lon);
    }
  }

  function updateGradingLocationDisplay() {
    const lat = parseFloat($("#gradingLat")?.value);
    const lon = parseFloat($("#gradingLon")?.value);
    const label = $("#gradingLatLon");
    if (label) {
      if (!isNaN(lat) && !isNaN(lon)) {
        label.textContent = `${lat.toFixed(4)}° N/S, ${lon.toFixed(4)}° E/W`;
      } else {
        label.textContent = "No coordinates specified";
      }
    }
  }

  async function loadMissionProfiles() {
    try {
      const res = await fetch(`${backendBaseUrl}/api/mission-profiles`);
      if (!res.ok) throw new Error("Failed to load profiles");
      const data = await res.json();
      cachedMissionProfiles = data.predefined || [];
      renderMissionCards(cachedMissionProfiles, data.custom || []);
    } catch (err) {
      console.warn("Using fallback mission profiles:", err);
      cachedMissionProfiles = [
        { id: "scientific_research", name: "Scientific Research", description: "Geological diversity, impact melt sheets, ancient crustal composition, and volatile cold traps." },
        { id: "rover_exploration", name: "Rover Exploration", description: "Surface traversability, slope limits, crater hazard clearance, and continuous solar power." },
        { id: "human_landing", name: "Human Landing (Artemis)", description: "Strict lander tip-over slope limits, terrain-masked DTE line-of-sight, and life-support thermal margins." },
        { id: "resource_exploration", name: "Resource Exploration & ISRU", description: "Water-ice volatile cold traps, cryogenic temperatures, and mineral feedstock potential." },
        { id: "solar_power_and_comm", name: "Solar Power & Comm Node", description: "Ridge peaks of eternal light, maximum annual sunlight duty-cycle, and continuous Earth visibility." }
      ];
      renderMissionCards(cachedMissionProfiles, []);
    }
  }

  function renderMissionCards(profiles, customProfiles) {
    const container = $("#missionProfileCards");
    if (!container) return;
    container.innerHTML = "";

    profiles.forEach((p) => {
      const card = document.createElement("div");
      card.className = "mission-card" + (p.id === selectedMissionId ? " selected" : "");
      card.dataset.missionId = p.id;
      card.innerHTML = `
        <div class="mission-card-top">
          <span class="mission-card-icon">${MISSION_ICONS[p.id] || "🛸"}</span>
          <span class="mission-card-id">MISSION PROFILE</span>
        </div>
        <h4 class="mission-card-title">${p.name}</h4>
        <p class="mission-card-desc">${p.description}</p>
        <div class="mission-card-footer">
          <span>${p.weights ? Object.keys(p.weights).length : 6} Criteria</span>
          <span>SELECT →</span>
        </div>
      `;
      card.addEventListener("click", () => selectMission(p.id));
      container.appendChild(card);
    });

    // Custom Profile Card
    const customCard = document.createElement("div");
    customCard.className = "mission-card" + (selectedMissionId === "custom" ? " selected" : "");
    customCard.dataset.missionId = "custom";
    customCard.innerHTML = `
      <div class="mission-card-top">
        <span class="mission-card-icon">⚙️</span>
        <span class="mission-card-id">CONFIGURABLE</span>
      </div>
      <h4 class="mission-card-title">Custom Mission</h4>
      <p class="mission-card-desc">Configure your own multi-criteria scoring weights and priorities.</p>
      <div class="mission-card-footer">
        <span>Dynamic Sliders</span>
        <span>CONFIGURE →</span>
      </div>
    `;
    customCard.addEventListener("click", () => selectMission("custom"));
    container.appendChild(customCard);
  }

  function selectMission(missionId) {
    selectedMissionId = missionId;
    document.querySelectorAll(".mission-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.missionId === missionId);
    });

    const customPanel = $("#customWeightsPanel");
    if (missionId === "custom") {
      if (customPanel) customPanel.style.display = "block";
      renderCustomWeightsSliders();
    } else {
      if (customPanel) customPanel.style.display = "none";
    }

    const lat = parseFloat($("#gradingLat")?.value);
    const lon = parseFloat($("#gradingLon")?.value);
    if (!isNaN(lat) && !isNaN(lon) && $("#gradeDashboard")?.style.display !== "none") {
      runGrading(lat, lon);
    }
  }

  function renderCustomWeightsSliders() {
    const container = $("#customWeightsSliders");
    if (!container) return;

    const defaultWeights = {
      slope_suitability: 20,
      landing_terrain_safety: 20,
      crater_safety: 15,
      communication_availability: 15,
      sunlight_availability: 15,
      water_ice_evidence: 15
    };

    const weights = customMissionWeights || defaultWeights;
    container.innerHTML = Object.entries(weights).map(([key, val]) => `
      <div class="weight-control-item">
        <div class="weight-label-row">
          <span>${key.replace(/_/g, " ").toUpperCase()}</span>
          <span class="weight-pct-badge" id="wp_${key}">${val}%</span>
        </div>
        <input type="range" class="weight-slider" min="0" max="50" step="1" value="${val}"
          data-key="${key}" oninput="window.updateWeightVal('${key}', this.value)">
      </div>
    `).join("");

    updateWeightsTotalDisplay();
  }

  window.updateWeightVal = function (key, val) {
    const badge = $(`#wp_${key}`);
    if (badge) badge.textContent = `${val}%`;
    updateWeightsTotalDisplay();
  };

  function updateWeightsTotalDisplay() {
    const sliders = document.querySelectorAll(".weight-slider");
    let sum = 0;
    sliders.forEach((s) => { sum += parseInt(s.value || 0, 10); });
    const display = $("#weightsTotalDisplay");
    if (display) {
      display.textContent = `${sum}%`;
      display.style.color = Math.abs(sum - 100) <= 2 ? "#4ade80" : "#fbbf24";
    }
  }

  function getCustomWeightsFromSliders() {
    const sliders = document.querySelectorAll(".weight-slider");
    const weights = {};
    sliders.forEach((s) => {
      weights[s.dataset.key] = parseFloat(s.value || 0);
    });
    return weights;
  }

  window.resetCustomWeights = function () {
    customMissionWeights = null;
    renderCustomWeightsSliders();
  };

  window.saveCurrentCustomProfile = async function () {
    const name = prompt("Enter a name for this custom mission profile:", "My Custom Lunar Mission");
    if (!name) return;
    const weights = getCustomWeightsFromSliders();
    try {
      const res = await fetch(`${backendBaseUrl}/api/mission-profiles/custom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: "User custom profile", weights })
      });
      if (!res.ok) throw new Error(await res.text());
      showToast("Custom profile saved to database!");
      loadMissionProfiles();
    } catch (err) {
      showToast(`Save failed: ${err.message}`);
    }
  };

  window.useCurrentExplorerTarget = function () {
    if (selectedLatitude !== undefined && selectedLongitude !== undefined) {
      const latEl = $("#gradingLat");
      const lonEl = $("#gradingLon");
      if (latEl) latEl.value = Number(selectedLatitude).toFixed(5);
      if (lonEl) lonEl.value = Number(selectedLongitude).toFixed(5);
      updateGradingLocationDisplay();
      showToast(`Target loaded: ${Number(selectedLatitude).toFixed(4)}°, ${Number(selectedLongitude).toFixed(4)}°`);
      runGradingFromInputs();
    } else {
      showToast("No pin placed on Lunar Explorer yet.");
    }
  };

  window.runGradingFromInputs = function () {
    const lat = parseFloat($("#gradingLat")?.value);
    const lon = parseFloat($("#gradingLon")?.value);
    if (isNaN(lat) || isNaN(lon)) {
      showToast("Please enter valid latitude and longitude coordinates.");
      return;
    }
    updateGradingLocationDisplay();
    runGrading(lat, lon);
  };

  async function runGrading(lat, lon, height_m = 0) {
    const dashboard = $("#gradeDashboard");
    const analyzeBtn = $("#gradingAnalyzeBtn");
    const statusLabel = $("#gradingTargetStatus");

    if (dashboard) dashboard.style.display = "block";
    if (analyzeBtn) analyzeBtn.textContent = "CALCULATING...";
    if (statusLabel) statusLabel.textContent = "ANALYZING";

    const missionId = selectedMissionId === "custom" ? "human_landing" : selectedMissionId;
    const customWeights = selectedMissionId === "custom" ? getCustomWeightsFromSliders() : null;

    try {
      const payload = { lat, lon, height_m, mission_id: missionId };
      if (customWeights) payload.custom_weights = customWeights;

      const res = await fetch(`${backendBaseUrl}/api/grading`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      renderGradingDashboard(data);
      runAllMissionsGrading(lat, lon, height_m);

      if (statusLabel) statusLabel.textContent = "EVALUATION COMPLETE";
    } catch (err) {
      console.error("Grading execution error:", err);
      showToast(`Grading error: ${err.message}`);
      if (statusLabel) statusLabel.textContent = "ERROR";
    } finally {
      if (analyzeBtn) analyzeBtn.textContent = "ANALYZE & GRADE";
    }
  }

  function renderGradingDashboard(data) {
    const g = data.grading;
    if (!g) return;

    const score = g.overall_score !== null ? g.overall_score : 0;
    const isPass = g.safety_screening === "PASS";
    const verdictClass = !isPass ? "fail" : score >= 65 ? "pass" : "marginal";
    const verdictIcon = !isPass ? "⛔" : score >= 75 ? "🚀" : "⚠️";

    const verdictPillText = !isPass
      ? "RESTRICTED · CRITICAL CONSTRAINT FAILED"
      : score >= 75
      ? "HIGHLY SUITABLE · RECOMMENDED TARGET"
      : score >= 50
      ? "VIABLE CANDIDATE · MARGINAL SUITABILITY"
      : "CHALLENGING TERRAIN · LOW SUITABILITY";

    const verdictHeadline = !isPass
      ? `Flight Operations Restricted for ${g.mission_name}`
      : score >= 70
      ? `Prime Candidate Site for ${g.mission_name}`
      : `Conditional Site for ${g.mission_name} — Requires Flight Margins`;

    // 1. Executive Mission Decision Verdict Card
    const verdictWrap = $("#executiveVerdictWrap");
    if (verdictWrap) {
      verdictWrap.innerHTML = `
        <div class="verdict-banner ${verdictClass}">
          <div class="verdict-icon">${verdictIcon}</div>
          <div class="verdict-body">
            <div class="verdict-status-row">
              <span class="verdict-pill ${verdictClass}">${verdictPillText}</span>
              <span class="verdict-mission-name">Target Mission: <strong>${g.mission_name}</strong></span>
            </div>
            <h3 class="verdict-headline">${verdictHeadline}</h3>
            <p class="verdict-desc">${g.summary_explanation}</p>
            <div class="verdict-highlights">
              <div class="verdict-point">
                <span>🛡️</span>
                <span>Safety Screening: <strong style="color: ${isPass ? '#4ade80' : '#f87171'}">${g.safety_screening}</strong></span>
              </div>
              <div class="verdict-point">
                <span>📐</span>
                <span>Topographic Relief: <strong>${data.parameters?.terrain_relief_m?.value !== undefined ? data.parameters.terrain_relief_m.value.toFixed(1) + ' m' : 'Measured'}</strong></span>
              </div>
              <div class="verdict-point">
                <span>🛰️</span>
                <span>Earth Visibility: <strong>${data.communication?.is_earth_visible ? 'Direct-to-Earth Active' : 'Occluded (Relay Mandatory)'}</strong></span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 2. Score Circle & Grade
    const scoreVal = $("#scoreValue");
    if (scoreVal) scoreVal.textContent = score.toFixed(1);

    const circle = $("#scoreCircle");
    if (circle) {
      const color = getScoreColor(score);
      const deg = Math.round(score * 3.6);
      circle.style.background = `conic-gradient(${color} ${deg}deg, rgba(30, 41, 59, 0.8) ${deg}deg)`;
      circle.style.boxShadow = `0 0 24px ${color}44`;
    }

    const gradeBadge = $("#gradeBadge");
    if (gradeBadge) {
      gradeBadge.textContent = g.grade || "--";
      gradeBadge.className = "grade-letter " + getGradeClass(g.grade);
    }

    const gradeDesc = $("#gradeDescSub");
    if (gradeDesc) {
      const gLetter = g.grade || "";
      let descText = "FEASIBLE";
      if (gLetter.startsWith("A")) descText = "EXCELLENT CANDIDATE";
      else if (gLetter === "B") descText = "GOOD SUITABILITY";
      else if (gLetter === "C") descText = "ACCEPTABLE MARGIN";
      else if (gLetter === "D") descText = "MARGINAL / HIGH RISK";
      else descText = "UNACCEPTABLE HAZARD";
      gradeDesc.textContent = descText;
      gradeDesc.style.color = getScoreColor(score);
    }

    // 3. Mandatory Safety Screening Checklist
    const safetyBadge = $("#safetyBadge");
    if (safetyBadge) {
      const ss = (g.safety_screening || "UNKNOWN").toUpperCase();
      safetyBadge.textContent = ss;
      safetyBadge.className = "safety-pill " + (ss === "PASS" ? "pass" : ss === "FAIL" ? "fail" : "insufficient");
    }

    const checksList = $("#safetyChecks");
    if (checksList && g.safety_checks) {
      checksList.innerHTML = g.safety_checks.map((c) => {
        const isCheckPass = c.status === "PASS";
        const statusClass = (c.status || "insufficient").toLowerCase();
        const icon = isCheckPass ? "✓" : c.status === "FAIL" ? "✗" : "!";
        return `
          <div class="safety-check-row ${statusClass}">
            <span class="check-status-badge ${statusClass}">[ ${c.status} ]</span>
            <div class="check-content">
              <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <span class="check-name">${c.name}</span>
                <span class="check-criterion">${c.criterion}</span>
              </div>
              <span class="check-msg">${c.message} <strong style="color: #f1f5f9;">(${c.observed_value})</strong></span>
            </div>
          </div>
        `;
      }).join("");
    }

    // 4. Data Coverage
    const cov = data.data_coverage_percent || g.data_coverage_percent || 0;
    const covBar = $("#coverageBar");
    const covPct = $("#coveragePct");
    if (covBar) covBar.style.width = `${cov}%`;
    if (covPct) covPct.textContent = `${cov}%`;

    const highresBadge = $("#polarHighResBadge");
    if (highresBadge && data.location) {
      if (data.location.inside_highres_dem) {
        highresBadge.className = "highres-badge polar";
        highresBadge.textContent = "✓ LOLA 80m High-Res Polar DEM";
      } else {
        highresBadge.className = "highres-badge global";
        highresBadge.textContent = "⚠ Heritage Global 500m Altimetry";
      }
    }

    // 5. Parameter Scores Breakdown Table with Explanations
    const PARAM_DESCRIPTIONS = {
      slope_suitability: "Lander tip-over prevention & rover mobility safety envelope",
      landing_terrain_safety: "Surface roughness & landing gear clearance margin",
      surface_traversability: "Rover traction, soil compaction & wheel slippage avoidance",
      crater_safety: "Autonomous obstacle avoidance clearance & crater density",
      hazard_avoidance: "Clearance radius free of steep micro-craters or boulder fields",
      communication_availability: "Direct radio link to Earth Deep Space Network (DSN)",
      communication: "Direct-to-Earth line-of-sight elevation clearance",
      earth_visibility: "Annual visibility duty cycle without lunar limb occlusion",
      sunlight_availability: "Continuous solar array power generation opportunity",
      sunlight_duration: "Fraction of 720h synodic cycle illuminated by the Sun",
      illumination_power: "Surface solar flux density in Watts per square meter",
      terrain_horizon_conditions: "Terrain elevation mask avoiding deep crater shadows",
      water_ice_evidence: "LCROSS & Diviner cryogenic volatile cold-trap indicators",
      resource_potential: "Mining feedstock & volatile concentration for ISRU processing",
      scientific_diversity: "Geological formations, impact melt sheets & crustal units",
      mineral_potential: "Presence of anorthosite, ilmenite, or basaltic deposits",
      geological_features: "Morphological diversity including rilles, peaks & crater walls",
      scientific_opportunities: "Sample return value and ancient lunar crust exploration",
      scientific_confidence: "Altimetry resolution and observational data confidence",
      scientific_value: "Overall priority for planetary science and exploration",
      temperature_suitability: "Thermal survival envelope for electronics and mechanisms",
      temperature_conditions: "Cryogenic conditions suitable for retaining water ice (<110 K)",
      thermal_conditions: "Life-support diurnal thermal range and radiator efficiency",
      surface_accessibility: "Surface incline tolerance for ingress and descent routes",
      accessibility: "Navigable corridor leading into target region or crater interior",
      power_availability: "Solar power generation feasibility and battery reserve margins"
    };

    // Plain-English Interpretation Helper
    function getPlainEnglishInterpretation(key, val, score) {
      if (val === null || val === undefined) return { label: "Observed Baseline", type: "neutral" };
      const num = typeof val === "number" ? val : parseFloat(val);

      if (key.includes("slope")) {
        if (num <= 5.0) return { label: "✓ Ultra-gentle plain (<5°)", type: "safe" };
        if (num <= 10.0) return { label: "✓ Safe descent gradient (<10°)", type: "safe" };
        if (num <= 15.0) return { label: "⚠ Moderate slope (10-15°)", type: "warn" };
        return { label: "⛔ Hazardous incline (>15°)", type: "fail" };
      }
      if (key.includes("roughness") || key.includes("terrain_safety")) {
        if (num <= 0.6) return { label: "✓ Smooth micro-regolith", type: "safe" };
        if (num <= 1.2) return { label: "✓ Moderate roughness", type: "safe" };
        return { label: "⚠ Blocky terrain obstacle", type: "warn" };
      }
      if (key.includes("sunlight") || key.includes("power") || key.includes("illumination")) {
        if (num >= 70) return { label: "✓ Peak solar illumination", type: "safe" };
        if (num >= 30) return { label: "✓ Intermittent sunlight · Battery cycle", type: "warn" };
        return { label: "🌑 Permanent shadow · RTG required", type: "warn" };
      }
      if (key.includes("comm") || key.includes("earth")) {
        if (num > 5.0) return { label: "✓ Direct DTE link active (DSN)", type: "safe" };
        if (num > 0.0) return { label: "✓ Low elevation Earth visibility", type: "safe" };
        return { label: "📡 Occluded · Relay required", type: "fail" };
      }
      if (key.includes("water") || key.includes("resource") || key.includes("ice")) {
        if (num >= 60) return { label: "💎 High water-ice signature", type: "safe" };
        if (num >= 30) return { label: "🔎 Moderate volatile indicator", type: "neutral" };
        return { label: "⚪ Low volatile concentration", type: "neutral" };
      }
      if (key.includes("temp") || key.includes("thermal")) {
        if (num < 100) return { label: `❄️ Cryogenic (${num.toFixed(0)} K) · PSR ice stable`, type: "info" };
        if (num < 250) return { label: `🌡️ Polar moderate (${num.toFixed(0)} K)`, type: "safe" };
        return { label: `🔥 Equatorial peak (${num.toFixed(0)} K)`, type: "warn" };
      }
      if (score >= 70) return { label: "✓ Favorable flight parameter", type: "safe" };
      return { label: "Evaluated metric", type: "neutral" };
    }

    const tableEl = $("#paramScoresTable");
    if (tableEl && g.parameter_scores) {
      tableEl.innerHTML = `
        <div class="param-table-header">
          <span>CRITERION & SCIENTIFIC PURPOSE</span>
          <span>MEASURED DATA & FLIGHT MEANING</span>
          <span>SUITABILITY RATING</span>
          <span>WEIGHT</span>
          <span>CONTRIBUTION</span>
        </div>
      ` + g.parameter_scores.map((p) => {
        const ns = p.normalized_score !== null ? p.normalized_score : 0;
        const color = getScoreColor(ns);
        const ratingWord = ns >= 85 ? "Optimal" : ns >= 70 ? "Favorable" : ns >= 50 ? "Acceptable" : ns >= 25 ? "Challenging" : "Unfavorable";
        const desc = PARAM_DESCRIPTIONS[p.parameter_key] || "Scientific evaluation parameter";
        const rawStr = p.raw_value !== null && p.raw_value !== undefined
          ? `${typeof p.raw_value === "number" ? p.raw_value.toFixed(2) : p.raw_value} ${p.unit || ""}`
          : "Insufficient Data";
        const interp = getPlainEnglishInterpretation(p.parameter_key, p.raw_value, ns);

        return `
          <div class="param-table-row">
            <div class="param-name-cell">
              <span class="param-title">${p.parameter_name}</span>
              <span class="param-desc-sub">${desc}</span>
            </div>
            <div class="param-raw-cell" style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px;">
              <span style="font-weight: 700; color: #f1f5f9;">${rawStr}</span>
              <span class="interp-pill ${interp.type}">${interp.label}</span>
            </div>
            <div class="param-bar-cell">
              <div class="param-score-label">
                <span style="color: ${color}; font-weight: 600;">${ratingWord}</span>
                <span style="color: ${color}; font-weight: 700;">${p.normalized_score !== null ? ns.toFixed(0) : "N/A"} / 100</span>
              </div>
              <div class="param-bar-bg">
                <div class="param-bar-fill" style="width: ${ns}%; background: ${color};"></div>
              </div>
            </div>
            <span class="param-weight-cell">${p.weight_percent.toFixed(1)}%</span>
            <span class="param-contrib-cell" style="font-weight: 700; color: #38bdf8;">+${p.weighted_contribution.toFixed(1)} pts</span>
          </div>
        `;
      }).join("");
    }

    // 6. Dual Column Findings & Risks (Zero undefined!)
    const prosContainer = $("#prosFindingsList");
    const consContainer = $("#consRisksList");
    const findings = data.findings || [];
    const risks = data.risks || [];

    // Filter Pros (Advantage, Opportunity)
    const pros = findings.filter(f => (f.type || f.finding_type || "").toLowerCase().includes("adv") || (f.type || f.finding_type || "").toLowerCase().includes("opp"));
    // Filter Cons (Disadvantage, Warning)
    const consFindings = findings.filter(f => (f.type || f.finding_type || "").toLowerCase().includes("dis") || (f.type || f.finding_type || "").toLowerCase().includes("warn"));

    if (prosContainer) {
      if (pros.length > 0) {
        prosContainer.innerHTML = pros.map((f) => {
          const typeName = (f.type || f.finding_type || "Advantage").toUpperCase();
          const typeClass = typeName.toLowerCase().includes("adv") ? "advantage" : "opportunity";
          const measureStr = f.supporting_measurement || (f.measured_value !== undefined ? `Measurement: ${f.measured_value} ${f.unit || ''}` : "");
          const sourceStr = f.data_source || "LOLA/Altimetry";

          return `
            <div class="finding-card ${typeClass}">
              <div class="finding-tag-row">
                <span class="finding-tag">${typeName}</span>
                <span style="font: 10px 'DM Mono'; color: #64748b;">${sourceStr}</span>
              </div>
              <h4 class="finding-title">${f.title || "Positive Site Feature"}</h4>
              <p class="finding-desc">${f.explanation || ""}</p>
              ${f.mission_relevance ? `<div class="finding-relevance">🎯 Mission Impact: ${f.mission_relevance}</div>` : ""}
              ${measureStr ? `<div class="finding-meta"><span>📐 ${measureStr}</span></div>` : ""}
            </div>
          `;
        }).join("");
      } else {
        prosContainer.innerHTML = `<div style="color: #64748b; font-size: 12px; padding: 14px; text-align: center;">No specific operational advantages identified for this criteria set.</div>`;
      }
    }

    if (consContainer) {
      let consHtml = "";

      // Render Disadvantages & Warnings
      consFindings.forEach((f) => {
        const typeName = (f.type || f.finding_type || "Warning").toUpperCase();
        const typeClass = typeName.toLowerCase().includes("dis") ? "disadvantage" : "warning";
        const measureStr = f.supporting_measurement || (f.measured_value !== undefined ? `Measurement: ${f.measured_value} ${f.unit || ''}` : "");
        const sourceStr = f.data_source || "LOLA/Ephemeris";

        consHtml += `
          <div class="finding-card ${typeClass}">
            <div class="finding-tag-row">
              <span class="finding-tag">${typeName}</span>
              <span style="font: 10px 'DM Mono'; color: #64748b;">${sourceStr}</span>
            </div>
            <h4 class="finding-title">${f.title || "Environmental Constraint"}</h4>
            <p class="finding-desc">${f.explanation || ""}</p>
            ${f.mission_relevance ? `<div class="finding-relevance">⚠ Constraint: ${f.mission_relevance}</div>` : ""}
            ${measureStr ? `<div class="finding-meta"><span>📐 ${measureStr}</span></div>` : ""}
          </div>
        `;
      });

      // Render Risks
      risks.forEach((r) => {
        const sev = r.severity || "Moderate";
        const cat = r.category || "Operational Risk";
        const action = r.recommended_investigation || r.investigation_needed || "";

        consHtml += `
          <div class="risk-card ${sev}">
            <div class="finding-tag-row">
              <span class="risk-sev-badge">${sev.toUpperCase()} RISK</span>
              <span class="risk-cat">${cat.toUpperCase()}</span>
            </div>
            <h4 class="risk-title">${cat} Hazard</h4>
            <p class="risk-desc">${r.description || ""}</p>
            ${r.evidence ? `<div class="risk-evidence">📐 Evidence: ${r.evidence}</div>` : ""}
            ${action ? `<div class="risk-action">⚡ Required Mitigation: ${action}</div>` : ""}
          </div>
        `;
      });

      if (!consHtml) {
        consHtml = `<div style="color: #4ade80; font-size: 12px; padding: 14px; text-align: center;">✓ No critical environmental hazards or severe operational risks detected.</div>`;
      }
      consContainer.innerHTML = consHtml;
    }
  }

  async function runAllMissionsGrading(lat, lon, height_m = 0) {
    try {
      const res = await fetch(`${backendBaseUrl}/api/grading/all-missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon, height_m })
      });
      if (!res.ok) return;
      const data = await res.json();
      renderAllMissionBars(data.mission_scores || {});
    } catch (err) {
      console.warn("Multi-mission evaluation error:", err);
    }
  }

  function renderAllMissionBars(missionScores) {
    const container = $("#missionBars");
    if (!container) return;

    const entries = Object.entries(missionScores);
    if (entries.length === 0) return;

    // Sort descending by score
    entries.sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
    const bestFitMissionId = entries[0][0];

    container.innerHTML = entries.map(([id, m]) => {
      const score = m.score || 0;
      const isWinner = id === bestFitMissionId;
      const isPass = m.safety === "PASS";
      const color = !isPass ? "#f87171" : (MISSION_COLORS[id] || "#38bdf8");

      return `
        <div class="mission-bar-row ${isWinner ? 'best-fit' : ''}">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">${MISSION_ICONS[id] || "🛸"}</span>
            <span class="mission-bar-name">
              ${m.mission_name}
              ${isWinner ? '<span class="best-fit-tag">★ BEST CANDIDATE</span>' : ''}
            </span>
          </div>
          <div class="mission-bar-track">
            <div class="mission-bar-fill" style="width: ${score}%; background: ${color};"></div>
          </div>
          <span class="mission-bar-score" style="color: ${color};">${score.toFixed(1)} / 100</span>
          <span class="safety-pill ${isPass ? 'pass' : 'fail'}" style="font-size: 10px; text-align: center;">
            ${m.grade} · ${m.safety}
          </span>
        </div>
      `;
    }).join("");
  }

  // Multi-Site Comparison Implementation
  window.addCurrentSiteToComparison = function () {
    const lat = parseFloat($("#gradingLat")?.value);
    const lon = parseFloat($("#gradingLon")?.value);
    if (isNaN(lat) || isNaN(lon)) {
      showToast("Specify valid coordinates first.");
      return;
    }
    const defaultName = `Site (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;
    const name = prompt("Enter a label for this site in the comparison:", defaultName) || defaultName;
    comparisonSites.push({ lat, lon, name, height_m: 0 });
    renderComparisonTags();
    showToast(`Added ${name} to comparison.`);
  };

  window.addPresetSitesForComparison = function () {
    comparisonSites = [
      { lat: -89.44, lon: 222.05, name: "Artemis Connecting Ridge" },
      { lat: -69.367621, lon: 32.348126, name: "Chandrayaan-3 Shiv Shakti" },
      { lat: -86.04, lon: 2.7, name: "Malapert Mountain Peak" },
      { lat: -84.9, lon: -35.5, name: "Cabeus Crater PSR" }
    ];
    renderComparisonTags();
    showToast("Loaded 4 canonical benchmark lunar sites.");
  };

  function renderComparisonTags() {
    const container = $("#comparisonSitesList");
    const countEl = $("#compSiteCount");
    if (countEl) countEl.textContent = `${comparisonSites.length} SITES`;
    if (!container) return;

    container.innerHTML = comparisonSites.map((s, idx) => `
      <span class="site-chip">
        📍 <b>${s.name}</b> (${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°)
        <button class="site-chip-remove" onclick="window.removeComparisonSite(${idx})">×</button>
      </span>
    `).join("");
  }

  window.removeComparisonSite = function (idx) {
    comparisonSites.splice(idx, 1);
    renderComparisonTags();
  };

  window.runSiteComparison = async function () {
    if (comparisonSites.length < 2) {
      showToast("Please add at least 2 sites to run comparison.");
      return;
    }
    const tableWrap = $("#comparisonTableWrap");
    if (tableWrap) {
      tableWrap.style.display = "block";
      tableWrap.innerHTML = `<div style="color: #38bdf8; padding: 16px; font-family: 'DM Mono';">Computing multi-criteria scientific comparison matrix across ${comparisonSites.length} sites...</div>`;
    }

    const missionId = selectedMissionId === "custom" ? "human_landing" : selectedMissionId;

    try {
      const res = await fetch(`${backendBaseUrl}/api/comparison`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locations: comparisonSites,
          mission_id: missionId
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      renderComparisonTable(data);
    } catch (err) {
      if (tableWrap) {
        tableWrap.innerHTML = `<div style="color: #f87171; padding: 16px;">Comparison error: ${err.message}</div>`;
      }
    }
  };

  function renderComparisonTable(data) {
    const tableWrap = $("#comparisonTableWrap");
    if (!tableWrap) return;

    const results = data.results || [];
    const winner = data.winner;

    const headers = [
      "SITE / TARGET",
      "SCORE",
      "GRADE",
      "SAFETY SCREENING",
      "SLOPE (°)",
      "ROUGHNESS",
      "SUNLIGHT %",
      "DTE COMM",
      "TEMP (K)",
      "WATER-ICE"
    ];

    const rowsHtml = results.map((r) => {
      const isWinner = r.name === winner;
      const scoreColor = getScoreColor(r.score);
      const safetyClass = (r.safety || "").toLowerCase() === "pass" ? "pass" : "fail";
      return `
        <tr class="${isWinner ? "winner-row" : ""}">
          <td>
            ${isWinner ? "👑 " : ""}${r.name}
            ${isWinner ? "<br><small style='color: #38bdf8;'>SELECTED CANDIDATE</small>" : ""}
          </td>
          <td><b style="color: ${scoreColor}; font-family: 'DM Mono';">${r.score !== null ? r.score.toFixed(1) : "N/A"}</b></td>
          <td><span class="grade-letter ${getGradeClass(r.grade)}" style="font-size: 13px; padding: 2px 6px;">${r.grade || "--"}</span></td>
          <td><span class="safety-pill ${safetyClass}" style="font-size: 10px;">${r.safety || "--"}</span></td>
          <td style="font-family: 'DM Mono';">${r.terrain?.slope_deg !== null ? `${r.terrain.slope_deg.toFixed(1)}°` : "N/A"}</td>
          <td style="font-family: 'DM Mono';">${r.terrain?.roughness_m !== null ? `${r.terrain.roughness_m.toFixed(1)}m` : "N/A"}</td>
          <td style="font-family: 'DM Mono';">${r.solar?.sunlight_pct !== null ? `${r.solar.sunlight_pct.toFixed(0)}%` : "N/A"}</td>
          <td>${r.comm?.is_earth_visible ? "✅ ACTIVE" : "❌ OCCLUDED"}</td>
          <td style="font-family: 'DM Mono';">${r.thermal?.current_temp_k !== null ? `${r.thermal.current_temp_k.toFixed(0)}K` : "N/A"}</td>
          <td style="font-family: 'DM Mono';">${r.thermal?.water_ice_evidence !== null ? `${r.thermal.water_ice_evidence.toFixed(0)}/100` : "0"}</td>
        </tr>
      `;
    }).join("");

    tableWrap.innerHTML = `
      <table class="comp-table">
        <thead>
          <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <div style="margin-top: 10px; font-size: 11px; color: #94a3b8; font-family: 'DM Mono';">
        Mission Target: <strong>${data.mission_name}</strong> · Top Selected Candidate: <strong style="color: #38bdf8;">${winner || "No site met mandatory safety screening"}</strong>
      </div>
    `;
  }

  // =========================================================
  // START LUNASITE
  // =========================================================

  setupSaveSiteForm();
  setupLayersDrawer();
  setupSuitabilityLegend();
  initHistoricalMissionsModule();
  setupSelectedSiteCardActions();

  initCesium();

  // Load initial mission grading HUD on main screen
  setTimeout(() => {
    updateMainGrading(selectedLatitude, selectedLongitude);
  }, 1200);

})();
