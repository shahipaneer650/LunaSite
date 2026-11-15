
import math
import numpy as np

MOON_RADIUS_KM = 1737.4
SUN_RADIUS_KM = 695700.0
EARTH_RADIUS_KM = 6371.0


def enu_basis(lat_deg: float, lon_deg: float):
    """East, North, Up vectors in the Moon-fixed ME frame."""

    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)

    sl, cl = math.sin(lat), math.cos(lat)
    so, co = math.sin(lon), math.cos(lon)

    east = np.array([-so, co, 0.0])
    north = np.array([-sl * co, -sl * so, cl])
    up = np.array([cl * co, cl * so, sl])

    return east, north, up


def site_position_km(
    lat_deg: float,
    lon_deg: float,
    height_m: float = 0.0
):
    """Site position from Moon centre in kilometres."""

    _, _, up = enu_basis(lat_deg, lon_deg)

    return (MOON_RADIUS_KM + height_m / 1000.0) * up


def az_el_range(
    v_site_to_target: np.ndarray,
    lat_deg: float,
    lon_deg: float
):
    """Calculate azimuth, elevation and range."""

    east, north, up = enu_basis(lat_deg, lon_deg)

    E = east @ v_site_to_target
    N = north @ v_site_to_target
    U = up @ v_site_to_target

    rng = np.sqrt(E**2 + N**2 + U**2)

    az = np.degrees(np.arctan2(E, N)) % 360.0
    el = np.degrees(
        np.arcsin(np.clip(U / rng, -1.0, 1.0))
    )

    return az, el, rng


class LunarSky:

    def __init__(self):
        from skyfield.api import load
        from skyfield.planetarylib import PlanetaryConstants

        print("Loading JPL DE421 ephemeris...")

        self.ts = load.timescale()
        self.eph = load("de421.bsp")

        print("Loading lunar reference frame kernels...")

        pc = PlanetaryConstants()

        pc.read_text(load("moon_080317.tf"))
        pc.read_text(load("pck00008.tpc"))
        pc.read_binary(
            load("moon_pa_de421_1900-2050.bpc")
        )

        self.frame = pc.build_frame_named(
            "MOON_ME_DE421"
        )

        print("Lunar astronomy engine initialized.")

    def compute(
        self,
        t,
        lat_deg: float,
        lon_deg: float,
        height_m: float = 0.0,
        aberration: bool = False
    ):
        """Calculate Sun and Earth positions from a lunar site."""

        moon_at = self.eph["moon"].at(t)

        site = site_position_km(
            lat_deg,
            lon_deg,
            height_m
        )

        if np.ndim(t.tt):
            site = site[:, None]

        output = {}

        targets = {
            "sun": SUN_RADIUS_KM,
            "earth": EARTH_RADIUS_KM
        }

        for name, radius in targets.items():

            observation = moon_at.observe(
                self.eph[name]
            )

            if aberration:
                observation = observation.apparent()

            vector_me = observation.frame_xyz(
                self.frame
            ).km

            az, el, distance = az_el_range(
                vector_me - site,
                lat_deg,
                lon_deg
            )

            angular_diameter = 2.0 * np.degrees(
                np.arcsin(
                    np.clip(radius / distance, -1.0, 1.0)
                )
            )

            output[name] = {
                "azimuth_deg": float(np.asarray(az)),
                "elevation_deg": float(np.asarray(el)),
                "range_km": float(np.asarray(distance)),
                "angular_diameter_deg": float(
                    np.asarray(angular_diameter)
                )
            }

        return output
