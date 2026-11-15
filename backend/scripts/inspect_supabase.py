import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database

missions = database.supabase_request("lunar_missions")
features = database.supabase_request("lunar_features")
profiles = database.supabase_request("custom_mission_profiles")
saved = database.supabase_request("saved_sites")
assessments = database.supabase_request("site_assessments")

print("Missions in Supabase:", len(missions) if missions is not None else "ERROR")
print("Features in Supabase:", len(features) if features is not None else "ERROR")
print("Profiles in Supabase:", len(profiles) if profiles is not None else "ERROR")
print("Saved Sites in Supabase:", len(saved) if saved is not None else "ERROR")
print("Site Assessments in Supabase:", len(assessments) if assessments is not None else "ERROR")

if missions:
    print("\nSample mission in Supabase:")
    print(missions[0])
