import os
import sys
import json

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from scripts.sync_authoritative_datasets import (
    ALL_AUTHORITATIVE_MISSIONS,
    ALL_AUTHORITATIVE_FEATURES,
    ALL_AUTHORITATIVE_PROFILES
)

def sql_escape(val):
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    # String
    s = str(val).replace("'", "''")
    return f"'{s}'"

out_path = os.path.join(BACKEND_DIR, "supabase_seed_all.sql")

with open(out_path, "w", encoding="utf-8") as f:
    f.write("-- ==============================================================================\n")
    f.write("-- LUNASITE — COMPLETE SUPABASE DATABASE SYNC (NASA, ISRO, CNSA, USSR, JAXA, CLPS)\n")
    f.write("-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard/project/ceasfzjikaebrrnvtamu/sql)\n")
    f.write("-- ==============================================================================\n\n")

    f.write("-- 1. Update Row-Level Security (RLS) to permit public INSERT/UPDATE\n")
    f.write("DROP POLICY IF EXISTS \"Public read lunar missions\" ON public.lunar_missions;\n")
    f.write("DROP POLICY IF EXISTS \"Public read/write lunar missions\" ON public.lunar_missions;\n")
    f.write("CREATE POLICY \"Public read/write lunar missions\" ON public.lunar_missions FOR ALL USING (true);\n\n")

    f.write("DROP POLICY IF EXISTS \"Public read lunar features\" ON public.lunar_features;\n")
    f.write("DROP POLICY IF EXISTS \"Public read/write lunar features\" ON public.lunar_features;\n")
    f.write("CREATE POLICY \"Public read/write lunar features\" ON public.lunar_features FOR ALL USING (true);\n\n")

    f.write("DROP POLICY IF EXISTS \"Public read/write custom profiles\" ON public.custom_mission_profiles;\n")
    f.write("CREATE POLICY \"Public read/write custom profiles\" ON public.custom_mission_profiles FOR ALL USING (true);\n\n")

    f.write("-- 2. Upsert Authoritative Lunar Missions (38 Missions across NASA, ISRO, CNSA, USSR, JAXA, CLPS)\n")
    f.write("INSERT INTO public.lunar_missions (name, agency, landing_date, latitude_deg, longitude_deg, site_name, status, category, description, scientific_significance)\nVALUES\n")
    
    m_lines = []
    for m in ALL_AUTHORITATIVE_MISSIONS:
        line = f"    ({sql_escape(m['name'])}, {sql_escape(m['agency'])}, {sql_escape(m['landing_date'])}, {sql_escape(m['latitude_deg'])}, {sql_escape(m['longitude_deg'])}, {sql_escape(m['site_name'])}, {sql_escape(m['status'])}, {sql_escape(m['category'])}, {sql_escape(m['description'])}, {sql_escape(m['scientific_significance'])})"
        m_lines.append(line)
    
    f.write(",\n".join(m_lines))
    f.write("\nON CONFLICT (name) DO UPDATE SET\n")
    f.write("    agency = EXCLUDED.agency,\n")
    f.write("    landing_date = EXCLUDED.landing_date,\n")
    f.write("    latitude_deg = EXCLUDED.latitude_deg,\n")
    f.write("    longitude_deg = EXCLUDED.longitude_deg,\n")
    f.write("    site_name = EXCLUDED.site_name,\n")
    f.write("    status = EXCLUDED.status,\n")
    f.write("    category = EXCLUDED.category,\n")
    f.write("    description = EXCLUDED.description,\n")
    f.write("    scientific_significance = EXCLUDED.scientific_significance;\n\n")

    f.write("-- 3. Upsert Lunar Features & Permanently Shadowed Regions (18 Features)\n")
    f.write("INSERT INTO public.lunar_features (name, feature_type, latitude_deg, longitude_deg, diameter_km, depth_m, permanently_shadowed, ice_potential, description)\nVALUES\n")
    
    feat_lines = []
    for feat in ALL_AUTHORITATIVE_FEATURES:
        line = f"    ({sql_escape(feat['name'])}, {sql_escape(feat['feature_type'])}, {sql_escape(feat['latitude_deg'])}, {sql_escape(feat['longitude_deg'])}, {sql_escape(feat['diameter_km'])}, {sql_escape(feat['depth_m'])}, {sql_escape(feat['permanently_shadowed'])}, {sql_escape(feat['ice_potential'])}, {sql_escape(feat['description'])})"
        feat_lines.append(line)
        
    f.write(",\n".join(feat_lines))
    f.write("\nON CONFLICT (name) DO UPDATE SET\n")
    f.write("    feature_type = EXCLUDED.feature_type,\n")
    f.write("    latitude_deg = EXCLUDED.latitude_deg,\n")
    f.write("    longitude_deg = EXCLUDED.longitude_deg,\n")
    f.write("    diameter_km = EXCLUDED.diameter_km,\n")
    f.write("    depth_m = EXCLUDED.depth_m,\n")
    f.write("    permanently_shadowed = EXCLUDED.permanently_shadowed,\n")
    f.write("    ice_potential = EXCLUDED.ice_potential,\n")
    f.write("    description = EXCLUDED.description;\n\n")

    f.write("-- 4. Upsert Mission Profiles\n")
    f.write("INSERT INTO public.custom_mission_profiles (name, description, weights_json)\nVALUES\n")
    prof_lines = []
    for p in ALL_AUTHORITATIVE_PROFILES:
        weights_str = json.dumps(p["weights_json"])
        line = f"    ({sql_escape(p['name'])}, {sql_escape(p['description'])}, '{weights_str}'::jsonb)"
        prof_lines.append(line)
    f.write(",\n".join(prof_lines))
    f.write(";\n\n")

    f.write("-- Verification Query\n")
    f.write("SELECT 'lunar_missions' AS table_name, count(*) AS total_records FROM public.lunar_missions\n")
    f.write("UNION ALL\n")
    f.write("SELECT 'lunar_features' AS table_name, count(*) AS total_records FROM public.lunar_features\n")
    f.write("UNION ALL\n")
    f.write("SELECT 'custom_mission_profiles' AS table_name, count(*) AS total_records FROM public.custom_mission_profiles;\n")

print(f"Generated {out_path} successfully.")
